// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type PersistedStateV1, useAppStore } from '../store';
import { serialize } from '../persistence';

function persisted(ui: PersistedStateV1['ui']): PersistedStateV1 {
  return { version: 1, activeWorkspaceId: null, workspaces: [], ui };
}

beforeEach(() => {
  useAppStore.setState({
    browserPanelOpen: false,
    browserTabs: [],
    browserActiveTabId: null,
    browserPanelWidth: 480,
  });
});

describe('内置浏览器面板 store', () => {
  it('默认关闭、无标签', () => {
    const s = useAppStore.getState();
    expect(s.browserPanelOpen).toBe(false);
    expect(s.browserTabs).toEqual([]);
    expect(s.browserActiveTabId).toBeNull();
  });

  it('首次打开自动种一个空标签并激活;再切只翻开关不动标签', () => {
    useAppStore.getState().toggleBrowserPanel();
    let s = useAppStore.getState();
    expect(s.browserPanelOpen).toBe(true);
    expect(s.browserTabs).toHaveLength(1);
    expect(s.browserTabs[0].url).toBe('');
    expect(s.browserActiveTabId).toBe(s.browserTabs[0].id);

    useAppStore.getState().toggleBrowserPanel(); // 收起
    useAppStore.getState().toggleBrowserPanel(); // 再展开
    s = useAppStore.getState();
    expect(s.browserTabs).toHaveLength(1); // 不重复种
  });

  it('addBrowserTab 新建并激活(且强制打开面板)', () => {
    useAppStore.getState().addBrowserTab('https://example.com');
    const s = useAppStore.getState();
    expect(s.browserPanelOpen).toBe(true);
    expect(s.browserTabs).toHaveLength(1);
    expect(s.browserTabs[0].url).toBe('https://example.com');
    expect(s.browserActiveTabId).toBe(s.browserTabs[0].id);
  });

  it('closeBrowserTab:关活跃标签 → 激活右邻(无右邻取左);关最后一个 → 面板收起清空', () => {
    const st = useAppStore.getState();
    st.addBrowserTab('https://a.com');
    st.addBrowserTab('https://b.com');
    st.addBrowserTab('https://c.com');
    const [a, b, c] = useAppStore.getState().browserTabs;

    useAppStore.getState().setBrowserActiveTab(b.id);
    useAppStore.getState().closeBrowserTab(b.id);
    expect(useAppStore.getState().browserActiveTabId).toBe(c.id); // 右邻

    useAppStore.getState().closeBrowserTab(c.id);
    expect(useAppStore.getState().browserActiveTabId).toBe(a.id); // 无右邻取左

    useAppStore.getState().closeBrowserTab(a.id);
    const s = useAppStore.getState();
    expect(s.browserPanelOpen).toBe(false);
    expect(s.browserTabs).toEqual([]);
    expect(s.browserActiveTabId).toBeNull();
  });

  it('关闭非活跃标签不改激活', () => {
    const st = useAppStore.getState();
    st.addBrowserTab('https://a.com');
    st.addBrowserTab('https://b.com');
    const [a, b] = useAppStore.getState().browserTabs;
    useAppStore.getState().setBrowserActiveTab(b.id);
    useAppStore.getState().closeBrowserTab(a.id);
    expect(useAppStore.getState().browserActiveTabId).toBe(b.id);
  });

  it('updateBrowserTab 局部更新 url/title', () => {
    useAppStore.getState().addBrowserTab('');
    const id = useAppStore.getState().browserTabs[0].id;
    useAppStore.getState().updateBrowserTab(id, { url: 'https://x.dev', title: 'X' });
    expect(useAppStore.getState().browserTabs[0]).toMatchObject({
      url: 'https://x.dev',
      title: 'X',
    });
  });

  it('hydrate:非 http(s) 的持久化 url 降级为空标签(scheme 收口)', () => {
    useAppStore.getState().hydrate(
      [],
      persisted({
        browserTabs: [
          { id: 't1', url: 'file:///etc/passwd' },
          { id: 't2', url: 'javascript:alert(1)' },
          { id: 't3', url: 'https://ok.com' },
        ],
        browserActiveTabId: 't1',
      }),
    );
    const urls = useAppStore.getState().browserTabs.map((b) => b.url);
    expect(urls).toEqual(['', '', 'https://ok.com']);
  });

  it('hydrate 恢复标签与激活;激活 id 非法回退首个', () => {
    useAppStore.getState().hydrate(
      [],
      persisted({
        browserPanelOpen: true,
        browserPanelWidth: 600,
        browserTabs: [
          { id: 't1', url: 'https://a.com' },
          { id: 't2', url: '' },
        ],
        browserActiveTabId: 'gone',
      }),
    );
    const s = useAppStore.getState();
    expect(s.browserPanelOpen).toBe(true);
    expect(s.browserPanelWidth).toBe(600);
    expect(s.browserTabs).toHaveLength(2);
    expect(s.browserActiveTabId).toBe('t1');
  });

  it('serialize:关面板+空标签不写开关/标签字段;title 不入档', () => {
    let ui = serialize(useAppStore.getState()).ui as Record<string, unknown>;
    expect(ui).not.toHaveProperty('browserPanelOpen');
    expect(ui).not.toHaveProperty('browserTabs');

    useAppStore.getState().addBrowserTab('https://a.com');
    const id = useAppStore.getState().browserTabs[0].id;
    useAppStore.getState().updateBrowserTab(id, { title: 'A' });
    ui = serialize(useAppStore.getState()).ui as Record<string, unknown>;
    expect(ui).toMatchObject({
      browserPanelOpen: true,
      browserTabs: [{ id, url: 'https://a.com' }],
      browserActiveTabId: id,
    });
    expect((ui.browserTabs as { title?: string }[])[0]).not.toHaveProperty('title');
  });
});
