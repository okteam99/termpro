// 浏览器窗格壳窗(窗格窗口化 · 2026-07):弹出的「当前 session 对应的 OkBrowser」。
// 内容 = 完整 BrowserPanel(标签条/地址栏/出口选择器/webview 按标签分区);头部条 =
// 终端 tab 名 + 回落按钮。状态所有权:本窗 store(独立 zustand 实例——每个渲染进程
// 一份)以 main 下发的种子起步,此后独占窗格内容;变更经 browserPane:sync 单向回流
// 主窗镜像(主窗承担持久化与出口对账)。回落 = 仅回落按钮;红灯钮 = 直接关闭浏览器
// (主窗清空镜像,多标签 main 先弹确认,见 browserPaneClose.ts)。

import { useEffect, useState } from 'react';
import { BrowserPanel } from './BrowserPanel';
import { WorkspaceEditModal } from './WorkspaceEditModal';
import { useAppStore } from '../state/store';
import type { BrowserTabState } from '../state/store';
import { initBrowserControlBridge } from '../services/browserControlBridge';
import { initProfilesSync } from '../services/profilesSync';
import { t } from '../../shared/i18n';
import { DEFAULT_PROFILE_ID } from '../../shared/browserProfile';

/** 壳窗 store 里唯一 workspace 的固定 id(种子时写入) */
const SHELL_WS_ID = 'shell-ws';

interface PaneSeed {
  terminalTabId: string;
  tabName: string;
  ownerHostId: string;
  /** 所属 workspace 名(工作区编辑弹层用;改名保存后本地跟进) */
  workspaceName: string;
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
          // preview 透传:壳窗内容经 sync 单向回流主窗镜像,主窗侧 serializeTab 才是
          // 「不落盘」的把关点——这里剥掉的话镜像会丢失预览标志,反而让它错误地落盘。
          ...(b.preview === true ? { preview: true as const } : {}),
        }))
    : [];
  return {
    terminalTabId,
    tabName: typeof p.tabName === 'string' ? p.tabName : 'Tab',
    ownerHostId: typeof p.ownerHostId === 'string' ? p.ownerHostId : 'local',
    workspaceName: typeof p.workspaceName === 'string' ? p.workspaceName : 'Project',
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
  // 工作区编辑弹层(头部 profile 徽标点开);ws 名本地跟进改名保存,种子只给初值
  const [editOpen, setEditOpen] = useState(false);
  const [wsName, setWsName] = useState('Project');
  // 当前生效的 profile 绑定:读本窗 store(编辑保存/主窗推送即时反映,快照对账同源)
  const boundProfileId = useAppStore(
    (s) => s.workspaces[0]?.browserProfileId ?? DEFAULT_PROFILE_ID,
  );
  const profiles = useAppStore((s) => s.browserProfiles);
  const profileName =
    boundProfileId === DEFAULT_PROFILE_ID
      ? t('OkWork (built-in)')
      : (profiles.find((p) => p.id === boundProfileId)?.name ?? t('OkWork (built-in)'));

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
        if (!s) return; // 无种子(异常路径):停留空态,用户关窗即直接关闭
        document.title = `OkBrowser · ${s.tabName}`;
        setWsName(s.workspaceName);
        useAppStore.setState({
          workspaces: [
            {
              id: SHELL_WS_ID,
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
          activeWorkspaceId: SHELL_WS_ID,
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

  // 主窗转投的新标签(终端链接点到本窗格 / 文件面板预览等,opts 透传 netHostId/preview)
  useEffect(() => {
    return window.okwork?.browserPane?.onAddTab?.((url, opts) => {
      useAppStore.getState().addBrowserTab(terminalTabId, url, opts);
    });
  }, [terminalTabId]);

  // 窗格被清空(用户关光标签 → BrowserPanel 的收面板逻辑把 browserPanelOpen 置 false)
  // → 壳窗没有「空面板」形态,直接关窗(浏览器就此关闭,不回落开主窗面板)
  useEffect(() => {
    if (!seed || browserPanelOpen) return;
    window.okwork?.browserPane?.close?.(terminalTabId);
  }, [seed, browserPanelOpen, terminalTabId]);

  // 主窗改了本 ws 的 profile 绑定 → 本地跟进(webview 按新分区重挂重载)
  useEffect(() => {
    return window.okwork?.browserPane?.onSetProfile?.((profileId) => {
      useAppStore.getState().setWorkspaceBrowserProfile(SHELL_WS_ID, profileId);
    });
  }, []);

  // 工作区编辑保存:本地立即生效(换分区重挂)+ 经 main 转主窗权威 store(改名走
  // host RPC、绑定持久化;主窗 App.onWorkspaceEdit 应用并推给该 ws 其它壳窗)
  function handleWorkspaceSave({ name, profileId }: { name: string; profileId: string }) {
    setWsName(name);
    useAppStore.getState().setWorkspaceBrowserProfile(SHELL_WS_ID, profileId);
    window.okwork?.browserPane?.workspaceEdit?.(terminalTabId, { name, profileId });
  }

  return (
    <div className="browser-shell">
      <div className="browser-shell__header">
        <span className="browser-shell__title">
          OkBrowser · {seed?.tabName ?? terminalTabId}
        </span>
        <div className="browser-shell__actions">
          <button
            className="browser-shell__profile"
            onClick={() => setEditOpen(true)}
            title={t('Project browser profile — click to edit the project')}
          >
            <span className="browser-shell__profile-label">{t('Profile')}</span>
            <span className="browser-shell__profile-name">{profileName}</span>
          </button>
          <button
            className="browser-shell__dock"
            onClick={() => window.okwork?.browserPane?.dock?.(terminalTabId)}
            title={t('Dock back to the panel')}
          >
            {t('Dock back')}
          </button>
        </div>
      </div>
      <div className="browser-shell__body">{seed && <BrowserPanel shell />}</div>
      {editOpen && seed && (
        <WorkspaceEditModal
          workspace={{
            id: SHELL_WS_ID,
            name: wsName,
            ...(boundProfileId !== DEFAULT_PROFILE_ID
              ? { browserProfileId: boundProfileId }
              : {}),
          }}
          onSave={handleWorkspaceSave}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
