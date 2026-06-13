import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordOutput,
  recordDeactivated,
  resetTabActivity,
  hadOutputSinceLeave,
  decideQuietAction,
  type QuietDecisionInput,
  __resetAllForTest,
} from '../quietGate';

beforeEach(() => __resetAllForTest());

describe('quietGate.hadOutputSinceLeave', () => {
  it('T-001 AC-1: 后台 tab 离开后无新输出 → false(不提示)', () => {
    recordOutput('t1', 50); // 离开前的输出
    recordDeactivated('t1', 100); // 100 时切走,之后无输出
    expect(hadOutputSinceLeave('t1')).toBe(false);
  });

  it('T-002 AC-1: 从未被激活过(无 deactivatedAt)→ false', () => {
    recordOutput('t2', 200); // 有输出但从未去激活
    expect(hadOutputSinceLeave('t2')).toBe(false);
  });

  it('T-003 AC-2: 离开后有新输出 → true', () => {
    recordDeactivated('t3', 100);
    recordOutput('t3', 150);
    expect(hadOutputSinceLeave('t3')).toBe(true);
  });

  it('T-005 AC-4: resetTabActivity 重置基线;旧输出不触发,须再次「去激活后新增」', () => {
    recordDeactivated('t5', 100);
    recordOutput('t5', 150);
    expect(hadOutputSinceLeave('t5')).toBe(true);

    resetTabActivity('t5'); // 重新激活 → 重置
    expect(hadOutputSinceLeave('t5')).toBe(false);

    recordOutput('t5', 200); // 仅有输出、无新去激活
    expect(hadOutputSinceLeave('t5')).toBe(false);

    recordDeactivated('t5', 250); // 再次去激活
    expect(hadOutputSinceLeave('t5')).toBe(false); // 旧输出 200 < 250

    recordOutput('t5', 300); // 去激活后新增
    expect(hadOutputSinceLeave('t5')).toBe(true);
  });

  it('T-006 AC-5: 多次切走取最近一次去激活时刻为基准', () => {
    recordDeactivated('t6', 100);
    recordOutput('t6', 150); // 第一次离开后有输出
    recordDeactivated('t6', 200); // 切回又切走(最近 = 200,覆盖写)
    expect(hadOutputSinceLeave('t6')).toBe(false); // 150 < 200

    recordOutput('t6', 250);
    expect(hadOutputSinceLeave('t6')).toBe(true); // 250 > 200
  });
});

describe('quietGate.decideQuietAction', () => {
  const base: QuietDecisionInput = {
    focusedTab: false,
    isCurrentTab: false,
    running: true,
    hadOutputSinceLeave: true,
    alreadyNotified: false,
  };

  it('T-004 AC-3: 聚焦 + 当前 tab → 不打扰(行为不变)', () => {
    expect(
      decideQuietAction({ ...base, focusedTab: true, isCurrentTab: true }),
    ).toEqual({ setWaiting: false, pushNotification: false });
  });

  it('T-004 AC-3: 当前 tab(失焦)→ 只亮 waiting、不通知(行为不变)', () => {
    expect(
      decideQuietAction({ ...base, isCurrentTab: true, hadOutputSinceLeave: false }),
    ).toEqual({ setWaiting: true, pushNotification: false });
  });

  it('T-001 AC-1: 后台 + 无离开后输出 → 不标 waiting、不通知', () => {
    expect(decideQuietAction({ ...base, hadOutputSinceLeave: false })).toEqual({
      setWaiting: false,
      pushNotification: false,
    });
  });

  it('T-003 AC-2: 后台 + 有离开后输出 → 标 waiting + 通知一次', () => {
    expect(decideQuietAction({ ...base })).toEqual({
      setWaiting: true,
      pushNotification: true,
    });
  });

  it('T-003 AC-2: 已通知过 → 标 waiting 但不重复通知(闩锁)', () => {
    expect(decideQuietAction({ ...base, alreadyNotified: true })).toEqual({
      setWaiting: true,
      pushNotification: false,
    });
  });

  it('非 running(已 idle)→ 不打扰', () => {
    expect(decideQuietAction({ ...base, running: false })).toEqual({
      setWaiting: false,
      pushNotification: false,
    });
  });
});
