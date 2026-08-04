import { promises as fs } from 'node:fs';
import * as crypto from 'node:crypto';
import os from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { DirEntry, TRANSFER } from '../shared/protocol';

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
): Promise<{ kind: 'file' | 'dir' | null; size?: number; mtimeMs?: number }> {
  try {
    const st = await fs.stat(p);
    if (st.isFile()) {
      // size/mtimeMs 恒随 kind='file' 一起填(远程文件传输下载前的元信息预检)。
      return { kind: 'file', size: st.size, mtimeMs: st.mtimeMs };
    }
    return { kind: st.isDirectory() ? 'dir' : null };
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
const TEMP_PNG_PREFIX = 'okwork-clipboard-';
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

/** length 钳制到 [1, TRANSFER.maxChunkBytes];非有限数(NaN/Infinity)兜底到上限。 */
function clampRangeLength(length: number): number {
  const n = Math.trunc(length);
  if (!Number.isFinite(n)) return TRANSFER.maxChunkBytes;
  return Math.min(Math.max(n, 1), TRANSFER.maxChunkBytes);
}

/**
 * 分块读文件(远程下载用):open 一次 fd,fstat 与 pread 用同一 fd 取 size/mtimeMs,
 * 与实际读取内容强一致(防 TOCTOU:文件在两次系统调用之间被替换)。
 * offset 非法(非有限非负整数)抛错;length 静默钳制(不抛,渲染端可传任意正数试探)。
 * 越界读(offset≥size)不算错误:返回 bytes=0、eof=true(渲染端据此终止分块循环)。
 */
export async function readFileRange(
  path: string,
  offset: number,
  length: number,
): Promise<{ base64: string; bytes: number; eof: boolean; size: number; mtimeMs: number }> {
  const handle = await fs.open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('not a regular file');
    const size = stat.size;
    const mtimeMs = stat.mtimeMs;
    const clampedLength = clampRangeLength(length);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('invalid range offset');
    }
    if (offset >= size) {
      return { base64: '', bytes: 0, eof: true, size, mtimeMs };
    }
    const toRead = Math.min(clampedLength, size - offset);
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await handle.read(buf, 0, toRead, offset);
    return {
      base64: buf.subarray(0, bytesRead).toString('base64'),
      bytes: bytesRead,
      eof: offset + bytesRead >= size,
      size,
      mtimeMs,
    };
  } finally {
    await handle.close();
  }
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

/**
 * 严格 base64 解码:字符集/长度/padding 校验 + 解码后字节数上限(泛化自原 PNG 专用实现,
 * 现同时供 writeTempPng 与远程文件上传分块 UploadRegistry.chunk 复用)。
 * 校验先行(不先分配/解码超限输入),防恶意超大 base64 触发大内存分配才被拒。
 */
function decodeStrictBase64(base64: string, maxBytes: number): Buffer {
  if (!base64) throw new Error('empty base64 input');
  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw new Error('invalid base64 encoding');
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const decodedSize = (base64.length / 4) * 3 - padding;
  if (decodedSize > maxBytes) {
    throw new Error(`base64 payload exceeds ${maxBytes} bytes`);
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

// ---- 远程文件传输:上传(分块写)-----------------------------------------

const UPLOAD_PART_PREFIX = '.okwork-upload-';
const UPLOAD_PART_SUFFIX = '.part';
/** 与 pruneExpiredTempPngDirs 同 TTL 口径:24h 后视为异常退出遗留,下次 begin 顺手清。 */
const UPLOAD_PART_TTL_MS = 24 * 60 * 60 * 1000;

/** 上传目标文件名校验:单段(不含路径分隔符/NUL),非空,非 '.'/'..'。 */
function isValidUploadName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  return !name.includes('/') && !name.includes('\\') && !name.includes('\0');
}

/**
 * 下次 begin 时顺手清掉上次异常退出(崩溃/断连未走 disposeAll)遗留的 .part 临时文件。
 * activePartPaths:当前登记表里在册的 .part 路径(哪怕 mtime 已「过期」也跳过)——
 * 防止一个停滞很久但仍在传输中的上传,被同目录里另一次 begin 触发的 sweep 误删。
 */
async function sweepExpiredUploadParts(
  dir: string,
  activePartPaths: ReadonlySet<string>,
  now = Date.now(),
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(UPLOAD_PART_PREFIX) &&
          entry.name.endsWith(UPLOAD_PART_SUFFIX),
      )
      .map(async (entry) => {
        const p = join(dir, entry.name);
        if (activePartPaths.has(p)) return; // 在册在途传输,不管 mtime 多旧都不动
        try {
          if (now - (await fs.stat(p)).mtimeMs >= UPLOAD_PART_TTL_MS) {
            await fs.unlink(p);
          }
        } catch {
          /* 竞态删除/权限变化:best effort,不影响本次 begin */
        }
      }),
  );
}

