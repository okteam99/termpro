// @vitest-environment jsdom
// SSH-6:HostClient.connect(opts?) 向后兼容追加 wsUrl 参数 + dispose()(hostRegistry.drop 用)。
// 🔴 不重复 hostClientEmbeddedRegression.test.ts 已覆盖的「connect() 无参数=现状分支零变化」——
// 本文件只聚焦新增的 opts.wsUrl 分支与 dispose() 行为。
import { afterEach, describe, expect, it } from 'vitest';
import { HostClient } from '../hostClient';
import { ProtocolIncompatibleError } from '../../../shared/versionCompat';
import type { HostInfo } from '../../../shared/protocol';

const V1_INFO: HostInfo = {
  hostId: 'local',
  protocolVersion: 1,
  minCompatible: 1,
  platform: 'darwin',
  homedir: '/home/x',
  shell: '/bin/zsh',
};

interface SentMsg {
  t?: string;
  id?: number;
  method?: string;
}

/** 假 WebSocket:open 后按 host.info 请求应答给定 HostInfo,记录发出的消息与实例。 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: SentMsg[] = [];
  closed = false;

  constructor(
    public url: string,
    private info: HostInfo = V1_INFO,
  ) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string): void {
    const msg = JSON.parse(data) as SentMsg;
    this.sent.push(msg);
    if (msg.t === 'rpc:req' && msg.method === 'host.info') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({ t: 'rpc:res', id: msg.id, ok: true, result: this.info }),
        });
      });
    }
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }
}

function stubGlobalWebSocket(info: HostInfo = V1_INFO): void {
  FakeWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class extends FakeWebSocket {
    constructor(url: string) {
      super(url, info);
    }
  };
}

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
});

describe('hostClient_connect_opts_wsUrl_bypasses_env', () => {
  it('connect({wsUrl}) opens a WebSocket to exactly that URL and resolves with host.info', async () => {
    stubGlobalWebSocket();
    const client = new HostClient();

    const info = await client.connect({ wsUrl: 'ws://127.0.0.1:5555?token=abc' });

    expect(info.protocolVersion).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:5555?token=abc');
  });

  it('repeat connect() calls with no args reuse the cached in-flight promise (no duplicate socket)', async () => {
    stubGlobalWebSocket();
    const client = new HostClient();
    const p1 = client.connect({ wsUrl: 'ws://127.0.0.1:5555?token=abc' });
    const p2 = client.connect();
    expect(p2).toBe(p1);
    await p1;
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('rejects with ProtocolIncompatibleError and closes the socket on version mismatch', async () => {
    stubGlobalWebSocket({ ...V1_INFO, protocolVersion: 999, minCompatible: 999 });
    const client = new HostClient();

    await expect(
      client.connect({ wsUrl: 'ws://127.0.0.1:5555?token=abc' }),
    ).rejects.toBeInstanceOf(ProtocolIncompatibleError);

    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });
});

describe('hostClient_dispose', () => {
  it('closes the transport and clears the cached connect promise so a later connect() re-handshakes', async () => {
    stubGlobalWebSocket();
    const client = new HostClient();
    await client.connect({ wsUrl: 'ws://127.0.0.1:5555?token=abc' });
    expect(FakeWebSocket.instances[0].closed).toBe(false);

    client.dispose();

    expect(FakeWebSocket.instances[0].closed).toBe(true);

    await client.connect({ wsUrl: 'ws://127.0.0.1:5556?token=def' });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('is a no-op-safe call before any connect() (never throws)', () => {
    const client = new HostClient();
    expect(() => client.dispose()).not.toThrow();
  });
});
