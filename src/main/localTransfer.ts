import { promises as fsp } from 'node:fs';
import * as crypto from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { TRANSFER } from '../shared/protocol';

/**
 * 远程文件传输 · 阶段2:本机盘票据通道(main 主进程持有,renderer 只见 ticket)。
 *
 * 🔴 安全红线(与 preload transfer 命名空间同一条,双写不漏读):本机盘读写的路径
 * 永不来自 renderer —— 写落点只能由 main 的保存对话框(showSaveDialog)产生,
 * 读来源只能由 main 的打开对话框(showOpenDialog)产生;renderer 全程只持有本
 * 模块签发的不透明 ticket 字符串,无法用它换回或指定任意本机绝对路径。绝不
 * 新增「renderer 传本机绝对路径 → main 读写」形态的 IPC。
 *
 * 纯逻辑、零 Electron 依赖(不 import dialog/ipcMain):main.ts 负责调用系统对话框
 * 拿到路径后再喂给这里,本类只管票据生命周期与实际 fd 读写,可脱离 Electron 单测。
 */

export type TicketId = string;

export interface WriteTicketInfo {
  ticket: TicketId;
  name: string;
}

export interface ReadTicketInfo {
  ticket: TicketId;
  name: string;
  size: number;
  path: string;
}

export interface LocalTransferOptions {
  /** 单实例票据上限(读 + 写合计);默认 8 —— 防大量并发传输打爆 fd/磁盘 IO
   *  (与 TRANSFER.maxConcurrentUploads 同口径,但这里是本机盘不分远程并发桶)。 */
  maxTickets?: number;
  /** 票据闲置多久算过期(sweepIdle 清理对象);默认 30 分钟 —— renderer 崩溃/
   *  窗口未走正常关闭路径时,不留孤儿 fd 与 .okwork-part-* 临时文件。 */
  idleTtlMs?: number;
  /** 单块 base64 解码后的字节上限;默认 = TRANSFER.maxChunkBytes(与远程传输
   *  分块口径统一,防止本机通道成为绕过限制的后门)。 */
  maxChunkBytes?: number;
  /** 时钟注入(测试用);默认 Date.now。 */
  now?: () => number;
}

interface BaseEntry {
  senderId: number;
  lastUsedAt: number;
}

interface WriteEntry extends BaseEntry {
  kind: 'write';
  handle: import('node:fs/promises').FileHandle;
  finalPath: string;
  partPath: string;
  name: string;
}

interface ReadEntry extends BaseEntry {
  kind: 'read';
  handle: import('node:fs/promises').FileHandle;
  filePath: string;
  name: string;
  size: number;
  mtimeMs: number;
}

type TicketEntry = WriteEntry | ReadEntry;

const DEFAULT_MAX_TICKETS = 8;
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
/** 写票临时件命名:`.<basename><PART_INFIX><16hex ticket>`,与最终文件同目录
 *  (保证 finish 落地时的 rename 恒同设备,不会撞 EXDEV)。前导点号:半成品文件
 *  不该在 Finder/资源管理器默认视图里碍眼——commit 失败留下的孤儿件同理。 */
const PART_INFIX = '.okwork-part-';
const CONTROL_CHARS_RE = new RegExp('[\\x00-\\x1f\\x7f]', 'g');

/**
 * 严格 base64 解码:字符集/长度/padding 校验先行(不先分配/解码超限输入才被拒),
 * 解码后字节数钳制上限。逻辑与 host/fsService.ts 的 decodeStrictBase64 同款,本机
 * 通道独立成模块故不跨包共享(避免 main ↔ host 产生不必要的耦合)。
 */
function decodeStrictBase64(base64: unknown, maxBytes: number): Buffer {
  if (typeof base64 !== 'string' || !base64) {
    throw new Error('empty or invalid base64 input');
  }
  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw new Error('invalid base64 encoding');
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const decodedSize = (base64.length / 4) * 3 - padding;
  if (decodedSize > maxBytes) {
    throw new Error(`chunk exceeds ${maxBytes} bytes`);
  }
  return Buffer.from(base64, 'base64');
}

/** length 钳制到 [1, maxBytes];非有限数(NaN/Infinity/非 number)兜底到上限。 */
function clampChunkLength(length: unknown, maxBytes: number): number {
  const n = Math.trunc(Number(length));
  if (!Number.isFinite(n)) return maxBytes;
  return Math.min(Math.max(n, 1), maxBytes);
}

