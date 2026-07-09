// HostService 的渲染层客户端:RPC、事件、PTY 流分发与流控回执。
// 这是 UI 访问工程数据(fs/pty/git)的唯一通道(README §5)。
//
// 传输抽象:Transport 接口两实现 —— MessagePortTransport(嵌入式,默认,行为等价现状)
// 与 WebSocketTransport(standalone/远程,dev 开关 VITE_TERMPRO_REMOTE_WS)。公共 API
// (connect/rpc/attachPty/input/resize/ack/onDown/onFsChanged/onSessionEvent/info)签名不变。

import {
  ClientMessage,
  HostInfo,
  HostMessage,
  RpcMethodName,
  RpcMethods,
  SessionEvent,
  WorkspaceEntry,
} from '../../shared/protocol';
import {
  checkHostInfoCompatible,
  ProtocolIncompatibleError,
} from '../../shared/versionCompat';

export interface PtyListener {
  onData?(data: string, bytes: number): void;
  onExit?(exitCode: number): void;
  onTitle?(processName: string): void;
}

const RPC_TIMEOUT_MS = 15_000;

/** 传输契约:嵌入式 MessagePort 与 standalone WebSocket 两实现。 */
export interface Transport {
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: HostMessage) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** 嵌入式:包 Electron MessagePort,行为等价现状(无版本/token 门控)。 */
export class MessagePortTransport implements Transport {
  constructor(private port: MessagePort) {}
  send(msg: ClientMessage): void {
    this.port.postMessage(msg);
  }
  onMessage(cb: (msg: HostMessage) => void): void {
    this.port.onmessage = (e: MessageEvent) => cb(e.data as HostMessage);
  }
  onClose(_cb: () => void): void {
    // MessagePort 无 close 事件;嵌入式 host 退出经 window 'host:down' 广播(见构造函数)
  }
  close(): void {
    this.port.close();
  }
}

/** standalone/远程:包浏览器原生 WebSocket,JSON 文本帧承载既有消息形状。 */
export class WebSocketTransport implements Transport {
  constructor(private ws: WebSocket) {}
  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }
  onMessage(cb: (msg: HostMessage) => void): void {
    this.ws.onmessage = (e: MessageEvent) => {
      cb(JSON.parse(e.data as string) as HostMessage);
    };
  }
  onClose(cb: () => void): void {
    this.ws.onclose = () => cb();
  }
  close(): void {
    this.ws.close();
  }
}

export class HostClient {
  private transport: Transport | null = null;
  private connectPromise: Promise<HostInfo> | null = null;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private ptyListeners = new Map<string, PtyListener>();
  // 监听者尚未挂上时缓存输出(不 ack,host 水位自然暂停,挂上后回放)
  private bufferedData = new Map<string, { data: string; bytes: number }[]>();
  private down = false;
  private downListeners = new Set<() => void>();
  private fsListeners = new Set<(watchId: number) => void>();
  private sessionListeners = new Set<
    (sessionId: string, event: SessionEvent) => void
  >();
  private workspaceListeners = new Set<(workspaces: WorkspaceEntry[]) => void>();

  info: HostInfo | null = null;

