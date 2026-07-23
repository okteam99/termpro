import { create } from 'zustand';
import { disposeTerminal, getSessionId } from '../terminal/terminalRegistry';
import { hostRegistry } from '../services/hostRegistry';
import { basename } from './pathLabel';
import { reconcileWorkspaces } from './workspaceSync';
import type { WorkspaceEntry } from '../../shared/protocol';
import { resolveLocalePref, setLocale, t } from '../../shared/i18n';
import type { LocalePref } from '../../shared/i18n';
import { DEFAULT_PROFILE_ID } from '../../shared/browserProfile';
import type { BrowserProfile } from '../../shared/browserProfile';

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
  /** 该终端 tab 独立的内置浏览器窗格(绑定 tab · 像 filePanel);未开过浏览器 → undefined */
  browser?: BrowserPaneState;
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

/** 内置浏览器标签:url 随导航更新并持久化;title 是页面标题(视图态不写盘) */
export interface BrowserTabState {
  id: string;
  /** 空串 = 空标签(未导航,面板显示空态待输入) */
  url: string;
  title?: string;
  /** 该标签的网络出口('local'|configId)。缺省(旧存档/旧窗格)= 所属终端 tab 的
   *  ws.hostId(resolveBrowserTabNet)。新建标签在创建时物化;与所属 ws 的
   *  browserProfileId 共同决定 webview 分区(browserPartition(profileId, netHostId)),
   *  换出口/换 profile = 换分区 = 该标签 webview 重挂重载。 */
  netHostId?: string;
}

/** 某终端 tab 的浏览器窗格(绑定终端 tab · 像 filePanel):独立标签组 + 活跃标签。
 *  切终端 tab 时浏览器跟随、非 active 进后台(webview 常驻保活,CSS 显隐)。 */
export interface BrowserPaneState {
  tabs: BrowserTabState[];
  activeTabId: string | null;
  /** 窗格已弹出为独立窗口(视图态,不持久化——重启后窗口不复存在,hydrate 不带回):
   *  弹出期间窗格内容由壳窗口的 store 独占所有权,本 store 持只读镜像(经
   *  browserPane:sync 单向回流,承担持久化与出口对账);主窗不渲染其 webview、
   *  不直接改其内容(链接等新增经 relay 进壳窗)。 */
  poppedOut?: boolean;
}

/** 浏览器标签出口解析:显式 netHostId 优先,缺省回落所属终端 tab 的机器。 */
export function resolveBrowserTabNet(
  tab: Pick<BrowserTabState, 'netHostId'>,
  ownerWorkspaceHostId: string,
): string {
  return tab.netHostId ?? ownerWorkspaceHostId;
}

/** 终端链接打开方式(设置项 · 默认 'builtin'):
 *  'system' = 系统默认浏览器;'builtin' = 内置浏览器窗格(落到来源终端 tab);
 *  'builtinForRemote' = 仅远程终端 tab 用内置(本机 tab 走系统浏览器——远程场景里
 *  localhost 类地址只有经内置浏览器+远程网络出口才可达,本机则系统浏览器更顺手)。
 *  ⌘/Ctrl+点击恒走系统浏览器(逃生口),不受此设置影响。 */
export type LinkBrowserMode = 'system' | 'builtin' | 'builtinForRemote';

export const LINK_BROWSER_MODES: readonly LinkBrowserMode[] = [
  'system',
  'builtin',
  'builtinForRemote',
];

/** 内置浏览器默认打开方式(设置项 · 默认 'window' · 用户指令 2026-07-20):
 *  'window' = 独立的 OkBrowser 窗口(窗格直接窗口化);'pane' = 主窗右侧面板内。
 *  只决定「新开」时落哪:窗格已在面板里显示/已弹出为独立窗口时,就地追加标签
 *  (用户手动的摆放优先于默认值,不会被每次点链接强行搬家)。 */
export type BuiltinBrowserSurface = 'window' | 'pane';

export const BUILTIN_BROWSER_SURFACES: readonly BuiltinBrowserSurface[] = ['window', 'pane'];

