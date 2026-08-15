// @vitest-environment jsdom
// D-8/AC-11:远程断线 → dropHostWorkspaces 移除该 host 全部 ws + 释放其全部 tab;
// active 若属该 host → 回落本机首个(无本机 ws 则回落空态)。非重连语义(BL-005)。
// TC BL004-C-disconnect-fallback / BL004-U-disconnect-empty(均 level:unit,测 store 侧 reducer)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(() => null),
}));

import { useAppStore } from '../store';
import type { WorkspaceState } from '../store';
import { disposeTerminal } from '../../terminal/terminalRegistry';

function ws(
  id: string,
  name: string,
  root: string,
  tabIds: string[],
  hostId = 'local',
): WorkspaceState {
  return {
    id,
    name,
    root,
    hostId,
    tabs: tabIds.map((t) => ({ id: t, title: t, cwd: root })),
    activeTabId: tabIds[0] ?? null,
  };
}

beforeEach(() => {
  vi.mocked(disposeTerminal).mockClear();
});

describe('dropHostWorkspaces(AC-11)', () => {
  it('active workspace 属断线的远程 host → activeWorkspaceId 回落本机首个', () => {
    useAppStore.setState({
      workspaces: [
        ws('l1', 'L1', '/l1', ['t1']),
        ws('r1', 'R1', '/r1', ['s1', 's2'], 'cfg-1'),
      ],
      activeWorkspaceId: 'r1',
    });
    useAppStore.getState().dropHostWorkspaces('cfg-1');
    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['l1']);
    expect(s.activeWorkspaceId).toBe('l1');
    // 🔴 drop=拆视图非关会话(2026-08-15 事故):keepSession 保服务端会话续跑
    expect(disposeTerminal).toHaveBeenCalledWith('s1', { keepSession: true });
    expect(disposeTerminal).toHaveBeenCalledWith('s2', { keepSession: true });
    expect(vi.mocked(disposeTerminal).mock.calls.map((c) => c[0])).not.toContain('t1');
  });

  it('BL004-U-disconnect-empty: 断线且无本机 workspace → 回落空态(null),不困在死 host workspace', () => {
    useAppStore.setState({
      workspaces: [ws('r1', 'R1', '/r1', ['s1'], 'cfg-1')],
      activeWorkspaceId: 'r1',
    });
    useAppStore.getState().dropHostWorkspaces('cfg-1');
    const s = useAppStore.getState();
    expect(s.workspaces).toEqual([]);
    expect(s.activeWorkspaceId).toBeNull();
  });

  it('active workspace 不属断线的 host → active 不变', () => {
    useAppStore.setState({
      workspaces: [
        ws('l1', 'L1', '/l1', ['t1']),
        ws('r1', 'R1', '/r1', ['s1'], 'cfg-1'),
        ws('r2', 'R2', '/r2', ['s2'], 'cfg-2'),
      ],
      activeWorkspaceId: 'l1',
    });
    useAppStore.getState().dropHostWorkspaces('cfg-1');
    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['l1', 'r2']); // 只删 cfg-1
    expect(s.activeWorkspaceId).toBe('l1'); // 未动
    expect(disposeTerminal).toHaveBeenCalledWith('s1', { keepSession: true });
    expect(vi.mocked(disposeTerminal).mock.calls.map((c) => c[0])).not.toContain('s2');
  });

  it('drop 一个不存在的 host 是 no-op(不抛错,不动其它 ws)', () => {
    useAppStore.setState({
      workspaces: [ws('l1', 'L1', '/l1', ['t1'])],
      activeWorkspaceId: 'l1',
    });
    expect(() => useAppStore.getState().dropHostWorkspaces('cfg-never')).not.toThrow();
    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['l1']);
    expect(s.activeWorkspaceId).toBe('l1');
  });
});
