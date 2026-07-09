// @vitest-environment jsdom
// 端到端升级:v1 存档 → 迁移器(逐条 create 保留 id)→ hydrate → store 列表与迁移前一致。
// Node 层驱动全链路(不要求真实 Electron 窗口),复验 MIG-003(数据写入)+ REGR-001(视图态 hydrate)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../services/hostClient', () => ({
  hostClient: {
    rpc: (...args: unknown[]) => rpc(...args),
    onWorkspaceChanged: vi.fn(() => () => undefined),
  },
}));
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
}));

import { useAppStore } from '../store';
import type { PersistedStateV1, PersistedTab } from '../store';
import { runMigration } from '../workspaceMigration';
import type { WorkspaceEntry } from '../../../shared/protocol';

function v1ws(id: string, name: string, root: string, tabCount: number) {
  const tabs: PersistedTab[] = Array.from({ length: tabCount }, (_, i) => ({
    id: `${id}-t${i}`,
    cwd: root,
  }));
  return { id, name, root, activeTabId: tabs[0]?.id ?? null, tabs };
}

beforeEach(() => {
  rpc.mockReset();
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    hydrated: false,
  });
});

describe('端到端升级 / 迁移后功能回归', () => {
  it('test_upgrade_from_v1_store_end_to_end_sidebar_matches_pre_migration (REGR-005)', async () => {
    const source: PersistedStateV1 = {
      version: 1,
      activeWorkspaceId: 'v1-b',
      workspaces: [
        v1ws('v1-a', 'Alpha', '/proj/a', 2),
        v1ws('v1-b', 'Beta', '/proj/b', 1),
        v1ws('v1-c', 'Gamma', '/proj/c', 3),
      ],
    };

    // 假 Host 注册表:迁移逐条 create 落表(幂等 upsert)
    const registry = new Map<string, WorkspaceEntry>();
    const outcome = await runMigration(source, {
      createWorkspace: async (input) => {
        if (!registry.has(input.id)) registry.set(input.id, { ...input });
        return registry.get(input.id)!;
      },
      backupV1: async () => undefined,
      writeArchive: () => undefined,
    });
    expect(outcome.mode).toBe('v2');

    // hydrate(权威注册表 + v2 存档)
    useAppStore.getState().hydrate([...registry.values()], outcome.archive);

    const s = useAppStore.getState();
    // Sidebar 应呈现的列表(id/name/root/tab 数)与迁移前 v1 完全一致
    expect(
      s.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        root: w.root,
        tabCount: w.tabs.length,
      })),
    ).toEqual([
      { id: 'v1-a', name: 'Alpha', root: '/proj/a', tabCount: 2 },
      { id: 'v1-b', name: 'Beta', root: '/proj/b', tabCount: 1 },
      { id: 'v1-c', name: 'Gamma', root: '/proj/c', tabCount: 3 },
    ]);
    expect(s.activeWorkspaceId).toBe('v1-b'); // 活跃 workspace 保留
    expect(s.persistMode).toBe('v2');
  });

  it('test_post_migration_existing_tab_panel_sort_features_unchanged (REGR-003)', async () => {
    // 已迁移的 v2 状态
    const registry: WorkspaceEntry[] = [
      { id: 'w1', name: 'W1', root: '/w1' },
      { id: 'w2', name: 'W2', root: '/w2' },
    ];
    useAppStore.getState().hydrate(registry, {
      version: 2,
      activeWorkspaceId: 'w1',
      migrationFailureCount: 0,
      workspaces: [
        { workspaceId: 'w1', activeTabId: 'w1-a', tabs: [{ id: 'w1-a', cwd: '/w1' }] },
        { workspaceId: 'w2', activeTabId: 'w2-a', tabs: [{ id: 'w2-a', cwd: '/w2' }] },
      ],
    });
    rpc.mockClear();

    const st = useAppStore.getState();
    // 新增 tab / 关闭 tab / 面板宽度 / 拖拽排序 / 切换活跃 workspace —— 全本地
    st.addTab('w1', '/w1/sub');
    st.setPaneWidths({ sidebarWidth: 320, filePanelWidth: 400 });
    st.moveWorkspace('w2', 0);
    st.setActiveWorkspace('w2');
    const afterAdd = useAppStore.getState();
    const w1Tabs = afterAdd.workspaces.find((w) => w.id === 'w1')!.tabs.length;
    st.closeTab('w1', afterAdd.workspaces.find((w) => w.id === 'w1')!.tabs[1].id);

    const s = useAppStore.getState();
    expect(w1Tabs).toBe(2); // 新增 tab 生效
    expect(s.workspaces.find((w) => w.id === 'w1')!.tabs).toHaveLength(1); // 关闭生效
    expect(s.sidebarWidth).toBe(320);
    expect(s.workspaces.map((w) => w.id)).toEqual(['w2', 'w1']); // 排序生效
    expect(s.activeWorkspaceId).toBe('w2'); // 切换生效
    // 排序 / activeWorkspace 只写 UI 存档,不触发任何 workspace.update RPC
    expect(rpc).not.toHaveBeenCalled();
  });
});
