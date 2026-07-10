// Standalone host 的 WebSocket 传输层:loopback 强制 + token 闸 + host.info-first
// 门控 + 心跳 + 畸形帧防护 + maxPayload。所有新增逻辑都夹在「WS 连接层」,不下沉进
// hostCore.attachClient —— 保证嵌入式 MessagePort 路径零侵入(AC-5)。
// wsPortAdapter 把 WebSocket 包成 PortLike,attachClient 完全复用。

import { createServer, IncomingMessage, Server as HttpServer } from 'node:http';
import { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { PortLike } from './hostCore';
import { verifyToken } from './token';

// ---- 常量(TECH §常量表 · 精确落定值)-------------------------------------
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const PING_INTERVAL_MS = 30_000;
export const AUTH_FAIL_WINDOW_MS = 60_000;
export const AUTH_FAIL_ALERT = 10;
/** 告警节流冷却窗(AC-9):同一冷却期内至多 emit 一次 onAuthAlert,防同机攻击刷屏。
 * 与失败滑动窗同宽(先到期的失败计数自然归零,冷却期与统计窗天然对齐)。 */
export const AUTH_FAIL_ALERT_COOLDOWN_MS = AUTH_FAIL_WINDOW_MS;
/** 32 MiB:容纳 readFileBinary 20MB 二进制 → base64 ≈ 27MB + JSON 封套。 */
export const WS_MAX_PAYLOAD = 32 * 1024 * 1024;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Origin 白名单默认值(纵深 · token 仍是主屏障):裸文件协议 / Node 客户端典型取值。 */
export const DEFAULT_ALLOWED_ORIGINS: ReadonlySet<string> = new Set(['null', 'file://']);

/**
 * 纯函数:是否该 emit 认证失败告警(AC-9)。同一冷却窗内至多一次,跨窗口可重新告警。
 * 无 IO,便于跨窗口组合单测(T-019);recordAuthFailure 用它 + 闭包持有的 lastAlertAt 驱动。
 */
export function shouldAlert(
  now: number,
  lastAlertAt: number,
  countInWindow: number,
  threshold: number,
  cooldownMs: number,
): boolean {
  return countInWindow >= threshold && now - lastAlertAt >= cooldownMs;
}

/**
 * 纯函数:Origin 是否放行(AC-10 纵深 · 防 DNS-rebinding 打回环端口)。
 * 无 Origin 头(非浏览器客户端 / verify 脚本 / Node ws 客户端默认不发)→ 恒放行,不误杀;
 * 有 Origin 头则须命中白名单。token 仍是主屏障,此仅纵深。
 */
export function checkOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}

export interface WsServerOptions {
  /** 监听地址;必须是 loopback(127.0.0.1 / ::1 / localhost),否则抛错 */
  host: string;
  /** 端口;0 = 随机(测试用) */
  port: number;
  /** 期望 token(常量时间校验的基准) */
  token: string;
  /** hostCore.attachClient —— WS 适配器接入点 */
  attachClient: (port: PortLike) => void;
  handshakeTimeoutMs?: number;
  pingIntervalMs?: number;
  maxPayload?: number;
  /** 日志汇(默认 console);token 明文绝不入日志 */
  logger?: (line: string) => void;
  /** 认证失败告警回调(测试可观测;不阻断连接) */
  onAuthAlert?: (failuresInWindow: number) => void;
  /** Origin 白名单(AC-10 纵深;token 校验通过后追加校验)。默认 DEFAULT_ALLOWED_ORIGINS。 */
  allowedOrigins?: ReadonlySet<string>;
}

export interface WsServerHandle {
  /** 实际绑定端口(port=0 时为系统分配值) */
  port: number;
  /** 绑定地址(loopback 校验用) */
  address: string;
  close(): Promise<void>;
}

type GateState = 'awaiting-first' | 'awaiting-response' | 'done';

/**
 * 把一条 WebSocket 包成 PortLike,并内嵌 host.info-first 顺序门控 + 超时 + 畸形防护。
 * attachClient 看到的是普通 PortLike,下游一无所知。
 */
