import { create } from 'zustand';
import { disposeTerminal, getSessionId } from '../terminal/terminalRegistry';
import { hostRegistry } from '../services/hostRegistry';
import { basename } from './pathLabel';
import { reconcileWorkspaces } from './workspaceSync';
import type { WorkspaceEntry } from '../../shared/protocol';
import { t } from '../../shared/i18n';

const LOCAL_HOST_ID = 'local';

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
  /** 会话退出码(AC-12·断线期跑完/本地退出);TabBar 渲染「exit N」。exited 时才有意义。 */
  exitCode?: number;
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
  /** 运行时路由键(BL-004):'local' | configId。'local' 随存档持久化 v2;
   *  非 local(远程发现注入)为纯视图态,serialize 过滤不写盘。hostRegistry.forWorkspace(ws) 据此选客户端。 */
  hostId: string;
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

/** v1 存档 workspace(迁移前 / 迁移失败 fallback):自带 name/root */
export interface PersistedWorkspaceV1 {
  id: string;
  name: string;
  root: string;
  activeTabId: string | null;
  tabs: PersistedTab[];
}

/** v2 存档 workspace(已迁移):去 name/root,只留 workspaceId 外键 + 视图态 */
export interface PersistedWorkspaceV2 {
  /** 外键 → WorkspaceEntry.id(name/root 单源 = Host 注册表) */
  workspaceId: string;
  activeTabId: string | null;
  tabs: PersistedTab[];
}

/** 远程 tab 存档:比本机多存 sessionId——重连恢复时预绑定收养(host 存活则回放内容;
 *  host 已重启则 attach miss → 原位重 spawn,内容可丢但 tab 不丢 · 用户规则 2026-07)。 */
export interface PersistedRemoteTab extends PersistedTab {
  sessionId?: string;
}

/**
 * 远程 workspace 的 tab 布局存档(用户规则 2026-07:服务端升级/重启后 session 内容可丢,
 * tab 名称/数量/顺序不能丢)。远程 ws 本体仍是纯视图态不入 workspaces 存档(D-6/ARCH-2
 * 防迁移污染不变)——布局单独入 v2 存档顶层 remoteTabs,按 workspaceId 外键挂回。
 */
export interface PersistedRemoteWorkspace {
  /** 路由键 configId(恢复时按 host 消费) */
  hostId: string;
  workspaceId: string;
  activeTabId: string | null;
  tabs: PersistedRemoteTab[];
}

interface PersistedUi {
  sidebarWidth?: number;
  filePanelWidth?: number;
  /** 向上滚动时固定底部输入栏(默认关) */
  pinBottomBar?: boolean;
}

/** v1 存档(version:1):未迁移或迁移失败 fallback 的全功能形态 */
export interface PersistedStateV1 {
  version: 1;
  activeWorkspaceId: string | null;
  workspaces: PersistedWorkspaceV1[];
  /** 跨启动累计迁移失败次数(AC-4;version=1 的失败落点) */
  migrationFailureCount?: number;
  ui?: PersistedUi;
}

/** v2 存档(version:2):已迁移,workspace 去 name/root 只留外键 */
export interface PersistedStateV2 {
  version: 2;
  activeWorkspaceId: string | null;
  workspaces: PersistedWorkspaceV2[];
  /** 远程 tab 布局(可缺省 · 向后兼容:旧存档无此字段 → 无布局可恢复) */
  remoteTabs?: PersistedRemoteWorkspace[];
  migrationFailureCount?: number;
  ui?: PersistedUi;
}

export type PersistedState = PersistedStateV1 | PersistedStateV2;