/**
 * 剥目录分隔符 / `..` / 控制字符,取「最后一段」当文件名(basename 语义,而非逐字符
 * 替换 —— 这样 `../../etc/passwd` 才会正确落到 `passwd` 而不是一坨点号残留)。
 * 空结果(含单独 `.`/`..`)一律兜底 'download'。用于 showSaveDialog 的 defaultPath
 * 建议文件名(渲染层传来的仅是「建议」,真正落点仍由用户在系统对话框里敲定)。
 */
export function sanitizeSuggestedName(raw: unknown): string {
  if (typeof raw !== 'string') return 'download';
  const segments = raw.replace(/\\/g, '/').split('/');
  const last = (segments.pop() ?? '').replace(CONTROL_CHARS_RE, '').trim();
  if (!last || last === '.' || last === '..') return 'download';
  return last;
}

export class LocalTransferRegistry {
  private readonly tickets = new Map<TicketId, TicketEntry>();
  private readonly maxTickets: number;
  private readonly idleTtlMs: number;
  private readonly maxChunkBytes: number;
  private readonly now: () => number;
  /**
   * 🔴 并发安全(check-then-act):createWrite/createRead 的配额判断(assertQuota,
   * 读 tickets.size)与登记进 tickets 之间必须跨越至少一次 await(fsp.open,可能还有
   * handle.stat())——并发调用会在这个窗口里都看到"未满"的旧 size,一起穿过配额闸门。
   * 修法:配额检查与"占位"在同一段不出让事件循环的同步代码里完成——先给 pending
   * 计数 +1(把这个名额算进配额,tickets.size 还没来得及体现),open/stat 失败再
   * -1 回滚;assertQuota 判 tickets.size + pending。 */
  private pending = 0;

  constructor(opts: LocalTransferOptions = {}) {
    this.maxTickets = opts.maxTickets ?? DEFAULT_MAX_TICKETS;
    this.idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.maxChunkBytes = opts.maxChunkBytes ?? TRANSFER.maxChunkBytes;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.tickets.size;
  }

  private newTicketId(): TicketId {
    return crypto.randomBytes(8).toString('hex');
  }

  private assertQuota(): void {
    if (this.tickets.size + this.pending >= this.maxTickets) {
      throw new Error(`too many local transfer tickets (max ${this.maxTickets})`);
    }
  }

  /**
   * 取票并校验归属(kind + senderId 双闸)。找不到 / kind 不符 / sender 不符
   * 一律抛同一条错误 —— 不给 renderer 一个可用来探测「这个 ticket 是否真实存在
   * (只是不归我)」的 oracle。
   */
  private requireEntry<K extends TicketEntry['kind']>(
    senderId: number,
    ticket: string,
    kind: K,
  ): Extract<TicketEntry, { kind: K }> {
    const entry = this.tickets.get(ticket);
    if (!entry || entry.senderId !== senderId || entry.kind !== kind) {
      throw new Error(`unknown ${kind} ticket`);
    }
    return entry as Extract<TicketEntry, { kind: K }>;
  }

  /** 开始一次保存(下载落盘):finalPath 由 main 的 showSaveDialog 产生。 */
  async createWrite(finalPath: string, senderId: number): Promise<WriteTicketInfo> {
    if (typeof finalPath !== 'string' || !isAbsolute(finalPath)) {
      throw new Error('finalPath must be an absolute path');
    }
    const name = basename(finalPath);
    if (!name) throw new Error('finalPath must name a file');
    this.assertQuota();
    this.pending += 1; // 与 assertQuota 同步块内占位,见类字段注释
    const ticket = this.newTicketId();
    const partPath = join(dirname(finalPath), `.${name}${PART_INFIX}${ticket}`);
    let handle: import('node:fs/promises').FileHandle;
    try {
      handle = await fsp.open(partPath, 'wx');
    } catch (err) {
      this.pending -= 1;
      throw err;
    }
    this.pending -= 1;
    this.tickets.set(ticket, {
      kind: 'write',
      handle,
      finalPath,
      partPath,
      name,
      senderId,
      lastUsedAt: this.now(),
    });
    return { ticket, name };
  }

