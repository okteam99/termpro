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
});
