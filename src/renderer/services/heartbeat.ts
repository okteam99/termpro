// app 层心跳(BL-005 · AC-13):远程 client 周期探活,超时在有界 T 内判断线,
// 不等 TCP onclose(合盖场景可数分钟)。纯逻辑 + 注入 seam(probe / 计时器):
// 单测喂「静默不回」probe + fake timers 即可断言有界时延(QA-B-8),无需整成 integration。
//
// 判定机理:每 intervalMs 发一次 probe(host.info),给该 probe 一个 timeoutMs 窗口;
// probe 在窗口内 resolve → 存活,排下一拍;窗口内未回(挂起)或 reject → onDead(一次性)。
// 检测时延上界 T = intervalMs(首拍等待)+ timeoutMs。默认 5s+5s → T≈10s(AC-13 上界)。

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
  /** 计时器注入(默认全局 setTimeout;单测走 vi.useFakeTimers 亦可不注入)。 */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (h: TimerHandle) => void;
}

export class Heartbeat {
  private running = false;
  private intervalTimer: TimerHandle | null = null;
  private timeoutTimer: TimerHandle | null = null;
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
    this.timeoutTimer = this.setTimer(() => {
      this.timeoutTimer = null;
      if (settled || !this.running) return;
      settled = true;
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
    intervalMs: read('TERMPRO_HEARTBEAT_INTERVAL_MS', DEFAULT_HEARTBEAT.intervalMs),
    timeoutMs: read('TERMPRO_HEARTBEAT_TIMEOUT_MS', DEFAULT_HEARTBEAT.timeoutMs),
  };
}
