// 会话状态机:四信号融合(README §四 M3)。驻留 host——UI 断开也照常跟踪。
// 信号①前台进程名(零协议依赖) ②OSC 133(精确,出现后压过①)
// ③BEL / OSC 9 / OSC 777(注意力) ④运行中输出静默(软「等输入」)

import { SessionEvent } from '../shared/protocol';

export const QUIET_MS = 60_000;
/** OSC 133 静默超过该时长后,进程名信号重新接管(防 exec 进无注入 shell 后状态冻结) */
export const OSC133_STALE_MS = 15_000;

export interface TrackerOptions {
  /** spawn 的 shell 名(basename,如 zsh),区分「回到 shell」与「子进程在跑」 */
  shellName: string;
  emit: (event: SessionEvent) => void;
  /** 可注入时钟,测试用 */
  now?: () => number;
}

/**
 * 会话状态快照(SessionSnapshot 的 tracker 半侧 · BL-005)。
 * 🔴 只含「当前态」——无未读计数 / 离散 bell·notify 累积(emit-and-forget · M-1/ARCH-5)。
 * 🔴 exitCode = 最近一条命令的退出码(OSC133 D)· 不是进程/会话退出码
 *    (后者是 ptyPool.onExit 的 exitCode · SessionSnapshot.exitCode 单独取 · QA-B-7)。
 */
export interface TrackerSnapshot {
  state: 'idle' | 'running';
  quiet: boolean;
  altscreen: boolean;
  bracketedPaste: boolean;
  /** 当前开着的鼠标/焦点上报模式(升序;白名单见 protocol.RESTORABLE_DEC_MODES) */
  mouseModes: number[];
  exitCode: number | null;
}

export class SessionTracker {
  state: 'idle' | 'running' = 'idle';
  private quiet = false;
  private lastOutput: number;
  /** 见过 OSC 133 后,进程名信号退居其次(语义信号更准) */
  private osc133 = false;
  private lastOsc133 = 0;
  private readonly now: () => number;
  /** 当前是否 altscreen(全屏 TUI)· 现被存储可查询(BL-005 快照) */
  private altscreen = false;
  /** 前台程序是否已开 bracketed paste(?2004h)。ring 只存字节,开机时的模式序列可能被
   *  挤出回放切片——收养全量回放时 renderer 据此恢复 xterm 模式,否则粘贴不加 200~ 包裹。 */
  private bracketedPaste = false;
  /** 前台 TUI 开着的鼠标/焦点上报模式。同 bracketedPaste 之因:这些序列在 TUI 启动
   *  一瞬发出,断线久了早被挤出 ring 切片,收养 reset() 后不补就是「鼠标点不动」
   *  (用户报障 2026-08-14 · opencode 一类可鼠标交互的 TUI)。 */
  private mouseModes = new Set<number>();
  /** 最近一条命令的退出码(OSC133 D)· 存储可查询(BL-005 快照) */
  private lastExitCode: number | null = null;
  /** 会话退出后冻结:后续信号一律忽略,快照定格为退出前最终态(CR-4) */
  private frozen = false;

  constructor(private opts: TrackerOptions) {
    this.now = opts.now ?? Date.now;
    this.lastOutput = this.now();
  }

  /** 当前态快照(可查询 · session.list / attach 对账用) */
  snapshot(): TrackerSnapshot {
    return {
      state: this.state,
      quiet: this.quiet,
      altscreen: this.altscreen,
      bracketedPaste: this.bracketedPaste,
      mouseModes: [...this.mouseModes].sort((a, b) => a - b),
      exitCode: this.lastExitCode,
    };
  }

  /** 会话退出:冻结最终快照,停止响应后续信号(死 pty 不再轮询 · CR-4) */
  freeze(): void {
    this.frozen = true;
  }

  /** 每个输出 chunk 调用(扫描之后) */
  onOutput(): void {
    if (this.frozen) return;
    this.lastOutput = this.now();
    if (this.quiet) {
      this.quiet = false;
      this.opts.emit({ kind: 'quiet', quiet: false });
    }
  }

  onBell(): void {
    if (this.frozen) return;
    this.opts.emit({ kind: 'bell' });
  }

  onOsc(code: number, payload: string): void {
    if (this.frozen) return;
    if (code === 133) {
      this.onOsc133(payload);
    } else if (code === 9) {
      // OSC 9 有两种用法:iTerm2 通知(9;text)与 ConEmu/WezTerm 进度条
      // (9;4;state;pct)。数字子命令开头的是进度协议,不是通知。
      if (/^\d+;/.test(payload)) return;
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
    if (this.frozen) return;
    this.altscreen = on;
    this.opts.emit({ kind: 'altscreen', on });
  }

  /** 快照专用状态,无 live 消费者 → 只存不 emit(emit-and-forget 事件面保持最小) */
  onBracketedPaste(on: boolean): void {
    if (this.frozen) return;
    this.bracketedPaste = on;
  }

  /** 同 onBracketedPaste:快照专用,无 live 消费者 → 只存不 emit */
  onMouseMode(mode: number, on: boolean): void {
    if (this.frozen) return;
    if (on) this.mouseModes.add(mode);
    else this.mouseModes.delete(mode);
  }

  /** pty.process 轮询喂入(变化时) */
  onProcessName(name: string): void {
    if (this.frozen) return;
    if (this.osc133) {
      // 闩锁出口:133 长时间无声(如 exec 进了无注入的 shell)则解除
      if (this.now() - this.lastOsc133 < OSC133_STALE_MS) return;
      this.osc133 = false;
    }
    const bare = name.replace(/^-/, '');
    this.setState(bare === this.opts.shellName ? 'idle' : 'running', 'process');
  }

  /** 池级 tick(~1.5s):运行中静默超阈值 → 软「等输入」信号 */
  tick(): void {
    if (this.frozen) return;
    if (this.state !== 'running' || this.quiet) return;
    if (this.now() - this.lastOutput >= QUIET_MS) {
      this.quiet = true;
      this.opts.emit({ kind: 'quiet', quiet: true });
    }
  }

  private onOsc133(payload: string): void {
    this.osc133 = true;
    this.lastOsc133 = this.now();
    const cmd = payload[0];
    if (cmd === 'C') {
      this.setState('running', 'osc133');
    } else if (cmd === 'D') {
      const raw = payload.length > 2 ? Number.parseInt(payload.slice(2), 10) : NaN;
      this.lastExitCode = Number.isFinite(raw) ? raw : null;
      this.opts.emit({
        kind: 'cmd-done',
        exitCode: this.lastExitCode,
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