  /** 开始一次读取(上传/预览取源):filePath 由 main 的 showOpenDialog 产生。 */
  async createRead(filePath: string, senderId: number): Promise<ReadTicketInfo> {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
      throw new Error('filePath must be an absolute path');
    }
    this.assertQuota();
    this.pending += 1; // 与 assertQuota 同步块内占位,见类字段注释
    let handle: import('node:fs/promises').FileHandle;
    try {
      handle = await fsp.open(filePath, 'r');
    } catch (err) {
      this.pending -= 1;
      throw err;
    }
    let size: number;
    let mtimeMs: number;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('not a regular file');
      size = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch (err) {
      await handle.close().catch(() => undefined);
      this.pending -= 1;
      throw err;
    }
    this.pending -= 1;
    const ticket = this.newTicketId();
    const name = basename(filePath);
    this.tickets.set(ticket, {
      kind: 'read',
      handle,
      filePath,
      name,
      size,
      mtimeMs,
      senderId,
      lastUsedAt: this.now(),
    });
    return { ticket, name, size, path: filePath };
  }

  /** 写入一个分块;offset 定位落笔位置(乱序/并发到达各按自己的 offset 落位,
   *  不强制顺序 —— 与远程 UploadRegistry.chunk 的严格顺序口径刻意不同:本机盘
   *  随机写代价低,允许渲染层并发发多块提吞吐)。 */
  async write(
    senderId: number,
    ticket: string,
    offset: number,
    base64: string,
  ): Promise<{ written: number }> {
    const entry = this.requireEntry(senderId, ticket, 'write');
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('invalid write offset');
    }
    const bytes = decodeStrictBase64(base64, this.maxChunkBytes);
    const { bytesWritten } = await entry.handle.write(bytes, 0, bytes.length, offset);
    entry.lastUsedAt = this.now();
    return { written: bytesWritten };
  }

  /** 分块读取;每次调用都重新 fstat(而非用票据里缓存的初始值)—— 检测源文件在
   *  传输过程中被改写(TOCTOU 感知,非阻止:上层据新旧 mtimeMs 比对自行决定是否
   *  中止/提示用户,本层只负责如实上报当次读取所见的 size/mtimeMs)。 */
  async read(
    senderId: number,
    ticket: string,
    offset: number,
    length: number,
  ): Promise<{ base64: string; bytes: number; eof: boolean; size: number; mtimeMs: number }> {
    const entry = this.requireEntry(senderId, ticket, 'read');
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('invalid read offset');
    }
    const stat = await entry.handle.stat();
    const size = stat.size;
    const mtimeMs = stat.mtimeMs;
    entry.size = size;
    entry.mtimeMs = mtimeMs;
    entry.lastUsedAt = this.now();
    if (offset >= size) {
      return { base64: '', bytes: 0, eof: true, size, mtimeMs };
    }
    const clampedLength = clampChunkLength(length, this.maxChunkBytes);
    const toRead = Math.min(clampedLength, size - offset);
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await entry.handle.read(buf, 0, toRead, offset);
    return {
      base64: buf.subarray(0, bytesRead).toString('base64'),
      bytes: bytesRead,
      eof: offset + bytesRead >= size,
      size,
      mtimeMs,
    };
  }

  /**
   * 结束一次传输。写票:commit=true → fsync+close+rename(part→finalPath,恒覆盖
   * —— 系统保存对话框在拿到 finalPath 前已经问过用户「是否覆盖已存在文件」,这里
   * 无需也不应二次拦截);commit=false → close+unlink(part),不落地。
   * 读票:不产出任何落点,commit 值被忽略,只 close 释放 fd。
   * 🔴 「票据存在但 sender 不符」与「票据压根不存在」两回事,不能混为一谈:前者
   * 恒拒绝(同 write/read 的 requireEntry 口径 —— 别人的票据不该被你 commit=false
   * 一下就悄悄冲掉);只有后者(真不存在,例如已 finish 过/从未存在)才享受
   * commit=false 的幂等静默收尾(允许重复 finish 不炸),commit=true 仍抛错
   * (无票可提交)。
   */
  async finish(
    senderId: number,
    ticket: string,
    commit: boolean,
  ): Promise<{ path: string | null }> {
    const entry = this.tickets.get(ticket);
    if (entry && entry.senderId !== senderId) {
      throw new Error('unknown ticket');
    }
    if (!entry) {
      if (commit) throw new Error('unknown write ticket');
      return { path: null };
    }
    this.tickets.delete(ticket); // 立即让出配额,无论后续成败

    if (entry.kind === 'read') {
      await entry.handle.close().catch(() => undefined);
      return { path: null };
    }

    if (!commit) {
      await entry.handle.close().catch(() => undefined);
      await fsp.unlink(entry.partPath).catch(() => undefined);
      return { path: null };
    }

    try {
      await entry.handle.sync();
      await entry.handle.close();
      await fsp.rename(entry.partPath, entry.finalPath);
      return { path: entry.finalPath };
    } catch (err) {
      // 🔴 提交失败(sync/close/rename 任一步)不能留孤儿 part:此时票据已从 tickets
      // 摘除(上面的 delete),sweepIdle 再也追踪不到它,不在这里兜底就是永久残留。
      // close() 可能已经在 sync 之后成功过一次,这里的第二次调用容错吞掉(不双重抛错)。
      await entry.handle.close().catch(() => undefined);
      await fsp.unlink(entry.partPath).catch(() => undefined);
      throw err;
    }
  }

  /** 释放走双保险的清理主路径(main.ts 挂 webContents 'destroyed'):关闭该
   *  sender 名下全部在途票据的 fd,写票额外删 .part(读票绝不删源文件 —— 那是
   *  用户自己的文件,不是本模块创建的临时件)。不影响其他 sender 的票据。 */
  async abortBySender(senderId: number): Promise<void> {
    const victims: TicketEntry[] = [];
    for (const [ticket, entry] of this.tickets) {
      if (entry.senderId === senderId) {
        victims.push(entry);
        this.tickets.delete(ticket);
      }
    }
    await Promise.all(victims.map((entry) => this.disposeEntry(entry)));
  }

  /** TTL 清扫(main.ts 定时调用):只清 lastUsedAt 超过 idleTtlMs 的票据,
   *  未过期的原样保留。 */
  async sweepIdle(): Promise<void> {
    const now = this.now();
    const victims: TicketEntry[] = [];
    for (const [ticket, entry] of this.tickets) {
      if (now - entry.lastUsedAt >= this.idleTtlMs) {
        victims.push(entry);
        this.tickets.delete(ticket);
      }
    }
    await Promise.all(victims.map((entry) => this.disposeEntry(entry)));
  }

  private async disposeEntry(entry: TicketEntry): Promise<void> {
    await entry.handle.close().catch(() => undefined);
    if (entry.kind === 'write') {
      await fsp.unlink(entry.partPath).catch(() => undefined);
    }
  }
}