function createWsPortAdapter(
  ws: WebSocket,
  opts: {
    handshakeTimeoutMs: number;
    logger: (line: string) => void;
    label: string;
  },
): PortLike {
  let msgCb: ((e: { data: unknown; ports: PortLike[] }) => void) | null = null;
  let closeCb: (() => void) | null = null;
  let gate: GateState = 'awaiting-first';
  let pendingHostInfoId: number | null = null;

  const handshakeTimer = setTimeout(() => {
    if (gate !== 'done') {
      opts.logger(`[host] ws gate: handshake timeout (${opts.label})`);
      ws.terminate();
    }
  }, opts.handshakeTimeoutMs);
  // 定时器不应阻止进程退出
  if (typeof handshakeTimer.unref === 'function') handshakeTimer.unref();

  function violation(reason: string): void {
    clearTimeout(handshakeTimer);
    opts.logger(`[host] ws gate: ${reason} (${opts.label})`);
    ws.terminate();
  }

  ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    let data: { t?: unknown; method?: unknown; id?: unknown };
    try {
      const text = Array.isArray(raw)
        ? Buffer.concat(raw).toString('utf8')
        : Buffer.from(raw as ArrayBuffer).toString('utf8');
      data = JSON.parse(text);
    } catch {
      // 畸形帧(非 JSON/截断):仅断开该发送方,host 不崩、他客户端无感(AC-7)
      opts.logger(`[host] ws malformed frame from ${opts.label}`);
      ws.terminate();
      return;
    }

    if (gate === 'done') {
      msgCb?.({ data, ports: [] });
      return;
    }
    if (gate === 'awaiting-first') {
      if (data && data.t === 'rpc:req' && data.method === 'host.info') {
        pendingHostInfoId = typeof data.id === 'number' ? data.id : null;
        gate = 'awaiting-response';
        msgCb?.({ data, ports: [] });
      } else {
        // 首条非 host.info → 断开 + 回收(不产生任何 rpc:res)
        violation('unexpected first msg');
      }
      return;
    }
    // awaiting-response:host.info 响应返回前插话 → 断开(TC-A05)
    violation('message before host.info response');
  });

  ws.on('close', () => {
    clearTimeout(handshakeTimer);
    closeCb?.();
  });

  // 防止 maxPayload 超限/协议错误冒泡成未捕获异常拖垮进程(AC-7)
  ws.on('error', (err) => {
    opts.logger(`[host] ws error from ${opts.label}: ${err.message}`);
  });

  return {
    postMessage(msg: unknown): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(msg));
      // host.info 的 rpc:res 发出后开闸,但**延迟到下一微任务**才置 done:
      // 保证与 host.info 帧在同一数据事件里管道化到达的后续帧(尚未收到响应就插话,
      // TC-A05/T-010)仍落在 awaiting-response → 触发违规断开;而正常客户端(等响应
      // 往返后才发下一条)此时微任务早已跑完,gate 已 done,正常放行。
      if (gate === 'awaiting-response') {
        const m = msg as { t?: string; id?: number };
        if (m?.t === 'rpc:res' && m.id === pendingHostInfoId) {
          queueMicrotask(() => {
            if (gate === 'awaiting-response') {
              gate = 'done';
              clearTimeout(handshakeTimer);
            }
          });
        }
      }
    },
    on(event: 'message' | 'close', listener: (...args: never[]) => void): void {
      if (event === 'message') {
        msgCb = listener as unknown as (e: {
          data: unknown;
          ports: PortLike[];
        }) => void;
      } else {
        closeCb = listener as unknown as () => void;
      }
    },
    start(): void {
      /* no-op */
    },
    close(): void {
      ws.close();
    },
  };
}

/**
 * 启动 standalone WS host。强制 loopback;手动处理 upgrade 以在 token 不过时
 * socket.destroy()(零信息,缺失/错误不可区分);通过校验后包成 PortLike 接入
 * attachClient。返回 handle(含实际端口)。
 */
