// 浏览器窗格壳窗(窗格窗口化 · 2026-07):弹出的「当前 session 对应的 OkBrowser」。
// 内容 = 完整 BrowserPanel(标签条/地址栏/出口选择器/webview 按标签分区);头部条 =
// 终端 tab 名 + 回落按钮。状态所有权:本窗 store(独立 zustand 实例——每个渲染进程
// 一份)以 main 下发的种子起步,此后独占窗格内容;变更经 browserPane:sync 单向回流
// 主窗镜像(主窗承担持久化与出口对账)。回落 = 关窗(按钮与红灯钮同路)。

import { useEffect, useState } from 'react';
import { BrowserPanel } from './BrowserPanel';
import { useAppStore } from '../state/store';
import type { BrowserTabState } from '../state/store';
import { initBrowserControlBridge } from '../services/browserControlBridge';
import { initProfilesSync } from '../services/profilesSync';
import { t } from '../../shared/i18n';

interface PaneSeed {
  terminalTabId: string;
  tabName: string;
  ownerHostId: string;
  /** 所属 ws 的浏览器 profile 绑定(缺省 = 默认 profile;分区/UA 随之) */
  browserProfileId?: string;
  pane: { tabs: BrowserTabState[]; activeTabId: string | null };
}

/** 种子防御性收窄:main 转发的是主窗上报的原样负载,壳窗仍只取已知字段 */
function sanitizeSeed(raw: unknown, terminalTabId: string): PaneSeed | null {
  const p = raw as PaneSeed | null;
  if (!p || p.terminalTabId !== terminalTabId) return null;
  const tabs = Array.isArray(p.pane?.tabs)
    ? p.pane.tabs
        .filter((b) => typeof b?.id === 'string' && typeof b?.url === 'string')
        .map((b) => ({
          id: b.id,
          url: /^https?:\/\//i.test(b.url) ? b.url : '',
          ...(typeof b.title === 'string' ? { title: b.title } : {}),
          ...(typeof b.netHostId === 'string' ? { netHostId: b.netHostId } : {}),
        }))
    : [];
  return {
    terminalTabId,
    tabName: typeof p.tabName === 'string' ? p.tabName : 'Tab',
    ownerHostId: typeof p.ownerHostId === 'string' ? p.ownerHostId : 'local',
    ...(typeof p.browserProfileId === 'string' && p.browserProfileId
      ? { browserProfileId: p.browserProfileId }
      : {}),
    pane: {
      tabs,
      activeTabId: tabs.some((b) => b.id === p.pane?.activeTabId)
        ? p.pane.activeTabId
        : (tabs[0]?.id ?? null),
    },
  };
}

export function BrowserPaneShellWindow({ terminalTabId }: { terminalTabId: string }) {
  const [seed, setSeed] = useState<PaneSeed | null>(null);
  const browserPanelOpen = useAppStore((s) => s.browserPanelOpen);

  // AI 浏览器控制:窗格弹出后 webview 活在本壳窗,main 把该 tab 的 browserControl:invoke
  // 改路由到本窗(见 main.invokeBrowserControl)。故壳窗也要挂控制桥,让 MCP 能驱动弹出窗口。
  // profile 快照同步同理:本窗 store 独立,分区计算/UA 透传吃本地快照。
  useEffect(() => {
    initBrowserControlBridge();
    initProfilesSync();
  }, []);

  // 取种子 → 种本窗 store(单 workspace 单终端 tab,BrowserPanel 全量复用)
  useEffect(() => {
    let cancelled = false;
    window.okwork?.browserPane
      ?.getState?.(terminalTabId)
      .then((raw) => {
        if (cancelled) return;
        const s = sanitizeSeed(raw, terminalTabId);
        if (!s) return; // 无种子(异常路径):停留空态,用户关窗即回落
        document.title = `OkBrowser-${s.tabName}`;
        useAppStore.setState({
          workspaces: [
            {
              id: 'shell-ws',
              name: s.tabName,
              root: '/',
              hostId: s.ownerHostId,
              ...(s.browserProfileId ? { browserProfileId: s.browserProfileId } : {}),
              tabs: [
                {
                  id: terminalTabId,
                  title: s.tabName,
                  cwd: '/',
                  browser: { tabs: s.pane.tabs, activeTabId: s.pane.activeTabId },
                },
              ],
              activeTabId: terminalTabId,
            },
          ],
          activeWorkspaceId: 'shell-ws',
          browserPanelOpen: true,
          hydrated: true,
        });
        setSeed(s);
      });
    return () => {
      cancelled = true;
    };
  }, [terminalTabId]);

  // 内容回流:订阅本窗 store,窗格变化 → sync 主窗镜像(持久化/出口对账在主窗)
  useEffect(() => {
    if (!seed) return;
    let last: unknown = null;
    return useAppStore.subscribe((s) => {
      const pane = s.workspaces[0]?.tabs.find((tb) => tb.id === terminalTabId)?.browser;
      if (!pane || pane === last) return;
      last = pane;
      window.okwork?.browserPane?.sync?.(terminalTabId, {
        tabs: pane.tabs,
        activeTabId: pane.activeTabId,
      });
    });
  }, [seed, terminalTabId]);

  // 主窗转投的新标签(终端链接点到本窗格)
  useEffect(() => {
    return window.okwork?.browserPane?.onAddTab?.((url) => {
      useAppStore.getState().addBrowserTab(terminalTabId, url);
    });
  }, [terminalTabId]);

  // 窗格被清空(用户关光标签 → BrowserPanel 的收面板逻辑把 browserPanelOpen 置 false)
  // → 壳窗没有「空面板」形态,自动回落关窗
  useEffect(() => {
    if (!seed || browserPanelOpen) return;
    window.okwork?.browserPane?.dock?.(terminalTabId);
  }, [seed, browserPanelOpen, terminalTabId]);

  return (
    <div className="browser-shell">
      <div className="browser-shell__header">
        <span className="browser-shell__title">
          OkBrowser-{seed?.tabName ?? terminalTabId}
        </span>
        <button
          className="browser-shell__dock"
          onClick={() => window.okwork?.browserPane?.dock?.(terminalTabId)}
          title={t('Dock back to the panel')}
        >
          {t('Dock back')}
        </button>
      </div>
      <div className="browser-shell__body">{seed && <BrowserPanel shell />}</div>
    </div>
  );
}
