// BrowserNetworkController:出口切换 / 回退 / 断线 fail-closed(down 标记,不回退 local)
// / ready 自动恢复 / 删除回退 / WebRTC 策略 / 旧出口释放。全 DI 桩,不触碰 Electron/网络。
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

  it('onHostDown(当前出口):fail-closed——标记 down + 广播,不回退 local、不动代理/WebRTC', async () => {
    await ctrl.set('ready-host');
    d.emitted.length = 0;
    d.proxyCalls.length = 0;
    d.webrtcCalls.length = 0;
    ctrl.onHostDown('ready-host');
    expect(ctrl.get()).toEqual({ hostId: 'ready-host', alias: 'My VPS', down: true });
    expect(d.emitted).toEqual([{ hostId: 'ready-host', alias: 'My VPS', down: true }]);
    expect(d.proxyCalls).toEqual([]); // 代理留在死端口(请求快速失败),绝不切 direct
    expect(d.webrtcCalls).toEqual([]); // 防泄漏策略不放开
    expect(d.released).toEqual([]); // orchestrator 已关它的 SOCKS,这里不重复释放
  });

  it('onHostDown 幂等:重复 down 不重复广播', async () => {
    await ctrl.set('ready-host');
    d.emitted.length = 0;
    ctrl.onHostDown('ready-host');
    ctrl.onHostDown('ready-host');
    expect(d.emitted).toHaveLength(1);
  });

  it('onHostDown(非当前出口):忽略,不动当前出口', async () => {
    await ctrl.set('ready-host');
    d.emitted.length = 0;
    ctrl.onHostDown('some-other-host');
    await Promise.resolve();
    expect(ctrl.get()).toEqual({ hostId: 'ready-host', alias: 'My VPS' });
    expect(d.emitted).toEqual([]);
  });

  it('onHostUp(down 中的当前出口):重建 SOCKS + 恢复代理 + WebRTC 防泄漏 + 清 down', async () => {
    await ctrl.set('ready-host');
    ctrl.onHostDown('ready-host');
    d.proxyCalls.length = 0;
    d.webrtcCalls.length = 0;
    d.emitted.length = 0;
    ctrl.onHostUp('ready-host');
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.get()).toEqual({ hostId: 'ready-host', alias: 'My VPS' });
    expect(d.proxyCalls).toEqual(['socks5://127.0.0.1:51234']);
    expect(d.webrtcCalls).toEqual(['disable_non_proxied_udp']);
    expect(d.emitted.at(-1)).toEqual({ hostId: 'ready-host', alias: 'My VPS' });
  });

  it('onHostUp 重建失败(又断竞态 browserProxyFor→null):保持 down,绝不落 local', async () => {
    const deps = makeDeps();
    const c = new BrowserNetworkController(deps.deps);
    await c.set('ready-host');
    c.onHostDown('ready-host');
    // ready→又断:browserProxyFor 开始返回 null
    (deps.deps.browserProxyFor as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    deps.emitted.length = 0;
    c.onHostUp('ready-host');
    await new Promise((r) => setTimeout(r, 0));
    expect(c.get()).toEqual({ hostId: 'ready-host', alias: 'My VPS', down: true });
    expect(deps.emitted).toEqual([]); // 无状态变化不广播
  });

  it('onHostUp(非当前出口/未 down):no-op', async () => {
    await ctrl.set('ready-host');
    d.emitted.length = 0;
    d.proxyCalls.length = 0;
    ctrl.onHostUp('ready-host'); // 未 down
    ctrl.onHostUp('some-other-host');
    await new Promise((r) => setTimeout(r, 0));
    expect(d.emitted).toEqual([]);
    expect(d.proxyCalls).toEqual([]);
  });

  it('onHostRemoved(当前出口,用户删除=显式意图):回 local + 直连 + WebRTC default', async () => {
    await ctrl.set('ready-host');
    ctrl.onHostDown('ready-host');
    d.emitted.length = 0;
    ctrl.onHostRemoved('ready-host');
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.get()).toEqual({ hostId: 'local' });
    expect(d.emitted.at(-1)).toEqual({ hostId: 'local' });
    expect(d.webrtcCalls.at(-1)).toBe('default');
  });

  it('down 期间用户手动 set(local):照常切换(手动路径不受 fail-closed 限制)', async () => {
    await ctrl.set('ready-host');
    ctrl.onHostDown('ready-host');
    const state = await ctrl.set('local');
    expect(state).toEqual({ hostId: 'local' });
    expect(d.released).toContain('ready-host'); // 切走时释放(幂等)
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
