// @vitest-environment jsdom
// BL-005 · AC-15(T-030/T-031·CR-1 接线层):瞬时断线抑制 full drop / 确定断线才 drop。
// 覆盖两半接线:① reconnectController 同步先占 reconnecting + disconnect-first 自发 disconnected 再入守卫;
// ② Sidebar 900ms drop 计时器 gate 到 !isReconnecting(reconnecting 期不启动)。用真实
// remoteHostStore(直驱)+ 注入 stopSync/readopt spy,断言「reconnecting 期即便 >900ms 也不 stopSync」
// +「超预算才 drop」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReconnectController,
  scheduleDropUnlessReconnecting,
} from '../reconnectController';
import { ReconnectBackoff } from '../reconnectBackoff';
import { useRemoteHostRuntimeStore } from '../../state/remoteHostStore';

const DISCONNECT_PANEL_MS = 900;

beforeEach(() => {
  vi.useFakeTimers();
  useRemoteHostRuntimeStore.setState({ runtime: {}, reconnecting: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

function makeDeps(overrides?: Partial<Parameters<typeof createReconnectController>[0]>) {
  const store = useRemoteHostRuntimeStore.getState();
  const connect = vi.fn();
  const disconnect = vi.fn();
  const stopSync = vi.fn();
  const readopt = vi.fn(async () => {});
  const controller = createReconnectController({
    connect,
    disconnect,
    // 直驱真实 store(接线层·非纯 mock)
    setReconnecting: (id, on) => useRemoteHostRuntimeStore.getState().setReconnecting(id, on),
    isReconnecting: (id) => useRemoteHostRuntimeStore.getState().isReconnecting(id),
    stopSync,
    readopt,
    makeBackoff: () => new ReconnectBackoff({ baseMs: 1000, capMs: 30_000, budget: 3 }),
    ...overrides,
  });
  return { controller, connect, disconnect, stopSync, readopt, store };
}

describe('transient_disconnect_suppresses_full_drop_keeps_terminal_and_workspace (T-030)', () => {
  it('心跳判断线 → 同步先占 reconnecting 再 disconnect-first(顺序不可换·CR-1 ①)', () => {
    const { controller, connect, disconnect } = makeDeps();
    const order: string[] = [];
    // 探测顺序:disconnect 被调用时 reconnecting 必须已为 true
    disconnect.mockImplementation(() => {
      order.push(`disconnect(reconnecting=${useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')})`);
    });
    connect.mockImplementation(() => order.push('connect'));

    controller.onDisconnected('cfg-1');

    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(true);
    expect(order).toEqual(['disconnect(reconnecting=true)', 'connect']); // disconnect-first
  });

  it('disconnect-first 自发 disconnected 再入守卫:不重复 begin(不 loop)', () => {
    const { controller, disconnect, connect } = makeDeps();
    controller.onDisconnected('cfg-1');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);

    // 自发 disconnected 再次进入 → reconnecting 已 true → 再入守卫忽略
    controller.onDisconnected('cfg-1');
    expect(disconnect).toHaveBeenCalledTimes(1); // 未再触发
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('Sidebar 900ms drop 计时器 gate:reconnecting 期不启动 → 即便 >900ms 也不 stopSync(抑制 full drop)', () => {
    const { controller, stopSync } = makeDeps();
    controller.onDisconnected('cfg-1'); // 进入 reconnecting

    // 模拟 Sidebar 收到自发 disconnected 后尝试排 900ms 折叠计时器
    const handle = scheduleDropUnlessReconnecting('cfg-1', {
      isReconnecting: (id) => useRemoteHostRuntimeStore.getState().isReconnecting(id),
      stopSync,
      delayMs: DISCONNECT_PANEL_MS,
    });

    expect(handle).toBeNull(); // 被 gate 掉(reconnecting 中)
    vi.advanceTimersByTime(5000); // 远超 900ms
    expect(stopSync).not.toHaveBeenCalled(); // 抑制 full drop·保活终端 + workspace
  });

  it('非 reconnecting(确定断线)→ Sidebar 900ms 计时器照常排 → stopSync(不回归 BL-004)', () => {
    const { stopSync } = makeDeps();
    // 未进入 reconnecting(如机器被删除的确定断线)
    const handle = scheduleDropUnlessReconnecting('cfg-2', {
      isReconnecting: (id) => useRemoteHostRuntimeStore.getState().isReconnecting(id),
      stopSync,
      delayMs: DISCONNECT_PANEL_MS,
    });
    expect(handle).not.toBeNull();
    vi.advanceTimersByTime(DISCONNECT_PANEL_MS);
    expect(stopSync).toHaveBeenCalledWith('cfg-2');
  });

  it('握手成功 onReconnected(reconnect promise resolve)→ 清 reconnecting + readopt 收养(横幅消失)', async () => {
    const { controller, readopt, stopSync } = makeDeps();
    controller.onDisconnected('cfg-1');
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(true);

    controller.onReconnected('cfg-1');

    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(false);
    expect(readopt).toHaveBeenCalledWith('cfg-1'); // 收养回放对账
    expect(stopSync).not.toHaveBeenCalled(); // 成功不 drop
  });

  it('onReconnected 非 reconnecting(cancel 后重连/编排外握手)也跑 readopt(2026-07-23:跳过会把存活终端钉死聋哑)', () => {
    const { controller, readopt } = makeDeps();
    controller.onReconnected('cfg-1'); // 从未进入 reconnecting
    expect(readopt).toHaveBeenCalledWith('cfg-1');
  });
});

describe('definite_disconnect_over_budget_triggers_bl004_full_drop (T-031)', () => {
  it('重连预算耗尽 → 判确定断线 → stopRemoteWorkspaceSync(BL-004 full drop) + 清 reconnecting', () => {
    const { controller, stopSync, disconnect } = makeDeps(); // budget=3
    controller.onDisconnected('cfg-1'); // 首试(attempt 1)
    expect(disconnect).toHaveBeenCalledTimes(1);

    // 失败 → 退避重试(attempt 2),推进 fake timer 触发
    controller.onAttemptFailed('cfg-1');
    vi.advanceTimersByTime(2000);
    expect(disconnect).toHaveBeenCalledTimes(2);

    // 失败 → 退避重试(attempt 3)
    controller.onAttemptFailed('cfg-1');
    vi.advanceTimersByTime(4000);
    expect(disconnect).toHaveBeenCalledTimes(3);

    // 第 3 次失败 → 超预算(budget=3)→ 确定断线 drop
    expect(stopSync).not.toHaveBeenCalled();
    controller.onAttemptFailed('cfg-1');
    expect(stopSync).toHaveBeenCalledWith('cfg-1');
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(false);
  });

  it('确定断线 drop 后不再有悬挂重试计时器(不误触发第 4 次)', () => {
    const { controller, disconnect } = makeDeps();
    controller.onDisconnected('cfg-1');
    controller.onAttemptFailed('cfg-1');
    vi.advanceTimersByTime(2000);
    controller.onAttemptFailed('cfg-1');
    vi.advanceTimersByTime(4000);
    controller.onAttemptFailed('cfg-1'); // 超预算 → drop
    const calls = disconnect.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(disconnect.mock.calls.length).toBe(calls); // 无残留计时器再触发
  });

  it('用户主动断开 cancel:清退避计时器与 reconnecting 态,退避到点不再拉起(保持断开)', () => {
    const { controller, connect, disconnect, stopSync } = makeDeps();
    controller.onDisconnected('cfg-1'); // 进入重连编排(首试)
    controller.onAttemptFailed('cfg-1'); // 排了退避计时器
    const connects = connect.mock.calls.length;
    const disconnects = disconnect.mock.calls.length;

    controller.cancel('cfg-1'); // 用户点「断开」

    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(false);
    expect(controller.isActive('cfg-1')).toBe(false);
    vi.advanceTimersByTime(60_000); // 远超全部退避档位
    expect(connect.mock.calls.length).toBe(connects); // 无残留重试拉起
    expect(disconnect.mock.calls.length).toBe(disconnects);
    expect(stopSync).not.toHaveBeenCalled(); // cancel 不走 drop 出口(折叠由断开 UI 流程自理)
  });

  it('cancel 后未在编排:再次 cancel 为廉价 no-op(不抛不改态)', () => {
    const { controller } = makeDeps();
    controller.cancel('cfg-x');
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-x')).toBe(false);
  });

  it('manualRetry 复位退避预算(给足新窗口·横幅「立即重试」)', () => {
    const { controller, disconnect, stopSync } = makeDeps();
    controller.onDisconnected('cfg-1');
    controller.onAttemptFailed('cfg-1');
    vi.advanceTimersByTime(2000);
    controller.onAttemptFailed('cfg-1');
    vi.advanceTimersByTime(4000);
    // 此刻 attempt≈3;手动重试复位,不应立即 drop
    controller.manualRetry('cfg-1');
    expect(stopSync).not.toHaveBeenCalled();
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });
});
