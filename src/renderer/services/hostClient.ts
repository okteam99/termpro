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
import { Heartbeat, readHeartbeatEnv } from './heartbeat';

export interface PtyListener {
  onData?(data: string, bytes: number): void;
  onExit?(exitCode: number): void;
  onTitle?(processName: string): void;
  /** 本端订阅被 exclusive attach 摘除(另一设备独占接管 · M2);会话仍活,可重新 mirror attach 取回。 */
  onTakenover?(): void;
  /** 本端落后超 desync 阈值被剔出增量流(M2);应立即 mirror re-attach 全量重同步。 */
  onDesynced?(): void;
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
    // 🔴 主动关闭先摘 onclose:浏览器 ws.close() 的 close 事件是**异步**派发的,
    // dispose/reconnect 的 tearingDown 同步窗口罩不住迟到事件——不摘则用户主动断开后,
    // 迟到的 onclose 误入 handleTransportClose 的 reconnectable 分叉 → reconnectNeeded
    // → 自动重连,违背「保持断开」。远端异常断链(非本方法触发)不受影响,onclose 仍在。
    this.ws.onclose = null;
    this.ws.close();
  }
}

export class HostClient {
  private transport: Transport | null = null;
  private connectPromise: Promise<HostInfo> | null = null;
  // 断线重连的并发再入守卫(BL-005 · ARCH-B-2):手动「立即重试」+ 退避循环可能同时触发
  // reconnect;in-flight 复用同一 promise,不重复开 ws。
  private reconnectPromise: Promise<HostInfo> | null = null;
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
  // BL-005:远程 client(reconnectable)transport 断开/心跳判死 → 非终结,触发重连编排。
  private reconnectNeededListeners = new Set<() => void>();
  // 心跳探活往返耗时(ms)订阅者(组头连接延迟展示;仅 reconnectable client 产生数据)
  private rttListeners = new Set<(ms: number) => void>();
  // 主动 teardown(reconnect/dispose 内 close 旧 transport)期间抑制自身 onClose 分叉,防 loop。
  private tearingDown = false;
  private heartbeat: Heartbeat | null = null;
  // 握手期(connect 发起 → host.info 响应落地)。host 侧 ws 门控要求 host.info-first:
  // 响应回来前任何插话都会被判违规断连(wsServer TC-A05)。ws open 后 transport 即非空,
  // 若不设此闸,握手窗口内消费方 rpc/post 会直接上线,高延迟链路(SSH 隧道合帧)下
  // 恰好撞进门控 → 连接被 host 掐死 → 挂起 RPC 吊满 15s 超时(m-sg fs.readdir 案)。
  private handshaking = false;

  /**
   * reconnectable(BL-005 · AC-10):远程 client 置 true —— transport onClose / 心跳判死走
   * 「触发重连(非终结)」分叉;本地嵌入式 client 保持 false —— onClose = markDown 终结(进程真死)。
   */
  readonly reconnectable: boolean;

  info: HostInfo | null = null;

