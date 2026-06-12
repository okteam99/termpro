// 终端实例注册表:Terminal 对象以 tabId 为键、跨 React 挂载周期存活,
// 切换 tab 不丢 scrollback、不断会话。

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { WebglAddon } from '@xterm/addon-webgl';
import { hostClient } from '../services/hostClient';

export interface TermCallbacks {
  onTitle?(processName: string): void;
  onExit?(exitCode: number): void;
  onCwd?(cwd: string): void;
  onFirstData?(): void;
}

export interface TermInstance {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  webgl: WebglAddon | null;
  sessionId: string | null;
  spawning: boolean;
  opened: boolean;
  firstData: boolean;
  callbacks: TermCallbacks;
}

const registry = new Map<string, TermInstance>();

export function getOrCreateTerminal(tabId: string): TermInstance {
  const existing = registry.get(tabId);
  if (existing) return existing;

  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
    scrollback: 10_000,
    theme: {
      background: '#1e2227',
      foreground: '#d7dae0',
      cursor: '#4a8df8',
      selectionBackground: '#3e4451',
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon();
  term.loadAddon(search);
  // CJK 宽字符按 Unicode 11 计宽(中文对齐)
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';

  const inst: TermInstance = {
    term,
    fit,
    search,
    webgl: null,
    sessionId: null,
    spawning: false,
    opened: false,
    firstData: false,
    callbacks: {},
  };

  // OSC 7:shell 上报当前目录(file://host/path),用于持久化 tab cwd
  term.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7(data);
    if (cwd) inst.callbacks.onCwd?.(cwd);
    return true;
  });

  registry.set(tabId, inst);
  return inst;
}

export async function ensureSession(tabId: string, cwd: string): Promise<void> {
  const inst = getOrCreateTerminal(tabId);
  if (inst.sessionId || inst.spawning) return;
  inst.spawning = true;
  try {
    const { sessionId } = await hostClient.rpc('pty.spawn', {
      cwd,
      cols: inst.term.cols,
      rows: inst.term.rows,
    });
    inst.sessionId = sessionId;

    hostClient.attachPty(sessionId, {
      onData: (data, bytes) => {
        if (!inst.firstData) {
          inst.firstData = true;
          inst.callbacks.onFirstData?.();
        }
        // write 回调 = 数据已被解析消费 → 回执流控
        inst.term.write(data, () => hostClient.ack(sessionId, bytes));
      },
      onExit: (exitCode) => {
        inst.sessionId = null;
        inst.callbacks.onExit?.(exitCode);
      },
      onTitle: (processName) => inst.callbacks.onTitle?.(processName),
    });

    inst.term.onData((d) => {
      if (inst.sessionId) hostClient.input(inst.sessionId, d);
    });
    inst.term.onResize(({ cols, rows }) => {
      if (inst.sessionId) hostClient.resize(inst.sessionId, cols, rows);
    });
  } finally {
    inst.spawning = false;
  }
}

export function disposeTerminal(tabId: string): void {
  const inst = registry.get(tabId);
  if (!inst) return;
  if (inst.sessionId) {
    void hostClient.rpc('pty.kill', { sessionId: inst.sessionId }).catch(() => {
      /* host 可能已回收 */
    });
  }
  inst.webgl?.dispose();
  inst.term.dispose();
  registry.delete(tabId);
}

function parseOsc7(data: string): string | null {
  // 形如 file://hostname/Users/liam/foo 或 file:///Users/liam/foo
  if (!data.startsWith('file://')) return null;
  try {
    const url = new URL(data);
    return decodeURIComponent(url.pathname) || null;
  } catch {
    return null;
  }
}
