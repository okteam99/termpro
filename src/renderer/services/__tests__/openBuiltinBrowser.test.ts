// @vitest-environment jsdom
// 内置浏览器落位(设置项 builtinBrowserSurface · 用户指令 2026-07-20):
// 手动摆放优先 —— 已弹出 → 转投壳窗;已在面板显示 → 就地追加;都没有 → 按设置项。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/store';
import type { WorkspaceState } from '../../state/store';
import { openBuiltinBrowser } from '../openBuiltinBrowser';

function ws(id: string, hostId: string, tabIds: string[]): WorkspaceState {
  return {
    id,
    name: id,
    root: `/r/${id}`,
    hostId,
    tabs: tabIds.map((t) => ({ id: t, title: t, cwd: `/r/${id}` })),
    activeTabId: tabIds[0] ?? null,
  };
}

function paneOf(tabId: string) {
  for (const w of useAppStore.getState().workspaces) {
    const tab = w.tabs.find((t) => t.id === tabId);
    if (tab) return tab.browser ?? null;
  }
  return null;
}

const popout = vi.fn();
const addTab = vi.fn();

beforeEach(() => {
  popout.mockClear();
  addTab.mockClear();
  Object.defineProperty(window, 'okwork', {
    value: { browserPane: { popout, addTab } },
    writable: true,
    configurable: true,
  });
  useAppStore.setState({
    workspaces: [ws('w-local', 'local', ['t-1'])],
    activeWorkspaceId: 'w-local',
    browserPanelOpen: false,
    builtinBrowserSurface: 'window',
  });
});

describe('openBuiltinBrowser', () => {
  it("'window'(默认):种标签 → 带完整快照弹窗 + 主窗收面板标 poppedOut", () => {
    openBuiltinBrowser('t-1', 'https://a.dev/1');

    expect(popout).toHaveBeenCalledTimes(1);
    const payload = popout.mock.calls[0][0];
    expect(payload.terminalTabId).toBe('t-1');
    expect(payload.ownerHostId).toBe('local');
    // 🔴 快照必须含新链接:壳窗以它起步并接管所有权,漏了链接就丢了
    expect(payload.pane.tabs.map((b: { url: string }) => b.url)).toEqual(['https://a.dev/1']);
    expect(payload.pane.activeTabId).toBe(payload.pane.tabs[0].id);

    expect(paneOf('t-1')?.poppedOut).toBe(true);
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
  });

  it("'pane':落主窗面板,不弹窗", () => {
    useAppStore.setState({ builtinBrowserSurface: 'pane' });
    openBuiltinBrowser('t-1', 'https://a.dev/1');

    expect(popout).not.toHaveBeenCalled();
    expect(paneOf('t-1')?.tabs.map((b) => b.url)).toEqual(['https://a.dev/1']);
    expect(paneOf('t-1')?.poppedOut).toBeUndefined();
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
  });

  it("'window' 但窗格已在面板里显示 → 就地追加,不搬家", () => {
    useAppStore.setState({ builtinBrowserSurface: 'pane' });
    openBuiltinBrowser('t-1', 'https://a.dev/1'); // 先在面板开一个
    useAppStore.setState({ builtinBrowserSurface: 'window' });

    openBuiltinBrowser('t-1', 'https://a.dev/2');

    expect(popout).not.toHaveBeenCalled();
    expect(paneOf('t-1')?.tabs.map((b) => b.url)).toEqual([
      'https://a.dev/1',
      'https://a.dev/2',
    ]);
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
  });

  it('窗格已弹出 → 转投壳窗(主窗镜像不种标签)', () => {
    openBuiltinBrowser('t-1', 'https://a.dev/1'); // 弹出
    const before = paneOf('t-1')?.tabs.length ?? 0;

    openBuiltinBrowser('t-1', 'https://a.dev/2');

    expect(addTab).toHaveBeenCalledWith('t-1', 'https://a.dev/2', undefined);
    expect(popout).toHaveBeenCalledTimes(1); // 没有二次弹窗
    expect(paneOf('t-1')?.tabs.length).toBe(before);
  });

  it('opts(netHostId/preview)透传:面板落位分支物化到新标签', () => {
    useAppStore.setState({ builtinBrowserSurface: 'pane' });
    openBuiltinBrowser('t-1', 'https://a.dev/1', { netHostId: 'cfg-9', preview: true });
    expect(paneOf('t-1')?.tabs[0]).toMatchObject({ netHostId: 'cfg-9', preview: true });
  });

  it('opts(netHostId/preview)透传:已弹出转投分支原样转给壳窗', () => {
    openBuiltinBrowser('t-1', 'https://a.dev/1'); // 先弹出独立窗口
    openBuiltinBrowser('t-1', 'https://a.dev/2', { netHostId: 'cfg-7', preview: true });
    expect(addTab).toHaveBeenLastCalledWith('t-1', 'https://a.dev/2', {
      netHostId: 'cfg-7',
      preview: true,
    });
  });

  it('opts(netHostId/preview)透传:独立窗口初次弹出的快照里,新标签自带 opts(popout 天然带上)', () => {
    openBuiltinBrowser('t-1', 'https://a.dev/1', { netHostId: 'cfg-9', preview: true });
    const payload = popout.mock.calls[0][0];
    expect(payload.pane.tabs[0]).toMatchObject({ netHostId: 'cfg-9', preview: true });
  });

  it('tab 已关(竞态):不弹窗,不抛错', () => {
    openBuiltinBrowser('t-gone', 'https://a.dev/x');
    expect(popout).not.toHaveBeenCalled();
  });

  // P1-1 回归:window 分支落独立窗口时,addBrowserTab 顺手收起的文件面板
  // (store 互斥语义)必须在 popOutBrowserPane 之后还原——浏览器从未占用主窗面板槽。
  it('P1-1:文件面板展开时点地球落独立窗口 → 弹窗后还原文件面板态', () => {
    useAppStore.setState({ filePanelCollapsed: false }); // 用户开着文件面板

    openBuiltinBrowser('t-1', 'https://a.dev/1');

    expect(popout).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
    // 还原,不是残留 addBrowserTab 顺手收起的 true
    expect(useAppStore.getState().filePanelCollapsed).toBe(false);
  });

  it('P1-1:文件面板本就收起时点地球落独立窗口 → 收起态不变', () => {
    useAppStore.setState({ filePanelCollapsed: true });

    openBuiltinBrowser('t-1', 'https://a.dev/1');

    expect(popout).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
  });

  it('P1-1:tab 已关竞态(~40 行早退)不还原文件面板——面板此时真的开着', () => {
    useAppStore.setState({ filePanelCollapsed: false });

    openBuiltinBrowser('t-gone', 'https://a.dev/x');

    expect(popout).not.toHaveBeenCalled();
    // addBrowserTab 已把 browserPanelOpen/filePanelCollapsed 都置 true(即便 tab 不存在),
    // 早退分支没有 popOutBrowserPane,面板态不该被还原成还原前的 false
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
  });
});
