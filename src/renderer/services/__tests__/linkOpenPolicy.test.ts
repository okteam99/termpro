// @vitest-environment jsdom
// 终端链接打开策略(设置项 linkBrowserMode · 用户指令 2026-07-14):
// builtin(默认)恒内置;system 恒系统;builtinForRemote 仅远程终端 tab 用内置。
// 返回 true=已落内置窗格(面板打开+标签落到来源 tab);false=调用方走系统浏览器。

import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../state/store';
import type { WorkspaceState } from '../../state/store';
import { openTerminalLinkViaPolicy } from '../linkOpenPolicy';

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

function paneUrlsOf(tabId: string): string[] {
  for (const w of useAppStore.getState().workspaces) {
    const tab = w.tabs.find((t) => t.id === tabId);
    if (tab) return (tab.browser?.tabs ?? []).map((b) => b.url);
  }
  return [];
}

beforeEach(() => {
  useAppStore.setState({
    workspaces: [ws('w-local', 'local', ['t-local']), ws('w-remote', 'cfg-1', ['t-remote'])],
    activeWorkspaceId: 'w-local',
    browserPanelOpen: false,
    linkBrowserMode: 'builtin',
    // 路由(内置/系统)与落位(面板/独立窗口)是两件事:本文件只测路由,
    // 故钉死落位为面板;独立窗口分支在 openBuiltinBrowser.test.ts 覆盖。
    builtinBrowserSurface: 'pane',
  });
});

describe('openTerminalLinkViaPolicy', () => {
  it("builtin(默认):本机/远程 tab 一律落内置窗格,面板打开", () => {
    expect(openTerminalLinkViaPolicy('t-local', 'https://a.dev/1')).toBe(true);
    expect(paneUrlsOf('t-local')).toEqual(['https://a.dev/1']);
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
    expect(openTerminalLinkViaPolicy('t-remote', 'https://a.dev/2')).toBe(true);
    expect(paneUrlsOf('t-remote')).toEqual(['https://a.dev/2']);
  });

  it("system:恒返回 false,不动内置窗格/面板", () => {
    useAppStore.setState({ linkBrowserMode: 'system' });
    expect(openTerminalLinkViaPolicy('t-local', 'https://a.dev/1')).toBe(false);
    expect(openTerminalLinkViaPolicy('t-remote', 'https://a.dev/2')).toBe(false);
    expect(paneUrlsOf('t-local')).toEqual([]);
    expect(paneUrlsOf('t-remote')).toEqual([]);
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
  });

  it("builtinForRemote:远程 tab 落内置,本机 tab 走系统", () => {
    useAppStore.setState({ linkBrowserMode: 'builtinForRemote' });
    expect(openTerminalLinkViaPolicy('t-remote', 'https://a.dev/r')).toBe(true);
    expect(paneUrlsOf('t-remote')).toEqual(['https://a.dev/r']);
    expect(openTerminalLinkViaPolicy('t-local', 'https://a.dev/l')).toBe(false);
    expect(paneUrlsOf('t-local')).toEqual([]);
  });

  it("builtinForRemote:tab 归属不明(已关竞态)→ 按本机语义走系统(安全降级)", () => {
    useAppStore.setState({ linkBrowserMode: 'builtinForRemote' });
    expect(openTerminalLinkViaPolicy('t-gone', 'https://a.dev/x')).toBe(false);
  });
});
