// 🔴 A8/E5:isEexist 只对确凿的「已存在」信号放行,不再把任意非 undefined code
// (含 ENOENT 等真实失败)都当 EEXIST 吞掉——否则会掩盖如 A1 那类「父目录缺失」的
// bug(sftpWriteDir 的 mkdir 链静默跳过而非报错)。
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as net from 'node:net';
import { PassThrough } from 'node:stream';
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

// 🔴 合盖/断网卡死回归(2026-07-31):ssh2 Client 已 close,但某条 exec/SFTP channel
// 的 callback/stream close 没有再到达。旧实现只把 close 通知 orchestrator,不会 reject
// 正在等待的操作 Promise,于是 serialize queue + orchestrator connectInflight 永久占槽,
// 后续 Connect 全被去重吞掉,UI 一直停在 Connecting。
describe('SshConnection 断链会终止所有 pending 操作', () => {
  const construct = (client: unknown): SshConnection =>
    new (SshConnection as unknown as new (c: unknown) => SshConnection)(client);

  async function settlesSoon<T>(promise: Promise<T>): Promise<'resolved' | 'rejected' | 'timeout'> {
    return Promise.race([
      promise.then(
        () => 'resolved' as const,
        () => 'rejected' as const,
      ),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 40)),
    ]);
  }

  it('client close 时,已拿到 stream 但等不到 stream.close 的 exec 立即 reject', async () => {
    const stream = Object.assign(new PassThrough(), { stderr: new PassThrough() });
    const client = Object.assign(new EventEmitter(), {
      exec: vi.fn((_cmd: string, cb: (err: Error | null, s: typeof stream) => void) => {
        cb(null, stream); // stream 此后永不 close,模拟睡眠断网时丢失 channel 终态
      }),
      end: vi.fn(),
    });
    const pending = construct(client).exec('echo $HOME');
    await Promise.resolve(); // 放行 serialize queue,确保 exec 已进入等待

    client.emit('close');

    expect(await settlesSoon(pending)).toBe('rejected');
  });

  it('client error 时,等不到 client.sftp callback 的 SFTP 操作立即 reject', async () => {
    const client = Object.assign(new EventEmitter(), {
      sftp: vi.fn(() => undefined), // callback 永不抵达
      end: vi.fn(),
    });
    const pending = construct(client).sftpReadFile('/root/.termpro-host/host.port');
    await Promise.resolve();

    client.emit('error', new Error('socket lost after wake'));

    expect(await settlesSoon(pending)).toBe('rejected');
  });

  it('主动 close 也会在 ssh2 不回 close 事件时 reject pending 操作', async () => {
    const stream = Object.assign(new PassThrough(), { stderr: new PassThrough() });
    const client = Object.assign(new EventEmitter(), {
      exec: vi.fn((_cmd: string, cb: (err: Error | null, s: typeof stream) => void) => {
        cb(null, stream);
      }),
      end: vi.fn(), // 刻意不 emit close,模拟已坏 socket
    });
    const conn = construct(client);
    const pending = conn.exec('echo $HOME');
    await Promise.resolve();

    conn.close();

    expect(await settlesSoon(pending)).toBe('rejected');
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('底层既不 callback 也不 close 时,操作硬超时会 reject,不会无限占住串行队列', async () => {
    vi.useFakeTimers();
    try {
      const stream = Object.assign(new PassThrough(), { stderr: new PassThrough() });
      const client = Object.assign(new EventEmitter(), {
        exec: vi.fn((_cmd: string, cb: (err: Error | null, s: typeof stream) => void) => {
          cb(null, stream);
        }),
        end: vi.fn(),
      });
      let rejected = false;
      void construct(client)
        .exec('uname -sm')
        .catch(() => {
          rejected = true;
        });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(30_001);

      expect(rejected).toBe(true);
      expect(client.end).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-mode-src-'));
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
    delete process.env.OKWORK_SSH_KEEPALIVE_MS;
    delete process.env.OKWORK_SSH_KEEPALIVE_COUNT;
  });

  it('无 env 覆盖 → 默认 15000ms / 3 次', () => {
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  });

  it('env 可注入覆盖默认值', () => {
    process.env.OKWORK_SSH_KEEPALIVE_MS = '5000';
    process.env.OKWORK_SSH_KEEPALIVE_COUNT = '2';
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 5000, keepaliveCountMax: 2 });
  });

  it('非法/非正数 env → 落回默认值(不产出 0 或 NaN keepalive)', () => {
    process.env.OKWORK_SSH_KEEPALIVE_MS = 'not-a-number';
    process.env.OKWORK_SSH_KEEPALIVE_COUNT = '-1';
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  });
});

