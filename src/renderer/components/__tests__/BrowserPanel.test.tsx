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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    browserPanelOpen: false,
    browserProfiles: [],
    browserProfilesLoaded: false,
  });
});

describe('Remote Profile login-continuity hydration gate', () => {
  it('test_AC9_browser_reports_restored_or_paused_without_cookie_details', async () => {
    let resolvePrepare!: (result: {
      ready: false;
      reason: 'PROFILE_CONTINUITY_OFFLINE';
      canRetry: true;
    }) => void;
    const pendingPrepare = new Promise<{
      ready: false;
      reason: 'PROFILE_CONTINUITY_OFFLINE';
      canRetry: true;
    }>((resolve) => {
      resolvePrepare = resolve;
    });
    const prepareContinuity = vi
      .fn()
      .mockReturnValueOnce(pendingPrepare)
      .mockResolvedValueOnce({ ready: true, syncedCount: 4, skippedCount: 1 });
    (window as unknown as { okwork: unknown }).okwork = {
      browserProfile: { prepareContinuity },
    };

    seedWorkspace({
      tabs: [{ id: 'remote-tab', url: 'https://example.com', title: 'Example' }],
      activeTabId: 'remote-tab',
    });
    useAppStore.setState((state) => ({
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        browserProfileId: 'remote-profile',
      })),
      browserProfilesLoaded: true,
      browserProfiles: [
        {
          id: 'remote-profile',
          name: 'Shared work',
          createdAt: 1,
          storage: { kind: 'remote', hostId: 'host-a' },
          storageLabel: 'Remote A',
          availability: 'ready',
          loginContinuity: {
            state: 'paused',
            syncedCount: 0,
            pendingCount: 1,
            skippedCount: 0,
            conflictCount: 0,
            reasons: ['PROFILE_CONTINUITY_OFFLINE'],
            canRetry: true,
          },
        },
      ],
    }));

    const { rerender } = render(<BrowserPanel />);
    await waitFor(() => expect(prepareContinuity).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Restoring login status…')).toBeInTheDocument();
    expect(document.querySelector('webview')).toBeNull();

    await act(async () => {
      resolvePrepare({
        ready: false,
        reason: 'PROFILE_CONTINUITY_OFFLINE',
        canRetry: true,
      });
      await pendingPrepare;
    });
    expect(screen.getAllByText('Login continuity is paused').length).toBeGreaterThan(0);
    expect(screen.getByText(/No website request was sent\./)).toBeInTheDocument();
    expect(document.querySelector('webview')).toBeNull();

    useAppStore.setState((state) => ({
      browserProfiles: state.browserProfiles.map((profile) => ({
        ...profile,
        loginContinuity: profile.loginContinuity
          ? { ...profile.loginContinuity, state: 'synced', pendingCount: 0 }
          : undefined,
      })),
    }));
    rerender(<BrowserPanel />);
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => expect(document.querySelector('webview')).not.toBeNull());
    // 连续性状态已并入导航行密码胶囊的弹层(用户指令 2026-08-14:地址栏下方不再挂
    // 常驻横幅)。恢复完成属「无需动手」的信息态,故点开才看——报告本身没丢。
    fireEvent.click(screen.getByRole('button', { name: /Password storage/ }));
    expect(screen.getByText('Login status restored')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('cookie-name-secret');
    expect(document.body.textContent).not.toContain('cookie-value-secret');
  });

  it('does not commit manual navigation until Remote Profile hydration is ready', async () => {
    let resolvePrepare!: (result: {
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }) => void;
    const pendingPrepare = new Promise<{
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }>((resolve) => {
      resolvePrepare = resolve;
    });
    const prepareContinuity = vi.fn().mockReturnValue(pendingPrepare);
    (window as unknown as { okwork: unknown }).okwork = {
      browserProfile: { prepareContinuity },
    };
    seedWorkspace({
      tabs: [{ id: 'remote-empty', url: '' }],
      activeTabId: 'remote-empty',
    });
    useAppStore.setState((state) => ({
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        browserProfileId: 'remote-profile',
      })),
      browserProfilesLoaded: true,
      browserProfiles: [
        {
          id: 'remote-profile',
          name: 'Shared work',
          createdAt: 1,
          storage: { kind: 'remote', hostId: 'host-a' },
          storageLabel: 'Remote A',
          availability: 'ready',
        },
      ],
    }));
    render(<BrowserPanel />);
    const input = document.querySelector<HTMLInputElement>(
      '.browser-panel__address-input',
    )!;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'aon.pro' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(prepareContinuity).toHaveBeenCalledWith({
      profileId: 'remote-profile',
      netHostId: 'local',
    });
    expect(document.querySelector('webview')).toBeNull();
    expect(
      useAppStore.getState().workspaces[0].tabs[0].browser!.tabs[0].url,
    ).toBe('');

    await act(async () => {
      resolvePrepare({ ready: true, syncedCount: 1, skippedCount: 0 });
      await pendingPrepare;
    });
    await waitFor(() =>
      expect(document.querySelector('webview')).toHaveAttribute(
        'src',
        'https://aon.pro',
      ),
    );
    expect(
      useAppStore.getState().workspaces[0].tabs[0].browser!.tabs[0].url,
    ).toBe('https://aon.pro');
  });
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
        return () => undefined;
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

