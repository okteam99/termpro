// @vitest-environment jsdom
// F1 回归:hydrate 期 workspace.list 失败必须与「注册表真为空」区分开。
// list 失败 = 读失败(数据仍在盘上),不得破坏性 hydrate 成空、不得启动写回订阅固化空态;
// 停在未 hydrate 占位 + 有限重试,重试成功后再按注册表恢复(存档引用不丢弃)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const onWorkspaceChanged = vi.fn((..._args: unknown[]) => () => undefined);
vi.mock('../../services/hostClient', () => ({
  hostClient: {
    rpc: (...args: unknown[]) => rpc(...args),
    onWorkspaceChanged: (...args: unknown[]) => onWorkspaceChanged(...args),
  },
}));
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
}));

import { initPersistence, __resetPersistenceForTests } from '../persistence';
import { useAppStore } from '../store';
import type { PersistedStateV2 } from '../store';
import type { WorkspaceEntry } from '../../../shared/protocol';

const storeGet = vi.fn();
const storeSet = vi.fn();
const backupV1Archive = vi.fn(async (..._args: unknown[]) => undefined);

const archiveV2: PersistedStateV2 = {
  version: 2,
  activeWorkspaceId: 'w1',
  migrationFailureCount: 0,
  workspaces: [
    {
      workspaceId: 'w1',
      activeTabId: 't1',
      tabs: [{ id: 't1', cwd: '/r/a', customName: 'Alpha' }],
    },
    { workspaceId: 'w2', activeTabId: 't2', tabs: [{ id: 't2', cwd: '/r/b' }] },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  onWorkspaceChanged.mockClear();
  storeGet.mockReset();
  storeSet.mockReset();
  __resetPersistenceForTests();
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    hydrated: false,
    transientNotice: null,
  });
  (window as unknown as { termpro: unknown }).termpro = {
    storeGet: (...a: unknown[]) => storeGet(...a),
    storeSet: (...a: unknown[]) => storeSet(...a),
    backupV1Archive: (...a: unknown[]) => backupV1Archive(...a),
  };
});

afterEach(() => {
  __resetPersistenceForTests();
  vi.useRealTimers();
});

describe('persistence hydrate · workspace.list 失败降级(F1)', () => {
  it('test_hydrate_v2_with_list_failure_does_not_drop_workspaces_or_persist_empty', async () => {
    storeGet.mockResolvedValue(archiveV2);
    rpc.mockImplementation((method: string) =>
      method === 'workspace.list'
        ? Promise.reject(new Error('host down'))
        : Promise.reject(new Error(`unexpected rpc ${method}`)),
    );

    await initPersistence();

    const s = useAppStore.getState();
    // ① 未破坏性 hydrate 成空:未标记 hydrated(存档引用未被当孤儿丢弃)
    expect(s.hydrated).toBe(false);
    // 占位提示已给(App 停在「连接 Host…」)
    expect(s.transientNotice).toMatch(/registry/);
    // ② 无写回订阅启动 → 空态不会被固化落盘
    expect(storeSet).not.toHaveBeenCalled();
    expect(onWorkspaceChanged).not.toHaveBeenCalled();

    vi.clearAllTimers();
  });

  it('recovers workspaces from registry on a later successful retry (refs not lost)', async () => {
    storeGet.mockResolvedValue(archiveV2);
    const registry: WorkspaceEntry[] = [
      { id: 'w1', name: 'W1', root: '/r/a' },
      { id: 'w2', name: 'W2', root: '/r/b' },
    ];
    let listCalls = 0;
    rpc.mockImplementation((method: string) => {
      if (method === 'workspace.list') {
        listCalls += 1;
        return listCalls === 1
          ? Promise.reject(new Error('host down'))
          : Promise.resolve({ workspaces: registry });
      }
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });

    await initPersistence();
    expect(useAppStore.getState().hydrated).toBe(false); // 首次降级

    // 触发有限重试定时器(异步回调)
    await vi.advanceTimersByTimeAsync(2000);

    const s = useAppStore.getState();
    expect(s.hydrated).toBe(true);
    // 存档引用未丢:按注册表 name/root + 存档视图态恢复两条 workspace
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(s.workspaces[0].name).toBe('W1');
    expect(s.workspaces[0].tabs[0].customName).toBe('Alpha');
    // 写回订阅在 hydrate 成功后才启动(此前不订阅,故只订阅一次)
    expect(onWorkspaceChanged).toHaveBeenCalledTimes(1);
    // 迁移无失败 → 提示清空
    expect(s.transientNotice).toBeNull();

    vi.clearAllTimers();
  });

  it('v1 fallback is unaffected by list failure (registry ignored)', async () => {
    // 迁移失败 fallback:存档 version:1,list 失败也应照常 hydrate(v1 不依赖注册表)
    const v1Archive = {
      version: 1 as const,
      activeWorkspaceId: 'a',
      migrationFailureCount: 1,
      workspaces: [
        { id: 'a', name: 'Alpha', root: '/a', activeTabId: 't', tabs: [{ id: 't', cwd: '/a' }] },
      ],
    };
    storeGet.mockResolvedValue(v1Archive);
    // 迁移逐条 create 失败 → 保持 v1;list 也失败
    rpc.mockImplementation((method: string) =>
      Promise.reject(new Error(`fail ${method}`)),
    );

    await initPersistence();

    const s = useAppStore.getState();
    expect(s.hydrated).toBe(true); // v1 照常 hydrate
    expect(s.persistMode).toBe('v1');
    expect(s.workspaces.map((w) => w.id)).toEqual(['a']);
    expect(onWorkspaceChanged).toHaveBeenCalledTimes(1); // 写回/广播订阅正常启动

    vi.clearAllTimers();
  });
});
