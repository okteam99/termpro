// 断线重连编排单源(BL-005 · CR-1/ARCH-B-1)。职责:
// 心跳/断线判定 → 🔴 同步先占 reconnecting 态 → disconnect-first(disconnect→connect·复位 main
// stage ready→disconnected·否则 connect() 在 ready 是 no-op·隧道永不重建)→ 收 verifying{tunnel}
// 由 Sidebar.beginHandshake 走 client.reconnect(单一 owner)→ 🔴 **reconnect promise resolve**
// (ws 真 open 后)驱动 onReconnected:readoptHost 收养 + session.list 对账 + 清 reconnecting;失败退避;
// 超预算 → 亲自 stopRemoteWorkspaceSync(drop 唯一出口·D-13)。
//
// 🔴 A1(review-fix):readopt **不能**由 main 的 `ready` stage 事件驱动——claim 快路径 main 同步连发
// verifying+ready·两条 IPC 早于 beginHandshake 的新 ws 打开(onopen 需一次隧道 RTT)入队·此刻
// transport=null → session.attach 同步 reject → 收养静默中止 → 终端冻结。故 onReconnected 唯一调用方 =
// beginHandshake 的 `client.reconnect().then`(保证 transport 就绪)·main 'ready' 事件不再触发收养。
//
// 🔴 自发 disconnected 再入守卫(CR-1 ③):disconnect-first 会让 main 自发广播 disconnected;
//   已 reconnecting 则直接忽略(防 loop)。
// 本文件只依赖 reconnectBackoff + 注入 deps(不 import terminalRegistry/remoteWorkspaceSync/window)——
// 编排逻辑纯可测;默认实例的真实接线由调用方(Sidebar/app 入口)注入。

import { ReconnectBackoff, readReconnectBudgetEnv } from './reconnectBackoff';

type TimerHandle = ReturnType<typeof setTimeout>;

/** reconnectController 的外部依赖(全注入·单测喂 fake)。 */
export interface ReconnectControllerDeps {
  /** 触发 main 重建隧道(window.termpro.remoteHost.connect)。 */
  connect(configId: string): void;
  /** disconnect-first:复位 main stage ready→disconnected(window.termpro.remoteHost.disconnect)。 */
  disconnect(configId: string): void;
  /** 同步置/清 reconnecting 态(remoteHostStore.setReconnecting)。 */
  setReconnecting(configId: string, on: boolean): void;
  /** 查询 reconnecting 态(remoteHostStore.isReconnecting)。 */
  isReconnecting(configId: string): boolean;
  /** drop 唯一出口(确定断线):stopRemoteWorkspaceSync。 */
  stopSync(configId: string): void;
  /** 握手成功后收养回放对账(terminalRegistry.readoptHost)。 */
  readopt(configId: string): Promise<void>;
  /** 每次重连编排新建一个退避计数器(env 注入·单测控 budget)。 */
  makeBackoff(): ReconnectBackoff;
  setTimer?(fn: () => void, ms: number): TimerHandle;
  clearTimer?(h: TimerHandle): void;
}

export interface ReconnectController {
  /** 断线判定入口(心跳判死 / main disconnected)。已 reconnecting → 再入守卫忽略(CR-1 ③)。 */
  onDisconnected(configId: string): void;
  /** 一次重连尝试失败(main emit failed / 握手 catch)→ 退避重试或超预算判定。 */
  onAttemptFailed(configId: string): void;
  /**
   * 握手成功(client.reconnect() 的 promise resolve·🔴 ws 真 open 后)→ readopt 收养 + 清 reconnecting
   * (仅当之前在 reconnecting;初次连接 wasReconnecting=false 为廉价 no-op)。
   * 命名从 onReady 改为 onReconnected 以钉死语义:由 **reconnect 完成**而非 main stage 事件驱动(A1)。
   */
  onReconnected(configId: string): void;
  /** 用户「立即重试」:复位退避 + 立即再试一次。 */
  manualRetry(configId: string): void;
  /**
   * 用户主动断开:终止在途重连编排(清退避计数/悬挂计时器/reconnecting 态),之后
   * 不再有任何重试拉起——保持断开。不走 drop 出口(stopSync 由断开 UI 流程/Sidebar 折叠自理)。
   * 未在编排时为廉价 no-op。
   */
  cancel(configId: string): void;
  /** 当前是否正编排该 configId 的重连(测试/调用方查询)。 */
  isActive(configId: string): boolean;
}

