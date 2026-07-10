// 集成测试脚手架:真实 host 核心(createHostCore)+ 真实 ws 服务端(startWsServer,
// 绑 127.0.0.1:0 随机端口)+ 真实 ws 客户端。非 .test 文件,vitest 不当测试跑。
// Layer C/D/E 用它做「真实进程内 + 真实 loopback TCP 帧」的传输级验证。

import { WebSocket } from 'ws';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHostCore, HostCore } from '../hostCore';
import { startWsServer, WsServerHandle } from '../wsServer';
import type { ClientMessage, HostMessage } from '../../shared/protocol';

export interface TestHostOptions {
  token?: string;
  handshakeTimeoutMs?: number;
  pingIntervalMs?: number;
  maxPayload?: number;
  /**
   * host 形态(BL-005 · D-1)。默认 'embedded'(与既有 createHostCore() 默认一致 · 保既有
   * ws 集成测零回归)。断线重连/回放收养测(AC-1/12)显式传 'standalone'。
   */
  mode?: 'embedded' | 'standalone';
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
  const core = createHostCore(opts.mode ?? 'embedded');
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

/**
 * 反复写入直到收到该 watchId 的 fs:changed 或预算耗尽(F1 root-cause fix)。
 *
 * 根因:`fs.watch(path, {recursive:true})` 在 macOS 上底层绑定 FSEvents,RPC 调用
 * 返回 watchId ≠ FSEvents 流已开始实际接收事件 —— 流启动本身异步,在系统满负载
 * (如全量 vitest 并行)下可能被推迟。若「fs.watch 返回后的第一次写」恰好落在这个
 * 尚未开始接收的死窗口内,该次变更事件永久丢失,不会补发 —— 此时任何等待预算
 * (无论 3000ms 还是 8000ms)都注定超时,因为不是「慢」而是「丢」。
 *
 * 修法:持续 poke(每隔 pokeIntervalMs 写一个新文件名,确保不被去重)直到某一次
 * 命中「流已就绪」的窗口而收到事件,把「死窗口丢失」转化为「预算内最终必达」。
 */
export async function pokeUntilFsEvent(
  client: TestClient,
  watchId: number,
  dir: string,
  opts: { budgetMs?: number; pokeIntervalMs?: number } = {},
): Promise<void> {
  const budgetMs = opts.budgetMs ?? 8000;
  const pokeIntervalMs = opts.pokeIntervalMs ?? 1000;
  const deadline = Date.now() + budgetMs;
  let n = 0;
  while (true) {
    n++;
    fs.writeFileSync(path.join(dir, `.fs-poke-${Date.now()}-${n}`), String(n));
    const remaining = deadline - Date.now();
    const step = Math.max(50, Math.min(pokeIntervalMs, remaining));
    try {
      await waitFor(() => client.fsChanged.includes(watchId), step);
      return;
    } catch {
      // 本轮未命中,若预算未耗尽则继续下一次 poke
    }
    if (Date.now() >= deadline) break;
  }
  if (!client.fsChanged.includes(watchId)) {
    throw new Error(
      `pokeUntilFsEvent: watchId=${watchId} 在 ${budgetMs}ms 预算内(含持续 poke)始终未收到 fs:changed`,
    );
  }
}
