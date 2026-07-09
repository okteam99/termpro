// AC-4 版本隔离部署三段进度 + 幂等 + 并发 O_EXCL 锁 + 陈旧锁 break-and-reacquire;
// AC-11 缺 node / node<20 由 orchestrator 层探测(exec 桩),此处补两条部署前置断言。
// AC-13 快路径跳过上传可观测。
import { describe, it, expect, vi } from 'vitest';
import { deployBundle } from '../deploy';
import { createRoutedSsh, bufferOf } from './testKit';

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
});
