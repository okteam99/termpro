// @vitest-environment jsdom
// 修 review BLOCKER A1/E2:store 层 applyWorkspaceSnapshot(本机)/setHostWorkspaces(远程)
// 必须只协调各自作用域,不得互相清空/抢占对方(R-3「本机加一个项目就清空所有远程机分组」)。
// TC BL004-U-snapshot-scope-local / BL004-U-snapshot-scope-remote。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
}));

import { useAppStore } from '../store';
import type { WorkspaceState } from '../store';
import { disposeTerminal } from '../../terminal/terminalRegistry';
import type { WorkspaceEntry } from '../../../shared/protocol';

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

function entry(id: string, name: string, root: string): WorkspaceEntry {
  return { id, name, root };
}

beforeEach(() => {
  vi.mocked(disposeTerminal).mockClear();
});

describe('BL004-U-snapshot-scope-local: 本机快照不误删/不误抢远程 ws', () => {
  beforeEach(() => {
    useAppStore.setState({
      persistMode: 'v2',
      workspaces: [
        ws('l1', 'L1', '/l1', ['t1']),
        ws('l2', 'L2', '/l2', ['t2']),
        ws('r1', 'R1', '/r1', ['s1'], 'cfg-1'),
        ws('r2', 'R2', '/r2', ['s2'], 'cfg-2'),
      ],
      activeWorkspaceId: 'r1', // 远程 active
    });
  });

  it('本机新增一个 ws(本机快照)→ 远程 ws 全部原位保留,远程 active 不被抢回本机', () => {
    // 本机新建 l3(host workspace.create 回声广播只含本机 ws)
    useAppStore.getState().applyWorkspaceSnapshot([
      entry('l1', 'L1', '/l1'),
      entry('l2', 'L2', '/l2'),
      entry('l3', 'L3', '/l3'),
    ]);
    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['l1', 'l2', 'r1', 'r2', 'l3']);
    expect(s.workspaces.find((w) => w.id === 'r1')?.hostId).toBe('cfg-1');
    expect(s.workspaces.find((w) => w.id === 'r2')?.hostId).toBe('cfg-2');
    expect(s.activeWorkspaceId).toBe('r1'); // 远程 active 不被抢回
    expect(disposeTerminal).not.toHaveBeenCalled();
  });

  it('本机删除一个 ws → 只回收本机 tab,远程 ws 不受影响', () => {
    useAppStore.getState().applyWorkspaceSnapshot([entry('l1', 'L1', '/l1')]); // l2 被删
    const s = useAppStore.getState();
    expect(disposeTerminal).toHaveBeenCalledWith('t2');
    expect(disposeTerminal).not.toHaveBeenCalledWith('s1');
    expect(disposeTerminal).not.toHaveBeenCalledWith('s2');
    expect(s.workspaces.map((w) => w.id)).toEqual(['l1', 'r1', 'r2']);
    expect(s.activeWorkspaceId).toBe('r1'); // 远程 active 仍不变
  });
});

describe('BL004-U-snapshot-scope-remote: 远程 per-host 快照只协调该机,不动本机/其它远程机', () => {
  beforeEach(() => {
    useAppStore.setState({
      persistMode: 'v2',
      workspaces: [
        ws('l1', 'L1', '/l1', ['t1']),
        ws('r1', 'R1', '/r1', ['s1'], 'cfg-1'),
        ws('r2', 'R2', '/r2', ['s2'], 'cfg-1'),
        ws('r3', 'R3', '/r3', ['s3'], 'cfg-2'),
      ],
      activeWorkspaceId: 'l1', // 本机 active
    });
  });

  it('cfg-1 快照(r2 已被删)→ 只协调 cfg-1 子集,本机 l1 与 cfg-2 的 r3 不动,本机 active 不变', () => {
    useAppStore.getState().setHostWorkspaces('cfg-1', [entry('r1', 'R1', '/r1')]);
    const s = useAppStore.getState();
    expect(disposeTerminal).toHaveBeenCalledWith('s2');
    expect(disposeTerminal).not.toHaveBeenCalledWith('t1');
    expect(disposeTerminal).not.toHaveBeenCalledWith('s3');
    expect(s.workspaces.map((w) => w.id)).toEqual(['l1', 'r1', 'r3']);
    expect(s.activeWorkspaceId).toBe('l1'); // 本机 active 不变
  });

  it('远程发现新增 workspace → 注入 hostId=该 configId,追加视图态', () => {
    useAppStore
      .getState()
      .setHostWorkspaces('cfg-1', [entry('r1', 'R1', '/r1'), entry('r4', 'R4', '/r4')]);
    const s = useAppStore.getState();
    const r4 = s.workspaces.find((w) => w.id === 'r4')!;
    expect(r4.hostId).toBe('cfg-1');
    expect(r4.tabs).toHaveLength(1);
  });

  it('setHostWorkspaces 不受 persistMode 门控(v1 fallback 下远程发现照常生效)', () => {
    useAppStore.setState({ persistMode: 'v1' });
    useAppStore.getState().setHostWorkspaces('cfg-1', [entry('r1', 'R1', '/r1')]);
    const s = useAppStore.getState();
    expect(disposeTerminal).toHaveBeenCalledWith('s2'); // r2 仍按 cfg-1 快照回收
    expect(s.workspaces.map((w) => w.id)).toEqual(['l1', 'r1', 'r3']);
  });
});
