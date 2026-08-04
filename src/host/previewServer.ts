// 项目内 HTML 预览:每个 root 懒启动一个独立 http.Server,只服务该 root 子树下的静态
// 文件。纯 Node,零 Electron import(README §5 远程就绪);**且零第三方**——只用
// node:http/node:fs/node:path(+ 本地 token.ts,同样零第三方)。
//
// 威胁模型与 wsServer.ts 的 WS 端口闸同源:同机其他用户/进程可探测到监听端口,
// token(128-bit,来自 token.ts generateToken)是唯一屏障。URL 形状
// `http://127.0.0.1:<port>/<token>/<相对 root 路径>` 把 token 编码进路径首段,方便
// <webview src> 直接指向;Referer 回退让页面内的根绝对引用(`/assets/x.css`)在
// 同源前提下也能通过——跨源 Referer / 无 Referer 一律当作鉴权失败,零信息 404。

import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { generateToken, verifyToken } from './token';

export interface PreviewServerInfo {
  root: string;
  port: number;
  token: string;
}

export interface PreviewRegistryOptions {
  /** 监听地址;必须是 loopback(127.0.0.1 / ::1 / localhost),否则抛错。默认 '127.0.0.1'。 */
  host?: string;
  /** 同时存活的预览 server 上限;超限按 lastUsedAt 关最旧(LRU)。默认 16。 */
  maxServers?: number;
  /** 日志汇(默认 console.warn);token 明文绝不入日志。 */
  logger?: (line: string) => void;
  /** 测试注入的 token 生成器;默认 token.ts 的 generateToken。 */
  makeToken?: () => string;
}

export interface PreviewRegistry {
  /** 懒启动/幂等:同一 root(realpath 后)复用同一 {root,port,token},刷新 lastUsedAt。
   *  root 非目录(或不存在)→ reject。 */
  ensure(rootPath: string): Promise<PreviewServerInfo>;
  /** 关闭该 root 对应的 server 并摘表;返回是否真的关了一个(不存在 → false)。 */
  stop(rootPath: string): Promise<boolean>;
  /** 关闭全部 server。 */
  stopAll(): Promise<void>;
  /** 当前存活的全部预览 server 快照(顺序 = Map 插入序)。 */
  list(): PreviewServerInfo[];
}

// ---- loopback 守卫(复刻 wsServer.ts 同名先例) ------------------------------
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

// ---- 鉴权失败滑动窗告警(复刻 wsServer.ts 的 shouldAlert 同参实现;不直接 import
// wsServer.ts —— 那会把 'ws' 包牵进本文件的依赖面,违反「静态服务零第三方」)。-----
const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_ALERT = 10;
const AUTH_FAIL_ALERT_COOLDOWN_MS = AUTH_FAIL_WINDOW_MS;

/** 纯函数,与 wsServer.ts 同签名同语义:同一冷却窗内至多一次,跨窗口可重新告警。 */
function shouldAlert(
  now: number,
  lastAlertAt: number,
  countInWindow: number,
  threshold: number,
  cooldownMs: number,
): boolean {
  return countInWindow >= threshold && now - lastAlertAt >= cooldownMs;
}

