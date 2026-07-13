// @vitest-environment jsdom
// BL-005 · AC-10/AC-8(T-019/T-020/T-038):HostClient 显式 reconnect 路径。
// - reconnect 复位 down+connectPromise+关旧 transport+重开新 transport·保 per-host 结构(区别 dispose)
// - markDown/transport onClose 分叉:本地终结 vs 远程触发重连(非终结)
// - 能力位缺失 → supportsSessionResume=false(收养退化 new spawn·不发 list/attach)
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('reconnect_resets_down_and_connectpromise_preserves_perhost_structure (T-019)', () => {
  it('reconnect 复位 down、关旧 transport、重开新 transport,并保留 per-host 订阅结构', async () => {
    stubGlobalWebSocket();
    const client = new HostClient({ reconnectable: true });
    await client.connect({ wsUrl: 'ws://127.0.0.1:5555?token=a' });
    expect(FakeWebSocket.instances).toHaveLength(1);

    // 挂上 per-host 结构订阅(区别 dispose:reconnect 不该清它们)
    const sessionCb = vi.fn();
    const wsCb = vi.fn();
    const fsCb = vi.fn();
    const downCb = vi.fn();
    client.onSessionEvent(sessionCb);
    client.onWorkspaceChanged(wsCb);
    client.onFsChanged(fsCb);
    client.onDown(downCb);

    // 模拟断线:远程 transport onClose(非终结)
    FakeWebSocket.instances[0].onclose?.();
    // 远程分叉不置 down、不触发 downListeners(区别本地终结)
    expect(downCb).not.toHaveBeenCalled();

    const info = await client.reconnect({ wsUrl: 'ws://127.0.0.1:5556?token=b' });
    expect(info.protocolVersion).toBe(1);
    // 旧 transport 关、开了第二个 ws
    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toBe('ws://127.0.0.1:5556?token=b');

    // per-host 结构仍在:reconnect 后新 transport 推事件仍路由到既有订阅
    FakeWebSocket.instances[1].onmessage?.({
      data: JSON.stringify({ t: 'session:event', sessionId: 's1', event: { kind: 'bell' } }),
    });
    FakeWebSocket.instances[1].onmessage?.({
      data: JSON.stringify({ t: 'workspace:changed', workspaces: [] }),
    });
    FakeWebSocket.instances[1].onmessage?.({ data: JSON.stringify({ t: 'fs:changed', watchId: 7 }) });
    expect(sessionCb).toHaveBeenCalledWith('s1', { kind: 'bell' });
    expect(wsCb).toHaveBeenCalledWith([]);
    expect(fsCb).toHaveBeenCalledWith(7);

    // down 已复位:reconnect 后 rpc 不被旧 down 态误拒
    await expect(client.rpc('host.info', undefined)).resolves.toBeTruthy();
    client.dispose();
  });

  it('并发再入守卫:in-flight 期间重复 reconnect 复用同一 promise(不重复开 ws)', async () => {
    stubGlobalWebSocket();
    const client = new HostClient({ reconnectable: true });
    await client.connect({ wsUrl: 'ws://127.0.0.1:5555?token=a' });

    const p1 = client.reconnect({ wsUrl: 'ws://127.0.0.1:5556?token=b' });
    const p2 = client.reconnect({ wsUrl: 'ws://127.0.0.1:5557?token=c' });
    expect(p2).toBe(p1); // 复用同一 in-flight promise
    await p1;
    // 初始 1 + reconnect 1 = 2(第二次 reconnect 未开新 ws)
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.dispose();
  });
});

describe('markdown_fork_local_terminal_vs_remote_triggers_reconnect (T-020)', () => {
  it('本地 client(reconnectable=false):onClose → 终结(down=true·拒 rpc·downListeners 触发)', async () => {
    stubGlobalWebSocket();
    const local = new HostClient(); // 默认 reconnectable=false
    await local.connect({ wsUrl: 'ws://127.0.0.1:6001?token=a' });
    const downCb = vi.fn();
    const reconnectCb = vi.fn();
    local.onDown(downCb);
    local.onReconnectNeeded(reconnectCb);

    FakeWebSocket.instances[0].onclose?.();

    expect(downCb).toHaveBeenCalledTimes(1); // 终结
    expect(reconnectCb).not.toHaveBeenCalled(); // 不触发重连
    await expect(local.rpc('host.info', undefined)).rejects.toThrow(); // down 拒 rpc
  });

  it('远程 client(reconnectable=true):onClose → 触发重连(非终结·不置 down·不拒 rpc)', async () => {
    stubGlobalWebSocket();
    const remote = new HostClient({ reconnectable: true });
    await remote.connect({ wsUrl: 'ws://127.0.0.1:6002?token=a' });
    const downCb = vi.fn();
    const reconnectCb = vi.fn();
    remote.onDown(downCb);
    remote.onReconnectNeeded(reconnectCb);

    FakeWebSocket.instances[0].onclose?.();

    expect(reconnectCb).toHaveBeenCalledTimes(1); // 触发重连
    expect(downCb).not.toHaveBeenCalled(); // 非终结
    // 仍可 reconnect 后 rpc(非永久拒)
    await remote.reconnect({ wsUrl: 'ws://127.0.0.1:6003?token=b' });
    await expect(remote.rpc('host.info', undefined)).resolves.toBeTruthy();
    remote.dispose();
  });
});

