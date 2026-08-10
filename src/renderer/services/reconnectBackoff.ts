// 断线重连退避策略(BL-005 · AC-6 · 纯逻辑 · 构造注入 · 免挂钟)。
// 职责单一:算「第 n 次重连该等多久」+「是否已超预算判确定断线」。不碰传输/计时器/store——
// 由 reconnectController 编排它。全部参数经构造注入(env 读取抽 readReconnectBudgetEnv),
// 单测直接喂配置断言,不等真实 30s/2min(QA-B-10)。

/** 退避 + 重连预算配置(env 可注入)。 */
export interface ReconnectBudgetConfig {
  /** 首次退避间隔(ms)。默认 1000。 */
  baseMs: number;
  /** 退避间隔上限(ms)。默认 30000。 */
  capMs: number;
  /** 重连预算:尝试达此次数仍失败 → 判「确定断线」→ 走 BL-004 full drop。默认 8。 */
  budget: number;
}

export const DEFAULT_RECONNECT_BUDGET: ReconnectBudgetConfig = {
  baseMs: 1000,
  capMs: 30_000,
  budget: 8,
};

/**
 * 指数退避 + 重连预算计数器。attempt 从 0 起:
 * - `nextDelayMs()` 返回「本次尝试前该等待的间隔」= min(base×2^attempt, cap),并把 attempt +1。
 * - `reset()` 手动「立即重试」复位计数(退避与预算都归零)。
 * - `overBudget()` = 已尝试次数 ≥ budget(判确定断线)。
 */
export class ReconnectBackoff {
  private attempt = 0;

  constructor(private readonly cfg: ReconnectBudgetConfig = DEFAULT_RECONNECT_BUDGET) {}

  /** 已发生的重连尝试次数(横幅「第 n 次」呈现 = attempts)。 */
  get attempts(): number {
    return this.attempt;
  }

  /** 不推进计数,仅预览「下一次会等多久」(横幅「Xs 后重试」呈现用)。 */
  peekDelayMs(): number {
    return Math.min(this.cfg.baseMs * 2 ** this.attempt, this.cfg.capMs);
  }

  /** 取本次尝试的退避间隔并推进计数(base×2^n 增长,cap 封顶)。 */
  nextDelayMs(): number {
    const delay = this.peekDelayMs();
    this.attempt += 1;
    return delay;
  }

  /** 手动「立即重试」:复位退避与预算计数(下次从 base 起,预算重新计)。 */
  reset(): void {
    this.attempt = 0;
  }

  /** 是否已超重连预算(尝试次数 ≥ budget)→ 判确定断线。 */
  overBudget(): boolean {
    return this.attempt >= this.cfg.budget;
  }
}

/** dev/env 读取一个数值(import.meta.env 优先,回退 process.env),缺失/非法用 fallback。 */
function readNumEnv(key: string, fallback: number): number {
  let raw: string | undefined;
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    raw = env?.[key];
  } catch {
    /* import.meta 不可用(某些运行时) */
  }
  if (raw === undefined && typeof process !== 'undefined') {
    raw = process.env?.[key];
  }
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 从 env 读退避/预算配置(VITE_ 前缀走 import.meta.env,裸名走 process.env)。 */
export function readReconnectBudgetEnv(): ReconnectBudgetConfig {
  return {
    baseMs: readNumEnv('OKWORK_RECONNECT_BASE_MS', DEFAULT_RECONNECT_BUDGET.baseMs),
    capMs: readNumEnv('OKWORK_RECONNECT_CAP_MS', DEFAULT_RECONNECT_BUDGET.capMs),
    budget: readNumEnv('OKWORK_RECONNECT_BUDGET', DEFAULT_RECONNECT_BUDGET.budget),
  };
}

/** 单次重连尝试看门狗超时(2026-08-10)。默认 90s:正常重连(claim 快路径)十几秒内定论,
 *  ssh 10s + 单 exec 30s 的合法慢路径也覆盖;90s 仍无任何定论只可能是 main 侧静默搁浅。 */
export const DEFAULT_RECONNECT_ATTEMPT_TIMEOUT_MS = 90_000;

/** 从 env 读单次尝试看门狗超时(测试/调优免等真实 90s)。 */
export function readReconnectAttemptTimeoutEnv(): number {
  return readNumEnv(
    'OKWORK_RECONNECT_ATTEMPT_TIMEOUT_MS',
    DEFAULT_RECONNECT_ATTEMPT_TIMEOUT_MS,
  );
}
