// CDP(Chrome DevTools Protocol)最小客户端:裸 ws + JSON,零新依赖
// (ws 已随 host bundle 打进 host.js,见 vite.host.config.ts)。
//
// 为什么不用 puppeteer:host bundle 是随 SSH 部署到远端的**单文件** host.js,
// 体积与依赖面都要克制;而我们只需要 CDP 的一个薄切片(Target/Page/Runtime/Input),
// puppeteer 那层 API 糖换来的是几十 MB 依赖和一个自带浏览器下载器。
//
// 传输注入(CdpTransport):单测喂假传输即可驱动全部逻辑,不必真起 Chromium
// (同 heartbeat.ts 的计时器 seam 惯例)。
//
// 🔴 挂起即毒:每个 send 都有 deadline,连接关闭立即拒绝全部在途调用。
// 远端 Chromium 崩溃/被 OOM killer 干掉时,若不主动拒绝,调用方(agent 的 MCP 工具)
// 会吊死到自己的超时——本项目在 RPC 层反复踩过这个坑(见 hostClient rejectPending)。

import { WebSocket } from 'ws';

/** 单次 CDP 调用的默认超时。导航/等待类可 per-call 放宽。 */
export const CDP_DEFAULT_TIMEOUT_MS = 30_000;

export interface CdpTransport {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: (reason: string) => void): void;
}

export type CdpTransportFactory = (url: string) => Promise<CdpTransport>;

/** CDP 事件:params 形状按 method 而定,调用方自行窄化。 */
export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  /** flatten 模式下带 sessionId = 该事件属于某个 attach 的 target(标签) */
  sessionId?: string;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'CdpError';
  }
}

/** ws 默认传输:连接 open 后才 resolve(未 open 就 send 会抛)。 */
export const wsCdpTransport: CdpTransportFactory = (url) =>
  new Promise<CdpTransport>((resolve, reject) => {
    // CDP 帧可以很大(Page.captureScreenshot 的 base64、getHtml 的整页 DOM),
    // 默认 maxPayload 会把大页面直接判成协议错误 → 连接被撕掉。
    const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
    const onOpenError = (err: Error) => reject(err);
    ws.once('error', onOpenError);
    ws.once('open', () => {
      ws.off('error', onOpenError);
      resolve({
        send: (data) => ws.send(data),
        close: () => ws.close(),
        onMessage: (cb) =>
          ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
            cb(
              Array.isArray(raw)
                ? Buffer.concat(raw).toString('utf8')
                : Buffer.from(raw as ArrayBuffer).toString('utf8'),
            );
          }),
        onClose: (cb) => {
          ws.on('close', () => cb('cdp connection closed'));
          // open 之后的 error 一律当断连处理(ws 在 error 后必发 close,但不保证顺序)
          ws.on('error', (err: Error) => cb(err.message));
        },
      });
    });
  });

/**
 * 一条 CDP 连接(browser 级 endpoint)。标签用 flatten 模式的 sessionId 复用同一条连接——
 * 每个标签单开一条 ws 在远端会随标签数线性膨胀,且 Chromium 侧 fd 也跟着涨。
 */
export class CdpConnection {
  private seq = 0;
  private readonly pending = new Map<number, PendingCall>();
  private readonly handlers = new Map<string, Set<(e: CdpEvent) => void>>();
  private closedReason: string | null = null;

  private constructor(
    private readonly transport: CdpTransport,
    private readonly defaultTimeoutMs: number,
  ) {}

  static async open(
    url: string,
    opts?: {
      transportFactory?: CdpTransportFactory;
      defaultTimeoutMs?: number;
    },
  ): Promise<CdpConnection> {
    const factory = opts?.transportFactory ?? wsCdpTransport;
    const transport = await factory(url);
    const conn = new CdpConnection(
      transport,
      opts?.defaultTimeoutMs ?? CDP_DEFAULT_TIMEOUT_MS,
    );
    transport.onMessage((data) => conn.handleMessage(data));
    transport.onClose((reason) => conn.handleClose(reason));
    return conn;
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  /**
   * 发一次 CDP 调用。sessionId 省略 = browser 级(Target.* / Browser.*);
   * 带 sessionId = 打到某个 attach 的标签(Page.* / Runtime.* / Input.*)。
   */
  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<T> {
    if (this.closedReason) {
      return Promise.reject(new CdpError(this.closedReason));
    }
    const id = ++this.seq;
    const payload = JSON.stringify({
      id,
      method,
      ...(params ? { params } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`cdp timeout: ${method}`));
      }, timeoutMs ?? this.defaultTimeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      try {
        this.transport.send(payload);
      } catch (err) {
        const call = this.pending.get(id);
        if (call) {
          clearTimeout(call.timer);
          this.pending.delete(id);
        }
        reject(
          new CdpError(err instanceof Error ? err.message : 'cdp send failed'),
        );
      }
    });
  }

  /** 订阅某个 CDP 事件(如 'Page.screencastFrame');返回退订函数。 */
  on(method: string, cb: (e: CdpEvent) => void): () => void {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(cb);
    return () => {
      const current = this.handlers.get(method);
      current?.delete(cb);
      if (current && current.size === 0) this.handlers.delete(method);
    };
  }

  close(): void {
    this.handleClose('cdp connection closed by host');
    try {
      this.transport.close();
    } catch {
      // 已经断了就算了:close 是收尾路径,不该再抛
    }
  }

  private handleMessage(data: string): void {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message?: string; code?: number };
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    };
    try {
      msg = JSON.parse(data);
    } catch {
      // 畸形帧不该拖垮连接(同 wsServer 的畸形帧口径):丢弃即可
      return;
    }
    if (typeof msg.id === 'number') {
      const call = this.pending.get(msg.id);
      if (!call) return; // 迟到响应(本地已超时)——超时那侧已 reject,这里丢弃
      clearTimeout(call.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        call.reject(
          new CdpError(msg.error.message ?? 'cdp error', msg.error.code),
        );
      } else {
        call.resolve(msg.result);
      }
      return;
    }
    if (typeof msg.method === 'string') {
      const event: CdpEvent = {
        method: msg.method,
        params: msg.params ?? {},
        ...(msg.sessionId ? { sessionId: msg.sessionId } : {}),
      };
      for (const cb of this.handlers.get(msg.method) ?? []) {
        try {
          cb(event);
        } catch {
          // 一个订阅者抛错不该影响其他订阅者与连接本身
        }
      }
    }
  }

  private handleClose(reason: string): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      this.pending.delete(id);
      call.reject(new CdpError(reason));
    }
    this.handlers.clear();
  }
}
