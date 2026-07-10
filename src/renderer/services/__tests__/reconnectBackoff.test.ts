// BL-005 · AC-6(T-013/T-014):断线重连退避策略纯逻辑单测。
// 指数退避 base×2^n(cap 封顶)+ 手动重试复位 + 超预算判定确定断线。全构造注入,免挂钟。
import { describe, expect, it } from 'vitest';
import { ReconnectBackoff, type ReconnectBudgetConfig } from '../reconnectBackoff';

const CFG: ReconnectBudgetConfig = { baseMs: 1000, capMs: 30_000, budget: 8 };

describe('exponential_backoff_auto_reconnect_and_manual_retry_resets (T-013)', () => {
  it('退避间隔按 base×2^n 增长并被 cap 封顶', () => {
    const b = new ReconnectBackoff(CFG);
    // 第 0..7 次:1s,2s,4s,8s,16s,32s→cap30s,30s,30s
    expect(b.nextDelayMs()).toBe(1000);
    expect(b.nextDelayMs()).toBe(2000);
    expect(b.nextDelayMs()).toBe(4000);
    expect(b.nextDelayMs()).toBe(8000);
    expect(b.nextDelayMs()).toBe(16_000);
    expect(b.nextDelayMs()).toBe(30_000); // 32s 被 cap 到 30s
    expect(b.nextDelayMs()).toBe(30_000);
    expect(b.nextDelayMs()).toBe(30_000);
  });

  it('attempts 计数随 nextDelayMs 推进(横幅「第 n 次」源)', () => {
    const b = new ReconnectBackoff(CFG);
    expect(b.attempts).toBe(0);
    b.nextDelayMs();
    b.nextDelayMs();
    expect(b.attempts).toBe(2);
  });

  it('peekDelayMs 预览下一次间隔但不推进计数', () => {
    const b = new ReconnectBackoff(CFG);
    b.nextDelayMs(); // attempt→1
    expect(b.peekDelayMs()).toBe(2000);
    expect(b.attempts).toBe(1); // peek 不推进
  });

  it('手动「立即重试」reset 复位退避计数,下次从 base 起', () => {
    const b = new ReconnectBackoff(CFG);
    b.nextDelayMs();
    b.nextDelayMs();
    b.nextDelayMs();
    expect(b.attempts).toBe(3);
    b.reset();
    expect(b.attempts).toBe(0);
    expect(b.nextDelayMs()).toBe(1000); // 复位后回到 base
  });
});

describe('reconnect_failure_keeps_banner_and_continues_backoff (T-014)', () => {
  it('未超预算前 overBudget=false(横幅保持,继续退避)', () => {
    const b = new ReconnectBackoff(CFG);
    for (let i = 0; i < 7; i++) {
      b.nextDelayMs();
      expect(b.overBudget()).toBe(false);
    }
  });

  it('尝试达 budget 次 → overBudget=true(判确定断线 → full drop)', () => {
    const b = new ReconnectBackoff({ ...CFG, budget: 3 });
    b.nextDelayMs();
    b.nextDelayMs();
    expect(b.overBudget()).toBe(false);
    b.nextDelayMs(); // 第 3 次
    expect(b.overBudget()).toBe(true);
  });

  it('reset 后重新计预算(手动重试给足新预算窗口)', () => {
    const b = new ReconnectBackoff({ ...CFG, budget: 2 });
    b.nextDelayMs();
    b.nextDelayMs();
    expect(b.overBudget()).toBe(true);
    b.reset();
    expect(b.overBudget()).toBe(false);
  });
});
