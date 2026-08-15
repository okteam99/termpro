// @vitest-environment jsdom
// 远程 tab 布局持久化(用户规则 2026-07:服务端升级/重启后 session 内容可丢,
// tab 名称/数量/顺序不能丢)。覆盖:drop 快照 → 存档合并写盘 → hydrate 装载 →
// 消费/恢复 的完整 store/persistence 半侧(恢复编排接线见 sessionReadopt 测试)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionIds = new Map<string, string>();
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: (tabId: string) => sessionIds.get(tabId) ?? null,
}));
vi.mock('../../services/hostRegistry', () => ({
  hostRegistry: {
    local: () => ({ rpc: vi.fn(), onWorkspaceChanged: vi.fn(() => () => undefined) }),
    forHostId: vi.fn(() => null),
  },
}));

import { useAppStore } from '../store';
import type { PersistedRemoteWorkspace, TabState, WorkspaceState } from '../store';
import { serialize } from '../persistence';
import { disposeTerminal } from '../../terminal/terminalRegistry';

function tab(id: string, cwd: string, customName?: string): TabState {
  return { id, title: id, cwd, customName };
}

function remoteWs(
  id: string,
  hostId: string,
  tabs: TabState[],
  activeTabId: string | null = tabs[0]?.id ?? null,
): WorkspaceState {
  return { id, name: id, root: `/root/${id}`, hostId, tabs, activeTabId };
}

function resetStore(): void {
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    migrationFailureCount: 0,
    pendingWorkspaceIds: [],
    creatingWorkspace: false,
    transientNotice: null,
    remoteTabLayouts: {},
    notifications: [],
  });
}

beforeEach(() => {
  sessionIds.clear();
  resetStore();
});

describe('dropHostWorkspaces 布局快照', () => {
  it('drop 时按原序快照 tab(含 registry 现读 sessionId),0-tab ws 不留条目', () => {
    sessionIds.set('t1', 'sid-1');
    sessionIds.set('t2', 'sid-2'); // t3 无会话(未 spawn)
    useAppStore.setState({
      workspaces: [
        remoteWs('rw1', 'cfg-a', [tab('t1', '/a/x', '构建'), tab('t2', '/a/y'), tab('t3', '/a/z')], 't2'),
        remoteWs('rw2', 'cfg-a', []),
      ],
    });

    useAppStore.getState().dropHostWorkspaces('cfg-a');

    const layouts = useAppStore.getState().remoteTabLayouts;
    expect(Object.keys(layouts)).toEqual(['rw1']);
    expect(layouts['rw1']).toEqual({
      hostId: 'cfg-a',
      workspaceId: 'rw1',
      activeTabId: 't2',
      tabs: [
        { id: 't1', cwd: '/a/x', customName: '构建', filePanel: undefined, sessionId: 'sid-1' },
        { id: 't2', cwd: '/a/y', customName: undefined, filePanel: undefined, sessionId: 'sid-2' },
        { id: 't3', cwd: '/a/z', customName: undefined, filePanel: undefined, sessionId: undefined },
      ],
    });
    expect(useAppStore.getState().workspaces).toHaveLength(0);
  });

  it('重复 drop(新一轮 0 tab)清掉该 ws 旧条目,不让陈旧布局借尸还魂', () => {
    useAppStore.setState({
      remoteTabLayouts: {
        rw1: { hostId: 'cfg-a', workspaceId: 'rw1', activeTabId: 't1', tabs: [tab('t1', '/a')] },
      },
      workspaces: [remoteWs('rw1', 'cfg-a', [])], // 本轮用户已关光 tab
    });
    useAppStore.getState().dropHostWorkspaces('cfg-a');
    expect(useAppStore.getState().remoteTabLayouts).toEqual({});
  });

  it('浏览器窗格随快照保留(只 {id,url} · title 不入档),恢复后窗格重建——与落盘路径行为一致', () => {
    const withBrowser: TabState = {
      ...tab('t1', '/a/x'),
      browser: {
        tabs: [{ id: 'b1', url: 'https://example.com', title: '视图态标题' }],
        activeTabId: 'b1',
      },
    };
    useAppStore.setState({
      workspaces: [remoteWs('rw1', 'cfg-a', [withBrowser, tab('t2', '/a/y')], 't1')],
    });

    useAppStore.getState().dropHostWorkspaces('cfg-a');

    const snap = useAppStore.getState().remoteTabLayouts['rw1'];
    expect(snap.tabs[0].browser).toEqual({
      tabs: [{ id: 'b1', url: 'https://example.com' }], // title 视图态,不入快照
      activeTabId: 'b1',
    });
    expect(snap.tabs[1].browser).toBeUndefined(); // 无窗格的 tab 不带字段

    // 重连恢复:窗格随 hydrateTab 重建(断线重连与整机重启两条路径行为一致)
    useAppStore.setState({ workspaces: [remoteWs('rw1', 'cfg-a', [])] });
    const applied = useAppStore
      .getState()
      .restoreWorkspaceTabs('rw1', snap.tabs, snap.activeTabId);
    expect(applied).toBe(true);
    const restored = useAppStore.getState().workspaces[0].tabs[0];
    expect(restored.browser).toEqual({
      tabs: [{ id: 'b1', url: 'https://example.com' }],
      activeTabId: 'b1',
    });
  });

  it('只动本 host 的条目,他机布局原样保留', () => {
    const otherLayout: PersistedRemoteWorkspace = {
      hostId: 'cfg-b',
      workspaceId: 'rwB',
      activeTabId: null,
      tabs: [{ id: 'tb', cwd: '/b' }],
    };
    useAppStore.setState({
      remoteTabLayouts: { rwB: otherLayout },
      workspaces: [remoteWs('rw1', 'cfg-a', [tab('t1', '/a')])],
    });
    useAppStore.getState().dropHostWorkspaces('cfg-a');
    const layouts = useAppStore.getState().remoteTabLayouts;
    expect(layouts['rwB']).toEqual(otherLayout);
    expect(layouts['rw1']).toBeDefined();
  });
});