// 🔴 主进程弹窗事故回归(2026-07-14):connect 的兜底超时与 ssh2 内部 readyTimeout
// 同时限竞速。修复前兜底路径 removeAllListeners 摘光监听器,ssh2 随后 emit 的
// 'Timed out while waiting for handshake' 无人接 → uncaughtException 弹窗。
// 用「接受连接但永不说 SSH」的静默 TCP 服务器复现双定时器竞速。
describe('connect 超时不产生 uncaughtException(弹窗事故回归)', () => {
  it('兜底超时 reject 后,ssh2 迟到的 handshake-timeout error 被吞掉', async () => {
    const net = await import('node:net');
    // 记住接受的 socket:收尾显式 destroy(server.close 等连接自然收尾在部分环境下悬挂)
    const accepted: import('node:net').Socket[] = [];
    const server = net.createServer((socket) => {
      accepted.push(socket); // 不发 SSH banner,让双方超时
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as import('node:net').AddressInfo).port;

    const uncaught: Error[] = [];
    const onUncaught = (e: Error) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);
    try {
      await expect(
        SshConnection.connect({
          host: '127.0.0.1',
          port,
          auth: { username: 'x', password: 'y' },
          readyTimeoutMs: 150,
        }),
      ).rejects.toThrow(/timeout|Timed out/i);
      // 给 ssh2 内部 readyTimeout 定时器触发窗口:修复前它在这里 emit 无监听 error
      await new Promise((r) => setTimeout(r, 350));
      expect(uncaught).toEqual([]);
    } finally {
      process.removeListener('uncaughtException', onUncaught);
      for (const s of accepted) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// 🔴 主进程弹窗事故(2026-07-15):SSH 隧道掉线但本地 forwardOut net.Server 仍监听,
// 新连接进来调 client.forwardOut → ssh2 客户端已断开则【同步抛 'Not connected'】
// (回调之前),非 Promise 上下文不接就冒泡成主进程 Uncaught Exception 弹窗。
describe('forwardOut 隧道断开不崩主进程', () => {
  const construct = (client: unknown): SshConnection =>
    new (SshConnection as unknown as new (c: unknown) => SshConnection)(client);

  it('client.forwardOut 同步抛 Not connected → 连接处理器吞掉,不产生 uncaughtException', async () => {
    const net = await import('node:net');
    const fakeClient = {
      forwardOut() {
        throw new Error('Not connected'); // 模拟 ssh2 断开态同步抛
      },
    };
    const server = construct(fakeClient).forwardOut(0, 9999);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const port = (server.address() as import('node:net').AddressInfo).port;

    const uncaught: Error[] = [];
    const onUncaught = (e: Error) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);
    try {
      const client = net.connect(port, '127.0.0.1');
      // 连接被处理器 destroy → close/error 任一即收尾
      await new Promise<void>((resolve) => {
        client.on('close', () => resolve());
        client.on('error', () => resolve());
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(uncaught).toEqual([]); // 修复前:'Not connected' 会冒泡到这里
    } finally {
      process.removeListener('uncaughtException', onUncaught);
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// 反向转发(remote→local · 阶段3):session 内 agent 经容器回环 127.0.0.1:remotePort
// 打回本机浏览器 MCP server。校验绑定/端口/按 destPort 路由/回接本地/close 撤销。
describe('forwardInToLocal 反向转发', () => {
  const construct = (client: unknown): SshConnection =>
    new (SshConnection as unknown as new (c: unknown) => SshConnection)(client);

  function fakeClient(boundPort: number) {
    let onTcp: ((info: { destPort: number }, accept: () => unknown, deny: () => void) => void) | null =
      null;
    return {
      forwardIn: vi.fn((addr: string, port: number, cb: (e: Error | null, p: number) => void) => {
        cb(null, port || boundPort);
      }),
      on: vi.fn((event: string, fn: never) => {
        if (event === 'tcp connection') onTcp = fn;
      }),
      removeListener: vi.fn(),
      unforwardIn: vi.fn((_a: string, _p: number, cb: () => void) => cb()),
      fire: (info: { destPort: number }, accept: () => unknown, deny: () => void) =>
        onTcp?.(info, accept, deny),
    };
  }

  it('绑定 127.0.0.1、remotePort=0 用远端自选口、匹配连接回接本地 MCP', async () => {
    // 本地「MCP server」桩:收字节即记录,不回写(避免 pipe 回环)
    const received: Buffer[] = [];
    const mcp = net.createServer((s) => {
      s.on('data', (d) => received.push(d as Buffer));
    });
    await new Promise<void>((r) => mcp.listen(0, '127.0.0.1', () => r()));
    const localPort = (mcp.address() as net.AddressInfo).port;

    try {
      const client = fakeClient(45678);
      const handle = await construct(client).forwardInToLocal(localPort, 0);
      expect(client.forwardIn).toHaveBeenCalledWith('127.0.0.1', 0, expect.any(Function));
      expect(handle.remotePort).toBe(45678); // 远端自选口回传

      // 模拟一条打到该端口的反向连接:accept 返回一个 PassThrough 当 ssh channel
      const stream = new PassThrough();
      const accept = vi.fn(() => stream);
      const deny = vi.fn();
      client.fire({ destPort: 45678 }, accept, deny);
      expect(accept).toHaveBeenCalled();
      expect(deny).not.toHaveBeenCalled();

      // agent 侧写入 → stream.pipe(local) → 本地 MCP 收到
      stream.write('GET /mcp HTTP/1.1\r\n');
      await new Promise((r) => setTimeout(r, 30));
      expect(Buffer.concat(received).toString()).toContain('GET /mcp');
      stream.destroy(); // → 触发实现里 local.destroy(),放行 mcp.close()
    } finally {
      await new Promise<void>((r) => mcp.close(() => r()));
    }
  });

  it('destPort 不匹配 → deny(不误接他人转发的连接)', async () => {
    const client = fakeClient(45678);
    await construct(client).forwardInToLocal(1, 45678);
    const accept = vi.fn(() => new PassThrough());
    const deny = vi.fn();
    client.fire({ destPort: 9999 }, accept, deny);
    expect(deny).toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });

  it('close() 摘 tcp 监听 + unforwardIn 撤销远端绑定', async () => {
    const client = fakeClient(45678);
    const handle = await construct(client).forwardInToLocal(1, 45678);
    handle.close();
    expect(client.removeListener).toHaveBeenCalledWith('tcp connection', expect.any(Function));
    expect(client.unforwardIn).toHaveBeenCalledWith('127.0.0.1', 45678, expect.any(Function));
  });
});
