// 终端实例注册表:Terminal 对象以 tabId 为键、跨 React 挂载周期存活,
// 切换 tab 不丢 scrollback、不断会话。
// BL-004:终端消费改经 hostRegistry.forWorkspace(ws) per-host 路由——每个 TermInstance
// 在 spawn 时绑定 client/hostId(tab 生命周期内 host 不变),会话反查改 (hostId,sessionId)
// 复合键(sessionId 仅 per-host 唯一,本机+远程可能撞同名 id)。

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { WebglAddon } from '@xterm/addon-webgl';
import type { HostClient } from '../services/hostClient';
import { hostRegistry } from '../services/hostRegistry';
import { recordOutput } from '../services/quietGate';
import {
  createOscLinkHandler,
  FsLinkProvider,
  LinkHighlighter,
  SystemWebLinkProvider,
} from './terminalLinks';
import { BottomBarPin } from './bottomBarPin';
import { disposeWebglAddon } from './webglContextRelease';

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
  /** 底部输入栏固定面板:滚离底部时镜像 live 区域底部,挂载见 TerminalView */
  barPin: BottomBarPin;
  sessionId: string | null;
  spawning: boolean;
  opened: boolean;
  firstData: boolean;
  disposed: boolean;
  /** spawn 时的 cwd:链接相对路径解析的兜底 */
  spawnCwd: string;
  callbacks: TermCallbacks;
  /** spawn 时绑定 = hostRegistry.forWorkspace(ws);本机 = 既有单例(零回归)。spawn 前为 null。 */
  client: HostClient | null;
  /** spawn 时绑定的路由 host id('local'|configId)。spawn 前为 null。会话复合键路由用。 */
  hostId: string | null;
}

const registry = new Map<string, TermInstance>();

// 「底部输入栏固定」设置的当前值:新建终端的默认(默认关),由 settingsSync 经
// applyPinBottomBar 推入。不直接 import store,避免 store↔terminalRegistry 循环依赖。
let pinBottomBarEnabled = false;

export function getOrCreateTerminal(tabId: string): TermInstance {
  const existing = registry.get(tabId);
  if (existing) return existing;

  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    // macOS 默认右键会改选中光标下的词,破坏用户拖选;菜单流程下保持原选区
    rightClickSelectsWord: false,
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
    scrollback: 10_000,
    // 不在打字时自动跳回底部:配合底部输入栏固定面板(BottomBarPin),
    // 用户向上滚动读历史时可停在原处继续输入,固定面板实时显示输入内容。
    // 设置关闭固定面板时恢复默认 true(打字即回底)。
    scrollOnUserInput: !pinBottomBarEnabled,
    // OSC 8 超链接 → 系统默认浏览器,否则 xterm 核心 OscLinkProvider 会弹
    // 「could be dangerous」确认框(纯文本链接走 SystemWebLinkProvider,见下)
    linkHandler: createOscLinkHandler(),
    theme: {
      background: '#1e2227',
      foreground: '#d7dae0',
      cursor: '#4a8df8',
      // 半透明蓝色高亮:跟随光标蓝(#4a8df8),透明度让其叠加在任意底色上都明显
      // (含 codex 等 TUI 自绘输入框背景),同时选中文字仍清晰可读。
      // 不可用纯灰 #3e4451——与背景 #1e2227 过近,叠在 TUI 框上几乎不可见。
      selectionBackground: 'rgba(74, 141, 248, 0.40)',
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
    barPin: new BottomBarPin(term),
    sessionId: null,
    spawning: false,
    opened: false,
    firstData: false,
    disposed: false,
    spawnCwd: '',
    callbacks: {},
    client: null,
    hostId: null,
  };
  inst.barPin.setEnabled(pinBottomBarEnabled);

  // FsLinkProvider 在此构造,早于 ensureSession 绑定 inst.client(A6)——不能构造期注入
  // client,须用闭包 call-time 读:spawn 前 inst.client 为 null,兜底本机单例解析链接
  // (未 spawn 的终端里点链接按本机路径找,合理默认);spawn 后随该终端绑定的 host。
  const getClient = (): HostClient => inst.client ?? hostRegistry.local();

  // 网页链接 → 系统默认浏览器。不要使用 xterm WebLinksAddon 的默认
  // window.open 路径,否则 Electron/宿主可能弹确认框或开内置窗口。
  term.registerLinkProvider(new SystemWebLinkProvider(term));
  // 文件/路径链接(file://、绝对、~、相对)→ 校验存在后可点击
  const linkProvider = new FsLinkProvider(
    tabId,
    term,
    () => inst.sessionId,
    () => inst.spawnCwd || (getClient().info?.homedir ?? '/'),
    getClient,
  );
  term.registerLinkProvider(linkProvider);
  // 可视区链接常驻蓝色高亮
  new LinkHighlighter(term, linkProvider).attach();

  // OSC 7:shell 上报当前目录(file://host/path),用于持久化 tab cwd
  term.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7(data);
    if (cwd) inst.callbacks.onCwd?.(cwd);
    return true;
  });

  registry.set(tabId, inst);
  return inst;
}