describe('drop 与用户关 tab 的会话处置分流(2026-08-15 事故回归)', () => {
  // 根因:drop(断线/手动断开拆视图)若缺省 kill,pty.kill 会顺着 stopRemoteWorkspaceSync
  // ②→③ 之间仍存活的连接真杀掉 host 侧会话——只有正被查看的 tab 有 inst,恰好只丢
  // 用户开着的项目(codex/claude 在跑任务陪葬)。drop 必须 detach-only,kill 仅留给用户明确意图。
  it('dropHostWorkspaces 走 detach-only(keepSession),不杀服务端会话', () => {
    sessionIds.set('t1', 'sid-1');
    useAppStore.setState({
      workspaces: [remoteWs('rw1', 'cfg-a', [tab('t1', '/a/x')])],
    });
    vi.mocked(disposeTerminal).mockClear();
    useAppStore.getState().dropHostWorkspaces('cfg-a');
    expect(disposeTerminal).toHaveBeenCalledWith('t1', { keepSession: true });
  });

  it('closeTab 保持缺省 kill 语义(用户明确关会话)', () => {
    useAppStore.setState({
      workspaces: [remoteWs('rw1', 'cfg-a', [tab('t1', '/a/x')])],
    });
    vi.mocked(disposeTerminal).mockClear();
    useAppStore.getState().closeTab('rw1', 't1');
    expect(vi.mocked(disposeTerminal).mock.calls).toEqual([['t1']]); // 单参:无 keepSession
  });
});

describe('consumeRemoteTabLayouts(单次性消费)', () => {
  it('只取走本 host 条目并从 store 删除;他机条目不动', () => {
    useAppStore.setState({
      remoteTabLayouts: {
        rw1: { hostId: 'cfg-a', workspaceId: 'rw1', activeTabId: null, tabs: [{ id: 't', cwd: '/x' }] },
        rwB: { hostId: 'cfg-b', workspaceId: 'rwB', activeTabId: null, tabs: [{ id: 'tb', cwd: '/b' }] },
      },
    });
    const mine = useAppStore.getState().consumeRemoteTabLayouts('cfg-a');
    expect(mine.map((l) => l.workspaceId)).toEqual(['rw1']);
    expect(Object.keys(useAppStore.getState().remoteTabLayouts)).toEqual(['rwB']);
    // 再次消费 → 空(单次性)
    expect(useAppStore.getState().consumeRemoteTabLayouts('cfg-a')).toEqual([]);
  });
});

