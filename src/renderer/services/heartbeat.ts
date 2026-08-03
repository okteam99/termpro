// app 层心跳(BL-005 · AC-13):远程 client 周期探活,超时在有界 T 内判断线,
// 不等 TCP onclose(合盖场景可数分钟)。纯逻辑 + 注入 seam(probe / 计时器):
// 单测喂「静默不回」probe + fake timers 即可断言有界时延(QA-B-8),无需整成 integration。
//
// 判定机理:每 intervalMs 发一次 probe(host.info),给该 probe 一个 timeoutMs 窗口;
// probe 在窗口内 resolve → 存活,排下一拍;reject(传输错误)→ onDead(一次性)。
// 窗口内未回(挂起)时分两类:
//   · 窗口内有任何入站流量(notifyActivity)→ 链路在投递字节,只是拥塞——probe 响应
//     与 pty 批量输出共享同一条 WS/SSH 隧道(FIFO 无优先级),agent 大输出/跨境高峰
//     可把它挤到 5s 之外(2026-08「liam 总掉线」根因)。放弃本拍、排下一拍继续观察,
//     不判死——误判的代价是拆掉健康 SSH 连接全量重建,回放洪峰又挤死下一拍,反复闪断。
//   · 真·静默(窗口内零入站)→ onDead。
// 真死(冻结 TCP)从无入站流量,检测时延上界不变:T = intervalMs + timeoutMs,
// 默认 5s+5s → T≈10s(AC-13 上界)。持续拥塞只要仍有字节到达就不判死(链路确实可用)。

export interface HeartbeatConfig {
  /** 相邻两次探活的间隔(ms)。默认 5000。 */
  intervalMs: number;
  /** 单次探活的等待窗口(ms),超此判死。默认 5000。 */
  timeoutMs: number;
}

export const DEFAULT_HEARTBEAT: HeartbeatConfig = {
  intervalMs: 5000,
  timeoutMs: 5000,
};

type TimerHandle = ReturnType<typeof setTimeout>;

export interface HeartbeatDeps {
  /** 探活:通常 = () => client.rpc('host.info'). 挂起(不 settle)视为传输冻结。 */
  probe: () => Promise<unknown>;
  /** 判定断线回调(一次性,判死即触发)。 */
  onDead: () => void;
  /** 每次探活成功回调,携带该次 probe 往返耗时(ms)——组头连接延迟展示的数据源。 */
  onAlive?: (rttMs: number) => void;
  /** 计时器注入(默认全局 setTimeout;单测走 vi.useFakeTimers 亦可不注入)。 */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (h: TimerHandle) => void;
}

export class Heartbeat {
  private running = false;
  private intervalTimer: TimerHandle | null = null;
  private timeoutTimer: TimerHandle | null = null;
  /** 最近一次入站流量时刻(0=从未);仅与本拍 probe 起点比较,陈旧活动不算存活证明 */
  private lastActivityAt = 0;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (h: TimerHandle) => void;

  constructor(
    private readonly cfg: HeartbeatConfig,
    private readonly deps: HeartbeatDeps,
  ) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  /**
   * 任何入站消息都算存活证明(pty:data/rpc:res/事件……,hostClient.handle 逐条上报):
   * probe 挂起但窗口内有流量 → 拥塞非死链,本拍放弃不判死(见文件头「判定机理」)。
   */
  notifyActivity(): void {
    this.lastActivityAt = Date.now();
  }

  stop(): void {
    this.running = false;
    if (this.intervalTimer !== null) {
      this.clearTimer(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.timeoutTimer !== null) {
      this.clearTimer(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private scheduleNext(): void {
    this.intervalTimer = this.setTimer(() => {
      this.intervalTimer = null;
      void this.beat();
    }, this.cfg.intervalMs);
  }

  private async beat(): Promise<void> {
    if (!this.running) return;
    let settled = false;
    const startedAt = Date.now();
    this.timeoutTimer = this.setTimer(() => {
      this.timeoutTimer = null;
      if (settled || !this.running) return;
      settled = true;
      // 窗口内有入站流量 → 拥塞非死链:放弃本拍(迟到落定被 settled 闸吞),排下一拍
      // 继续观察;probe 挂起 + 真·静默才判死。陈旧活动(< startedAt)不算。
      if (this.lastActivityAt >= startedAt) {
        this.scheduleNext();
        return;
      }
      this.die();
    }, this.cfg.timeoutMs);
    try {
      await this.deps.probe();
      if (settled || !this.running) return;
      settled = true;
      if (this.timeoutTimer !== null) {
        this.clearTimer(this.timeoutTimer);
        this.timeoutTimer = null;
      }
      this.deps.onAlive?.(Date.now() - startedAt);
      this.scheduleNext();
    } catch {
      // probe 抛错(传输错误/rpc 超时)同样判死
      if (settled || !this.running) return;
      settled = true;
      if (this.timeoutTimer !== null) {
        this.clearTimer(this.timeoutTimer);
        this.timeoutTimer = null;
      }
      this.die();
    }
  }

  private die(): void {
    this.stop();
    this.deps.onDead();
  }
}

/** dev/env 读取心跳周期/超时(裸名走 process.env,VITE_ 走 import.meta.env),缺失用默认。 */
export function readHeartbeatEnv(): HeartbeatConfig {
  const read = (key: string, fallback: number): number => {
    let raw: string | undefined;
    try {
      const env = (import.meta as unknown as { env?: Record<string, string> }).env;
      raw = env?.[key];
    } catch {
      /* import.meta 不可用 */
    }
    if (raw === undefined && typeof process !== 'undefined') raw = process.env?.[key];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    intervalMs: read('OKWORK_HEARTBEAT_INTERVAL_MS', DEFAULT_HEARTBEAT.intervalMs),
    timeoutMs: read('OKWORK_HEARTBEAT_TIMEOUT_MS', DEFAULT_HEARTBEAT.timeoutMs),
  };
}
