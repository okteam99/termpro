// renderer 崩溃自愈决策(黑屏事故 2026-07-14 · 阶段D):
// ① 事故类 reason(crashed/oom/abnormal-exit/launch-failed)→ reload;
// ② 主动退出(clean-exit/killed)→ ignore(不违背导航/显式杀的操作意图);
// ③ 时间窗内限次防 crash-reload 风暴,窗口滑出后配额恢复。

import { describe, expect, it } from 'vitest';
import { createRendererRecovery } from '../rendererRecovery';

describe('createRendererRecovery', () => {
  it('事故类 reason → reload;主动退出 → ignore', () => {
    const r = createRendererRecovery();
    expect(r.decide({ reason: 'crashed', exitCode: 5 })).toBe('reload');
    expect(r.decide({ reason: 'oom' })).toBe('reload');
    expect(r.decide({ reason: 'abnormal-exit', exitCode: 1 })).toBe('reload');
    expect(r.decide({ reason: 'clean-exit', exitCode: 0 })).toBe('ignore');
    expect(r.decide({ reason: 'killed' })).toBe('ignore');
  });

  it('时间窗内超上限 → give-up(防崩溃循环);ignore 不占配额', () => {
    let t = 0;
    const r = createRendererRecovery({ maxReloads: 3, windowMs: 300_000, now: () => t });
    expect(r.decide({ reason: 'crashed' })).toBe('reload');
    expect(r.decide({ reason: 'clean-exit' })).toBe('ignore'); // 不占配额
    t += 1000;
    expect(r.decide({ reason: 'crashed' })).toBe('reload');
    t += 1000;
    expect(r.decide({ reason: 'oom' })).toBe('reload');
    t += 1000;
    expect(r.decide({ reason: 'crashed' })).toBe('give-up');
  });

  it('时间窗滑出后配额恢复(长会话偶发崩溃不该被历史记录永久拒载)', () => {
    let t = 0;
    const r = createRendererRecovery({ maxReloads: 2, windowMs: 10_000, now: () => t });
    expect(r.decide({ reason: 'crashed' })).toBe('reload');
    expect(r.decide({ reason: 'crashed' })).toBe('reload');
    expect(r.decide({ reason: 'crashed' })).toBe('give-up');
    t = 20_000; // 全部滑出窗口
    expect(r.decide({ reason: 'crashed' })).toBe('reload');
  });
});
