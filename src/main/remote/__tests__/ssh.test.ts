// 🔴 A8/E5:isEexist 只对确凿的「已存在」信号放行,不再把任意非 undefined code
// (含 ENOENT 等真实失败)都当 EEXIST 吞掉——否则会掩盖如 A1 那类「父目录缺失」的
// bug(sftpWriteDir 的 mkdir 链静默跳过而非报错)。
import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isEexist, isEnoent, buildKeepaliveConfig, planRemoteDirs, SshConnection } from '../ssh';

// 🔴 首连必挂回归:ssh2 SFTP 错误的 code 是【数字】状态码(NO_SUCH_FILE = 2),
// isEnoent 必须认得它,否则全新远端读 .ready/host.port 抛「No such file」而非返回 null。
describe('isEnoent 识别 ssh2 数字 SFTP 状态码', () => {
  it('ssh2 真实形状:code = 2(数字)+ OpenSSH message "No such file" → true', () => {
    const err = Object.assign(new Error('No such file'), { code: 2 });
    expect(isEnoent(err)).toBe(true);
  });

  it('本地 fs 语义:code === "ENOENT" → true(桩/未来实现保留)', () => {
    expect(isEnoent({ code: 'ENOENT' })).toBe(true);
  });

  it('其他 SFTP 状态码(PERMISSION_DENIED=3 / FAILURE=4)→ false(真实失败必须上抛)', () => {
    expect(isEnoent({ code: 3, message: 'Permission denied' })).toBe(false);
    expect(isEnoent({ code: 4, message: 'Failure' })).toBe(false);
  });

  it('undefined/null/无 code → false', () => {
    expect(isEnoent(undefined)).toBe(false);
    expect(isEnoent(null)).toBe(false);
    expect(isEnoent(new Error('No such file'))).toBe(false);
  });
});

describe('A8/E5 isEexist 窄化', () => {
  it('code === "EEXIST" → true', () => {
    expect(isEexist({ code: 'EEXIST' })).toBe(true);
  });

  it('message 含 "File exists" / "already exists"(不区分大小写)→ true', () => {
    expect(isEexist({ message: 'SFTP error: File exists' })).toBe(true);
    expect(isEexist({ message: 'Failure: directory already exists' })).toBe(true);
    expect(isEexist({ message: 'FILE EXISTS' })).toBe(true);
  });

  it('ENOENT(父目录不存在)→ false(真实失败,必须上抛,不能被静默吞掉)', () => {
    expect(isEexist({ code: 'ENOENT', message: 'No such file or directory' })).toBe(false);
  });

  it('权限错误 → false', () => {
    expect(isEexist({ code: 'EACCES', message: 'Permission denied' })).toBe(false);
  });

  it('任意数字 SFTP 状态码但无「已存在」语义的 message → false(此前的漏洞:任意非 undefined code 都被放行)', () => {
    expect(isEexist({ code: 4, message: 'SSH_FX_FAILURE: disk full' })).toBe(false);
  });

  it('undefined/null → false', () => {
    expect(isEexist(undefined)).toBe(false);
    expect(isEexist(null)).toBe(false);
  });
});

// 🔴 全新远端部署必挂回归(0.3.33「部署失败 No such file」):bundle 里
// node_modules/node-pty/... 这类「中间层无直接文件」的祖先目录必须进 mkdir 列表
// (SFTP mkdir 非递归,漏一级即 NO_SUCH_FILE)。
describe('planRemoteDirs 补全中间祖先目录', () => {
  it('真实 bundle 布局:node_modules/、build/ 无直接文件也必须被创建,且父先于子', () => {
    const dirs = planRemoteDirs('/data/bundle/.tmp-1', [
      'host.js',
      'node_modules/node-pty/package.json',
      'node_modules/node-pty/lib/index.js',
      'node_modules/node-pty/build/Release/pty.node',
    ]);
    expect(dirs).toEqual([
      '/data/bundle/.tmp-1',
      '/data/bundle/.tmp-1/node_modules',
      '/data/bundle/.tmp-1/node_modules/node-pty',
      '/data/bundle/.tmp-1/node_modules/node-pty/lib',
      '/data/bundle/.tmp-1/node_modules/node-pty/build',
      '/data/bundle/.tmp-1/node_modules/node-pty/build/Release',
    ]);
  });

  it('全部文件在根 → 只建 remoteDir 本身', () => {
    expect(planRemoteDirs('/d/.tmp-x', ['a.js', 'b.js'])).toEqual(['/d/.tmp-x']);
  });

  it('绝不越界到 remoteDir 之上(其父链由 deploy.ts mkdir -p 保证;越界 mkdir 已存在目录会得不可识别的 FAILURE)', () => {
    const dirs = planRemoteDirs('/home/u/.termpro-host/bundle/.tmp-1', ['x/y/z.js']);
    for (const d of dirs) {
      expect(d.startsWith('/home/u/.termpro-host/bundle/.tmp-1')).toBe(true);
    }
  });

  it('任意父目录都排在其子目录之前(长度升序 ⇒ 先建父)', () => {
    const dirs = planRemoteDirs('/r', ['a/b/c/d/e.js', 'a/f.js', 'g/h/i.js']);
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        expect(dirs[j].startsWith(`${dirs[i]}/`) || !dirs[i].startsWith(`${dirs[j]}/`)).toBe(true);
      }
    }
    expect(dirs).toContain('/r/a/b');
    expect(dirs).toContain('/r/a/b/c');
    expect(dirs).toContain('/r/g/h');
  });
});

