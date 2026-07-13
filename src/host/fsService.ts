import { promises as fs } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { DirEntry } from '../shared/protocol';

const SYMLINK_STAT_TIMEOUT_MS = 100;

async function statSymlinkKind(path: string): Promise<DirEntry['kind']> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fs.stat(path).then((st) => {
        if (st.isDirectory()) return 'dir';
        if (st.isFile()) return 'file';
        return 'symlink';
      }).catch(() => 'symlink' as const),
      new Promise<DirEntry['kind']>((resolve) => {
        timer = setTimeout(() => resolve('symlink'), SYMLINK_STAT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function classifyDirent(dirPath: string, d: import('node:fs').Dirent): Promise<DirEntry> {
  let kind: DirEntry['kind'] = d.isDirectory()
    ? 'dir'
    : d.isSymbolicLink()
      ? 'symlink'
      : d.isFile()
        ? 'file'
        : 'other';
  if (kind === 'symlink') kind = await statSymlinkKind(join(dirPath, d.name));
  return { name: d.name, kind };
}

export async function listDir(dirPath: string): Promise<{ entries: DirEntry[] }> {
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const entries: DirEntry[] = await Promise.all(dirents.map((d) => classifyDirent(dirPath, d)));
  // 目录优先,各自按名称排序
  entries.sort((a, b) => {
    const ad = a.kind === 'dir' ? 0 : 1;
    const bd = b.kind === 'dir' ? 0 : 1;
    return ad - bd || a.name.localeCompare(b.name);
  });
  return { entries };
}
export function homeDir(): { path: string } {
  return { path: os.homedir() };
}

export async function statPath(
  p: string,
): Promise<{ kind: 'file' | 'dir' | null }> {
  try {
    const st = await fs.stat(p);
    return { kind: st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null };
  } catch {
    return { kind: null };
  }
}

export async function realPath(p: string): Promise<{ path: string | null }> {
  try {
    return { path: await fs.realpath(p) };
  } catch {
    return { path: null };
  }
}

/** 文本文件上限:超过不读(查看器场景,防大文件拖垮 IPC) */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function looksBinary(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  return probe.includes(0);
}

export async function readTextFile(path: string): Promise<{
  content: string | null;
  binary: boolean;
  truncated: boolean;
  size: number;
}> {
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error('not a regular file');
  if (stat.size > MAX_FILE_BYTES) {
    return { content: null, binary: false, truncated: true, size: stat.size };
  }
  const buf = await fs.readFile(path);
  if (looksBinary(buf)) {
    return { content: null, binary: true, truncated: false, size: stat.size };
  }
  return {
    content: buf.toString('utf8'),
    binary: false,
    truncated: false,
    size: stat.size,
  };
}

/** 二进制预览上限(图片;base64 后约 ×1.37 经 RPC 传输) */
const MAX_BINARY_BYTES = 20 * 1024 * 1024;
const TEMP_PNG_PREFIX = 'termpro-clipboard-';
const TEMP_PNG_TTL_MS = 24 * 60 * 60 * 1000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function readBinaryFile(
  path: string,
): Promise<{ base64: string | null; size: number }> {
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error('not a regular file');
  if (stat.size > MAX_BINARY_BYTES) {
    return { base64: null, size: stat.size };
  }
  const buf = await fs.readFile(path);
  return { base64: buf.toString('base64'), size: stat.size };
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  // 只允许写已存在的普通文件:查看器是「轻编辑」,不负责新建
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error('not a regular file');
  await fs.writeFile(path, content, 'utf8');
}

function decodeStrictBase64(base64: string, maxBytes: number): Buffer {
  if (!base64) throw new Error('empty temporary PNG');
  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw new Error('invalid base64 for temporary PNG');
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const decodedSize = (base64.length / 4) * 3 - padding;
  if (decodedSize > maxBytes) {
    throw new Error(`temporary PNG exceeds ${maxBytes} bytes`);
  }
  return Buffer.from(base64, 'base64');
}

/** 下次写入时顺手清掉上次异常退出遗留的敏感截图;当前进程创建项另有 unref TTL。 */
async function pruneExpiredTempPngDirs(root: string, now = Date.now()): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PNG_PREFIX))
      .map(async (entry) => {
        const p = join(root, entry.name);
        try {
          if (now - (await fs.stat(p)).mtimeMs >= TEMP_PNG_TTL_MS) {
            await fs.rm(p, { recursive: true, force: true });
          }
        } catch {
          /* 竞态删除/权限变化:best effort */
        }
      }),
  );
}

