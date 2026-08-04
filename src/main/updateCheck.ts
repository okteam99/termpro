// 更新检测的纯解析逻辑(零 Electron import,便于单测)。
// 双通道:首选 GitHub releases API(信息全:html_url + assets 直链);
// 共享出口 IP 下未认证 API 配额(60 次/时/IP)易被打满返回 403,
// 此时回退 update.electronjs.org feed——不受 API 限流,URL 自带当前版本,
// 200 即有新版。feed 索引有分钟级延迟,故只作兜底不作首选。

export interface LatestRelease {
  version: string;
  htmlUrl?: string;
  zipUrl?: string;
}

export function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const l = local.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) !== (l[i] ?? 0)) return (r[i] ?? 0) > (l[i] ?? 0);
  }
  return false;
}

/** 从 release assets 挑出本平台/架构的 Squirrel zip 直链
 *  (maker-zip 命名:<App>-darwin-<arch>-<version>.zip)。拿到就不必再
 *  依赖 update.electronjs.org——那个第三方 feed 有索引延迟,新版发布后
 *  会短暂返回 204,正是「胶囊已显示却升级失败」的根因。 */
export function pickDarwinZip(
  assets: Array<{ name?: string; browser_download_url?: string }> | undefined,
  arch: string,
): string | undefined {
  return (assets ?? []).find(
    (a) =>
      !!a.browser_download_url &&
      !!a.name &&
      a.name.endsWith('.zip') &&
      a.name.includes('darwin') &&
      a.name.includes(arch),
  )?.browser_download_url;
}

/** GitHub /releases/latest 响应 → LatestRelease;预发布或无 tag 返回 null */
export function parseLatestRelease(
  json: {
    tag_name?: string;
    html_url?: string;
    prerelease?: boolean;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  },
  arch: string,
): LatestRelease | null {
  if (json.prerelease) return null;
  const version = (json.tag_name ?? '').replace(/^v/, '');
  if (!version) return null;
  return {
    version,
    htmlUrl: json.html_url,
    zipUrl: pickDarwinZip(json.assets, arch),
  };
}

/** update.electronjs.org feed 响应(name 形如 "v0.3.98")→ LatestRelease */
export function parseUpdateFeed(json: {
  name?: string;
  url?: string;
}): LatestRelease | null {
  const version = (json.name ?? '').trim().replace(/^v/, '');
  if (!version) return null;
  return { version, zipUrl: json.url };
}
