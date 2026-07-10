// 远端架构探测(uname 归一化)+ 本地 host bundle 资源路径定位(SSH-5 · AC-4)。
// 纯函数,无 IO 副作用(detectArch);resolveBundleDir 只做路径拼接,不触碰文件系统。

import * as path from 'node:path';
import type { HostArch } from '../../shared/remoteHost';

/**
 * `uname -sm` 输出 → HostArch 归一化。
 * Darwin arm64 → darwin-arm64;Linux x86_64/amd64 → linux-x64;
 * Linux aarch64/arm64 → linux-arm64;其他(或该 arch bundle 未内置)→ null
 * (archUnsupported + npm 手装引导,AC-11 同口径)。
 */
export function detectArch(uname: string): HostArch | null {
  const parts = uname.trim().split(/\s+/);
  const kernel = (parts[0] ?? '').toLowerCase();
  const machine = (parts[1] ?? '').toLowerCase();

  if (kernel === 'darwin' && machine === 'arm64') return 'darwin-arm64';
  if (kernel === 'linux' && (machine === 'x86_64' || machine === 'amd64')) {
    return 'linux-x64';
  }
  if (kernel === 'linux' && (machine === 'aarch64' || machine === 'arm64')) {
    return 'linux-arm64';
  }
  return null;
}

export interface BundleLocatorDeps {
  /** 打包态 process.resourcesPath;dev 态传仓库根(用于拼 out/ 路径)。 */
  resourcesPath: string;
  isPackaged: boolean;
}

/**
 * 本地(应用侧)host bundle 目录定位:
 *   打包 → <resourcesPath>/host-bundles/<arch>/
 *   dev  → <repoRoot>/out/host-bundles/<arch>/(J1 阶段 release.yml 产出后落地位置)
 */
export function resolveBundleDir(arch: HostArch, deps: BundleLocatorDeps): string {
  if (deps.isPackaged) {
    return path.join(deps.resourcesPath, 'host-bundles', arch);
  }
  return path.join(deps.resourcesPath, 'out', 'host-bundles', arch);
}
