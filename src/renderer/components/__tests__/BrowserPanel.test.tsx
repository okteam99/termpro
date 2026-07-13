// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BrowserPanel 轻量渲染测试:store.ts → terminalRegistry.ts 会拉入 @xterm/* 浏览器模块,
// 本测试只验证标签条渲染/交互,mock 掉终端注册表断开该链(复刻 FilePanelRemoteDisabled 的惯例)。
// jsdom 里 <webview> 是惰性自定义元素(不会真正加载页面),测试不触及导航/webview 事件。
//
// 浏览器窗格现已绑定终端 tab(TabState.browser),不再有全局 browserTabs/browserActiveTabId——
// 测试改为播一个含终端 tab 的 workspace,给该 tab 种 browser 窗格(参考 browserPanel.test.ts 的
// seedWorkspace)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(),
}));

import { BrowserPanel } from '../BrowserPanel';
import { useAppStore } from '../../state/store';
import type { BrowserPaneState, WorkspaceState } from '../../state/store';

const TERM = 'term1';

/** 播一个含单个终端 tab(id=term1)的本机 workspace,并给该 tab 装配指定的浏览器窗格。 */
function seedWorkspace(browser?: BrowserPaneState): void {
  const ws: WorkspaceState = {
    id: 'ws1',
    name: 'w',
    root: '/w',
    hostId: 'local',
    tabs: [{ id: TERM, title: 't', cwd: '/w', browser }],
    activeTabId: TERM,
  };
  useAppStore.setState({
    workspaces: [ws],
    activeWorkspaceId: 'ws1',
    browserPanelOpen: true,
  });
}

beforeEach(() => {
  // window.okwork 不存在时 onBrowserOpenUrl 订阅要防御(组件用可选链),测试环境故意不 mock 它
  delete (window as unknown as Record<string, unknown>).okwork;
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null, browserPanelOpen: false });
});

describe('BrowserPanel', () => {
  it('渲染标签条:一空一有 url,活跃标签高亮', () => {
    seedWorkspace({
      tabs: [
        { id: 'empty', url: '' },
        { id: 'nav', url: 'https://example.com', title: 'Example' },
      ],
      activeTabId: 'nav',
    });
    render(<BrowserPanel />);

    expect(screen.getByText('Example')).toBeInTheDocument();
    // 空标签兜底 host 解析失败 → t('New Tab')
    expect(screen.getByText('New Tab')).toBeInTheDocument();
    expect(screen.getByText('Example').closest('.browser-panel__tab')).toHaveClass(
      'browser-panel__tab--active',
    );
  });

  it('点 + 调 addBrowserTab 后新标签出现并激活(落在当前活跃终端 tab)', () => {
    seedWorkspace({
      tabs: [{ id: 'a', url: 'https://example.com', title: 'Example' }],
      activeTabId: 'a',
    });
    render(<BrowserPanel />);

    fireEvent.click(screen.getByTitle('New tab'));

    const pane = useAppStore.getState().workspaces[0].tabs[0].browser;
    expect(pane?.tabs).toHaveLength(2);
    const newTabId = pane!.tabs[1].id;
    expect(pane?.activeTabId).toBe(newTabId);
  });

  it('空标签显示空态提示', () => {
    seedWorkspace({ tabs: [{ id: 'empty', url: '' }], activeTabId: 'empty' });
    render(<BrowserPanel />);

    expect(screen.getByText('Enter a URL or search to get started')).toBeInTheDocument();
  });

  it('点 × 关闭标签后从条上消失', () => {
    seedWorkspace({
      tabs: [
        { id: 'a', url: 'https://example.com', title: 'Example' },
        { id: 'b', url: 'https://other.com', title: 'Other' },
      ],
      activeTabId: 'a',
    });
    render(<BrowserPanel />);

    const closeBtn = screen.getByText('Example').closest('.browser-panel__tab')!.querySelector(
      '.browser-panel__tab-close',
    ) as HTMLElement;
    fireEvent.click(closeBtn);

    expect(screen.queryByText('Example')).not.toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(useAppStore.getState().workspaces[0].tabs[0].browser?.tabs).toHaveLength(1);
  });

  it('活跃终端 tab 无浏览器窗格时,面板仍渲染(自动种一个空标签,不再 return null)', () => {
    seedWorkspace(undefined);
    render(<BrowserPanel />);

    // 面板打开且当前 tab 无窗格 → effect 自动种一个空标签,标签条不再是空的
    expect(useAppStore.getState().workspaces[0].tabs[0].browser?.tabs).toHaveLength(1);
    expect(screen.getByText('Enter a URL or search to get started')).toBeInTheDocument();
  });

  it('切换活跃终端 tab 后,面板反映新 tab 的浏览器窗格(跟随切换,像文件面板)', () => {
    const ws: WorkspaceState = {
      id: 'ws1',
      name: 'w',
      root: '/w',
      hostId: 'local',
      tabs: [
        {
          id: 'term1',
          title: 't1',
          cwd: '/w',
          browser: { tabs: [{ id: 'a', url: 'https://a.com', title: 'A' }], activeTabId: 'a' },
        },
        {
          id: 'term2',
          title: 't2',
          cwd: '/w',
          browser: { tabs: [{ id: 'b', url: 'https://b.com', title: 'B' }], activeTabId: 'b' },
        },
      ],
      activeTabId: 'term1',
    };
    useAppStore.setState({ workspaces: [ws], activeWorkspaceId: 'ws1', browserPanelOpen: true });
    const { rerender } = render(<BrowserPanel />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();

    useAppStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => ({ ...w, activeTabId: 'term2' })),
    }));
    rerender(<BrowserPanel />);

    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });
});

