import { create } from 'zustand';
import { disposeTerminal } from '../terminal/terminalRegistry';
import { basename } from './pathLabel';

export { basename, tildify, tabPathLabel } from './pathLabel';

/** 文件面板与 tab 的绑定状态(每个 tab 独立,持久化) */
export interface TabFilePanelState {
  mode: 'root' | 'worktree';
  /** Root 视图手动指定的根;未设置时默认 = 该 tab 所在仓库主工作区根 */
  rootPath?: string;
  /** WorkTree 视图绑定的工作区根;未设置时默认 = 会话所在工作区根 */
  worktreePath?: string;
  /** 文件树已展开目录(绝对路径);每个 tab 独立,切 tab/工作区/重启后恢复展开态 */
  expanded?: string[];
}

export interface TabState {
  id: string;
  /** 显示名:默认 basename(cwd),前台进程名变化后覆盖 */
  title: string;
  /** 初始 cwd;shell 经 OSC 7 上报后更新(持久化恢复用) */
  cwd: string;
  /** 用户自定义名;设置后完全替代默认名(默认名=相对工作区的目录路径),持久化 */
  customName?: string;
  processName?: string;
  exited?: boolean;
  filePanel?: TabFilePanelState;
  // ---- 会话状态(运行时,host 状态机驱动,不持久化)----
  activity?: 'idle' | 'running';
  /** 可能在等输入(铃声/静默/外部通知) */
  waiting?: boolean;
  /** 后台完成、尚未被查看 */
  unseenDone?: boolean;
}

export interface NotificationItem {
  id: string;
  workspaceId: string;
  tabId: string;
  kind: 'waiting' | 'done' | 'bell' | 'notify';
  text: string;
  ts: number;
  read: boolean;
}

export interface WorkspaceState {
  id: string;
  name: string;
  root: string;
  /** 主工作区(main worktree)当前分支名,运行时获取,不持久化 */
  branch?: string;
  tabs: TabState[];
  activeTabId: string | null;
}

// ---- 持久化形状(只存能恢复的:布局 + cwd,不存会话/进程态)----

export interface PersistedTab {
  id: string;
  cwd: string;
  customName?: string;
  filePanel?: TabFilePanelState;
}

export interface PersistedWorkspace {
  id: string;
  name: string;
  root: string;
  activeTabId: string | null;
  tabs: PersistedTab[];
}

export interface PersistedState {
  version: 1;
  activeWorkspaceId: string | null;
  workspaces: PersistedWorkspace[];
  ui?: { sidebarWidth?: number; filePanelWidth?: number };
}

export interface AppState {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  /** 存档已加载(或确认无存档),UI 渲染与持久化订阅以此为门 */
  hydrated: boolean;
  hydrate(persisted: PersistedState | null): void;
  addWorkspace(root: string): void;
  removeWorkspace(id: string): void;
  setActiveWorkspace(id: string): void;
  updateWorkspace(
    id: string,
    patch: Partial<Pick<WorkspaceState, 'name' | 'branch'>>,
  ): void;
  /** 拖拽排序:把工作区移到目标下标(越界自动夹紧) */
  moveWorkspace(id: string, toIndex: number): void;
  addTab(workspaceId: string, cwd?: string): void;
  closeTab(workspaceId: string, tabId: string): void;
  setActiveTab(workspaceId: string, tabId: string): void;
  /** 拖拽排序:把 tab 移到目标下标(越界自动夹紧) */
  moveTab(workspaceId: string, tabId: string, toIndex: number): void;
  updateTab(tabId: string, patch: Partial<Omit<TabState, 'id'>>): void;
  /** 合并更新 tab 的文件面板绑定(mode 默认 root) */
  updateTabFilePanel(tabId: string, patch: Partial<TabFilePanelState>): void;
  // ---- 通知中心 ----
  notifications: NotificationItem[];
  pushNotification(
    n: Omit<NotificationItem, 'id' | 'read' | 'ts'> & { ts?: number },
  ): void;
  markNotificationRead(id: string): void;
  markAllNotificationsRead(): void;
  clearNotifications(): void;
  /** 用户查看后清除 tab 的注意力标记 */
  clearTabAttention(tabId: string): void;
  sidebarWidth: number;
  filePanelWidth: number;
  setPaneWidths(patch: {
    sidebarWidth?: number;
    filePanelWidth?: number;
  }): void;
}


function makeTab(cwd: string): TabState {
  return { id: crypto.randomUUID(), title: basename(cwd), cwd };
}

