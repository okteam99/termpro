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
import { installRemoteClipboardPasteHandler } from './remoteClipboardPaste';
import { parseOsc52 } from './osc52';
import { RemotePasteInputBarrier } from './remotePasteInputBarrier';
import { browserMcpEnvFor } from './browserMcpEnv';

export interface TermCallbacks {
  onTitle?(processName: string): void;
  onExit?(exitCode: number): void;
  onCwd?(cwd: string): void;
  onFirstData?(): void;
  onNotice?(message: string): void;
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
   * 本会话最后一次在 host 侧建立归属(pty.spawn / session.attach 成功)时的 client 连接代次
   * (HostClient.epoch)。与 client.epoch 现值不等 = 这条会话在**当前**连接上没有归属:
   * host 的 pty:input 门会静默丢弃击键、也不会给本端推 pty:data —— 即「连着但终端卡死」。
   * -1 = 从未 attach 过(如 bindRestoredSessionTab 的预绑定),同样视为需要重新收养。
   */
  attachedEpoch: number;
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
  /** 本端订阅被另一设备 exclusive attach 摘除(M2 session:takenover);
   *  tab 重新激活时自动 mirror re-attach 取回(remirrorIfTakenOver)。 */
  takenover: boolean;
  /** 远程剪贴板图片上传期的输入顺序屏障;完成后图片路径先于随后键入发送。 */
  remotePaste: {
    barrier: RemotePasteInputBarrier;
    client: HostClient;
    sessionId: string;
  } | null;
  /** installRemoteClipboardPasteHandler disposer:tab 关闭时标记异步流程失效。 */
  remotePasteDispose: (() => void) | null;
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
    // OSC 8 超链接 → 内置浏览器优先(⌘/Ctrl+点击走系统浏览器),否则 xterm 核心
    // OscLinkProvider 会弹「could be dangerous」确认框(纯文本链接走
    // SystemWebLinkProvider,见下,同一条激活路由)
    linkHandler: createOscLinkHandler(tabId),
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
    attachedEpoch: -1,
    renderedBytes: 0,
    replaying: false,
    replayQueue: [],
    exited: false,
    inputWired: false,
    takenover: false,
    remotePaste: null,
    remotePasteDispose: null,
  };
  inst.barPin.setEnabled(pinBottomBarEnabled);

  // 一实例只接一次:远程 Ctrl+V 由本机 Electron 读剪贴板,PNG 经该实例绑定的
  // HostClient 落到远端,再以 bracketed paste 路径送入 TUI。本地会话完全放行原快捷键。
  inst.remotePasteDispose = installRemoteClipboardPasteHandler(term, {
    isRemote: () => inst.hostId !== null && inst.hostId !== 'local',
    readImage: () => window.okwork.clipboardReadImage(),
    readText: () => window.okwork.clipboardReadText(),
    begin: () => {
      const sessionId = inst.sessionId;
      if (inst.disposed || !sessionId) throw new Error('remote terminal is not ready');
      // 🔴 断链后尚未重新收养(2026-07-27 用户实测:Ctrl+V 报「host not connected」而侧栏
      // 显示 90ms 连接正常——那是**另一个** client 实例的心跳,inst 还攥着已 dispose 的旧
      // 实例,fs.writeTempFile 打进它的 null transport)。同步迁到该 host 的当前实例,让本
      // 次上传就能成;再后台自愈重收养,随后 bracketed paste 的键入才有 host 侧归属可落。
      if (!attachedOnCurrentConnection(inst)) {
        const live = inst.hostId ? hostRegistry.forHostId(inst.hostId) : null;
        if (live) rebindInstClient(inst, tabId, live, sessionId, wireLiveSession);
        void ensureAttached(tabId);
      }
      const client = inst.client;
      if (!client) throw new Error('remote terminal is not ready');
      inst.remotePaste = {
        barrier: new RemotePasteInputBarrier(),
        client,
        sessionId,
      };
    },
    writeImage: async (image) => {
      const pending = inst.remotePaste;
      if (
        inst.disposed ||
        !pending ||
        inst.client !== pending.client ||
        inst.sessionId !== pending.sessionId
      ) {
        throw new Error('remote terminal session changed while reading the clipboard');
      }
      const { client, sessionId } = pending;
      // 能力门必须晚于剪贴板类型判断:旧 Host 仍应能粘贴本机纯文本,仅图片需要新 RPC。
      // 正常已不可达(连接时过旧 host 会被升级 · 用户规则 2026-07-13),留作防御。
      if (!client.supportsTempPng()) {
        throw new Error(
          t(
            'The Remote Host is running an older version; reconnect the remote host to upgrade it and enable image paste',
          ),
        );
      }
      const result = await client.rpc('fs.writeTempFile', {
        kind: 'png',
        base64: image.base64,
      });
      // 上传期间若断线收养/respawn,绝不把旧机路径注入新会话。
      if (inst.disposed || inst.client !== client || inst.sessionId !== sessionId) {
        throw new Error('remote terminal session changed while uploading the image');
      }
      return result;
    },
    paste: (text) => {
      const pending = inst.remotePaste;
      if (!pending) throw new Error('remote paste input barrier is unavailable');
      if (
        inst.disposed ||
        inst.client !== pending.client ||
        inst.sessionId !== pending.sessionId
      ) {
        throw new Error('remote terminal session changed while uploading the image');
      }
      pending.barrier.inject(() => term.paste(text));
    },
    end: () => {
      const pending = inst.remotePaste;
      inst.remotePaste = null;
      if (!pending || inst.disposed) return;
      // 会话已换:旧会话上下文中的路径与随后键入都不能串进新会话。
      if (inst.client !== pending.client || inst.sessionId !== pending.sessionId) return;
      for (const data of pending.barrier.drain()) {
        pending.client.input(pending.sessionId, data);
      }
    },
    notify: (message) => inst.callbacks.onNotice?.(message),
  });

  // FsLinkProvider 在此构造,早于 ensureSession 绑定 inst.client(A6)——不能构造期注入
  // client,须用闭包 call-time 读:spawn 前 inst.client 为 null,兜底本机单例解析链接
  // (未 spawn 的终端里点链接按本机路径找,合理默认);spawn 后随该终端绑定的 host。
  const getClient = (): HostClient => inst.client ?? hostRegistry.local();

  // 网页链接 → 内置浏览器优先(落到本终端 tab 的浏览器窗格;⌘/Ctrl+点击走系统
  // 浏览器)。不要使用 xterm WebLinksAddon 的默认 window.open 路径,否则
  // Electron/宿主可能弹确认框或开内置窗口。
  term.registerLinkProvider(new SystemWebLinkProvider(tabId, term));
  // 文件/路径链接(file://、绝对、~、相对)→ 校验存在后可点击
  const linkProvider = new FsLinkProvider(
    tabId,
    term,
    () => inst.sessionId,
    () => inst.spawnCwd || (getClient().info?.homedir ?? '/'),
    getClient,
    () => inst.hostId,
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

  // OSC 52:程序 → 本机剪贴板(远程会话里程序看不到本机剪贴板,这是唯一通道)。
  // xterm.js 不内建,不注册则整条序列进黑洞。读请求/越界/非法载荷由 parseOsc52 挡掉
  // (安全边界见该文件头);恒返 true —— 已识别并处置,不再交给内建/上层。
  term.parser.registerOscHandler(52, (data) => {
    const text = parseOsc52(data);
    if (text !== null) window.okwork.clipboardWriteText(text);
    return true;
  });

  // 🔴 DECRQM(请求模式 · `CSI ? mode $ p` / `CSI mode $ p`)拦截修复
  // (用户报告 2026-07-15「进 vim 卡死」根因):xterm 自带 requestMode 在【线上压缩
  // 包】里抛 `ReferenceError: i is not defined`——esbuild 二次压缩破坏了该方法内
  // `const i = this._coreService.decPrivateModes` 的作用域(dev 不压缩不复现;
  // top/seq/裸 vim 不发 DECRQM 不触发;带 termguicolors/syntax 的 vim 进入时发
  // DECRQM 查询 → requestMode 崩 → 解析写入循环 throw → 该终端从此不再处理任何
  // 输出 = 冻死,Ctrl-C 也无回显)。自注册 handler 拦在内建 requestMode 之前
  // (同选择器·后注册者先被调,返回 true 即跳过崩溃的内建),回「未识别(0)」应答
  // 让 vim/TUI 按默认继续(所查多为可选特性,未识别=不启用该优化,不影响正确性)。
  const answerDecrqm = (params: (number | number[])[], dec: boolean): boolean => {
    const p0 = params[0];
    const mode = typeof p0 === 'number' ? p0 : Array.isArray(p0) ? (p0[0] ?? 0) : 0;
    if (inst.sessionId && inst.client) {
      inst.client.input(inst.sessionId, `\x1b[${dec ? '?' : ''}${mode};0$y`);
    }
    return true;
  };
  term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, (p) =>
    answerDecrqm(p, true),
  );
  term.parser.registerCsiHandler({ intermediates: '$', final: 'p' }, (p) =>
    answerDecrqm(p, false),
  );

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
  // 🔴 到这里必是「全新会话」(首次 spawn,或旧会话已判定收养失败/找不到后原位重 spawn
  // 到同一个跨挂载存活的 xterm 实例——如 remirrorIfTakenOver 的 !found 分支)。旧会话若
  // 曾开鼠标跟踪(vim/claude TUI 等发的 `?1000h`/`?1002h`/`?1006h`)又被异常终止(host 被
  // kill、连接掉线)而未来得及发关闭序列,xterm 的模式状态是纯前端存量,不会随死会话
  // 一起消失——不 reset 就会带进新会话:新 shell 从没开过鼠标跟踪,却把触控板移动的
  // SGR 报文当成键入,刷屏 `command not found`(2026-07-20 事故)。reset() 与 adoptInst
  // 的 full-resync 分支同款语义,清屏无副作用(全新/已死会话的旧内容本就不该续显)。
  inst.term.reset();
  inst.spawning = true;
  inst.spawnCwd = cwd;
  inst.hostId = hostId;
  const client = hostRegistry.forWorkspace({ hostId });
  inst.client = client;
  try {
    // AI 浏览器 MCP:注入该 tab 绑定的端点 URL 进 pty env(SpawnOptions.env,host 合并进
    // pty),agent 据此连上驱动浏览器。本地=本机 MCP base;远程=容器回环反向转发口。
    // await:确保 base 拉取完成再 spawn(规避 hydrate 首个终端漏注入的竞态)。
    const mcpEnv = await browserMcpEnvFor(tabId, hostId);
    const { sessionId } = await client.rpc('pty.spawn', {
      cwd,
      cols: inst.term.cols,
      rows: inst.term.rows,
      ...(mcpEnv ? { env: mcpEnv } : {}),
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
        // host 保留 exited 会话(session.resume 能力位)→ 留 sessionId 供重载/重连回放最终
        // scrollback(AC-12);无能力位(旧 host/embedded 兜底)→ 照旧当场回收。
        // 🔴 判据是 host 会话语义而非传输可重连性:本地 standalone 化后 MessagePort 传输
        // (reconnectable=false)同样保留 exited 会话。
        if (!client.supportsSessionResume()) inst.sessionId = null;
        inst.callbacks.onExit?.(exitCode);
      },
      onTitle: (processName) => inst.callbacks.onTitle?.(processName),
      onTakenover: () => markTakenover(inst),
      onDesynced: () => void resyncDesynced(inst, tabId),
    });

    wireInputOnce(inst, tabId);
    inst.attachedEpoch = clientEpoch(client); // 归属建立在这一代连接上
    // spawn 进行期间 fit 可能已改变终端尺寸(onResize 当时未注册),
    // 主动同步一次当前尺寸,避免 TUI 以 80x24 启动
    client.resize(sessionId, inst.term.cols, inst.term.rows);
  } catch (err) {
    // 失败必须在终端里说话,不许无声死 tab
    const message = err instanceof Error ? err.message : String(err);
    inst.term.writeln(
      `\x1b[31m${t('[OkWork] Terminal failed to start: {message}', { message })}\x1b[0m`,
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
  pendingInput.delete(tabId);
  healingTabs.delete(tabId);
  inst.remotePasteDispose?.();
  inst.remotePasteDispose = null;
  inst.remotePaste = null;
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
function wireInputOnce(inst: TermInstance, tabId: string): void {
  if (inst.inputWired) return;
  inst.inputWired = true;
  inst.term.onData((d) => {
    if (inst.remotePaste) {
      inst.remotePaste.barrier.capture(d);
    } else {
      deliverInput(tabId, d);
    }
  });
  inst.term.onResize(({ cols, rows }) => {
    if (inst.sessionId && inst.client) inst.client.resize(inst.sessionId, cols, rows);
  });
}

/** 读 client 连接代次;测试桩/旧实现无该字段 → -1(与 inst 初值一致 = 不触发自愈)。 */
function clientEpoch(client: HostClient | null): number {
  const e = (client as { epoch?: number } | null)?.epoch;
  return typeof e === 'number' ? e : -1;
}

/** 该 inst 的会话在**当前**连接上还有 host 侧归属吗(见 TermInstance.attachedEpoch)。 */
function attachedOnCurrentConnection(inst: TermInstance): boolean {
  return inst.attachedEpoch === clientEpoch(inst.client);
}

/** 自愈期攒下的击键上限(只留末尾:ctrl+c 这类「最新的那下」才是用户真正想送达的)。 */
const MAX_PENDING_INPUT = 4096;
/** tabId → 自愈期攒下的击键 */
const pendingInput = new Map<string, string>();
/** tabId → 自愈在途(去重:一串击键只触发一轮重收养) */
const healingTabs = new Set<string>();

/**
 * 键入投递单一入口(wireInputOnce 的 onData / 单测)。
 * 🔴 断链后未重新收养的会话不再直发(2026-07-27「终端卡死、ctrl+c 不起作用」):host 的
 * pty:input 门只认当前连接的归属,直发 = 静默丢进黑洞,用户砸多少下都没反应,只能靠
 * 「断开重连机器」自救。改为:攒住击键 → 就地重新收养(session.attach 重建归属 + 回放
 * 断开期输出)→ 成功后按序补发。收养失败则丢弃本轮攒的键(不留到几分钟后突然诈尸),
 * 下一次击键再试一轮。
 */
export function deliverInput(tabId: string, data: string): void {
  const inst = registry.get(tabId);
  if (!inst || inst.disposed || !inst.sessionId || !inst.client) return;
  if (attachedOnCurrentConnection(inst)) {
    inst.client.input(inst.sessionId, data);
    return;
  }
  const queued = (pendingInput.get(tabId) ?? '') + data;
  pendingInput.set(
    tabId,
    queued.length > MAX_PENDING_INPUT ? queued.slice(-MAX_PENDING_INPUT) : queued,
  );
  if (healingTabs.has(tabId)) return;
  healingTabs.add(tabId);
  void healDetached(inst, tabId)
    .then((ok) => {
      const buffered = pendingInput.get(tabId) ?? '';
      pendingInput.delete(tabId);
      // ok=false 含「会话已不在 host → 原位重 spawn」:那是全新 shell,旧击键不补发
      if (ok && buffered && inst.sessionId && inst.client) {
        inst.client.input(inst.sessionId, buffered);
      }
    })
    .catch((err) => {
      pendingInput.delete(tabId);
      console.warn('[terminalRegistry] input self-heal failed tabId=%s', tabId, err);
    })
    .finally(() => healingTabs.delete(tabId));
}

/** 回放在途时的等待节拍/上限(上限 > RPC 超时,attach 再慢也会落定)。 */
const REPLAY_WAIT_TICK_MS = 50;
const REPLAY_WAIT_MAX_MS = 20_000;

/**
 * 自愈总入口:已有一轮回放/收养在途(readopt、desync 重同步、tab 激活取回)就**等它落定**,
 * 不并发再发一次 session.attach —— 两条 attach 各按调用当时的 renderedBytes 报 resumeOffset,
 * 后发的那条拿到过时偏移,host 会把同一段再回放一遍(屏幕重复)。等完若归属已重建(代次
 * 追平)即视作成功,攒下的击键照常补发。
 */
async function healDetached(inst: TermInstance, tabId: string): Promise<boolean> {
  if (inst.replaying) {
    const deadline = Date.now() + REPLAY_WAIT_MAX_MS;
    while (inst.replaying && !inst.disposed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, REPLAY_WAIT_TICK_MS));
    }
    if (attachedOnCurrentConnection(inst)) return true;
  }
  return reattachDetached(inst, tabId);
}

