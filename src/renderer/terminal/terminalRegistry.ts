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
import type { SessionAttachResult, SessionSnapshot } from '../../shared/protocol';
import {
  createOscLinkHandler,
  FsLinkProvider,
  LinkHighlighter,
  SystemWebLinkProvider,
} from './terminalLinks';
import { BottomBarPin } from './bottomBarPin';
import { disposeWebglAddon } from './webglContextRelease';
import { t } from '../../shared/i18n';

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
  /**
   * BL-005(ARCH-B-4):已接收字节高水位(绝对偏移)。🔴 在 onData 里**同步累加**(term.write 之前·
   * 非 write 回调)——重连 session.attach 报 resumeOffset=renderedBytes,host 只回放
   * [resumeOffset, absoluteOffset) 的 gap;若用 write 回调式记账,attach 时在途未回调 chunk 会被
   * host 重放 = 双写。收养后权威赋值 renderedBytes = result.nextOffset(不自算 byteLength·EXT-B-5)。
   */
  renderedBytes: number;
  /**
   * BL-005(CR-5):收养回放期冻结 live 投递。session.attach 的回放切片须**先写入**·再 append
   * 断开后新到的 live pty:data(否则两条独立路径天然时序不保·乱序/重复)。replaying 期 onData
   * 入 replayQueue,回放切片写完后按序 flush 再解冻。
   */
  replaying: boolean;
  replayQueue: Array<{ data: string; bytes: number }>;
  /** BL-005(AC-12):standalone 会话在 host 已 exited(退出留存)。渲染「已完成」徽标·**不 dispose**。 */
  exited: boolean;
  /** term.onData/onResize 输入接线已挂(inst 生命周期内只挂一次,防双发·见 wireInputOnce)。 */
  inputWired: boolean;
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
    renderedBytes: 0,
    replaying: false,
    replayQueue: [],
    exited: false,
    inputWired: false,
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
      onData: (data, bytes) => ingestPtyData(inst, tabId, client, sessionId, data, bytes),
      onExit: (exitCode) => {
        inst.exited = true;
        // standalone/远程:保留 sessionId 以便重连回放最终 scrollback(不 dispose·AC-12);
        // 本地嵌入式:照旧当场回收
        if (!client.reconnectable) inst.sessionId = null;
        inst.callbacks.onExit?.(exitCode);
      },
      onTitle: (processName) => inst.callbacks.onTitle?.(processName),
    });

    wireInputOnce(inst);
    // spawn 进行期间 fit 可能已改变终端尺寸(onResize 当时未注册),
    // 主动同步一次当前尺寸,避免 TUI 以 80x24 启动
    client.resize(sessionId, inst.term.cols, inst.term.rows);
  } catch (err) {
    // 失败必须在终端里说话,不许无声死 tab
    const message = err instanceof Error ? err.message : String(err);
    inst.term.writeln(
      `\x1b[31m${t('[TermPro] Terminal failed to start: {message}', { message })}\x1b[0m`,
    );
    inst.term.writeln(`\x1b[2m${t('Close this tab and reopen it to retry')}\x1b[0m`);
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

/**
 * 消费一段 pty 输出(BL-005·单一入口·ensureSession 与 path② 共用):
 * 🔴 renderedBytes **同步累加**(term.write 之前·非 write 回调·ARCH-B-4)——用 host 算好的
 * `bytes` 字段累加(**不用** data.length·CJK/emoji 场景字符数≠字节数)。ack 仍留 write 回调(背压
 * 语义不变·与游标解耦)。回放冻结期(inst.replaying)入 replayQueue,待回放切片写完再按序 flush(CR-5)。
 */
export function ingestPtyData(
  inst: TermInstance,
  tabId: string,
  client: HostClient,
  sessionId: string,
  data: string,
  bytes: number,
): void {
  if (inst.replaying) {
    inst.replayQueue.push({ data, bytes });
    return;
  }
  if (!inst.firstData) {
    inst.firstData = true;
    inst.callbacks.onFirstData?.();
  }
  recordOutput(tabId);
  inst.renderedBytes += bytes; // 已接收高水位(同步·term.write 之前)
  inst.term.write(data, () => client.ack(sessionId, bytes));
}

/** 解冻:回放切片写完后,按序 flush 冻结期到达的 live 切片(append 在回放之后·不重不乱)。 */
function flushReplayQueue(
  inst: TermInstance,
  tabId: string,
  client: HostClient,
  sessionId: string,
): void {
  const queued = inst.replayQueue;
  inst.replayQueue = [];
  for (const chunk of queued) {
    if (!inst.firstData) {
      inst.firstData = true;
      inst.callbacks.onFirstData?.();
    }
    recordOutput(tabId);
    inst.renderedBytes += chunk.bytes;
    inst.term.write(chunk.data, () => client.ack(sessionId, chunk.bytes));
  }
}

/**
 * term.onData/onResize 输入接线,inst 生命周期内只挂一次(幂等)。
 * 🔴 ensureSession 与 wireLiveSession 可能先后触达同一 inst(收养 attach miss 后原位
 * 重 spawn·幽灵 tab 挂载重 spawn),xterm 的 onData 是【累加】注册——重复挂载会让每次
 * 击键双发 input。handler 读 inst.client/inst.sessionId 现值(respawn 换会话/换 client
 * 后仍路由正确),不闭包捕获挂载时的 client。
 */
function wireInputOnce(inst: TermInstance): void {
  if (inst.inputWired) return;
  inst.inputWired = true;
  inst.term.onData((d) => {
    if (inst.sessionId && inst.client) inst.client.input(inst.sessionId, d);
  });
  inst.term.onResize(({ cols, rows }) => {
    if (inst.sessionId && inst.client) inst.client.resize(inst.sessionId, cols, rows);
  });
}

/** live 会话接线(attachPty + onData 消费 + input/resize 反向)。ensureSession 与 path② 重建共用。 */
function wireLiveSession(
  inst: TermInstance,
  tabId: string,
  client: HostClient,
  sessionId: string,
): void {
  client.attachPty(sessionId, {
    onData: (data, bytes) => ingestPtyData(inst, tabId, client, sessionId, data, bytes),
    onExit: (exitCode) => {
      inst.exited = true;
      if (!client.reconnectable) inst.sessionId = null;
      inst.callbacks.onExit?.(exitCode);
    },
    onTitle: (processName) => inst.callbacks.onTitle?.(processName),
  });
  wireInputOnce(inst);
}

/**
 * 收养一个 inst 的既有会话(BL-005·CR-5 回放顺序):session.attach → full 则 term.reset() 后写 data·
 * 否则增量 write → 🔴 renderedBytes = result.nextOffset(权威·不自算 byteLength·EXT-B-5)。
 * 全程冻结 live 投递(inst.replaying),回放切片写完再解冻 flush(先回放后 append·不双写)。
 */
async function adoptInst(
  inst: TermInstance,
  tabId: string,
  client: HostClient,
  sessionId: string,
  resumeOffset: number,
): Promise<SessionAttachResult> {
  inst.replaying = true;
  try {
    const result = await client.rpc('session.attach', {
      sessionId,
      resumeOffset,
      cols: inst.term.cols,
      rows: inst.term.rows,
    });
    if (!result.found) return result;
    if (result.full) inst.term.reset(); // gap 超缓冲 / 重建 tab → 先清屏
    if (result.data) inst.term.write(result.data);
    inst.renderedBytes = result.nextOffset; // 权威推进(非 baseOffset + byteLength)
    return result;
  } finally {
    inst.replaying = false;
    flushReplayQueue(inst, tabId, client, sessionId);
  }
}

/** readoptHost 的 store/registry 接线钩子(store-coupled 的默认由调用方注入·避免 registry↔store 循环)。 */
export interface ReadoptHooks {
  /** 据快照对账徽标(AC-5·running→idle / exited 完成)。默认 no-op。 */
  reconcileBadge?(hostId: string, sessionId: string, snapshot: SessionSnapshot): void;
  /** path②:session.list 有本地无 inst → 据快照重建 tab,返回 tabId(null=不重建)。默认不重建。 */
  rebuildTab?(hostId: string, snapshot: SessionSnapshot): string | null;
  // 以下 registry-coupled,默认内部实现,单测可覆盖:
  getClient?(hostId: string): HostClient | null;
  listInstances?(): Array<[string, TermInstance]>;
  getOrCreateInst?(tabId: string): TermInstance;
  spawnNew?(tabId: string, cwd: string, hostId: string): Promise<void>;
  wireLiveSession?(
    inst: TermInstance,
    tabId: string,
    client: HostClient,
    sessionId: string,
  ): void;
}

/**
 * 重连收养编排(BL-005·AC-3/4/5/11/12·渲染层单源)。两路径:
 * - 路径①闪断(inst 存活·GO-006):该 host 全部持 sessionId 的 inst → session.attach(renderedBytes)
 *   → full 清屏全量 / 否则增量 → renderedBytes=nextOffset;found=false → new spawn(幂等收养 miss)。
 * - 路径②重建(session.list 有本地无 inst·EXT-B-3):据快照重建 tab + attach(resumeOffset=0)全量回放。
 * 能力位缺失(旧 host)→ 不发 list/attach,每个 inst 直接 new spawn(QA-B-5)。收养后据快照对账徽标。
 */
export async function readoptHost(
  configId: string,
  hooks: ReadoptHooks = {},
): Promise<void> {
  const getClient = hooks.getClient ?? ((id) => hostRegistry.forHostId(id));
  const listInstances = hooks.listInstances ?? (() => [...registry.entries()]);
  const getOrCreateInst = hooks.getOrCreateInst ?? getOrCreateTerminal;
  const spawnNew = hooks.spawnNew ?? ensureSession;
  const wireLive = hooks.wireLiveSession ?? wireLiveSession;
  const reconcileBadge = hooks.reconcileBadge ?? (() => undefined);
  const rebuildTab = hooks.rebuildTab ?? (() => null);

  const client = getClient(configId);
  if (!client) return;

  const insts = listInstances().filter(
    ([, inst]) => inst.hostId === configId && inst.sessionId,
  );

  // 能力位缺失(旧 host 无 session.resume)→ 不发 list/attach,每个 inst 直接 new spawn(QA-B-5)
  if (!client.supportsSessionResume()) {
    for (const [tabId, inst] of insts) {
      inst.sessionId = null;
      inst.renderedBytes = 0;
      inst.exited = false;
      await spawnNew(tabId, inst.spawnCwd, configId);
    }
    return;
  }

  const adoptedSids = new Set<string>();

  // 路径①闪断:逐 inst 收养
  for (const [tabId, inst] of insts) {
    const sid = inst.sessionId as string;
    const result = await adoptInst(inst, tabId, client, sid, inst.renderedBytes);
    if (!result.found) {
      // 幂等收养 miss(被逐/从未有)→ new spawn(不误把旧 scrollback 当 gap 追加)
      inst.sessionId = null;
      inst.renderedBytes = 0;
      inst.exited = false;
      await spawnNew(tabId, inst.spawnCwd, configId);
      continue;
    }
    adoptedSids.add(sid);
    inst.exited = result.snapshot.status === 'exited';
    reconcileBadge(configId, sid, result.snapshot);
  }

  // 路径②重建:session.list 有、本地无 inst → 重建 tab 全量回放
  let sessions: SessionSnapshot[];
  try {
    const res = await client.rpc('session.list', undefined);
    sessions = res.sessions;
  } catch {
    return; // list 失败(旧 core 未知 method 等)→ 止步路径②
  }
  const localSids = new Set(
    listInstances()
      .filter(([, inst]) => inst.hostId === configId && inst.sessionId)
      .map(([, inst]) => inst.sessionId as string),
  );
  for (const snap of sessions) {
    if (adoptedSids.has(snap.sessionId) || localSids.has(snap.sessionId)) continue;
    const tabId = rebuildTab(configId, snap);
    if (!tabId) continue;
    const inst = getOrCreateInst(tabId);
    inst.hostId = configId;
    inst.client = client;
    inst.spawnCwd = snap.cwd;
    inst.sessionId = snap.sessionId;
    inst.renderedBytes = 0;
    inst.exited = false;
    wireLive(inst, tabId, client, snap.sessionId);
    const result = await adoptInst(inst, tabId, client, snap.sessionId, 0);
    if (!result.found) {
      inst.sessionId = null;
      continue;
    }
    inst.exited = result.snapshot.status === 'exited';
    reconcileBadge(configId, snap.sessionId, result.snapshot);
  }
}

/**
 * 恢复 tab 的会话预绑定(远程 tab 布局恢复 · 用户规则 2026-07)。客户端重启/full-drop
 * 后由 restoreRemoteTabLayouts 调用:存档里带 sessionId 的恢复 tab,**同步**把 inst 绑到
 * 该会话并接好 live 管线——两重作用:
 *  ① TerminalView 挂载的 ensureSession 见 sessionId 即短路,不抢先 new spawn(与收养竞态);
 *  ② readoptHost 路径① 把它当「闪断存活 inst」收养:host 存活 → session.attach 全量回放
 *    (内容白赚回来);host 已重启 → found=false → 原位重 spawn(内容丢,tab 名称/顺序保住)。
 * client 未命中(该 host 未连接——不该发生,恢复恒在 host ready 后)→ 不绑定,挂载走
 * 正常 new spawn(安全降级)。
 */
export function bindRestoredSessionTab(
  tabId: string,
  hostId: string,
  sessionId: string,
  cwd: string,
): void {
  const client = hostRegistry.forHostId(hostId);
  if (!client) return;
  const inst = getOrCreateTerminal(tabId);
  if (inst.sessionId || inst.spawning) return; // 已 spawn/已绑定 → 不覆盖
  inst.hostId = hostId;
  inst.client = client;
  inst.spawnCwd = cwd;
  inst.sessionId = sessionId;
  inst.renderedBytes = 0;
  inst.exited = false;
  wireLiveSession(inst, tabId, client, sessionId);
}

/** 仅测试:直接注入一个 inst(test-double term / fake client),绕过真 xterm 构造。 */
export function __setInstForTest(tabId: string, inst: TermInstance): void {
  registry.set(tabId, inst);
}

/** 仅测试:清空注册表(用例间隔离)。 */
export function __clearRegistryForTest(): void {
  registry.clear();
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