export interface WorkspaceState {
  id: string;
  name: string;
  root: string;
  /** 主工作区(main worktree)当前分支名,运行时获取,不持久化 */
  branch?: string;
  /** 运行时路由键(BL-004):'local' | configId。'local' 随存档持久化 v2;
   *  非 local(远程发现注入)为纯视图态,serialize 过滤不写盘。hostRegistry.forWorkspace(ws) 据此选客户端。 */
  hostId: string;
  /** 该工作区使用的浏览器 profile(独立存储空间 + UA);缺省 = 内置默认 profile。
   *  分区 = profile × 标签出口 二维(shared/browserPartition);随 v2/remoteTabs 存档。 */
  browserProfileId?: string;
  tabs: TabState[];
  activeTabId: string | null;
}

// ---- 持久化形状(只存能恢复的:布局 + cwd,不存会话/进程态)----

export interface PersistedTab {
  id: string;
  cwd: string;
  customName?: string;
  filePanel?: TabFilePanelState;
  /** 该 tab 的浏览器窗格(只存 {id,url,netHostId};title 视图态);空/未开 → 不写盘 */
  browser?: {
    tabs: { id: string; url: string; netHostId?: string }[];
    activeTabId: string | null;
  };
  /** 会话收养键(本地/远程同构):恢复时预绑定收养——host 存活则 attach 回放内容;
   *  host 已重启/会话不存(attach miss)→ 原位重 spawn,内容可丢但 tab 不丢。
   *  本地在 embedded host 下恒 stale(会话随 app 死),hydrate 容忍;standalone 化后消费。 */
  sessionId?: string;
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
  /** 浏览器 profile 绑定;缺省 = 默认 profile(不写盘) */
  browserProfileId?: string;
  activeTabId: string | null;
  tabs: PersistedTab[];
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
  /** 浏览器 profile 绑定;缺省 = 默认 profile(不写盘) */
  browserProfileId?: string;
  activeTabId: string | null;
  tabs: PersistedTab[];
}

