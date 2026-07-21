// 布局持久化:启动时先驱动 v1→v2 迁移,再 hydrate(注册表 + 存档),之后订阅防抖写回。
// 订阅必须在 hydrate 完成后启动,否则初始空状态会覆盖存档。
// 迁移在 hydrate 之前完成(迁移期 store.workspaces 为空,无半态可写回),规避竞态。
// 已知窗口:退出前 300ms 内的最后一次布局变更可能来不及送达 main(M1 可接受)。

import {
  AppState,
  PersistedRemoteWorkspace,
  PersistedState,
  useAppStore,
} from './store';
import { bindRestoredSessionTab, getSessionId } from '../terminal/terminalRegistry';
import { hostRegistry } from '../services/hostRegistry';
import { readoptHostSessions } from '../services/sessionReadopt';
import { runMigration } from './workspaceMigration';
import type { MigrationOutcome } from './workspaceMigration';
import type { WorkspaceEntry } from '../../shared/protocol';
import { t } from '../../shared/i18n';

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
  const raw = await window.okwork.storeGet();

  // 壳层驱动迁移(只对本机注册表):读 v1 逐条 workspace.create 保留原 id → 全成功备份并翻 v2 / 失败继续 v1
  const outcome = await runMigration(raw, {
    createWorkspace: (input) => hostRegistry.local().rpc('workspace.create', input),
    backupV1: () => window.okwork.backupV1Archive(),
    writeArchive: (state) => window.okwork.storeSet(state),
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
      .setTransientNotice(t('Failed to read the workspace registry, retrying…'));
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

/**
 * 本地会话收养预绑定(本地 host standalone 化):存档里带 sessionId 的本机 tab,
 * hydrate 后**同步**绑 inst + 接 live 管线——与远程 restoreRemoteTabLayouts 同一硬约束:
 * 必须赶在 React 挂载 TerminalView(ensureSession)之前,否则挂载先 new spawn,
 * 收养路径①接不回原会话。只绑 hydrate 后仍存活的 tab(孤儿 ws 的 tab 已被丢弃,
 * 对其绑定会造出无宿主的 inst)。stale sessionId(host 已重启/会话已 kill)无害:
 * readopt attach miss → 原位重 spawn。
 */
function bindLocalRestoredSessions(archive: PersistedState | null | undefined): void {
  if (!archive) return;
  // 存档 tabId → 收养键(workspaces 存档只含本机 ws,远程走 remoteTabs,天然不混)
  const byTab = new Map<string, { sessionId: string; cwd: string }>();
  for (const w of archive.workspaces) {
    for (const pt of w.tabs) {
      if (pt.sessionId) byTab.set(pt.id, { sessionId: pt.sessionId, cwd: pt.cwd });
    }
  }
  if (byTab.size === 0) return;
  for (const w of useAppStore.getState().workspaces) {
    if (w.hostId !== 'local') continue;
    for (const tab of w.tabs) {
      const rec = byTab.get(tab.id);
      if (rec) bindRestoredSessionTab(tab.id, 'local', rec.sessionId, rec.cwd);
    }
  }
}

/** hydrate 成功后:合并注册表+存档、接广播、启动防抖写回订阅(写回订阅只在此启动) */
function finishHydrate(registry: WorkspaceEntry[], outcome: MigrationOutcome): void {
  useAppStore.getState().hydrate(registry, outcome.archive);
  // 本地会话收养:同步预绑定(见 bindLocalRestoredSessions 时序硬约束)→ 异步收养
  // (attach 回放存活会话;session.list 补建「存档没有、host 却有」的会话 tab)。
  // 此刻 local client 已握手完成(App 在 host.info 落地后才 initPersistence),
  // supportsSessionResume 能力位可信;收养失败只 WARN,不阻断启动可用性。
  bindLocalRestoredSessions(outcome.archive);
  void readoptHostSessions('local');

  useAppStore
    .getState()
    .setTransientNotice(
      outcome.prompt
        ? t(
            'Workspace migration is not yet complete — continuing with the local archive (will retry automatically)',
          )
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
      window.okwork.storeSet(serialize(state));
    }, PERSIST_DEBOUNCE_MS);
  });
}