/**
 * `transfer:begin-open` 的编排逻辑(main.ts 的 ipcMain.handle 只管弹 showOpenDialog
 * 拿路径,批量开读票的循环 + 失败回滚都在这里)——只依赖 registry 的窄接口,不碰
 * dialog/BrowserWindow,可脱离 Electron 单测。
 *
 * 🔴 中途失败必须回滚:多选场景下,若第 3/5 个文件 createRead 失败(如配额耗尽),
 * 前 2 张已建的读票不能悄悄留在 registry 里——不然它们要等 30min idleTtl 才被
 * sweepIdle 回收,配额被"半成功的一批"占着,后续传输逐步锁死。回滚后把原始错误
 * 重新抛出(不吞、不改写成另一种"错误形态")——renderer 侧 transferManager.upload()
 * 已经给 bridge.beginOpen() 的 reject 包了 try/catch,会据此记一条用户可见的 failed
 * 终态,IPC 拒绝这一条契约足够表达,没必要另造一种返回值形态。
 */
export async function collectReadTickets(
  registry: Pick<LocalTransferRegistry, 'createRead' | 'finish'>,
  filePaths: readonly string[],
  senderId: number,
): Promise<ReadTicketInfo[]> {
  const tickets: ReadTicketInfo[] = [];
  try {
    for (const filePath of filePaths) {
      tickets.push(await registry.createRead(filePath, senderId));
    }
  } catch (err) {
    await Promise.all(
      tickets.map((t) => registry.finish(senderId, t.ticket, false).catch(() => undefined)),
    );
    throw err;
  }
  return tickets;
}
