// @vitest-environment jsdom
// 内置浏览器窗格已 per-tab(绑定终端 tab · TabState.browser)。本测覆盖:per-tab action
// 语义、旧版全局标签 → 活跃 tab 的一次性迁移、per-tab 序列化。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type PersistedStateV1,
  type WorkspaceState,
  isSamePreviewPrefix,
  resolveBrowserTabNet,
  useAppStore,
} from '../store';
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

describe('预览标签(preview · 项目内 HTML 预览 · openHtmlPreview 开的标签)', () => {
  it('addBrowserTab opts.netHostId/preview 物化到新标签', () => {
    useAppStore.getState().addBrowserTab(TERM, 'http://127.0.0.1:1/tok/index.html', {
      netHostId: 'cfg-9',
      preview: true,
    });
    expect(pane()!.tabs[0]).toMatchObject({ netHostId: 'cfg-9', preview: true });
  });

  it('addBrowserTab 不传 opts → 缺省行为不变(netHostId=所属机器,无 preview 标志)', () => {
    useAppStore.getState().addBrowserTab(TERM, 'https://a.dev');
    expect(pane()!.tabs[0].netHostId).toBe('local');
    expect(pane()!.tabs[0].preview).toBeUndefined();
  });

  it('setBrowserTabNet 对 preview 标签 no-op(出口钉死所属机器,store 层权威守卫)', () => {
    useAppStore.getState().addBrowserTab(TERM, 'http://127.0.0.1:1/tok/x.html', {
      netHostId: 'cfg-9',
      preview: true,
    });
    const id = pane()!.tabs[0].id;
    useAppStore.getState().setBrowserTabNet(TERM, id, 'local');
    expect(pane()!.tabs[0].netHostId).toBe('cfg-9'); // 未被改动
  });

  it('setBrowserTabNet 对普通标签零回归(非 preview 正常生效)', () => {
    useAppStore.getState().addBrowserTab(TERM, 'https://a.dev');
    const id = pane()!.tabs[0].id;
    useAppStore.getState().setBrowserTabNet(TERM, id, 'cfg-1');
    expect(pane()!.tabs[0].netHostId).toBe('cfg-1');
  });

  it('serialize:preview 标签过滤不落盘,activeTabId 回落剩余首个标签', () => {
    useAppStore.getState().addBrowserTab(TERM, 'https://a.com'); // 普通标签
    useAppStore
      .getState()
      .addBrowserTab(TERM, 'http://127.0.0.1:1/tok/x.html', { preview: true }); // 预览标签,新建即激活
    expect(pane()!.activeTabId).toBe(pane()!.tabs[1].id);

    const archive = serialize(useAppStore.getState());
    const tab = archive.workspaces[0].tabs[0] as {
      browser?: { tabs: { id: string; url: string }[]; activeTabId: string | null };
    };
    expect(tab.browser!.tabs).toHaveLength(1);
    expect(tab.browser!.tabs[0].url).toBe('https://a.com');
    expect(tab.browser!.tabs.some((b) => 'preview' in b)).toBe(false);
    // 原 activeTabId 指向被过滤掉的预览标签 → 回落剩余首个
    expect(tab.browser!.activeTabId).toBe(tab.browser!.tabs[0].id);
  });

  it('serialize:全部标签都是 preview → browser 键整体不写盘(等价从未开过浏览器)', () => {
    useAppStore
      .getState()
      .addBrowserTab(TERM, 'http://127.0.0.1:1/tok/x.html', { preview: true });
    const archive = serialize(useAppStore.getState());
    const tab = archive.workspaces[0].tabs[0] as { browser?: unknown };
    expect(tab.browser).toBeUndefined();
  });

  it('hydrate:剥掉 preview(存档本不该有,防手改注入伪装预览标签绕过出口钉死)', () => {
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
                  tabs: [{ id: 't1', url: 'https://a.com', preview: true }],
                  activeTabId: 't1',
                },
              },
            ],
          },
        ],
        {},
      ),
    );
    const br = useAppStore.getState().workspaces[0].tabs[0].browser;
    expect(br?.tabs).toHaveLength(1);
    expect(br?.tabs[0]).not.toHaveProperty('preview');
  });

  describe('isSamePreviewPrefix(评审 P2-10:纯函数)', () => {
    it('同 origin + 同路径首段(token)→ true(同一预览会话内的相对跳转,如 assets/)', () => {
      expect(
        isSamePreviewPrefix(
          'http://127.0.0.1:4123/tok/index.html',
          'http://127.0.0.1:4123/tok/assets/app.css',
        ),
      ).toBe(true);
    });

    it('origin 不同(端口变了,preview.ensure 换了个 server)→ false', () => {
      expect(
        isSamePreviewPrefix(
          'http://127.0.0.1:4123/tok/index.html',
          'http://127.0.0.1:9999/tok/index.html',
        ),
      ).toBe(false);
    });

    it('路径首段(token)不同 → false', () => {
      expect(
        isSamePreviewPrefix(
          'http://127.0.0.1:4123/tok-a/index.html',
          'http://127.0.0.1:4123/tok-b/index.html',
        ),
      ).toBe(false);
    });

    it('导航去了完全不相关的站点 → false', () => {
      expect(
        isSamePreviewPrefix('http://127.0.0.1:4123/tok/index.html', 'https://example.com/'),
      ).toBe(false);
    });

    it('url 解析失败 → false(保守默认:清掉 preview 只是降级,不是安全隐患)', () => {
      expect(isSamePreviewPrefix('http://127.0.0.1:4123/tok/index.html', 'not-a-url')).toBe(
        false,
      );
      expect(isSamePreviewPrefix('not-a-url', 'http://127.0.0.1:4123/tok/index.html')).toBe(
        false,
      );
    });
  });

  describe('updateBrowserTab 对预览标签的 preview 剥离(评审 P2-10)', () => {
    function seedPreviewTab(url = 'http://127.0.0.1:4123/tok/index.html'): string {
      useAppStore.getState().addBrowserTab(TERM, url, { netHostId: 'cfg-9', preview: true });
      return pane()!.tabs[0].id;
    }

    it('导航离开预览前缀(不同 origin)→ 连带清掉 preview,url 正常更新', () => {
      const id = seedPreviewTab();
      useAppStore.getState().updateBrowserTab(TERM, id, { url: 'https://elsewhere.dev' });
      const tab = pane()!.tabs[0];
      expect(tab.url).toBe('https://elsewhere.dev');
      expect(tab.preview).toBeUndefined();
    });

    it('导航离开预览前缀(同 origin 不同 token)→ 同样清掉 preview', () => {
      const id = seedPreviewTab('http://127.0.0.1:4123/tok-a/index.html');
      useAppStore.getState().updateBrowserTab(TERM, id, {
        url: 'http://127.0.0.1:4123/tok-b/index.html',
      });
      expect(pane()!.tabs[0].preview).toBeUndefined();
    });

    it('仍在同一预览前缀内跳转(相对资源)→ preview 保留', () => {
      const id = seedPreviewTab();
      useAppStore.getState().updateBrowserTab(TERM, id, {
        url: 'http://127.0.0.1:4123/tok/assets/app.css',
      });
      const tab = pane()!.tabs[0];
      expect(tab.url).toBe('http://127.0.0.1:4123/tok/assets/app.css');
      expect(tab.preview).toBe(true);
    });

    it('patch 无 url(只改 title)→ 不动 preview,不误判', () => {
      const id = seedPreviewTab();
      useAppStore.getState().updateBrowserTab(TERM, id, { title: '新标题' });
      const tab = pane()!.tabs[0];
      expect(tab.title).toBe('新标题');
      expect(tab.preview).toBe(true);
    });

    it('非预览标签的 url 更新零回归(不受本次改动影响)', () => {
      useAppStore.getState().addBrowserTab(TERM, 'https://a.dev');
      const id = pane()!.tabs[0].id;
      useAppStore.getState().updateBrowserTab(TERM, id, { url: 'https://b.dev' });
      const tab = pane()!.tabs[0];
      expect(tab.url).toBe('https://b.dev');
      expect(tab).not.toHaveProperty('preview');
    });
  });
});
