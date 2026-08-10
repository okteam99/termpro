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

  it('评审 P1-2:顶代(manualRetry)在 pre-connect 窗口内 → 旧狗即撤,不给新尝试计旧账', async () => {
    // async disconnect:可控落定,把「await disconnect 窗口」拉开
    const resolvers: Array<() => void> = [];
    const connect = vi.fn();
    const disconnect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const stopSync = vi.fn();
    const controller = createReconnectController({
      connect,
      disconnect,
      setReconnecting: (id, on) => useRemoteHostRuntimeStore.getState().setReconnecting(id, on),
      isReconnecting: (id) => useRemoteHostRuntimeStore.getState().isReconnecting(id),
      stopSync,
      readopt: vi.fn(async () => {}),
      makeBackoff: () => new ReconnectBackoff({ baseMs: 1000, capMs: 30_000, budget: 5 }),
      attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    });

    controller.onDisconnected('cfg-1'); // t=0 代1:狗1 定于 t=5s,D1 在途
    await vi.advanceTimersByTimeAsync(4_000); // t=4s
    controller.manualRetry('cfg-1'); // 代2:撤狗1 挂狗2(定于 t=9s),D2 在途
    expect(disconnect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_100); // t=5.1s:狗1 原到点——若未撤会误判失败排幽灵重试
    resolvers[1]!(); // D2 落定 → 代2 connect
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);
    resolvers[0]!(); // D1 迟到落定 → 代1 自弃
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);

    // t=7.1s(旧版幽灵重试到点·会拆掉 2 秒大的 connect):不得有第二组 disconnect/connect
    await vi.advanceTimersByTimeAsync(2_000);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('评审 P1-3:disconnectAwait 永不落定(IPC 黑洞)→ 入口狗兜底逐次推进 → 超预算 drop 不僵死', async () => {
    const connect = vi.fn();
    const stopSync = vi.fn();
    const controller = createReconnectController({
      connect,
      disconnect: () => new Promise<void>(() => {}), // 永不落定
      setReconnecting: (id, on) => useRemoteHostRuntimeStore.getState().setReconnecting(id, on),
      isReconnecting: (id) => useRemoteHostRuntimeStore.getState().isReconnecting(id),
      stopSync,
      readopt: vi.fn(async () => {}),
      makeBackoff: () => new ReconnectBackoff({ baseMs: 1000, capMs: 30_000, budget: 3 }),
      attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    });
    controller.onDisconnected('cfg-1');
    // 狗(入口挂)+ 退避循环:5s+2s → 尝试2;5s+4s → 尝试3;5s → 超预算 drop
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + 2_000);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + 4_000);
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS);
    expect(connect).not.toHaveBeenCalled(); // disconnect 永挂,connect 一次都发不出
    expect(stopSync).toHaveBeenCalledWith('cfg-1'); // 但状态机不僵死:超预算判确定断线
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(false);
  });

  it('评审 P1-3:deps.connect 同步抛(IPC 桥缺失)→ 按失败推进退避,不静默僵死', async () => {
    const connect = vi.fn(() => {
      if (connect.mock.calls.length === 1) throw new Error('bridge gone');
    });
    const { controller } = (() => {
      const controller = createReconnectController({
        connect,
        disconnect: vi.fn(),
        setReconnecting: (id, on) => useRemoteHostRuntimeStore.getState().setReconnecting(id, on),
        isReconnecting: (id) => useRemoteHostRuntimeStore.getState().isReconnecting(id),
        stopSync: vi.fn(),
        readopt: vi.fn(async () => {}),
        makeBackoff: () => new ReconnectBackoff({ baseMs: 1000, capMs: 30_000, budget: 3 }),
        attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
      });
      return { controller };
    })();
    controller.onDisconnected('cfg-1');
    await vi.advanceTimersByTimeAsync(0); // 尝试1:connect 抛 → attemptFailed → 排退避 2s
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000); // 尝试2 照常发起
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('评审 P1-4(无活动狗):noteProgress 重置计时——有进展的慢编排不被误杀,停更后仍兜底', async () => {
    const { controller, connect } = makeDeps();
    controller.onDisconnected('cfg-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);

    // 每 4s 一个阶段事件(如 deploying 进度),跨过原 5s 窗口两次
    await vi.advanceTimersByTimeAsync(4_000);
    controller.noteProgress('cfg-1');
    await vi.advanceTimersByTimeAsync(4_000); // 自起点 8s > 5s——旧口径已误判
    controller.noteProgress('cfg-1');
    expect(connect).toHaveBeenCalledTimes(1); // 未被误杀

    // 事件停更 → 距最后一次 noteProgress 5s 后狗触发 → 退避 2s → 尝试2
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + 2_000);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('noteProgress 无在途尝试(编排外事件)→ 廉价 no-op,不凭空挂狗', async () => {
    const { controller, connect, stopSync } = makeDeps();
    controller.noteProgress('cfg-idle');
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS * 3);
    expect(connect).not.toHaveBeenCalled();
    expect(stopSync).not.toHaveBeenCalled();
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
