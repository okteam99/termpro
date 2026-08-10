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

import {
  DEFAULT_RECONNECT_ATTEMPT_TIMEOUT_MS,
  ReconnectBackoff,
  readReconnectBudgetEnv,
} from './reconnectBackoff';

type TimerHandle = ReturnType<typeof setTimeout>;

/** reconnectController 的外部依赖(全注入·单测喂 fake)。 */
export interface ReconnectControllerDeps {
  /** 触发 main 重建隧道(window.okwork.remoteHost.connect)。 */
  connect(configId: string): void;
  /**
   * disconnect-first:复位 main stage ready→disconnected(window.okwork.remoteHost.disconnectAwait)。
   * 🔴 可等待(2026-08-10 事故):返回 promise 时 fireAttempt 会 **await 它落定后才 connect**。
   * 旧版即发即忘,两条 IPC 在 main 侧竞态——上一轮编排仍在 mutex 时,disconnect 在等它,
   * connect 却先命中 connectInflight 去重原样返回陈旧 promise(不起新编排、不 emit 任何事件),
   * 随后 disconnect 醒来照拆:本轮尝试凭空蒸发(reconnecting 旗永远没人摘·「重连中」僵死);
   * 另一形:僵尸编排完成 SSH 认证后经 isCurrent 自弃 ssh.close——刚连上的连接被自己一秒枪毙。
   * 等 main 拆完(orchestrator.disconnect 内有 5s 有界等待)再 connect,陈旧 connectInflight
   * 必已清,去重不可能再命中僵尸。
   */
  disconnect(configId: string): void | Promise<void>;
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
  /**
   * 单次尝试看门狗超时(ms·env 注入·缺省 DEFAULT_RECONNECT_ATTEMPT_TIMEOUT_MS)。
   * 🔴 无活动口径(评审 P1-4):从 fireAttempt 入口起计,期间 onReconnected /
   * onAttemptFailed / cancel 任一定论撤狗,noteProgress(main 阶段事件)重置计时;
   * 窗口内**零事件零定论**才按尝试失败推进退避——main 侧任何静默路径(去重 no-op、
   * 僵尸自弃、safeEmit 吞非法转移)都不再能让状态机永久搁浅在「重连中」,而有进展的
   * 合法慢编排(部署上传等)不会被误杀(2026-08-10 事故的兜底闸)。
   */
  attemptTimeoutMs?: number;
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
   * main 有该机的阶段事件抵达(任意 stage)→ 重置在途尝试的看门狗(评审 P1-4:无活动狗
   * 口径)。目标场景(去重 no-op、僵尸自弃、safeEmit 吞非法转移)本就零事件,兜底不减;
   * 有进展的合法慢编排(部署上传进度等)不再被误杀。无在途尝试时为廉价 no-op。
   */
  noteProgress(configId: string): void;
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
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? DEFAULT_RECONNECT_ATTEMPT_TIMEOUT_MS;
  const backoffs = new Map<string, ReconnectBackoff>();
  const timers = new Map<string, TimerHandle>();
  // 单次尝试看门狗(2026-08-10 兜底闸):connect 发出 → 计时;定论(成功/失败/取消)→ 撤销。
  const watchdogs = new Map<string, TimerHandle>();
  // 尝试代际号(2026-08-10):fireAttempt 在 await disconnect 期间,编排可能被 cancel、
  // 或 manualRetry 又点起新一代尝试——旧代醒来后凭代际不符自弃,绝不补发 connect
  // (否则一次「立即重试」会变成两条并发 connect,重蹈 main 侧去重竞态)。
  const attemptGen = new Map<string, number>();

  function clearPendingTimer(configId: string): void {
    const h = timers.get(configId);
    if (h !== undefined) {
      clearTimer(h);
      timers.delete(configId);
    }
  }

  function clearWatchdog(configId: string): void {
    const h = watchdogs.get(configId);
    if (h !== undefined) {
      clearTimer(h);
      watchdogs.delete(configId);
    }
  }

  /** 挂/重挂看门狗(先撤旧再挂新——顶代/进展重置都经此,绝不双狗并存)。 */
  function armWatchdog(configId: string): void {
    clearWatchdog(configId);
    watchdogs.set(
      configId,
      setTimer(() => {
        watchdogs.delete(configId);
        attemptFailed(configId);
      }, attemptTimeoutMs),
    );
  }

  function cleanup(configId: string): void {
    clearPendingTimer(configId);
    clearWatchdog(configId);
    backoffs.delete(configId);
    attemptGen.delete(configId);
    deps.setReconnecting(configId, false);
  }

