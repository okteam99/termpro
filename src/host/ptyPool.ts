import * as pty from 'node-pty';
import os from 'node:os';
import { FLOW, HostMessage, SpawnOptions } from '../shared/protocol';

interface Session {
  id: string;
  pty: pty.IPty;
  /** 已发出但 UI 尚未消费确认的字节数(流控依据) */
  unacked: number;
  paused: boolean;
  lastProcess: string;
}

const PROCESS_POLL_MS = 1500;

export class PtyPool {
  private sessions = new Map<string, Session>();
  private seq = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(private send: (msg: HostMessage) => void) {}

  spawn(opts: SpawnOptions): string {
    const shell =
      opts.shell ??
      process.env.SHELL ??
      (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const id = `s${++this.seq}-${Date.now().toString(36)}`;
    const proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(2, opts.cols),
      rows: Math.max(1, opts.rows),
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });
    const session: Session = {
      id,
      pty: proc,
      unacked: 0,
      paused: false,
      lastProcess: '',
    };

    proc.onData((data) => {
      const bytes = Buffer.byteLength(data);
      session.unacked += bytes;
      if (!session.paused && session.unacked > FLOW.highWatermark) {
        session.paused = true;
        proc.pause();
      }
      this.send({ t: 'pty:data', sessionId: id, data, bytes });
    });

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.stopPollingIfIdle();
      this.send({ t: 'pty:exit', sessionId: id, exitCode });
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
          this.send({ t: 'pty:title', sessionId: s.id, processName: name });
        }
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