/**
 * 就地重新收养一条「当前连接上无归属」的会话(输入自愈 / tab 激活时调用)。
 * 迁到路由现值 client(实例可能已被换掉)→ session.attach 重建归属 + 回放断开期输出。
 * 返回是否仍是**原会话**(found=false → 会话已被回收,原位重 spawn 后返 false)。
 */
async function reattachDetached(inst: TermInstance, tabId: string): Promise<boolean> {
  const sessionId = inst.sessionId;
  const hostId = inst.hostId;
  if (!sessionId || !hostId || inst.disposed) return false;
  const client = hostRegistry.forHostId(hostId);
  if (!client) return false;
  rebindInstClient(inst, tabId, client, sessionId, wireLiveSession);
  const result = await adoptInst(inst, tabId, client, sessionId, inst.renderedBytes);
  if (!result.found) {
    inst.sessionId = null;
    inst.renderedBytes = 0;
    inst.exited = false;
    await ensureSession(tabId, inst.spawnCwd, hostId);
    return false;
  }
  inst.exited = result.snapshot.status === 'exited';
  return true;
}

/**
 * tab 激活时的会话可用性兜底(TerminalView):当前连接上没归属就重新收养。
 * 与输入自愈同一条路径——用户切回一个断链期间没收养成功的 tab,不必先盲敲一下才复活。
 */