describe('restoreWorkspaceTabs(布局恢复)', () => {
  it('远程 0-tab ws:按存档原序重建 tabs + activeTabId', () => {
    useAppStore.setState({ workspaces: [remoteWs('rw1', 'cfg-a', [])] });
    const ok = useAppStore.getState().restoreWorkspaceTabs(
      'rw1',
      [
        { id: 't1', cwd: '/a/x', customName: '构建', sessionId: 'sid-1' },
        { id: 't2', cwd: '/a/y' },
      ],
      't2',
    );
    expect(ok).toBe(true);
    const ws = useAppStore.getState().workspaces[0];
    expect(ws.tabs.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(ws.tabs[0].customName).toBe('构建');
    expect(ws.activeTabId).toBe('t2');
  });

  it('activeTabId 失配 → 回落首个 tab', () => {
    useAppStore.setState({ workspaces: [remoteWs('rw1', 'cfg-a', [])] });
    useAppStore.getState().restoreWorkspaceTabs('rw1', [{ id: 't1', cwd: '/a' }], 'gone');
    expect(useAppStore.getState().workspaces[0].activeTabId).toBe('t1');
  });

  it('评审 P1-2:snapshotRemoteLayout→restoreWorkspaceTabs 往返后 preview 保留,出口仍钉死', () => {
    const withPreview: TabState = {
      ...tab('t1', '/a/x'),
      browser: {
        tabs: [
          { id: 'b1', url: 'http://127.0.0.1:4123/tok/index.html', netHostId: 'cfg-a', preview: true },
        ],
        activeTabId: 'b1',
      },
    };
    useAppStore.setState({ workspaces: [remoteWs('rw1', 'cfg-a', [withPreview])] });

    useAppStore.getState().dropHostWorkspaces('cfg-a');
    const snap = useAppStore.getState().remoteTabLayouts['rw1'];
    // 内存态快照原样透传 preview(不在 snapshotRemoteLayout 剥离)
    expect(snap.tabs[0].browser?.tabs[0].preview).toBe(true);

    useAppStore.setState({ workspaces: [remoteWs('rw1', 'cfg-a', [])] });
    const applied = useAppStore
      .getState()
      .restoreWorkspaceTabs('rw1', snap.tabs, snap.activeTabId);
    expect(applied).toBe(true);

    const restored = useAppStore.getState().workspaces[0].tabs[0];
    // source='memory' 路径不剥 preview(与磁盘 hydrate 分流,评审 P1-2)
    expect(restored.browser?.tabs[0]).toMatchObject({ id: 'b1', preview: true });

    // 出口仍钉死:setBrowserTabNet 对 preview 标签是 no-op(store 层权威守卫)
    useAppStore.getState().setBrowserTabNet('t1', 'b1', 'cfg-b');
    const afterNetChange = useAppStore.getState().workspaces[0].tabs[0].browser!.tabs[0];
    expect(afterNetChange.netHostId).toBe('cfg-a'); // 未被改成 cfg-b
    expect(afterNetChange.preview).toBe(true);
  });

  it('守卫:ws 不存在 / 本机 ws / 已有 tab / 空布局 → 不应用', () => {
    const local = { ...remoteWs('lw', 'local', []) };
    const withTabs = remoteWs('rw2', 'cfg-a', [tab('live', '/live')]);
    useAppStore.setState({ workspaces: [local, withTabs] });
    const s = useAppStore.getState();
    expect(s.restoreWorkspaceTabs('nope', [{ id: 't', cwd: '/x' }], null)).toBe(false);
    expect(s.restoreWorkspaceTabs('lw', [{ id: 't', cwd: '/x' }], null)).toBe(false);
    expect(s.restoreWorkspaceTabs('rw2', [{ id: 't', cwd: '/x' }], null)).toBe(false);
    expect(s.restoreWorkspaceTabs('rw1', [], null)).toBe(false);
    // live 视图态未被覆盖
    expect(useAppStore.getState().workspaces[1].tabs.map((t) => t.id)).toEqual(['live']);
  });
});

describe('serialize v2 · remoteTabs 合并写盘', () => {
  it('live 远程 ws(在店)+ 已 drop 快照(不在店)合并;live 的 sessionId 现读', () => {
    sessionIds.set('t1', 'sid-live');
    useAppStore.setState({
      workspaces: [remoteWs('rw1', 'cfg-a', [tab('t1', '/a/x', '前端')])],
      remoteTabLayouts: {
        rwB: { hostId: 'cfg-b', workspaceId: 'rwB', activeTabId: 'tb', tabs: [{ id: 'tb', cwd: '/b', sessionId: 'sid-old' }] },
      },
    });
    const archive = serialize(useAppStore.getState());
    expect(archive.version).toBe(2);
    if (archive.version !== 2) throw new Error('expected v2');
    expect(archive.remoteTabs).toHaveLength(2);
    const byWs = new Map(archive.remoteTabs!.map((l) => [l.workspaceId, l]));
    expect(byWs.get('rwB')!.tabs[0].sessionId).toBe('sid-old');
    expect(byWs.get('rw1')!.tabs[0]).toMatchObject({
      id: 't1',
      cwd: '/a/x',
      customName: '前端',
      sessionId: 'sid-live',
    });
    // 远程 ws 本体仍被过滤出 workspaces 存档(D-6 不变)
    expect(archive.workspaces).toEqual([]);
  });

  it('同 ws 在店 → live 视图态为准,陈旧快照不写盘(如恢复被跳过后的残留条目)', () => {
    useAppStore.setState({
      workspaces: [remoteWs('rw1', 'cfg-a', [tab('tNew', '/new')])],
      remoteTabLayouts: {
        rw1: { hostId: 'cfg-a', workspaceId: 'rw1', activeTabId: 'tOld', tabs: [{ id: 'tOld', cwd: '/old' }] },
      },
    });
    const archive = serialize(useAppStore.getState());
    if (archive.version !== 2) throw new Error('expected v2');
    expect(archive.remoteTabs).toHaveLength(1);
    expect(archive.remoteTabs![0].tabs[0].id).toBe('tNew');
  });

  it('评审盲区2:serializeRemoteTabs 的 stored 路径过滤 preview 标签(断线未重连即退出场景)', () => {
    // rw1 不在 workspaces 里(已 drop,不在店)→ 走 stored 路径而非 live 路径
    useAppStore.setState({
      workspaces: [],
      remoteTabLayouts: {
        rw1: {
          hostId: 'cfg-a',
          workspaceId: 'rw1',
          activeTabId: 't1',
          tabs: [
            {
              id: 't1',
              cwd: '/a/x',
              browser: {
                tabs: [
                  {
                    id: 'b1',
                    url: 'http://127.0.0.1:4123/tok/index.html',
                    netHostId: 'cfg-a',
                    preview: true,
                  },
                ],
                activeTabId: 'b1',
              },
            },
          ],
        },
      },
    });
    const archive = serialize(useAppStore.getState());
    if (archive.version !== 2) throw new Error('expected v2');
    expect(archive.remoteTabs).toHaveLength(1);
    // 预览标签(URL 含一次性 token)不落盘;该 tab 唯一的浏览器标签被过滤 → 窗格字段整体消失
    expect(archive.remoteTabs![0].tabs[0].browser).toBeUndefined();
  });

  it('评审盲区2:stored 路径里非预览标签正常保留,只过滤 preview 那部分', () => {
    useAppStore.setState({
      workspaces: [],
      remoteTabLayouts: {
        rw1: {
          hostId: 'cfg-a',
          workspaceId: 'rw1',
          activeTabId: 't1',
          tabs: [
            {
              id: 't1',
              cwd: '/a/x',
              browser: {
                tabs: [
                  { id: 'b1', url: 'https://kept.example.com' },
                  { id: 'b2', url: 'http://127.0.0.1:4123/tok/index.html', preview: true },
                ],
                activeTabId: 'b2',
              },
            },
          ],
        },
      },
    });
    const archive = serialize(useAppStore.getState());
    if (archive.version !== 2) throw new Error('expected v2');
    const browser = archive.remoteTabs![0].tabs[0].browser;
    expect(browser?.tabs).toEqual([{ id: 'b1', url: 'https://kept.example.com' }]);
    // 原 activeTabId(b2)被过滤 → 回落剩余首个标签
    expect(browser?.activeTabId).toBe('b1');
  });

  it('无远程布局 → 不写 remoteTabs 字段;v1 模式恒不写', () => {
    useAppStore.setState({ workspaces: [] });
    const v2archive = serialize(useAppStore.getState());
    expect('remoteTabs' in v2archive).toBe(false);

    useAppStore.setState({
      persistMode: 'v1',
      workspaces: [remoteWs('rw1', 'cfg-a', [tab('t1', '/a')])],
    });
    const v1archive = serialize(useAppStore.getState());
    expect(v1archive.version).toBe(1);
    expect('remoteTabs' in v1archive).toBe(false);
  });
});

describe('hydrate 装载 remoteTabs', () => {
  it('v2 存档 remoteTabs → remoteTabLayouts 按 workspaceId 索引', () => {
    useAppStore.getState().hydrate([], {
      version: 2,
      activeWorkspaceId: null,
      workspaces: [],
      remoteTabs: [
        { hostId: 'cfg-a', workspaceId: 'rw1', activeTabId: 't1', tabs: [{ id: 't1', cwd: '/a', sessionId: 's1' }] },
      ],
      ui: {},
    });
    expect(useAppStore.getState().remoteTabLayouts['rw1'].tabs[0].sessionId).toBe('s1');
  });

  it('v1 存档 → remoteTabLayouts 清空', () => {
    useAppStore.setState({
      remoteTabLayouts: {
        rw1: { hostId: 'cfg-a', workspaceId: 'rw1', activeTabId: null, tabs: [{ id: 't', cwd: '/x' }] },
      },
    });
    useAppStore.getState().hydrate([], {
      version: 1,
      activeWorkspaceId: null,
      workspaces: [],
    });
    expect(useAppStore.getState().remoteTabLayouts).toEqual({});
  });
});