interface UploadEntry {
  handle: import('node:fs/promises').FileHandle;
  destDir: string;
  name: string;
  size: number;
  received: number;
  partPath: string;
  /** per-transfer 串行链:chunk 的「校验 offset + write + 推进 received」整体在此排队,
   *  防止同一 transferId 的并发 RPC 调度跨 await 穿越校验(见 chunk() 注释)。 */
  tail: Promise<unknown>;
}

export interface UploadRegistry {
  begin(params: { destDir: string; name: string; size: number }): Promise<{ transferId: string }>;
  chunk(transferId: string, offset: number, base64: string): Promise<{ received: number }>;
  end(transferId: string, commit: boolean): Promise<{ path: string | null }>;
  /** 客户端断连清理主路径:关全部在途 fd + 删全部 .part(不留孤儿临时文件)。 */
  disposeAll(): Promise<void>;
}

/**
 * 每客户端一份的上传登记表(hostCore.ts 建 client 时创建,port close 时 disposeAll)。
 * 临时落地路径恒由 Host 生成(`.okwork-upload-<16hex>.part`,destDir 内),renderer 只给
 * destDir/name/size,无法指定路径(防目录穿越,同 fs.writeTempFile 口径)。
 * commit 用 fs.link + unlink 而非 fs.rename —— rename 会静默覆盖同名目标,违反本项目
 * 「重名自动加后缀、绝不覆盖」的口径(见 uniqueDest 各调用方)。
 */
