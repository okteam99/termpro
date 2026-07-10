import * as pty from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import {
  FLOW,
  HostMessage,
  SessionAttachResult,
  SessionSnapshot,
  SpawnOptions,
} from '../shared/protocol';
import { OutputScanner } from './outputScanner';
import { SessionTracker } from './sessionTracker';
import { RingBuffer } from './ringBuffer';
import { integrationEnv } from './shellIntegration';

interface Session {
  id: string;
  pty: pty.IPty;
  /** 已发出但 UI 尚未消费确认的字节数(流控依据) */
  unacked: number;
  paused: boolean;
  lastProcess: string;
  scanner: OutputScanner;
  tracker: SessionTracker;
  /** 会话归属客户端的发送通道(多窗口:输出只回归属方);reattach 换绑、detach 置 noop */
  send: (msg: HostMessage) => void;
  // ---- BL-005 断线重连/续跑 ----
  /** host 形态注入:embedded 不分配 ring / onExit 立即 delete(零回归) */
  mode: 'embedded' | 'standalone';
  /** 状态机:live=运行中;exited=断开期跑完/崩溃的保留态(AC-12) */
  status: 'live' | 'exited';
  /** 有无活跃 owner:false → 旁路流控(不 pause 憋停 · AC-1) */
  attached: boolean;
  /** 回放源:仅 standalone 分配的字节上限环形缓冲 */
  ring: RingBuffer | null;
  /** 累计发出总字节(单调):增量回放游标基准(与 ring.absoluteOffset 同步) */
  absoluteOffset: number;
  /** exited 时的退出码(进程/会话退出码 · SessionSnapshot.exitCode 单源) */
  exitCode: number | null;
  /** onExit 时刻 Date.now():会话数上限「先逐最旧 exited」的排序键(升序 · ARCH-B-8) */
  exitedAt: number | null;
  /** 用户显式 kill 标记:区分「自然退出→exited 保留」vs「手动 kill→彻底逐出」(D-9) */
  evicting: boolean;
  /** spawn cwd(session.list 重建 tab 用) */
  cwd: string;
  /** shell basename(title 兜底) */
  shellName: string;
}

const PROCESS_POLL_MS = 1500;
const DEFAULT_MAX_SESSIONS = 64;

