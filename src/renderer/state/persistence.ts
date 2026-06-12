// 布局持久化:启动时 hydrate,之后订阅 store 变化防抖写回。
// 订阅必须在 hydrate 完成后启动,否则初始空状态会覆盖存档。
// 已知窗口:退出前 300ms 内的最后一次布局变更可能来不及送达 main(M1 可接受)。

import {
  AppState,
  PersistedState,
  useAppStore,
} from './store';

const PERSIST_DEBOUNCE_MS = 300;

let initialized = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function initPersistence(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const raw = (await window.termpro.storeGet()) as PersistedState | null;
  useAppStore.getState().hydrate(raw);

  useAppStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      window.termpro.storeSet(serialize(state));
    }, PERSIST_DEBOUNCE_MS);
  });
}

function serialize(s: AppState): PersistedState {
  return {
    version: 1,
    activeWorkspaceId: s.activeWorkspaceId,
    workspaces: s.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      root: w.root,
      activeTabId: w.activeTabId,
      tabs: w.tabs.map((t) => ({
        id: t.id,
        cwd: t.cwd,
        customName: t.customName,
        filePanel: t.filePanel,
      })),
    })),
    ui: { sidebarWidth: s.sidebarWidth, filePanelWidth: s.filePanelWidth },
  };
}
