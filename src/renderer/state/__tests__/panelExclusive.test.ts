// @vitest-environment jsdom
// SideRail 面板互斥:浏览器面板 / 文件面板同一时间只显示一个(像 activity bar)。
import { beforeEach, describe, expect, it } from 'vitest';
import { type PersistedStateV1, type WorkspaceState, useAppStore } from '../store';

const TERM = 'term1';

function seedWorkspace(): void {
  const ws: WorkspaceState = {
    id: 'ws1',
    name: 'w',
    root: '/w',
    hostId: 'local',
    tabs: [{ id: TERM, title: 't', cwd: '/w' }],
    activeTabId: TERM,
  };
  useAppStore.setState({
    workspaces: [ws],
    activeWorkspaceId: 'ws1',
    browserPanelOpen: false,
    browserPanelWidth: 480,
    filePanelCollapsed: false,
  });
}

function persistedV1(ui: PersistedStateV1['ui']): PersistedStateV1 {
  return { version: 1, activeWorkspaceId: null, workspaces: [], ui };
}

beforeEach(seedWorkspace);

describe('面板互斥(SideRail:浏览器 / 文件面板同一时间只显示一个)', () => {
  it('打开浏览器面板 → 文件面板收起', () => {
    useAppStore.setState({ filePanelCollapsed: false }); // 文件面板先展开
    useAppStore.getState().toggleBrowserPanel();
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
  });

  it('关闭浏览器面板不动文件面板态', () => {
    useAppStore.setState({ browserPanelOpen: true, filePanelCollapsed: true });
    useAppStore.getState().toggleBrowserPanel(); // 关
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
    expect(useAppStore.getState().filePanelCollapsed).toBe(true); // 不动
  });

  it('展开文件面板 → 浏览器面板关', () => {
    useAppStore.setState({ browserPanelOpen: true, filePanelCollapsed: true });
    useAppStore.getState().toggleFilePanelCollapsed(); // 展开
    expect(useAppStore.getState().filePanelCollapsed).toBe(false);
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
  });

  it('收起文件面板不动浏览器面板态', () => {
    useAppStore.setState({ browserPanelOpen: false, filePanelCollapsed: false });
    useAppStore.getState().toggleFilePanelCollapsed(); // 收起
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
    expect(useAppStore.getState().browserPanelOpen).toBe(false); // 不动
  });

  it('addBrowserTab 顺手收起文件面板', () => {
    useAppStore.setState({ filePanelCollapsed: false });
    useAppStore.getState().addBrowserTab(TERM, 'https://example.com');
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
  });

  it('closeBrowserPane:头部 ✕ 三态确认「Close All」落点——清空窗格 + 关面板,不碰文件面板态', () => {
    const ws: WorkspaceState = {
      id: 'ws1',
      name: 'w',
      root: '/w',
      hostId: 'local',
      tabs: [
        {
          id: TERM,
          title: 't',
          cwd: '/w',
          browser: {
            tabs: [
              { id: 'a', url: 'https://a.dev' },
              { id: 'b', url: 'https://b.dev' },
            ],
            activeTabId: 'a',
          },
        },
      ],
      activeTabId: TERM,
    };
    useAppStore.setState({
      workspaces: [ws],
      activeWorkspaceId: 'ws1',
      browserPanelOpen: true,
      filePanelCollapsed: true,
    });

    useAppStore.getState().closeBrowserPane(TERM);

    const pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.tabs).toEqual([]);
    expect(pane.activeTabId).toBeNull();
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
    expect(useAppStore.getState().filePanelCollapsed).toBe(true); // 不碰——只关浏览器
  });

  it('dockBrowserPane 回落到活跃 tab → 顺手收起文件面板', () => {
    useAppStore.setState({ filePanelCollapsed: false });
    useAppStore.getState().dockBrowserPane(TERM);
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
  });

  it('hydrate:旧存档两个面板都存了开 → 浏览器优先胜出', () => {
    useAppStore.getState().hydrate(
      [],
      persistedV1({ browserPanelOpen: true, filePanelCollapsed: false }),
    );
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
  });

  it('hydrate:浏览器未开时按存档原样恢复文件面板态', () => {
    useAppStore.getState().hydrate(
      [],
      persistedV1({ browserPanelOpen: false, filePanelCollapsed: false }),
    );
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
    expect(useAppStore.getState().filePanelCollapsed).toBe(false);
  });

  // 不变量测试:跑一串真实操作序列(开面板/加标签/展开文件面板/回落/弹出…),
  // 每步之后都断言互斥不变量成立——browserPanelOpen 为 true 时 filePanelCollapsed
  // 必须也是 true(rail 同一时间只显示一个面板)。
  it('不变量:action 序列每一步后 browserPanelOpen === true ⟹ filePanelCollapsed === true', () => {
    const get = () => useAppStore.getState();
    const assertInvariant = () => {
      if (get().browserPanelOpen) {
        expect(get().filePanelCollapsed).toBe(true);
      }
    };

    get().toggleBrowserPanel(); // 开浏览器面板(活跃 tab 无标签 → 顺手种一个)
    assertInvariant();

    get().addBrowserTab(TERM, 'https://example.com/1');
    assertInvariant();

    get().toggleFilePanelCollapsed(); // 展开文件面板 → 浏览器面板应被关掉
    assertInvariant();
    expect(get().browserPanelOpen).toBe(false); // 顺带确认互斥真的生效,不是巧合过关

    get().dockBrowserPane(TERM); // 回落到活跃 tab → 浏览器面板重新可见
    assertInvariant();

    get().popOutBrowserPane(TERM); // 弹出为独立窗口 → 主窗不再有面板
    assertInvariant();

    get().toggleFilePanelCollapsed(); // 收起文件面板(此时浏览器面板已是 false,不受影响)
    assertInvariant();

    get().addBrowserTab(TERM, 'https://example.com/2'); // 再加标签 → 顺手开面板
    assertInvariant();

    get().toggleBrowserPanel(); // 关浏览器面板
    assertInvariant();
  });
});