function envMaxSessions(): number {
  const n = Number(process.env.TERMPRO_MAX_SESSIONS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_SESSIONS;
}

export class PtyPool {
  private sessions = new Map<string, Session>();
  private seq = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  /**
   * @param mode host 形态(D-1):embedded=本机嵌入式(零回归)· standalone=远程/loopback
   *             (分配 ring / onExit 转 exited 保留态 / 会话数上限)。默认 embedded 保持
   *             既有 `new PtyPool()` 调用点行为不变。
   */
  constructor(
    private readonly mode: 'embedded' | 'standalone' = 'embedded',
    private readonly maxSessions: number = envMaxSessions(),
  ) {}

  /** 共享单例:会话归属由 spawn 时传入的 send 决定 */
  spawn(
    opts: SpawnOptions,
    send: (msg: HostMessage) => void,
    onExit?: (sessionId: string) => void,
  ): string {
    // 会话数上限(仅 standalone):溢出先逐最旧 exited,无 exited 可逐 → 拒新建
    // (绝不逐运行中会话 · QA-7/D-9)。embedded 无 exited 堆积,不设上限(零回归)。
    if (this.mode === 'standalone' && this.sessions.size >= this.maxSessions) {
      if (!this.evictOldestExited()) {
        throw new Error(
          `session cap reached (${this.maxSessions}); kill a session to free a slot`,
        );
      }
    }

    const shell =
      opts.shell ??
      process.env.SHELL ??
      (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const id = `s${++this.seq}-${Date.now().toString(36)}`;
    // 持久化恢复的 cwd 可能已被删除(如清理掉的 worktree),回退家目录
    let cwd = opts.cwd;
    if (!fs.existsSync(cwd)) {
      console.warn('[host] spawn cwd missing, fallback to home:', cwd);
      cwd = os.homedir();
    }
    const baseEnv = { ...process.env, ...opts.env } as Record<string, string>;
    // zsh 自动注入 shell integration(OSC 133/7);失败或非 zsh 静默跳过
    const integration = integrationEnv(shell, baseEnv);
    const proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(2, opts.cols),
      rows: Math.max(1, opts.rows),
      cwd,
      env: { ...baseEnv, ...integration },
    });
    const shellName = shell.split('/').pop() ?? shell;
    const tracker = new SessionTracker({
      shellName,
      emit: (event) => {
        if (process.env.TERMPRO_SMOKE) {
          console.log('[host] session:event %s %s', id, JSON.stringify(event));
        }
        session.send({ t: 'session:event', sessionId: id, event });
      },
    });
    const scanner = new OutputScanner({
      onBell: () => tracker.onBell(),
      onOsc: (code, payload) => tracker.onOsc(code, payload),
      onAltScreen: (on) => tracker.onAltScreen(on),
    });

    const session: Session = {
      id,
      pty: proc,
      unacked: 0,
      paused: false,
      lastProcess: '',
      scanner,
      tracker,
      send,
      mode: this.mode,
      status: 'live',
      attached: true,
      ring: this.mode === 'standalone' ? new RingBuffer() : null,
      absoluteOffset: 0,
      exitCode: null,
      exitedAt: null,
      evicting: false,
      cwd,
      shellName,
    };

    proc.onData((data) => {
      // 观察(只读)→ 入 ring(回放源)→ 旁路流控记账 → 转发
      scanner.feed(data);
      tracker.onOutput();
      const bytes = Buffer.byteLength(data);
      session.absoluteOffset += bytes;
      session.ring?.push(data);
      // 🔴 旁路流控:pause 判据 gate 到 attached —— detached(无 owner ack)时不 pause,
      // 否则 unacked 单调涨过高水位会 proc.pause() 憋停子进程,击穿「断开续跑」(AC-1)。
      session.unacked += bytes;
      if (
        session.attached &&
        !session.paused &&
        session.unacked > FLOW.highWatermark
      ) {
        session.paused = true;
        proc.pause();
      }
      session.send({ t: 'pty:data', sessionId: id, data, bytes });
    });

    proc.onExit(({ exitCode }) => {
      if (session.mode === 'embedded' || session.evicting) {
        // 嵌入式:立即 delete(零回归)· 手动 kill:彻底逐出(不留 exited)
        this.sessions.delete(id);
        this.stopPollingIfIdle();
        onExit?.(id); // 归属方清理(自然退出时 client.sessions 不留死条目)
        session.send({ t: 'pty:exit', sessionId: id, exitCode });
        return;
      }
      // standalone 自然退出:转 exited 保留态(保留 ring + 退出码 · AC-12)
      session.status = 'exited';
      session.exitCode = exitCode;
      session.exitedAt = Date.now();
      session.attached = false;
      session.tracker.freeze(); // 冻结最终快照 · 停对死 pty 轮询(CR-4)
      this.stopPollingIfIdle();
      onExit?.(id); // 死会话无归属 I/O:从 owner set 摘除(仍留在 pool 供 list/attach)
      session.send({ t: 'pty:exit', sessionId: id, exitCode });
    });

    this.sessions.set(id, session);
    this.ensurePolling();
    return id;
  }

  /** UI 消费完一批输出后回执;水位回落则恢复 PTY 读取 */
  ack(sessionId: string, bytes: number): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.status === 'exited') return;
    s.unacked = Math.max(0, s.unacked - bytes);
    if (s.paused && s.unacked < FLOW.lowWatermark) {
      s.paused = false;
      s.pty.resume();
    }
  }

  input(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.status === 'exited') return;
    s.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 1) return;
    const s = this.sessions.get(sessionId);
    if (!s || s.status === 'exited') return;
    s.pty.resize(cols, rows);
  }

  kill(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    // exited(pty 已死):直接从 pool 删除(用户显式清理已完成会话)
    if (s.status === 'exited') {
      this.sessions.delete(sessionId);
      this.stopPollingIfIdle();
      return;
    }
    // live:标记 evicting → kill → onExit 走「彻底逐出」分支(不转 exited)
    s.evicting = true;
    s.pty.kill();
  }

  pid(sessionId: string): number | null {
    const s = this.sessions.get(sessionId);
    // 🔴 exited 显式返 null:node-pty pty.pid 退出后仍返旧值,勿对死 pid 调 processCwd(EXT-B-6)
    if (!s || s.status === 'exited') return null;
    return s.pty.pid ?? null;
  }

  /**
   * 断开该会话的活跃 owner(端口 close · standalone):
   *  - attached=false → 旁路流控生效(断开续跑)
   *  - 🔴 解已 paused 会话:paused=false; proc.resume()(断开瞬间已憋停的会话须复活,
   *    否则无 owner ack → 永不 resume → 整段憋停 → 击穿 AC-1 · ARCH-B-3)
   *  - unacked=0 + send 置 noop sink(丢弃输出,只入 ring 待回放)
   */
  detach(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.attached = false;
    if (s.status === 'live' && s.paused) {
      s.paused = false;
      s.pty.resume();
    }
    s.unacked = 0;
    s.send = () => {};
  }

  /**
   * 重连收养既有会话:换 send + resize 对账 + 回放切片 + 记账复位(BL-005 · CR-2)。
   * 🔴 全程同步禁 await(reattach 三不变式①):算切片 + 换 send 同一 tick 完成。
   * exited 分支跳过 proc.resize + 流控记账(死 pty resize 会抛 · 纯回放最终 scrollback · ARCH-B-6)。
   * @returns SessionAttachResult;会话不存在(被逐/从未有)→ null(caller 产 found=false)。
   */
  reattach(
    sessionId: string,
    newSend: (msg: HostMessage) => void,
    opts: { cols: number; rows: number; resumeOffset: number },
  ): SessionAttachResult | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;

    // 先算回放切片(捕获至当前 absoluteOffset),再换 send —— 同一同步 tick,无 onData 插入
    const slice = s.ring
      ? s.ring.sliceFrom(opts.resumeOffset)
      : { data: '', baseOffset: s.absoluteOffset, full: true };
    const nextOffset = s.absoluteOffset;

    s.send = newSend;
    s.attached = true;
    // 🔴 unacked=0:回放全新记账起点,免新 owner 一挂上就 >高水位立即二次 pause
    s.unacked = 0;
    s.paused = false;

    if (s.status === 'live' && opts.cols >= 2 && opts.rows >= 1) {
      // 收养对账:按当前尺寸 resize 逼 TUI 重绘(回放错行被纠正 · QA-12)
      try {
        s.pty.resize(opts.cols, opts.rows);
      } catch (err) {
        console.warn('[host] reattach resize failed for', sessionId, err);
      }
    }

    return {
      found: true,
      full: slice.full,
      baseOffset: slice.baseOffset,
      data: slice.data,
      nextOffset,
      snapshot: this.snapshotOf(s),
    };
  }

  /** 列出该 host 现存会话(live + exited)+ 状态快照;embedded 会话不进 list(AC-2)。 */
  list(): SessionSnapshot[] {
    const out: SessionSnapshot[] = [];
    for (const s of this.sessions.values()) {
      if (s.mode === 'embedded') continue;
      out.push(this.snapshotOf(s));
    }
    return out;
  }

  private snapshotOf(s: Session): SessionSnapshot {
    const t = s.tracker.snapshot();
    return {
      sessionId: s.id,
      cwd: s.cwd,
      // exited 后 lastProcess 定格为退出前最后已知值;从未轮询到则兜底 shell 名
      title: s.lastProcess || s.shellName,
      status: s.status,
      state: t.state,
      quiet: t.quiet,
      altscreen: t.altscreen,
      // 🔴 exitCode 取进程 onExit(非 tracker 的最近命令退出码 · QA-B-7)
      exitCode: s.status === 'exited' ? s.exitCode : null,
    };
  }

  /**
   * 逐出最旧 exited 会话(排序键 = exitedAt 升序 · 最近完成的最后逐 · 保北极星刚跑完的
   * build 最后被逐 · ARCH-B-8)。无 exited 可逐 → false(caller 拒新建,绝不逐 live)。
   */
  private evictOldestExited(): boolean {
    let oldest: Session | null = null;
    for (const s of this.sessions.values()) {
      if (s.status !== 'exited') continue;
      if (oldest === null || (s.exitedAt ?? 0) < (oldest.exitedAt ?? 0)) {
        oldest = s;
      }
    }
    if (oldest === null) return false;
    this.sessions.delete(oldest.id);
    this.stopPollingIfIdle();
    return true;
  }

  dispose(): void {
    for (const s of this.sessions.values()) s.pty.kill();
    this.sessions.clear();
    this.stopPollingIfIdle();
  }

  /** 前台进程名轮询:变化时上报,用作 tab 标题与 running/idle 信号(M3 的信号①) */
  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      for (const s of this.sessions.values()) {
        // exited 会话已冻结:停对死 pty 读 .process / tick(CR-4)
        if (s.status === 'exited') continue;
        const name = s.pty.process;
        if (name && name !== s.lastProcess) {
          s.lastProcess = name;
          s.send({ t: 'pty:title', sessionId: s.id, processName: name });
          s.tracker.onProcessName(name);
        }
        s.tracker.tick();
      }
    }, PROCESS_POLL_MS);
  }

  /** 无 live 会话时停轮询(exited 会话不需轮询死 pty · CR-4)。 */
  private stopPollingIfIdle(): void {
    if (!this.pollTimer) return;
    let hasLive = false;
    for (const s of this.sessions.values()) {
      if (s.status === 'live') {
        hasLive = true;
        break;
      }
    }
    if (!hasLive) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