export function createReconnectController(
  deps: ReconnectControllerDeps,
): ReconnectController {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));
  const backoffs = new Map<string, ReconnectBackoff>();
  const timers = new Map<string, TimerHandle>();

  function clearPendingTimer(configId: string): void {
    const h = timers.get(configId);
    if (h !== undefined) {
      clearTimer(h);
      timers.delete(configId);
    }
  }

  function cleanup(configId: string): void {
    clearPendingTimer(configId);
    backoffs.delete(configId);
    deps.setReconnecting(configId, false);
  }

  /** 发起一次重连尝试:预算未尽 → disconnect-first→connect;预算耗尽 → 确定断线 drop。 */
  function fireAttempt(configId: string): void {
    const b = backoffs.get(configId);
    if (!b) return;
    if (b.overBudget()) {
      definite(configId);
      return;
    }
    b.nextDelayMs(); // 推进预算计数(本次尝试)
    // 🔴 disconnect-first:先复位 main stage 再 connect(否则 ready 态 connect no-op·隧道永不重建)
    deps.disconnect(configId);
    deps.connect(configId);
  }

  function definite(configId: string): void {
    cleanup(configId);
    deps.stopSync(configId); // drop 唯一出口(BL-004 full drop)
  }

  return {
    onDisconnected(configId: string): void {
      // 🔴 再入守卫(CR-1 ③):disconnect-first 自发 disconnected / 重复事件 → 忽略防 loop
      if (deps.isReconnecting(configId)) return;
      // 🔴 同步先占 reconnecting 态(CR-1 ①·必须在 disconnect-first 之前·Sidebar drop 计时器据此 gate)
      deps.setReconnecting(configId, true);
      backoffs.set(configId, deps.makeBackoff());
      fireAttempt(configId); // 立即首试
    },

    onAttemptFailed(configId: string): void {
      if (!deps.isReconnecting(configId)) return;
      const b = backoffs.get(configId);
      if (!b) return;
      if (b.overBudget()) {
        definite(configId);
        return;
      }
      // 退避后重试(下次间隔 = 当前 attempt 的退避·fireAttempt 内再推进计数)
      clearPendingTimer(configId);
      const delay = b.peekDelayMs();
      timers.set(
        configId,
        setTimer(() => {
          timers.delete(configId);
          fireAttempt(configId);
        }, delay),
      );
    },

    onReconnected(configId: string): void {
      const wasReconnecting = deps.isReconnecting(configId);
      cleanup(configId);
      if (wasReconnecting) {
        // 收养回放 + session.list 对账(横幅由 reconnecting 清除驱动消失)。
        // 🔴 由 client.reconnect() resolve 驱动 → 此刻 transport 已就绪·session.attach 不会 reject(A1)。
        void deps.readopt(configId);
      }
    },

    manualRetry(configId: string): void {
      const b = backoffs.get(configId);
      if (b) b.reset(); // 复位退避 + 重连预算(给足新窗口)
      clearPendingTimer(configId);
      // 若之前未在编排(如已确定断线用户点重连),补建退避 + 先占态
      if (!deps.isReconnecting(configId)) {
        deps.setReconnecting(configId, true);
        backoffs.set(configId, deps.makeBackoff());
      }
      fireAttempt(configId);
    },

    cancel(configId: string): void {
      cleanup(configId);
    },

    isActive(configId: string): boolean {
      return backoffs.has(configId);
    },
  };
}

/**
 * Sidebar 900ms drop 计时器的 gate 版本(CR-1 ②):reconnecting 期**不启动** drop 倒计时
 * (改显「重连中」panel)。返回 timer handle,或被 gate 掉返回 null。drop 的唯一出口移到
 * reconnectController 的超预算分支——本函数只负责「非 reconnecting 的确定断线才排 900ms 折叠」。
 */
export function scheduleDropUnlessReconnecting(
  configId: string,
  deps: {
    isReconnecting(configId: string): boolean;
    stopSync(configId: string): void;
    delayMs: number;
    setTimer?(fn: () => void, ms: number): TimerHandle;
  },
): TimerHandle | null {
  if (deps.isReconnecting(configId)) return null; // gate:重连中不 drop(抑制 AC-15 full drop)
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  return setTimer(() => deps.stopSync(configId), deps.delayMs);
}

/** 默认退避工厂(env 注入)。 */
export function defaultBackoffFactory(): ReconnectBackoff {
  return new ReconnectBackoff(readReconnectBudgetEnv());
}