  /**
   * 发起一次重连尝试:预算未尽 → disconnect-first→connect;预算耗尽 → 确定断线 drop。
   * 🔴 串行化(2026-08-10 事故):**await disconnect 落定后才 connect**——否则两条 IPC 在
   * main 侧竞态,connect 命中陈旧 connectInflight 去重 → 本轮尝试凭空蒸发(细节见
   * deps.disconnect 注释)。等待期间编排可能被 cancel / manualRetry 顶掉,醒来后按
   * backoff 实例身份 + 代际号双重自弃,不补发 connect。
   */
  async function fireAttempt(configId: string): Promise<void> {
    const b = backoffs.get(configId);
    if (!b) return;
    if (b.overBudget()) {
      definite(configId);
      return;
    }
    b.nextDelayMs(); // 推进预算计数(本次尝试)
    const gen = (attemptGen.get(configId) ?? 0) + 1;
    attemptGen.set(configId, gen);
    // 🔴 狗在入口就挂(评审 P1-2/P1-3):覆盖 await disconnect 窗口——disconnectAwait 的 IPC
    // 若永不落定(main 异常/窗口重建)同样有兜底;顶代时新代 armWatchdog 内先撤旧狗,
    // 不给新尝试计旧账。
    armWatchdog(configId);
    // 🔴 disconnect-first:先复位 main stage 再 connect(否则 ready 态 connect no-op·隧道永不重建)
    try {
      await deps.disconnect(configId);
    } catch {
      /* main 侧拆除异常不阻断 connect(orchestrator.disconnect 已尽力收尾) */
    }
    if (backoffs.get(configId) !== b || attemptGen.get(configId) !== gen) return; // 已被 cancel/顶代/定论
    try {
      deps.connect(configId);
    } catch {
      // connect 同步抛(IPC 桥缺失等)——不能静默吞掉(void fireAttempt 的 rejection 没人接),
      // 按尝试失败推进退避,否则又是一种「重连中」僵死(评审 P1-3)。
      attemptFailed(configId);
    }
  }

  /**
   * 一次尝试的失败定论(真失败事件 / 看门狗超时共用):退避重试或超预算判死。
   * 公开方法 onAttemptFailed 委托到此。
   */
  function attemptFailed(configId: string): void {
    if (!deps.isReconnecting(configId)) return;
    const b = backoffs.get(configId);
    if (!b) return;
    clearWatchdog(configId); // 本次尝试已定论,撤销悬挂看门狗
    // 🔴 评审 P1-1:失败定论可能落在某代 fireAttempt 的 await disconnect 窗口内(main 僵尸
    // 编排 emit failed / 在途握手 reject)——bump 代际让该代醒来自弃,不再补发 connect。
    // 否则退避重试的 disconnectAwait 会把这条迟到的 connect 当僵尸拆掉:连接被反复枪毙。
    attemptGen.set(configId, (attemptGen.get(configId) ?? 0) + 1);
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
        void fireAttempt(configId);
      }, delay),
    );
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
      void fireAttempt(configId); // 立即首试(异步串行 disconnect→connect)
    },

    onAttemptFailed(configId: string): void {
      attemptFailed(configId);
    },

    onReconnected(configId: string): void {
      cleanup(configId);
      // 收养回放 + session.list 对账(横幅由 reconnecting 清除驱动消失)。
      // 🔴 由 client.reconnect() resolve 驱动 → 此刻 transport 已就绪·session.attach 不会 reject(A1)。
      // 🔴 收养恒跑,不再以 wasReconnecting 为门(2026-07-23「连着但无法输入」):cancel 后重连/
      // 编排外完成的握手同样接在「host 侧订阅已随旧连接丢失」之后,跳过收养会把存活 inst 钉死在
      // 「pty:input 被 hostCore 归属门静默丢弃」的聋哑态。真·初次连接时无 inst、无 ws 映射,
      // readopt 天然近零成本(仅多一次 session.list)。
      void deps.readopt(configId);
    },

    manualRetry(configId: string): void {
      clearPendingTimer(configId);
      // 🔴 补建守卫改按 backoff 存在性,不按 reconnecting 态(2026-08-10):两者可能分叉
      // (如 reconnecting=true 但 backoff 已被清)——旧版此态下 fireAttempt 开头 `!b return`,
      // 「立即重试」就是个完全静默的死按钮。
      const b = backoffs.get(configId);
      if (b) b.reset(); // 复位退避 + 重连预算(给足新窗口)
      else backoffs.set(configId, deps.makeBackoff());
      if (!deps.isReconnecting(configId)) deps.setReconnecting(configId, true);
      void fireAttempt(configId);
    },

    noteProgress(configId: string): void {
      if (!watchdogs.has(configId)) return; // 无在途尝试(或已定论)→ no-op
      armWatchdog(configId);
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
