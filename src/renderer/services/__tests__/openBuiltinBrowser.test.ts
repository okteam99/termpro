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

    expect(addTab).toHaveBeenCalledWith('t-1', 'https://a.dev/2');
    expect(popout).toHaveBeenCalledTimes(1); // 没有二次弹窗
    expect(paneOf('t-1')?.tabs.length).toBe(before);
  });

  it('tab 已关(竞态):不弹窗,不抛错', () => {
    openBuiltinBrowser('t-gone', 'https://a.dev/x');
    expect(popout).not.toHaveBeenCalled();
  });
});
