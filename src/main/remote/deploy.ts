// 版本隔离部署 + 部署锁 + 原子切换(TECH SSH-5 · ARCH-B4 · R2-1/R2V-1)。
//
// 🔴 R2-1 根因防回归:锁必须落在版本目录【外】(`bundle/.deploying-<v>`,非
// `bundle/<v>/.deploying`)——否则版本目录非空,原子 rename 对已存在非空目录抛
// ENOTEMPTY,连单 flow happy-path 都失败。
//
// SshConnectionLike 未暴露泛用 sftp-open-with-flags,故 O_EXCL 锁语义用 POSIX
// 保证原子的 `mkdir` 代替(mkdir 对已存在目录返回 EEXIST,同等互斥效果),
// exec 层面可注入桩测试,不依赖真实 ssh2 sftp open 细节。

import type { SshConnectionLike } from './ssh';
import { acquireMkdirLock, releaseMkdirLock } from './mkdirLock';

export interface DeployOptions {
  ssh: SshConnectionLike;
  /** 远端绝对数据目录(路径全程绝对 · ARCH-B9)。 */
  dataDir: string;
  appVersion: string;
  /** 本地(应用侧)host bundle 目录,sftpWriteDir 的上传源。 */
  localBundleDir: string;
  onProgress?: (pct: number) => void;
  now?: () => number;
  randomSuffix?: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** 陈旧锁判定阈值(默认 120s · R2V-1)。 */
  lockStaleMs?: number;
  /** 等待另一 flow 部署完成的整体超时(默认 = lockStaleMs)。 */
  waitReadyTimeoutMs?: number;
  waitPollIntervalMs?: number;
}

export interface DeployResult {
  /** true = 命中既有 .ready,跳过上传(AC-13 快路径可观测)。 */
  skipped: boolean;
}

const DEFAULT_LOCK_STALE_MS = 120_000;

function versionDir(dataDir: string, appVersion: string): string {
  return `${dataDir}/bundle/${appVersion}`;
}
function readyFilePath(dataDir: string, appVersion: string): string {
  return `${versionDir(dataDir, appVersion)}/.ready`;
}
function lockDirPath(dataDir: string, appVersion: string): string {
  return `${dataDir}/bundle/.deploying-${appVersion}`;
}

function defaultRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LockOutcome = 'acquired' | 'waitForPeer';

/**
 * 列出远端已完成部署(有 .ready)的版本号所用的 shell 一行命令(纯函数,供
 * 集成测试对真实 sh/zsh 执行验证)。要点:
 * - 不用 shell glob:zsh -c 下空匹配会让整行报错中断,`ls | while read` 是 POSIX 口径;
 * - `command ls`:防用户 .zshenv 等对 ls 的别名/函数覆盖(如追加分类符)污染输出(P3 加固);
 * - `ls -1` 不含点前缀条目,`.tmp-*`/`.deploying-*` 天然被排除;
 * - bundle 目录缺失/为空 → 无输出,`; true` 归一化退出码。
 */
export function listReadyVersionsCommand(dataDir: string): string {
  return `cd "${dataDir}/bundle" 2>/dev/null && command ls -1 | while read -r v; do [ -f "$v/.ready" ] && echo "$v"; done; true`;
}

async function listReadyVersions(ssh: SshConnectionLike, dataDir: string): Promise<string[]> {
  const res = await ssh.exec(listReadyVersionsCommand(dataDir));
  return res.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((v) => /^\d+(\.\d+)*$/.test(v));
}

