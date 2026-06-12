// HostService 的渲染层客户端:RPC、事件、PTY 流分发与流控回执。
// 这是 UI 访问工程数据(fs/pty/git)的唯一通道(README §5)。

import {
  ClientMessage,
  HostInfo,
  HostMessage,
  RpcMethodName,
  RpcMethods,
} from '../../shared/protocol';

export interface PtyListener {
  onData?(data: string, bytes: number): void;
  onExit?(exitCode: number): void;
  onTitle?(processName: string): void;
}

class HostClient {
  private port: MessagePort | null = null;
  private connectPromise: Promise<HostInfo> | null = null;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private ptyListeners = new Map<string, PtyListener>();
  // 监听者尚未挂上时缓存输出(不 ack,host 水位自然暂停,挂上后回放)
  private bufferedData = new Map<string, { data: string; bytes: number }[]>();

  info: HostInfo | null = null;

  connect(): Promise<HostInfo> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<HostInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('host port timeout'));
      }, 10_000);
      const onMsg = (e: MessageEvent) => {
        if (e.data?.t === 'host:port' && e.ports[0]) {
          clearTimeout(timer);
          window.removeEventListener('message', onMsg);
          this.attach(e.ports[0]);
          this.rpc('host.info', undefined).then((info) => {
            this.info = info;
            resolve(info);
          }, reject);
        }
      };
      window.addEventListener('message', onMsg);
      window.termpro.requestHostPort();
    });
    return this.connectPromise;
  }

  rpc<M extends RpcMethodName>(
    method: M,
    params: RpcMethods[M]['params'],
  ): Promise<RpcMethods[M]['result']> {
    const port = this.port;
    if (!port) return Promise.reject(new Error('host not connected'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const msg: ClientMessage = { t: 'rpc:req', id, method, params };
      port.postMessage(msg);
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
    this.port?.postMessage(msg);
  }

  private attach(port: MessagePort): void {
    this.port = port;
    port.onmessage = (e) => this.handle(e.data as HostMessage);
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
    }
  }
}

export const hostClient = new HostClient();
