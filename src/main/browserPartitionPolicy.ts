// 浏览器分区策略(main · profile × 出口 二维,阶段2):
//   1. 白名单:will-attach-webview 只放行【已知 profile × 已知出口】的组合分区——
//      形状解析(shared/parseBrowserPartition)+ 存在性双确认(profileStore /
//      remoteHostConfigStore),被注入的 renderer 编不出能逃出分区体系的 partition。
//   2. 本机直连分区全集:WebRTC 防泄漏判定用——guest session 不在此集合 → 恒
//      disable_non_proxied_udp(未知即禁,fail-closed 方向)。
//   3. 组合分区枚举:出口维(代理/黑洞遍历)与 profile 维(删除清盘遍历)。
// 纯逻辑 + DI 接缝(存在性由 main 注入两个 store 的查询),便于单测。

import {
  DEFAULT_PROFILE_ID,
  browserPartition,
  parseBrowserPartition,
} from '../shared/browserProfile';

export interface BrowserPartitionPolicyDeps {
  /** 自定义 profile 存在性(默认 profile 恒存在,策略内部处理,勿在此判 'default')。 */
  hasProfile: (id: string) => boolean;
  /** 远程机配置存在性。 */
  hasRemoteConfig: (id: string) => boolean;
  /** 全部自定义 profile id(不含默认)。 */
  listProfileIds: () => string[];
}

export interface BrowserPartitionPolicy {
  /** will-attach 白名单:形状 + 存在性双确认。 */
  isKnown(partition: string | undefined): boolean;
  /** 本机直连分区全集(默认 + 每个自定义 profile 的 local 分区)。 */
  localDirectPartitions(): string[];
  /** 某出口(configId)的全部组合分区(默认 + 每个自定义 profile)。 */
  partitionsOfExit(configId: string): string[];
  /** 某 profile 的全部分区(本机 + 给定各远程出口)——删除清盘用。 */
  partitionsOfProfile(profileId: string, configIds: string[]): string[];
}

export function createBrowserPartitionPolicy(
  deps: BrowserPartitionPolicyDeps,
): BrowserPartitionPolicy {
  return {
    isKnown(partition) {
      if (typeof partition !== 'string') return false;
      const parsed = parseBrowserPartition(partition);
      if (!parsed) return false;
      if (parsed.profileId !== DEFAULT_PROFILE_ID && !deps.hasProfile(parsed.profileId)) {
        return false;
      }
      if (parsed.netHostId !== 'local' && !deps.hasRemoteConfig(parsed.netHostId)) {
        return false;
      }
      return true;
    },
    localDirectPartitions() {
      return [
        browserPartition(DEFAULT_PROFILE_ID, 'local'),
        ...deps.listProfileIds().map((pid) => browserPartition(pid, 'local')),
      ];
    },
    partitionsOfExit(configId) {
      return [
        browserPartition(DEFAULT_PROFILE_ID, configId),
        ...deps.listProfileIds().map((pid) => browserPartition(pid, configId)),
      ];
    },
    partitionsOfProfile(profileId, configIds) {
      return [
        browserPartition(profileId, 'local'),
        ...configIds.map((cfg) => browserPartition(profileId, cfg)),
      ];
    },
  };
}
