// 布局持久化:启动时先驱动 v1→v2 迁移,再 hydrate(注册表 + 存档),之后订阅防抖写回。
// 订阅必须在 hydrate 完成后启动,否则初始空状态会覆盖存档。
// 迁移在 hydrate 之前完成(迁移期 store.workspaces 为空,无半态可写回),规避竞态。
// 已知窗口:退出前 300ms 内的最后一次布局变更可能来不及送达 main(M1 可接受)。

import {
  AppState,
  PersistedState,
  useAppStore,
} from './store';
import { hostClient } from '../services/hostClient';
import { runMigration } from './workspaceMigration';
import type { WorkspaceEntry } from '../../shared/protocol';

const PERSIST_DEBOUNCE_MS = 300;

let initialized = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function initPersistence(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const raw = await window.termpro.storeGet();

  // 壳层驱动迁移:读 v1 逐条 workspace.create 保留原 id → 全成功备份并翻 v2 / 失败继续 v1
  const outcome = await runMigration(raw, {
    createWorkspace: (input) => hostClient.rpc('workspace.create', input),
    backupV1: () => window.termpro.backupV1Archive(),
    writeArchive: (state) => window.termpro.storeSet(state),
  });

  // 从 Host 拉权威注册表(v2 hydrate 的 name/root 单源;v1 fallback 忽略)
  let registry: WorkspaceEntry[] = [];
  try {
    const res = await hostClient.rpc('workspace.list', undefined);
    registry = res.workspaces;
  } catch (err) {
    console.warn('[renderer] workspace.list failed during hydrate:', err);
  }

  useAppStore.getState().hydrate(registry, outcome.archive);

  if (outcome.prompt) {
    useAppStore
      .getState()
      .setTransientNotice('Workspace 迁移暂未完成,已继续以本地存档运行(将自动重试)');
  }

  // 收 Host 注册表变更广播 → 按 id 协调本地视图态
  hostClient.onWorkspaceChanged((workspaces) => {
    useAppStore.getState().applyWorkspaceSnapshot(workspaces);
  });

  useAppStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      window.termpro.storeSet(serialize(state));
    }, PERSIST_DEBOUNCE_MS);
  });
}

export function serialize(s: AppState): PersistedState {
  const ui = {
    sidebarWidth: s.sidebarWidth,
    filePanelWidth: s.filePanelWidth,
    pinBottomBar: s.pinBottomBar,
  };

  // v1 fallback 模式:保留 name/root(全功能),version:1 + 迁移失败计数
  if (s.persistMode === 'v1') {
    return {
      version: 1,
      activeWorkspaceId: s.activeWorkspaceId,
      workspaces: s.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        root: w.root,
        activeTabId: w.activeTabId,
        tabs: w.tabs.map(serializeTab),
      })),
      migrationFailureCount: s.migrationFailureCount,
      ui,
    };
  }

  // v2 模式:去 name/root(单源 = Host 注册表),只留 workspaceId 外键 + 视图态
  return {
    version: 2,
    activeWorkspaceId: s.activeWorkspaceId,
    workspaces: s.workspaces.map((w) => ({
      workspaceId: w.id,
      activeTabId: w.activeTabId,
      tabs: w.tabs.map(serializeTab),
    })),
    migrationFailureCount: 0,
    ui,
  };
}

function serializeTab(t: AppState['workspaces'][number]['tabs'][number]) {
  return {
    id: t.id,
    cwd: t.cwd,
    customName: t.customName,
    filePanel: t.filePanel,
  };
}
