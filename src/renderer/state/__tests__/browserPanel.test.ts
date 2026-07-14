// @vitest-environment jsdom
// 内置浏览器窗格已 per-tab(绑定终端 tab · TabState.browser)。本测覆盖:per-tab action
// 语义、旧版全局标签 → 活跃 tab 的一次性迁移、per-tab 序列化。
import { beforeEach, describe, expect, it } from 'vitest';
import { type PersistedStateV1, type WorkspaceState, resolveBrowserTabNet, useAppStore } from '../store';
import { serialize } from '../persistence';

const TERM = 'term1';
const TERM_BG = 'term2'; // 非活跃终端 tab(后台窗格用)

/** 播一个含两个终端 tab(活跃 term1 + 后台 term2)的本机 workspace,浏览器窗格从空起步。 */
function seedWorkspace(): void {
  const ws: WorkspaceState = {
    id: 'ws1',
    name: 'w',
    root: '/w',
    hostId: 'local',
    tabs: [
      { id: TERM, title: 't', cwd: '/w' },
      { id: TERM_BG, title: 't2', cwd: '/w' },
    ],
    activeTabId: TERM,
  };
  useAppStore.setState({
    workspaces: [ws],
    activeWorkspaceId: 'ws1',
    browserPanelOpen: false,
    browserPanelWidth: 480,
  });
}

/** 活跃终端 tab 的浏览器窗格(未开 → undefined)。 */
function pane() {
  const s = useAppStore.getState();
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  return ws?.tabs.find((t) => t.id === ws.activeTabId)?.browser;
}

function persistedV1(
  workspaces: PersistedStateV1['workspaces'],
  ui: PersistedStateV1['ui'],
): PersistedStateV1 {
  return { version: 1, activeWorkspaceId: workspaces[0]?.id ?? null, workspaces, ui };
}

beforeEach(seedWorkspace);

