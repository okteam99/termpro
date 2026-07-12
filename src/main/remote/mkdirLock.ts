// 通用远端 mkdir 互斥锁(多设备同屏 TECH §A.3 · 抽自 deploy.ts 部署锁)。
//
// 语义与 deploy.ts 的 acquireLock 完全同款(该模式已经 A5/E2/R1 多轮加固):
//  - mkdir 的 POSIX 原子性做 O_EXCL 等价互斥;mkdir+写 meta 合并单条 exec
//    (竞态窗口收窄到远端 shell 本地执行耗时量级 · A5/E2);
//  - EEXIST → 读 meta{ts} 判陈旧;meta 缺失退化读锁目录 mtime(R1,防「无 meta
//    残留锁」被恒判刚创建而永久 wedge);
//  - 陈旧(> staleMs)→ break-and-reacquire;重取仍失败 → waitForPeer。
//
// deploy.ts 的部署锁(per-version)与首启锁(per-hostTag)粒度/生命周期不同,
// 不可合一(TECH §A.3);两者共用本原语。

import type { SshConnectionLike } from './ssh';

export type MkdirLockOutcome = 'acquired' | 'waitForPeer';

export interface MkdirLockOptions {
  now?: () => number;
  /** 陈旧锁判定阈值(默认 120s,与 deploy 锁同口径)。 */
  staleMs?: number;
}

const DEFAULT_STALE_MS = 120_000;

/** mkdir + 写 meta 合一命令(单次网络往返 · A5/E2)。 */
async function tryMkdirWithMeta(
  ssh: SshConnectionLike,
  dir: string,
  metaPath: string,
  ts: number,
): Promise<boolean> {
  const payload = JSON.stringify({ pid: process.pid, ts });
  const res = await ssh.exec(
    `mkdir "${dir}" 2>/dev/null && printf '%s' '${payload}' > "${metaPath}" && echo LOCKED || echo EXISTS`,
  );
  return res.stdout.trim() === 'LOCKED';
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

/** meta 缺失时的陈旧判定兜底(R1):读锁目录 mtime 近似创建时间;都读不到 → age=0。 */
async function ageFromDirMtime(
  ssh: SshConnectionLike,
  dir: string,
  now: () => number,
): Promise<number> {
  const res = await ssh.exec(`stat -c %Y "${dir}" 2>/dev/null || stat -f %m "${dir}" 2>/dev/null`);
  const mtimeSec = Number(res.stdout.trim());
  if (!Number.isFinite(mtimeSec) || res.stdout.trim().length === 0) {
    return 0;
  }
  return now() - mtimeSec * 1000;
}

/**
 * 取锁:'acquired'=本 flow 持锁(用完必须 releaseMkdirLock);'waitForPeer'=另一
 * flow 持锁未陈旧,调用方按各自语义等待对方产物(部署锁等 .ready,首启锁等端口文件)。
 */
export async function acquireMkdirLock(
  ssh: SshConnectionLike,
  lockDir: string,
  opts: MkdirLockOptions = {},
): Promise<MkdirLockOutcome> {
  const now = opts.now ?? (() => Date.now());
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const meta = `${lockDir}/meta.json`;

  if (await tryMkdirWithMeta(ssh, lockDir, meta, now())) {
    return 'acquired';
  }

  const metaBuf = await ssh.sftpReadFile(meta);
  const ts = parseLockTs(metaBuf);
  const age = ts !== null ? now() - ts : await ageFromDirMtime(ssh, lockDir, now);

  if (age <= staleMs) {
    return 'waitForPeer';
  }

  // 陈旧崩溃残留:break-and-reacquire(只删锁目录本身)
  await ssh.exec(`rm -rf "${lockDir}"`);
  if (await tryMkdirWithMeta(ssh, lockDir, meta, now())) {
    return 'acquired';
  }
  return 'waitForPeer';
}

/** 释放锁(幂等;调用方 finally 里必调)。 */
export async function releaseMkdirLock(ssh: SshConnectionLike, lockDir: string): Promise<void> {
  await ssh.exec(`rm -rf "${lockDir}"`);
}
