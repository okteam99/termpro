// BL-004:remoteWorkspaceSync 是远程 host「ready」后的一次性编排——workspace 发现
// (workspace.list 首拉 + onWorkspaceChanged 实时协调)与 session 事件路由三者绑定同一
// 生命周期,host drop/断线时一次性退订(E5)。本测试隔离验证编排本身(调用序列/订阅
// 生命周期/幂等重入/失败路径 E-1),routeSessionEvent 的内部策略逻辑由
// sessionEventsComposite.test.ts 单独覆盖,这里只断言「转发对了」。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../../shared/protocol';

const { routeSessionEvent } = vi.hoisted(() => ({ routeSessionEvent: vi.fn() }));
vi.mock('../sessionEvents', () => ({ routeSessionEvent }));

const { hostRegistryMock } = vi.hoisted(() => ({
  hostRegistryMock: {
    getOrCreateRemote: vi.fn(),
    drop: vi.fn(),
  },
}));
vi.mock('../hostRegistry', () => ({ hostRegistry: hostRegistryMock }));

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    setHostWorkspaces: vi.fn(),
    dropHostWorkspaces: vi.fn(),
  },
}));
vi.mock('../../state/store', () => ({
  useAppStore: { getState: () => storeMock },
}));

// 收养入口打桩:本测试只断言「注册表落地后触发了收养」这条 seam(PENDING-006);
// 收养内部(cwd 映射/重建 tab/串行化)由 sessionReadopt.test.ts 单独覆盖。
const { readoptRemoteSessions } = vi.hoisted(() => ({
  readoptRemoteSessions: vi.fn(async () => undefined),
}));
vi.mock('../sessionReadopt', () => ({ readoptRemoteSessions }));

import {
  isRemoteWorkspaceSyncing,
  startRemoteWorkspaceSync,
  stopRemoteWorkspaceSync,
} from '../remoteWorkspaceSync';

type WsListener = (workspaces: WorkspaceEntry[]) => void;
type SessionListener = (sessionId: string, event: unknown) => void;

function makeFakeClient(initialWorkspaces: WorkspaceEntry[] = []) {
  const wsListeners: WsListener[] = [];
  const sessionListeners: SessionListener[] = [];
  return {
    rpc: vi.fn(async () => ({ workspaces: initialWorkspaces })),
    onWorkspaceChanged: vi.fn((cb: WsListener) => {
      wsListeners.push(cb);
      return () => {
        const i = wsListeners.indexOf(cb);
        if (i >= 0) wsListeners.splice(i, 1);
      };
    }),
    onSessionEvent: vi.fn((cb: SessionListener) => {
      sessionListeners.push(cb);
      return () => {
        const i = sessionListeners.indexOf(cb);
        if (i >= 0) sessionListeners.splice(i, 1);
      };
    }),
    emitWorkspaceChanged(ws: WorkspaceEntry[]) {
      wsListeners.slice().forEach((cb) => cb(ws));
    },
    emitSessionEvent(sid: string, ev: unknown) {
      sessionListeners.slice().forEach((cb) => cb(sid, ev));
    },
    wsListenerCount: () => wsListeners.length,
    sessionListenerCount: () => sessionListeners.length,
  };
}

beforeEach(() => {
  hostRegistryMock.getOrCreateRemote.mockReset();
  hostRegistryMock.drop.mockReset();
  storeMock.setHostWorkspaces.mockReset();
  storeMock.dropHostWorkspaces.mockReset();
  routeSessionEvent.mockReset();
  readoptRemoteSessions.mockClear();
});

afterEach(() => {
  // 兜底清理:避免某条用例中途失败,订阅句柄泄漏进下一条用例
  stopRemoteWorkspaceSync('cfg-1');
  stopRemoteWorkspaceSync('cfg-2');
});

