// okwork 技能横条的探测决策 + 24h snooze(纯逻辑,便于单测)。
// 由 host 的 skill.status 结果 + app 打包版本算出横条动作;× 关闭按机器 snooze 24h。
import type { SkillStatusResult } from '../../shared/protocol';

export const SKILL_SNOOZE_MS = 24 * 60 * 60 * 1000;

const snoozeKey = (hostId: string) => `okwork-skill-snooze:${hostId}`;

/**
 * 横条动作:'install'(有 agent 环境但缺技能)| 'update'(装了但版本旧)| null(不相关/最新)。
 * 相关性 = 存在 claude/codex(否则回落看共享 ~/.agents)。只要有一个【存在的目标】缺技能
 * → install;都装了但有旧的 → update;全是最新 → null。
 */
export function computeSkillPromptAction(
  status: SkillStatusResult,
  bundledVersion: string,
): 'install' | 'update' | null {
  const targets: (string | null)[] = [];
  if (status.claude.present) targets.push(status.claude.version);
  if (status.codex.present) targets.push(status.codex.version);
  if (targets.length === 0 && status.shared.present) targets.push(status.shared.version);
  if (targets.length === 0) return null; // 无 agent 环境 → 与本 session 无关,不提示
  if (targets.some((v) => v === null)) return 'install';
  if (targets.some((v) => v !== bundledVersion)) return 'update';
  return null;
}

/** 该机器上横条是否在 24h snooze 内(× 关闭后记时长)。 */
export function isSkillPromptSnoozed(hostId: string, now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(snoozeKey(hostId));
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now - at < SKILL_SNOOZE_MS;
  } catch {
    return false;
  }
}

/** × 关闭:记录 snooze 起点(按机器)。 */
export function snoozeSkillPrompt(hostId: string, now: number = Date.now()): void {
  try {
    localStorage.setItem(snoozeKey(hostId), String(now));
  } catch {
    /* localStorage 不可用则不 snooze(顶多下次再显示,不致命) */
  }
}