export interface AppState {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  /** 存档已加载(或确认无存档),UI 渲染与持久化订阅以此为门 */
  hydrated: boolean;
  /** persistence 模式:v2=已迁移(CRUD 走 Host RPC、serialize 去 name/root) /
   *  v1=迁移失败 fallback(CRUD 本地全功能、serialize 保留 name/root)。迁移标记单源。 */
  persistMode: 'v1' | 'v2';
  /** 跨启动累计迁移失败次数(随存档持久化) */
  migrationFailureCount: number;
  /** 非 tab 级一次性轻量提示(null=不显示);TransientToast 消费,无历史/无导航 */
  transientNotice: string | null;
  /** create RPC 在途 → 等待期防重复提交(AC-2) */
  creatingWorkspace: boolean;
  /** remove/rename RPC 在途的 workspace id → 等待期防重复提交(AC-2) */
  pendingWorkspaceIds: string[];
  /** hydrate:注册表(name/root 单源)+ 存档(视图态/迁移标记)合并 */
  hydrate(registry: WorkspaceEntry[], archive: PersistedState | null): void;
  /** 新增:targetHostId 默认 'local'。v2=选定 host 的 client 发 workspace.create,等待确认后
   *  入列并激活(新建即选中);未命中该 host(forHostId→null)→ 拒绝不建仓。
   *  v1=仅本机(targetHostId!=='local' → 拒绝,远程操作在本地回退模式下不可用)。 */
  addWorkspace(root: string, targetHostId?: string): Promise<void>;
  /** 删除:按 ws.hostId 路由(forWorkspace);v2=等待 workspace.remove 确认后本地回收;
   *  v1=仅本机 ws 本地同步(远程 ws 若出现在 v1 store 中 → 拒绝) */
  removeWorkspace(id: string): Promise<void>;
  /** 改名:按 ws.hostId 路由(forWorkspace);v2=等待 workspace.update 确认后同步;
   *  v1=仅本机 ws 本地同步(远程 ws 若出现在 v1 store 中 → 拒绝) */
  renameWorkspace(id: string, name: string): Promise<void>;
  setActiveWorkspace(id: string): void;
  /** 运行时字段本地更新(branch 等,不入注册表;v1 模式的 name 亦经此本地写) */
  updateWorkspace(
    id: string,
    patch: Partial<Pick<WorkspaceState, 'name' | 'branch'>>,
  ): void;
  /** 收到本机 workspace:changed 全量快照 → 作用域隔离协调(scopeHostId='local',仅 v2 模式生效,
   *  不触碰其它 host 的 ws) */
  applyWorkspaceSnapshot(snapshot: WorkspaceEntry[]): void;
  /** 远程发现/该机 onWorkspaceChanged 推送 → 作用域隔离协调(scopeHostId=hostId),
   *  只影响该 configId 下的 ws,本机与其它远程机 ws 不动(BL-004) */
  setHostWorkspaces(hostId: string, entries: WorkspaceEntry[]): void;
  /** 远程断线/删除:移除该 host 全部 ws + 释放其全部 tab;active 若属该 host → 回落本机首个(无则 null)。
   *  移除前把该机各 ws 的 tab 布局快照进 remoteTabLayouts(重连/重启后恢复 · 用户规则 2026-07)。 */
  dropHostWorkspaces(hostId: string): void;
  /** 远程 tab 布局存档(workspaceId → 布局):hydrate 装载、drop 快照写入、恢复时消费。
   *  不在 store 的 ws 以此为准;在店的 ws 以 live 视图态为准(serialize 侧合并)。 */
  remoteTabLayouts: Record<string, PersistedRemoteWorkspace>;
  /** 消费(读取并删除)某 host 的全部布局条目——恢复是单次性的,消费后 live 视图态即唯一真相 */
  consumeRemoteTabLayouts(hostId: string): PersistedRemoteWorkspace[];
  /** 布局恢复:仅当远程 ws 存在且当前 0 tab 时按存档原序重建 tabs;返回是否应用 */
  restoreWorkspaceTabs(
    workspaceId: string,
    tabs: PersistedRemoteTab[],
    activeTabId: string | null,
  ): boolean;
  /** 设置/清除一次性提示 */
  setTransientNotice(text: string | null): void;
  /** 拖拽排序:把工作区移到目标下标(越界自动夹紧) */
  moveWorkspace(id: string, toIndex: number): void;
  addTab(workspaceId: string, cwd?: string): void;
  /** 收养重建(PENDING-006):为服务端既有会话补建 tab(重启后重连/断开期丢 inst),返回新
   *  tabId 供 readoptHost path② 绑 inst;workspaceId 不存在 → null(调用方跳过该会话)。
   *  不抢焦点:仅该 ws 尚无 activeTabId 时落焦(重启后 0-tab ws 首个收养 tab 自然成为激活 tab)。 */
  adoptSessionTab(workspaceId: string, cwd: string, processName?: string): string | null;
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
  /** 向上滚动时固定底部输入栏(终端层据此开关 BottomBarPin + scrollOnUserInput) */
  pinBottomBar: boolean;
  setPinBottomBar(value: boolean): void;
}


function makeTab(cwd: string): TabState {
  return { id: crypto.randomUUID(), title: basename(cwd), cwd };
}

