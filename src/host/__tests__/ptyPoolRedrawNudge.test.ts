// full 回放收尾的重绘拨动(修「远程重连后屏幕停在碎片态」)。
//
// 用假 node-pty:真 pty 测不到这个 —— 断言对象是 winsize 的变化序列,而 IPty 没被 pool
// 暴露出去,从 shell 侧观测 SIGWINCH 又依赖 trap 时机(天然不稳)。这里只验 pool 的
// resize 调用序列,真 SIGWINCH 语义属内核,不在本层。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakePty {
  cols: number;
  rows: number;
  pid: number;
  process: string;
  resizes: Array<[number, number]>;
  killed: boolean;
  emitData(data: string): void;
  emitExit(exitCode: number): void;
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  resize(c: number, r: number): void;
  write(d: string): void;
  kill(): void;
  pause(): void;
  resume(): void;
}

const spawned: FakePty[] = [];

vi.mock('node-pty', () => ({
  spawn: (_file: string, _args: unknown, opts: { cols: number; rows: number }) => {
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number }) => void = () => {};
    const p: FakePty = {
      cols: opts.cols,
      rows: opts.rows,
      pid: 4242,
      process: 'zsh',
      resizes: [],
      killed: false,
      emitData: (d) => onData(d),
      emitExit: (exitCode) => onExit({ exitCode }),
      onData: (cb) => { onData = cb; },
      onExit: (cb) => { onExit = cb; },
      resize(c, r) {
        if (this.killed) throw new Error('ioctl(2) failed, EBADF');
        this.resizes.push([c, r]);
        this.cols = c;
        this.rows = r;
      },
      write: () => {},
      kill() { this.killed = true; },
      pause: () => {},
      resume: () => {},
    };
    spawned.push(p);
    return p;
  },
}));

const { PtyPool } = await import('../ptyPool');

const CWD = '/tmp';
const NUDGE_MS = 60; // = ptyPool 的 DEFAULT_REDRAW_NUDGE_MS

let pool: InstanceType<typeof PtyPool> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  spawned.length = 0;
  process.env.OKWORK_SESSION_RING_BYTES = '64'; // 极小 ring:少量输出即挤爆 → full
});

afterEach(() => {
  pool?.dispose();
  pool = null;
  delete process.env.OKWORK_SESSION_RING_BYTES;
  vi.useRealTimers();
});

/** standalone 会话 + 撑爆 ring 的输出 → 后续 resumeOffset=0 的 reattach 必 full。 */
function spawnOverflowed(cols = 80, rows = 24): { sid: string; p: FakePty } {
  pool = new PtyPool('standalone');
  const sid = pool.spawn({ cwd: CWD, cols, rows }, () => {}, undefined, 1);
  const p = spawned[0];
  p.emitData('x'.repeat(500));
  return { sid, p };
}

const reattach = (sid: string, resumeOffset: number, cols = 80, rows = 24) =>
  pool!.reattach(sid, () => {}, { cols, rows, resumeOffset, mode: 'mirror', subscriberId: 2 });

describe('full 回放收尾拨动尺寸逼整屏重绘', () => {
  it('full=true → 先缩一行,延迟后还原(内核只在 winsize 真变时发 SIGWINCH)', () => {
    const { sid, p } = spawnOverflowed();
    p.resizes.length = 0;

    const res = reattach(sid, 0);
    expect(res?.full).toBe(true);
    expect(p.resizes).toEqual([[80, 23]]); // 尺寸「没变」也要先动一下
    expect(p.rows).toBe(23);

    vi.advanceTimersByTime(NUDGE_MS);
    expect(p.resizes).toEqual([[80, 23], [80, 24]]);
    expect(p.rows).toBe(24);
  });

  it('同 tick 不还原:中间尺寸须可观测,否则比对新旧尺寸的 TUI 会跳过重绘', () => {
    const { sid, p } = spawnOverflowed();
    p.resizes.length = 0;
    reattach(sid, 0);
    vi.advanceTimersByTime(NUDGE_MS - 1);
    expect(p.rows).toBe(23); // 还原前一直停在拨动尺寸
  });

  it('增量回放(full=false)不拨动 —— 屏幕态连续,无须重绘', () => {
    const { sid, p } = spawnOverflowed();
    p.resizes.length = 0;
    const res = reattach(sid, 500); // 游标 = 流末尾,仍在 ring 内
    expect(res?.full).toBe(false);
    vi.advanceTimersByTime(NUDGE_MS * 2);
    expect(p.resizes).toEqual([]);
  });

  it('在途真实 resize 作废还原 —— 不把新尺寸覆盖回旧值', () => {
    const { sid, p } = spawnOverflowed();
    p.resizes.length = 0;
    reattach(sid, 0); // → [80,23],还原在途

    // 用户拖小窗口 → min-size 重算落地(取全体订阅者 min,故须小于另一端的 80×24)
    pool!.resize(sid, 70, 20, 2);
    expect(p.resizes).toEqual([[80, 23], [70, 20]]);

    vi.advanceTimersByTime(NUDGE_MS * 2);
    expect(p.resizes).toEqual([[80, 23], [70, 20]]); // 还原已作废
    expect([p.cols, p.rows]).toEqual([70, 20]);
  });

  it('拨动期间会话退出 → 不对死 pty resize(EBADF)', () => {
    const { sid, p } = spawnOverflowed();
    p.resizes.length = 0;
    reattach(sid, 0);
    p.emitExit(0);
    expect(() => vi.advanceTimersByTime(NUDGE_MS * 2)).not.toThrow();
    expect(p.resizes).toEqual([[80, 23]]);
  });

  it('rows<2 的退化视口不拨动(rows-1 会成非法尺寸)', () => {
    const { sid, p } = spawnOverflowed(80, 1);
    p.resizes.length = 0;
    reattach(sid, 0, 80, 1);
    expect(p.resizes).toEqual([]);
  });

  it('exited 会话 full 回放不拨动(无进程可逼,纯回放最终 scrollback)', () => {
    const { sid, p } = spawnOverflowed();
    p.emitExit(0);
    p.resizes.length = 0;
    const res = reattach(sid, 0);
    expect(res?.full).toBe(true);
    vi.advanceTimersByTime(NUDGE_MS * 2);
    expect(p.resizes).toEqual([]);
  });

  it('exclusive 模式同样拨动(last-attach-wins 后仍是碎片屏)', () => {
    const { sid, p } = spawnOverflowed();
    p.resizes.length = 0;
    pool!.reattach(sid, () => {}, {
      cols: 80, rows: 24, resumeOffset: 0, mode: 'exclusive', subscriberId: 2,
    });
    // exclusive 分支先做自己的尺寸对账(直接 resize),再拨动
    expect(p.resizes).toEqual([[80, 24], [80, 23]]);
    vi.advanceTimersByTime(NUDGE_MS);
    expect(p.resizes).toEqual([[80, 24], [80, 23], [80, 24]]);
  });
});
