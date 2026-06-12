import * as pty from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import { FLOW, HostMessage, SpawnOptions } from '../shared/protocol';
import { OutputScanner } from './outputScanner';
import { SessionTracker } from './sessionTracker';
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
  /** 会话归属客户端的发送通道(多窗口:输出只回归属方) */
  send: (msg: HostMessage) => void;
}

const PROCESS_POLL_MS = 1500;

export class PtyPool {
  private sessions = new Map<string, Session>();
  private seq = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  /** 共享单例:会话归属由 spawn 时传入的 send 决定 */
  spawn(opts: SpawnOptions, send: (msg: HostMessage) => void): string {
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
    const tracker = new SessionTracker({
      shellName: shell.split('/').pop() ?? shell,
      emit: (event) => {
        if (process.env.TERMPRO_SMOKE) {
          console.log('[host] session:event %s %s', id, JSON.stringify(event));
        }
        send({ t: 'session:event', sessionId: id, event });
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
    };

    proc.onData((data) => {
      // 观察(只读)→ 流控记账 → 转发
      scanner.feed(data);
      tracker.onOutput();
      const bytes = Buffer.byteLength(data);
      session.unacked += bytes;
      if (!session.paused && session.unacked > FLOW.highWatermark) {
        session.paused = true;
        proc.pause();
      }
      send({ t: 'pty:data', sessionId: id, data, bytes });
    });

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.stopPollingIfIdle();
      send({ t: 'pty:exit', sessionId: id, exitCode });
    });

    this.sessions.set(id, session);
    this.ensurePolling();
    return id;
  }

  /** UI 消费完一批输出后回执;水位回落则恢复 PTY 读取 */
  ack(sessionId: string, bytes: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.unacked = Math.max(0, s.unacked - bytes);
    if (s.paused && s.unacked < FLOW.lowWatermark) {
      s.paused = false;
      s.pty.resume();
    }
  }

  input(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 1) return;
    this.sessions.get(sessionId)?.pty.resize(cols, rows);
  }

  kill(sessionId: string): void {
    this.sessions.get(sessionId)?.pty.kill();
  }

  pid(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.pty.pid ?? null;
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

  private stopPollingIfIdle(): void {
    if (this.sessions.size === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
