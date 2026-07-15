// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillStatusResult } from '../../../shared/protocol';

// jsdom 的 localStorage 缺 clear:用 Map 后备的完整 polyfill
const _ls = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (_ls.has(k) ? _ls.get(k)! : null),
  setItem: (k: string, v: string) => void _ls.set(k, String(v)),
  removeItem: (k: string) => void _ls.delete(k),
  clear: () => _ls.clear(),
});
import {
  computeSkillPromptAction,
  isSkillPromptSnoozed,
  snoozeSkillPrompt,
  SKILL_SNOOZE_MS,
} from '../okworkSkillPrompt';

const V = 'v1.0.0';
const loc = (present: boolean, version: string | null) => ({ present, version });
const st = (
  claude: { present: boolean; version: string | null },
  codex: { present: boolean; version: string | null },
  shared: { present: boolean; version: string | null },
  duplicate = false,
): SkillStatusResult => ({ claude, codex, shared, duplicate });

describe('computeSkillPromptAction', () => {
  it('无 agent 环境 → null(不相关)', () => {
    expect(computeSkillPromptAction(st(loc(false, null), loc(false, null), loc(false, null)), V)).toBeNull();
  });

  it('有 agent 但缺技能 → install', () => {
    expect(computeSkillPromptAction(st(loc(true, null), loc(false, null), loc(false, null)), V)).toBe('install');
  });

  it('装了但版本旧 → update', () => {
    expect(computeSkillPromptAction(st(loc(true, 'v0.9.0'), loc(false, null), loc(false, null)), V)).toBe('update');
  });

  it('全是最新 → null', () => {
    expect(computeSkillPromptAction(st(loc(true, V), loc(true, V), loc(true, V)), V)).toBeNull();
  });

  it('装的比打包版本【更新】→ null(不降级覆盖 · 评审 P3)', () => {
    expect(computeSkillPromptAction(st(loc(true, 'v2.0.0'), loc(false, null), loc(false, null)), V)).toBeNull();
  });

  it('duplicate=true(codex 重复安装)→ update(触发重装去重),即便版本已是最新', () => {
    expect(
      computeSkillPromptAction(st(loc(false, null), loc(true, V), loc(true, V), true), V),
    ).toBe('update');
  });

  it('一个 agent 最新、另一个缺 → install(存在的目标里有缺的即 install)', () => {
    expect(computeSkillPromptAction(st(loc(true, V), loc(true, null), loc(true, V)), V)).toBe('install');
  });

  it('无 claude/codex 但共享目录在且缺 → install(回落共享)', () => {
    expect(computeSkillPromptAction(st(loc(false, null), loc(false, null), loc(true, null)), V)).toBe('install');
  });
});

describe('snooze(24h,按机器)', () => {
  beforeEach(() => localStorage.clear());

  it('未 snooze → false;snooze 后 24h 内 → true;超 24h → false', () => {
    const t0 = 1_000_000_000_000;
    expect(isSkillPromptSnoozed('h1', t0)).toBe(false);
    snoozeSkillPrompt('h1', t0);
    expect(isSkillPromptSnoozed('h1', t0 + 1000)).toBe(true);
    expect(isSkillPromptSnoozed('h1', t0 + SKILL_SNOOZE_MS - 1)).toBe(true);
    expect(isSkillPromptSnoozed('h1', t0 + SKILL_SNOOZE_MS + 1)).toBe(false);
  });

  it('按机器隔离', () => {
    const t0 = 2_000_000_000_000;
    snoozeSkillPrompt('hA', t0);
    expect(isSkillPromptSnoozed('hA', t0 + 1)).toBe(true);
    expect(isSkillPromptSnoozed('hB', t0 + 1)).toBe(false);
  });
});