function hydrateTab(t: PersistedTab): TabState {
  return {
    id: t.id,
    title: basename(t.cwd),
    cwd: t.cwd,
    customName: t.customName,
    filePanel: t.filePanel,
  };
}

/** drop 前快照某远程 ws 的 tab 布局(须在 disposeTerminal 之前调用——sessionId 从
 *  registry 读,dispose 后即不可得;host 重启场景该 sessionId 自然失效 → 恢复时重 spawn)。 */
function snapshotRemoteLayout(hostId: string, w: WorkspaceState): PersistedRemoteWorkspace {
  return {
    hostId,
    workspaceId: w.id,
    activeTabId: w.activeTabId,
    tabs: w.tabs.map((t) => ({
      id: t.id,
      cwd: t.cwd,
      customName: t.customName,
      filePanel: t.filePanel,
      sessionId: getSessionId(t.id) ?? undefined,
    })),
  };
}

function resolveActiveTab(
  tabs: TabState[],
  activeTabId: string | null,
): string | null {
  return tabs.find((t) => t.id === activeTabId)?.id ?? tabs[0]?.id ?? null;
}

function resolveActiveWs(
  workspaces: WorkspaceState[],
  activeWorkspaceId: string | null,
): string | null {
  return (
    workspaces.find((w) => w.id === activeWorkspaceId)?.id ??
    workspaces[0]?.id ??
    null
  );
}

/**
 * 新建本机 ws 插入时维持「本机 ws 是数组连续前缀」不变式(review E1):插到首个非本机 ws
 * 之前,而不是整体数组末尾。Sidebar 拖拽把「本机子集下标」映射回「全量数组下标」依赖此前缀,
 * 若本机 ws 在远程 ws 已存在时被 append 到末尾(如 [L0,L1,R0,L2]),下标映射即错位。
 * 还没有远程 ws 时,firstRemoteIdx=-1,等价于原来的「append 到末尾」,本机零回归。
 */
function insertLocalWorkspace(
  workspaces: WorkspaceState[],
  ws: WorkspaceState,
): WorkspaceState[] {
  const firstRemoteIdx = workspaces.findIndex((w) => w.hostId !== LOCAL_HOST_ID);
  if (firstRemoteIdx < 0) return [...workspaces, ws];
  const next = [...workspaces];
  next.splice(firstRemoteIdx, 0, ws);
  return next;
}

/** 由注册表记录合成默认单 tab 视图(新建 / 快照新增 / 注册表有存档无);hostId 默认 'local'(本机调用零改) */
function buildDefaultWorkspace(
  entry: WorkspaceEntry,
  hostId: string = LOCAL_HOST_ID,
): WorkspaceState {
  const tab = makeTab(entry.root);
  return {
    id: entry.id,
    name: entry.name,
    root: entry.root,
    hostId,
    tabs: [tab],
    activeTabId: tab.id,
  };
}

/**
 * 把某 tab 标记为"已查看"并设为其工作区当前 tab:
 * - 清注意力标记(源 B:waiting/unseenDone)
 * - 该 tab 未读通知标已读(源 A:notifications[].read)→ 顶部铃铛角标随之递减
 * 返回可并入 zustand set() 的局部 state(workspaces + notifications)。
 * 切 tab(setActiveTab)与切工作区使其 active tab 可见(setActiveWorkspace)共用此逻辑,
 * 避免两个"查看"入口对两套状态的清除不对称(BUG-TERMPRO-B260614065346-001)。
 */
