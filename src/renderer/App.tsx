import { Component, useEffect, useState, type ReactNode } from 'react';
import { hostRegistry } from './services/hostRegistry';
import { t } from '../shared/i18n';
import { selectActiveWorkspace, useAppStore } from './state/store';
import { initPersistence } from './state/persistence';
import { initSessionEvents } from './services/sessionEvents';
import { initSettingsSync } from './services/settingsSync';
import { initExitsSync } from './services/exitsSync';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { FilePanel } from './components/FilePanel';
import { BrowserPanel } from './components/BrowserPanel';
import { PaneHandle } from './components/PaneHandle';
import { TransientToast } from './components/TransientToast';
import TerminalView from './terminal/TerminalView';
import type { TermCallbacks } from './terminal/terminalRegistry';
import { setBuiltinWebLinkOpener } from './terminal/terminalLinks';
import { openTerminalLinkViaPolicy } from './services/linkOpenPolicy';
import type { HostInfo } from '../shared/protocol';

// 终端 web 链接 → 按设置项 linkBrowserMode 路由(linkOpenPolicy;默认内置浏览器,
// ⌘/Ctrl+点击仍走系统浏览器)。在 App 模块层注册:terminalLinks 保持零 store 依赖,
// registry↔store 不成环的纪律不破。
setBuiltinWebLinkOpener(openTerminalLinkViaPolicy);

let smokeSent = false;

/** 侧面板错误边界:面板内异常降级为隐藏该面板,绝不炸掉整树(黑屏)。
 *  终端/侧栏不受影响,面板开关仍可见,用户可关掉重开尝试恢复。 */
class PanelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[renderer] side panel crashed:', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// 终端事件 → store 的稳定回调(getState 始终取最新 action,不受组件卸载影响)
const tabCallbacks = new Map<string, TermCallbacks>();
function callbacksFor(tabId: string): TermCallbacks {
  let cb = tabCallbacks.get(tabId);
  if (!cb) {
    cb = {
      onTitle: (name) =>
        useAppStore.getState().updateTab(tabId, { processName: name }),
      onCwd: (cwd) => useAppStore.getState().updateTab(tabId, { cwd }),
      onExit: (exitCode) =>
        useAppStore.getState().updateTab(tabId, { exited: true, exitCode }),
      onFirstData: () => {
        if (!smokeSent) {
          smokeSent = true;
          window.okwork.smokeOk();
        }
      },
      onNotice: (message) => useAppStore.getState().setTransientNotice(message),
    };
    tabCallbacks.set(tabId, cb);
  }
  return cb;
}

