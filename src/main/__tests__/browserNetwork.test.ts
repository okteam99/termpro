// BrowserNetworkController:出口切换 / 回退 / 断线自动回退 / WebRTC 策略 / 旧出口释放。
// 全 DI 桩,不触碰 Electron/网络。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserNetworkController, type BrowserNetworkDeps } from '../browserNetwork';
import type { BrowserNetworkState } from '../../shared/remoteHost';

function makeDeps(overrides: Partial<BrowserNetworkDeps> = {}): {
  deps: BrowserNetworkDeps;
  proxyCalls: (string | null)[];
  webrtcCalls: string[];
  released: string[];
  emitted: BrowserNetworkState[];
} {
  const proxyCalls: (string | null)[] = [];
  const webrtcCalls: string[] = [];
  const released: string[] = [];
  const emitted: BrowserNetworkState[] = [];
  const deps: BrowserNetworkDeps = {
    setProxy: vi.fn(async (rules) => {
      proxyCalls.push(rules);
    }),
    browserProxyFor: vi.fn(async (id: string) =>
      id === 'ready-host' ? { socksPort: 51234 } : null,
    ),
    releaseBrowserProxy: vi.fn((id: string) => {
      released.push(id);
    }),
    setWebRtcPolicy: vi.fn((p) => {
      webrtcCalls.push(p);
    }),
    aliasOf: vi.fn((id: string) => (id === 'ready-host' ? 'My VPS' : undefined)),
    emitChanged: vi.fn((s) => {
      emitted.push(s);
    }),
    ...overrides,
  };
  return { deps, proxyCalls, webrtcCalls, released, emitted };
}

describe('BrowserNetworkController', () => {
  let d: ReturnType<typeof makeDeps>;
  let ctrl: BrowserNetworkController;
  beforeEach(() => {
    d = makeDeps();
    ctrl = new BrowserNetworkController(d.deps);
  });

  it('初始出口为 local', () => {
    expect(ctrl.get()).toEqual({ hostId: 'local' });
  });

  it('set(local):直连 + WebRTC default + 广播', async () => {
    const state = await ctrl.set('local');
    expect(state).toEqual({ hostId: 'local' });
    expect(d.proxyCalls).toEqual([null]);
    expect(d.webrtcCalls).toEqual(['default']);
    expect(d.emitted).toEqual([{ hostId: 'local' }]);
  });

  it('set(ready 远程):socks5 代理 + WebRTC 关非代理 UDP + 带 alias 广播', async () => {
    const state = await ctrl.set('ready-host');
    expect(state).toEqual({ hostId: 'ready-host', alias: 'My VPS' });
    expect(d.proxyCalls).toEqual(['socks5://127.0.0.1:51234']);
    expect(d.webrtcCalls).toEqual(['disable_non_proxied_udp']);
    expect(ctrl.get()).toEqual({ hostId: 'ready-host', alias: 'My VPS' });
  });

  it('set(不可用远程):browserProxyFor→null → 回退 local(直连)', async () => {
    const state = await ctrl.set('offline-host');
    expect(state).toEqual({ hostId: 'local' });
    expect(d.proxyCalls).toEqual([null]);
    expect(d.webrtcCalls).toEqual(['default']);
    expect(ctrl.get().hostId).toBe('local');
  });

  it('切换远程 A→B:先设新代理再释放旧远程端口', async () => {
    const deps = makeDeps({
      browserProxyFor: vi.fn(async (id: string) =>
        id === 'host-a' ? { socksPort: 40001 } : id === 'host-b' ? { socksPort: 40002 } : null,
      ),
      aliasOf: vi.fn(() => undefined),
    });
    const c = new BrowserNetworkController(deps.deps);
    await c.set('host-a');
    await c.set('host-b');
    expect(deps.proxyCalls).toEqual(['socks5://127.0.0.1:40001', 'socks5://127.0.0.1:40002']);
    expect(deps.released).toEqual(['host-a']); // 切走时释放 A,B 保持
  });

  it('远程 → local:释放旧远程端口', async () => {
    await ctrl.set('ready-host');
    await ctrl.set('local');
    expect(d.released).toEqual(['ready-host']);
  });

  it('onHostDown(当前出口):自动回退 local + 广播', async () => {
    await ctrl.set('ready-host');
    d.emitted.length = 0;
    ctrl.onHostDown('ready-host');
    await Promise.resolve(); // 让 onHostDown 内部 set('local') 的队列 flush
    await Promise.resolve();
    expect(ctrl.get().hostId).toBe('local');
    expect(d.emitted.at(-1)).toEqual({ hostId: 'local' });
  });

  it('onHostDown(非当前出口):忽略,不动当前出口', async () => {
    await ctrl.set('ready-host');
    d.emitted.length = 0;
    ctrl.onHostDown('some-other-host');
    await Promise.resolve();
    expect(ctrl.get()).toEqual({ hostId: 'ready-host', alias: 'My VPS' });
    expect(d.emitted).toEqual([]);
  });

  it('setProxy 失败(P2-3):回收刚建的远程端口 + 回退 local + WebRTC default', async () => {
    let firstCall = true;
    const deps = makeDeps({
      // 远程分支的 socks5 setProxy 抛错;后续回退的 setProxy(null) 成功
      setProxy: vi.fn(async (rules) => {
        if (firstCall && rules !== null) {
          firstCall = false;
          throw new Error('setProxy failed');
        }
      }),
    });
    const c = new BrowserNetworkController(deps.deps);
    const state = await c.set('ready-host');
    expect(state).toEqual({ hostId: 'local' }); // 回退 local
    expect(deps.released).toContain('ready-host'); // 刚建的端口被回收
    expect(deps.webrtcCalls.at(-1)).toBe('default'); // WebRTC 复位
    expect(c.get().hostId).toBe('local');
  });

  it('串行化:并发 set 不交错,最终态一致', async () => {
    const [s1, s2] = await Promise.all([ctrl.set('ready-host'), ctrl.set('local')]);
    expect(s1.hostId).toBe('ready-host');
    expect(s2.hostId).toBe('local');
    expect(ctrl.get().hostId).toBe('local'); // 最后一个 set 落定
  });
});