interface PersistedUi {
  sidebarWidth?: number;
  filePanelWidth?: number;
  /** 右侧文件面板折叠(默认展开;true 才写盘) */
  filePanelCollapsed?: boolean;
  /** 内置浏览器面板打开(默认关;true 才写盘) */
  browserPanelOpen?: boolean;
  browserPanelWidth?: number;
  /** 🔴 旧版全局浏览器标签(面板级);已迁移为 per-tab(PersistedTab.browser)。
   *  仅保留字段供 hydrate 一次性迁移读取,serialize 不再写出。 */
  browserTabs?: { id: string; url: string }[];
  browserActiveTabId?: string | null;
  /** 向上滚动时固定底部输入栏(默认关) */
  pinBottomBar?: boolean;
  /** 终端链接打开方式;缺省 = 'builtin'(内置浏览器,不写盘) */
  linkBrowserMode?: LinkBrowserMode;
  /** 内置浏览器默认打开方式;缺省 = 'window'(独立窗口,不写盘) */
  builtinBrowserSurface?: BuiltinBrowserSurface;
  /** Sidebar 折叠中的机器分组('local' | configId);展开为默认态,不入存档 */
  collapsedMachines?: string[];
  /** 语言偏好;缺省 = 随系统('system' 不写盘) */
  locale?: 'en' | 'zh-CN';
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
  /** 布局恢复:仅当远程 ws 存在且当前 0 tab 时按存档原序重建 tabs;返回是否应用。
   *  browserProfileId 一并恢复(远程 ws 的 profile 绑定随布局存档走)。 */
  restoreWorkspaceTabs(
    workspaceId: string,
    tabs: PersistedTab[],
    activeTabId: string | null,
    browserProfileId?: string,
  ): boolean;
  // ---- 浏览器 Profile(每工作区独立存储 + UA;权威在 main,此处为快照镜像)----
  /** 全部自定义 profile(不含虚拟默认;profilesSync 从 main 拉取/订阅) */
  browserProfiles: BrowserProfile[];
  /** profile 快照已到达(list 至少成功一次)——profile 绑定工作区的 webview 以此为
   *  渲染门,避免「先按 default 挂、快照到了再重挂」的启动双载与跨分区串写 */
  browserProfilesLoaded: boolean;
  /** 快照落地 + 对账:workspace 绑定的 profile 已不存在 → 剥离(回落默认 profile) */
  setBrowserProfiles(profiles: BrowserProfile[]): void;
  /** 设置某工作区的浏览器 profile;'default'/undefined = 清除绑定(回默认)。
   *  消费方(BrowserPanel 分区计算)据此重挂重载该 ws 全部浏览器标签。 */
  setWorkspaceBrowserProfile(workspaceId: string, profileId: string | undefined): void;
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
  browserPanelWidth: number;
  setPaneWidths(patch: {
    sidebarWidth?: number;
    filePanelWidth?: number;
    browserPanelWidth?: number;
  }): void;
  /** 右侧文件面板折叠态,随 ui 存档持久化 */
  filePanelCollapsed: boolean;
  toggleFilePanelCollapsed(): void;
  /** 内置浏览器面板(右侧最外)开关;打开时若当前活跃终端 tab 无浏览器标签自动种一个空标签 */
  browserPanelOpen: boolean;
  toggleBrowserPanel(): void;
  // 浏览器窗格绑定终端 tab(TabState.browser)。以下 action 均按 terminalTabId 定位——
  // 因 webview 跨终端 tab 常驻保活,后台 tab 的 window.open 也须落回它自己的窗格。
  /** 在指定终端 tab 新建浏览器标签并激活(url 缺省空 → 面板空态待输入);面板保持打开 */
  addBrowserTab(terminalTabId: string, url?: string): void;
  /** 关闭指定终端 tab 的某浏览器标签;关掉最后一个 → 窗格清空,且若该窗格属于当前
   *  活跃终端 tab → 面板一并收起(用户指令 2026-07-14;后台窗格清空不动全局面板态) */
  closeBrowserTab(terminalTabId: string, browserTabId: string): void;
  setBrowserActiveTab(terminalTabId: string, browserTabId: string): void;
  updateBrowserTab(
    terminalTabId: string,
    browserTabId: string,
    patch: { url?: string; title?: string },
  ): void;
  /** 改某浏览器标签的网络出口('local'|configId);消费方(webview 分区)据此重挂重载该标签 */
  setBrowserTabNet(terminalTabId: string, browserTabId: string, netHostId: string): void;
  // ---- 窗格窗口化(弹出=整个窗格独立成窗 · 2026-07)----
  /** 标记窗格弹出:主窗收面板、停渲染其 webview;内容所有权移交壳窗(壳窗经 sync 回流) */
  popOutBrowserPane(terminalTabId: string): void;
  /** 壳窗状态回流:替换镜像内容(保持 poppedOut);持久化/出口对账据此保持准确 */
  applyPoppedPaneSync(
    terminalTabId: string,
    pane: { tabs: BrowserTabState[]; activeTabId: string | null },
  ): void;
  /** 回落:清 poppedOut(镜像已是最新);该 tab 正活跃时顺手打开面板让内容可见 */
  dockBrowserPane(terminalTabId: string): void;
  /** 独立窗口被直接关闭(红灯钮/标签关光,非回落):清空窗格镜像并清 poppedOut;
   *  不动面板开关——浏览器就此关闭,不回落到面板(用户指令 2026-07-23) */
  closePoppedPane(terminalTabId: string): void;
  /** 开机对账(主窗重载/崩溃自愈期间壳窗还开着):只补 poppedOut 标记,不动面板开关
   *  ——poppedOut 是视图态不入档,重载即丢;不对账会对同窗格双渲染 webview(双载) */
  markPanePoppedOut(terminalTabId: string): void;
  /** 向上滚动时固定底部输入栏(终端层据此开关 BottomBarPin + scrollOnUserInput) */
  pinBottomBar: boolean;
  setPinBottomBar(value: boolean): void;
  /** 终端链接打开方式(linkOpenPolicy 据此路由;⌘/Ctrl+点击恒走系统浏览器),随 ui 存档持久化 */
  linkBrowserMode: LinkBrowserMode;
  setLinkBrowserMode(mode: LinkBrowserMode): void;
  /** 内置浏览器默认打开方式(openBuiltinBrowser 据此选面板/独立窗口),随 ui 存档持久化 */
  builtinBrowserSurface: BuiltinBrowserSurface;
  setBuiltinBrowserSurface(surface: BuiltinBrowserSurface): void;
  /** Sidebar 折叠中的机器分组 id 集('local' | configId),随 ui 存档持久化 */
  collapsedMachines: string[];
  toggleMachineCollapsed(machineId: string): void;
  /** 语言偏好('system' 随系统;显式 locale 钉死),随 ui 存档持久化 */
  localePref: LocalePref;
  /** 切换语言:即时生效(renderer + main 原生菜单)并随存档持久化 */
  setLocalePref(pref: LocalePref): void;
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
    browser: hydrateBrowserPane(t.browser),
  };
}