describe('内置浏览器窗格 store(per-tab)', () => {
  it('默认关闭、活跃 tab 无浏览器窗格', () => {
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
    expect(pane()).toBeUndefined();
  });

  it('首次打开在活跃 tab 种一个空标签并激活;再切只翻开关不动标签', () => {
    useAppStore.getState().toggleBrowserPanel();
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
    expect(pane()?.tabs).toHaveLength(1);
    expect(pane()?.tabs[0].url).toBe('');
    expect(pane()?.activeTabId).toBe(pane()?.tabs[0].id);

    useAppStore.getState().toggleBrowserPanel(); // 收起
    useAppStore.getState().toggleBrowserPanel(); // 再展开
    expect(pane()?.tabs).toHaveLength(1); // 不重复种
  });

  it('addBrowserTab 在指定终端 tab 新建并激活(且强制打开面板)', () => {
    useAppStore.getState().addBrowserTab(TERM, 'https://example.com');
    expect(useAppStore.getState().browserPanelOpen).toBe(true);
    expect(pane()?.tabs).toHaveLength(1);
    expect(pane()?.tabs[0].url).toBe('https://example.com');
    expect(pane()?.activeTabId).toBe(pane()?.tabs[0].id);
  });

  it('closeBrowserTab:关活跃标签 → 激活右邻(无右邻取左);全关掉 → 窗格清空 + 面板收起', () => {
    const st = useAppStore.getState();
    st.addBrowserTab(TERM, 'https://a.com');
    st.addBrowserTab(TERM, 'https://b.com');
    st.addBrowserTab(TERM, 'https://c.com');
    const [a, b, c] = pane()!.tabs;

    useAppStore.getState().setBrowserActiveTab(TERM, b.id);
    useAppStore.getState().closeBrowserTab(TERM, b.id);
    expect(pane()?.activeTabId).toBe(c.id); // 右邻
    expect(useAppStore.getState().browserPanelOpen).toBe(true); // 还有标签,面板不动

    useAppStore.getState().closeBrowserTab(TERM, c.id);
    expect(pane()?.activeTabId).toBe(a.id); // 无右邻取左

    useAppStore.getState().closeBrowserTab(TERM, a.id);
    expect(pane()?.tabs).toEqual([]);
    expect(pane()?.activeTabId).toBeNull();
    // 标签全关掉 → 面板一并收起(用户指令 2026-07-14;下次打开重新种空标签)
    expect(useAppStore.getState().browserPanelOpen).toBe(false);
  });

  it('后台终端 tab 的窗格被清空 → 面板不收(全局面板态只随活跃窗格)', () => {
    const st = useAppStore.getState();
    // 给活跃 tab(TERM)与后台 tab(TERM_BG)各一个标签
    st.addBrowserTab(TERM, 'https://front.com');
    st.addBrowserTab(TERM_BG, 'https://back.com');
    const bg = useAppStore
      .getState()
      .workspaces.flatMap((w) => w.tabs)
      .find((tab) => tab.id === TERM_BG)!.browser!.tabs[0];

    useAppStore.getState().closeBrowserTab(TERM_BG, bg.id);
    expect(useAppStore.getState().browserPanelOpen).toBe(true); // 活跃窗格还有标签
    expect(pane()?.tabs).toHaveLength(1);
  });

  it('关闭非活跃标签不改激活', () => {
    const st = useAppStore.getState();
    st.addBrowserTab(TERM, 'https://a.com');
    st.addBrowserTab(TERM, 'https://b.com');
    const [a, b] = pane()!.tabs;
    useAppStore.getState().setBrowserActiveTab(TERM, b.id);
    useAppStore.getState().closeBrowserTab(TERM, a.id);
    expect(pane()?.activeTabId).toBe(b.id);
  });

  it('updateBrowserTab 局部更新 url/title', () => {
    useAppStore.getState().addBrowserTab(TERM, '');
    const id = pane()!.tabs[0].id;
    useAppStore.getState().updateBrowserTab(TERM, id, { url: 'https://x.dev', title: 'X' });
    expect(pane()?.tabs[0]).toMatchObject({ url: 'https://x.dev', title: 'X' });
  });

  it('action 只作用于指定终端 tab,不串到别的 tab', () => {
    // 追加第二个终端 tab
    useAppStore.setState((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        tabs: [...w.tabs, { id: 'term2', title: 't2', cwd: '/w' }],
      })),
    }));
    useAppStore.getState().addBrowserTab(TERM, 'https://a.com');
    useAppStore.getState().addBrowserTab('term2', 'https://b.com');
    const s = useAppStore.getState();
    const t1 = s.workspaces[0].tabs.find((t) => t.id === TERM)!.browser;
    const t2 = s.workspaces[0].tabs.find((t) => t.id === 'term2')!.browser;
    expect(t1?.tabs.map((b) => b.url)).toEqual(['https://a.com']);
    expect(t2?.tabs.map((b) => b.url)).toEqual(['https://b.com']);
  });

  it('迁移:旧版全局 ui.browserTabs → 注入活跃终端 tab 的 browser(非 http(s) 降级空)', () => {
    useAppStore.getState().hydrate(
      [],
      persistedV1(
        [{ id: 'ws1', name: 'w', root: '/w', activeTabId: TERM, tabs: [{ id: TERM, cwd: '/w' }] }],
        {
          browserTabs: [
            { id: 't1', url: 'file:///etc/passwd' },
            { id: 't2', url: 'javascript:alert(1)' },
            { id: 't3', url: 'https://ok.com' },
          ],
          browserActiveTabId: 't3',
        },
      ),
    );
    const s = useAppStore.getState();
    const br = s.workspaces[0].tabs[0].browser;
    expect(br?.tabs.map((b) => b.url)).toEqual(['', '', 'https://ok.com']);
    expect(br?.activeTabId).toBe('t3'); // 合法激活保留
  });

  it('迁移:活跃 tab 已自带 per-tab browser 时不被旧版全局覆盖', () => {
    useAppStore.getState().hydrate(
      [],
      persistedV1(
        [
          {
            id: 'ws1',
            name: 'w',
            root: '/w',
            activeTabId: TERM,
            tabs: [
              {
                id: TERM,
                cwd: '/w',
                browser: { tabs: [{ id: 'own', url: 'https://own.com' }], activeTabId: 'own' },
              },
            ],
          },
        ],
        { browserTabs: [{ id: 'legacy', url: 'https://legacy.com' }], browserActiveTabId: 'legacy' },
      ),
    );
    const br = useAppStore.getState().workspaces[0].tabs[0].browser;
    expect(br?.tabs.map((b) => b.url)).toEqual(['https://own.com']); // 自带优先,旧版不注入
  });

  it('hydrate:per-tab browser 恢复,激活 id 非法回退首个', () => {
    useAppStore.getState().hydrate(
      [],
      persistedV1(
        [
          {
            id: 'ws1',
            name: 'w',
            root: '/w',
            activeTabId: TERM,
            tabs: [
              {
                id: TERM,
                cwd: '/w',
                browser: {
                  tabs: [
                    { id: 't1', url: 'https://a.com' },
                    { id: 't2', url: '' },
                  ],
                  activeTabId: 'gone',
                },
              },
            ],
          },
        ],
        {},
      ),
    );
    const br = useAppStore.getState().workspaces[0].tabs[0].browser;
    expect(br?.tabs).toHaveLength(2);
    expect(br?.activeTabId).toBe('t1'); // 非法 → 首个
  });

  it('serialize:窗格写入 PersistedTab.browser(title 不入档),不再写 ui.browserTabs', () => {
    useAppStore.getState().addBrowserTab(TERM, 'https://a.com');
    const id = pane()!.tabs[0].id;
    useAppStore.getState().updateBrowserTab(TERM, id, { title: 'A' });
    const archive = serialize(useAppStore.getState());
    // 全局 ui 不再承载浏览器标签
    expect(archive.ui as Record<string, unknown>).not.toHaveProperty('browserTabs');
    // per-tab 落到 PersistedTab.browser
    const tab = archive.workspaces[0].tabs[0] as {
      browser?: { tabs: { id: string; url: string; title?: string }[]; activeTabId: string | null };
    };
    expect(tab.browser).toEqual({
      tabs: [{ id, url: 'https://a.com', netHostId: 'local' }],
      activeTabId: id,
    });
    expect(tab.browser!.tabs[0]).not.toHaveProperty('title');
  });
});