  constructor(opts?: { reconnectable?: boolean }) {
    this.reconnectable = opts?.reconnectable ?? false;
    // main 广播 host 进程退出 → 拒绝所有挂起调用,通知 UI。
    // 守卫 window 缺失(node 环境单测导入 store→hostClient 时不崩)。
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.t === 'host:down') this.markDown();
      });
    }
  }

  /**
   * 订阅「需要重连」信号(BL-005 · 仅 reconnectable client 触发):远程 transport onClose 或
   * app 层心跳判死时触发。reconnectController 订此驱动 disconnect-first→connect 编排。
   */
  onReconnectNeeded(cb: () => void): () => void {
    this.reconnectNeededListeners.add(cb);
    return () => {
      this.reconnectNeededListeners.delete(cb);
    };
  }

  /** 订阅心跳探活 RTT(ms;每拍成功回调一次·仅 reconnectable client),返回退订函数。 */
  onRtt(cb: (ms: number) => void): () => void {
    this.rttListeners.add(cb);
    return () => {
      this.rttListeners.delete(cb);
    };
  }

  /**
   * 该 host 是否支持断线重连回放收养(BL-005 · QA-14 稳定信号 = 能力位存在性)。
   * host.info.capabilities 含 'session.resume' → 支持 session.list/attach;旧 host 省略 → false,
   * 收养退化 new spawn(不发 list/attach)。
   */
  supportsSessionResume(): boolean {
    return this.info?.capabilities?.includes('session.resume') ?? false;
  }

  /**
   * 该 host 是否支持多订阅镜像(M2 · 稳定信号 = 能力位存在性,同 QA-14 惯例)。
   * 含 'session.mirror' → session.attach 默认带 mode:'mirror'(多端同屏);
   * 旧 host 省略 → false,attach 不带 mode(host 侧按 exclusive,零破坏)。
   */
  supportsSessionMirror(): boolean {
    return this.info?.capabilities?.includes('session.mirror') ?? false;
  }

  /** 远端 Host 是否支持受限临时 PNG RPC;旧长期驻留 Host 缺能力位时不得盲发 unknown RPC。 */
  supportsTempPng(): boolean {
    return this.info?.capabilities?.includes('fs.temp-png') ?? false;
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
    this.rejectPending('host process exited');
    this.downListeners.forEach((cb) => cb());
  }

  /** 拒绝全部挂起 RPC(断链/teardown 时调用):快速失败,绝不留到 15s rpc timeout。 */
  private rejectPending(message: string): void {
    for (const p of this.pending.values()) {
      p.reject(new Error(message));
    }
    this.pending.clear();
  }

  /**
   * transport onClose 分叉(BL-005 · AC-10):
   * - reconnectable(远程):非终结 → 停心跳 + 通知 reconnectNeeded(不置 down·不永久拒 rpc);
   * - 否则(本地嵌入式):markDown 终结(进程真死·现语义)。
   * tearingDown 期(reconnect/dispose 主动关旧 transport)直接忽略,防自触发 loop。
   */
  private handleTransportClose(): void {
    if (this.tearingDown) return;
    if (this.reconnectable) {
      this.stopHeartbeat();
      // 🔴 挂起 RPC 立即拒绝(非终结·down 不置):响应已随连接死亡,不拒则调用方
      // 吊满 RPC_TIMEOUT 才收到「rpc timeout」——错误面目全非且慢 15s(m-sg 案)。
      this.rejectPending('host connection lost');
      this.reconnectNeededListeners.forEach((cb) => cb());
    } else {
      this.markDown();
    }
  }

  private startHeartbeat(): void {
    if (!this.reconnectable || this.heartbeat) return;
    this.heartbeat = new Heartbeat(readHeartbeatEnv(), {
      probe: () => this.rpc('host.info', undefined),
      onDead: () => this.handleHeartbeatDead(),
      onAlive: (ms) => this.rttListeners.forEach((cb) => cb(ms)),
    });
    this.heartbeat.start();
  }

  private stopHeartbeat(): void {
    this.heartbeat?.stop();
    this.heartbeat = null;
  }

  /** 心跳判死(AC-13):等同 transport 断开的远程分叉 —— 触发重连编排(非终结)。 */
  private handleHeartbeatDead(): void {
    this.stopHeartbeat();
    this.reconnectNeededListeners.forEach((cb) => cb());
  }

  /**
   * opts.wsUrl 存在 → 走 connectViaWebSocket(opts.wsUrl)(远程 per-host 客户端 · SSH-6);
   * 否则现状分支一字不变:dev 开关 VITE_TERMPRO_REMOTE_WS → WS,缺省 → MessagePort。
   * 🔴 本地单例调用 connect() 不传参,行为零变化(40+ 消费方兼容)。
   */
  connect(opts?: { wsUrl?: string }): Promise<HostInfo> {
    if (this.connectPromise) return this.connectPromise;
    const wsUrl = opts?.wsUrl ?? readRemoteWsEnv();
    this.handshaking = true;
    const p = wsUrl
      ? this.connectViaWebSocket(wsUrl)
      : this.connectViaMessagePort();
    this.connectPromise = p;
    // 开闸/清缓存都做 promise 同一性守卫:reconnect() 可能在 p 未落定时顶掉 connectPromise
    // 开新握手,旧 p 迟到的落定不得动新握手的闸与缓存。开闸注册先于任何消费方 rpc 链
    // (它们在 connect 返回后才 .then 上来),重入回调运行时恒见 handshaking=false,不死循环。
    p.then(
      () => {
        if (this.connectPromise === p) this.handshaking = false;
      },
      () => {
        // 失败不缓存,允许重试
        if (this.connectPromise === p) {
          this.handshaking = false;
          this.connectPromise = null;
        }
      },
    );
    // 远程 client 连上后启动 app 层心跳(冻结 TCP 下比 onclose 更快判死·AC-13)
    if (this.reconnectable) {
      this.connectPromise.then(
        () => this.startHeartbeat(),
        () => undefined,
      );
    }
    return this.connectPromise;
  }

  /**
   * 显式重连(BL-005 · AC-10):区别于 dispose——复位握手态(down/connectPromise)、关旧 transport、
   * 重开新 transport,但**保留 per-host 结构**(sessionListeners/workspaceListeners/fsListeners/
   * downListeners/reconnectNeededListeners 不清)。单一入口兼容初次/重连:初次 connectPromise=null 时
   * 复位是 no-op 等价 connect(硬门④ call site 收敛·beginHandshake 亦改调本方法)。
   * 🔴 并发再入守卫:in-flight 复用同一 promise(手动立即重试 + 退避循环同时触发时不重复开 ws)。
   */
  reconnect(opts?: { wsUrl?: string }): Promise<HostInfo> {
    if (this.reconnectPromise) return this.reconnectPromise;
    // 关旧 transport 但抑制其 onClose 分叉(否则又触发一次 reconnectNeeded → loop)
    this.tearingDown = true;
    this.stopHeartbeat();
    try {
      this.transport?.close();
    } catch {
      /* 旧 transport 可能已死 */
    }
    this.transport = null;
    this.tearingDown = false;
    // tearingDown 抑制了 onClose 分叉 → 挂起 RPC 不会被 handleTransportClose 拒绝,这里补上
    this.rejectPending('host connection lost');
    // 复位陈旧握手态(connectPromise 陈旧早返是复用实例重连卡死的根因·硬门④)
    this.down = false;
    this.connectPromise = null;
    const p = this.connect(opts);
    this.reconnectPromise = p;
    const clear = (): void => {
      if (this.reconnectPromise === p) this.reconnectPromise = null;
    };
    p.then(clear, clear);
    return p;
  }

  /**
   * 关闭 transport 并清空握手态(hostRegistry.drop 用 · 远程客户端下线)。
   * 🔴 transport.close() 会触发 onClose→markDown()(down=true 生效);此处随即复位,
   * 否则同一实例(理论上)重新 connect() 后,新 transport 打通的 rpc() 仍会被旧 down 态
   * 误判为「host 已退出」而拒绝(与「dispose 后重连」的调用方期望不符)。
   */
  dispose(): void {
    this.tearingDown = true;
    this.stopHeartbeat();
    this.transport?.close();
    this.transport = null;
    this.connectPromise = null;
    this.reconnectPromise = null;
    this.down = false;
    this.tearingDown = false;
    this.handshaking = false;
    this.rejectPending('host connection lost');
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
    // 握手期入闸:host.info(握手本身)放行,其余排队到握手落定后重入。
    // 若不闸,ws open 之后 host.info 响应之前的消费方 RPC 会撞 host 的 host.info-first
    // 门控被断连;握手失败则以 connect 的真实错误拒绝(而非 15s 后的 rpc timeout)。
    if (this.handshaking && method !== 'host.info') {
      const cp = this.connectPromise;
      if (cp) {
        return cp.then(() => this.rpc(method, params));
      }
    }
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
    // 握手期丢弃(与 transport 未建时的静默丢弃同语义):pty input/resize/ack 插话
    // 同样会撞 host.info-first 门控;resize 丢失由重连后 session.attach 带 cols/rows 纠正。
    if (this.handshaking) return;
    this.transport?.send(msg);
  }

  private attachTransport(transport: Transport): void {
    this.transport = transport;
    transport.onMessage((msg) => this.handle(msg));
    transport.onClose(() => this.handleTransportClose());
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
      case 'session:takenover':
        // 🔴 不删 listener/不清 buffer(区别于 pty:exit):会话在 host 仍活,本端只是
        // 被摘订阅;重新 mirror attach 即恢复(terminalRegistry 侧处理)。
        this.ptyListeners.get(msg.sessionId)?.onTakenover?.();
        break;
      case 'session:desynced':
        this.ptyListeners.get(msg.sessionId)?.onDesynced?.();
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