describe('主帧加载失败错误条(空白页自解释 · 2026-07-14)', () => {
  function failEvent(over: Record<string, unknown> = {}): Event {
    return Object.assign(new Event('did-fail-load'), {
      errorCode: -102,
      errorDescription: 'ERR_CONNECTION_REFUSED',
      isMainFrame: true,
      ...over,
    });
  }

  it('did-fail-load(主帧)→ 错误条亮出 Chromium 错误码;did-start-loading 清除', () => {
    seedWorkspace({
      tabs: [{ id: 'a', url: 'http://localhost:44583/offers/new' }],
      activeTabId: 'a',
    });
    render(<BrowserPanel />);
    const view = document.querySelector('webview')!;

    act(() => {
      view.dispatchEvent(failEvent());
    });
    expect(screen.getByRole('alert')).toHaveTextContent('ERR_CONNECTION_REFUSED (-102)');

    // 重新导航即清(错误条只描述当前页)
    act(() => {
      view.dispatchEvent(new Event('did-start-loading'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('子帧失败 / ERR_ABORTED(-3) 不亮错误条(正常噪声)', () => {
    seedWorkspace({
      tabs: [{ id: 'a', url: 'https://example.com' }],
      activeTabId: 'a',
    });
    render(<BrowserPanel />);
    const view = document.querySelector('webview')!;

    act(() => {
      view.dispatchEvent(failEvent({ isMainFrame: false }));
      view.dispatchEvent(failEvent({ errorCode: -3, errorDescription: 'ERR_ABORTED' }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('地址栏手动导航(用户报告 2026-07-23:失败页地址栏回退旧地址)', () => {
  it('回车即回写 store url/标签名(不等 did-navigate;失败页也不回退)', () => {
    seedWorkspace({
      tabs: [{ id: 'a', url: 'https://www.baidu.com/', title: '百度一下' }],
      activeTabId: 'a',
    });
    render(<BrowserPanel />);
    const view = document.querySelector('webview')!;
    const loadURL = vi.fn();
    (view as unknown as { loadURL: unknown }).loadURL = loadURL;

    const input = document.querySelector<HTMLInputElement>('.browser-panel__address-input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'aon.pro' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(loadURL).toHaveBeenCalledWith('https://aon.pro');
    const bt = useAppStore.getState().workspaces[0].tabs[0].browser!.tabs[0];
    expect(bt.url).toBe('https://aon.pro'); // 地址栏值 = store url,立即切换
    expect(bt.title).toBe('aon.pro'); // 标签名先落目标 host,成功后被真实标题覆盖
  });
});

describe('窗格窗口化(弹出=整个窗格独立成窗 · 2026-07-14)', () => {
  it('点头部弹出 → browserPane.popout(完整窗格快照) + 主窗收面板标 poppedOut', () => {
    const popout = vi.fn();
    (window as unknown as { okwork: unknown }).okwork = { browserPane: { popout } };
    seedWorkspace({
      tabs: [
        { id: 'a', url: 'https://example.com/x', title: 'Example', netHostId: 'cfg-1' },
        { id: 'b', url: 'https://b.dev', title: 'B' },
      ],
      activeTabId: 'a',
    });
    render(<BrowserPanel />);

    fireEvent.click(screen.getByTitle('Move this browser to a separate window'));

    expect(popout).toHaveBeenCalledTimes(1);
    const payload = popout.mock.calls[0][0];
    expect(payload.terminalTabId).toBe(TERM);
    expect(payload.ownerHostId).toBe('local');
    expect(payload.workspaceName).toBe('w'); // 壳窗工作区编辑弹层的名称初值
    expect(payload.pane.tabs.map((b: { id: string }) => b.id)).toEqual(['a', 'b']);
    expect(payload.pane.activeTabId).toBe('a');

    const s = useAppStore.getState();
    expect(s.workspaces[0].tabs[0].browser?.poppedOut).toBe(true);
    expect(s.browserPanelOpen).toBe(false); // 弹出后主窗没有 panel
  });

  it('弹出中的窗格:占位+聚焦入口,不渲染其 webview;回落清标记', () => {
    const focus = vi.fn();
    (window as unknown as { okwork: unknown }).okwork = { browserPane: { focus } };
    seedWorkspace({
      tabs: [{ id: 'a', url: 'https://example.com/x', title: 'Example' }],
      activeTabId: 'a',
      poppedOut: true,
    });
    useAppStore.setState({ browserPanelOpen: true });
    render(<BrowserPanel />);

    // 占位可见,标签条/webview 不渲染(内容归壳窗)
    expect(screen.getByText('This browser is open in a separate window')).toBeInTheDocument();
    expect(document.querySelectorAll('webview')).toHaveLength(0);
    fireEvent.click(screen.getByText('Focus window'));
    expect(focus).toHaveBeenCalledWith(TERM);

    // 回落:清 poppedOut(镜像内容保留)
    act(() => useAppStore.getState().dockBrowserPane(TERM));
    const pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.poppedOut).toBeUndefined();
    expect(pane.tabs).toHaveLength(1);
  });

  it('壳窗回流镜像:applyPoppedPaneSync 替换内容保持 poppedOut', () => {
    seedWorkspace({
      tabs: [{ id: 'a', url: 'https://old.dev' }],
      activeTabId: 'a',
      poppedOut: true,
    });
    useAppStore.getState().applyPoppedPaneSync(TERM, {
      tabs: [
        { id: 'a', url: 'https://new.dev', title: 'New' },
        { id: 'n2', url: 'https://n2.dev', netHostId: 'cfg-9' },
      ],
      activeTabId: 'n2',
    });
    const pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.poppedOut).toBe(true);
    expect(pane.tabs.map((b) => b.url)).toEqual(['https://new.dev', 'https://n2.dev']);
    expect(pane.activeTabId).toBe('n2');
  });

  it('独立窗口直接关闭(红灯钮/标签关光):closePoppedPane 清空镜像、清标记,不开面板', () => {
    seedWorkspace({
      tabs: [
        { id: 'a', url: 'https://a.dev' },
        { id: 'b', url: 'https://b.dev' },
      ],
      activeTabId: 'a',
      poppedOut: true,
    });
    useAppStore.setState({ browserPanelOpen: false }); // 弹出期间主窗无面板
    act(() => useAppStore.getState().closePoppedPane(TERM));

    const pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.tabs).toEqual([]);
    expect(pane.activeTabId).toBeNull();
    expect(pane.poppedOut).toBeUndefined();
    // 与回落(dockBrowserPane)相反:不重开面板——浏览器就此关闭
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
  });

  it('弹出期间:弹出入口禁用(不可二次弹出);种空标签的 effect 不往镜像里种', () => {
    (window as unknown as { okwork: unknown }).okwork = { browserPane: {} };
    seedWorkspace({ tabs: [], activeTabId: null, poppedOut: true });
    render(<BrowserPanel />);

    expect(screen.getByTitle('Move this browser to a separate window')).toBeDisabled();
    // 弹出中窗格为空也不种标签(内容归壳窗;effect 的 activePopped 守卫)
    expect(useAppStore.getState().workspaces[0].tabs[0].browser?.tabs).toEqual([]);
  });
});

describe('头部 ✕ 三态确认(Cancel/Close All/Hide · 用户指令 2026-08-04)', () => {
  function seedTwoTabs(): void {
    seedWorkspace({
      tabs: [
        { id: 'a', url: 'https://a.dev', title: 'A' },
        { id: 'b', url: 'https://b.dev', title: 'B' },
      ],
      activeTabId: 'a',
    });
  }

  function clickClose(): void {
    fireEvent.click(screen.getByTitle('Hide browser'));
  }

  it('窗格标签数 ≤ 1:直接收起面板(现行为),不弹确认、不碰桥', () => {
    const confirmClose = vi.fn();
    (window as unknown as { okwork: unknown }).okwork = {
      browserPanel: { confirmClose },
    };
    seedWorkspace({ tabs: [{ id: 'a', url: 'https://a.dev', title: 'A' }], activeTabId: 'a' });
    render(<BrowserPanel />);

    clickClose();

    expect(confirmClose).not.toHaveBeenCalled();
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
  });

  it('多标签 + 选「Close All」:关掉窗格全部浏览器标签,面板随之关', async () => {
    const confirmClose = vi.fn().mockResolvedValue('closeAll');
    (window as unknown as { okwork: unknown }).okwork = {
      browserPanel: { confirmClose },
    };
    seedTwoTabs();
    render(<BrowserPanel />);

    await act(async () => {
      clickClose();
      await Promise.resolve();
    });

    expect(confirmClose).toHaveBeenCalledWith(2);
    const pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.tabs).toEqual([]);
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
  });

  it('多标签 + 选「Hide」:面板收起(现行为),标签保留', async () => {
    const confirmClose = vi.fn().mockResolvedValue('hide');
    (window as unknown as { okwork: unknown }).okwork = {
      browserPanel: { confirmClose },
    };
    seedTwoTabs();
    render(<BrowserPanel />);

    await act(async () => {
      clickClose();
      await Promise.resolve();
    });

    expect(useAppStore.getState().browserPanelOpen).toBe(false);
    expect(useAppStore.getState().workspaces[0].tabs[0].browser?.tabs).toHaveLength(2); // 标签保留
  });

  it('多标签 + 选「Cancel」:什么都不做', async () => {
    const confirmClose = vi.fn().mockResolvedValue('cancel');
    (window as unknown as { okwork: unknown }).okwork = {
      browserPanel: { confirmClose },
    };
    seedTwoTabs();
    render(<BrowserPanel />);

    await act(async () => {
      clickClose();
      await Promise.resolve();
    });

    expect(useAppStore.getState().browserPanelOpen).toBe(true); // 不动
    expect(useAppStore.getState().workspaces[0].tabs[0].browser?.tabs).toHaveLength(2);
  });

  it('桥不存在(测试态/旧 preload):兜底直接收起面板(与现行为一致)', async () => {
    delete (window as unknown as Record<string, unknown>).okwork;
    seedTwoTabs();
    render(<BrowserPanel />);

    await act(async () => {
      clickClose();
      await Promise.resolve();
    });

    expect(useAppStore.getState().browserPanelOpen).toBe(false);
    expect(useAppStore.getState().workspaces[0].tabs[0].browser?.tabs).toHaveLength(2); // 标签保留
  });
});