// ---- MIME 白名单(设计定稿表;未命中一律 application/octet-stream)------------
const MIME_MAP: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  csv: 'text/csv',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export function mimeFor(fileName: string): string {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * host 头(Host: 127.0.0.1:1234 / [::1]:1234 / localhost:1234)是否指向本预览 server 的
 * loopback 地址与端口。缺失/非 loopback 主机名/端口不匹配 → false。
 */
export function isLoopbackHostHeader(host: string | undefined, port: number): boolean {
  if (!host) return false;
  let hostname: string;
  let portStr: string | undefined;
  if (host.startsWith('[')) {
    const closeIdx = host.indexOf(']');
    if (closeIdx === -1) return false;
    hostname = host.slice(1, closeIdx);
    const rest = host.slice(closeIdx + 1);
    if (rest.startsWith(':')) portStr = rest.slice(1);
    else if (rest !== '') return false;
  } else {
    const idx = host.lastIndexOf(':');
    if (idx === -1) {
      hostname = host;
    } else {
      hostname = host.slice(0, idx);
      portStr = host.slice(idx + 1);
    }
  }
  if (!LOOPBACK_HOSTS.has(hostname.toLowerCase())) return false;
  if (portStr === undefined || portStr === '') return false;
  const portNum = Number(portStr);
  return Number.isInteger(portNum) && portNum === port;
}

export type ParsePreviewUrlPathResult =
  | { ok: true; token: string; segments: string[] }
  | { ok: false; reason: 'empty' | 'bad-encoding' | 'traversal' | 'dotfile' };

/**
 * urlPath = 请求 pathname(不含 query,调用方先剥离)。约定形状 `/<token>/<a>/<b>/...`;
 * 纯字符串解析,不碰文件系统。逐段(先按裸 '/' split,再逐段 decodeURIComponent)校验:
 * 中间空段(双斜杠)/ '.' / '..' / NUL / 解码后含正反斜杠 → traversal;解码失败 →
 * bad-encoding;整段路径为空(""/"/") → empty;**任意段以 '.' 开头(dotfile,如
 * `.git`/`.env`/`.ssh`/`.well-known`)→ dotfile**——预览场景对 dotfile 无正当访问需求,
 * 对齐 `http-server --dotfiles deny` 的默认策略,宁可误拒 `.well-known` 也不放行
 * `.git/config`/`.env` 等敏感目录。此校验同样覆盖 token 段本身,但 token 恒为
 * generateToken() 产出的 base64url(字母数字/-/_),永不以 '.' 开头,故不影响合法请求。
 * **末尾空段(尾斜杠)容忍并丢弃**——目录 URL 的尾斜杠合法,由请求流水线另行判断
 * (pathname.endsWith('/'))。
 */
export function parsePreviewUrlPath(urlPath: string): ParsePreviewUrlPathResult {
  if (!urlPath.startsWith('/')) return { ok: false, reason: 'empty' };
  const rest = urlPath.slice(1);
  if (rest === '') return { ok: false, reason: 'empty' };
  const raw = rest.split('/');
  const decoded: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i];
    const isLast = i === raw.length - 1;
    if (seg === '') {
      if (isLast) continue; // 尾斜杠:丢弃,不算错误
      return { ok: false, reason: 'traversal' }; // 中间空段(如 //)
    }
    let d: string;
    try {
      d = decodeURIComponent(seg);
    } catch {
      return { ok: false, reason: 'bad-encoding' };
    }
    if (d === '' || d === '.' || d === '..') return { ok: false, reason: 'traversal' };
    if (d.includes('\0') || d.includes('/') || d.includes('\\')) {
      return { ok: false, reason: 'traversal' };
    }
    if (d.startsWith('.')) return { ok: false, reason: 'dotfile' };
    decoded.push(d);
  }
  if (decoded.length === 0) return { ok: false, reason: 'empty' };
  const [token, ...segments] = decoded;
  return { ok: true, token, segments };
}

/**
 * 从 Referer 头取候选 token(根绝对引用回退用)。要求 Referer 与 selfOrigin 完全同源
 * (protocol+host+port 全等);同源则复用 parsePreviewUrlPath 解析其 pathname 首段。
 * 缺失 / 解析失败 / 跨源 → null(调用方按鉴权失败统一处理,不区分原因)。
 */
export function tokenFromReferer(referer: string | undefined, selfOrigin: string): string | null {
  if (!referer) return null;
  let refUrl: URL;
  let selfUrl: URL;
  try {
    refUrl = new URL(referer);
    selfUrl = new URL(selfOrigin);
  } catch {
    return null;
  }
  if (refUrl.origin !== selfUrl.origin) return null;
  const parsed = parsePreviewUrlPath(refUrl.pathname);
  if (!parsed.ok) return null;
  return parsed.token;
}

// =============================================================================
// 内部实现
// =============================================================================

interface ServerEntry {
  /** fs.realpath 后的绝对路径,Map 键与 containment 基准同一个字符串。 */
  root: string;
  port: number;
  token: string;
  lastUsedAt: number;
  httpServer: HttpServer;
  /** 鉴权失败定长滚动窗口(标量,非逐条时间戳数组——见 recordAuthFailure 注释)。 */
  authFailWindowStart: number;
  authFailCount: number;
  lastAlertAt: number;
  /** 非 null 表示正在/已经关闭;close() 幂等去重用。 */
  closing: Promise<void> | null;
}