export async function ensureAttached(tabId: string): Promise<void> {
  const inst = registry.get(tabId);
  if (!inst || inst.disposed || !inst.sessionId || !inst.client) return;
  if (attachedOnCurrentConnection(inst) || healingTabs.has(tabId)) return;
  healingTabs.add(tabId);
  try {
    await healDetached(inst, tabId);
  } catch (err) {
    console.warn('[terminalRegistry] reattach on activate failed tabId=%s', tabId, err);
  } finally {
    healingTabs.delete(tabId);
  }
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
      // 同 ensureSession.onExit:按 host 会话语义(session.resume)而非传输可重连性判留
      if (!client.supportsSessionResume()) inst.sessionId = null;
      inst.callbacks.onExit?.(exitCode);
    },
    onTitle: (processName) => inst.callbacks.onTitle?.(processName),
    onTakenover: () => markTakenover(inst),
    onDesynced: () => void resyncDesynced(inst, tabId),
  });
  wireInputOnce(inst, tabId);
}

/**
 * 落后被 host 剔出增量流(session:desynced · M2 收尾评审 P2-1)→ 立即 mirror
 * re-attach 全量重同步(gap 超 ring → host 切片天然 full=true → term.reset 补屏),
 * 把「静默冻屏直到重连」变成「自动重同步」。replaying 期间(已有一轮回放在途)跳过
 * ——host 对新订阅重置 desync,若再次落后会再发事件,不丢恢复机会。
 */
