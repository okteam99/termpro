// BrowserNetworkController(标签级出口/多分区版):声明式对账 acquire/release /
// 断线 fail-closed per-分区 / ready 自动恢复 / 删除释放 / 分区代理恒 socks5。
// 全 DI 桩,不触碰 Electron/网络。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserNetworkController, type BrowserNetworkDeps } from '../browserNetwork';
import { partitionOf, type BrowserNetworkSnapshot } from '../../shared/remoteHost';

function makeDeps(overrides: Partial<BrowserNetworkDeps> = {}): {
  deps: BrowserNetworkDeps;
  proxyCalls: Array<[string, string | null]>;
  released: string[];
  emitted: BrowserNetworkSnapshot[];
} {
  const proxyCalls: Array<[string, string | null]> = [];
  const released: string[] = [];
  const emitted: BrowserNetworkSnapshot[] = [];
  const deps: BrowserNetworkDeps = {
    setProxy: vi.fn(async (partition, rules) => {
      proxyCalls.push([partition, rules]);
    }),
    browserProxyFor: vi.fn(async (id: string) =>
      id.startsWith('ready') ? { socksPort: 51234 } : null,
    ),
    releaseBrowserProxy: vi.fn((id: string) => {
      released.push(id);
    }),
    aliasOf: vi.fn((id: string) => (id === 'ready-a' ? 'VPS A' : undefined)),
    emitChanged: vi.fn((s) => {
      emitted.push(s);
    }),
    ...overrides,
  };
  return { deps, proxyCalls, released, emitted };
}

describe('BrowserNetworkController(多分区)', () => {
  let d: ReturnType<typeof makeDeps>;
  let ctrl: BrowserNetworkController;
  beforeEach(() => {
    d = makeDeps();
    ctrl = new BrowserNetworkController(d.deps);
  });

  it('partitionOf:local=原分区(零迁移);远程=独立分区', () => {
    expect(partitionOf('local')).toBe('persist:browser');
    expect(partitionOf('cfg-1')).toBe('persist:browser-cfg-1');
  });

  it('syncExits:acquire 新增出口(该分区 setProxy socks5)· local 忽略 · 快照带 alias', async () => {
    const snap = await ctrl.syncExits(['local', 'ready-a']);
    expect(d.proxyCalls).toEqual([
      ['persist:browser-ready-a', 'socks5://127.0.0.1:51234'],
    ]);
    expect(snap.exits).toEqual([{ hostId: 'ready-a', alias: 'VPS A' }]);
  });

  it('syncExits:并发多机同时在用;集合缩减时 release 只回收不再使用的', async () => {
    await ctrl.syncExits(['ready-a', 'ready-b']);
    expect(ctrl.snapshot().exits.map((e) => e.hostId).sort()).toEqual(['ready-a', 'ready-b']);

    await ctrl.syncExits(['ready-b']);
    expect(d.released).toEqual(['ready-a']);
    expect(ctrl.snapshot().exits.map((e) => e.hostId)).toEqual(['ready-b']);

    await ctrl.syncExits([]);
    expect(d.released).toEqual(['ready-a', 'ready-b']);
    expect(ctrl.snapshot().exits).toEqual([]);
  });

  it('syncExits 幂等:集合不变不重复 acquire/emit', async () => {
    await ctrl.syncExits(['ready-a']);
    const calls = d.proxyCalls.length;
    const emits = d.emitted.length;
    await ctrl.syncExits(['ready-a']);
    expect(d.proxyCalls.length).toBe(calls);
    expect(d.emitted.length).toBe(emits);
  });

  it('acquire 时该机未 ready → 挂 down(fail-closed,不落直连);ready 后 onHostUp 恢复', async () => {
    const deps = makeDeps({
      browserProxyFor: vi
        .fn()
        .mockResolvedValueOnce(null) // 首次:未 ready
        .mockResolvedValue({ socksPort: 40001 }), // 恢复:ready
    });
    const c = new BrowserNetworkController(deps.deps);
    await c.syncExits(['cfg-x']);
    expect(c.snapshot().exits).toEqual([{ hostId: 'cfg-x', alias: undefined, down: true }]);
    expect(deps.proxyCalls).toEqual([]); // 绝不给该分区设直连

    c.onHostUp('cfg-x');
    await new Promise((r) => setTimeout(r, 0));
    expect(c.snapshot().exits).toEqual([{ hostId: 'cfg-x', alias: undefined }]);
    expect(deps.proxyCalls).toEqual([['persist:browser-cfg-x', 'socks5://127.0.0.1:40001']]);
  });

  it('onHostDown(在用出口):标 down + 广播;代理/释放都不动(fail-closed)', async () => {
    await ctrl.syncExits(['ready-a']);
    d.proxyCalls.length = 0;
    d.emitted.length = 0;
    ctrl.onHostDown('ready-a');
    expect(ctrl.snapshot().exits[0].down).toBe(true);
    expect(d.emitted).toHaveLength(1);
    expect(d.proxyCalls).toEqual([]);
    expect(d.released).toEqual([]);
  });

  it('onHostDown(非在用出口)/重复 down:忽略', async () => {
    await ctrl.syncExits(['ready-a']);
    d.emitted.length = 0;
    ctrl.onHostDown('other');
    ctrl.onHostDown('ready-a');
    ctrl.onHostDown('ready-a'); // 幂等
    expect(d.emitted).toHaveLength(1);
  });

  it('onHostUp:down 出口重建 SOCKS(新端口)重 setProxy + 清 down;重建失败保持 down', async () => {
    const deps = makeDeps({
      browserProxyFor: vi
        .fn()
        .mockResolvedValueOnce({ socksPort: 40001 })
        .mockResolvedValueOnce({ socksPort: 40002 }) // 重连后新端口
        .mockResolvedValue(null), // 之后:又断竞态
    });
    const c = new BrowserNetworkController(deps.deps);
    await c.syncExits(['cfg-x']);
    c.onHostDown('cfg-x');

    c.onHostUp('cfg-x');
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.proxyCalls.at(-1)).toEqual([
      'persist:browser-cfg-x',
      'socks5://127.0.0.1:40002',
    ]);
    expect(c.snapshot().exits[0].down).toBeUndefined();

    // 又断 → down → onHostUp 但 browserProxyFor 已 null → 保持 down
    c.onHostDown('cfg-x');
    c.onHostUp('cfg-x');
    await new Promise((r) => setTimeout(r, 0));
    expect(c.snapshot().exits[0].down).toBe(true);
  });

  it('setProxy 失败:回收刚建端口 + 挂 down(绝不落直连)', async () => {
    const deps = makeDeps({
      setProxy: vi.fn(async () => {
        throw new Error('setProxy failed');
      }),
    });
    const c = new BrowserNetworkController(deps.deps);
    await c.syncExits(['ready-a']);
    expect(deps.released).toEqual(['ready-a']);
    expect(c.snapshot().exits[0].down).toBe(true);
  });

  it('onHostRemoved(用户删除):release + 移出快照;非在用忽略', async () => {
    await ctrl.syncExits(['ready-a']);
    d.emitted.length = 0;
    ctrl.onHostRemoved('ready-a');
    await new Promise((r) => setTimeout(r, 0));
    expect(d.released).toEqual(['ready-a']);
    expect(ctrl.snapshot().exits).toEqual([]);
    expect(d.emitted).toHaveLength(1);

    ctrl.onHostRemoved('other');
    await new Promise((r) => setTimeout(r, 0));
    expect(d.emitted).toHaveLength(1); // 无变化不广播
  });
});
