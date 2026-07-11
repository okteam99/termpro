// @vitest-environment jsdom
// BL-004:sessionEvents 改经 routeSessionEvent(hostId, sessionId, event) 单一 router,
// 本机订阅(initSessionEvents)与远程订阅(remoteWorkspaceSync ready 编排)共用同一函数。
// 反查从旧的单键 findTabBySessionId(sessionId) 改成 (hostId, sessionId) 复合键 findTab
// (terminalRegistry.ts)。本测试锁定本机路径(hostId='local')改造前后行为逐条等价
// (AC-6/QA-15:通知/角标序列不变),并验证 hostId 正确串到 findTab + hostRegistry.forWorkspace。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findTab, disposeTerminal } = vi.hoisted(() => ({
  findTab: vi.fn(),
  disposeTerminal: vi.fn(),
}));
// store.ts 也从这个模块 import disposeTerminal——同一路径 mock 需同时满足两边消费方
vi.mock('../../terminal/terminalRegistry', () => ({ findTab, disposeTerminal }));

const { hostRegistryMock, localClient } = vi.hoisted(() => {
  const localClient = { info: { homedir: '/home/liam' } };
  return {
    localClient,
    hostRegistryMock: {
      local: vi.fn(() => localClient),
      forWorkspace: vi.fn(() => localClient),
    },
  };
});
vi.mock('../hostRegistry', () => ({ hostRegistry: hostRegistryMock }));

import { __resetSessionEventsStateForTest, routeSessionEvent } from '../sessionEvents';
import { useAppStore } from '../../state/store';
import type { TabState } from '../../state/store';
import { __resetAllForTest, recordDeactivated, recordOutput } from '../quietGate';

function tab(id: string, patch: Partial<TabState> = {}): TabState {
  return { id, title: id, cwd: '/repo', ...patch };
}

function seed(): void {
  useAppStore.setState({
    workspaces: [
      {
        id: 'ws1',
        name: 'WS',
        root: '/repo',
        hostId: 'local',
        tabs: [tab('t1'), tab('t2')],
        activeTabId: 't1',
      },
    ],
    activeWorkspaceId: 'ws1',
    notifications: [],
  });
}

