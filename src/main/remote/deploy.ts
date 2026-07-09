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
function lockMetaPath(dataDir: string, appVersion: string): string {
  return `${lockDirPath(dataDir, appVersion)}/meta.json`;
}

function defaultRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LockOutcome = 'acquired' | 'waitForPeer';

async function acquireLock(
  ssh: SshConnectionLike,
  dataDir: string,
  appVersion: string,
  now: () => number,
  staleMs: number,
): Promise<LockOutcome> {
  const dir = lockDirPath(dataDir, appVersion);
  const meta = lockMetaPath(dataDir, appVersion);

  const first = await tryMkdir(ssh, dir);
  if (first) {
    await writeLockMeta(ssh, meta, now());
    return 'acquired';
  }

  // EEXIST:读锁 {ts} 判陈旧
  const metaBuf = await ssh.sftpReadFile(meta);
  const ts = parseLockTs(metaBuf);
  const age = ts === null ? Infinity : now() - ts;

  if (age <= staleMs) {
    return 'waitForPeer';
  }

  // 陈旧崩溃残留:break-and-reacquire(R2V-1)
  await ssh.exec(`rm -rf ${dir}`);
  await ssh.exec(`rm -rf ${dataDir}/bundle/.tmp-${appVersion}-*`);
  const retry = await tryMkdir(ssh, dir);
  if (retry) {
    await writeLockMeta(ssh, meta, now());
    return 'acquired';
  }
  // 重取仍失败(另一 flow 抢先重取)→ 按正常等待处理
  return 'waitForPeer';
}

async function tryMkdir(ssh: SshConnectionLike, dir: string): Promise<boolean> {
  const res = await ssh.exec(`mkdir "${dir}" 2>/dev/null && echo LOCKED || echo EXISTS`);
  return res.stdout.trim() === 'LOCKED';
}

async function writeLockMeta(ssh: SshConnectionLike, metaPath: string, ts: number): Promise<void> {
  const payload = JSON.stringify({ pid: process.pid, ts });
  await ssh.exec(`printf '%s' '${payload}' > "${metaPath}"`);
}

function parseLockTs(buf: Buffer | null): number | null {
  if (!buf) return null;
  try {
    const parsed = JSON.parse(buf.toString('utf8')) as { ts?: number };
    return typeof parsed.ts === 'number' ? parsed.ts : null;
  } catch {
    return null;
  }
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
 * 版本隔离部署主流程(TECH SSH-5 五步):
 *   1. .ready 已存在 → skip(幂等 · AC-13)
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
      await opts.ssh.exec(`rm -rf ${tmpDir}`);
    }

    if (iAmWinner) {
      await opts.ssh.exec(`touch ${readyFile}`);
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
    await opts.ssh.exec(`rm -rf ${lockDirPath(opts.dataDir, opts.appVersion)}`);
  }

  return { skipped: !iAmWinner };
}
