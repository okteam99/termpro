import { create } from 'zustand';
import { disposeTerminal } from '../terminal/terminalRegistry';

export interface TabState {
  id: string;
  /** 显示名:默认 basename(cwd),前台进程名变化后覆盖 */
  title: string;
  /** 初始 cwd;shell 经 OSC 7 上报后更新(持久化恢复用) */
  cwd: string;
  processName?: string;
  exited?: boolean;
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
  addTab(workspaceId: string, cwd?: string): void;
  closeTab(workspaceId: string, tabId: string): void;
  setActiveTab(workspaceId: string, tabId: string): void;
  updateTab(tabId: string, patch: Partial<Omit<TabState, 'id'>>): void;
}

export function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

/** 把 home 前缀缩写为 ~(展示用) */
export function tildify(p: string, homedir: string | undefined): string {
  if (homedir && p.startsWith(homedir)) return `~${p.slice(homedir.length)}`;
  return p;
}

function makeTab(cwd: string): TabState {
  return { id: crypto.randomUUID(), title: basename(cwd), cwd };
}

export const useAppStore = create<AppState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  hydrated: false,

  hydrate(persisted) {
    if (!persisted || persisted.version !== 1) {
      set({ hydrated: true });
      return;
    }
    const workspaces: WorkspaceState[] = persisted.workspaces.map((w) => {
      const tabs: TabState[] = w.tabs.map((t) => ({
        id: t.id,
        title: basename(t.cwd),
        cwd: t.cwd,
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
        w.id === workspaceId ? { ...w, activeTabId: tabId } : w,
      ),
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
}));

export const selectActiveWorkspace = (s: AppState): WorkspaceState | null =>
  s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null;
