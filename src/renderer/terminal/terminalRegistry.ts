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
  disposed: boolean;
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
    disposed: false,
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
    // spawn 期间 tab 可能已被关闭:立即回收会话,避免 PTY 进程泄漏
    if (inst.disposed) {
      void hostClient.rpc('pty.kill', { sessionId }).catch(() => {});
      return;
    }
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
    // spawn 进行期间 fit 可能已改变终端尺寸(onResize 当时未注册),
    // 主动同步一次当前尺寸,避免 TUI 以 80x24 启动
    hostClient.resize(sessionId, inst.term.cols, inst.term.rows);
  } catch (err) {
    // 失败必须在终端里说话,不许无声死 tab
    const message = err instanceof Error ? err.message : String(err);
    inst.term.writeln(`\x1b[31m[TermPro] 终端启动失败:${message}\x1b[0m`);
    inst.term.writeln('\x1b[2m关闭该 tab 后重新打开即可重试\x1b[0m');
    inst.callbacks.onExit?.(-1);
  } finally {
    inst.spawning = false;
  }
}

/** 当前 tab 的会话 id(未 spawn / 已退出为 null),供文件面板查询实时 cwd */
export function getSessionId(tabId: string): string | null {
  return registry.get(tabId)?.sessionId ?? null;
}

/** 反查:sessionId → tabId(会话事件路由用) */
export function findTabBySessionId(sessionId: string): string | null {
  for (const [tabId, inst] of registry) {
    if (inst.sessionId === sessionId) return tabId;
  }
  return null;
}

export function disposeTerminal(tabId: string): void {
  const inst = registry.get(tabId);
  if (!inst) return;
  inst.disposed = true;
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
