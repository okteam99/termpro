// 「可能在等输入」(quiet 软标记)的提示门控 —— 纯逻辑,无 DOM / store 依赖,便于单测。
//
// 背景:host 的 quiet 软标记纯按「running && 静默≥60s」触发,不分 tab 离开后有无新内容。
// 期望(PRD TERMPRO-F260613041948-quiet-notify):后台 tab 只在「离开后产生过新输出、随后
// 停住」时才提示;离开后一直没动静的 tab 不提示。
//
// 判据(同源 renderer 时钟):per-tab 记 lastOutputAt(终端输出到达时刻)+ deactivatedAt
// (tab 从当前→后台时刻),quiet:true 到达时仅当 lastOutputAt > deactivatedAt 才算「离开后有
// 新输出」。🔴 不用「quiet 到达时刻 − 去激活时刻 ≥ QUIET_MS」的时间差推断 —— host tick(~1.5s)
// 抖动 + 传输延迟 + host/renderer 时钟不同源使该等价不健壮(评审 ARCH-1)。两个时间戳同取
// renderer Date.now(),直接比较与抖动/延迟解耦。

/** tabId → 最近一次终端输出时刻(renderer 时钟) */
const lastOutputAt = new Map<string, number>();
/** tabId → 最近一次从「当前激活」切到后台的时刻(renderer 时钟) */
const deactivatedAt = new Map<string, number>();

/** 终端有新输出时调用(前后台 tab 均触发) */
export function recordOutput(tabId: string, now: number = Date.now()): void {
  lastOutputAt.set(tabId, now);
}

/** tab 从当前激活切到后台时调用(多次切走取最近一次 = 覆盖写,AC-5) */
export function recordDeactivated(tabId: string, now: number = Date.now()): void {
  deactivatedAt.set(tabId, now);
}

/** tab 被重新激活(用户回看)或已读复位时调用:重置基线,要求下一轮重新「去激活后有新增」
 *  才会再判定为「离开后有输出」(AC-4)。tab 关闭时同样调用以清理 Map,防泄漏。 */
export function resetTabActivity(tabId: string): void {
  lastOutputAt.delete(tabId);
  deactivatedAt.delete(tabId);
}

/** 离开(去激活)后是否产生过新输出。
 *  - 无 deactivatedAt(从未激活 / 已重置)→ false(视为无离开后输出,AC-1)
 *  - lastOutputAt > deactivatedAt → 离开后确有新输出 → true(AC-2) */
export function hadOutputSinceLeave(tabId: string): boolean {
  const d = deactivatedAt.get(tabId);
  if (d === undefined) return false;
  const o = lastOutputAt.get(tabId);
  return o !== undefined && o > d;
}

export interface QuietDecisionInput {
  /** 窗口聚焦且是当前 tab */
  focusedTab: boolean;
  /** 激活工作区的激活 tab(失焦时即「最后打开的」) */
  isCurrentTab: boolean;
  /** 会话当前处于 running */
  running: boolean;
  /** 离开后是否有过新输出(= hadOutputSinceLeave) */
  hadOutputSinceLeave: boolean;
  /** 本注意力周期内是否已通知过(waitingNotified 闩锁) */
  alreadyNotified: boolean;
}

export interface QuietDecision {
  /** 是否点亮 waiting 注意力标记(状态点 / 角标) */
  setWaiting: boolean;
  /** 是否推一条通知(进通知中心) */
  pushNotification: boolean;
}

/** quiet:true 到达时的打扰决策(纯函数 · 编码 AC-1/AC-2/AC-3 策略)。 */
export function decideQuietAction(i: QuietDecisionInput): QuietDecision {
  // 聚焦中的 tab / 非运行态:不打扰
  if (i.focusedTab || !i.running) return { setWaiting: false, pushNotification: false };
  // 当前(激活)tab:沿用现有 —— 只亮 waiting 状态点,不进通知(AC-3 行为不变)
  if (i.isCurrentTab) return { setWaiting: true, pushNotification: false };
  // 后台 tab:仅当「离开后有新输出再停住」才提示(AC-1 抑制 / AC-2 提示 + 闩锁)
  if (!i.hadOutputSinceLeave) return { setWaiting: false, pushNotification: false };
  return { setWaiting: true, pushNotification: !i.alreadyNotified };
}

/** 清理已关闭 tab 的记录(liveTabIds 之外的全删),防 Map 缓慢泄漏 */
export function pruneClosedTabs(liveTabIds: Set<string>): void {
  for (const id of [...lastOutputAt.keys()]) {
    if (!liveTabIds.has(id)) lastOutputAt.delete(id);
  }
  for (const id of [...deactivatedAt.keys()]) {
    if (!liveTabIds.has(id)) deactivatedAt.delete(id);
  }
}

/** 仅供单测:清空所有 per-tab 活动记录 */
export function __resetAllForTest(): void {
  lastOutputAt.clear();
  deactivatedAt.clear();
}
