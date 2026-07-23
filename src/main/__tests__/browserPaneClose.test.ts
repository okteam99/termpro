// 壳窗关闭决策(用户指令 2026-07-23):红灯钮 = 直接关闭浏览器(多标签先确认),
// 回落只走回落按钮;app 退出/冒烟不拦不清。main.ts 的 close/closed 事件按此分支。
import { describe, expect, it } from 'vitest';
import {
  PANE_CLOSE_CONFIRM_INDEX,
  buildPaneCloseConfirmationOptions,
  decidePaneClose,
  paneClosedNotice,
  paneTabCount,
} from '../browserPaneClose';

const base = {
  quitting: false,
  bypass: false,
  dockRequested: false,
  confirmed: false,
  confirming: false,
};

describe('paneTabCount(种子快照防御性收窄)', () => {
  it('正常快照数标签;缺失/畸形负载 → 0', () => {
    expect(paneTabCount({ tabs: [{ id: 'a' }, { id: 'b' }], activeTabId: 'a' })).toBe(2);
    expect(paneTabCount({ tabs: [] })).toBe(0);
    expect(paneTabCount(undefined)).toBe(0);
    expect(paneTabCount(null)).toBe(0);
    expect(paneTabCount({ tabs: 'nope' })).toBe(0);
    expect(paneTabCount('garbage')).toBe(0);
  });
});

describe('decidePaneClose(红灯钮关闭分支)', () => {
  it('单标签/空窗格直接放行(无确认)', () => {
    expect(decidePaneClose({ ...base, tabCount: 0 })).toBe('proceed');
    expect(decidePaneClose({ ...base, tabCount: 1 })).toBe('proceed');
  });

  it('多标签 → 弹确认;确认框在挂时再关 → ignore(不重复弹)', () => {
    expect(decidePaneClose({ ...base, tabCount: 2 })).toBe('confirm');
    expect(decidePaneClose({ ...base, tabCount: 5, confirming: true })).toBe('ignore');
  });

  it('确认后二次 close 放行;回落发起(dock)免确认', () => {
    expect(decidePaneClose({ ...base, tabCount: 5, confirmed: true })).toBe('proceed');
    expect(decidePaneClose({ ...base, tabCount: 5, dockRequested: true })).toBe('proceed');
  });

  it('app 退出/冒烟旁路:多标签也放行(退出时镜像要原样持久化)', () => {
    expect(decidePaneClose({ ...base, tabCount: 5, quitting: true })).toBe('proceed');
    expect(decidePaneClose({ ...base, tabCount: 5, bypass: true })).toBe('proceed');
  });
});

describe('paneClosedNotice(closed 后给主窗的通知路由)', () => {
  it('回落 → docked;直接关 → closed;退出中 → null(不污染持久化镜像)', () => {
    expect(paneClosedNotice({ dockRequested: true, quitting: false })).toBe(
      'browserPane:docked',
    );
    expect(paneClosedNotice({ dockRequested: false, quitting: false })).toBe(
      'browserPane:closed',
    );
    expect(paneClosedNotice({ dockRequested: false, quitting: true })).toBeNull();
    expect(paneClosedNotice({ dockRequested: true, quitting: true })).toBeNull();
  });
});

describe('buildPaneCloseConfirmationOptions(确认框文案)', () => {
  it('标题/按钮/默认取消;message 插入标签数', () => {
    const opts = buildPaneCloseConfirmationOptions(3);
    expect(opts.title).toBe('Close all browser tabs?');
    expect(opts.message).toContain('3 browser tabs');
    expect(opts.buttons).toEqual(['Cancel', 'Close All']);
    expect(opts.buttons[PANE_CLOSE_CONFIRM_INDEX]).toBe('Close All');
    expect(opts.defaultId).toBe(0);
    expect(opts.cancelId).toBe(0);
  });
});
