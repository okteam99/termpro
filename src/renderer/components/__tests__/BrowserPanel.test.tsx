// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BrowserPanel 轻量渲染测试:store.ts → terminalRegistry.ts 会拉入 @xterm/* 浏览器模块,
// 本测试只验证标签条渲染/交互,mock 掉终端注册表断开该链(复刻 FilePanelRemoteDisabled 的惯例)。
// jsdom 里 <webview> 是惰性自定义元素(不会真正加载页面),测试不触及导航/webview 事件。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(),
}));

import { BrowserPanel } from '../BrowserPanel';
import { useAppStore } from '../../state/store';
import type { BrowserTabState } from '../../state/store';

function seedTabs(tabs: BrowserTabState[], activeTabId: string | null): void {
  useAppStore.setState({
    browserTabs: tabs,
    browserActiveTabId: activeTabId,
    browserPanelOpen: true,
  } as unknown as Parameters<typeof useAppStore.setState>[0]);
}

beforeEach(() => {
  // window.okwork 不存在时 onBrowserOpenUrl 订阅要防御(组件用可选链),测试环境故意不 mock 它
  delete (window as unknown as Record<string, unknown>).okwork;
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ browserTabs: [], browserActiveTabId: null, browserPanelOpen: false });
});

describe('BrowserPanel', () => {
  it('渲染标签条:一空一有 url,活跃标签高亮', () => {
    seedTabs(
      [
        { id: 'empty', url: '' },
        { id: 'nav', url: 'https://example.com', title: 'Example' },
      ],
      'nav',
    );
    render(<BrowserPanel />);

    expect(screen.getByText('Example')).toBeInTheDocument();
    // 空标签兜底 host 解析失败 → t('New Tab')
    expect(screen.getByText('New Tab')).toBeInTheDocument();
    expect(screen.getByText('Example').closest('.browser-panel__tab')).toHaveClass(
      'browser-panel__tab--active',
    );
  });

  it('点 + 调 addBrowserTab 后新标签出现并激活', () => {
    seedTabs([{ id: 'a', url: 'https://example.com', title: 'Example' }], 'a');
    render(<BrowserPanel />);

    fireEvent.click(screen.getByTitle('New tab'));

    const tabs = useAppStore.getState().browserTabs;
    expect(tabs).toHaveLength(2);
    const newTabId = tabs[1].id;
    expect(useAppStore.getState().browserActiveTabId).toBe(newTabId);
  });

  it('空标签显示空态提示', () => {
    seedTabs([{ id: 'empty', url: '' }], 'empty');
    render(<BrowserPanel />);

    expect(screen.getByText('Enter a URL or search to get started')).toBeInTheDocument();
  });

  it('点 × 关闭标签后从条上消失', () => {
    seedTabs(
      [
        { id: 'a', url: 'https://example.com', title: 'Example' },
        { id: 'b', url: 'https://other.com', title: 'Other' },
      ],
      'a',
    );
    render(<BrowserPanel />);

    const closeBtn = screen.getByText('Example').closest('.browser-panel__tab')!.querySelector(
      '.browser-panel__tab-close',
    ) as HTMLElement;
    fireEvent.click(closeBtn);

    expect(screen.queryByText('Example')).not.toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(useAppStore.getState().browserTabs).toHaveLength(1);
  });

  it('tabs 为空时渲染 null(防御空列表死态)', () => {
    seedTabs([], null);
    const { container } = render(<BrowserPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