type ResolveResult =
  | { kind: 'file'; path: string; stat: fs.Stats; fh: FileHandle }
  | { kind: 'directory'; path: string }
  | { kind: 'forbidden' }
  | { kind: 'not-found' };

export function createPreviewRegistry(opts: PreviewRegistryOptions = {}): PreviewRegistry {
  const host = opts.host ?? '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `[host] refusing non-loopback preview bind address: ${host} (only 127.0.0.1/::1/localhost)`,
    );
  }
  const maxServers = opts.maxServers ?? 16;
  const logger = opts.logger ?? ((line: string) => console.warn(line));
  const makeToken = opts.makeToken ?? generateToken;

  const servers = new Map<string, ServerEntry>();
  // 并发首建去重:同 key 的第二个 ensure() 复用第一个尚未落地的 Promise,不重复起 server。
  const pendingEnsures = new Map<string, Promise<ServerEntry>>();
  // stopAll() 已调用过:任何仍在途的 ensure() 落地时都直接关、不入表(见 ensure() 尾部)。
  let disposed = false;
  // stop(key) 在该 key 的 ensure() 仍悬而未决(已入 pendingEnsures,只能按 key 记标记)时
  // 调用:落地时直接关、不入表。key 落地后即从此集合摘除,不会误伤同 key 的后续 ensure。
  const pendingStops = new Set<string>();
  // ensure() 的 realpath() 本身是异步的:调用 ensure() 到它把自己登记进 pendingEnsures
  // (按 realpath 后的 key)之间存在一个真实窗口——若 stop() 恰好在这个窗口里跑完了
  // 【它自己的】realpath(),会既查不到 servers 也查不到 pendingEnsures,误判「没有要
  // 停的」而返回 false,实际那个 ensure() 落地后仍会正常起 server(泄漏)。
  // 用调用方传入的原始字符串做一个同步锚点堵住这个窗口:ensure() 的第一行就同步登记
  // (不等任何 await),stop() 在做自己的 realpath() 之前先同步查一次——只要两次调用
  // 用的是同一个字符串(实践中的主流调用形态:同一处调用点重复传同一个 root 路径),
  // 无论各自的 realpath() 谁先落地,都不会漏判。引用计数支持同字符串并发多次 ensure()。
  const inFlightRawPathCount = new Map<string, number>();
  const stopRequestedRaw = new Set<string>();

  function markRawPathStart(rootPath: string): void {
    inFlightRawPathCount.set(rootPath, (inFlightRawPathCount.get(rootPath) ?? 0) + 1);
  }
  function markRawPathEnd(rootPath: string): void {
    const n = (inFlightRawPathCount.get(rootPath) ?? 0) - 1;
    if (n <= 0) inFlightRawPathCount.delete(rootPath);
    else inFlightRawPathCount.set(rootPath, n);
  }

  function toInfo(entry: ServerEntry): PreviewServerInfo {
    return { root: entry.root, port: entry.port, token: entry.token };
  }

  /** 关一个实例并从注册表摘除。摘表是同步立即生效(list()/ensure() 马上看不到它);
   *  httpServer 的实际关闭(端口停止 accept)通过返回的 Promise 可等待。幂等。 */
  function closeEntry(entry: ServerEntry): Promise<void> {
    if (entry.closing) return entry.closing;
    servers.delete(entry.root);
    const p = new Promise<void>((resolve) => {
      entry.httpServer.close(() => resolve());
      // keep-alive 连接存活期间 close() 回调可能迟迟不触发;主动掐断存量连接,
      // 让「stop 后端口拒连」对测试/调用方都是确定性的(无连接时是 no-op)。
      entry.httpServer.closeAllConnections?.();
    });
    entry.closing = p;
    return p;
  }

  async function evictLru(): Promise<void> {
    const closes: Promise<void>[] = [];
    while (servers.size > maxServers) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, e] of servers) {
        if (e.lastUsedAt < oldestAt) {
          oldestAt = e.lastUsedAt;
          oldestKey = k;
        }
      }
      if (oldestKey === null) break;
      const victim = servers.get(oldestKey);
      if (!victim) break; // 防御:理论不可达
      closes.push(closeEntry(victim)); // closeEntry 内部同步先摘表,循环下一轮 size 已反映
    }
    await Promise.all(closes);
  }

  /**
   * 定长滚动窗口(标量:窗口起点 + 计数),非逐条时间戳数组。旧实现每次失败都
   * push 一个时间戳再 filter 整个数组;同机灌请求场景下数组长度与请求数同阶,
   * push+filter 是 O(n),洪泛 n 次请求就是 O(n²) 的 CPU/内存放大——本身就是可被
   * 利用的 DoS 面。改成两个标量后单次失败恒 O(1)。语义从「精确滑动窗」退化为
   * 「定长滚动窗」(超过窗口时长整窗重置计数为 1,而非逐条淘汰过期时间戳),但
   * 「窗口内达到阈值告警一次 + 冷却」的可观测语义不变(AUTH_FAIL_ALERT_COOLDOWN_MS
   * 恒等于 AUTH_FAIL_WINDOW_MS,两者天然对齐)。
   */
  function recordAuthFailure(entry: ServerEntry): void {
    const now = Date.now();
    if (now - entry.authFailWindowStart >= AUTH_FAIL_WINDOW_MS) {
      entry.authFailWindowStart = now;
      entry.authFailCount = 1;
    } else {
      entry.authFailCount++;
    }
    if (
      shouldAlert(
        now,
        entry.lastAlertAt,
        entry.authFailCount,
        AUTH_FAIL_ALERT,
        AUTH_FAIL_ALERT_COOLDOWN_MS,
      )
    ) {
      entry.lastAlertAt = now;
      logger(
        `[host] repeated preview auth failures (root=${entry.root}): ${entry.authFailCount} in ${AUTH_FAIL_WINDOW_MS}ms`,
      );
    }
  }

  /**
   * 词法层 + 实体层双重 containment 校验;跟随软链 stat,ENOENT→not-found,逃逸→forbidden。
   * 校验通过后若确认是常规文件,再 `open()` 一次并把同一个 FileHandle 随结果一起
   * 交回(调用方最终经 serveFile 用它 fstat+读流,恰好一次 close)——避免「校验用一次
   * stat/realpath、实际服务时 fs.createReadStream(path) 重新按路径 open 一次」之间的
   * 窗口:那个窗口里 root 内软链可被替换指向 root 外(TOCTOU),或文件内容被整体替换
   * 导致 Content-Length(取自校验时的 stat)与实际读出的字节不一致。open() 之后
   * fstat 与流读取共享同一 fd/inode,二者恒一致,无论 open 之后文件本身如何变化。
   *
   * open() 前仍先用路径 stat 判定类型(而非直接 open 后 fstat 判定):FIFO 以只读模式
   * open 会阻塞到有写端连接为止,必须在 open 之前就用 stat 挡掉,否则退化不到
   * “不当文件服务”而是直接挂死请求。目录同理不 open(没有内容要流,index.html 分支
   * 会对 index.html 本身发起单独一次 resolveTarget,走到这里时它是文件,同样 open)。
   */
  async function resolveTarget(realRoot: string, segments: string[]): Promise<ResolveResult> {
    const target = path.resolve(realRoot, ...segments);
    if (!(target === realRoot || target.startsWith(realRoot + path.sep))) {
      return { kind: 'forbidden' };
    }
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(target); // 跟随软链;仅用于类型判定,不用于 Content-Length
    } catch {
      return { kind: 'not-found' };
    }
    let realTarget: string;
    try {
      realTarget = await fs.promises.realpath(target);
    } catch {
      return { kind: 'not-found' };
    }
    if (!(realTarget === realRoot || realTarget.startsWith(realRoot + path.sep))) {
      return { kind: 'forbidden' }; // 软链逃逸
    }
    if (st.isDirectory()) return { kind: 'directory', path: target };
    if (!st.isFile()) return { kind: 'not-found' }; // FIFO/设备等:不当文件服务,防挂死

    let fh: FileHandle;
    try {
      fh = await fs.promises.open(target, 'r');
    } catch {
      return { kind: 'not-found' };
    }
    let fst: fs.Stats;
    try {
      fst = await fh.stat();
    } catch {
      await fh.close().catch(() => {});
      return { kind: 'not-found' };
    }
    if (!fst.isFile()) {
      // 类型判定 stat() 与 open() 之间被换成非常规文件(极端时序):不当文件服务。
      await fh.close().catch(() => {});
      return { kind: 'not-found' };
    }
    return { kind: 'file', path: target, stat: fst, fh };
  }

  function serveFile(
    fh: FileHandle,
    filePath: string,
    st: fs.Stats,
    method: string,
    res: ServerResponse,
  ): Promise<void> {
    return new Promise((resolve) => {
      let fhClosed = false;
      const closeFh = () => {
        if (fhClosed) return; // 幂等守卫:正常结束/出错/客户端中断三路径都可能触发
        fhClosed = true;
        void fh.close().catch(() => {
          /* 已关闭或关闭失败:无补救手段,忽略 */
        });
      };
      // resolveTarget() 的 open()/fstat() 本身是异步的:客户端完全可能在那段时间里就
      // 已经断开——此时 res 早在我们挂 'close' 监听器之前就已经 destroyed,那次事件
      // 永远等不到,fh 就会纯粹泄漏(直到 GC 才以 ERR_INVALID_STATE 的形式暴露)。进
      // Promise 时先同步补一次检查,兜住「resolveTarget 期间就已经断开」这个窗口。
      if (res.destroyed) {
        closeFh();
        resolve();
        return;
      }
      res.setHeader('Content-Type', mimeFor(filePath));
      res.setHeader('Content-Length', st.size);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Accept-Ranges', 'none');
      if (method === 'HEAD') {
        res.writeHead(200);
        res.end();
        closeFh();
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        closeFh();
        resolve();
      };
      // autoClose: false —— fd 生命周期由本函数统一管理(closeFh 幂等),不假手于流。
      const stream = fh.createReadStream({ autoClose: false });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        } else {
          res.destroy();
        }
        finish();
      });
      res.on('close', () => {
        // 客户端中断(如 webview 反复刷新):主动销毁读流 + 关 fd,防 fd 句柄累积。
        stream.destroy();
        finish();
      });
      res.on('error', () => {
        // 客户端粗暴断开(RST 等)时底层 socket 出错可能反映到 res 上;EventEmitter
        // 对无人监听的 'error' 默认抛出,不接住这里会变成未捕获异常、拖垮整个 host
        // 进程(而不只是这一条请求)。close 通常紧随其后触发,finish 是幂等的。
        stream.destroy();
        finish();
      });
      res.on('finish', finish);
      stream.pipe(res);
    });
  }

  async function handleRequest(
    entry: ServerEntry,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // 所有响应恒带(⌘S 刷新链路 + 纵深防护的一部分)。
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const method = req.method ?? '';
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      const hostHeader = req.headers.host;
      if (!isLoopbackHostHeader(hostHeader, entry.port)) {
        res.writeHead(403);
        res.end();
        return;
      }

      // selfOrigin 用请求自身的 Host 头构造(已过上面的 isLoopbackHostHeader 白名单,
      // 恒为非空 loopback hostname:entry.port),而非写死绑定地址 `host`——页面经
      // `http://localhost:<port>/...` 加载但 server 绑定 `127.0.0.1` 时,两者字符串不等,
      // 若 selfOrigin 仍固定用绑定地址,Referer 回退的同源比较会把同源请求误判跨源,
      // 根绝对引用(如 `/assets/x.css`)永远 404。
      const selfOrigin = `http://${hostHeader}`;
      // 手工剥离 query,不借道 `new URL(req.url, selfOrigin).pathname`——WHATWG URL
      // 解析会在产出 pathname 前【自动折叠字面 './..' 路径段】,那样字面量 '..' 永远
      // 到不了 parsePreviewUrlPath,穿越检测形同虚设(编码形式 %2e%2e 不受影响,但
      // 字面量该拦的也要拦)。原始 path 直喂给它,由它逐段判定。
      const rawUrl = req.url ?? '/';
      const qIdx = rawUrl.indexOf('?');
      const pathname = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx); // query 恒忽略,不参与鉴权/路径解析

      const parsed = parsePreviewUrlPath(pathname);
      let segments: string[] | null = null;
      if (parsed.ok && verifyToken(parsed.token, entry.token)) {
        segments = parsed.segments;
      } else if (parsed.ok) {
        // Referer 回退:根绝对引用(/assets/x.css)场景 —— 候选 token 来自同源 Referer
        // 的路径首段,通过后【原始请求的全路径段】(含被误判为 token 的首段)才是文件路径。
        const refererHeader = req.headers.referer;
        const referer = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;
        const refToken = tokenFromReferer(referer, selfOrigin);
        if (refToken !== null && verifyToken(refToken, entry.token)) {
          segments = [parsed.token, ...parsed.segments];
        }
      }
      if (segments === null) {
        recordAuthFailure(entry);
        res.writeHead(404);
        res.end();
        return;
      }

      // 鉴权成功即刷新 lastUsedAt:LRU 淘汰按「最近一次实际被请求」而非仅「最近一次
      // ensure() 调用」计,防止一个仍在被频繁访问的 root(早先 ensure 过一次后就再没
      // 调用 ensure,只靠 webview 里持续的资源请求驱动)被更晚 ensure 的冷 root 挤掉。
      entry.lastUsedAt = Date.now();

      // 每请求校验根仍存在:被外部删除 → 该请求 404 + 异步自关闭该实例并摘表。
      let realRootNow: string;
      try {
        realRootNow = await fs.promises.realpath(entry.root);
      } catch {
        res.writeHead(404);
        res.end();
        void closeEntry(entry);
        return;
      }

      const endsWithSlash = pathname.endsWith('/');
      const resolved = await resolveTarget(realRootNow, segments);
      if (resolved.kind === 'not-found') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (resolved.kind === 'forbidden') {
        res.writeHead(403);
        res.end();
        return;
      }
      if (resolved.kind === 'directory') {
        if (!endsWithSlash) {
          res.writeHead(301, { Location: pathname + '/' });
          res.end();
          return;
        }
        const indexResolved = await resolveTarget(realRootNow, [...segments, 'index.html']);
        if (indexResolved.kind !== 'file') {
          // 无 index.html(或它本身有问题)→ 404;永不列目录,体内不含任何条目名。
          res.writeHead(404);
          res.end();
          return;
        }
        await serveFile(indexResolved.fh, indexResolved.path, indexResolved.stat, method, res);
        return;
      }
      // resolved.kind === 'file'
      await serveFile(resolved.fh, resolved.path, resolved.stat, method, res);
    } catch (err) {
      // 单条请求异常绝不冒泡(host 一死全会话陪葬);已发头只能 destroy。
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      } else {
        res.destroy();
      }
      logger(`[host] preview request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function startEntry(realRoot: string): Promise<ServerEntry> {
    const st = await fs.promises.stat(realRoot);
    if (!st.isDirectory()) {
      throw new Error('preview root is not a directory');
    }
    const token = makeToken();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      const onStartupError = (err: Error) => reject(err);
      server.once('error', onStartupError);
      server.listen(0, host, () => {
        server.removeListener('error', onStartupError);
        resolve();
      });
    });
    const addr = server.address();
    const port = addr && typeof addr === 'object' ? addr.port : 0;
    const entry: ServerEntry = {
      root: realRoot,
      port,
      token,
      lastUsedAt: Date.now(),
      httpServer: server,
      authFailWindowStart: -Infinity,
      authFailCount: 0,
      lastAlertAt: -Infinity,
      closing: null,
    };
    server.on('request', (req, res) => {
      void handleRequest(entry, req, res).catch((err) => {
        // 双保险:handleRequest 内部已 try/catch 转 500,这里兜底防万一遗漏。
        logger(`[host] preview request handler threw unexpectedly: ${String(err)}`);
        if (!res.headersSent) {
          try {
            res.writeHead(500);
            res.end();
          } catch {
            /* 响应已不可写:忽略 */
          }
        } else {
          res.destroy();
        }
      });
    });
    server.on('error', (err) => {
      logger(`[host] preview server error (root=${realRoot}): ${err.message}`);
      void closeEntry(entry);
    });
    server.on('close', () => {
      logger(`[host] preview server closed (root=${realRoot})`);
      servers.delete(entry.root); // 幂等兜底(常规路径已在 closeEntry 里同步摘过)
    });
    return entry;
  }

  async function ensure(rootPath: string): Promise<PreviewServerInfo> {
    markRawPathStart(rootPath);
    try {
      const key = await fs.promises.realpath(rootPath);
      const existing = servers.get(key);
      if (existing) {
        existing.lastUsedAt = Date.now();
        return toInfo(existing);
      }
      let promise = pendingEnsures.get(key);
      if (!promise) {
        promise = startEntry(key);
        pendingEnsures.set(key, promise);
      }
      try {
        const entry = await promise;
        // 落地时若 registry 已整体 disposed(stopAll() 调用过)、该 key 在悬而未决期间
        // 被单独 stop() 过(pendingStops,按 realpath 后的 key),或者更早——本函数自身
        // 的 realpath() 还没落地、连 pendingEnsures 都还没登记时——就被 stop() 按原始
        // 字符串标记过(stopRequestedRaw):直接关、不入表。没有这一步的话,一个已经
        // stopAll()/stop() 过的 registry 仍会在稍后把姗姗来迟的 server 注册进表——
        // 端口悄悄重新可连,list() 悄悄冒出一条,与调用方「已经停了」的预期相悖。
        if (disposed || pendingStops.has(key) || stopRequestedRaw.has(rootPath)) {
          pendingStops.delete(key);
          stopRequestedRaw.delete(rootPath);
          await closeEntry(entry);
          return toInfo(entry);
        }
        servers.set(key, entry);
        await evictLru();
        return toInfo(entry);
      } finally {
        // 只有仍是「本轮发起」的那个 pending 才清:防止极端时序下把后起的新 pending 误清。
        if (pendingEnsures.get(key) === promise) pendingEnsures.delete(key);
      }
    } finally {
      markRawPathEnd(rootPath);
    }
  }

  async function stop(rootPath: string): Promise<boolean> {
    // 同步查一次(不等任何 await):这一刻是否有用同一个原始字符串发起、仍未落地的
    // ensure()。晚了就查不到了——ensure() 一旦跑过它自己的 realpath(),这个引用计数
    // 窗口就已经关闭,后续改由 pendingEnsures/pendingStops(按 realpath 后的 key)接手。
    const hadInFlightRaw = inFlightRawPathCount.has(rootPath);
    if (hadInFlightRaw) stopRequestedRaw.add(rootPath);
    let key: string;
    try {
      key = await fs.promises.realpath(rootPath);
    } catch {
      // root 已被外部删除:退化按字面路径尝试(常见 case:调用方传入的就是当初
      // ensure() 用过的同一个已解析路径)。
      key = rootPath;
    }
    const entry = servers.get(key);
    if (entry) {
      await closeEntry(entry);
      return true;
    }
    if (pendingEnsures.has(key)) {
      // 该 root 的 ensure() 仍悬而未决:server 还没起来,没法 closeEntry。记一个待关
      // 标记,等 ensure() 落地时直接关、不入表(见 ensure() 尾部)。stop 意图必定生效,
      // 只是生效时刻延后到落地那一刻——仍算「关了一个」。
      pendingStops.add(key);
      return true;
    }
    // 走到这里:既不在 servers,也不在 pendingEnsures——要么是真的没有,要么是命中了
    // 上面记录的 hadInFlightRaw 窗口(该 ensure() 自己的 realpath() 还没落地,尚未来得及
    // 登记进 pendingEnsures)。后一种情况下 stopRequestedRaw 已经挂好标记,落地时会被
    // ensure() 自己关掉——这次 stop() 调用的意图必定生效,如实返回 true。
    return hadInFlightRaw;
  }

  async function stopAll(): Promise<void> {
    disposed = true;
    await Promise.all(Array.from(servers.values()).map((e) => closeEntry(e)));
  }

  function list(): PreviewServerInfo[] {
    return Array.from(servers.values()).map(toInfo);
  }

  return { ensure, stop, stopAll, list };
}