describe('user_disconnect_stays_disconnected_no_auto_reconnect', () => {
  it('dispose 摘除 ws.onclose:迟到的异步 close 事件不触发 reconnectNeeded(主动断开保持断开)', async () => {
    stubGlobalWebSocket();
    const client = new HostClient({ reconnectable: true });
    await client.connect({ wsUrl: 'ws://127.0.0.1:6004?token=a' });
    const reconnectCb = vi.fn();
    client.onReconnectNeeded(reconnectCb);

    const ws = FakeWebSocket.instances[0];
    client.dispose(); // 用户主动断开(hostRegistry.drop 路径)

    // 浏览器 ws.close() 的 close 事件异步派发:dispose 返回(tearingDown 已复位)后才到——
    // 主动关闭必须已摘 onclose,否则误入 reconnectable 分叉 → 自动重连
    expect(ws.closed).toBe(true);
    expect(ws.onclose).toBeNull();
    ws.onclose?.();
    expect(reconnectCb).not.toHaveBeenCalled();
  });

  it('reconnect 关旧 transport 同样摘 onclose:旧 ws 迟到 close 不再次触发 reconnectNeeded', async () => {
    stubGlobalWebSocket();
    const client = new HostClient({ reconnectable: true });
    await client.connect({ wsUrl: 'ws://127.0.0.1:6005?token=a' });
    const reconnectCb = vi.fn();
    client.onReconnectNeeded(reconnectCb);

    const oldWs = FakeWebSocket.instances[0];
    await client.reconnect({ wsUrl: 'ws://127.0.0.1:6006?token=b' });

    expect(oldWs.onclose).toBeNull();
    oldWs.onclose?.();
    expect(reconnectCb).not.toHaveBeenCalled();
    client.dispose();
  });
});

describe('missing_capabilities_skips_list_attach_falls_back_new_spawn (T-038)', () => {
  it('capabilities 缺失 → supportsSessionResume=false(退化 new spawn 判据)', async () => {
    const noCap: HostInfo = { ...V1_INFO };
    delete noCap.capabilities;
    stubGlobalWebSocket(noCap);
    const client = new HostClient({ reconnectable: true });
    await client.connect({ wsUrl: 'ws://127.0.0.1:7001?token=a' });
    expect(client.supportsSessionResume()).toBe(false);
    client.dispose();
  });

  it('capabilities 含 session.resume → supportsSessionResume=true(走收养回放)', async () => {
    stubGlobalWebSocket(V1_INFO);
    const client = new HostClient({ reconnectable: true });
    await client.connect({ wsUrl: 'ws://127.0.0.1:7002?token=a' });
    expect(client.supportsSessionResume()).toBe(true);
    client.dispose();
  });

  it('新 client + 旧长期驻留 Host:缺 fs.temp-png 能力位 → 不把新增 RPC 当作可用', async () => {
    stubGlobalWebSocket(V1_INFO);
    const client = new HostClient({ reconnectable: true });
    await client.connect({ wsUrl: 'ws://127.0.0.1:7003?token=a' });
    expect(client.supportsTempPng()).toBe(false);
    client.dispose();
  });

  it('Host 公布 fs.temp-png → 远程图片粘贴可用', async () => {
    stubGlobalWebSocket({
      ...V1_INFO,
      capabilities: [...(V1_INFO.capabilities ?? []), 'fs.temp-png'],
    });
    const client = new HostClient({ reconnectable: true });
    await client.connect({ wsUrl: 'ws://127.0.0.1:7004?token=a' });
    expect(client.supportsTempPng()).toBe(true);
    client.dispose();
  });
});
