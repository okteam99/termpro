// @vitest-environment jsdom
// 2026-08-10 兜底闸:单次重连尝试看门狗。connect 发出后窗口内无任何定论(成功/失败/取消)
// → 按尝试失败推进退避;main 侧任何静默路径(去重 no-op、僵尸自弃、safeEmit 吞非法转移)
// 都不再能让状态机永久搁浅在「Reconnecting…」。反向不变式:定论到达即撤狗,不给下一次
// 尝试计旧账;超预算路径与真失败共享 definite 出口。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReconnectController } from '../reconnectController';
import { ReconnectBackoff } from '../reconnectBackoff';
import { useRemoteHostRuntimeStore } from '../../state/remoteHostStore';

const ATTEMPT_TIMEOUT_MS = 5_000;

beforeEach(() => {
  vi.useFakeTimers();
  useRemoteHostRuntimeStore.setState({ runtime: {}, reconnecting: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

function makeDeps() {
  const connect = vi.fn();
  const disconnect = vi.fn();
  const stopSync = vi.fn();
  const readopt = vi.fn(async () => {});
  const controller = createReconnectController({
    connect,
    disconnect,
    setReconnecting: (id, on) => useRemoteHostRuntimeStore.getState().setReconnecting(id, on),
    isReconnecting: (id) => useRemoteHostRuntimeStore.getState().isReconnecting(id),
    stopSync,
    readopt,
    makeBackoff: () => new ReconnectBackoff({ baseMs: 1000, capMs: 30_000, budget: 3 }),
    attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
  });
  return { controller, connect, disconnect, stopSync, readopt };
}

describe('reconnect_attempt_watchdog_prevents_silent_stall', () => {
  it('尝试静默搁浅(无任何事件)→ 看门狗到点按失败推进 → 退避后自动再试', async () => {
    const { controller, connect } = makeDeps();
    controller.onDisconnected('cfg-1');
    await vi.advanceTimersByTimeAsync(0); // fireAttempt 的 await disconnect 微任务
    expect(connect).toHaveBeenCalledTimes(1);

    // 无 onReconnected / onAttemptFailed / cancel —— 静默搁浅
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS); // 看门狗触发(视为失败)
    // attempt=1 → 退避 peek=2000ms 后第二次尝试
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(true); // 仍在编排
  });

  it('连环静默搁浅 → 看门狗逐次推进直至超预算 → 确定断线 drop(不再永挂「重连中」)', async () => {
    const { controller, connect, stopSync } = makeDeps(); // budget=3
    controller.onDisconnected('cfg-1'); // 尝试 1
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + 2_000); // 狗1 + 退避2s → 尝试 2
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + 4_000); // 狗2 + 退避4s → 尝试 3
    expect(connect).toHaveBeenCalledTimes(3);

    expect(stopSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS); // 狗3 → 超预算(attempt 3 ≥ budget 3)
    expect(stopSync).toHaveBeenCalledWith('cfg-1'); // BL-004 full drop 出口
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000); // drop 后无残留计时器再拉起
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('定论(onReconnected)到达 → 撤狗:窗口过后不误判失败、不再发起尝试', async () => {
    const { controller, connect } = makeDeps();
    controller.onDisconnected('cfg-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);

    controller.onReconnected('cfg-1'); // 握手成功
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS * 10);
    expect(connect).toHaveBeenCalledTimes(1); // 狗已撤,无幽灵重试
  });

  it('真失败(onAttemptFailed)先到 → 撤旧狗换新狗:重试节奏只由退避驱动,不双重计时', async () => {
    const { controller, connect } = makeDeps();
    controller.onDisconnected('cfg-1'); // 尝试 1
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    controller.onAttemptFailed('cfg-1'); // t=1s 真失败 → 撤狗,排退避 2s
    await vi.advanceTimersByTimeAsync(2_000); // t=3s → 尝试 2 + 新狗
    expect(connect).toHaveBeenCalledTimes(2);

    // 旧狗原定 t=5s 触发——若未撤,会在尝试 2 仅进行 2s 时误判失败多排一次重试
    await vi.advanceTimersByTimeAsync(2_000); // t=5s
    expect(connect).toHaveBeenCalledTimes(2); // 无旧狗误触发
    // 新狗在尝试 2 发出后 5s(t=8s)才到点 → 退避 4s → t=12s 尝试 3
    await vi.advanceTimersByTimeAsync(3_000 + 4_000); // t=12s
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('cancel(用户断开)→ 撤狗:窗口过后不复活重试(保持断开)', async () => {
    const { controller, connect, stopSync } = makeDeps();
    controller.onDisconnected('cfg-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);

    controller.cancel('cfg-1');
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS * 10);
    expect(connect).toHaveBeenCalledTimes(1); // 不复活
    expect(stopSync).not.toHaveBeenCalled(); // cancel 不走 drop 出口
  });
});