export function createUploadRegistry(): UploadRegistry {
  const uploads = new Map<string, UploadEntry>();
  /** 「判定已通过、fs.open 尚未落地」的占位计数,与 uploads.size 一起构成并发上限的实际占用。 */
  let pendingSlots = 0;

  async function begin(params: {
    destDir: string;
    name: string;
    size: number;
  }): Promise<{ transferId: string }> {
    const { destDir, name, size } = params;
    if (!isAbsolute(destDir)) throw new Error('destDir must be an absolute path');
    const destStat = await fs.stat(destDir);
    if (!destStat.isDirectory()) throw new Error('destDir is not a directory');
    if (!isValidUploadName(name)) throw new Error('invalid upload file name');
    // 0 是合法的(空文件上传);仍要求有限非负整数。
    if (!Number.isInteger(size) || size < 0) {
      throw new Error('upload size must be a non-negative integer');
    }
    if (size > TRANSFER.maxFileBytes) {
      throw new Error(`upload exceeds max file size of ${TRANSFER.maxFileBytes} bytes`);
    }
    // 判定与占位之间不能有 await:否则并发 begin() 都能在 uploads.size 还未增长时
    // 穿越判定。pendingSlots 在此同步区间内立即 ++,把「判定通过」与「占坑」焊在一起。
    if (uploads.size + pendingSlots >= TRANSFER.maxConcurrentUploads) {
      throw new Error(`too many concurrent uploads (max ${TRANSFER.maxConcurrentUploads})`);
    }
    pendingSlots++;
    try {
      const transferId = crypto.randomBytes(8).toString('hex');
      const partPath = join(destDir, `${UPLOAD_PART_PREFIX}${transferId}${UPLOAD_PART_SUFFIX}`);
      const handle = await fs.open(partPath, 'wx');
      uploads.set(transferId, {
        handle,
        destDir,
        name,
        size,
        received: 0,
        partPath,
        tail: Promise.resolve(),
      });

      // best-effort 清理同目录里过期的遗留 .part;不 await —— 不拖慢 begin 的返回。
      // 传入当前在册的 .part 路径快照,sweep 内部会跳过它们(哪怕看起来「已过期」)。
      const active = new Set([...uploads.values()].map((e) => e.partPath));
      void sweepExpiredUploadParts(destDir, active);

      return { transferId };
    } finally {
      pendingSlots--;
    }
  }

  async function chunk(
    transferId: string,
    offset: number,
    base64: string,
  ): Promise<{ received: number }> {
    const entry = uploads.get(transferId);
    if (!entry) throw new Error(`unknown transfer: ${transferId}`);
    // hostCore 对同一 client 的 RPC 是并发调度的:两个同 transferId 的 chunk 调用可能
    // 同时进入这个函数,若「校验 offset → write → 推进 received」跨 await 各自独立执行,
    // 两者都能读到旧的 entry.received 并双双通过校验(同 offset 互相覆盖,received 虚增)。
    // 用 entry.tail 把整段操作排成一条串行链,同一 transfer 的 chunk 严格挨个执行。
    const task = entry.tail.then(async () => {
      if (offset !== entry.received) {
        throw new Error('upload offset mismatch');
      }
      const bytes = decodeStrictBase64(base64, TRANSFER.maxChunkBytes);
      if (entry.received + bytes.length > entry.size) {
        throw new Error('upload exceeds declared size');
      }
      await entry.handle.write(bytes, 0, bytes.length, offset);
      entry.received += bytes.length;
      return { received: entry.received };
    });
    // 链上某一环节失败不能让后续 chunk 永远卡在一个 rejected promise 上,
    // 故 tail 本身接一个吞掉错误的分支;失败原因仍从 task(本次调用的返回值)抛给调用方。
    entry.tail = task.catch(() => undefined);
    return task;
  }

  async function end(transferId: string, commit: boolean): Promise<{ path: string | null }> {
    const entry = uploads.get(transferId);
    if (!entry) {
      // 未知 id:commit=false 视为已结束的幂等收尾(不抛);commit=true 无物可提交,抛错。
      if (commit) throw new Error(`unknown transfer: ${transferId}`);
      return { path: null };
    }
    uploads.delete(transferId); // 立即让出并发名额,无论后续成败

    // 等此前排队的 chunk 任务全部落定(不管成功失败),避免 end 与仍在 tail 链上的
    // 写入竞争同一个 fd/received —— 是 chunk() 串行链在收口处的必要延伸。
    await entry.tail.catch(() => undefined);

    if (!commit) {
      await entry.handle.close().catch(() => undefined);
      await fs.unlink(entry.partPath).catch(() => undefined);
      return { path: null };
    }

    // 独立防线:哪怕每个 chunk 各自校验都通过,少发/漏发块也不能被 commit 悄悄放过。
    if (entry.received !== entry.size) {
      await entry.handle.close().catch(() => undefined);
      await fs.unlink(entry.partPath).catch(() => undefined);
      throw new Error('upload incomplete: received bytes do not match declared size');
    }

    try {
      await entry.handle.sync();
      await entry.handle.close();
      for (let attempt = 0; ; attempt++) {
        const dest = await uniqueDest(entry.destDir, entry.name);
        try {
          // 硬链接 + 删源(而非 rename):EEXIST 时不覆盖,重算目标重试(仿 copyInto)。
          await fs.link(entry.partPath, dest);
          await fs.unlink(entry.partPath);
          return { path: dest };
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'EEXIST' && attempt < 5) continue;
          throw err;
        }
      }
    } catch (err) {
      // 提交路径任何一步失败都不留孤儿:fd 可能已关(sync/close 之后失败)或还开着
      // (sync 本身失败),close 失败(如已关过)与 unlink 失败(如 .part 已不存在)都忽略。
      await entry.handle.close().catch(() => undefined);
      await fs.unlink(entry.partPath).catch(() => undefined);
      throw err;
    }
  }

  async function disposeAll(): Promise<void> {
    const entries = [...uploads.values()];
    uploads.clear();
    await Promise.all(
      entries.map(async (entry) => {
        await entry.handle.close().catch(() => undefined);
        await fs.unlink(entry.partPath).catch(() => undefined);
      }),
    );
  }

  return { begin, chunk, end, disposeAll };
}
