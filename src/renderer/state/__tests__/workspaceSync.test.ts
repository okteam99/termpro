// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// store → terminalRegistry 会拉入 @xterm;mock 掉断链,同时可断言 disposeTerminal 被调用。
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
}));

import { reconcileWorkspaces } from '../workspaceSync';
import { useAppStore } from '../store';
import type { WorkspaceState } from '../store';
import { disposeTerminal } from '../../terminal/terminalRegistry';
import type { WorkspaceEntry } from '../../../shared/protocol';

function ws(
  id: string,
  name: string,
  root: string,
  tabIds: string[],
  activeTabId?: string,
): WorkspaceState {
  return {
    id,
    name,
    root,
    tabs: tabIds.map((t) => ({ id: t, title: t, cwd: root })),
    activeTabId: activeTabId ?? tabIds[0] ?? null,
  };
}

function entry(id: string, name: string, root: string): WorkspaceEntry {
  return { id, name, root };
}

describe('reconcileWorkspaces 协调算法(AC-3 三分支)', () => {
  it('test_snapshot_new_id_synthesizes_default_single_tab_view (COORD-001)', () => {
    const local = [ws('w1', 'w1', '/w1', ['t1'])];
    const snap = [entry('w1', 'w1', '/w1'), entry('w2', 'w2', '/w2')];
    const r = reconcileWorkspaces(local, 'w1', snap);
    const w2 = r.workspaces.find((w) => w.id === 'w2')!;
    expect(w2.tabs).toHaveLength(1);
    expect(w2.tabs[0].cwd).toBe('/w2');
  });

  it('test_snapshot_new_id_does_not_change_local_active_workspace (COORD-002)', () => {
    const local = [ws('w1', 'w1', '/w1', ['t1'])];
    const snap = [entry('w1', 'w1', '/w1'), entry('w2', 'w2', '/w2')];
    const r = reconcileWorkspaces(local, 'w1', snap);
    expect(r.activeWorkspaceId).toBe('w1');
  });

  it('test_snapshot_new_id_appended_to_sort_order_tail (COORD-003)', () => {
    const local = [ws('w1', 'w1', '/w1', ['t1']), ws('w3', 'w3', '/w3', ['t3'])];
    const snap = [
      entry('w1', 'w1', '/w1'),
      entry('w2', 'w2', '/w2'),
      entry('w3', 'w3', '/w3'),
    ];
    const r = reconcileWorkspaces(local, 'w1', snap);
    expect(r.workspaces.map((w) => w.id)).toEqual(['w1', 'w3', 'w2']);
  });

  it('test_snapshot_missing_id_disposes_tabs_and_removes_view (COORD-004)', () => {
    const local = [ws('w1', 'w1', '/w1', ['t1']), ws('w2', 'w2', '/w2', ['a', 'b'])];
    const snap = [entry('w1', 'w1', '/w1')];
    const r = reconcileWorkspaces(local, 'w1', snap);
    expect(r.workspaces.map((w) => w.id)).toEqual(['w1']);
    expect(r.disposedTabIds).toEqual(['a', 'b']);
  });

  it('test_snapshot_common_id_syncs_only_name_and_root (COORD-005)', () => {
    const local = [ws('w1', 'old', '/a', ['t1', 't2'], 't2')];
    const snap = [entry('w1', 'new', '/b')];
    const r = reconcileWorkspaces(local, 'w1', snap);
    const w1 = r.workspaces[0];
    expect(w1.name).toBe('new');
    expect(w1.root).toBe('/b');
    expect(w1.tabs.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(w1.activeTabId).toBe('t2');
  });

  it('test_snapshot_common_id_preserves_local_tabs_active_tab_and_order (COORD-006)', () => {
    const local = [
      ws('w0', 'w0', '/w0', ['x']),
      ws('w1', 'w1', '/a', ['t1', 't2'], 't2'),
    ];
    const snap = [entry('w0', 'w0', '/w0'), entry('w1', 'w1-renamed', '/a')];
    const r = reconcileWorkspaces(local, 'w1', snap);
    expect(r.workspaces.map((w) => w.id)).toEqual(['w0', 'w1']); // 排序位不变
    expect(r.activeWorkspaceId).toBe('w1'); // 本端激活不变
    const w1 = r.workspaces[1];
    expect(w1.activeTabId).toBe('t2');
    expect(w1.tabs.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('test_mixed_add_remove_snapshot_converges_existence_both_sides (COORD-007)', () => {
    const local = [
      ws('w1', 'w1', '/w1', ['t1']),
      ws('w2', 'w2', '/w2', ['t2']),
      ws('w3', 'w3', '/w3', ['t3']),
    ];
    const snap = [
      entry('w1', 'w1', '/w1'),
      entry('w3', 'w3', '/w3'),
      entry('w4', 'w4', '/w4'),
    ];
    const r = reconcileWorkspaces(local, 'w1', snap);
    expect(new Set(r.workspaces.map((w) => w.id))).toEqual(
      new Set(['w1', 'w3', 'w4']),
    );
    expect(r.disposedTabIds).toEqual(['t2']); // w2 回收
    const w4 = r.workspaces.find((w) => w.id === 'w4')!;
    expect(w4.tabs).toHaveLength(1); // 合成默认视图
  });

  it('test_active_workspace_removed_remotely_switches_to_first_remaining (COORD-008)', () => {
    const local = [ws('w1', 'w1', '/w1', ['t1']), ws('w2', 'w2', '/w2', ['t2'])];
    const snap = [entry('w2', 'w2', '/w2')];
    const r = reconcileWorkspaces(local, 'w1', snap);
    expect(r.activeWorkspaceId).toBe('w2');
  });

  it('test_inactive_workspace_removed_remotely_keeps_active_unchanged (COORD-009)', () => {
    const local = [ws('w1', 'w1', '/w1', ['t1']), ws('w2', 'w2', '/w2', ['t2'])];
    const snap = [entry('w1', 'w1', '/w1')];
    const r = reconcileWorkspaces(local, 'w1', snap);
    expect(r.activeWorkspaceId).toBe('w1');
  });

  it('test_own_echo_push_for_just_created_id_merges_as_existing_not_new (COORD-011)', () => {
    // 本端刚经 RPC 成功创建 w5(tabs=[t1], active=w5),随后收到该操作的回声快照
    const local = [ws('w5', 'w5', '/w5', ['t1'])];
    const snap = [entry('w5', 'w5', '/w5')];
    const r = reconcileWorkspaces(local, 'w5', snap);
    expect(r.workspaces).toHaveLength(1);
    expect(r.workspaces[0].tabs.map((t) => t.id)).toEqual(['t1']); // 不二次合成
    expect(r.activeWorkspaceId).toBe('w5'); // 不覆盖已设激活
    expect(r.disposedTabIds).toEqual([]);
  });
});

describe('store.applyWorkspaceSnapshot 副作用接线', () => {
  beforeEach(() => {
    vi.mocked(disposeTerminal).mockClear();
    useAppStore.setState({
      persistMode: 'v2',
      workspaces: [
        ws('w1', 'w1', '/w1', ['pty-1', 'pty-2', 'pty-3']),
        ws('w2', 'w2', '/w2', ['t2']),
      ],
      activeWorkspaceId: 'w1',
    });
  });

  it('test_remote_removal_disposes_all_ptys_of_that_workspace_no_orphan (COORD-010)', () => {
    useAppStore.getState().applyWorkspaceSnapshot([entry('w2', 'w2', '/w2')]);
    expect(disposeTerminal).toHaveBeenCalledWith('pty-1');
    expect(disposeTerminal).toHaveBeenCalledWith('pty-2');
    expect(disposeTerminal).toHaveBeenCalledWith('pty-3');
    expect(disposeTerminal).toHaveBeenCalledTimes(3);
    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w2']);
    expect(s.activeWorkspaceId).toBe('w2'); // 活跃被删 → 切首个
  });

  it('v1 fallback 模式忽略广播(Host 无权威)', () => {
    useAppStore.setState({ persistMode: 'v1' });
    useAppStore.getState().applyWorkspaceSnapshot([]);
    expect(disposeTerminal).not.toHaveBeenCalled();
    expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['w1', 'w2']);
  });
});