// 🔴 SFTP channel 泄漏回归:同一连接上的多次 sftp 操作必须复用同一条 channel
// (此前每次新开且不关,pollPortFile 轮询几秒即耗尽 OpenSSH MaxSessions=10);
// channel close 后须重开而非用死缓存。
describe('SshConnection SFTP channel 复用', () => {
  interface FakeSftp extends EventEmitter {
    readFile: (p: string, cb: (err: Error | null, data?: Buffer) => void) => void;
  }
  function makeFakeClient() {
    const wrappers: FakeSftp[] = [];
    return {
      wrappers,
      sftp(cb: (err: Error | undefined, sftp: FakeSftp) => void) {
        const w = Object.assign(new EventEmitter(), {
          readFile: (_p: string, done: (err: Error | null, data?: Buffer) => void) =>
            done(null, Buffer.from('ok')),
        }) as FakeSftp;
        wrappers.push(w);
        cb(undefined, w);
      },
    };
  }
  // 构造器仅 TS 层 private(生产恒走 SshConnection.connect);测试注入 fake client
  const construct = (client: unknown): SshConnection =>
    new (SshConnection as unknown as new (c: unknown) => SshConnection)(client);

  it('连续多次 sftp 操作只开一条 channel', async () => {
    const client = makeFakeClient();
    const conn = construct(client);
    await conn.sftpReadFile('/a');
    await conn.sftpReadFile('/b');
    await conn.sftpReadFile('/c');
    expect(client.wrappers.length).toBe(1);
  });

  it('channel close 后缓存失效,下一次操作重开(而非用死 channel)', async () => {
    const client = makeFakeClient();
    const conn = construct(client);
    await conn.sftpReadFile('/a');
    client.wrappers[0].emit('close');
    await conn.sftpReadFile('/b');
    expect(client.wrappers.length).toBe(2);
  });
});

// 🔴 darwin 远端 pty.spawn 必挂回归(posix_spawnp failed):sftpWriteDir 上传必须
// 显式携带本地 mode —— ssh2 fastPut 缺省不 fchmod,spawn-helper 丢 0o755 执行位后
// 远端 Mac 每次 pty.spawn 被 posix_spawn EACCES 拒绝(Linux 走 forkpty 无此依赖,
// 此前 linux 部署一直掩盖该缺陷)。
describe('sftpWriteDir 保留本地权限位(spawn-helper 执行位)', () => {
  interface FakePut {
    remote: string;
    mode: number | undefined;
  }
  function makeFakeClient() {
    const puts: FakePut[] = [];
    return {
      puts,
      sftp(cb: (err: Error | undefined, sftp: unknown) => void) {
        const w = Object.assign(new EventEmitter(), {
          mkdir: (_p: string, done: (err?: Error) => void) => done(undefined),
          fastPut: (
            _local: string,
            remote: string,
            opts: { mode?: number } | undefined,
            done: (err?: Error) => void,
          ) => {
            puts.push({ remote, mode: opts?.mode });
            done(undefined);
          },
        });
        cb(undefined, w);
      },
    };
  }
  const construct = (client: unknown): SshConnection =>
    new (SshConnection as unknown as new (c: unknown) => SshConnection)(client);

  it('0o755 可执行文件与 0o644 普通文件的 mode 原样传给 fastPut', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termpro-mode-src-'));
    try {
      fs.mkdirSync(path.join(localDir, 'build'));
      fs.writeFileSync(path.join(localDir, 'build', 'spawn-helper'), 'bin');
      fs.chmodSync(path.join(localDir, 'build', 'spawn-helper'), 0o755);
      fs.writeFileSync(path.join(localDir, 'host.js'), 'js');
      fs.chmodSync(path.join(localDir, 'host.js'), 0o644);

      const client = makeFakeClient();
      const conn = construct(client);
      await conn.sftpWriteDir(localDir, '/r/.tmp-1', () => {});

      const byName = new Map(client.puts.map((p) => [p.remote.split('/').pop(), p.mode]));
      expect(byName.get('spawn-helper')).toBe(0o755);
      expect(byName.get('host.js')).toBe(0o644);
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });
});

// 🔴 纵深防御(ARCH-B-1 补充):ssh2 keepalive 默认值 + env 可注入,让冻结 TCP
// 下 main 也能较快探活断线(不替代 disconnect-first,只是补一条快感知路径)。
describe('buildKeepaliveConfig ssh keepalive 纵深防御', () => {
  afterEach(() => {
    delete process.env.TERMPRO_SSH_KEEPALIVE_MS;
    delete process.env.TERMPRO_SSH_KEEPALIVE_COUNT;
  });

  it('无 env 覆盖 → 默认 15000ms / 3 次', () => {
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  });

  it('env 可注入覆盖默认值', () => {
    process.env.TERMPRO_SSH_KEEPALIVE_MS = '5000';
    process.env.TERMPRO_SSH_KEEPALIVE_COUNT = '2';
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 5000, keepaliveCountMax: 2 });
  });

  it('非法/非正数 env → 落回默认值(不产出 0 或 NaN keepalive)', () => {
    process.env.TERMPRO_SSH_KEEPALIVE_MS = 'not-a-number';
    process.env.TERMPRO_SSH_KEEPALIVE_COUNT = '-1';
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  });
});
