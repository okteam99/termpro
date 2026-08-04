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
  | { ok: false; reason: 'empty' | 'bad-encoding' | 'traversal' };

/**
 * urlPath = 请求 pathname(不含 query,调用方先剥离)。约定形状 `/<token>/<a>/<b>/...`;
 * 纯字符串解析,不碰文件系统。逐段(先按裸 '/' split,再逐段 decodeURIComponent)校验:
 * 中间空段(双斜杠)/ '.' / '..' / NUL / 解码后含正反斜杠 → traversal;解码失败 →
 * bad-encoding;整段路径为空(""/"/") → empty。**末尾空段(尾斜杠)容忍并丢弃**——
 * 目录 URL 的尾斜杠合法,由请求流水线另行判断(pathname.endsWith('/'))。
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
  authFailures: number[];
  lastAlertAt: number;
  /** 非 null 表示正在/已经关闭;close() 幂等去重用。 */
  closing: Promise<void> | null;
}

type ResolveResult =
  | { kind: 'file'; path: string; stat: fs.Stats }
  | { kind: 'directory'; path: string }
  | { kind: 'forbidden' }
  | { kind: 'not-found' };

function hostForUrl(host: string): string {
  // IPv6 字面量需要方括号包裹才是合法 URL host(实践中 host 恒为默认值 127.0.0.1,
  // 此处只是让 selfOrigin 构造对 ::1 等取值同样正确)。
  return host.includes(':') ? `[${host}]` : host;
}

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

  function recordAuthFailure(entry: ServerEntry): void {
    const now = Date.now();
    entry.authFailures.push(now);
    entry.authFailures = entry.authFailures.filter((t) => now - t < AUTH_FAIL_WINDOW_MS);
    if (
      shouldAlert(
        now,
        entry.lastAlertAt,
        entry.authFailures.length,
        AUTH_FAIL_ALERT,
        AUTH_FAIL_ALERT_COOLDOWN_MS,
      )
    ) {
      entry.lastAlertAt = now;
      logger(
        `[host] repeated preview auth failures (root=${entry.root}): ${entry.authFailures.length} in ${AUTH_FAIL_WINDOW_MS}ms`,
      );
    }
  }

  /** 词法层 + 实体层双重 containment 校验;跟随软链 stat,ENOENT→not-found,逃逸→forbidden。 */
  async function resolveTarget(realRoot: string, segments: string[]): Promise<ResolveResult> {
    const target = path.resolve(realRoot, ...segments);
    if (!(target === realRoot || target.startsWith(realRoot + path.sep))) {
      return { kind: 'forbidden' };
    }
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(target); // 跟随软链
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
    if (st.isFile()) return { kind: 'file', path: target, stat: st };
    return { kind: 'not-found' }; // FIFO/设备等:不当文件服务,防 createReadStream 挂死
  }

  function serveFile(
    filePath: string,
    st: fs.Stats,
    method: string,
    res: ServerResponse,
  ): Promise<void> {
    return new Promise((resolve) => {
      res.setHeader('Content-Type', mimeFor(filePath));
      res.setHeader('Content-Length', st.size);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Accept-Ranges', 'none');
      if (method === 'HEAD') {
        res.writeHead(200);
        res.end();
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        } else {
          res.destroy();
        }
        finish();
      });
      res.on('close', finish);
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
      if (!isLoopbackHostHeader(req.headers.host, entry.port)) {
        res.writeHead(403);
        res.end();
        return;
      }

      const selfOrigin = `http://${hostForUrl(host)}:${entry.port}`;
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
        await serveFile(indexResolved.path, indexResolved.stat, method, res);
        return;
      }
      // resolved.kind === 'file'
      await serveFile(resolved.path, resolved.stat, method, res);
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
      authFailures: [],
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
      servers.set(key, entry);
      await evictLru();
      return toInfo(entry);
    } finally {
      // 只有仍是「本轮发起」的那个 pending 才清:防止极端时序下把后起的新 pending 误清。
      if (pendingEnsures.get(key) === promise) pendingEnsures.delete(key);
    }
  }

  async function stop(rootPath: string): Promise<boolean> {
    let key: string;
    try {
      key = await fs.promises.realpath(rootPath);
    } catch {
      // root 已被外部删除:退化按字面路径尝试(常见 case:调用方传入的就是当初
      // ensure() 用过的同一个已解析路径)。
      key = rootPath;
    }
    const entry = servers.get(key);
    if (!entry) return false;
    await closeEntry(entry);
    return true;
  }

  async function stopAll(): Promise<void> {
    await Promise.all(Array.from(servers.values()).map((e) => closeEntry(e)));
  }

  function list(): PreviewServerInfo[] {
    return Array.from(servers.values()).map(toInfo);
  }

  return { ensure, stop, stopAll, list };
}