export function startWsServer(opts: WsServerOptions): Promise<WsServerHandle> {
  if (!LOOPBACK_HOSTS.has(opts.host)) {
    return Promise.reject(
      new Error(
        `[host] refusing to bind non-loopback address: ${opts.host} (only 127.0.0.1/::1/localhost)`,
      ),
    );
  }

  const logger = opts.logger ?? ((line: string) => console.warn(line));
  const handshakeTimeoutMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const pingIntervalMs = opts.pingIntervalMs ?? PING_INTERVAL_MS;
  const maxPayload = opts.maxPayload ?? WS_MAX_PAYLOAD;
  const allowedOrigins = opts.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;

  const httpServer: HttpServer = createServer();
  const wss = new WebSocketServer({ noServer: true, maxPayload });

  // 认证失败滑动窗(告警 only · 不阻断 —— external CR-3:阻断会给同机攻击者
  // DoS 杠杆;真屏障是 128-bit token 熵)
  let authFailures: number[] = [];
  let lastAlertAt = -Infinity;
  let connSeq = 0;

  function recordAuthFailure(): void {
    const now = Date.now();
    authFailures.push(now);
    authFailures = authFailures.filter((t) => now - t < AUTH_FAIL_WINDOW_MS);
    if (
      shouldAlert(now, lastAlertAt, authFailures.length, AUTH_FAIL_ALERT, AUTH_FAIL_ALERT_COOLDOWN_MS)
    ) {
      lastAlertAt = now;
      logger(
        `[host] repeated ws auth failures: ${authFailures.length} in ${AUTH_FAIL_WINDOW_MS}ms`,
      );
      opts.onAuthAlert?.(authFailures.length);
    }
  }

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head) => {
    let provided: string | null = null;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      provided = url.searchParams.get('token');
    } catch {
      provided = null;
    }
    // 缺失与错误都走同一路径:socket.destroy(),不写任何响应体/reason,
    // 攻击者无法区分「token 缺失」与「token 错误」(TC-B03/B04/B05)
    if (provided === null || !verifyToken(provided, opts.token)) {
      recordAuthFailure();
      logger('[host] ws auth rejected');
      socket.destroy();
      return;
    }
    // Origin 纵深(AC-10 · token 校验之外追加):token 已是主屏障,此处只防
    // DNS-rebinding 类场景打回环端口;无 Origin 头(非浏览器客户端)恒放行,不误杀。
    if (!checkOrigin(req.headers.origin, allowedOrigins)) {
      logger('[host] ws origin rejected');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const label = `client#${++connSeq}`;
    const adapter = createWsPortAdapter(ws, {
      handshakeTimeoutMs,
      logger,
      label,
    });
    // 接入 host 核心:下游多客户端路由/归属回收完全复用
    opts.attachClient(adapter);
  });

  // ---- 心跳:isAlive 法(收到 pong 置 true,每周期前置 false,仍 false → terminate)
  const isAlive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws: WebSocket) => {
    isAlive.set(ws, true);
    ws.on('pong', () => isAlive.set(ws, true));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (isAlive.get(ws) === false) {
        // 静默断连:pong 超时 → terminate → close → attachClient 精准回收
        ws.terminate();
        continue;
      }
      isAlive.set(ws, false);
      try {
        ws.ping();
      } catch {
        /* 忽略:socket 可能正在关闭 */
      }
    }
  }, pingIntervalMs);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  return new Promise<WsServerHandle>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(opts.port, opts.host, () => {
      const addr = httpServer.address();
      const boundPort =
        addr && typeof addr === 'object' ? addr.port : opts.port;
      const boundAddr =
        addr && typeof addr === 'object' ? addr.address : opts.host;
      resolve({
        port: boundPort,
        address: boundAddr,
        close(): Promise<void> {
          clearInterval(heartbeat);
          return new Promise<void>((res) => {
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => {
              httpServer.close(() => res());
            });
          });
        },
      });
    });
  });
}
