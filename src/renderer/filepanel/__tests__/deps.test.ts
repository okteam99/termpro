// BL-004:makeHostDeps(resolveClient) 从固定单例改成 call-time 解析——每次方法调用现查
// resolveClient(),使切 workspace(含切到远程机)不重建 FilePanelController 也能换 host。
// platform 从构造期一次性值字段改成 getter(A4):否则远程机路径风格恒按 makeHostDeps()
// 调用那一刻的 host 解析,切到远程机后仍显示本机 platform。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionId } = vi.hoisted(() => ({ getSessionId: vi.fn() }));
vi.mock('../../terminal/terminalRegistry', () => ({ getSessionId }));

import { makeHostDeps } from '../deps';
import type { HostClient } from '../../services/hostClient';

function fakeClient(platform: string | null = 'darwin'): HostClient {
  return {
    info: { platform, homedir: '/home/u' },
    rpc: vi.fn(async () => ({})),
    onFsChanged: vi.fn(() => () => {}),
  } as unknown as HostClient;
}

beforeEach(() => {
  getSessionId.mockReset();
});

describe('platform:call-time getter(A4)', () => {
  it('不在 makeHostDeps() 调用时固化——每次访问重新 resolveClient()', () => {
    let current = fakeClient('darwin');
    const deps = makeHostDeps(() => current);
    expect(deps.platform).toBe('darwin');

    current = fakeClient('linux'); // 模拟切到远程机(不同 platform)
    expect(deps.platform).toBe('linux');
  });

  it('client.info 为 null(未连接)时兜底 null,不抛异常', () => {
    const client = { info: null, rpc: vi.fn(), onFsChanged: vi.fn() } as unknown as HostClient;
    const deps = makeHostDeps(() => client);
    expect(deps.platform).toBeNull();
  });
});

describe('RPC 方法:call-time 解析(不固化单例)', () => {
  it('每次调用都经 resolveClient() 取当前 client,不复用首次解析结果', async () => {
    const clientA = fakeClient();
    const clientB = fakeClient();
    let current: HostClient = clientA;
    const resolveClient = vi.fn(() => current);
    const deps = makeHostDeps(resolveClient);

    await deps.readdir('/a');
    expect(clientA.rpc).toHaveBeenCalledWith('fs.readdir', { path: '/a' });

    current = clientB; // 切 workspace → 换 host,controller 未重建
    await deps.readdir('/b');
    expect(clientB.rpc).toHaveBeenCalledWith('fs.readdir', { path: '/b' });
    expect(clientA.rpc).toHaveBeenCalledTimes(1); // 旧 client 不再被使用
  });

  it('全部 RPC 方法都路由到 resolveClient().rpc(method, params) 且透传返回值', async () => {
    const client = fakeClient();
    const resolveClient = vi.fn(() => client);
    const deps = makeHostDeps(resolveClient);

    await deps.ptyCwd('s1');
    await deps.gitInfo('/repo');
    await deps.gitWorktrees('/repo');
    await deps.gitStatus('/repo');
    await deps.readdir('/repo');
    await deps.realpath('/repo/x');
    await deps.watch('/repo');
    await deps.unwatch(1);

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'pty.cwd', { sessionId: 's1' });
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'git.info', { cwd: '/repo' });
    expect(client.rpc).toHaveBeenNthCalledWith(3, 'git.worktrees', { cwd: '/repo' });
    expect(client.rpc).toHaveBeenNthCalledWith(4, 'git.status', { toplevel: '/repo' });
    expect(client.rpc).toHaveBeenNthCalledWith(5, 'fs.readdir', { path: '/repo' });
    expect(client.rpc).toHaveBeenNthCalledWith(6, 'fs.realpath', { path: '/repo/x' });
    expect(client.rpc).toHaveBeenNthCalledWith(7, 'fs.watch', { path: '/repo' });
    expect(client.rpc).toHaveBeenNthCalledWith(8, 'fs.unwatch', { watchId: 1 });
    expect(resolveClient).toHaveBeenCalledTimes(8);
  });

  it('onFsChanged 委托给 resolveClient().onFsChanged', () => {
    const client = fakeClient();
    const deps = makeHostDeps(() => client);
    const cb = vi.fn();
    deps.onFsChanged(cb);
    expect(client.onFsChanged).toHaveBeenCalledWith(cb);
  });
});

describe('非 host 方法:不经 resolveClient', () => {
  it('getSessionId 委托 terminalRegistry.getSessionId,不依赖 client', () => {
    getSessionId.mockReturnValue('sess-x');
    const deps = makeHostDeps(() => fakeClient());
    expect(deps.getSessionId('tab1')).toBe('sess-x');
    expect(getSessionId).toHaveBeenCalledWith('tab1');
  });

  it('timer 方法透传 globalThis(fake timers 下可控)', () => {
    vi.useFakeTimers();
    try {
      const deps = makeHostDeps(() => fakeClient());
      const fn = vi.fn();
      const h = deps.setTimeout(fn, 100);
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      deps.clearTimeout(h);

      const intervalFn = vi.fn();
      const ih = deps.setInterval(intervalFn, 50);
      vi.advanceTimersByTime(150);
      expect(intervalFn).toHaveBeenCalledTimes(3);
      deps.clearInterval(ih);
      vi.advanceTimersByTime(200);
      expect(intervalFn).toHaveBeenCalledTimes(3); // cleared,不再触发
    } finally {
      vi.useRealTimers();
    }
  });
});
