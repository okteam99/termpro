import { describe, expect, it } from 'vitest';
import { SessionTracker, QUIET_MS } from '../sessionTracker';
import type { SessionEvent } from '../../shared/protocol';

function make(shellName = 'zsh') {
  let t = 1_000_000;
  const events: SessionEvent[] = [];
  const tracker = new SessionTracker({
    shellName,
    emit: (e) => events.push(e),
    now: () => t,
  });
  return {
    tracker,
    events,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('SessionTracker', () => {
  it('进程名驱动 idle↔running(登录 shell 前导 - 兼容)', () => {
    const { tracker, events } = make();
    tracker.onProcessName('-zsh'); // 初始即 idle,无事件
    expect(events).toEqual([]);
    tracker.onProcessName('node');
    tracker.onProcessName('zsh');
    expect(events).toEqual([
      { kind: 'state', state: 'running', via: 'process' },
      { kind: 'state', state: 'idle', via: 'process' },
    ]);
  });

  it('OSC 133 驱动 C→running、D→cmd-done、A→idle,且压过进程名信号', () => {
    const { tracker, events } = make();
    tracker.onOsc(133, 'A'); // 初始提示符,state 已是 idle,无 state 事件
    tracker.onOsc(133, 'C');
    tracker.onOsc(133, 'D;1');
    tracker.onOsc(133, 'A');
    // 此后进程名信号不再驱动状态
    tracker.onProcessName('node');
    expect(events).toEqual([
      { kind: 'state', state: 'running', via: 'osc133' },
      { kind: 'cmd-done', exitCode: 1 },
      { kind: 'state', state: 'idle', via: 'osc133' },
    ]);
  });

  it('D 无退出码 → exitCode null', () => {
    const { tracker, events } = make();
    tracker.onOsc(133, 'D');
    expect(events).toEqual([{ kind: 'cmd-done', exitCode: null }]);
  });

  it('运行中静默超阈值 → quiet:true,输出恢复 → quiet:false', () => {
    const { tracker, events, advance } = make();
    tracker.onProcessName('claude');
    advance(QUIET_MS + 500);
    tracker.tick();
    tracker.onOutput();
    expect(events).toEqual([
      { kind: 'state', state: 'running', via: 'process' },
      { kind: 'quiet', quiet: true },
      { kind: 'quiet', quiet: false },
    ]);
  });

  it('idle 状态不产生 quiet;回到 idle 清除 quiet', () => {
    const { tracker, events, advance } = make();
    advance(QUIET_MS * 2);
    tracker.tick(); // idle:不触发
    tracker.onProcessName('vim');
    advance(QUIET_MS + 1);
    tracker.tick(); // quiet:true
    tracker.onProcessName('zsh'); // 回 idle → quiet 清除 + state
    expect(events).toEqual([
      { kind: 'state', state: 'running', via: 'process' },
      { kind: 'quiet', quiet: true },
      { kind: 'quiet', quiet: false },
      { kind: 'state', state: 'idle', via: 'process' },
    ]);
  });

  it('bell / OSC 9 / OSC 777 / altscreen 事件透传', () => {
    const { tracker, events } = make();
    tracker.onBell();
    tracker.onOsc(9, 'build finished');
    tracker.onOsc(777, 'notify;CI;all green');
    tracker.onAltScreen(true);
    expect(events).toEqual([
      { kind: 'bell' },
      { kind: 'notify', title: '', body: 'build finished' },
      { kind: 'notify', title: 'CI', body: 'all green' },
      { kind: 'altscreen', on: true },
    ]);
  });
});
