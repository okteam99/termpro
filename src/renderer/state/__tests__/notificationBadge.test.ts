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
