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
  tabs: TabState[];
  activeTabId: string | null;
}

export interface AppState {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  addWorkspace(root: string): void;
  removeWorkspace(id: string): void;
  setActiveWorkspace(id: string): void;
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