describe('标签级网络出口(netHostId · 2026-07-14)', () => {
  it('新建标签物化出口 = 所属终端 tab 的机器;setBrowserTabNet 可改', () => {
    // 本机 ws 的 tab → 'local'
    useAppStore.getState().addBrowserTab(TERM, 'https://a.dev');
    expect(pane()!.tabs[0].netHostId).toBe('local');

    // 远程 ws 的 tab → configId
    const remoteWs: WorkspaceState = {
      id: 'ws-r',
      name: 'r',
      root: '/r',
      hostId: 'cfg-9',
      tabs: [{ id: 'rterm', title: 'rt', cwd: '/r' }],
      activeTabId: 'rterm',
    };
    useAppStore.setState({
      workspaces: [...useAppStore.getState().workspaces, remoteWs],
    });
    useAppStore.getState().addBrowserTab('rterm', 'http://localhost:3000');
    const rPane = useAppStore
      .getState()
      .workspaces.find((w) => w.id === 'ws-r')!.tabs[0].browser!;
    expect(rPane.tabs[0].netHostId).toBe('cfg-9');

    // 手动改出口
    useAppStore.getState().setBrowserTabNet('rterm', rPane.tabs[0].id, 'local');
    expect(
      useAppStore.getState().workspaces.find((w) => w.id === 'ws-r')!.tabs[0].browser!
        .tabs[0].netHostId,
    ).toBe('local');
  });

  it('netHostId 持久化往返:serialize 写出 → hydrate 带回;缺省不写键', () => {
    useAppStore.getState().addBrowserTab(TERM, 'https://a.dev');
    const btId = pane()!.tabs[0].id;
    useAppStore.getState().setBrowserTabNet(TERM, btId, 'cfg-1');
    useAppStore.setState({ persistMode: 'v2' });

    const archive = serialize(useAppStore.getState());
    if (archive.version !== 2) throw new Error('expected v2');
    const persisted = archive.workspaces[0].tabs[0].browser!;
    expect(persisted.tabs[0].netHostId).toBe('cfg-1');

    // 'local' 显式值也原样写出(区别于缺省不写):再建一个未改出口的标签
    useAppStore.getState().addBrowserTab(TERM, 'https://b.dev');
    const archive2 = serialize(useAppStore.getState());
    if (archive2.version !== 2) throw new Error('expected v2');
    expect(archive2.workspaces[0].tabs[0].browser!.tabs[1].netHostId).toBe('local');
  });

  it('resolveBrowserTabNet:显式值优先,缺省回落所属机器', () => {
    expect(resolveBrowserTabNet({ netHostId: 'cfg-2' }, 'local')).toBe('cfg-2');
    expect(resolveBrowserTabNet({}, 'cfg-7')).toBe('cfg-7');
  });
});