/** 持久化浏览器窗格 → 运行时 BrowserPaneState;空/缺省 → undefined(tab 未开过浏览器)。
 *  activeTabId 失效(指向已不存在的标签)时回落首个标签。 */
function hydrateBrowserPane(
  p:
    | {
        tabs: { id: string; url: string; netHostId?: string }[];
        activeTabId: string | null;
      }
    | undefined,
): BrowserPaneState | undefined {
  if (!p || p.tabs.length === 0) return undefined;
  const tabs: BrowserTabState[] = p.tabs.map((b) => ({
    id: b.id,
    url: b.url,
    // netHostId 原样带回(缺省=跟随所属机器,resolveBrowserTabNet 兜底)
    ...(b.netHostId ? { netHostId: b.netHostId } : {}),
  }));
  const activeTabId = tabs.some((b) => b.id === p.activeTabId)
    ? p.activeTabId
    : (tabs[0]?.id ?? null);
  return { tabs, activeTabId };
}

/** 终端 tab 所属 workspace 的 hostId;找不到归属(竞态)按本机。新建浏览器标签的默认出口。 */
function ownerHostIdOf(workspaces: WorkspaceState[], terminalTabId: string): string {
  return (
    workspaces.find((w) => w.tabs.some((t) => t.id === terminalTabId))?.hostId ?? 'local'
  );
}

/** 当前活跃终端 tab(活跃 workspace 的活跃 tab);无则 null。浏览器窗格绑定它。 */
function activeTerminalTab(s: {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
}): TabState | null {
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  if (!ws) return null;
  return ws.tabs.find((t) => t.id === ws.activeTabId) ?? null;
}

/** 更新某终端 tab 的浏览器窗格(immutable);tab 无 browser 时以空窗格起步。 */
function patchTabBrowser(
  workspaces: WorkspaceState[],
  terminalTabId: string,
  fn: (pane: BrowserPaneState) => BrowserPaneState,
): WorkspaceState[] {
  return workspaces.map((w) => ({
    ...w,
    tabs: w.tabs.map((t) =>
      t.id === terminalTabId
        ? { ...t, browser: fn(t.browser ?? { tabs: [], activeTabId: null }) }
        : t,
    ),
  }));
}

/** 旧版全局浏览器标签迁移:注入活跃 workspace 的活跃 tab(该 tab 尚无 browser 时);
 *  无 legacy / 无目标 tab → 原样返回。仅 hydrate 一次性调用。 */
function injectLegacyBrowser(
  workspaces: WorkspaceState[],
  activeWorkspaceId: string | null,
  legacy: BrowserPaneState | undefined,
): WorkspaceState[] {
  if (!legacy) return workspaces;
  const ws = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  if (!ws) return workspaces;
  const targetTabId = ws.activeTabId ?? ws.tabs[0]?.id ?? null;
  if (!targetTabId) return workspaces;
  return workspaces.map((w) =>
    w.id === ws.id
      ? {
          ...w,
          tabs: w.tabs.map((t) =>
            t.id === targetTabId && !t.browser ? { ...t, browser: legacy } : t,
          ),
        }
      : w,
  );
}

/** drop 前快照某远程 ws 的 tab 布局(须在 disposeTerminal 之前调用——sessionId 从
 *  registry 读,dispose 后即不可得;host 重启场景该 sessionId 自然失效 → 恢复时重 spawn)。 */
