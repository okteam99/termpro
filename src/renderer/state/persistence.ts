// 布局持久化:启动时先驱动 v1→v2 迁移,再 hydrate(注册表 + 存档),之后订阅防抖写回。
// 订阅必须在 hydrate 完成后启动,否则初始空状态会覆盖存档。
// 迁移在 hydrate 之前完成(迁移期 store.workspaces 为空,无半态可写回),规避竞态。
// 已知窗口:退出前 300ms 内的最后一次布局变更可能来不及送达 main(M1 可接受)。

import {
  AppState,
  PersistedState,
  useAppStore,
} from './store';
import { hostRegistry } from '../services/hostRegistry';
import { runMigration } from './workspaceMigration';
import type { MigrationOutcome } from './workspaceMigration';
import type { WorkspaceEntry } from '../../shared/protocol';

const PERSIST_DEBOUNCE_MS = 300;
// 注册表读失败后的有限重试(读失败 ≠ 注册表真空,见 hydrateFromHost)
const REGISTRY_RETRY_MS = 800;
const REGISTRY_MAX_RETRIES = 5;

let initialized = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let registryRetries = 0;

export async function initPersistence(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await hydrateFromHost();
}

async function hydrateFromHost(): Promise<void> {
  const raw = await window.termpro.storeGet();

  // 壳层驱动迁移(只对本机注册表):读 v1 逐条 workspace.create 保留原 id → 全成功备份并翻 v2 / 失败继续 v1
  const outcome = await runMigration(raw, {
    createWorkspace: (input) => hostRegistry.local().rpc('workspace.create', input),
    backupV1: () => window.termpro.backupV1Archive(),
    writeArchive: (state) => window.termpro.storeSet(state),
  });

  // 从本机 Host 拉权威注册表(v2 hydrate 的 name/root 单源;v1 fallback 忽略)。
  // 🔴 hydrate 只发现本机 ws(D-6·远程 ws 走实时发现,不走持久化路径)。
  // 用 null 显式标记「读失败」,区别于「读成功且注册表为空([])」。
  let registry: WorkspaceEntry[] | null = null;
  try {
    const res = await hostRegistry.local().rpc('workspace.list', undefined);
    registry = res.workspaces;
  } catch (err) {
    console.warn('[renderer] workspace.list failed during hydrate:', err);
  }

  // 🔴 F1:v2 模式下 list 失败是「读失败」而非「注册表真空」—— 数据仍在盘上,只是这次没读到。
  // 若当空注册表 hydrate,v2 存档里每条 workspaceId 都成孤儿被丢弃(hydrate 成空),
  // 且随后的防抖写回订阅会把空态固化落盘,永久抹掉视图态。故:不 hydrate、不订阅写回,
  // 停在未 hydrate 占位(App 显示「连接 Host…」)+ 提示,并有限重试。
  // v1 fallback(outcome.mode==='v1')不依赖注册表,list 失败无害,照常 hydrate。
  if (outcome.mode === 'v2' && registry === null) {
    useAppStore
      .getState()
      .setTransientNotice('无法读取 Workspace 注册表,正在重试…');
    scheduleRegistryRetry();
    return;
  }

  registryRetries = 0;
  finishHydrate(registry ?? [], outcome);
}

/** 注册表读失败后的有限自动重试;耗尽后停在占位(用户可 ⌘R 重载窗口恢复) */
function scheduleRegistryRetry(): void {
  if (registryRetries >= REGISTRY_MAX_RETRIES) return;
  registryRetries += 1;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void hydrateFromHost();
  }, REGISTRY_RETRY_MS);
}

/** hydrate 成功后:合并注册表+存档、接广播、启动防抖写回订阅(写回订阅只在此启动) */
function finishHydrate(registry: WorkspaceEntry[], outcome: MigrationOutcome): void {
  useAppStore.getState().hydrate(registry, outcome.archive);

  useAppStore
    .getState()
    .setTransientNotice(
      outcome.prompt
        ? 'Workspace 迁移暂未完成,已继续以本地存档运行(将自动重试)'
        : null,
    );

  // 收本机 Host 注册表变更广播 → 按 id 协调本地视图态(applyWorkspaceSnapshot 已限 hostId='local' 作用域)
  hostRegistry.local().onWorkspaceChanged((workspaces) => {
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

  // 🔴 D-6/ARCH-2:远程 ws(hostId!=='local')是纯视图态,v1+v2 两分支都不写盘——
  // 否则重启后 v2 会产生孤儿外键,v1 fallback 会被 runMigration 逐条 create 在本机重建(污染)。
  const localWorkspaces = s.workspaces.filter((w) => w.hostId === 'local');
  const activeWorkspaceId =
    s.activeWorkspaceId !== null &&
    localWorkspaces.some((w) => w.id === s.activeWorkspaceId)
      ? s.activeWorkspaceId
      : (localWorkspaces[0]?.id ?? null);

  // v1 fallback 模式:保留 name/root(全功能),version:1 + 迁移失败计数
  if (s.persistMode === 'v1') {
    return {
      version: 1,
      activeWorkspaceId,
      workspaces: localWorkspaces.map((w) => ({
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
    activeWorkspaceId,
    workspaces: localWorkspaces.map((w) => ({
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

/** 仅供单测:清模块级 init/重试状态,使 initPersistence 可在多用例间独立重跑 */
export function __resetPersistenceForTests(): void {
  initialized = false;
  registryRetries = 0;
  if (timer) clearTimeout(timer);
  if (retryTimer) clearTimeout(retryTimer);
  timer = null;
  retryTimer = null;
}
