// 多设备同屏 TECH §A.3:通用 mkdir 互斥锁原语(抽自 deploy.ts 部署锁,语义零变化)。
// deploy 锁行为已由 deploy.test.ts 端到端覆盖;此处钉住原语自身三分支。
import { describe, expect, it } from 'vitest';
import { acquireMkdirLock, releaseMkdirLock } from '../mkdirLock';
import { createRoutedSsh, bufferOf } from './testKit';

const LOCK_DIR = '/dd/hosts/id-x/.starting';

describe('acquireMkdirLock', () => {
  it('无争用 → acquired(mkdir+meta 单条 exec)', async () => {
    const ssh = createRoutedSsh(); // 默认 mkdir+LOCKED 命令返回 LOCKED
    expect(await acquireMkdirLock(ssh, LOCK_DIR)).toBe('acquired');
    const lockCmd = ssh.execCalls.find((c) => c.includes('.starting'));
    expect(lockCmd).toContain('meta.json');
    expect(lockCmd).toContain('LOCKED');
  });

  it('EEXIST 且 meta 新鲜 → waitForPeer(不 break 对方的锁)', async () => {
    const ssh = createRoutedSsh({
      execHandlers: [
        (cmd) =>
          cmd.includes('mkdir') && cmd.includes('LOCKED')
            ? { code: 0, stdout: 'EXISTS\n', stderr: '' }
            : null,
      ],
      sftpReadFile: (p) =>
        p.endsWith('meta.json') ? bufferOf({ pid: 1, ts: Date.now() }) : null,
    });
    expect(await acquireMkdirLock(ssh, LOCK_DIR)).toBe('waitForPeer');
    expect(ssh.execCalls.some((c) => c.startsWith('rm -rf'))).toBe(false);
  });

  it('EEXIST 且 meta 陈旧 → break-and-reacquire 后 acquired', async () => {
    let broken = false;
    const ssh = createRoutedSsh({
      execHandlers: [
        (cmd) => {
          if (cmd.includes('mkdir') && cmd.includes('LOCKED')) {
            return { code: 0, stdout: broken ? 'LOCKED\n' : 'EXISTS\n', stderr: '' };
          }
          if (cmd.startsWith('rm -rf')) {
            broken = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
      ],
      sftpReadFile: (p) =>
        p.endsWith('meta.json') ? bufferOf({ pid: 1, ts: Date.now() - 999_999 }) : null,
    });
    expect(await acquireMkdirLock(ssh, LOCK_DIR, { staleMs: 120_000 })).toBe('acquired');
    expect(broken).toBe(true);
  });

  it('meta 缺失 → 退化读锁目录 mtime 判陈旧(R1:不永久 wedge)', async () => {
    let broken = false;
    const ssh = createRoutedSsh({
      execHandlers: [
        (cmd) => {
          if (cmd.includes('mkdir') && cmd.includes('LOCKED')) {
            return { code: 0, stdout: broken ? 'LOCKED\n' : 'EXISTS\n', stderr: '' };
          }
          if (cmd.startsWith('stat ')) {
            // 目录 mtime = 10 分钟前(epoch 秒)→ 超 120s 阈值判陈旧
            return { code: 0, stdout: `${Math.floor((Date.now() - 600_000) / 1000)}\n`, stderr: '' };
          }
          if (cmd.startsWith('rm -rf')) {
            broken = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
      ],
      sftpReadFile: () => null, // meta 缺失(mkdir 与 printf 之间断连的残留)
    });
    expect(await acquireMkdirLock(ssh, LOCK_DIR)).toBe('acquired');
  });

  it('releaseMkdirLock 只删锁目录本身', async () => {
    const ssh = createRoutedSsh();
    await releaseMkdirLock(ssh, LOCK_DIR);
    expect(ssh.execCalls).toEqual([`rm -rf "${LOCK_DIR}"`]);
  });
});