/**
 * spawn 会话。`hostId` = 该 tab 所属 workspace 的路由键('local'|configId)——
 * tab 生命周期内 host 不变(一个 tab 属一个 ws 属一台机),绑定一次即稳定。
 */
export async function ensureSession(
  tabId: string,
  cwd: string,
  hostId: string,
): Promise<void> {
  const inst = getOrCreateTerminal(tabId);
  if (inst.sessionId || inst.spawning) return;
  inst.spawning = true;
  inst.spawnCwd = cwd;
  inst.hostId = hostId;
  const client = hostRegistry.forWorkspace({ hostId });
  inst.client = client;
  try {
    const { sessionId } = await client.rpc('pty.spawn', {
      cwd,
      cols: inst.term.cols,
      rows: inst.term.rows,
    });
    // spawn 期间 tab 可能已被关闭:立即回收会话,避免 PTY 进程泄漏
    if (inst.disposed) {
      void client.rpc('pty.kill', { sessionId }).catch(() => undefined);
      return;
    }
    inst.sessionId = sessionId;

    client.attachPty(sessionId, {
      onData: (data, bytes) => {
        if (!inst.firstData) {
          inst.firstData = true;
          inst.callbacks.onFirstData?.();
        }
        // 记本 tab 最近输出时刻(前后台 tab 均触发)→ quiet 提示门控判「离开后是否有新增」
        recordOutput(tabId);
        // write 回调 = 数据已被解析消费 → 回执流控
        inst.term.write(data, () => client.ack(sessionId, bytes));
      },
      onExit: (exitCode) => {
        inst.sessionId = null;
        inst.callbacks.onExit?.(exitCode);
      },
      onTitle: (processName) => inst.callbacks.onTitle?.(processName),
    });

    inst.term.onData((d) => {
      if (inst.sessionId) client.input(inst.sessionId, d);
    });
    inst.term.onResize(({ cols, rows }) => {
      if (inst.sessionId) client.resize(inst.sessionId, cols, rows);
    });
    // spawn 进行期间 fit 可能已改变终端尺寸(onResize 当时未注册),
    // 主动同步一次当前尺寸,避免 TUI 以 80x24 启动
    client.resize(sessionId, inst.term.cols, inst.term.rows);
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

/**
 * 反查:(hostId, sessionId) 复合键 → tabId(会话事件路由用)。
 * sessionId 仅 per-host 唯一(各机 ptyPool 本地计数器),单键反查会让本机 + 远程的
 * 同名 sessionId 串 tab(ARCH-9)——复合键防串号。
 */
export function findTab(hostId: string, sessionId: string): string | null {
  for (const [tabId, inst] of registry) {
    if (inst.hostId === hostId && inst.sessionId === sessionId) return tabId;
  }
  return null;
}

/**
 * 设置「底部输入栏固定」变更 → 记为新终端默认 + 实时应用到所有已存在终端:
 * 切 scrollOnUserInput(关→打字回底)+ 开关 BottomBarPin(关→隐藏面板)。
 */
export function applyPinBottomBar(enabled: boolean): void {
  pinBottomBarEnabled = enabled;
  for (const inst of registry.values()) {
    inst.term.options.scrollOnUserInput = !enabled;
    inst.barPin.setEnabled(enabled);
  }
}

export function disposeTerminal(tabId: string): void {
  const inst = registry.get(tabId);
  if (!inst) return;
  inst.disposed = true;
  if (inst.sessionId && inst.client) {
    void inst.client.rpc('pty.kill', { sessionId: inst.sessionId }).catch(() => {
      /* host 可能已回收 */
    });
  }
  inst.barPin.dispose();
  if (inst.webgl) {
    disposeWebglAddon(inst.webgl);
    inst.webgl = null;
  }
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
