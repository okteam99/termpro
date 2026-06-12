import { useEffect, useState } from 'react';
import { hostClient } from './services/hostClient';
import { selectActiveWorkspace, useAppStore } from './state/store';
import { initPersistence } from './state/persistence';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { FilePanel } from './components/FilePanel';
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
      onExit: () => useAppStore.getState().updateTab(tabId, { exited: true }),
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

  useEffect(() => {
    hostClient.connect().then(setHostInfo, (e) => setError(String(e)));
    return hostClient.onDown(() =>
      setError('Host 进程已退出,⌘R 重载窗口可恢复'),
    );
  }, []);

  // Host 就绪后加载布局存档(先 hydrate 再启动持久化订阅)
  useEffect(() => {
    if (hostInfo) void initPersistence();
  }, [hostInfo]);

  // 冒烟模式:空状态自动建一个 workspace,跑通 store→终端全链路
  useEffect(() => {
    if (!hostInfo || !hydrated || !window.termpro.smoke) return;
    const s = useAppStore.getState();
    if (s.workspaces.length === 0) s.addWorkspace(hostInfo.homedir);
  }, [hostInfo, hydrated]);

  // 主工作区分支名:启动、workspace 集合变化、窗口聚焦时刷新
  const wsKey = useAppStore((s) => s.workspaces.map((w) => w.id).join(','));
  useEffect(() => {
    if (!hydrated) return;
    const refresh = () => {
      for (const w of useAppStore.getState().workspaces) {
        hostClient
          .rpc('git.info', { cwd: w.root })
          .then((info) =>
            useAppStore
              .getState()
              .updateWorkspace(w.id, { branch: info.branch ?? undefined }),
          )
          .catch(() => {});
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
        <div className="placeholder">Host 连接失败:{error}</div>
      </div>
    );
  }
  if (!hostInfo || !hydrated) {
    return (
      <div className="app-shell">
        <div className="placeholder">连接 Host…</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-column">
        <TabBar />
        <div className="terminal-area">
          {activeWs?.tabs.map((tab) => (
            <TerminalView
              key={tab.id}
              tabId={tab.id}
              cwd={tab.cwd}
              active={tab.id === activeWs.activeTabId}
              callbacks={callbacksFor(tab.id)}
            />
          ))}
          {activeWs && activeWs.tabs.length === 0 && (
            <div className="placeholder">⌘T 新建终端</div>
          )}
          {!activeWs && (
            <div className="placeholder">在左侧添加一个 Workspace 开始</div>
          )}
        </div>
      </div>
      <FilePanel />
    </div>
  );
}