  constructor() {
    // main 广播 host 进程退出 → 拒绝所有挂起调用,通知 UI。
    // 守卫 window 缺失(node 环境单测导入 store→hostClient 时不崩)。
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.t === 'host:down') this.markDown();
      });
    }
  }

  /** 订阅 host 进程退出事件,返回退订函数 */
  onDown(cb: () => void): () => void {
    this.downListeners.add(cb);
    return () => {
      this.downListeners.delete(cb);
    };
  }

  /** 订阅 fs.watch 变化事件(按 watchId 自行过滤),返回退订函数 */
  onFsChanged(cb: (watchId: number) => void): () => void {
    this.fsListeners.add(cb);
    return () => {
      this.fsListeners.delete(cb);
    };
  }

  /** 订阅会话状态事件(host 状态机产出),返回退订函数 */
  onSessionEvent(
    cb: (sessionId: string, event: SessionEvent) => void,
  ): () => void {
    this.sessionListeners.add(cb);
    return () => {
      this.sessionListeners.delete(cb);
    };
  }

  /** 订阅注册表变更(全量快照),返回退订函数 */
  onWorkspaceChanged(cb: (workspaces: WorkspaceEntry[]) => void): () => void {
    this.workspaceListeners.add(cb);
    return () => {
      this.workspaceListeners.delete(cb);
    };
  }

  private markDown(): void {
    if (this.down) return;
    this.down = true;
    for (const p of this.pending.values()) {
      p.reject(new Error('host process exited'));
    }
    this.pending.clear();
    this.downListeners.forEach((cb) => cb());
  }

  connect(): Promise<HostInfo> {
    if (this.connectPromise) return this.connectPromise;
    // dev 开关:VITE_TERMPRO_REMOTE_WS = 完整 ws://127.0.0.1:<port>?token=… → 走 WS;
    // 缺省(嵌入式)恒走 MessagePort,分支逻辑不变。
    const remoteWs = readRemoteWsEnv();
    this.connectPromise = remoteWs
      ? this.connectViaWebSocket(remoteWs)
      : this.connectViaMessagePort();
    // 失败不缓存,允许重试
    this.connectPromise.catch(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private connectViaMessagePort(): Promise<HostInfo> {
    return new Promise<HostInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('host port timeout'));
      }, 10_000);
      const onMsg = (e: MessageEvent) => {
        if (e.data?.t === 'host:port' && e.ports[0]) {
          clearTimeout(timer);
          window.removeEventListener('message', onMsg);
          this.attachTransport(new MessagePortTransport(e.ports[0]));
          this.rpc('host.info', undefined).then((info) => {
            this.info = info;
            resolve(info);
          }, reject);
        }
      };
      window.addEventListener('message', onMsg);
      window.termpro.requestHostPort();
    });
  }

  private connectViaWebSocket(url: string): Promise<HostInfo> {
    return new Promise<HostInfo>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error('host ws timeout'));
      }, 10_000);
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('host ws connect failed'));
      };
      ws.onopen = () => {
        clearTimeout(timer);
        this.attachTransport(new WebSocketTransport(ws));
        // 首条 RPC 必须是 host.info(host 侧 host.info-first 门控)
        this.rpc('host.info', undefined).then((info) => {
          // 版本区间校验(客户端单方判定);不兼容 → 主动断开 + 结构化错误
          const { compatible, detail } = checkHostInfoCompatible(info);
          if (!compatible) {
            this.transport?.close();
            reject(new ProtocolIncompatibleError(detail));
            return;
          }
          this.info = info;
          resolve(info);
        }, reject);
      };
    });
  }

  rpc<M extends RpcMethodName>(
    method: M,
    params: RpcMethods[M]['params'],
  ): Promise<RpcMethods[M]['result']> {
    const transport = this.transport;
    if (!transport) return Promise.reject(new Error('host not connected'));
    if (this.down) return Promise.reject(new Error('host process exited'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          (resolve as (v: unknown) => void)(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const msg: ClientMessage = { t: 'rpc:req', id, method, params };
      transport.send(msg);
    });
  }

  attachPty(sessionId: string, listener: PtyListener): () => void {
    this.ptyListeners.set(sessionId, listener);
    const buffered = this.bufferedData.get(sessionId);
    if (buffered) {
      this.bufferedData.delete(sessionId);
      for (const chunk of buffered) listener.onData?.(chunk.data, chunk.bytes);
    }
    return () => {
      if (this.ptyListeners.get(sessionId) === listener) {
        this.ptyListeners.delete(sessionId);
      }
    };
  }

  input(sessionId: string, data: string): void {
    this.post({ t: 'pty:input', sessionId, data });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.post({ t: 'pty:resize', sessionId, cols, rows });
  }

  ack(sessionId: string, bytes: number): void {
    this.post({ t: 'pty:ack', sessionId, bytes });
  }

  private post(msg: ClientMessage): void {
    this.transport?.send(msg);
  }

  private attachTransport(transport: Transport): void {
    this.transport = transport;
    transport.onMessage((msg) => this.handle(msg));
    transport.onClose(() => this.markDown());
  }

  private handle(msg: HostMessage): void {
    switch (msg.t) {
      case 'rpc:res': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
        break;
      }
      case 'pty:data': {
        const listener = this.ptyListeners.get(msg.sessionId);
        if (listener?.onData) {
          listener.onData(msg.data, msg.bytes);
        } else {
          const q = this.bufferedData.get(msg.sessionId) ?? [];
          q.push({ data: msg.data, bytes: msg.bytes });
          this.bufferedData.set(msg.sessionId, q);
        }
        break;
      }
      case 'pty:exit':
        this.ptyListeners.get(msg.sessionId)?.onExit?.(msg.exitCode);
        this.ptyListeners.delete(msg.sessionId);
        this.bufferedData.delete(msg.sessionId);
        break;
      case 'pty:title':
        this.ptyListeners.get(msg.sessionId)?.onTitle?.(msg.processName);
        break;
      case 'fs:changed':
        this.fsListeners.forEach((cb) => cb(msg.watchId));
        break;
      case 'session:event':
        this.sessionListeners.forEach((cb) => cb(msg.sessionId, msg.event));
        break;
      case 'workspace:changed':
        this.workspaceListeners.forEach((cb) => cb(msg.workspaces));
        break;
    }
  }
}

/** dev 开关读取:VITE_TERMPRO_REMOTE_WS(build-time env),缺失/非 dev 恒空。 */
function readRemoteWsEnv(): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> })
      .env;
    const val = env?.VITE_TERMPRO_REMOTE_WS;
    return typeof val === 'string' && val.length > 0 ? val : undefined;
  } catch {
    return undefined;
  }
}

export const hostClient = new HostClient();