async function resyncDesynced(inst: TermInstance, tabId: string): Promise<void> {
  const client = inst.client;
  const sessionId = inst.sessionId;
  if (!client || !sessionId || inst.replaying || inst.disposed) return;
  const result = await adoptInst(inst, tabId, client, sessionId, inst.renderedBytes);
  if (!result.found) {
    inst.sessionId = null;
  }
}

/**
 * 本端订阅被另一设备 exclusive attach 摘除(M2 最小提示;完整「点击取回」UI 归 M3):
 * 置标记 + 终端里写一行说明。会话在 host 仍活,tab 重新激活时 remirrorIfTakenOver
 * 自动 mirror re-attach 取回(全量/增量由 host 切片决定)。
 */
function markTakenover(inst: TermInstance): void {
  if (inst.takenover) return;
  inst.takenover = true;
  inst.term.writeln(
    `\r\n\x1b[2m${t('[OkWork] Session mirrored on another device took exclusive control — switch back to this tab to re-mirror')}\x1b[0m`,
  );
}

/**
 * 把 inst 迁到该 host 的当前 HostClient 实例(同实例 = 廉价 no-op)。
 * client 实例只在「手动断开/删机 → hostRegistry.drop → 重连 getOrCreateRemote」时被换掉;
 * 闪断重连复用同一实例(内部换 transport),故此路径平时不触发。
 * 迁移三步:摘旧实例残留监听(防双写)→ 换指针 → 在新实例上重挂 live 管线。
 */
