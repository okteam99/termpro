// @vitest-environment jsdom
// AI 浏览器控制服务(阶段1):目标解析(活跃/显式/错误)+ 控制原语(导航/eval/截图/
// 取 HTML/文本)+ 标签管理(list/open/close/activate),操作真实登录窗格。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/store';
import type { WorkspaceState } from '../../state/store';
import { registerBrowserView, __clearBrowserViewsForTest } from '../browserViewRegistry';
import * as bc from '../browserControl';

const TERM = 'term1';

function fakeView(html = '<html><body>hi</body></html>') {
  return {
    loadURL: vi.fn(async () => undefined),
    executeJavaScript: vi.fn(async (code: string) => {
      if (code.includes('outerHTML')) return html;
      if (code.includes('innerText')) return 'visible text';
      return 'evalresult';
    }),
    capturePage: vi.fn(async () => ({
      toDataURL: () => 'data:image/png;base64,ABC',
      toPNG: () => new Uint8Array(),
    })),
  } as unknown as HTMLWebViewElement;
}

function seed(browser?: { tabs: { id: string; url: string; title?: string }[]; activeTabId: string | null }) {
  const ws: WorkspaceState = {
    id: 'ws1',
    name: 'w',
    root: '/w',
    hostId: 'cfg-1', // 远程 workspace(验证出口解析)
    tabs: [{ id: TERM, title: 't', cwd: '/w', browser }],
    activeTabId: TERM,
  };
  useAppStore.setState({ workspaces: [ws], activeWorkspaceId: 'ws1', browserPanelOpen: true });
}

beforeEach(() => {
  __clearBrowserViewsForTest();
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null, browserPanelOpen: false });
});

describe('目标解析', () => {
  it('缺省用活跃标签;显式 id 校验;不存在则抛', async () => {
    seed({ tabs: [{ id: 'a', url: 'https://a.dev' }, { id: 'b', url: 'https://b.dev' }], activeTabId: 'b' });
    const va = fakeView();
    const vb = fakeView();
    registerBrowserView('a', va);
    registerBrowserView('b', vb);

    await bc.evalJs(TERM, 'x'); // 缺省 → 活跃 b
    expect((vb.executeJavaScript as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((va.executeJavaScript as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    await bc.evalJs(TERM, 'x', 'a'); // 显式 a
    expect((va.executeJavaScript as ReturnType<typeof vi.fn>)).toHaveBeenCalled();

    await expect(bc.evalJs(TERM, 'x', 'gone')).rejects.toThrow(/browser tab not found/);
  });

  it('webview 未挂载 → 抛 not ready(可重试)', async () => {
    seed({ tabs: [{ id: 'a', url: 'https://a.dev' }], activeTabId: 'a' });
    // 不 registerBrowserView
    await expect(bc.evalJs(TERM, 'x')).rejects.toThrow(/not ready/);
  });
});

describe('控制原语', () => {
  it('evalJs / getHtml / getText / screenshot', async () => {
    seed({ tabs: [{ id: 'a', url: 'https://a.dev' }], activeTabId: 'a' });
    registerBrowserView('a', fakeView('<html><body>page</body></html>'));

    expect(await bc.evalJs(TERM, '1+1')).toBe('evalresult');
    expect(await bc.getHtml(TERM)).toContain('page');
    expect(await bc.getText(TERM)).toBe('visible text');
    expect(await bc.screenshot(TERM)).toBe('data:image/png;base64,ABC');
  });

  it('navigate:已有标签 → loadURL 现有 webview', async () => {
    seed({ tabs: [{ id: 'a', url: 'https://a.dev' }], activeTabId: 'a' });
    const v = fakeView();
    registerBrowserView('a', v);
    const r = await bc.navigate(TERM, 'https://new.dev');
    expect(r.browserTabId).toBe('a');
    expect((v.loadURL as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('https://new.dev');
  });

  it('navigate:窗格无标签 → 开新标签(store 加载,返回新 id)', async () => {
    seed(undefined); // 无 browser 窗格
    const r = await bc.navigate(TERM, 'https://first.dev');
    const pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.tabs).toHaveLength(1);
    expect(pane.tabs[0].url).toBe('https://first.dev');
    expect(r.browserTabId).toBe(pane.tabs[0].id);
  });
});

describe('标签管理', () => {
  it('listTabs:含活跃标记 + 出口(远程 ws 缺省出口=configId)', () => {
    seed({ tabs: [{ id: 'a', url: 'https://a.dev', title: 'A' }, { id: 'b', url: '' }], activeTabId: 'a' });
    const list = bc.listTabs(TERM);
    expect(list).toEqual([
      { id: 'a', url: 'https://a.dev', title: 'A', active: true, net: 'cfg-1' },
      { id: 'b', url: '', title: undefined, active: false, net: 'cfg-1' },
    ]);
  });

  it('openTab / activateTab / closeTab', () => {
    seed({ tabs: [{ id: 'a', url: 'https://a.dev' }], activeTabId: 'a' });
    const { browserTabId: nb } = bc.openTab(TERM, 'https://b.dev');
    let pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.tabs.map((t) => t.id)).toContain(nb);
    expect(pane.activeTabId).toBe(nb); // 新标签活跃

    bc.activateTab(TERM, 'a');
    pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.activeTabId).toBe('a');

    bc.closeTab(TERM, nb);
    pane = useAppStore.getState().workspaces[0].tabs[0].browser!;
    expect(pane.tabs.map((t) => t.id)).not.toContain(nb);
  });
});