/** 点分数字版本比较(app 版本恒为 x.y.z 纯数字段):a>b 返回正数。 */
function compareDotted(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 部署锁取锁。🔴 锁原语已抽至 mkdirLock.ts(多端同屏 Phase 3,首启锁共用),
 * 语义零变化——A5/E2(mkdir+meta 单条 exec 消互斥击穿)、R1(meta 缺失退化读
 * 锁目录 mtime 防永久 wedge)、R2V-1(陈旧 break-and-reacquire)等加固史注释
 * 随迁至该文件。本函数仅保留 per-version 锁路径的绑定。
 */
async function acquireLock(
  ssh: SshConnectionLike,
  dataDir: string,
  appVersion: string,
  now: () => number,
  staleMs: number,
): Promise<LockOutcome> {
  return acquireMkdirLock(ssh, lockDirPath(dataDir, appVersion), { now, staleMs });
}

async function waitForReady(
  ssh: SshConnectionLike,
  readyFile: string,
  timeoutMs: number,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const buf = await ssh.sftpReadFile(readyFile);
    if (buf !== null) return;
    if (Date.now() >= deadline) {
      throw new Error('deployFailed: timeout waiting for peer deploy to finish');
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * 版本隔离部署主流程(TECH SSH-5 五步 + 版本单调闸):
 *   1. .ready 已存在 → skip(幂等 · AC-13,同版本不重复部署)
 *   1.5 版本单调闸:远端已有更高版本 .ready → 拒绝部署更低版本(见下方注释)
 *   2. 取部署锁(mkdir O_EXCL 等价);EEXIST 且未陈旧 → 轮询等 .ready;陈旧 → break-and-reacquire
 *   3. 上传到 .tmp-<v>-<rand>/(进度%)
 *   4. 仅当目标不存在时 rename(失败即视为并发赢家已落地,弃 tmp 复用赢家产物)
 *   5. 释放锁
 */
export async function deployBundle(opts: DeployOptions): Promise<DeployResult> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? defaultSleep;
  const staleMs = opts.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  const readyFile = readyFilePath(opts.dataDir, opts.appVersion);
  const verDir = versionDir(opts.dataDir, opts.appVersion);

  const alreadyReady = (await opts.ssh.sftpReadFile(readyFile)) !== null;
  if (alreadyReady) {
    return { skipped: true };
  }

  // 🔴 版本单调闸(用户规则 2026-07):远端已有【更高版本】完成部署时,拒绝把
  // 更低版本铺上去——旧安装版 app 只能复用它已有的 bundle(上方 .ready 快路径),
  // 不能向已前进的远端写旧产物(0.3.42/0.3.43 坏 spawn-helper 借旧 app 重新扩散
  // 的事故路径)。开发逃生阀:OKWORK_DEPLOY_ALLOW_OLDER=1(如在旧分支调远程)。
  //
  // 边界口径(opus 评审 P2/P3,勿误当强保证):
  // - 尽力而为的 TOCTOU 检查,只拦【已 .ready】的更高版本;不与并发在传的部署
  //   互斥(两个不同版本 app 对全新机竞速时双双落地)——部署按版本目录隔离、
  //   互不覆盖,竞速无跨版本污染,故不加锁,保持闸门零额外往返;
  // - 版本比较只认纯数字 x.y.z(发布版恒如此);预发布形如 1.2.3-beta 的
  //   appVersion 比较为 NaN → 判「不更高」→ 闸门放行,属有意 fail-open
  //   (非发布构建不受闸门约束)。
  if (process.env.OKWORK_DEPLOY_ALLOW_OLDER !== '1') {
    const newer = (await listReadyVersions(opts.ssh, opts.dataDir))
      .filter((v) => compareDotted(v, opts.appVersion) > 0)
      .sort(compareDotted)
      .pop();
    if (newer !== undefined) {
      throw new Error(
        `deployBlockedByNewerVersion: remote already has v${newer} (this app is v${opts.appVersion}) — upgrade the app to connect, or set OKWORK_DEPLOY_ALLOW_OLDER=1 to override`,
      );
    }
  }

  // 🔴 BLOCKER 修复(A1/E1):全新远端机 ${dataDir}/bundle 父目录尚不存在时,锁目录
  // 的非递归 mkdir 会 ENOENT(而非 EEXIST)失败,被误判「陈旧」→ waitForPeer →
  // 120s deployFailed,首装必败。幂等地先确保父目录存在(锁目录本身仍非递归创建,
  // 保住 mkdir 的原子互斥语义不变)。
  await opts.ssh.exec(`mkdir -p "${opts.dataDir}/bundle"`);

  const lockOutcome = await acquireLock(opts.ssh, opts.dataDir, opts.appVersion, now, staleMs);
  if (lockOutcome === 'waitForPeer') {
    await waitForReady(
      opts.ssh,
      readyFile,
      opts.waitReadyTimeoutMs ?? staleMs,
      opts.waitPollIntervalMs ?? 500,
      sleep,
    );
    return { skipped: true };
  }

  let iAmWinner = true;
  try {
    const tmpDir = `${opts.dataDir}/bundle/.tmp-${opts.appVersion}-${(opts.randomSuffix ?? defaultRandomSuffix)()}`;
    await opts.ssh.sftpWriteDir(opts.localBundleDir, tmpDir, (pct) => opts.onProgress?.(pct));

    try {
      await opts.ssh.sftpRename(tmpDir, verDir);
    } catch {
      // 目标已存在(并发赢家先落地,defensive fallback——正常应由锁避免走到这)
      // → 弃本 tmp,复用赢家产物
      iAmWinner = false;
      await opts.ssh.exec(`rm -rf "${tmpDir}"`);
    }

    if (iAmWinner) {
      await opts.ssh.exec(`touch "${readyFile}"`);
    } else {
      await waitForReady(
        opts.ssh,
        readyFile,
        opts.waitReadyTimeoutMs ?? staleMs,
        opts.waitPollIntervalMs ?? 500,
        sleep,
      );
    }
  } finally {
    try {
      await releaseMkdirLock(opts.ssh, lockDirPath(opts.dataDir, opts.appVersion));
    } catch {
      // 评审 2026-08-10:部署中途连接被拆(断线/重连拆除)时 release 必然失败——锁目录
      // 留待 staleMs 自然过期即可;这里绝不能让 release 的 reject 顶掉 try 块里真正的
      // 部署错误(finally 内 await 抛出会替换原异常)。
    }
  }

  return { skipped: !iAmWinner };
}