function rebindInstClient(
  inst: TermInstance,
  tabId: string,
  client: HostClient,
  sessionId: string,
  wireLive: (
    inst: TermInstance,
    tabId: string,
    client: HostClient,
    sessionId: string,
  ) => void,
): void {
  if (inst.client === client) return;
  inst.client?.detachPty?.(sessionId);
  inst.client = client;
  wireLive(inst, tabId, client, sessionId);
}

/** 备用屏进入序列(1049 现代 / 1047 · 47 老式):切片自含则不补写快照模式(见 adoptInst)。 */
const ALT_ENTER_RE = /\x1b\[\?(?:1049|1047|47)h/;

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
      // M2:host 支持镜像 → 订阅式收养(多端同屏,不摘他端);旧 host 不带 mode
      // → host 侧按 exclusive(last-attach-wins),行为与 BL-005 现状一致(零破坏)。
      // 可选调用:旧测试桩/精简实现可缺省该方法 → 视同不支持(fail-safe 降级)。
      ...(client.supportsSessionMirror?.() ? { mode: 'mirror' as const } : {}),
    });
    if (!result.found) return result;
    if (result.full) {
      inst.term.reset(); // gap 超缓冲 / 重建 tab → 先清屏
      // ring 只存字节:TUI 开机时的模式序列常被挤出全量切片,reset 后 xterm 不知远端
      // 已处于该模式。据 host 快照恢复(写本地 xterm 解析,不进 PTY);先于切片写入——
      // 切片内若还有模式翻转,以切片为准(快照=切片末尾态,终态一致)。
      //
      // ?1049h(备用屏):远端是全屏 TUI 而进入序列被挤出时,整段备用屏重绘会落进主屏,
      // 且 TUI 的差分重绘基于我们没有的屏幕态 → 大片空白 + 碎片(用户实测截图)。
      // 🔴 仅在切片【自身不含】进入序列时补:否则 xterm 的 ?1049h 会再清一次备用屏,
      // 把切片里本属主屏(scrollback)的内容画进备用屏又抹掉。
      if (result.snapshot.altscreen && !ALT_ENTER_RE.test(result.data)) {
        inst.term.write('\x1b[?1049h');
      }
      // ?2004h(bracketed paste):不恢复则 term.paste 不加 200~/201~ 包裹,远端 TUI
      // 把长文本粘贴当逐键输入(不聚合)。无视觉副作用,无需上面的「切片自含」判别。
      if (result.snapshot.bracketedPaste) inst.term.write('\x1b[?2004h');
    }
    if (result.data) inst.term.write(result.data);
    inst.renderedBytes = result.nextOffset; // 权威推进(非 baseOffset + byteLength)
    inst.attachedEpoch = clientEpoch(client); // 归属重建在这一代连接上
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
  /** 单会话收养失败(per-inst 容错继续其余会话)时逐个回调(sessionReadopt 末次重试
   *  接终端可见提示)。默认 no-op——失败仍经末尾聚合 throw 上抛驱动重试。 */
  onAdoptFailed?(tabId: string, error: unknown): void;
  /** path② rebuildTab 未收养(null)时的策略钩子(评审 P2-2):本地=kill 回收防「孤儿会话
   *  续跑不可见」(embedded 时代 reload 即 kill,不回收是行为回归);远程=缺省 no-op,
   *  维持「收养只做加法」的多端语义(其他设备可能还挂着)。 */
  onUnadopted?(hostId: string, snapshot: SessionSnapshot, client: HostClient): void;
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
  hostId: string,
  hooks: ReadoptHooks = {},
): Promise<void> {
  const getClient = hooks.getClient ?? ((id) => hostRegistry.forHostId(id));
  const listInstances = hooks.listInstances ?? (() => [...registry.entries()]);
  const getOrCreateInst = hooks.getOrCreateInst ?? getOrCreateTerminal;
  const spawnNew = hooks.spawnNew ?? ensureSession;
  const wireLive = hooks.wireLiveSession ?? wireLiveSession;
  const reconcileBadge = hooks.reconcileBadge ?? (() => undefined);
  const rebuildTab = hooks.rebuildTab ?? (() => null);
  const onUnadopted = hooks.onUnadopted ?? (() => undefined);
  const onAdoptFailed = hooks.onAdoptFailed ?? (() => undefined);

  const client = getClient(hostId);
  if (!client) return;

  // 🔴 per-inst 容错(2026-07-23「远程机连着但无法输入」根因):失败只记录并继续,
  // 全部会话处理完后聚合 throw(交由 readoptHostSessions 退避重试;sessionId 保留,
  // 下轮可再收养)。此前任一 session.attach reject 会中止整个收养——其余 inst 钉死在
  // 「renderer 侧看似绑定、新连接的 host client.sessions 缺位」的聋哑态:pty:input 被
  // hostCore 归属门静默丢弃、无输出订阅,而心跳/延迟/其它 RPC 一切正常。
  const failedSids: string[] = [];
  const throwIfFailures = (): void => {
    if (failedSids.length > 0) {
      throw new Error(
        `readopt incomplete: ${failedSids.length} session(s) failed to re-attach [${failedSids.join(', ')}]`,
      );
    }
  };

  const insts = listInstances().filter(
    ([, inst]) => inst.hostId === hostId && inst.sessionId,
  );

  // 能力位缺失(旧 host 无 session.resume)→ 不发 list/attach,每个 inst 直接 new spawn(QA-B-5)
  if (!client.supportsSessionResume()) {
    for (const [tabId, inst] of insts) {
      inst.sessionId = null;
      inst.renderedBytes = 0;
      inst.exited = false;
      await spawnNew(tabId, inst.spawnCwd, hostId);
    }
    return;
  }

  const adoptedSids = new Set<string>();

  // 路径①闪断:逐 inst 收养
  for (const [tabId, inst] of insts) {
    const sid = inst.sessionId as string;
    try {
      // 🔴 收养前先把 inst 迁到该 host 的**当前** client 实例(2026-07-27「连接正常但终端
      // 卡死、ctrl+c 无效」根因):手动断开走 hostRegistry.drop(dispose 实例 + 从 map 摘除)
      // 却**不**销毁 tab,重连时 getOrCreateRemote 造的是新实例。此前收养用新实例发
      // session.attach(host 侧归属建在新连接上,故 attach「成功」),而 inst 仍攥着已 dispose
      // 的旧实例:输出监听挂在旧实例上 → 新连接来的 pty:data 无人认领,进 bufferedData 永不
      // 上屏;输入 post 进旧实例的 null transport → 静默丢弃。于是心跳/延迟一切正常,终端
      // 却全冻。迁移含重挂 live 管线(attachPty 覆盖同 sid 监听 + 顺带补 wireInputOnce)。
      rebindInstClient(inst, tabId, client, sid, wireLive);
      const result = await adoptInst(inst, tabId, client, sid, inst.renderedBytes);
      if (!result.found) {
        // 幂等收养 miss(被逐/从未有)→ new spawn(不误把旧 scrollback 当 gap 追加)
        inst.sessionId = null;
        inst.renderedBytes = 0;
        inst.exited = false;
        await spawnNew(tabId, inst.spawnCwd, hostId);
        continue;
      }
      adoptedSids.add(sid);
      inst.exited = result.snapshot.status === 'exited';
      reconcileBadge(hostId, sid, result.snapshot);
    } catch (err) {
      failedSids.push(sid);
      onAdoptFailed(tabId, err);
    }
  }

  // 路径②重建:session.list 有、本地无 inst → 重建 tab 全量回放
  let sessions: SessionSnapshot[];
  try {
    const res = await client.rpc('session.list', undefined);
    sessions = res.sessions;
  } catch {
    // list 失败(旧 core 未知 method 等)→ 止步路径②;路径① 的失败仍须上抛驱动重试
    throwIfFailures();
    return;
  }
  const localSids = new Set(
    listInstances()
      .filter(([, inst]) => inst.hostId === hostId && inst.sessionId)
      .map(([, inst]) => inst.sessionId as string),
  );
  for (const snap of sessions) {
    if (adoptedSids.has(snap.sessionId) || localSids.has(snap.sessionId)) continue;
    const tabId = rebuildTab(hostId, snap);
    if (!tabId) {
      onUnadopted(hostId, snap, client);
      continue;
    }
    const inst = getOrCreateInst(tabId);
    inst.hostId = hostId;
    inst.client = client;
    inst.spawnCwd = snap.cwd;
    inst.sessionId = snap.sessionId;
    inst.renderedBytes = 0;
    inst.exited = false;
    try {
      wireLive(inst, tabId, client, snap.sessionId);
      const result = await adoptInst(inst, tabId, client, snap.sessionId, 0);
      if (!result.found) {
        inst.sessionId = null;
        continue;
      }
      inst.exited = result.snapshot.status === 'exited';
      reconcileBadge(hostId, snap.sessionId, result.snapshot);
    } catch (err) {
      // sessionId 已绑定 → 下轮重试走路径① 原位收养,不再重复建 tab
      failedSids.push(snap.sessionId);
      onAdoptFailed(tabId, err);
    }
  }
  throwIfFailures();
}

