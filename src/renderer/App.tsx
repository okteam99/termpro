import { useEffect, useState } from 'react';
import { hostRegistry } from './services/hostRegistry';
import { t } from '../shared/i18n';
import { selectActiveWorkspace, useAppStore } from './state/store';
import { initPersistence } from './state/persistence';
import { initSessionEvents } from './services/sessionEvents';
import { initSettingsSync } from './services/settingsSync';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { FilePanel } from './components/FilePanel';
import { PaneHandle } from './components/PaneHandle';
import { TransientToast } from './components/TransientToast';
import TerminalView from './terminal/TerminalView';
import type { TermCallbacks } from './terminal/terminalRegistry';
import type { HostInfo } from '../shared/protocol';

let smokeSent = false;

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
          window.termpro.smokeOk();
        }
      },
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
  }, [hostInfo]);

  // 冒烟模式:空状态自动建一个 workspace,跑通 store→终端全链路
  useEffect(() => {
    if (!hostInfo || !hydrated || !window.termpro.smoke) return;
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
    return window.termpro.onMenu((action) => {
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
        } as React.CSSProperties
      }
    >
      <Sidebar />
      <PaneHandle side="left" />
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
      <PaneHandle side="right" />
      <FilePanel />
      <TransientToast />
    </div>
  );
}