describe('BrowserPanel · window.open 按来源落位', () => {
  /** 两个终端 tab 各带一个已导航的浏览器标签;term1 活跃,term2 后台。 */
  function seedTwoTermTabs(): void {
    const ws: WorkspaceState = {
      id: 'ws1',
      name: 'w',
      root: '/w',
      hostId: 'local',
      tabs: [
        {
          id: 'term1',
          title: 't1',
          cwd: '/w',
          browser: { tabs: [{ id: 'a', url: 'https://a.com', title: 'A' }], activeTabId: 'a' },
        },
        {
          id: 'term2',
          title: 't2',
          cwd: '/w',
          browser: { tabs: [{ id: 'b', url: 'https://b.com', title: 'B' }], activeTabId: 'b' },
        },
      ],
      activeTabId: 'term1',
    };
    useAppStore.setState({ workspaces: [ws], activeWorkspaceId: 'ws1', browserPanelOpen: true });
  }

  /** mock window.okwork.onBrowserOpenUrl,捕获组件订阅的回调供测试主动触发。 */
  function mockOpenUrlChannel(): { fire: (url: string, sourceId: number) => void } {
    let captured: ((url: string, sourceId: number) => void) | undefined;
    (window as unknown as Record<string, unknown>).okwork = {
      onBrowserOpenUrl(cb: (url: string, sourceId: number) => void) {
        captured = cb;
        return () => {};
      },
    };
    return { fire: (url, sourceId) => captured?.(url, sourceId) };
  }

  it('后台终端 tab 的 webview 弹窗 → 新标签落回该 tab 的窗格并激活,不抢终端焦点、不动活跃窗格', () => {
    const channel = mockOpenUrlChannel();
    seedTwoTermTabs();
    render(<BrowserPanel />);

    // jsdom 的 <webview> 是惰性元素,不带 getWebContentsId——给「来源」(term2 的 b)打上桩
    const views = Array.from(document.querySelectorAll('webview'));
    const sourceView = views.find((v) => v.getAttribute('src') === 'https://b.com')!;
    (sourceView as unknown as { getWebContentsId(): number }).getWebContentsId = () => 222;

    act(() => channel.fire('https://popup.com', 222));

    const [term1, term2] = useAppStore.getState().workspaces[0].tabs;
    expect(term2.browser?.tabs).toHaveLength(2);
    expect(term2.browser?.tabs[1].url).toBe('https://popup.com');
    expect(term2.browser?.activeTabId).toBe(term2.browser?.tabs[1].id); // 窗格内激活,回来即见
    expect(term1.browser?.tabs).toHaveLength(1); // 活跃 tab 的窗格不被打扰
    expect(useAppStore.getState().workspaces[0].activeTabId).toBe('term1'); // 不抢终端焦点
    expect(screen.queryByText('popup.com')).not.toBeInTheDocument(); // 面板仍展示 term1 的标签条
  });

  it('来源反查不中(id 无匹配)→ 回退落到当前活跃终端 tab 的窗格', () => {
    const channel = mockOpenUrlChannel();
    seedTwoTermTabs();
    render(<BrowserPanel />);

    act(() => channel.fire('https://fallback.com', 999));

    const [term1, term2] = useAppStore.getState().workspaces[0].tabs;
    expect(term1.browser?.tabs).toHaveLength(2);
    expect(term1.browser?.tabs[1].url).toBe('https://fallback.com');
    expect(term2.browser?.tabs).toHaveLength(1);
  });
});