/**
 * 往指定 tab 的终端写一行暗色系统提示(「不许无声死 tab」惯例,同 ensureSession 失败路径)。
 * tab 不存在/已销毁则忽略。当前消费方:sessionReadopt 收养重试全数失败后的终端可见提示。
 */
export function writeTerminalNotice(tabId: string, message: string): void {
  const inst = registry.get(tabId);
  if (!inst || inst.disposed) return;
  inst.term.writeln(`\r\n\x1b[2m${message}\x1b[0m`);
}

/**
 * 该 tab 终端的当前选区文本(无实例/已销毁/无选区 → '')。**不创建**实例
 * ——⌘C 可能落在浏览器 tab 或尚未挂载的 tab 上,不该因为查一次选区就凭空造终端。
 */
export function getTerminalSelection(tabId: string): string {
  const inst = registry.get(tabId);
  if (!inst || inst.disposed) return '';
  return inst.term.hasSelection() ? inst.term.getSelection() : '';
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

/**
 * 被独占接管后的自动取回(M2 · TerminalView 激活时调用):takenover 置位且会话仍绑定
 * → 重新 mirror attach(resumeOffset=renderedBytes,增量/全量由 host 切片决定)。
 * found=false(会话已被对端 kill/逐出)→ 原位重 spawn(与收养 miss 同款收尾)。
 * host 不支持镜像 → 不自动取回(exclusive 抢回会反过来踢掉对端,乒乓;留给用户手动重连)。
 */
export async function remirrorIfTakenOver(tabId: string): Promise<void> {
  const inst = registry.get(tabId);
  if (!inst || !inst.takenover) return;
  const client = inst.client;
  const sessionId = inst.sessionId;
  if (!client || !sessionId || !client.supportsSessionMirror()) return;
  inst.takenover = false;
  const result = await adoptInst(inst, tabId, client, sessionId, inst.renderedBytes);
  if (!result.found) {
    inst.sessionId = null;
    inst.renderedBytes = 0;
    inst.exited = false;
    if (inst.hostId) await ensureSession(tabId, inst.spawnCwd, inst.hostId);
  }
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