describe('startRemoteWorkspaceSync:host ready 编排', () => {
  it('workspace.list 首拉 → setHostWorkspaces(configId, entries)', async () => {
    const entries: WorkspaceEntry[] = [{ id: 'w1', name: 'proj', root: '/home/liam/proj' }];
    const client = makeFakeClient(entries);
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);

    await startRemoteWorkspaceSync('cfg-1', 'ws://127.0.0.1:1234?token=t');

    expect(hostRegistryMock.getOrCreateRemote).toHaveBeenCalledWith(
      'cfg-1',
      'ws://127.0.0.1:1234?token=t',
    );
    expect(client.rpc).toHaveBeenCalledWith('workspace.list', undefined);
    expect(storeMock.setHostWorkspaces).toHaveBeenCalledWith('cfg-1', entries);
  });

  it('注册表落地后触发服务端会话收养(PENDING-006:重启后重连的收养入口)', async () => {
    const client = makeFakeClient([{ id: 'w1', name: 'proj', root: '/r' }]);
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);

    await startRemoteWorkspaceSync('cfg-1', 'ws://x');

    expect(readoptRemoteSessions).toHaveBeenCalledWith('cfg-1');
    // 顺序钉死:先 setHostWorkspaces(cwd→workspace 映射素材)再收养
    const setOrder = storeMock.setHostWorkspaces.mock.invocationCallOrder[0];
    const readoptOrder = readoptRemoteSessions.mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(readoptOrder);
  });

  it('建立 onWorkspaceChanged 订阅:该机注册表广播 → 再次 setHostWorkspaces', async () => {
    const client = makeFakeClient([]);
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);
    await startRemoteWorkspaceSync('cfg-1', 'ws://x');
    storeMock.setHostWorkspaces.mockClear();

    const nextSnapshot: WorkspaceEntry[] = [{ id: 'w2', name: 'new', root: '/r' }];
    client.emitWorkspaceChanged(nextSnapshot);

    expect(storeMock.setHostWorkspaces).toHaveBeenCalledWith('cfg-1', nextSnapshot);
  });

  it('建立 onSessionEvent 订阅:该机会话事件 → routeSessionEvent(configId, sid, ev)(E5)', async () => {
    const client = makeFakeClient([]);
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);
    await startRemoteWorkspaceSync('cfg-1', 'ws://x');

    const event = { kind: 'bell' as const };
    client.emitSessionEvent('sess-1', event);

    expect(routeSessionEvent).toHaveBeenCalledWith('cfg-1', 'sess-1', event);
  });

  it('E-1:首拉瞬时失败(ready 与 ws open 竞态·host not connected)→ 短退避重试后注入', async () => {
    vi.useFakeTimers();
    const entries: WorkspaceEntry[] = [{ id: 'w1', name: 'proj', root: '/r' }];
    const client = makeFakeClient(entries);
    client.rpc.mockRejectedValueOnce(new Error('host not connected'));
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);

    const p = startRemoteWorkspaceSync('cfg-1', 'ws://x');
    await vi.advanceTimersByTimeAsync(400); // 一次退避(300ms)后第二拍成功
    await p;

    expect(storeMock.setHostWorkspaces).toHaveBeenCalledWith('cfg-1', entries);
    vi.useRealTimers();
  });

  it('E-1:持续失败 → 重试预算耗尽 WARN 不注入 ws,但仍建立 workspace/session 订阅', async () => {
    vi.useFakeTimers();
    const client = makeFakeClient([]);
    client.rpc.mockRejectedValue(new Error('ECONNRESET'));
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const p = startRemoteWorkspaceSync('cfg-1', 'ws://x');
    await vi.advanceTimersByTimeAsync(300 * 10 + 100); // 10 拍预算全耗尽
    await p;

    expect(storeMock.setHostWorkspaces).not.toHaveBeenCalled(); // 不注入 ws
    expect(readoptRemoteSessions).not.toHaveBeenCalled(); // 注册表没落地 → 不收养(无映射素材)
    expect(warnSpy).toHaveBeenCalled(); // 不静默吞异常

    // 订阅仍照常建立(host 已连通,失败只是 list 这一拍)
    const event = { kind: 'bell' as const };
    client.emitSessionEvent('s1', event);
    expect(routeSessionEvent).toHaveBeenCalledWith('cfg-1', 's1', event);

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('重入安全:同 configId 重复调用(如断线重连后再 ready)不留悬挂订阅', async () => {
    const client = makeFakeClient([]);
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);

    await startRemoteWorkspaceSync('cfg-1', 'ws://x');
    await startRemoteWorkspaceSync('cfg-1', 'ws://x'); // 第二次(同 client,重入)

    expect(client.wsListenerCount()).toBe(1); // 旧订阅已退,不叠加
    expect(client.sessionListenerCount()).toBe(1);
  });

  it('isRemoteWorkspaceSyncing 反映当前 sync 状态', async () => {
    expect(isRemoteWorkspaceSyncing('cfg-1')).toBe(false);
    const client = makeFakeClient([]);
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);
    await startRemoteWorkspaceSync('cfg-1', 'ws://x');
    expect(isRemoteWorkspaceSyncing('cfg-1')).toBe(true);
  });
});

describe('stopRemoteWorkspaceSync:断线/删除', () => {
  it('退订全部监听 + dropHostWorkspaces(configId) + hostRegistry.drop(configId)', async () => {
    const client = makeFakeClient([]);
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);
    await startRemoteWorkspaceSync('cfg-1', 'ws://x');
    expect(client.wsListenerCount()).toBe(1);
    expect(client.sessionListenerCount()).toBe(1);

    stopRemoteWorkspaceSync('cfg-1');

    expect(client.wsListenerCount()).toBe(0);
    expect(client.sessionListenerCount()).toBe(0);
    expect(storeMock.dropHostWorkspaces).toHaveBeenCalledWith('cfg-1');
    expect(hostRegistryMock.drop).toHaveBeenCalledWith('cfg-1');
    expect(isRemoteWorkspaceSyncing('cfg-1')).toBe(false);
  });

  it('退订后该 client 再 emit 不再触发 routeSessionEvent(不留悬挂路由)', async () => {
    const client = makeFakeClient([]);
    hostRegistryMock.getOrCreateRemote.mockReturnValue(client);
    await startRemoteWorkspaceSync('cfg-1', 'ws://x');
    stopRemoteWorkspaceSync('cfg-1');
    routeSessionEvent.mockClear();

    client.emitSessionEvent('s1', { kind: 'bell' as const });
    expect(routeSessionEvent).not.toHaveBeenCalled();
  });

  it('对未 sync 的 configId 调用是安全 no-op(不抛)', () => {
    expect(() => stopRemoteWorkspaceSync('cfg-never')).not.toThrow();
    expect(storeMock.dropHostWorkspaces).toHaveBeenCalledWith('cfg-never');
    expect(hostRegistryMock.drop).toHaveBeenCalledWith('cfg-never');
  });

  it('多台机互不影响:stop cfg-1 不动 cfg-2 的订阅', async () => {
    const client1 = makeFakeClient([]);
    const client2 = makeFakeClient([]);
    hostRegistryMock.getOrCreateRemote.mockImplementation((configId: string) =>
      configId === 'cfg-1' ? client1 : client2,
    );
    await startRemoteWorkspaceSync('cfg-1', 'ws://1');
    await startRemoteWorkspaceSync('cfg-2', 'ws://2');

    stopRemoteWorkspaceSync('cfg-1');

    expect(client1.wsListenerCount()).toBe(0);
    expect(client2.wsListenerCount()).toBe(1); // cfg-2 不受影响
    expect(isRemoteWorkspaceSyncing('cfg-2')).toBe(true);
  });
});