function snapshotRemoteLayout(hostId: string, w: WorkspaceState): PersistedRemoteWorkspace {
  return {
    hostId,
    workspaceId: w.id,
    ...(w.browserProfileId ? { browserProfileId: w.browserProfileId } : {}),
    activeTabId: w.activeTabId,
    tabs: w.tabs.map((t) => ({
      id: t.id,
      cwd: t.cwd,
      customName: t.customName,
      filePanel: t.filePanel,
      // 浏览器窗格与落盘同投影(只 {id,url,netHostId}),否则断线重连恢复的 tab 丢浏览器
      // 标签,而整机重启(serializeTab 路径)却能恢复——两条恢复路径必须行为一致
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
 * 避免两个"查看"入口对两套状态的清除不对称(BUG-OKWORK-B260614065346-001)。
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
  browserPanelWidth: 480,
  filePanelCollapsed: false,
  browserPanelOpen: false,
  pinBottomBar: false,
  linkBrowserMode: 'builtin',
  builtinBrowserSurface: 'window',
  remoteTabLayouts: {},
  browserProfiles: [],
  browserProfilesLoaded: false,

  hydrate(registry, archive) {
    // 🔴 旧版全局浏览器标签(面板级)→ per-tab 迁移(一次性):新存档不再写 ui.browserTabs,
    // 仅老存档命中;下面把它注入迁移后的活跃终端 tab 的 browser(该 tab 尚无 browser 时)。
    let legacyBrowserPane: BrowserPaneState | undefined;
    // ui 恢复(两种模式都读)
    if (archive?.ui) {
      // 语言偏好:显式 en/zh-CN 立即生效;'system'/缺失不重设——启动值已按
      // argv(main 读同一存档)/navigator 定好,且避免测试环境被宿主语言污染
      const rawLocale = archive.ui.locale;
      const localePref: LocalePref =
        rawLocale === 'en' || rawLocale === 'zh-CN' ? rawLocale : 'system';
      if (localePref !== 'system') setLocale(localePref);
      // 浏览器标签恢复:只取合法 {id,url} 条目(title 视图态不入档);
      // 非 http(s) 的 url 降级为空标签——防篡改存档让怪 scheme 冷启动自动加载(评审 P2-3)
      const legacyTabs: BrowserTabState[] = (archive.ui.browserTabs ?? [])
        .filter((b) => typeof b?.id === 'string' && typeof b?.url === 'string')
        .map((b) => ({ id: b.id, url: /^https?:\/\//i.test(b.url) ? b.url : '' }));
      if (legacyTabs.length > 0) {
        const savedActive = archive.ui.browserActiveTabId ?? null;
        legacyBrowserPane = {
          tabs: legacyTabs,
          activeTabId: legacyTabs.some((b) => b.id === savedActive)
            ? savedActive
            : legacyTabs[0].id,
        };
      }
      set({
        sidebarWidth: archive.ui.sidebarWidth ?? 240,
        filePanelWidth: archive.ui.filePanelWidth ?? 280,
        filePanelCollapsed: archive.ui.filePanelCollapsed ?? false,
        browserPanelWidth: archive.ui.browserPanelWidth ?? 480,
        browserPanelOpen: archive.ui.browserPanelOpen ?? false,
        pinBottomBar: archive.ui.pinBottomBar ?? false,
        // 只认合法枚举值(防篡改/降级存档);缺省/非法 → 'builtin'
        linkBrowserMode: LINK_BROWSER_MODES.includes(
          archive.ui.linkBrowserMode as LinkBrowserMode,
        )
          ? (archive.ui.linkBrowserMode as LinkBrowserMode)
          : 'builtin',
        // 同上;缺省/非法 → 'window'(独立窗口)
        builtinBrowserSurface: BUILTIN_BROWSER_SURFACES.includes(
          archive.ui.builtinBrowserSurface as BuiltinBrowserSurface,
        )
          ? (archive.ui.builtinBrowserSurface as BuiltinBrowserSurface)
          : 'window',
        collapsedMachines: archive.ui.collapsedMachines ?? [],
        localePref,
      });
    }

    // v1 fallback:从存档直接构建(自带 name/root),忽略注册表(全功能)
    if (archive && archive.version === 1) {
      const built: WorkspaceState[] = archive.workspaces.map((w) => {
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
      const activeWs = resolveActiveWs(built, archive.activeWorkspaceId);
      const workspaces = injectLegacyBrowser(built, activeWs, legacyBrowserPane);
      set({
        workspaces,
        activeWorkspaceId: activeWs,
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
          // profile 绑定原样带回;有效性对账推迟到 setBrowserProfiles(快照到达时剥离失效绑定)
          ...(typeof pw.browserProfileId === 'string' &&
          pw.browserProfileId &&
          pw.browserProfileId !== DEFAULT_PROFILE_ID
            ? { browserProfileId: pw.browserProfileId }
            : {}),
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
    const activeWs = resolveActiveWs(workspaces, v2?.activeWorkspaceId ?? null);
    set({
      workspaces: injectLegacyBrowser(workspaces, activeWs, legacyBrowserPane),
      activeWorkspaceId: activeWs,
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

  restoreWorkspaceTabs(workspaceId, tabs, activeTabId, browserProfileId) {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    // 仅远程 ws + 当前 0 tab 才恢复:已有 tab(闪断未 drop 的 live 视图态)以 live 为准
    if (!ws || ws.hostId === LOCAL_HOST_ID || ws.tabs.length > 0 || tabs.length === 0) {
      return false;
    }
    const restored = tabs.map(hydrateTab);
    const nextActive = resolveActiveTab(restored, activeTabId);
    // profile 绑定随布局恢复;失效绑定由 setBrowserProfiles 对账剥离(与 hydrate 同策)
    const profilePatch =
      typeof browserProfileId === 'string' &&
      browserProfileId &&
      browserProfileId !== DEFAULT_PROFILE_ID
        ? { browserProfileId }
        : {};
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, ...profilePatch, tabs: restored, activeTabId: nextActive }
          : w,
      ),
    }));
    return true;
  },

  setBrowserProfiles(profiles) {
    set((s) => {
      // 对账:绑定的 profile 已删除 → 剥离(回默认 profile;webview 随分区变化重挂)
      const valid = new Set(profiles.map((p) => p.id));
      let changed = false;
      const workspaces = s.workspaces.map((w) => {
        if (!w.browserProfileId || valid.has(w.browserProfileId)) return w;
        changed = true;
        const { browserProfileId: _dropped, ...rest } = w;
        return rest as WorkspaceState;
      });
      return {
        browserProfiles: profiles,
        browserProfilesLoaded: true,
        ...(changed ? { workspaces } : {}),
      };
    });
  },

  setWorkspaceBrowserProfile(workspaceId, profileId) {
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        const { browserProfileId: _dropped, ...rest } = w;
        return profileId && profileId !== DEFAULT_PROFILE_ID
          ? { ...rest, browserProfileId: profileId }
          : (rest as WorkspaceState);
      }),
    }));
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
      browserPanelWidth: patch.browserPanelWidth ?? s.browserPanelWidth,
    }));
  },

  toggleFilePanelCollapsed() {
    set((s) => ({ filePanelCollapsed: !s.filePanelCollapsed }));
  },

  toggleBrowserPanel() {
    set((s) => {
      const open = !s.browserPanelOpen;
      if (!open) return { browserPanelOpen: false };
      // 打开:当前活跃终端 tab 若无浏览器标签,种一个空标签(面板不出现无标签死态)
      const activeTab = activeTerminalTab(s);
      if (!activeTab || (activeTab.browser && activeTab.browser.tabs.length > 0)) {
        return { browserPanelOpen: true };
      }
      const bt: BrowserTabState = {
        id: crypto.randomUUID(),
        url: '',
        // 新标签出口在创建时物化 = 所属机器(标签级出口的默认值来源)
        netHostId: ownerHostIdOf(s.workspaces, activeTab.id),
      };
      return {
        browserPanelOpen: true,
        workspaces: patchTabBrowser(s.workspaces, activeTab.id, () => ({
          tabs: [bt],
          activeTabId: bt.id,
        })),
      };
    });
  },

  addBrowserTab(terminalTabId, url = '') {
    set((s) => {
      const bt: BrowserTabState = {
        id: crypto.randomUUID(),
        url,
        netHostId: ownerHostIdOf(s.workspaces, terminalTabId),
      };
      return {
        browserPanelOpen: true,
        workspaces: patchTabBrowser(s.workspaces, terminalTabId, (pane) => ({
          tabs: [...pane.tabs, bt],
          activeTabId: bt.id,
        })),
      };
    });
  },

  setBrowserTabNet(terminalTabId, browserTabId, netHostId) {
    set((s) => ({
      workspaces: patchTabBrowser(s.workspaces, terminalTabId, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((b) => (b.id === browserTabId ? { ...b, netHostId } : b)),
      })),
    }));
  },

  popOutBrowserPane(terminalTabId) {
    set((s) => ({
      browserPanelOpen: false, // 弹出后主窗没有 panel(用户语义:图标此后=激活独立窗口)
      workspaces: patchTabBrowser(s.workspaces, terminalTabId, (pane) => ({
        ...pane,
        poppedOut: true,
      })),
    }));
  },

  applyPoppedPaneSync(terminalTabId, pane) {
    set((s) => ({
      workspaces: patchTabBrowser(s.workspaces, terminalTabId, (prev) => ({
        tabs: pane.tabs,
        activeTabId: pane.activeTabId,
        poppedOut: prev.poppedOut, // 镜像更新不动弹出标记
      })),
    }));
  },

  markPanePoppedOut(terminalTabId) {
    set((s) => ({
      workspaces: patchTabBrowser(s.workspaces, terminalTabId, (pane) => ({
        ...pane,
        poppedOut: true,
      })),
    }));
  },

  dockBrowserPane(terminalTabId) {
    set((s) => {
      const isActive = activeTerminalTab(s)?.id === terminalTabId;
      return {
        // 回落到活跃 tab → 面板直接可见;后台 tab 回落只清标记(切过去再看)
        ...(isActive ? { browserPanelOpen: true } : {}),
        workspaces: patchTabBrowser(s.workspaces, terminalTabId, (pane) => ({
          tabs: pane.tabs,
          activeTabId: pane.activeTabId,
        })),
      };
    });
  },

  closePoppedPane(terminalTabId) {
    set((s) => ({
      workspaces: patchTabBrowser(s.workspaces, terminalTabId, () => ({
        tabs: [],
        activeTabId: null,
      })),
    }));
  },

  closeBrowserTab(terminalTabId, browserTabId) {
    set((s) => {
      // patch 前判定「这一关会清空窗格」(patchTabBrowser 只做映射,不回传结果)
      const owner = s.workspaces
        .flatMap((w) => w.tabs)
        .find((tab) => tab.id === terminalTabId);
      const emptiesPane =
        (owner?.browser?.tabs.some((b) => b.id === browserTabId) ?? false) &&
        owner!.browser!.tabs.length === 1;
      const workspaces = patchTabBrowser(s.workspaces, terminalTabId, (pane) => {
        const idx = pane.tabs.findIndex((b) => b.id === browserTabId);
        if (idx < 0) return pane;
        const tabs = pane.tabs.filter((b) => b.id !== browserTabId);
        // 关最后一个 → 该终端 tab 的窗格清空;不影响其它 tab 的窗格
        if (tabs.length === 0) return { tabs: [], activeTabId: null };
        const activeTabId =
          pane.activeTabId === browserTabId
            ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null)
            : pane.activeTabId;
        return { tabs, activeTabId };
      });
      // 标签全关掉 → 面板收起(用户指令 2026-07-14)。仅限当前活跃终端 tab 的窗格——
      // 面板此刻展示的就是它;后台窗格清空不动全局面板态(下次切过去按空窗格逻辑种标签)。
      const closesPanel =
        emptiesPane && s.browserPanelOpen && activeTerminalTab(s)?.id === terminalTabId;
      return {
        workspaces,
        ...(closesPanel ? { browserPanelOpen: false } : {}),
      };
    });
  },

  setBrowserActiveTab(terminalTabId, browserTabId) {
    set((s) => ({
      workspaces: patchTabBrowser(s.workspaces, terminalTabId, (pane) =>
        pane.tabs.some((b) => b.id === browserTabId)
          ? { ...pane, activeTabId: browserTabId }
          : pane,
      ),
    }));
  },

  updateBrowserTab(terminalTabId, browserTabId, patch) {
    set((s) => ({
      workspaces: patchTabBrowser(s.workspaces, terminalTabId, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((b) => (b.id === browserTabId ? { ...b, ...patch } : b)),
      })),
    }));
  },

  setPinBottomBar(value) {
    set({ pinBottomBar: value });
  },

  setLinkBrowserMode(mode) {
    set({ linkBrowserMode: mode });
  },

  setBuiltinBrowserSurface(surface) {
    set({ builtinBrowserSurface: surface });
  },

  collapsedMachines: [],

  toggleMachineCollapsed(machineId) {
    set((s) => ({
      collapsedMachines: s.collapsedMachines.includes(machineId)
        ? s.collapsedMachines.filter((id) => id !== machineId)
        : [...s.collapsedMachines, machineId],
    }));
  },

  localePref: 'system',

  setLocalePref(pref) {
    // 先切 i18n 再 set:set 同步触发订阅重渲染,渲染期 t() 须已是新语言
    setLocale(
      resolveLocalePref(
        pref,
        typeof navigator !== 'undefined' ? navigator.language : null,
      ),
    );
    // main 同步生效(原生菜单/dialog);bridge 缺失(测试)静默跳过
    window.okwork?.setAppLocale?.(pref);
    set({ localePref: pref });
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
