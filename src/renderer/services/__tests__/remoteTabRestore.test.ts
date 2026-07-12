// @vitest-environment jsdom
// 远程 tab 布局恢复编排(用户规则 2026-07:服务端升级/重启后 tab 名称/数量/顺序不丢):
// restoreRemoteTabLayouts = consumeRemoteTabLayouts(单次性)→ restoreWorkspaceTabs(守卫式)
// → 带 sessionId 的 tab 预绑定(bind 注入,registry 半侧见 bindRestoredSession.test)。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreRemoteTabLayouts } from '../sessionReadopt';
import { useAppStore, type WorkspaceState } from '../../state/store';

function remoteWs(id: string, hostId: string, tabs: WorkspaceState['tabs'] = []): WorkspaceState {
  return { id, name: id, root: `/root/${id}`, hostId, tabs, activeTabId: tabs[0]?.id ?? null };
}

beforeEach(() => {
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    remoteTabLayouts: {},
  });
});

describe('restoreRemoteTabLayouts', () => {
  it('0-tab 远程 ws:按存档原序恢复 tab(名称/数量/顺序/activeTab),带 sessionId 的逐个预绑定', () => {
    useAppStore.setState({
      workspaces: [remoteWs('rw1', 'cfg-a')],
      remoteTabLayouts: {
        rw1: {
          hostId: 'cfg-a',
          workspaceId: 'rw1',
          activeTabId: 't2',
          tabs: [
            { id: 't1', cwd: '/a/x', customName: '构建', sessionId: 'sid-1' },
            { id: 't2', cwd: '/a/y', sessionId: 'sid-2' },
            { id: 't3', cwd: '/a/z' }, // 存档时未 spawn(无 sessionId)→ 不预绑定,挂载 new spawn
          ],
        },
      },
    });
    const bind = vi.fn();

    restoreRemoteTabLayouts('cfg-a', bind);

    const ws = useAppStore.getState().workspaces[0];
    expect(ws.tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(ws.tabs[0].customName).toBe('构建');
    expect(ws.activeTabId).toBe('t2');
    expect(bind.mock.calls).toEqual([
      ['t1', 'cfg-a', 'sid-1', '/a/x'],
      ['t2', 'cfg-a', 'sid-2', '/a/y'],
    ]);
    // 消费即删
    expect(useAppStore.getState().remoteTabLayouts).toEqual({});
  });

  it('ws 已带 tab(闪断未 drop)→ 跳过恢复且不 bind,条目仍被消费(不留陈旧布局)', () => {
    useAppStore.setState({
      workspaces: [remoteWs('rw1', 'cfg-a', [{ id: 'live', title: 'live', cwd: '/live' }])],
      remoteTabLayouts: {
        rw1: {
          hostId: 'cfg-a',
          workspaceId: 'rw1',
          activeTabId: 'tOld',
          tabs: [{ id: 'tOld', cwd: '/old', sessionId: 'sid-old' }],
        },
      },
    });
    const bind = vi.fn();

    restoreRemoteTabLayouts('cfg-a', bind);

    expect(useAppStore.getState().workspaces[0].tabs.map((t) => t.id)).toEqual(['live']);
    expect(bind).not.toHaveBeenCalled();
    expect(useAppStore.getState().remoteTabLayouts).toEqual({});
  });

  it('ws 已不在注册表(服务端删除项目)→ 不恢复不 bind,条目消费;他机条目不动', () => {
    useAppStore.setState({
      workspaces: [], // rw1 已被服务端删除
      remoteTabLayouts: {
        rw1: {
          hostId: 'cfg-a',
          workspaceId: 'rw1',
          activeTabId: null,
          tabs: [{ id: 't1', cwd: '/a', sessionId: 's1' }],
        },
        rwB: {
          hostId: 'cfg-b',
          workspaceId: 'rwB',
          activeTabId: null,
          tabs: [{ id: 'tb', cwd: '/b' }],
        },
      },
    });
    const bind = vi.fn();

    restoreRemoteTabLayouts('cfg-a', bind);

    expect(bind).not.toHaveBeenCalled();
    expect(Object.keys(useAppStore.getState().remoteTabLayouts)).toEqual(['rwB']);
  });

  it('无该机条目 → no-op', () => {
    useAppStore.setState({ workspaces: [remoteWs('rw1', 'cfg-a')] });
    const bind = vi.fn();
    restoreRemoteTabLayouts('cfg-a', bind);
    expect(bind).not.toHaveBeenCalled();
    expect(useAppStore.getState().workspaces[0].tabs).toEqual([]);
  });
});
