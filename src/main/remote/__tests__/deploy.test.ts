// AC-4 版本隔离部署三段进度 + 幂等 + 并发 O_EXCL 锁 + 陈旧锁 break-and-reacquire;
// AC-11 缺 node / node<20 由 orchestrator 层探测(exec 桩),此处补两条部署前置断言。
// AC-13 快路径跳过上传可观测。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { deployBundle } from '../deploy';
import { createRoutedSsh, bufferOf, type ExecHandler } from './testKit';

const DATA_DIR = '/home/tester/.termpro-host';
const APP_VERSION = '1.2.3';

describe('AC-4 deployBundle', () => {
  it('T-008 首次部署:无 .ready → 取锁→上传(带进度)→原子 rename→写 .ready→释放锁', async () => {
    let readyAfterRename = false;
    const progressSamples: number[] = [];
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return readyAfterRename ? bufferOf('ok') : null;
        return null;
      },
      sftpWriteDir: (_local, _remote, onProgress) => {
        onProgress(50);
        onProgress(100);
      },
      sftpRename: () => {
        readyAfterRename = false; // rename 成功但 .ready 尚未写(下一步 touch 才写)
      },
    });

    const result = await deployBundle({
      ssh,
      dataDir: DATA_DIR,
      appVersion: APP_VERSION,
      localBundleDir: '/local/bundle/darwin-arm64',
      onProgress: (pct) => progressSamples.push(pct),
      randomSuffix: () => 'abc123',
    });

    expect(result.skipped).toBe(false);
    expect(progressSamples).toEqual([50, 100]);
    expect(ssh.execCalls.some((c) => c.includes('touch') && c.includes('.ready'))).toBe(true);
    expect(ssh.execCalls.some((c) => c.includes('rm -rf') && c.includes('.deploying-1.2.3'))).toBe(
      true,
    );
    // sftpWriteDir 目标是临时目录,不是最终版本目录(原子切换语义)
    expect(ssh.sftpWriteDir).toHaveBeenCalledWith(
      '/local/bundle/darwin-arm64',
      expect.stringContaining('.tmp-1.2.3-abc123'),
      expect.any(Function),
    );
  });

  it('T-009 版本隔离重部署幂等:已存在 .ready → 直接 skip,不上传', async () => {
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => (path.endsWith('.ready') ? bufferOf('ok') : null),
    });
    const result = await deployBundle({
      ssh,
      dataDir: DATA_DIR,
      appVersion: APP_VERSION,
      localBundleDir: '/local/bundle/darwin-arm64',
    });
    expect(result.skipped).toBe(true);
    expect(ssh.sftpWriteDir).not.toHaveBeenCalled();
  });

  it('T-027 AC-13 快路径跳过上传可观测(与 T-009 同断言口径,onProgress 从未调用)', async () => {
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => (path.endsWith('.ready') ? bufferOf('ok') : null),
    });
    const onProgress = vi.fn();
    const result = await deployBundle({
      ssh,
      dataDir: DATA_DIR,
      appVersion: APP_VERSION,
      localBundleDir: '/local/bundle/darwin-arm64',
      onProgress,
    });
    expect(result.skipped).toBe(true);
    expect(onProgress).not.toHaveBeenCalled();
    expect(ssh.sftpWriteDir).not.toHaveBeenCalled();
  });

  it('T-039 并发首装:锁在版本目录外 · rename 目标已存在即失败 → loser 弃 tmp 复用赢家产物', async () => {
    // 模拟「另一 flow 已经赢得 rename」的场景:本 flow 成功取锁(EEXIST 逻辑不在本测覆盖,
    // 见下一测试),但 sftpRename 抛错(目标已存在),随后应轮询等 .ready 出现。
    let readyAppeared = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return readyAppeared ? bufferOf('ok') : null;
        return null;
      },
      sftpRename: () => {
        throw Object.assign(new Error('ENOTEMPTY'), { code: 'ENOTEMPTY' });
      },
    });
    // 第二次读 .ready 前把 ready 置真(模拟赢家几乎同时写完)
    let readCount = 0;
    const originalSftpReadFile = ssh.sftpReadFile;
    ssh.sftpReadFile = vi.fn(async (path: string) => {
      if (path.endsWith('.ready')) {
        readCount++;
        if (readCount >= 2) readyAppeared = true;
      }
      return originalSftpReadFile(path);
    });

    const result = await deployBundle({
      ssh,
      dataDir: DATA_DIR,
      appVersion: APP_VERSION,
      localBundleDir: '/local/bundle/darwin-arm64',
      sleep: async () => undefined,
      waitPollIntervalMs: 1,
    });

    expect(result.skipped).toBe(true);
    // loser 弃 tmp(rm -rf .tmp-...),不会写 .ready(赢家的活)
    expect(ssh.execCalls.some((c) => c.includes('rm -rf') && c.includes('.tmp-1.2.3-'))).toBe(true);
    expect(ssh.execCalls.some((c) => c.includes('touch') && c.includes('.ready'))).toBe(false);
  });

  it('.deploying 锁 EEXIST 且未陈旧 → 直接轮询等 .ready,不重复上传', async () => {
    let mkdirCalls = 0;
    let readyAppeared = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('meta.json')) return bufferOf({ pid: 1, ts: Date.now() - 1000 });
        if (path.endsWith('.ready')) return readyAppeared ? bufferOf('ok') : null;
        return null;
      },
      execHandlers: [
        (cmd) => {
          if (cmd.includes('mkdir') && cmd.includes('.deploying-')) {
            mkdirCalls++;
            return { code: 0, stdout: 'EXISTS\n', stderr: '' };
          }
          return null;
        },
      ],
    });
    let polls = 0;
    const result = await deployBundle({
      ssh,
      dataDir: DATA_DIR,
      appVersion: APP_VERSION,
      localBundleDir: '/local/bundle/darwin-arm64',
      sleep: async () => {
        polls++;
        if (polls >= 2) readyAppeared = true;
      },
      waitPollIntervalMs: 1,
    });
    expect(result.skipped).toBe(true);
    expect(mkdirCalls).toBe(1);
    expect(ssh.sftpWriteDir).not.toHaveBeenCalled();
  });

  it('T-039b 陈旧 .deploying 锁(age>120s)→ break-and-reacquire,不永久 wedge', async () => {
    let mkdirCallCount = 0;
    const now = () => 1_000_000_000; // 固定「当前时刻」
    const staleTs = now() - 200_000; // 200s 前,超过默认 120s 阈值
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('meta.json')) return bufferOf({ pid: 1, ts: staleTs });
        if (path.endsWith('.ready')) return null;
        return null;
      },
      execHandlers: [
        (cmd) => {
          if (cmd.includes('mkdir') && cmd.includes('.deploying-')) {
            mkdirCallCount++;
            // 第一次 mkdir(占用检测)返回 EXISTS(模拟陈旧锁已存在);
            // break-and-reacquire 后的第二次 mkdir 返回 LOCKED
            return { code: 0, stdout: mkdirCallCount === 1 ? 'EXISTS\n' : 'LOCKED\n', stderr: '' };
          }
          return null;
        },
      ],
    });

    const result = await deployBundle({
      ssh,
      dataDir: DATA_DIR,
      appVersion: APP_VERSION,
      localBundleDir: '/local/bundle/darwin-arm64',
      now,
    });

    expect(mkdirCallCount).toBe(2);
    expect(ssh.execCalls.some((c) => c.startsWith('rm -rf') && c.includes('.deploying-1.2.3'))).toBe(
      true,
    );
    expect(result.skipped).toBe(false);
    expect(ssh.sftpWriteDir).toHaveBeenCalled();
  });

  it('AC-11 T-023 无 node:此断言在 orchestrator 层(见 orchestrator.test.ts);此处只确认 deploy 不做 node 判定(职责分离)', () => {
    // deploy.ts 本身不检查 node 版本(那是 orchestrator 在部署前的探测职责);
    // 这条测试仅作职责边界说明,orchestrator.test.ts 覆盖真实断言(T-023/T-024)。
    expect(typeof deployBundle).toBe('function');
  });

  it('🔴 BLOCKER 回归(A1/E1):全新远端 bundle 父目录不存在时,mkdir -p 先行,取锁不再因 ENOENT 误判陈旧', async () => {
    let bundleDirEnsured = false;
    let lockAcquired = false;
    let readyWritten = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => (path.endsWith('.ready') ? (readyWritten ? bufferOf('ok') : null) : null),
      sftpWriteDir: (_l, _r, onProgress) => onProgress(100),
      execHandlers: [
        (cmd) => {
          if (cmd === 'mkdir -p "/home/tester/.termpro-host/bundle"') {
            bundleDirEnsured = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
        (cmd) => {
          if (cmd.startsWith('mkdir "') && cmd.includes('.deploying-9.9.9') && cmd.includes('LOCKED')) {
            // 真实非递归 mkdir 在父目录不存在时会 ENOENT 失败(shell 里落到 || echo EXISTS
            // 分支,与「已被占用」的输出不可区分)——若 bundle 父目录尚未由 mkdir -p 建好,
            // 这里必须复现该失败,才能证明「先 mkdir -p 再取锁」这个顺序真的生效。
            if (!bundleDirEnsured) return { code: 0, stdout: 'EXISTS\n', stderr: '' };
            lockAcquired = true;
            return { code: 0, stdout: 'LOCKED\n', stderr: '' };
          }
          return null;
        },
        (cmd) => {
          if (cmd.startsWith('touch "') && cmd.includes('.ready')) {
            readyWritten = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
      ],
    });

    const result = await deployBundle({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      appVersion: '9.9.9',
      localBundleDir: '/local/bundle/darwin-arm64',
      waitReadyTimeoutMs: 50,
      waitPollIntervalMs: 1,
      sleep: async () => undefined,
    });

    expect(bundleDirEnsured).toBe(true);
    expect(lockAcquired).toBe(true);
    expect(result.skipped).toBe(false);
    // 顺序断言:mkdir -p 必须先于取锁尝试出现在调用序列里
    const ensureIdx = ssh.execCalls.indexOf('mkdir -p "/home/tester/.termpro-host/bundle"');
    const lockIdx = ssh.execCalls.findIndex((c) => c.includes('.deploying-9.9.9') && c.includes('LOCKED'));
    expect(ensureIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThan(ensureIdx);
  });

  it('🔴 A5/E2 回归:锁存在但 meta 尚未写入(竞态窗口)不再判定为无限陈旧,不误删活跃锁', async () => {
    let readyAppeared = false;
    let rmLockCalled = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return readyAppeared ? bufferOf('ok') : null;
        if (path.endsWith('meta.json')) return null; // 模拟竞态窗口:另一实例已 mkdir 但 meta 未写
        return null;
      },
      execHandlers: [
        (cmd) => (cmd.startsWith('mkdir -p "') ? { code: 0, stdout: '', stderr: '' } : null),
        (cmd) =>
          cmd.startsWith('mkdir "') && cmd.includes('.deploying-')
            ? { code: 0, stdout: 'EXISTS\n', stderr: '' } // 锁被另一活跃实例占用
            : null,
        (cmd) => {
          if (cmd.startsWith('rm -rf "') && cmd.includes('.deploying-')) {
            rmLockCalled = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
      ],
    });

    let pollCount = 0;
    const result = await deployBundle({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      appVersion: '9.9.9',
      localBundleDir: '/local/bundle/darwin-arm64',
      waitReadyTimeoutMs: 20,
      waitPollIntervalMs: 1,
      sleep: async () => {
        pollCount++;
        if (pollCount >= 2) readyAppeared = true; // 模拟真正持锁方随后完成部署
      },
    });

    expect(result.skipped).toBe(true);
    // 关键断言:meta 缺失(竞态窗口,非真陈旧)绝不触发 break-and-reacquire 误删活跃锁
    expect(rmLockCalled).toBe(false);
  });

  it('🔴 R1 回归:meta 永久缺失(mkdir 后 printf 失败的残留)但锁目录 mtime 超龄 → 判陈旧,break-and-reacquire 成功,不永久 wedge', async () => {
    const now = () => 1_000_000_000_000; // 固定「当前时刻」(ms)
    const staleMtimeSec = Math.floor(now() / 1000) - 200; // 锁目录 mtime = 200s 前,超过默认 120s 阈值
    let mkdirCallCount = 0;
    let rmLockCalled = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('meta.json')) return null; // meta 永久缺失(printf 段从未执行成功过)
        if (path.endsWith('.ready')) return null;
        return null;
      },
      execHandlers: [
        (cmd) => {
          if (cmd.startsWith('mkdir "') && cmd.includes('.deploying-9.9.9')) {
            mkdirCallCount++;
            // 第一次(占用检测):锁目录已存在但 meta 从未写成功 → EXISTS;
            // break-and-reacquire 后的第二次:重新 mkdir 成功 → LOCKED
            return { code: 0, stdout: mkdirCallCount === 1 ? 'EXISTS\n' : 'LOCKED\n', stderr: '' };
          }
          return null;
        },
        (cmd) => {
          // 跨平台 stat 兜底(见 ageFromDirMtime):GNU 用 -c %Y,此处只需喂 GNU 分支即可
          if (cmd.startsWith('stat -c %Y')) {
            return { code: 0, stdout: `${staleMtimeSec}\n`, stderr: '' };
          }
          return null;
        },
        (cmd) => {
          if (cmd.startsWith('rm -rf "') && cmd.includes('.deploying-9.9.9')) {
            rmLockCalled = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
      ],
    });

    const result = await deployBundle({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      appVersion: '9.9.9',
      localBundleDir: '/local/bundle/darwin-arm64',
      now,
    });

    // 关键断言:陈旧判定生效(靠 mtime 兜底,不是永远判「刚创建」)→ break 掉陈旧锁 → 重取成功
    expect(mkdirCallCount).toBe(2);
    expect(rmLockCalled).toBe(true);
    expect(result.skipped).toBe(false);
    expect(ssh.sftpWriteDir).toHaveBeenCalled();
  });
});