export const useAppStore = create<AppState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  hydrated: false,
  sidebarWidth: 240,
  filePanelWidth: 280,

  hydrate(persisted) {
    if (!persisted || persisted.version !== 1) {
      set({ hydrated: true });
      return;
    }
    if (persisted.ui) {
      set({
        sidebarWidth: persisted.ui.sidebarWidth ?? 240,
        filePanelWidth: persisted.ui.filePanelWidth ?? 280,
      });
    }
    const workspaces: WorkspaceState[] = persisted.workspaces.map((w) => {
      const tabs: TabState[] = w.tabs.map((t) => ({
        id: t.id,
        title: basename(t.cwd),
        cwd: t.cwd,
        customName: t.customName,
        filePanel: t.filePanel,
      }));
      return {
        id: w.id,
        name: w.name,
        root: w.root,
        tabs,
        activeTabId:
          tabs.find((t) => t.id === w.activeTabId)?.id ?? tabs[0]?.id ?? null,
      };
    });
    set({
      workspaces,
      activeWorkspaceId:
        workspaces.find((w) => w.id === persisted.activeWorkspaceId)?.id ??
        workspaces[0]?.id ??
        null,
      hydrated: true,
    });
  },

  addWorkspace(root) {
    const tab = makeTab(root);
    const ws: WorkspaceState = {
      id: crypto.randomUUID(),
      name: basename(root),
      root,
      tabs: [tab],
      activeTabId: tab.id,
    };
    set((s) => ({
      workspaces: [...s.workspaces, ws],
      activeWorkspaceId: ws.id,
    }));
  },

  removeWorkspace(id) {
    const ws = get().workspaces.find((w) => w.id === id);
    ws?.tabs.forEach((t) => disposeTerminal(t.id));
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.id !== id);
      return {
        workspaces,
        activeWorkspaceId:
          s.activeWorkspaceId === id
            ? (workspaces[0]?.id ?? null)
            : s.activeWorkspaceId,
      };
    });
  },

  setActiveWorkspace(id) {
    set({ activeWorkspaceId: id });
  },

  updateWorkspace(id, patch) {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === id ? { ...w, ...patch } : w,
      ),
    }));
  },

  moveWorkspace(id, toIndex) {
    set((s) => {
      const from = s.workspaces.findIndex((w) => w.id === id);
      if (from < 0) return s;
      const to = Math.max(0, Math.min(toIndex, s.workspaces.length - 1));
      if (to === from) return s;
      const workspaces = [...s.workspaces];
      const [moved] = workspaces.splice(from, 1);
      workspaces.splice(to, 0, moved);
      return { workspaces };
    });
  },

  addTab(workspaceId, cwd) {
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        const tab = makeTab(cwd ?? w.root);
        return { ...w, tabs: [...w.tabs, tab], activeTabId: tab.id };
      }),
    }));
  },

  closeTab(workspaceId, tabId) {
    disposeTerminal(tabId);
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        const closingIdx = w.tabs.findIndex((t) => t.id === tabId);
        const tabs = w.tabs.filter((t) => t.id !== tabId);
        let activeTabId = w.activeTabId;
        if (activeTabId === tabId) {
          activeTabId = tabs[Math.min(closingIdx, tabs.length - 1)]?.id ?? null;
        }
        return { ...w, tabs, activeTabId };
      }),
    }));
  },

  setActiveTab(workspaceId, tabId) {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? {
              ...w,
              activeTabId: tabId,
              // 激活即视作已查看,清注意力标记
              tabs: w.tabs.map((t) =>
                t.id === tabId
                  ? { ...t, waiting: false, unseenDone: false }
                  : t,
              ),
            }
          : w,
      ),
      // 激活即视作已查看:把该 tab 的未读通知也标已读,
      // 让通知中心角标(读 notifications)随之递减,与 tab 注意力标记对齐。
      notifications: s.notifications.map((n) =>
        n.tabId === tabId && !n.read ? { ...n, read: true } : n,
      ),
    }));
  },

  moveTab(workspaceId, tabId, toIndex) {
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        const from = w.tabs.findIndex((t) => t.id === tabId);
        if (from < 0) return w;
        const to = Math.max(0, Math.min(toIndex, w.tabs.length - 1));
        if (to === from) return w;
        const tabs = [...w.tabs];
        const [moved] = tabs.splice(from, 1);
        tabs.splice(to, 0, moved);
        return { ...w, tabs };
      }),
    }));
  },

  updateTab(tabId, patch) {
    set((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        tabs: w.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
      })),
    }));
  },

  updateTabFilePanel(tabId, patch) {
    set((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        tabs: w.tabs.map((t) =>
          t.id === tabId
            ? { ...t, filePanel: { mode: 'root', ...t.filePanel, ...patch } }
            : t,
        ),
      })),
    }));
  },

  setPaneWidths(patch) {
    set((s) => ({
      sidebarWidth: patch.sidebarWidth ?? s.sidebarWidth,
      filePanelWidth: patch.filePanelWidth ?? s.filePanelWidth,
    }));
  },

  notifications: [],

  pushNotification(n) {
    const item: NotificationItem = {
      ...n,
      id: crypto.randomUUID(),
      ts: n.ts ?? Date.now(),
      read: false,
    };
    set((s) => ({ notifications: [item, ...s.notifications].slice(0, 50) }));
  },

  markNotificationRead(id) {
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }));
  },

  markAllNotificationsRead() {
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.read ? n : { ...n, read: true },
      ),
    }));
  },

  clearNotifications() {
    set({ notifications: [] });
  },

  clearTabAttention(tabId) {
    set((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        tabs: w.tabs.map((t) =>
          t.id === tabId ? { ...t, waiting: false, unseenDone: false } : t,
        ),
      })),
    }));
  },

}));

export const selectActiveWorkspace = (s: AppState): WorkspaceState | null =>
  s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null;
