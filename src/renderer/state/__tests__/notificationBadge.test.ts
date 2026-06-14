import { beforeEach, describe, expect, it, vi } from 'vitest';

// store.ts → terminalRegistry.ts 会拉入 @xterm/* 浏览器模块;
// 本测试只验证 store 的通知/激活逻辑,mock 掉终端注册表断开该链。
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: () => {},
}));

import { useAppStore } from '../store';
import type { TabState } from '../store';

function tab(id: string): TabState {
  return { id, title: id, cwd: '/r', waiting: true, unseenDone: true };
}

function seed(): void {
  useAppStore.setState({
    workspaces: [
      {
        id: 'ws1',
        name: 'WS',
        root: '/r',
        tabs: [tab('t1'), tab('t2')],
        activeTabId: 't2',
      },
    ],
    activeWorkspaceId: 'ws1',
    notifications: [],
  });
}

const unread = (): number =>
  useAppStore.getState().notifications.filter((n) => !n.read).length;

function pushNotif(tabId: string): void {
  useAppStore.getState().pushNotification({
    workspaceId: 'ws1',
    tabId,
    kind: 'done',
    text: 'x',
  });
}

describe('通知角标随 tab 查看递减(BUG-TERMPRO-B260614065346-001)', () => {
  beforeEach(seed);

  it('激活有未读通知的 tab → 该 tab 通知标已读 · 角标 -1', () => {
    pushNotif('t1');
    expect(unread()).toBe(1);
    useAppStore.getState().setActiveTab('ws1', 't1');
    expect(unread()).toBe(0);
  });

  it('多 tab:只减被激活 tab 对应的通知,其它 tab 仍计数', () => {
    pushNotif('t1');
    pushNotif('t2');
    expect(unread()).toBe(2);
    useAppStore.getState().setActiveTab('ws1', 't1');
    expect(unread()).toBe(1);
  });

  it('同一 tab 多条未读 → 激活后该 tab 全部清掉,不残留', () => {
    pushNotif('t1');
    pushNotif('t1');
    expect(unread()).toBe(2);
    useAppStore.getState().setActiveTab('ws1', 't1');
    expect(unread()).toBe(0);
  });

  it('激活仍清除 tab 注意力标记(源 B 不回归)', () => {
    pushNotif('t1');
    useAppStore.getState().setActiveTab('ws1', 't1');
    const t1 = useAppStore
      .getState()
      .workspaces[0].tabs.find((t) => t.id === 't1')!;
    expect(t1.waiting).toBe(false);
    expect(t1.unseenDone).toBe(false);
  });

  it('派生计数不为负:重复激活无副作用', () => {
    pushNotif('t1');
    useAppStore.getState().setActiveTab('ws1', 't1');
    useAppStore.getState().setActiveTab('ws1', 't1');
    expect(unread()).toBe(0);
  });
});

describe('切工作区使其 active tab 可见 = 查看(external review · medium)', () => {
  function seedMulti(): void {
    useAppStore.setState({
      workspaces: [
        { id: 'wsA', name: 'A', root: '/a', tabs: [tab('a1')], activeTabId: 'a1' },
        {
          id: 'wsB',
          name: 'B',
          root: '/b',
          tabs: [tab('b1'), tab('b2')],
          activeTabId: 'b1',
        },
      ],
      activeWorkspaceId: 'wsA',
      notifications: [],
    });
  }
  beforeEach(seedMulti);

  it('后台工作区 active tab 收到通知 → 切到该工作区 → 角标 -1 + 注意力清除', () => {
    useAppStore
      .getState()
      .pushNotification({ workspaceId: 'wsB', tabId: 'b1', kind: 'done', text: 'x' });
    expect(unread()).toBe(1);
    useAppStore.getState().setActiveWorkspace('wsB'); // b1 随之可见
    expect(unread()).toBe(0);
    const b1 = useAppStore
      .getState()
      .workspaces.find((w) => w.id === 'wsB')!
      .tabs.find((t) => t.id === 'b1')!;
    expect(b1.waiting).toBe(false);
    expect(b1.unseenDone).toBe(false);
  });

  it('切工作区只清其 active tab · 同工作区其它后台 tab 通知保留', () => {
    const push = useAppStore.getState().pushNotification;
    push({ workspaceId: 'wsB', tabId: 'b1', kind: 'done', text: 'x' });
    push({ workspaceId: 'wsB', tabId: 'b2', kind: 'done', text: 'y' });
    expect(unread()).toBe(2);
    useAppStore.getState().setActiveWorkspace('wsB'); // active tab = b1
    expect(unread()).toBe(1); // b2 仍未读
  });

  it('切工作区不误清其它工作区的 tab 通知(隔离)', () => {
    useAppStore
      .getState()
      .pushNotification({ workspaceId: 'wsA', tabId: 'a1', kind: 'done', text: 'x' });
    useAppStore.getState().setActiveWorkspace('wsB');
    expect(unread()).toBe(1); // a1 的通知不受影响
  });
});

describe('通知中心既有路径不回归', () => {
  beforeEach(seed);

  it('"全部已读" → 角标归零', () => {
    pushNotif('t1');
    pushNotif('t2');
    expect(unread()).toBe(2);
    useAppStore.getState().markAllNotificationsRead();
    expect(unread()).toBe(0);
  });

  it('"清空" → 列表清空 · 角标归零', () => {
    pushNotif('t1');
    useAppStore.getState().clearNotifications();
    expect(useAppStore.getState().notifications.length).toBe(0);
    expect(unread()).toBe(0);
  });

  it('点击通知条流程(markNotificationRead+setActiveTab+clearTabAttention)→ 该 tab 全清', () => {
    pushNotif('t1');
    pushNotif('t1'); // 同 tab 多条
    const first = useAppStore.getState().notifications[0];
    // 复刻 NotificationCenter.handleItemClick 调用顺序
    useAppStore.getState().markNotificationRead(first.id);
    useAppStore.getState().setActiveTab('ws1', 't1');
    useAppStore.getState().clearTabAttention('t1');
    expect(unread()).toBe(0); // 同 tab 其余通知也被 setActiveTab 清掉
  });
});