beforeEach(() => {
  findTab.mockReset();
  disposeTerminal.mockReset();
  hostRegistryMock.local.mockClear();
  hostRegistryMock.forWorkspace.mockClear();
  __resetAllForTest();
  __resetSessionEventsStateForTest();
  seed();
  // 默认失焦(后台完成/提醒场景是本模块策略的主战场)
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('routeSessionEvent 复合键反查', () => {
  it('用 (hostId, sessionId) 复合键查 tab,而非单键', () => {
    findTab.mockReturnValue('t2');
    routeSessionEvent('local', 'sess-2', { kind: 'bell' });
    expect(findTab).toHaveBeenCalledWith('local', 'sess-2');
  });

  it('复合键未命中(无 tab)→ 不产生任何 store 变更', () => {
    findTab.mockReturnValue(null);
    const before = useAppStore.getState().workspaces;
    routeSessionEvent('local', 'ghost-session', { kind: 'bell' });
    expect(useAppStore.getState().workspaces).toBe(before); // 未 set(),引用不变
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it('远程 hostId 同样经同一 router 串进复合键查找(与本机同函数)', () => {
    findTab.mockReturnValue('t1');
    routeSessionEvent('cfg-1', 'sess-r', { kind: 'bell' });
    expect(findTab).toHaveBeenCalledWith('cfg-1', 'sess-r');
  });
});

describe('本机路径行为等价(AC-6/QA-15)', () => {
  it('running→idle 在后台完成:unseenDone 置位 + 推一条 done 通知 · label 走该 ws host 的 homedir', () => {
    findTab.mockReturnValue('t2'); // active tab 是 t1,t2 是后台 tab
    useAppStore.getState().updateTab('t2', { activity: 'running' });

    routeSessionEvent('local', 'sess-2', { kind: 'cmd-done', exitCode: 0 });
    routeSessionEvent('local', 'sess-2', {
      kind: 'state',
      state: 'idle',
      via: 'process',
    });

    const t2 = useAppStore.getState().workspaces[0].tabs.find((t) => t.id === 't2')!;
    expect(t2.activity).toBe('idle');
    expect(t2.unseenDone).toBe(true);
    expect(t2.waiting).toBe(false);

    const notifs = useAppStore.getState().notifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ workspaceId: 'ws1', tabId: 't2', kind: 'done' });
    expect(notifs[0].text).toContain('Command finished');
    expect(notifs[0].text).toContain('exit code 0');
    // homedir 按该事件归属 ws 的 host 取(forWorkspace(ws)),不是裸单例
    expect(hostRegistryMock.forWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws1' }),
    );
  });

  it('当前(激活)tab 完成:只清态、不通知(状态点即可)', () => {
    findTab.mockReturnValue('t1'); // t1 是 activeTabId
    useAppStore.getState().updateTab('t1', { activity: 'running' });

    routeSessionEvent('local', 'sess-1', {
      kind: 'state',
      state: 'idle',
      via: 'process',
    });

    const t1 = useAppStore.getState().workspaces[0].tabs.find((t) => t.id === 't1')!;
    expect(t1.activity).toBe('idle');
    expect(t1.unseenDone).toBeFalsy();
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it('bell:后台 tab 亮 waiting + 推一条通知,同一等待期不重复(闩锁)', () => {
    findTab.mockReturnValue('t2');

    routeSessionEvent('local', 'sess-2', { kind: 'bell' });
    let t2 = useAppStore.getState().workspaces[0].tabs.find((t) => t.id === 't2')!;
    expect(t2.waiting).toBe(true);
    expect(useAppStore.getState().notifications).toHaveLength(1);
    expect(useAppStore.getState().notifications[0].kind).toBe('bell');

    routeSessionEvent('local', 'sess-2', { kind: 'bell' }); // 同一等待期再次 bell
    expect(useAppStore.getState().notifications).toHaveLength(1); // 不重复
    t2 = useAppStore.getState().workspaces[0].tabs.find((t) => t.id === 't2')!;
    expect(t2.waiting).toBe(true);
  });

  it('quiet:离开后有新输出再停住 → 后台 tab 提示;离开后无新增 → 不打扰', () => {
    findTab.mockReturnValue('t2');
    useAppStore.getState().updateTab('t2', { activity: 'running' });

    // 无输出场景:静默
    routeSessionEvent('local', 'sess-2', { kind: 'quiet', quiet: true });
    expect(useAppStore.getState().notifications).toHaveLength(0);

    // 离开后有新输出:提示
    recordDeactivated('t2', 1_000);
    recordOutput('t2', 2_000);
    routeSessionEvent('local', 'sess-2', { kind: 'quiet', quiet: true });
    const t2 = useAppStore.getState().workspaces[0].tabs.find((t) => t.id === 't2')!;
    expect(t2.waiting).toBe(true);
    const notifs = useAppStore.getState().notifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].kind).toBe('waiting');
  });

  it('notify:聚焦的当前 tab 不打扰;失焦后台 tab 推通知', () => {
    findTab.mockReturnValue('t2');
    routeSessionEvent('local', 'sess-2', {
      kind: 'notify',
      title: 'Agent',
      body: '需要确认',
    });
    const notifs = useAppStore.getState().notifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ workspaceId: 'ws1', tabId: 't2', kind: 'notify' });
    expect(notifs[0].text).toContain('Agent');
    expect(notifs[0].text).toContain('需要确认');
  });

  it('altscreen:不参与任何策略(无 store 变更)', () => {
    findTab.mockReturnValue('t2');
    const before = useAppStore.getState();
    routeSessionEvent('local', 'sess-2', { kind: 'altscreen', on: true });
    expect(useAppStore.getState().notifications).toBe(before.notifications);
  });
});
