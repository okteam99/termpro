// @vitest-environment jsdom
// 握手期消息闸 + 断链快速拒绝(m-sg fs.readdir 15s 超时案根因回归):
// - host 侧 ws 门控要求 host.info-first(响应回来前插话 → 断连,wsServer TC-A05);
//   ws open 后 transport 即非空,rpc/post 若不入闸会在高延迟链路(SSH 隧道合帧)下
//   撞门控被 host 掐死 → 消费方 RPC 吊满 15s 报「rpc timeout」。
// - reconnectable client 断链(onClose / reconnect teardown / dispose)必须立即拒绝
//   挂起 RPC('host connection lost'),不留给 RPC_TIMEOUT。
import { afterEach, describe, expect, it } from 'vitest';
import { HostClient } from '../hostClient';
import type { HostInfo } from '../../../shared/protocol';

const V1_INFO: HostInfo = {
  hostId: 'local',
  protocolVersion: 1,
  minCompatible: 1,
  platform: 'darwin',
  homedir: '/home/x',
  shell: '/bin/zsh',
  capabilities: ['session.resume'],
};

interface SentMsg {
  t?: string;
  id?: number;
  method?: string;
}

/** 可控假 WebSocket:host.info 响应不自动回,由测试显式 releaseHostInfo() 放行。 */
class ManualWebSocket {
  static instances: ManualWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: SentMsg[] = [];
  closed = false;
  private pendingHostInfoId: number | null = null;

  constructor(public url: string) {
    ManualWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string): void {
    const msg = JSON.parse(data) as SentMsg;
    this.sent.push(msg);
    if (msg.t === 'rpc:req' && msg.method === 'host.info') {
      this.pendingHostInfoId = msg.id ?? null;
    }
  }

  releaseHostInfo(): void {
    const id = this.pendingHostInfoId;
    if (id === null) throw new Error('no pending host.info');
    this.pendingHostInfoId = null;
    this.onmessage?.({
      data: JSON.stringify({ t: 'rpc:res', id, ok: true, result: V1_INFO }),
    });
  }

  respond(id: number, result: unknown): void {
    this.onmessage?.({
      data: JSON.stringify({ t: 'rpc:res', id, ok: true, result }),
    });
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }
}

function stubManualWebSocket(): void {
  ManualWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = ManualWebSocket;
}

/** 冲刷 microtask 队列(onopen / promise 链都是 microtask 驱动)。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
});

describe('handshake_gate_queues_consumer_rpc_until_hostinfo_settles', () => {
  it('握手窗口内(ws open 后·host.info 响应前)的 rpc 不上线,握手落定后再发且能收到响应', async () => {
    stubManualWebSocket();
    const client = new HostClient({ reconnectable: true });
    const connecting = client.connect({ wsUrl: 'ws://127.0.0.1:9001?token=a' });
    await flush(); // onopen 已触发,host.info 已发出但未响应
    const ws = ManualWebSocket.instances[0];
    expect(ws.sent.map((m) => m.method)).toEqual(['host.info']);

    // 握手窗口内插入消费方 RPC:必须排队,不得立即上线(否则撞 host.info-first 门控)
    const readdir = client.rpc('fs.readdir', { path: '/x' });
    await flush();
    expect(ws.sent.map((m) => m.method)).toEqual(['host.info']);

    ws.releaseHostInfo();
    await connecting;
    await flush(); // 排队 RPC 重入发出
    expect(ws.sent.map((m) => m.method)).toEqual(['host.info', 'fs.readdir']);

    const sentReaddir = ws.sent.find((m) => m.method === 'fs.readdir')!;
    ws.respond(sentReaddir.id!, { entries: [] });
    await expect(readdir).resolves.toEqual({ entries: [] });
    client.dispose();
  });

  it('握手失败 → 排队 RPC 以 connect 真实错误拒绝(而非 15s rpc timeout)', async () => {
    stubManualWebSocket();
    const client = new HostClient({ reconnectable: true });
    const connecting = client.connect({ wsUrl: 'ws://127.0.0.1:9002?token=a' });
    await flush();
    const queued = client.rpc('fs.readdir', { path: '/x' });
    ManualWebSocket.instances[0].onerror?.();
    await expect(connecting).rejects.toThrow('host ws connect failed');
    await expect(queued).rejects.toThrow('host ws connect failed');
  });

  it('握手期 post(pty input/resize/ack)静默丢弃,不撞门控', async () => {
    stubManualWebSocket();
    const client = new HostClient({ reconnectable: true });
    const connecting = client.connect({ wsUrl: 'ws://127.0.0.1:9003?token=a' });
    await flush();
    const ws = ManualWebSocket.instances[0];
    client.input('s1', 'x');
    client.resize('s1', 80, 24);
    client.ack('s1', 42);
    expect(ws.sent.map((m) => m.method ?? m.t)).toEqual(['host.info']);

    ws.releaseHostInfo();
    await connecting;
    // 握手落定后 post 正常放行
    client.input('s1', 'y');
    expect(ws.sent.map((m) => m.method ?? m.t)).toEqual(['host.info', 'pty:input']);
    client.dispose();
  });
});

describe('pending_rpc_rejected_fast_on_connection_loss', () => {
  async function connectedClient(): Promise<{ client: HostClient; ws: ManualWebSocket }> {
    const client = new HostClient({ reconnectable: true });
    const connecting = client.connect({ wsUrl: 'ws://127.0.0.1:9100?token=a' });
    await flush();
    const ws = ManualWebSocket.instances[ManualWebSocket.instances.length - 1];
    ws.releaseHostInfo();
    await connecting;
    return { client, ws };
  }

  it('transport onClose(远程非终结分叉)→ 挂起 RPC 立即拒绝 host connection lost', async () => {
    stubManualWebSocket();
    const { client, ws } = await connectedClient();
    const pending = client.rpc('fs.readdir', { path: '/x' });
    await flush();
    expect(ws.sent.map((m) => m.method)).toContain('fs.readdir');

    ws.onclose?.();
    await expect(pending).rejects.toThrow('host connection lost');
    client.dispose();
  });

  it('reconnect() teardown(onClose 被 tearingDown 抑制)→ 挂起 RPC 同样立即拒绝', async () => {
    stubManualWebSocket();
    const { client } = await connectedClient();
    const pending = client.rpc('fs.readdir', { path: '/x' });
    await flush();

    const reconnecting = client.reconnect({ wsUrl: 'ws://127.0.0.1:9101?token=b' });
    await expect(pending).rejects.toThrow('host connection lost');
    await flush();
    ManualWebSocket.instances[ManualWebSocket.instances.length - 1].releaseHostInfo();
    await reconnecting;
    client.dispose();
  });

  it('dispose() → 挂起 RPC 立即拒绝(不留 15s 定时器吊着)', async () => {
    stubManualWebSocket();
    const { client } = await connectedClient();
    const pending = client.rpc('fs.readdir', { path: '/x' });
    await flush();
    client.dispose();
    await expect(pending).rejects.toThrow('host connection lost');
  });
});