export function serialize(s: AppState): PersistedState {
  const ui = {
    sidebarWidth: s.sidebarWidth,
    filePanelWidth: s.filePanelWidth,
    browserPanelWidth: s.browserPanelWidth,
    pinBottomBar: s.pinBottomBar,
    // 折叠态才写盘(缺省即展开)
    ...(s.filePanelCollapsed ? { filePanelCollapsed: true } : {}),
    // 浏览器面板:打开才写开关(标签已 per-tab 存于 PersistedTab.browser,不再写全局)
    ...(s.browserPanelOpen ? { browserPanelOpen: true } : {}),
    // 'builtin' 不写盘(缺省即内置浏览器)
    ...(s.linkBrowserMode !== 'builtin' ? { linkBrowserMode: s.linkBrowserMode } : {}),
    // 'window' 不写盘(缺省即独立窗口)
    ...(s.builtinBrowserSurface !== 'window'
      ? { builtinBrowserSurface: s.builtinBrowserSurface }
      : {}),
    // 空集不写盘(存档整洁;缺省即全展开)
    ...(s.collapsedMachines.length > 0 ? { collapsedMachines: s.collapsedMachines } : {}),
    // 'system' 不写盘(缺省即随系统;main 启动读此字段定 locale)
    ...(s.localePref !== 'system' ? { locale: s.localePref } : {}),
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
  const remoteTabs = serializeRemoteTabs(s);
  return {
    version: 2,
    activeWorkspaceId,
    workspaces: localWorkspaces.map((w) => ({
      workspaceId: w.id,
      // 浏览器 profile 绑定(缺省=默认 profile 不写盘)
      ...(w.browserProfileId ? { browserProfileId: w.browserProfileId } : {}),
      activeTabId: w.activeTabId,
      tabs: w.tabs.map(serializeTab),
    })),
    ...(remoteTabs.length > 0 ? { remoteTabs } : {}),
    migrationFailureCount: 0,
    ui,
  };
}

/**
 * 远程 tab 布局写盘(用户规则 2026-07:服务端升级/重启后 tab 名称/数量/顺序不丢):
 * - 在店的远程 ws(连接中/退出前未 drop)→ live 视图态为准,sessionId 从 registry 现读;
 * - 不在店的(断线已 drop)→ 用 dropHostWorkspaces 快照进 remoteTabLayouts 的条目。
 * 远程 ws 本体仍不入 workspaces 存档(D-6/ARCH-2 防迁移污染约束不变)。
 */
function serializeRemoteTabs(s: AppState): PersistedRemoteWorkspace[] {
  const liveRemoteIds = new Set(
    s.workspaces.filter((w) => w.hostId !== 'local').map((w) => w.id),
  );
  const stored = Object.values(s.remoteTabLayouts).filter(
    (l) => !liveRemoteIds.has(l.workspaceId),
  );
  const live = s.workspaces
    .filter((w) => w.hostId !== 'local' && w.tabs.length > 0)
    .map((w) => ({
      hostId: w.hostId,
      workspaceId: w.id,
      ...(w.browserProfileId ? { browserProfileId: w.browserProfileId } : {}),
      activeTabId: w.activeTabId,
      // sessionId 已由 serializeTab 统一写入(本地/远程同构)
      tabs: w.tabs.map(serializeTab),
    }));
  return [...stored, ...live];
}

function serializeTab(t: AppState['workspaces'][number]['tabs'][number]) {
  const sessionId = getSessionId(t.id);
  return {
    id: t.id,
    cwd: t.cwd,
    customName: t.customName,
    filePanel: t.filePanel,
    // 浏览器窗格:只存 {id,url,netHostId}(title 视图态);空/未开 → 不写盘
    ...(t.browser && t.browser.tabs.length > 0
      ? {
          browser: {
            tabs: t.browser.tabs.map((b) => ({
              id: b.id,
              url: b.url,
              ...(b.netHostId ? { netHostId: b.netHostId } : {}),
            })),
            activeTabId: t.browser.activeTabId,
          },
        }
      : {}),
    // 会话收养键(本地/远程同构):活会话才写盘;本地 embedded 下恒 stale,hydrate 容忍
    ...(sessionId ? { sessionId } : {}),
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
