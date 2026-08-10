// @vitest-environment jsdom
// 2026-08-10 事故回归:fireAttempt 的 disconnect→connect 必须**串行**(await disconnect 落定
// 才 connect),否则两条 IPC 在 main 侧竞态——connect 命中陈旧 connectInflight 去重原样返回
// 僵尸 promise,本轮尝试凭空蒸发(「Reconnecting…」僵死);或僵尸编排完成认证后 isCurrent
// 自弃 ssh.close,刚连上的连接被自己一秒枪毙(服务器日志 04:02:51 Accepted → :52 code 11)。
// 另覆盖:await 期间 cancel / manualRetry 顶代 → 旧代自弃不补发 connect;manualRetry 在
// reconnecting=true 但 backoff 缺失时补建(死按钮回归)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReconnectController } from '../reconnectController';
import { ReconnectBackoff } from '../reconnectBackoff';
import { useRemoteHostRuntimeStore } from '../../state/remoteHostStore';

beforeEach(() => {
  vi.useFakeTimers();
  useRemoteHostRuntimeStore.setState({ runtime: {}, reconnecting: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** disconnect 返回可手控 promise 的 deps(模拟 disconnectAwait 的真实等待窗口)。 */
function makeAsyncDeps() {
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
    makeBackoff: () => new ReconnectBackoff({ baseMs: 1000, capMs: 30_000, budget: 3 }),
  });
  return { controller, connect, disconnect, stopSync, resolvers };
}

describe('reconnect_attempt_serializes_disconnect_before_connect', () => {
  it('disconnect 未落定 → connect 绝不先发;落定后恰好一发', async () => {
    const { controller, connect, disconnect, resolvers } = makeAsyncDeps();
    controller.onDisconnected('cfg-1');
    expect(disconnect).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(connect).not.toHaveBeenCalled(); // 串行:必须等 disconnect resolve

    resolvers[0]!();
    await flushMicrotasks();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('await disconnect 期间 cancel(用户断开)→ 醒来自弃,不补发 connect(保持断开)', async () => {
    const { controller, connect, resolvers } = makeAsyncDeps();
    controller.onDisconnected('cfg-1');
    controller.cancel('cfg-1'); // disconnect 在途时用户点断开

    resolvers[0]!();
    await flushMicrotasks();
    expect(connect).not.toHaveBeenCalled();
    expect(useRemoteHostRuntimeStore.getState().isReconnecting('cfg-1')).toBe(false);
  });

  it('await disconnect 期间 manualRetry 顶代 → 旧代自弃,connect 只发一次(新代的)', async () => {
    const { controller, connect, disconnect, resolvers } = makeAsyncDeps();
    controller.onDisconnected('cfg-1'); // 代 1:disconnect 在途
    controller.manualRetry('cfg-1'); // 代 2:又一发 disconnect
    expect(disconnect).toHaveBeenCalledTimes(2);

    resolvers[0]!(); // 代 1 的 disconnect 落定 → 代际不符自弃
    await flushMicrotasks();
    expect(connect).not.toHaveBeenCalled();

    resolvers[1]!(); // 代 2 的 disconnect 落定 → 唯一的 connect
    await flushMicrotasks();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('disconnect reject(main 侧异常)不阻断 connect(尽力而为)', async () => {
    const connect = vi.fn();
    const { controller } = (() => {
      const controller = createReconnectController({
        connect,
        disconnect: () => Promise.reject(new Error('ipc boom')),
        setReconnecting: (id, on) => useRemoteHostRuntimeStore.getState().setReconnecting(id, on),
        isReconnecting: (id) => useRemoteHostRuntimeStore.getState().isReconnecting(id),
        stopSync: vi.fn(),
        readopt: vi.fn(async () => {}),
        makeBackoff: () => new ReconnectBackoff({ baseMs: 1000, capMs: 30_000, budget: 3 }),
      });
      return { controller };
    })();
    controller.onDisconnected('cfg-1');
    await flushMicrotasks();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('manualRetry:reconnecting=true 但 backoff 缺失(状态分叉)→ 补建后照常发起(死按钮回归)', async () => {
    const { controller, connect, disconnect, resolvers } = makeAsyncDeps();
    // 直接置 reconnecting=true、不建 backoff,模拟分叉态
    useRemoteHostRuntimeStore.getState().setReconnecting('cfg-1', true);
    expect(controller.isActive('cfg-1')).toBe(false);

    controller.manualRetry('cfg-1');
    expect(disconnect).toHaveBeenCalledTimes(1); // 旧版此处静默 return——死按钮
    resolvers[0]!();
    await flushMicrotasks();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(controller.isActive('cfg-1')).toBe(true);
  });
});
