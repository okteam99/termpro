// 共享测试脚手架:非测试文件本身,仅供 __tests__/*.test.ts 复用。
// FakeServer 模拟 net.Server(forwardOut 返回值);RoutedSsh 模拟 SshConnectionLike,
// exec() 按正则路由到桩响应,其余方法可各自覆盖行为并记录调用(vi.fn())。

import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import type { Server as NetServer } from 'node:net';
import type { ExecResult, SshConnectionLike } from '../ssh';

let fakePortSeq = 41000;

export class FakeServer extends EventEmitter {
  closed = false;
  constructor(private readonly port: number = fakePortSeq++) {
    super();
    // 模拟真实 net.Server 的异步 listening(下一微任务/宏任务触发)
    setImmediate(() => this.emit('listening'));
  }
  address() {
    return { port: this.port, address: '127.0.0.1', family: 'IPv4' } as const;
  }
  close(cb?: () => void): void {
    this.closed = true;
    this.emit('close');
    cb?.();
  }
  off(event: string | symbol, listener: (...args: never[]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export function asNetServer(s: FakeServer): NetServer {
  return s as unknown as NetServer;
}

export type ExecHandler = (cmd: string) => ExecResult | null;

export interface RoutedSshOptions {
  /** 按顺序尝试,第一个返回非 null 的即命中;都不命中 → 默认 {code:0,stdout:'',stderr:''}。 */
  execHandlers?: ExecHandler[];
  sftpReadFile?: (path: string) => Buffer | null;
  sftpWriteDir?: (localDir: string, remoteDir: string, onProgress: (pct: number) => void) => void;
  /** 抛错即模拟 rename 目标已存在(ENOTEMPTY)。 */
  sftpRename?: (from: string, to: string) => void;
  forwardOut?: (localPort: number, remotePort: number) => FakeServer;
}

export interface RoutedSsh extends SshConnectionLike {
  execCalls: string[];
  execDetachedCalls: Array<{ cmd: string; stdin: string }>;
  closed: boolean;
  /** 测试用:模拟底层 ssh2 连接层断开(A2),触发所有经 onClose 注册的回调。 */
  simulateSshClose: (err?: Error) => void;
}

export function createRoutedSsh(opts: RoutedSshOptions = {}): RoutedSsh {
  const execCalls: string[] = [];
  const execDetachedCalls: Array<{ cmd: string; stdin: string }> = [];
  let closed = false;
  const closeListeners: Array<(err?: Error) => void> = [];

  return {
    execCalls,
    execDetachedCalls,
    get closed() {
      return closed;
    },
    simulateSshClose: (err?: Error) => {
      for (const cb of closeListeners.slice()) cb(err);
    },
    onClose: vi.fn((cb: (err?: Error) => void) => {
      closeListeners.push(cb);
    }),
    exec: vi.fn(async (cmd: string): Promise<ExecResult> => {
      execCalls.push(cmd);
      for (const handler of opts.execHandlers ?? []) {
        const res = handler(cmd);
        if (res !== null) return res;
      }
      // deploy.ts 的 mkdir-lock 惯用式默认「未争用即拿到锁」(测试未显式覆盖时,
      // 大多数场景就是「本 flow 是唯一部署者」),避免默认空 stdout 被误判为 EXISTS。
      if (cmd.includes('mkdir') && cmd.includes('LOCKED')) {
        return { code: 0, stdout: 'LOCKED\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }),
    execDetached: vi.fn(async (cmd: string, stdin: string): Promise<void> => {
      execDetachedCalls.push({ cmd, stdin });
    }),
    sftpReadFile: vi.fn(async (path: string): Promise<Buffer | null> => {
      const result = opts.sftpReadFile?.(path) ?? null;
      return result;
    }),
    sftpWriteDir: vi.fn(
      async (
        localDir: string,
        remoteDir: string,
        onProgress: (pct: number) => void,
      ): Promise<void> => {
        if (opts.sftpWriteDir) {
          opts.sftpWriteDir(localDir, remoteDir, onProgress);
        } else {
          onProgress(100);
        }
      },
    ),
    sftpRename: vi.fn(async (from: string, to: string): Promise<void> => {
      if (opts.sftpRename) opts.sftpRename(from, to);
    }),
    forwardOut: vi.fn((localPort: number, remotePort: number) => {
      const server = opts.forwardOut ? opts.forwardOut(localPort, remotePort) : new FakeServer();
      return asNetServer(server);
    }),
    close: vi.fn(() => {
      closed = true;
    }),
  };
}

/** 便捷:node 探测 → v20.x @ /usr/bin/node,`uname -sm` → Darwin arm64,其余走默认(code0 空输出)。 */
export function healthyExecHandlers(overrides: ExecHandler[] = []): ExecHandler[] {
  return [
    (cmd) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
    (cmd) =>
      cmd.includes('command -v node')
        ? { code: 0, stdout: 'v20.11.0 /usr/bin/node\n', stderr: '' }
        : null,
    (cmd) => (cmd === 'uname -sm' ? { code: 0, stdout: 'Darwin arm64\n', stderr: '' } : null),
    ...overrides,
  ];
}

export function bufferOf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

export async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function immediateSleep(): (ms: number) => Promise<void> {
  return () => Promise.resolve();
}
