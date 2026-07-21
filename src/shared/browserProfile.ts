// 浏览器 Profile(每工作区独立存储空间 + 独立 UA · 2026-07-21)。
// main 产权威(userData/browser-profiles.json 经 SettingsStore 抽象)· renderer 消费
// (Browser Settings 管理 / 工作区编辑弹层选择 / BrowserPanel 计算分区)。
// 🔴 零 Node / 零 Electron import —— shared 层纪律。
//
// 分区模型升级:出口一维(remoteHost.partitionOf)→ profile × 出口 二维。
//   默认 profile(id='default',虚拟实体不落盘)映射【现有分区名】,老登录态零迁移:
//     ('default','local')    = 'persist:browser'
//     ('default',configId)   = 'persist:browser-<configId>'
//   自定义 profile(id=32位hex,自造无'-',保证可解析):
//     (pid,'local')          = 'persist:browser-prof-<pid>'
//     (pid,configId)         = 'persist:browser-prof-<pid>-<configId>'
// 解析无歧义依据:configId 为 base64url(可含'-'但撞上 ^prof-[0-9a-f]{32}(-|$) 的
// 概率可忽略,且 main 白名单对 profile/config 存在性双重校验,撞形也过不了门)。

/** 内置默认 profile 的稳定 id(虚拟实体:不入 browser-profiles.json,不可删改)。 */
export const DEFAULT_PROFILE_ID = 'default';

/** 自定义 profile id 形状(32 位小写 hex;无 '-' 是分区名可解析的前提)。 */
export const PROFILE_ID_RE = /^[0-9a-f]{32}$/;

/** 浏览器 Profile(独立 session 分区 = 独立 cookie/localStorage/缓存;可选独立 UA)。 */
export interface BrowserProfile {
  id: string;
  name: string;
  /** 自定义 User-Agent;缺省 = 系统默认(Electron/Chromium 原生 UA)。 */
  userAgent?: string;
  createdAt: number;
}

/** save 入参:省略 id = 新建;id 命中既有 = 更新(默认 profile 恒拒绝)。 */
export interface BrowserProfileInput {
  id?: string;
  name: string;
  userAgent?: string;
}

/** profile × 出口 → session 分区名(见文件头分区模型)。 */
export function browserPartition(profileId: string, netHostId: string): string {
  if (profileId === DEFAULT_PROFILE_ID) {
    return netHostId === 'local' ? 'persist:browser' : `persist:browser-${netHostId}`;
  }
  return netHostId === 'local'
    ? `persist:browser-prof-${profileId}`
    : `persist:browser-prof-${profileId}-${netHostId}`;
}

const PROF_PARTITION_RE = /^prof-([0-9a-f]{32})(?:-(.+))?$/;

/**
 * 分区名 → {profileId, netHostId};非浏览器分区体系 → null。
 * 🔴 只做形状解析,不做存在性校验——main 白名单必须另查 profileStore /
 * remoteHostConfigStore 双确认(被注入的 renderer 不能借编造 id 逃出分区体系)。
 */
export function parseBrowserPartition(
  partition: string,
): { profileId: string; netHostId: string } | null {
  if (partition === 'persist:browser') {
    return { profileId: DEFAULT_PROFILE_ID, netHostId: 'local' };
  }
  if (!partition.startsWith('persist:browser-')) return null;
  const rest = partition.slice('persist:browser-'.length);
  if (!rest) return null;
  const m = PROF_PARTITION_RE.exec(rest);
  if (m) return { profileId: m[1], netHostId: m[2] ?? 'local' };
  // 旧形态:默认 profile 的远程出口分区(rest = configId)
  return { profileId: DEFAULT_PROFILE_ID, netHostId: rest };
}

/**
 * 某字符串用作网络出口 id(configId)时,是否会与 profile 分区命名空间碰撞——即
 * browserPartition('default', id) 会被 parseBrowserPartition 误读成某 profile 的分区。
 * 🔴 configId 由 renderer 提供(remoteHost.save 展开 ...config,HostConfigStore 无形状
 * 校验),save 时必须据此拒绝:否则被注入的主窗 renderer 可先建 profile 拿到其 id X、
 * 再把 configId 设成 `prof-<X>`,让 default 走该出口的远程分区与 profile X 的本机直连
 * 分区【同名】——WebRTC 防泄漏判定(localDirectPartitions 含 profile-X-local)会把这个
 * 已挂活代理的远程分区误判为本机直连、不设 disable_non_proxied_udp → UDP 从真实 IP 泄漏。
 * 本守卫恢复文件头「自定义 profile id 无 '-' 是可解析前提」所依赖的命名空间不相交性。
 */
export function isReservedNetHostId(id: string): boolean {
  const parsed = parseBrowserPartition(browserPartition(DEFAULT_PROFILE_ID, id));
  return parsed !== null && parsed.profileId !== DEFAULT_PROFILE_ID;
}

/** 浏览器 Profile IPC 通道(preload bridge ↔ main handler 单源)。 */
export const BROWSER_PROFILE_CHANNELS = {
  /** 全部自定义 profile(默认 profile 是虚拟实体,renderer 侧自行置顶展示)。 */
  list: 'browserProfile:list',
  save: 'browserProfile:save',
  delete: 'browserProfile:delete',
  /** 快照变更推送(main→renderer 各窗口):增/删/改后广播全量列表。 */
  changed: 'browserProfile:changed',
} as const;
