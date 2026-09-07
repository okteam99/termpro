// 远端架构探测(uname 归一化)+ 本地 host bundle 资源路径定位(SSH-5 · AC-4)。
// 纯函数,无 IO 副作用(detectArch);resolveBundleDir 只做路径拼接,不触碰文件系统
// (唯一碰 fs 的是 resolveExistingBundleDir 的存在性判断,exists 可注入)。

import * as fs from 'node:fs';
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

/**
 * 定位 + 存在性判断:该 arch 的 bundle 没有随本版应用发出(CI 那条腿缺位 / 本地
 * `npm run make` 未预置 resources/host-bundles/)时返回 null。
 *
 * 🔴 0.3.123 事故:linux-arm64 的 CI 腿从未存在,detectArch 却认这个 arch —— 用户
 * 连 aarch64 远端机时路径拼得出来、目录不存在,一路走到 sftpWriteDir 的
 * readdirSync 才炸,UI 只显示「ENOENT: no such file or directory, scandir
 * '/Applications/OkWork.app/.../host-bundles/linux-arm64'」。判空前置到碰远端之前,
 * 让它走 archUnsupported 降级阀(不取部署锁、不 reap 在跑 host)。
 *
 * 判据取 host.js 而非目录本身:空目录/半成品目录(解包中断)同样不可部署。
 */
export function resolveExistingBundleDir(
  arch: HostArch,
  deps: BundleLocatorDeps,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): string | null {
  const dir = resolveBundleDir(arch, deps);
  return exists(path.join(dir, 'host.js')) ? dir : null;
}
