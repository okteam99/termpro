// renderer 崩溃自愈决策(黑屏事故 2026-07-14):renderer 进程死掉后 Electron 不会自行
// 重载窗口,不处理就是永久黑屏(窗口壳还在,内容进程没了)。纯决策模块(零 Electron
// import)供 main 接线;限频防 crash-reload 风暴(启动即崩的 renderer 会无限循环)。

export interface RenderProcessGoneDetails {
  reason: string;
  exitCode?: number;
}

export type RecoveryDecision = 'reload' | 'ignore' | 'give-up';

/** 主动退出类:clean-exit=正常退出(导航/关窗);killed=用户/系统显式杀
 *  (活动监视器/kill)——都不是事故,自动复活反而违背操作意图。 */
const NO_RELOAD_REASONS = new Set(['clean-exit', 'killed']);

/**
 * 创建自愈决策器:非主动退出 → 'reload';时间窗内重载次数耗尽 → 'give-up'
 * (停手留给用户 ⌘R,窗口壳与日志都在);主动退出 → 'ignore'。
 * 决策器 per-window 持有(窗口重建即重置计数)。
 */
export function createRendererRecovery(opts?: {
  maxReloads?: number;
  windowMs?: number;
  now?: () => number;
}) {
  const maxReloads = opts?.maxReloads ?? 3;
  const windowMs = opts?.windowMs ?? 5 * 60_000;
  const now = opts?.now ?? Date.now;
  let reloadTimes: number[] = [];

  return {
    decide(details: RenderProcessGoneDetails): RecoveryDecision {
      if (NO_RELOAD_REASONS.has(details.reason)) return 'ignore';
      const t = now();
      reloadTimes = reloadTimes.filter((x) => t - x < windowMs);
      if (reloadTimes.length >= maxReloads) return 'give-up';
      reloadTimes.push(t);
      return 'reload';
    },
  };
}