/**
 * Host 自分配临时 PNG:renderer 只能给内容,不能给路径。0700 目录 + 0600/wx 文件,
 * 24h 后删除(给长时间保留的草稿留余量);远程 Host 异常退出的遗留由下次调用 sweep。
 */
export async function writeTempPng(
  base64: string,
  tempRoot = os.tmpdir(),
  maxBytes = MAX_BINARY_BYTES,
): Promise<{ path: string }> {
  const bytes = decodeStrictBase64(base64, maxBytes);
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('temporary image is not a PNG');
  }

  await pruneExpiredTempPngDirs(tempRoot);
  const dir = await fs.mkdtemp(join(tempRoot, TEMP_PNG_PREFIX));
  await fs.chmod(dir, 0o700);
  const imagePath = join(dir, 'image.png');
  try {
    await fs.writeFile(imagePath, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  const timer = setTimeout(() => {
    void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }, TEMP_PNG_TTL_MS);
  timer.unref?.();
  return { path: imagePath };
}

/** 新建单层目录:不递归(父目录由浏览器保证存在,防手滑把整链路径落地) */
export async function makeDir(path: string): Promise<void> {
  await fs.mkdir(path);
}

// ---- 拖拽:移动 / 复制 --------------------------------------------------

/** 路径是否存在(含断链符号链接,故用 lstat) */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** 目标目录内不冲突的绝对路径:重名时仿 Finder 加「 (2)」「 (3)」后缀 */
async function uniqueDest(destDir: string, name: string): Promise<string> {
  if (!(await pathExists(join(destDir, name)))) return join(destDir, name);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name; // 开头的点(隐藏文件)不算扩展名
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const cand = join(destDir, `${stem} (${i})${ext}`);
    if (!(await pathExists(cand))) return cand;
  }
}

/** 禁止把目录移动/复制进自身或其子孙(否则递归自噬)。
 *  大小写不敏感比较(macOS APFS 默认),词法层拦住常见误操作;内核层另有兜底。 */
function guardDescendant(src: string, destDir: string): void {
  const s = resolve(src).toLowerCase();
  const d = resolve(destDir).toLowerCase();
  if (d === s || d.startsWith(s + sep)) {
    throw new Error('cannot move/copy a folder into itself');
  }
}

/** 把 src 移动进 destDir。原地移动忽略;跨设备回退 copy+删;返回最终目标路径。 */
export async function moveInto(
  src: string,
  destDir: string,
): Promise<{ dst: string }> {
  guardDescendant(src, destDir);
  // 原地(目标目录就是当前所在目录)→ 无操作,避免被 uniqueDest 误改名
  if (resolve(dirname(src)) === resolve(destDir)) return { dst: src };
  const dst = await uniqueDest(destDir, basename(src));
  try {
    await fs.rename(src, dst);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      // 跨卷:先完整复制,**校验目标确实落地**再删源。cp 抛错则不到这步、源保留;
      // 校验失败(目标缺失)也抛错保留源 —— 杜绝「cp 静默不全就删源」的数据丢失。
      await fs.cp(src, dst, { recursive: true });
      await fs.lstat(dst);
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return { dst };
}

/** 把 src 复制进 destDir(递归);返回最终目标路径。重名竞态则重算目标重试。 */
export async function copyInto(
  src: string,
  destDir: string,
): Promise<{ dst: string }> {
  guardDescendant(src, destDir);
  const name = basename(src);
  for (let attempt = 0; ; attempt++) {
    const dst = await uniqueDest(destDir, name);
    try {
      // errorOnExist:uniqueDest 与写入之间被并发抢占同名 → 抛错重算(不覆盖别人)
      await fs.cp(src, dst, { recursive: true, force: false, errorOnExist: true });
      return { dst };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'ERR_FS_CP_EEXIST' || code === 'EEXIST') && attempt < 5) {
        continue;
      }
      throw err;
    }
  }
}
