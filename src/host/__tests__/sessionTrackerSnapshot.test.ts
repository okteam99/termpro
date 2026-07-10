import { describe, expect, it } from 'vitest';
import { SessionTracker } from '../sessionTracker';
import type { SessionEvent } from '../../shared/protocol';

function make(shellName = 'zsh') {
  let t = 1_000_000;
  const events: SessionEvent[] = [];
  const tracker = new SessionTracker({
    shellName,
    emit: (e) => events.push(e),
    now: () => t,
  });
  return { tracker, events, advance: (ms: number) => (t += ms) };
}

describe('SessionTracker.snapshot (BL-005)', () => {
  // T-012: snapshot_getter_exposes_state_quiet_altscreen_exitcode_no_unread_count (AC-5)
  it('快照暴露 state/quiet/altscreen/exitCode 当前态', () => {
    const { tracker } = make();
    // 初始:idle / 非 quiet / 非 altscreen / 无退出码
    expect(tracker.snapshot()).toEqual({
      state: 'idle',
      quiet: false,
      altscreen: false,
      exitCode: null,
    });

    tracker.onOsc(133, 'C'); // running
    tracker.onAltScreen(true); // altscreen on
    tracker.onOsc(133, 'D;7'); // cmd-done exitCode=7

    expect(tracker.snapshot()).toEqual({
      state: 'running',
      quiet: false,
      altscreen: true,
      exitCode: 7,
    });
  });

  it('altscreen 关 → 快照 altscreen=false(存储可查询,非只 emit)', () => {
    const { tracker } = make();
    tracker.onAltScreen(true);
    expect(tracker.snapshot().altscreen).toBe(true);
    tracker.onAltScreen(false);
    expect(tracker.snapshot().altscreen).toBe(false);
  });

  it('running 静默超阈值 → 快照 quiet=true', () => {
    const { tracker, advance } = make();
    tracker.onProcessName('claude'); // running
    advance(70_000);
    tracker.tick();
    expect(tracker.snapshot().quiet).toBe(true);
  });

  it('快照对象不含任何未读计数字段(M-1)', () => {
    const { tracker } = make();
    tracker.onBell();
    tracker.onOsc(9, 'hi'); // notify
    const snap = tracker.snapshot();
    expect(Object.keys(snap).sort()).toEqual([
      'altscreen',
      'exitCode',
      'quiet',
      'state',
    ]);
  });

  it('freeze 后信号被忽略,快照定格退出前最终态(CR-4)', () => {
    const { tracker, events } = make();
    tracker.onOsc(133, 'C'); // running
    const before = tracker.snapshot();
    expect(before.state).toBe('running');
    const eventsBefore = events.length;

    tracker.freeze();
    // 冻结后一切信号无效
    tracker.onProcessName('node');
    tracker.onAltScreen(true);
    tracker.onOutput();
    tracker.onBell();
    tracker.tick();

    expect(tracker.snapshot()).toEqual(before);
    expect(events.length).toBe(eventsBefore); // 冻结后不再 emit
  });
});
