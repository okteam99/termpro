// 集成测试脚手架:真实 host 核心(createHostCore)+ 真实 ws 服务端(startWsServer,
// 绑 127.0.0.1:0 随机端口)+ 真实 ws 客户端。非 .test 文件,vitest 不当测试跑。
// Layer C/D/E 用它做「真实进程内 + 真实 loopback TCP 帧」的传输级验证。

import { WebSocket } from 'ws';
import { createHostCore, HostCore } from '../hostCore';
import { startWsServer, WsServerHandle } from '../wsServer';
import type { ClientMessage, HostMessage } from '../../shared/protocol';

export interface TestHostOptions {
  token?: string;
  handshakeTimeoutMs?: number;
  pingIntervalMs?: number;
  maxPayload?: number;
}

export interface TestHost {
  core: HostCore;
  handle: WsServerHandle;
  token: string;
  /** 组装带 token 的 ws URL(可覆盖 token 以模拟错误/缺失) */
  url(tokenOverride?: string | null): string;
  logs: string[];
  authAlerts: number[];
  close(): Promise<void>;
}

export async function startTestHost(
  opts: TestHostOptions = {},
): Promise<TestHost> {
  const token = opts.token ?? 'test-token-8f3a9c2e1b6d4077';
  const core = createHostCore();
  const logs: string[] = [];
  const authAlerts: number[] = [];
  const handle = await startWsServer({
    host: '127.0.0.1',
    port: 0,
    token,
    attachClient: (p) => core.attachClient(p),
    handshakeTimeoutMs: opts.handshakeTimeoutMs,
    pingIntervalMs: opts.pingIntervalMs,
    maxPayload: opts.maxPayload,
    logger: (l) => logs.push(l),
    onAuthAlert: (n) => authAlerts.push(n),
  });
  return {
    core,
    handle,
    token,
    logs,
    authAlerts,
    url(tokenOverride?: string | null): string {
      const base = `ws://127.0.0.1:${handle.port}/`;
      if (tokenOverride === null) return base; // 不带 token
      const t = tokenOverride ?? token;
      return `${base}?token=${encodeURIComponent(t)}`;
    },
    close: () => handle.close(),
  };
}

/** 极简 ws RPC 客户端,收集事件供断言。 */
export class TestClient {
  readonly ws: WebSocket;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  readonly messages: HostMessage[] = [];
  readonly ptyData = new Map<string, string>();
  readonly ptyExits = new Map<string, number>();
  readonly fsChanged: number[] = [];
  binaryFrameCount = 0;
  textFrameCount = 0;
  closed: { code: number; reason: string } | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary) this.binaryFrameCount++;
      else this.textFrameCount++;
      let msg: HostMessage;
      try {
        msg = JSON.parse(raw.toString('utf8')) as HostMessage;
      } catch {
        return;
      }
      this.messages.push(msg);
      switch (msg.t) {
        case 'rpc:res': {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(msg.error));
          }
          break;
        }
        case 'pty:data':
          this.ptyData.set(
            msg.sessionId,
            (this.ptyData.get(msg.sessionId) ?? '') + msg.data,
          );
          break;
        case 'pty:exit':
          this.ptyExits.set(msg.sessionId, msg.exitCode);
          break;
        case 'fs:changed':
          this.fsChanged.push(msg.watchId);
          break;
      }
    });
    this.ws.on('close', (code: number, reason: Buffer) => {
      this.closed = { code, reason: reason.toString('utf8') };
      for (const p of this.pending.values()) {
        p.reject(new Error('ws closed'));
      }
      this.pending.clear();
    });
    // 防止未捕获 error 事件冒泡(连接被 destroy 时客户端会收到 ECONNRESET)
    this.ws.on('error', () => {});
  }

  waitOpen(timeoutMs = 4000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      const timer = setTimeout(() => reject(new Error('open timeout')), timeoutMs);
      this.ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      this.ws.on('close', () => {
        clearTimeout(timer);
        reject(new Error('closed before open'));
      });
    });
  }

  waitClose(timeoutMs = 4000): Promise<{ code: number; reason: string }> {
    return new Promise((resolve, reject) => {
      if (this.closed) return resolve(this.closed);
      const timer = setTimeout(
        () => reject(new Error('close timeout')),
        timeoutMs,
      );
      this.ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString('utf8') });
      });
    });
  }

  /** 发一条 JSON 消息(不等响应)。 */
  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** 发原始帧(可为非 JSON / 二进制;畸形测试用)。 */
  sendRaw(data: string | Buffer): void {
    this.ws.send(data);
  }

  /** 发起一个 rpc:req 并等 rpc:res。 */
  rpc(method: string, params?: unknown, timeoutMs = 6000): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`rpc timeout: ${method}`));
        },
        timeoutMs,
      );
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ t: 'rpc:req', id, method, params });
    });
  }

  /** 打开 + host.info 握手(happy path);返回 HostInfo。 */
  async handshake(): Promise<Record<string, unknown>> {
    await this.waitOpen();
    return (await this.rpc('host.info', undefined)) as Record<string, unknown>;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** 轮询直到条件成立或超时。 */
export async function waitFor(
  cond: () => boolean,
  timeoutMs = 3000,
  stepMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  if (!cond()) throw new Error('waitFor timed out');
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
