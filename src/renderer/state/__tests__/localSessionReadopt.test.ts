// @vitest-environment jsdom
// 本地会话收养接线(本地 host standalone 化 · 阶段C):
// finishHydrate 后——① 存档带 sessionId 的本机 tab 同步预绑定(bindRestoredSessionTab,
// 赶在 TerminalView 挂载 ensureSession 之前的硬约束);② 触发 readoptHostSessions('local')
// 异步收养;③ 无 sessionId 的 tab / 被 hydrate 丢弃的孤儿 ws tab 不绑定。
// 收养内部逻辑(attach 回放/miss 重 spawn/串行化)由 sessionReadopt.test.ts /
// terminalRegistryReadopt.test.ts 覆盖,本文件只锁「持久化 → 收养」的接缝。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../services/hostClient', () => ({
  hostClient: {
    rpc: (...args: unknown[]) => rpc(...args),
    onWorkspaceChanged: vi.fn(() => () => undefined),
  },
}));
const bindRestoredSessionTab = vi.fn();
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(() => null),
  bindRestoredSessionTab: (...args: unknown[]) => bindRestoredSessionTab(...args),
}));
const readoptHostSessions = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../services/sessionReadopt', () => ({
  readoptHostSessions: (...args: unknown[]) => readoptHostSessions(...args),
}));

import { initPersistence, __resetPersistenceForTests } from '../persistence';
import { useAppStore } from '../store';
import type { PersistedStateV2 } from '../store';

const storeGet = vi.fn();
const storeSet = vi.fn();

// w1 在注册表(存活);w-orphan 不在(hydrate 丢弃):其 tab 绝不能被绑定
const archive: PersistedStateV2 = {
  version: 2,
  activeWorkspaceId: 'w1',
  migrationFailureCount: 0,
  workspaces: [
    {
      workspaceId: 'w1',
      activeTabId: 't1',
      tabs: [
        { id: 't1', cwd: '/r/a', sessionId: 's-1' },
        { id: 't2', cwd: '/r/a/sub' }, // 无 sessionId → 不绑定,挂载正常 new spawn
      ],
    },
    {
      workspaceId: 'w-orphan',
      activeTabId: 't9',
      tabs: [{ id: 't9', cwd: '/gone', sessionId: 's-9' }],
    },
  ],
};

beforeEach(() => {
  rpc.mockReset();
  storeGet.mockReset();
  storeSet.mockReset();
  bindRestoredSessionTab.mockClear();
  readoptHostSessions.mockClear();
  __resetPersistenceForTests();
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    hydrated: false,
    transientNotice: null,
  });
  (window as unknown as { okwork: unknown }).okwork = {
    storeGet: (...a: unknown[]) => storeGet(...a),
    storeSet: (...a: unknown[]) => storeSet(...a),
    backupV1Archive: vi.fn(async () => undefined),
  };
});

afterEach(() => {
  __resetPersistenceForTests();
});

describe('本地会话收养接线(hydrate → bind → readopt)', () => {
  it('存档带 sessionId 的存活 tab 预绑定;无 sessionId/孤儿 ws 的不绑;随后收养 local', async () => {
    storeGet.mockResolvedValue(archive);
    rpc.mockImplementation((method: string) =>
      method === 'workspace.list'
        ? Promise.resolve({
            workspaces: [{ id: 'w1', name: 'A', root: '/r/a' }],
          })
        : Promise.reject(new Error(`unexpected rpc ${method}`)),
    );

    await initPersistence();

    const s = useAppStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1']); // 孤儿 ws 已丢弃

    // ① 只有 t1 被预绑定(t2 无 sessionId;t9 属孤儿 ws)
    expect(bindRestoredSessionTab).toHaveBeenCalledTimes(1);
    expect(bindRestoredSessionTab).toHaveBeenCalledWith('t1', 'local', 's-1', '/r/a');

    // ② 收养入口按 'local' 触发,且在预绑定之后(路径①要靠预绑定的 inst)
    expect(readoptHostSessions).toHaveBeenCalledWith('local');
    expect(bindRestoredSessionTab.mock.invocationCallOrder[0]).toBeLessThan(
      readoptHostSessions.mock.invocationCallOrder[0],
    );
  });

  it('全新安装(archive=null)→ 不绑定,但仍收养 local(host 可能留有会话:上轮存档写失败)', async () => {
    storeGet.mockResolvedValue(null);
    rpc.mockImplementation((method: string) =>
      method === 'workspace.list'
        ? Promise.resolve({ workspaces: [] })
        : Promise.reject(new Error(`unexpected rpc ${method}`)),
    );

    await initPersistence();

    expect(bindRestoredSessionTab).not.toHaveBeenCalled();
    expect(readoptHostSessions).toHaveBeenCalledWith('local');
  });

  it('v2 + workspace.list 读失败 → 停在未 hydrate 占位,不预绑定也不收养(F1 语义不破坏)', async () => {
    vi.useFakeTimers();
    storeGet.mockResolvedValue(archive);
    rpc.mockImplementation(() => Promise.reject(new Error('host down')));

    await initPersistence();

    expect(useAppStore.getState().hydrated).toBe(false);
    expect(bindRestoredSessionTab).not.toHaveBeenCalled();
    expect(readoptHostSessions).not.toHaveBeenCalled();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