function markTabViewed(
  s: AppState,
  workspaceId: string,
  tabId: string,
): Pick<AppState, 'workspaces' | 'notifications'> {
  return {
    workspaces: s.workspaces.map((w) =>
      w.id === workspaceId
        ? {
            ...w,
            activeTabId: tabId,
            tabs: w.tabs.map((t) =>
              t.id === tabId
                ? { ...t, waiting: false, unseenDone: false }
                : t,
            ),
          }
        : w,
    ),
    notifications: s.notifications.map((n) =>
      n.tabId === tabId && !n.read ? { ...n, read: true } : n,
    ),
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  hydrated: false,
  persistMode: 'v2',
  migrationFailureCount: 0,
  transientNotice: null,
  creatingWorkspace: false,
  pendingWorkspaceIds: [],
  sidebarWidth: 240,
  filePanelWidth: 280,
  pinBottomBar: false,
  remoteTabLayouts: {},

  hydrate(registry, archive) {
    // ui 恢复(两种模式都读)
    if (archive?.ui) {
      set({
        sidebarWidth: archive.ui.sidebarWidth ?? 240,
        filePanelWidth: archive.ui.filePanelWidth ?? 280,
        pinBottomBar: archive.ui.pinBottomBar ?? false,
      });
    }

    // v1 fallback:从存档直接构建(自带 name/root),忽略注册表(全功能)
    if (archive && archive.version === 1) {
      const workspaces: WorkspaceState[] = archive.workspaces.map((w) => {
        const tabs = w.tabs.map(hydrateTab);
        return {
          id: w.id,
          name: w.name,
          root: w.root,
          hostId: LOCAL_HOST_ID, // 存档只含本机 ws(远程不持久化)
          tabs,
          activeTabId: resolveActiveTab(tabs, w.activeTabId),
        };
      });
      set({
        workspaces,
        activeWorkspaceId: resolveActiveWs(workspaces, archive.activeWorkspaceId),
        persistMode: 'v1',
        migrationFailureCount: archive.migrationFailureCount ?? 0,
        remoteTabLayouts: {}, // v1 fallback 不支持远程布局(远程 CRUD 本就拒绝)
        hydrated: true,
      });
      return;
    }

    // v2(archive null 或 version==2):注册表(name/root)⋈ 存档 v2(视图态)按 workspaceId 外键
    const v2 = archive && archive.version === 2 ? archive : null;
    const regById = new Map(registry.map((e) => [e.id, e]));
    const seen = new Set<string>();
    const workspaces: WorkspaceState[] = [];
    if (v2) {
      for (const pw of v2.workspaces) {
        const entry = regById.get(pw.workspaceId);
        if (!entry) continue; // 孤儿外键 → 静默丢弃(AC-5)
        seen.add(entry.id);
        const tabs = pw.tabs.map(hydrateTab);
        workspaces.push({
          id: entry.id,
          name: entry.name,
          root: entry.root,
          hostId: LOCAL_HOST_ID, // 存档只含本机 ws(远程不持久化)
          tabs,
          activeTabId: resolveActiveTab(tabs, pw.activeTabId),
        });
      }
    }
    // 注册表有、存档未引用的 → 合成默认视图(追加末尾)
    for (const entry of registry) {
      if (seen.has(entry.id)) continue;
      workspaces.push(buildDefaultWorkspace(entry));
    }
    // 远程 tab 布局装载(用户规则 2026-07):按 workspaceId 建索引,等对应 host
    // ready + workspace.list 落地后由 restoreRemoteTabLayouts 消费。
    const remoteTabLayouts: Record<string, PersistedRemoteWorkspace> = {};
    for (const layout of v2?.remoteTabs ?? []) {
      remoteTabLayouts[layout.workspaceId] = layout;
    }
    set({
      workspaces,
      activeWorkspaceId: resolveActiveWs(workspaces, v2?.activeWorkspaceId ?? null),
      persistMode: 'v2',
      migrationFailureCount: v2?.migrationFailureCount ?? 0,
      remoteTabLayouts,
      hydrated: true,
    });
  },

  async addWorkspace(root, targetHostId = LOCAL_HOST_ID) {
    // v1 全功能:仅本机(远程操作需 v2 + 该机 client · 防污染 v1 存档)
    if (get().persistMode === 'v1') {
      if (targetHostId !== LOCAL_HOST_ID) {
        console.warn('[renderer] addWorkspace remote target rejected in v1 fallback:', targetHostId);
        set({ transientNotice: t('Remote operations are unavailable in local fallback mode') });
        return;
      }
      const ws = buildDefaultWorkspace(
        { id: crypto.randomUUID(), name: basename(root), root },
        LOCAL_HOST_ID,
      );
      set((s) => ({
        workspaces: insertLocalWorkspace(s.workspaces, ws),
        activeWorkspaceId: ws.id,
      }));
      return;
    }
    // v2:等待确认式 RPC + 防重复提交
    if (get().creatingWorkspace) return;
    // 写操作走 forHostId:未命中(该机已断线/未连接)→ 拒绝创建,绝不兜底落本机
    const client = hostRegistry.forHostId(targetHostId);
    if (!client) {
      console.warn('[renderer] addWorkspace target host unavailable:', targetHostId);
      set({ transientNotice: t('Target host is disconnected') });
      return;
    }
    set({ creatingWorkspace: true });
    try {
      const entry = await client.rpc('workspace.create', {
        name: basename(root),
        root,
      });
      set((s) => {
        const exists = s.workspaces.some((w) => w.id === entry.id);
        const workspaces = exists
          ? s.workspaces.map((w) =>
              w.id === entry.id ? { ...w, name: entry.name, root: entry.root } : w,
            )
          : targetHostId === LOCAL_HOST_ID
            ? insertLocalWorkspace(s.workspaces, buildDefaultWorkspace(entry, targetHostId))
            : [...s.workspaces, buildDefaultWorkspace(entry, targetHostId)]; // 远程 ws 仍 append
        return { workspaces, activeWorkspaceId: entry.id, creatingWorkspace: false };
      });
    } catch (err) {
      console.warn('[renderer] workspace create failed:', err);
      set({ creatingWorkspace: false, transientNotice: t('Failed to create workspace, please retry') });
    }
  },

  async removeWorkspace(id) {
    const disposeAndRemove = () => {
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
          pendingWorkspaceIds: s.pendingWorkspaceIds.filter((x) => x !== id),
        };
      });
    };

    const ws = get().workspaces.find((w) => w.id === id);

    // v1 全功能:仅本机 ws 本地同步(远程 ws 理应不出现在 v1 store,防御性拒绝)
    if (get().persistMode === 'v1') {
      if (ws && ws.hostId !== LOCAL_HOST_ID) {
        console.warn('[renderer] removeWorkspace remote ws rejected in v1 fallback:', id);
        set({ transientNotice: t('Remote operations are unavailable in local fallback mode') });
        return;
      }
      disposeAndRemove();
      return;
    }
    // v2:按 ws.hostId 路由(forWorkspace) + 等待确认式 RPC + 防重复提交
    // review A5:ws 已不在 store(竞态/重复点击/陈旧 id)→ 无路由依据,直接返回,
    // 绝不兜底 { hostId: 'local' }(那会把本该发往未知 host 的删除误发到本机)。
    if (!ws) return;
    if (get().pendingWorkspaceIds.includes(id)) return;
    set((s) => ({ pendingWorkspaceIds: [...s.pendingWorkspaceIds, id] }));
    try {
      await hostRegistry.forWorkspace(ws).rpc('workspace.remove', { id });
      // 成功才本地回收;回声 workspace:changed 再次协调为幂等 no-op
      disposeAndRemove();
    } catch (err) {
      console.warn('[renderer] workspace remove failed:', err);
      set((s) => ({
        pendingWorkspaceIds: s.pendingWorkspaceIds.filter((x) => x !== id),
        transientNotice: t('Failed to delete workspace, please retry'),
      }));
    }
  },

  async renameWorkspace(id, name) {
    const ws = get().workspaces.find((w) => w.id === id);

    // v1 全功能:仅本机 ws 本地同步(远程 ws 理应不出现在 v1 store,防御性拒绝)
    if (get().persistMode === 'v1') {
      if (ws && ws.hostId !== LOCAL_HOST_ID) {
        console.warn('[renderer] renameWorkspace remote ws rejected in v1 fallback:', id);
        set({ transientNotice: t('Remote operations are unavailable in local fallback mode') });
        return;
      }
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
      }));
      return;
    }
    // v2:按 ws.hostId 路由(forWorkspace) + 等待确认式 RPC + 防重复提交
    // review A5:ws 已不在 store → 无路由依据,直接返回,绝不兜底本机误发。
    if (!ws) return;
    if (get().pendingWorkspaceIds.includes(id)) return;
    set((s) => ({ pendingWorkspaceIds: [...s.pendingWorkspaceIds, id] }));
    try {
      const entry = await hostRegistry.forWorkspace(ws).rpc('workspace.update', { id, name });
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === entry.id ? { ...w, name: entry.name, root: entry.root } : w,
        ),
        pendingWorkspaceIds: s.pendingWorkspaceIds.filter((x) => x !== id),
      }));
    } catch (err) {
      console.warn('[renderer] workspace rename failed:', err);
      set((s) => ({
        pendingWorkspaceIds: s.pendingWorkspaceIds.filter((x) => x !== id),
        transientNotice: t('Failed to rename workspace, please retry'),
      }));
    }
  },

  applyWorkspaceSnapshot(snapshot) {
    // v1 fallback 下 Host 无权威(单机 fallback 无第二客户端)→ 忽略广播
    if (get().persistMode !== 'v2') return;
    const s = get();
    const { workspaces, activeWorkspaceId, disposedTabIds } = reconcileWorkspaces(
      s.workspaces,
      s.activeWorkspaceId,
      snapshot,
      LOCAL_HOST_ID,
    );
    disposedTabIds.forEach((tabId) => disposeTerminal(tabId));
    set({ workspaces, activeWorkspaceId });
  },

  setHostWorkspaces(hostId, entries) {
    // 远程发现与本地持久化模式无关(v1/v2 均生效)——远程 ws 是纯视图态,不受迁移状态门控
    const s = get();
    const { workspaces, activeWorkspaceId, disposedTabIds } = reconcileWorkspaces(
      s.workspaces,
      s.activeWorkspaceId,
      entries,
      hostId,
    );
    disposedTabIds.forEach((tabId) => disposeTerminal(tabId));
    set({ workspaces, activeWorkspaceId });
  },

  dropHostWorkspaces(hostId) {
    const dropped = get().workspaces.filter((w) => w.hostId === hostId);
    // 🔴 布局快照必须先于 disposeTerminal(sessionId 从 registry 读,dispose 即失)。
    // 0-tab ws 不留条目(无可恢复物;旧条目一并清除,不让陈旧布局借尸还魂)。
    const remoteTabLayouts = { ...get().remoteTabLayouts };
    for (const w of dropped) {
      delete remoteTabLayouts[w.id];
      if (w.tabs.length > 0) remoteTabLayouts[w.id] = snapshotRemoteLayout(hostId, w);
    }
    dropped.forEach((w) => w.tabs.forEach((t) => disposeTerminal(t.id)));
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.hostId !== hostId);
      const activeWasDropped =
        s.activeWorkspaceId !== null &&
        dropped.some((w) => w.id === s.activeWorkspaceId);
      const activeWorkspaceId = activeWasDropped
        ? (workspaces.find((w) => w.hostId === LOCAL_HOST_ID)?.id ?? null)
        : s.activeWorkspaceId;
      return { workspaces, activeWorkspaceId, remoteTabLayouts };
    });
  },

  consumeRemoteTabLayouts(hostId) {
    const all = get().remoteTabLayouts;
    const mine = Object.values(all).filter((l) => l.hostId === hostId);
    if (mine.length === 0) return [];
    const rest: Record<string, PersistedRemoteWorkspace> = {};
    for (const [k, v] of Object.entries(all)) {
      if (v.hostId !== hostId) rest[k] = v;
    }
    set({ remoteTabLayouts: rest });
    return mine;
  },

  restoreWorkspaceTabs(workspaceId, tabs, activeTabId) {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    // 仅远程 ws + 当前 0 tab 才恢复:已有 tab(闪断未 drop 的 live 视图态)以 live 为准
    if (!ws || ws.hostId === LOCAL_HOST_ID || ws.tabs.length > 0 || tabs.length === 0) {
      return false;
    }
    const restored = tabs.map(hydrateTab);
    const nextActive = resolveActiveTab(restored, activeTabId);
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, tabs: restored, activeTabId: nextActive } : w,
      ),
    }));
    return true;
  },

  setTransientNotice(text) {
    set({ transientNotice: text });
  },

  setActiveWorkspace(id) {
    set((s) => {
      const ws = s.workspaces.find((w) => w.id === id);
      const activeTabId = ws?.activeTabId ?? null;
      // 切到工作区即让其 active tab 可见 = 视作查看该 tab:
      // 与 setActiveTab 一致清两套状态,否则角标对该 tab 残留(external review medium)。
      return {
        activeWorkspaceId: id,
        ...(activeTabId ? markTabViewed(s, id, activeTabId) : {}),
      };
    });
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

  adoptSessionTab(workspaceId, cwd, processName) {
    if (!get().workspaces.some((w) => w.id === workspaceId)) return null;
    const tab: TabState = { ...makeTab(cwd), processName };
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        return { ...w, tabs: [...w.tabs, tab], activeTabId: w.activeTabId ?? tab.id };
      }),
    }));
    return tab.id;
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
    // 激活即视作已查看:清注意力标记(源 B)+ 该 tab 未读通知标已读(源 A)→ 角标递减。
    set((s) => markTabViewed(s, workspaceId, tabId));
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

  setPinBottomBar(value) {
    set({ pinBottomBar: value });
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