// 版本单调闸:远端已有更高版本 .ready → 拒绝部署更低版本(同版本幂等由 T-009 的
// .ready 快路径覆盖)。防「旧安装版 app 把旧/坏 bundle 铺回已前进的远端」
// (0.3.42/0.3.43 spawn-helper 事故的扩散路径)。
describe('部署版本单调闸(只允许更高版本)', () => {
  const listRoute =
    (versions: string[]): ExecHandler =>
    (cmd) =>
      cmd.includes('while read -r v')
        ? { code: 0, stdout: versions.map((v) => `${v}\n`).join(''), stderr: '' }
        : null;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('远端已有更高版本 → 抛 deployBlockedByNewerVersion,不上传不取锁', async () => {
    const ssh = createRoutedSsh({ execHandlers: [listRoute(['1.0.0', '1.2.4'])] });
    await expect(
      deployBundle({
        ssh,
        dataDir: DATA_DIR,
        appVersion: APP_VERSION, // 1.2.3
        localBundleDir: '/local/bundle/darwin-arm64',
      }),
    ).rejects.toThrow(/deployBlockedByNewerVersion.*v1\.2\.4/);
    expect(ssh.sftpWriteDir).not.toHaveBeenCalled();
    expect(ssh.execCalls.some((c) => c.includes('.deploying-'))).toBe(false);
  });

  it('数字段比较而非字典序:app 0.3.9 被远端 0.3.10 拦下(字典序会误放行)', async () => {
    const ssh = createRoutedSsh({ execHandlers: [listRoute(['0.3.10'])] });
    await expect(
      deployBundle({
        ssh,
        dataDir: DATA_DIR,
        appVersion: '0.3.9',
        localBundleDir: '/local/bundle/darwin-arm64',
      }),
    ).rejects.toThrow(/deployBlockedByNewerVersion.*v0\.3\.10/);
  });

  it('反向不误伤:app 0.3.10 对远端 0.3.9 正常部署(字典序会误拦)', async () => {
    const ssh = createRoutedSsh({ execHandlers: [listRoute(['0.3.9'])] });
    const result = await deployBundle({
      ssh,
      dataDir: DATA_DIR,
      appVersion: '0.3.10',
      localBundleDir: '/local/bundle/darwin-arm64',
    });
    expect(result.skipped).toBe(false);
    expect(ssh.sftpWriteDir).toHaveBeenCalled();
  });

  it('逃生阀 TERMPRO_DEPLOY_ALLOW_OLDER=1:跳过闸门(连版本列举都不发起)照常部署', async () => {
    vi.stubEnv('TERMPRO_DEPLOY_ALLOW_OLDER', '1');
    const ssh = createRoutedSsh({ execHandlers: [listRoute(['9.9.9'])] });
    const result = await deployBundle({
      ssh,
      dataDir: DATA_DIR,
      appVersion: APP_VERSION,
      localBundleDir: '/local/bundle/darwin-arm64',
    });
    expect(result.skipped).toBe(false);
    expect(ssh.sftpWriteDir).toHaveBeenCalled();
    expect(ssh.execCalls.some((c) => c.includes('while read -r v'))).toBe(false);
  });
});
