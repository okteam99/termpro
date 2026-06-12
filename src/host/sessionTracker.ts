// 会话状态机:四信号融合(README §四 M3)。驻留 host——UI 断开也照常跟踪。
// 信号①前台进程名(零协议依赖) ②OSC 133(精确,出现后压过①)
// ③BEL / OSC 9 / OSC 777(注意力) ④运行中输出静默(软「等输入」)

import { SessionEvent } from '../shared/protocol';

export const QUIET_MS = 10_000;

export interface TrackerOptions {
  /** spawn 的 shell 名(basename,如 zsh),区分「回到 shell」与「子进程在跑」 */
  shellName: string;
  emit: (event: SessionEvent) => void;
  /** 可注入时钟,测试用 */
  now?: () => number;
}

export class SessionTracker {
  state: 'idle' | 'running' = 'idle';
  private quiet = false;
  private lastOutput: number;
  /** 见过 OSC 133 后,进程名信号退居其次(语义信号更准) */
  private osc133 = false;
  private readonly now: () => number;

  constructor(private opts: TrackerOptions) {
    this.now = opts.now ?? Date.now;
    this.lastOutput = this.now();
  }

  /** 每个输出 chunk 调用(扫描之后) */
  onOutput(): void {
    this.lastOutput = this.now();
    if (this.quiet) {
      this.quiet = false;
      this.opts.emit({ kind: 'quiet', quiet: false });
    }
  }

  onBell(): void {
    this.opts.emit({ kind: 'bell' });
  }

  onOsc(code: number, payload: string): void {
    if (code === 133) {
      this.onOsc133(payload);
    } else if (code === 9) {
      // OSC 9:整个 payload 即通知文本
      this.opts.emit({ kind: 'notify', title: '', body: payload });
    } else if (code === 777) {
      // OSC 777;notify;title;body
      const parts = payload.split(';');
      if (parts[0] === 'notify') {
        this.opts.emit({
          kind: 'notify',
          title: parts[1] ?? '',
          body: parts.slice(2).join(';'),
        });
      }
    }
  }

  onAltScreen(on: boolean): void {
    this.opts.emit({ kind: 'altscreen', on });
  }

  /** pty.process 轮询喂入(变化时) */
  onProcessName(name: string): void {
    if (this.osc133) return;
    const bare = name.replace(/^-/, '');
    this.setState(bare === this.opts.shellName ? 'idle' : 'running', 'process');
  }

  /** 池级 tick(~1.5s):运行中静默超阈值 → 软「等输入」信号 */
  tick(): void {
    if (this.state !== 'running' || this.quiet) return;
    if (this.now() - this.lastOutput >= QUIET_MS) {
      this.quiet = true;
      this.opts.emit({ kind: 'quiet', quiet: true });
    }
  }

  private onOsc133(payload: string): void {
    this.osc133 = true;
    const cmd = payload[0];
    if (cmd === 'C') {
      this.setState('running', 'osc133');
    } else if (cmd === 'D') {
      const raw = payload.length > 2 ? Number.parseInt(payload.slice(2), 10) : NaN;
      this.opts.emit({
        kind: 'cmd-done',
        exitCode: Number.isFinite(raw) ? raw : null,
      });
    } else if (cmd === 'A') {
      this.setState('idle', 'osc133');
    }
  }

  private setState(state: 'idle' | 'running', via: 'process' | 'osc133'): void {
    if (this.state === state) return;
    this.state = state;
    if (state === 'idle' && this.quiet) {
      this.quiet = false;
      this.opts.emit({ kind: 'quiet', quiet: false });
    }
    this.opts.emit({ kind: 'state', state, via });
  }
}
