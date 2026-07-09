// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/hostClient', () => ({
  hostClient: { rpc: vi.fn(), onWorkspaceChanged: vi.fn(() => () => undefined) },
}));
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
}));

import { useAppStore } from '../store';
import type { PersistedStateV2 } from '../store';
import type { WorkspaceEntry } from '../../../shared/protocol';

function entry(id: string, name: string, root: string): WorkspaceEntry {
  return { id, name, root };
}

beforeEach(() => {
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    hydrated: false,
  });
});

describe('v2 hydrate(注册表 ⋈ 存档外键)', () => {
  it('test_hydrate_v2_preserves_tabs_active_tab_and_file_panel_state (REGR-001)', () => {
    const archive: PersistedStateV2 = {
      version: 2,
      activeWorkspaceId: 'w1',
      migrationFailureCount: 0,
      workspaces: [
        {
          workspaceId: 'w1',
          activeTabId: 't2',
          tabs: [
            { id: 't1', cwd: '/r/a', customName: 'Alpha' },
            {
              id: 't2',
              cwd: '/r/b',
              customName: 'Beta',
              filePanel: { mode: 'worktree', worktreePath: '/r/b', expanded: ['/r/b/x'] },
            },
          ],
        },
      ],
    };
    useAppStore.getState().hydrate([entry('w1', 'W1', '/r')], archive);

    const s = useAppStore.getState();
    expect(s.persistMode).toBe('v2');
    const w1 = s.workspaces[0];
    expect(w1).toMatchObject({ id: 'w1', name: 'W1', root: '/r' }); // name/root 来自注册表
    expect(w1.tabs).toHaveLength(2);
    expect(w1.tabs[0].customName).toBe('Alpha');
    expect(w1.tabs[1].customName).toBe('Beta');
    expect(w1.tabs[1].filePanel).toEqual({
      mode: 'worktree',
      worktreePath: '/r/b',
      expanded: ['/r/b/x'],
    });
    expect(w1.activeTabId).toBe('t2');
  });

  it('test_hydrate_drops_orphan_workspace_ref_not_in_host_registry_silently (REGR-002)', () => {
    const archive: PersistedStateV2 = {
      version: 2,
      activeWorkspaceId: 'w1',
      migrationFailureCount: 0,
      workspaces: [
        { workspaceId: 'ghost', activeTabId: 'g1', tabs: [{ id: 'g1', cwd: '/ghost' }] },
        { workspaceId: 'w1', activeTabId: 'a1', tabs: [{ id: 'a1', cwd: '/r' }] },
      ],
    };
    // 注册表当前只返回 w1(ghost 已不存在)
    expect(() =>
      useAppStore.getState().hydrate([entry('w1', 'W1', '/r')], archive),
    ).not.toThrow();

    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1']); // 孤儿静默丢弃
    expect(s.workspaces[0].tabs[0].id).toBe('a1'); // w1 正常渲染
  });

  it('registry entry with no archive view synthesizes default view (tail)', () => {
    const archive: PersistedStateV2 = {
      version: 2,
      activeWorkspaceId: 'w1',
      migrationFailureCount: 0,
      workspaces: [{ workspaceId: 'w1', activeTabId: 'a1', tabs: [{ id: 'a1', cwd: '/r' }] }],
    };
    useAppStore
      .getState()
      .hydrate([entry('w1', 'W1', '/r'), entry('w2', 'W2', '/r2')], archive);
    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w2']); // w2 合成到末尾
    expect(s.workspaces[1].tabs).toHaveLength(1);
    expect(s.workspaces[1].tabs[0].cwd).toBe('/r2');
  });
});