export default function App() {
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeWs = useAppStore(selectActiveWorkspace);
  const hydrated = useAppStore((s) => s.hydrated);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const filePanelWidth = useAppStore((s) => s.filePanelWidth);
  const filePanelCollapsed = useAppStore((s) => s.filePanelCollapsed);
  const browserPanelWidth = useAppStore((s) => s.browserPanelWidth);
  const browserPanelOpen = useAppStore((s) => s.browserPanelOpen);
  // 语言切换 → 顶层订阅触发整树重渲染(t() 在 render 期取词,树内无 memo 组件,
  // 级联即全量换语言;setLocalePref 已先切 i18n 再 set,渲染期必为新语言)
  useAppStore((s) => s.localePref);

  useEffect(() => {
    hostRegistry.local().connect().then(setHostInfo, (e) => setError(String(e)));
    return hostRegistry.local().onDown(() =>
      setError(t('Host process exited — press ⌘R to reload the window')),
    );
  }, []);

  // Host 就绪后加载布局存档(先 hydrate 再启动持久化订阅)+ 会话事件接线
  useEffect(() => {
    if (!hostInfo) return;
    void initPersistence();
    initSessionEvents();
    initSettingsSync();
    initExitsSync();
  }, [hostInfo]);

  // 窗格窗口化:壳窗内容回流 → 镜像;壳窗关闭(回落按钮/红灯钮同路)→ 清 poppedOut
  useEffect(() => {
    const offSync = window.okwork?.browserPane?.onSync?.((terminalTabId, pane) => {
      const p = pane as { tabs?: unknown; activeTabId?: string | null } | null;
      if (!p || !Array.isArray(p.tabs)) return;
      useAppStore.getState().applyPoppedPaneSync(terminalTabId, {
        tabs: p.tabs as never,
        activeTabId: p.activeTabId ?? null,
      });
    });
    const offDocked = window.okwork?.browserPane?.onDocked?.((terminalTabId) => {
      useAppStore.getState().dockBrowserPane(terminalTabId);
    });
    return () => {
      offSync?.();
      offDocked?.();
    };
  }, []);

  // 冒烟模式:空状态自动建一个 workspace,跑通 store→终端全链路
  useEffect(() => {
    if (!hostInfo || !hydrated || !window.okwork.smoke) return;
    const s = useAppStore.getState();
    if (s.workspaces.length === 0) void s.addWorkspace(hostInfo.homedir);
  }, [hostInfo, hydrated]);

  // 主工作区分支名:启动、workspace 集合变化、窗口聚焦时刷新
  const wsKey = useAppStore((s) => s.workspaces.map((w) => w.id).join(','));
  useEffect(() => {
    if (!hydrated) return;
    const refresh = () => {
      // 远程 workspace 经该机 git(A25 · forWorkspace 按 ws.hostId 路由,零回归本机路径)
      for (const w of useAppStore.getState().workspaces) {
        hostRegistry
          .forWorkspace(w)
          .rpc('git.info', { cwd: w.root })
          .then((info) =>
            useAppStore
              .getState()
              .updateWorkspace(w.id, { branch: info.branch ?? undefined }),
          )
          .catch(() => undefined);
      }
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [hydrated, wsKey]);

  // 原生菜单事件(⌘T 新建 tab / ⌘W 关闭 tab)
  useEffect(() => {
    return window.okwork.onMenu((action) => {
      const s = useAppStore.getState();
      const ws = selectActiveWorkspace(s);
      if (!ws) return;
      if (action === 'new-tab') s.addTab(ws.id);
      else if (action === 'close-tab' && ws.activeTabId) {
        s.closeTab(ws.id, ws.activeTabId);
      }
    });
  }, []);

  // ⌘1..9 切换 tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const s = useAppStore.getState();
        const ws = selectActiveWorkspace(s);
        const tab = ws?.tabs[n - 1];
        if (ws && tab) {
          e.preventDefault();
          s.setActiveTab(ws.id, tab.id);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (error) {
    return (
      <div className="app-shell">
        <div className="placeholder">{t('Host connection failed: {error}', { error })}</div>
      </div>
    );
  }
  if (!hostInfo || !hydrated) {
    return (
      <div className="app-shell">
        <div className="placeholder">{t('Connecting to host…')}</div>
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      style={
        {
          '--sidebar-w': `${sidebarWidth}px`,
          '--filepanel-w': `${filePanelWidth}px`,
          '--browser-w': `${browserPanelWidth}px`,
        } as React.CSSProperties
      }
    >
      <Sidebar />
      <PaneHandle pane="sidebar" />
      <div className="main-column">
        <TabBar />
        <div className="terminal-area">
          {activeWs?.tabs.map((tab) => (
            <TerminalView
              key={tab.id}
              tabId={tab.id}
              cwd={tab.cwd}
              hostId={activeWs.hostId}
              active={tab.id === activeWs.activeTabId}
              callbacks={callbacksFor(tab.id)}
            />
          ))}
          {activeWs && activeWs.tabs.length === 0 && (
            <div className="placeholder">{t('⌘T for a new terminal')}</div>
          )}
          {!activeWs && (
            <div className="placeholder">{t('Add a workspace on the left to get started')}</div>
          )}
        </div>
      </div>
      {browserPanelOpen && (
        <>
          <PaneHandle pane="browser" />
          <PanelErrorBoundary>
            <BrowserPanel />
          </PanelErrorBoundary>
        </>
      )}
      {!filePanelCollapsed && (
        <>
          <PaneHandle pane="filepanel" />
          <FilePanel />
        </>
      )}
      <TransientToast />
    </div>
  );
}
