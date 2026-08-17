// 云端浏览器服务:host 侧拉起一个 headless Chromium,用 CDP 驱动它。
// 纯 Node,零 Electron import(README §五远程就绪红线)。
//
// 为什么把浏览器搬到 host:agent 跑在远端 session 里,浏览器却在用户本机,
// 中间靠 SSH 反向转发把 MCP 打回来——链路长且脆(那条转发"经常挂死"是有记录的)。
// 浏览器与 agent 同机后,控制走 127.0.0.1,反向转发这条路整个不需要了。
//
// 默认无头:平时零画面流量;只有本地要看时才另开 screencast(见后续预览通道)。
//
// 🔴 进程责任:用户的服务器不该被我们堆满僵尸 Chromium。
// ① 懒启动(没人用就不起)② 空闲自动回收 ③ host 退出必 kill。

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  BrowserFrameMetadata,
  BrowserInputEvent,
  BrowserRuntimeStatus,
  BrowserTabSnapshot,
} from '../shared/protocol';
import { CdpConnection, CdpError } from './cdpClient';
import {
  buildChromiumArgs,
  chromiumInstallHint,
  locateChromium,
  parseDevToolsEndpoint,
} from './chromiumLocator';

/** 启动后等 DevTools endpoint 出现的上限(冷启动 + 容器慢盘留足余量)。 */
const LAUNCH_TIMEOUT_MS = 30_000;
/** 无调用 + 无预览多久后回收 Chromium(远端内存不是免费的)。 */
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
/** waitFor 的硬上限:agent 传再大也不许把一个 CDP 调用吊到天荒地老。 */
const MAX_WAIT_FOR_MS = 120_000;
/** 预览帧默认参数:JPEG 60 质量 / 长边 1280 —— 够看清,又不至于把隧道占满。 */
const PREVIEW_DEFAULTS = { maxWidth: 1280, maxHeight: 800, quality: 60 } as const;
/**
 * 一帧在途多久没等到 ack 就当预览端没了(关窗/崩了/断线),停掉推流。
 * 不设这个闸,一次没回的 ack 会让该标签永远停在「等 ack」态,预览再也不动。
 */
const FRAME_ACK_TIMEOUT_MS = 15_000;
/** 启动尝试次数 + 重试间隔:覆盖上一个实例退出时 user-data-dir 尚未解锁的窗口。 */
const LAUNCH_ATTEMPTS = 3;
const LAUNCH_RETRY_DELAY_MS = 700;
/** Browser.close 之后等进程自己退出的上限(超了就 SIGKILL,不无限等)。 */
const GRACEFUL_EXIT_WAIT_MS = 3_000;
/** 单次整段插入的上限(粘贴一篇长文是合理用法,但不能没有边)。 */
const MAX_INSERT_TEXT_LENGTH = 32_768;

export interface BrowserProcessLike {
  readonly pid?: number;
  stderr: { on(ev: 'data', cb: (chunk: Buffer | string) => void): void } | null;
  stdout: { on(ev: 'data', cb: (chunk: Buffer | string) => void): void } | null;
  on(ev: 'exit', cb: (code: number | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface BrowserServiceDeps {
  /** Chromium 的 user-data-dir 落点(host 数据目录下) */
  dataDir: string;
  locate?: () => string | null;
  launch?: (executablePath: string, args: string[]) => BrowserProcessLike;
  connect?: (endpoint: string) => Promise<CdpConnection>;
  platform?: NodeJS.Platform;
  isRoot?: boolean;
  idleTimeoutMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (h: ReturnType<typeof setTimeout>) => void;
  logger?: { log(msg: string): void; error(msg: string): void };
}

interface RunningBrowser {
  proc: BrowserProcessLike;
  conn: CdpConnection;
  /** targetId → CDP flatten sessionId(attach 一次,后续复用) */
  sessions: Map<string, string>;
  /** 活跃标签(listTabs 的 active 标记 + 省略 tabId 时的默认目标) */
  activeTabId: string | null;
}

/** 一个标签的预览推流态。 */
interface PreviewStream {
  tabId: string;
  session: string;
  seq: number;
  /** 已发出、还没等到 ack 的帧号;null = 空闲可发 */
  inFlight: number | null;
  ackTimer: ReturnType<typeof setTimeout> | null;
  /** 丢帧计数(诊断用:隧道跟不上时这个数会涨) */
  dropped: number;
  offEvent: () => void;
}

/** 预览帧回调:host 侧接线把它转成 browser:frame 消息推给开了预览的客户端。 */
export type BrowserFrameSink = (frame: {
  tabId: string;
  seq: number;
  data: string;
  metadata: BrowserFrameMetadata;
}) => void;

/** 页面里跑的求值结果:CDP 的 Runtime.evaluate 返回形状(只取我们要的部分)。 */
interface EvaluateResult {
  result?: { type?: string; value?: unknown; subtype?: string; description?: string };
  exceptionDetails?: { exception?: { description?: string }; text?: string };
}

export class BrowserUnavailableError extends Error {
  constructor(hint: string) {
    super(`no Chromium found on this host. ${hint}`);
    this.name = 'BrowserUnavailableError';
  }
}

/**
 * Chromium 还没报出 DevTools 端口就退出了。单独成类是为了跟「起来了但不吭声」
 * 区分开:前者常见于 user-data-dir 还被上一个正在退出的实例锁着(退出码 21),
 * 等一下重试就好;后者重试没有意义(进程活着,只是不打印)。
 */
class ChromiumStartupExitError extends Error {
  constructor(code: number | null, output: string) {
    // 🔴 带上 Chromium 自己的输出:远端起不来时这是唯一的线索
    // (缺 so 依赖、sandbox 被拒、profile 被占……退出码全是一个 21)。
    const tail = output.trim().split('\n').slice(-4).join(' | ').slice(0, 500);
    super(
      `chromium exited before listening (code=${code})${tail ? `: ${tail}` : ''}`,
    );
    this.name = 'ChromiumStartupExitError';
  }
}

const MOUSE_TYPES = new Set(['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel']);
const MOUSE_BUTTONS = new Set(['left', 'right', 'middle', 'back', 'forward', 'none']);
const KEY_TYPES = new Set(['keyDown', 'keyUp', 'char']);

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

export class BrowserService {
  private running: RunningBrowser | null = null;
  private starting: Promise<RunningBrowser> | null = null;
  /** tabId → 预览推流态(默认空:没人看就没有画面流量) */
  private readonly previews = new Map<string, PreviewStream>();
  /**
   * 我们启动过的 Chromium pid —— 用于认出「自己留下的」profile 锁。
   * 🔴 必须是集合而非「最后一个」:重试时新起的进程也会失败退出,若只记最后一个,
   * 它会把**留下锁的那个** pid 覆盖掉,于是永远认不出自己的锁。留最近 8 个够用。
   */
  private readonly launchedPids: number[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly deps: Required<
    Omit<BrowserServiceDeps, 'logger' | 'locate' | 'launch' | 'connect'>
  > &
    Pick<BrowserServiceDeps, 'locate' | 'launch' | 'connect'> & {
      logger: NonNullable<BrowserServiceDeps['logger']>;
    };

  constructor(deps: BrowserServiceDeps) {
    this.deps = {
      dataDir: deps.dataDir,
      locate: deps.locate,
      launch: deps.launch,
      connect: deps.connect,
      platform: deps.platform ?? process.platform,
      isRoot: deps.isRoot ?? (typeof process.getuid === 'function' && process.getuid() === 0),
      idleTimeoutMs: deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      now: deps.now ?? Date.now,
      setTimer: deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: deps.clearTimer ?? ((h) => clearTimeout(h)),
      logger: deps.logger ?? {
        log: (m) => console.log(m),
        error: (m) => console.error(m),
      },
    };
  }

  /** 探测可用性,不启动(UI 用它决定要不要显示「云端浏览器」入口)。 */
  status(): BrowserRuntimeStatus {
    const executablePath = this.locateExecutable();
    return {
      available: executablePath !== null,
      executablePath,
      running: this.running !== null,
      ...(executablePath === null
        ? { hint: chromiumInstallHint(this.deps.platform) }
        : {}),
    };
  }

  // ---- 标签管理 ----

  async listTabs(): Promise<BrowserTabSnapshot[]> {
    const b = await this.ensure();
    const { targetInfos } = await b.conn.send<{
      targetInfos: Array<{ targetId: string; type: string; url: string; title: string }>;
    }>('Target.getTargets');
    return targetInfos
      .filter((t) => t.type === 'page')
      .map((t) => ({
        tabId: t.targetId,
        url: t.url,
        title: t.title,
        active: t.targetId === b.activeTabId,
      }));
  }

  async openTab(url?: string): Promise<string> {
    const b = await this.ensure();
    const { targetId } = await b.conn.send<{ targetId: string }>('Target.createTarget', {
      url: url || 'about:blank',
    });
    b.activeTabId = targetId;
    return targetId;
  }

  async closeTab(tabId: string): Promise<void> {
    const b = await this.ensure();
    this.stopPreview(tabId); // 标签没了,推流订阅与 ack 计时器不该留着
    await b.conn.send('Target.closeTarget', { targetId: tabId });
    b.sessions.delete(tabId);
    if (b.activeTabId === tabId) b.activeTabId = null;
  }

  async activateTab(tabId: string): Promise<void> {
    const b = await this.ensure();
    // headless 下没有真正的「窗口前置」,但 Target.activateTarget 会把它设为
    // foreground(影响 requestAnimationFrame/timer 节流),语义与本地一致。
    await b.conn.send('Target.activateTarget', { targetId: tabId });
    b.activeTabId = tabId;
  }

  // ---- 控制原语 ----

  async navigate(url: string, tabId?: string): Promise<string> {
    const b = await this.ensure();
    // 没有任何标签时 navigate 直接开一个(与本地 browserControl.navigate 同语义)
    const target = tabId ?? b.activeTabId ?? (await this.openTab());
    const session = await this.attach(b, target);
    const res = await b.conn.send<{ errorText?: string }>(
      'Page.navigate',
      { url },
      session,
      LAUNCH_TIMEOUT_MS,
    );
    if (res.errorText) throw new Error(`navigation failed: ${res.errorText}`);
    b.activeTabId = target;
    return target;
  }

  async evaluate(code: string, tabId?: string): Promise<unknown> {
    return this.evalInPage(code, tabId, false);
  }

  async getHtml(tabId?: string): Promise<string> {
    return String(
      await this.evalInPage('document.documentElement.outerHTML', tabId, false),
    );
  }

  async getText(tabId?: string): Promise<string> {
    return String(
      await this.evalInPage('document.body ? document.body.innerText : ""', tabId, false),
    );
  }

  async screenshot(tabId?: string): Promise<string> {
    const { b, session } = await this.target(tabId);
    // 🔴 headless 下开了多个标签时,只有前台那页能截图:CDP 直接回
    // "Not attached to an active page"(真 Chromium 上验出来的,假 CDP 替身
    // 测不到这条)。截图前把目标页带到前台——截的本来就该是这一页。
    await b.conn.send('Page.bringToFront', undefined, session);
    const { data } = await b.conn.send<{ data: string }>(
      'Page.captureScreenshot',
      { format: 'png' },
      session,
    );
    return data;
  }

  /**
   * 点击选择器命中的元素。
   * 🔴 与本地实现(el.click())的区别:这里派发**真实**鼠标事件(Input.dispatchMouseEvent),
   * 只有拿不到坐标(元素被遮挡/零尺寸/在跨域 iframe 里)才回退到 el.click()。
   * 真实事件能过掉只认 isTrusted 的站点,也会正常触发 hover/focus 链。
   */
  async click(selector: string, tabId?: string): Promise<boolean> {
    const { b, session } = await this.target(tabId);
    const box = (await this.evalInSession(
      b,
      session,
      `(function(){
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`,
      true,
    )) as { x: number; y: number } | null;

    if (!box) {
      // 零尺寸元素(display:contents、纯事件绑定的包裹层)拿不到坐标,退回 DOM click
      await this.evalInSession(
        b,
        session,
        `(function(){ document.querySelector(${JSON.stringify(selector)}).click(); return true; })()`,
        true,
      );
      return true;
    }
    const point = { x: Math.round(box.x), y: Math.round(box.y) };
    await b.conn.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', ...point, button: 'none', clickCount: 0 },
      session,
    );
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await b.conn.send(
        'Input.dispatchMouseEvent',
        { type, ...point, button: 'left', clickCount: 1 },
        session,
      );
    }
    return true;
  }

  /**
   * 向 input/textarea 填文本。先聚焦元素并清空,再用 Input.insertText 真实输入——
   * 比本地那套「原生 setter + 手工派发 input/change」干净:React 受控组件收到的是
   * 真事件流,不必再猜要补派发哪几个事件。
   */
  async typeText(selector: string, text: string, tabId?: string): Promise<boolean> {
    const { b, session } = await this.target(tabId);
    await this.evalInSession(
      b,
      session,
      `(function(){
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.focus();
        if ('value' in el) el.value = '';
        return true;
      })()`,
      true,
    );
    if (text) await b.conn.send('Input.insertText', { text }, session);
    // insertText 不发 change(它只改值 + 发 input);表单校验多半听 change,补一发。
    await this.evalInSession(
      b,
      session,
      `(function(){
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
      true,
    );
    return true;
  }

  async scroll(dy?: number, tabId?: string): Promise<number> {
    const amount = typeof dy === 'number' ? dy : 0;
    return Number(
      await this.evalInPage(
        `(function(){
          const d = ${amount} || Math.round(window.innerHeight * 0.9);
          window.scrollBy(0, d);
          return window.scrollY;
        })()`,
        tabId,
        false,
      ),
    );
  }

  /**
   * 等选择器出现。轮询在**页面里**跑(一次 CDP 调用等到底),不是 host 侧轮询——
   * 后者每 100ms 一个 CDP 往返,远端 CPU 高负载时会把 CDP 通道自己压垮。
   */
  async waitFor(selector: string, timeoutMs = 5000, tabId?: string): Promise<boolean> {
    const budget = Math.min(Math.max(0, Math.floor(timeoutMs)), MAX_WAIT_FOR_MS);
    const sel = JSON.stringify(selector);
    const code = `new Promise((resolve, reject) => {
      if (document.querySelector(${sel})) { resolve(true); return; }
      const deadline = Date.now() + ${budget};
      const iv = setInterval(() => {
        if (document.querySelector(${sel})) { clearInterval(iv); resolve(true); }
        else if (Date.now() > deadline) { clearInterval(iv); reject(new Error('timeout waiting for ' + ${sel})); }
      }, 100);
    })`;
    // CDP 超时给页面预算 + 余量:让页面里的 reject 先到,错误文案才是「等不到选择器」
    // 而不是面目全非的「cdp timeout」。
    const { b, session } = await this.target(tabId);
    return Boolean(
      await this.evalInSession(b, session, code, true, budget + 5_000),
    );
  }

  // ---- 本地预览(默认无头;只有要看的时候才推画面)----

  /**
   * 开始把该标签的画面推回本地。
   * 🔴 背压是这里的核心:CDP 的 screencast 本身就是 ack 驱动的,但 Chromium 的产帧
   * 速度不该由跨洋隧道决定。所以两级:
   *   ① 对 Chromium **立即** ack(它继续按自己的节奏产帧,页面不卡)
   *   ② 对隧道**只在空闲时**发(上一帧没被客户端 ack 就丢掉当前帧)
   * 于是隧道上恒最多一帧在途,画面永远不会把同隧道的终端输出/心跳挤到队尾
   * ——那条隧道 FIFO 无优先级,这是必须守住的性质。
   */
  async startPreview(
    sink: BrowserFrameSink,
    opts: { tabId?: string; maxWidth?: number; maxHeight?: number; quality?: number } = {},
  ): Promise<string> {
    const { b, session, tabId } = await this.target(opts.tabId);
    this.stopPreview(tabId); // 重开幂等:先撤旧订阅,不叠加

    const stream: PreviewStream = {
      tabId,
      session,
      seq: 0,
      inFlight: null,
      ackTimer: null,
      dropped: 0,
      offEvent: () => undefined,
    };
    stream.offEvent = b.conn.on('Page.screencastFrame', (e) => {
      if (e.sessionId !== session) return;
      const params = e.params as {
        data?: string;
        sessionId?: number;
        metadata?: Partial<BrowserFrameMetadata>;
      };
      // ① 先放 Chromium 走:不 ack 它就不再产帧,页面在预览端看起来像冻住
      if (typeof params.sessionId === 'number') {
        void b.conn
          .send('Page.screencastFrameAck', { sessionId: params.sessionId }, session)
          .catch(() => undefined);
      }
      // ② 隧道有帧在途 → 丢掉这一帧(只送最新的,不排队)
      if (stream.inFlight !== null || !params.data) {
        stream.dropped++;
        return;
      }
      const seq = ++stream.seq;
      stream.inFlight = seq;
      stream.ackTimer = this.deps.setTimer(() => {
        // 预览端没回 ack(关窗/崩了/断线)→ 停推流,不把该标签永久钉在等 ack 态
        this.deps.logger.log(`[browser] preview ack timeout tab=${tabId}, stopping`);
        this.stopPreview(tabId);
      }, FRAME_ACK_TIMEOUT_MS);
      sink({
        tabId,
        seq,
        data: params.data,
        metadata: {
          deviceWidth: params.metadata?.deviceWidth ?? 0,
          deviceHeight: params.metadata?.deviceHeight ?? 0,
          pageScaleFactor: params.metadata?.pageScaleFactor ?? 1,
          offsetTop: params.metadata?.offsetTop ?? 0,
          scrollOffsetX: params.metadata?.scrollOffsetX ?? 0,
          scrollOffsetY: params.metadata?.scrollOffsetY ?? 0,
        },
      });
    });
    this.previews.set(tabId, stream);

    // 🔴 同 screenshot:多标签下只有前台页能推流,否则 CDP 回 "Not attached to an
    // active page"(真 Chromium 上验出来的)。开预览本来就意味着「我要看这一页」。
    await b.conn.send('Page.bringToFront', undefined, session);
    b.activeTabId = tabId;
    await b.conn.send(
      'Page.startScreencast',
      {
        format: 'jpeg',
        quality: opts.quality ?? PREVIEW_DEFAULTS.quality,
        maxWidth: opts.maxWidth ?? PREVIEW_DEFAULTS.maxWidth,
        maxHeight: opts.maxHeight ?? PREVIEW_DEFAULTS.maxHeight,
        // 每帧都要:节流交给上面的丢帧逻辑,那里能按隧道实况自适应
        everyNthFrame: 1,
      },
      session,
    );
    return tabId;
  }

  /** 客户端确认收到某帧 → 放行下一帧。序号对不上(迟到的旧 ack)忽略。 */
  ackFrame(tabId: string, seq: number): void {
    const stream = this.previews.get(tabId);
    if (!stream || stream.inFlight !== seq) return;
    stream.inFlight = null;
    if (stream.ackTimer !== null) {
      this.deps.clearTimer(stream.ackTimer);
      stream.ackTimer = null;
    }
  }

  /** 停止推流(tabId 省略 = 全停)。不关标签、不关浏览器 —— 只是不再要画面。 */
  stopPreview(tabId?: string): void {
    const targets = tabId ? [tabId] : [...this.previews.keys()];
    for (const id of targets) {
      const stream = this.previews.get(id);
      if (!stream) continue;
      this.previews.delete(id);
      stream.offEvent();
      if (stream.ackTimer !== null) this.deps.clearTimer(stream.ackTimer);
      const b = this.running;
      if (b && !b.conn.closed) {
        void b.conn
          .send('Page.stopScreencast', undefined, stream.session)
          .catch(() => undefined);
      }
    }
  }

  /** 当前是否有标签在推流(空闲回收要避开正在看的画面)。 */
  get previewing(): boolean {
    return this.previews.size > 0;
  }

  /**
   * 把本地的鼠标/键盘事件派发到云端页面。
   * 🔴 不盲目透传 renderer 给的对象:类型走白名单、数值做有限性校验后再组装 CDP 参数。
   * 畸形参数会让 CDP 直接报错甚至撕掉连接,而这条路径上的输入来自 UI 事件,量大且频繁。
   */
  async dispatchInput(event: BrowserInputEvent, tabId?: string): Promise<void> {
    const { b, session } = await this.target(tabId);
    const modifiers = clampInt(
      event.kind === 'text' ? 0 : event.modifiers,
      0,
      15,
      0,
    );
    if (event.kind === 'mouse') {
      if (!MOUSE_TYPES.has(event.type)) throw new Error(`bad mouse event: ${event.type}`);
      await b.conn.send(
        'Input.dispatchMouseEvent',
        {
          type: event.type,
          x: finite(event.x),
          y: finite(event.y),
          button: MOUSE_BUTTONS.has(event.button ?? 'none') ? (event.button ?? 'none') : 'none',
          clickCount: clampInt(event.clickCount, 0, 3, 0),
          modifiers,
          ...(event.type === 'mouseWheel'
            ? { deltaX: finite(event.deltaX), deltaY: finite(event.deltaY) }
            : {}),
        },
        session,
      );
      return;
    }
    if (event.kind === 'text') {
      // 输入法上屏 / 粘贴:整段插入。走 Input.insertText 而不是拆成 char ——
      // 中文一次上屏若干字,拆开发会丢掉合成语义,也过不了监听 composition 的页面。
      const text = String(event.text ?? '').slice(0, MAX_INSERT_TEXT_LENGTH);
      if (!text) return;
      await b.conn.send('Input.insertText', { text }, session);
      return;
    }
    if (!KEY_TYPES.has(event.type)) throw new Error(`bad key event: ${event.type}`);
    await b.conn.send(
      'Input.dispatchKeyEvent',
      {
        type: event.type,
        modifiers,
        ...(event.key ? { key: String(event.key).slice(0, 32) } : {}),
        ...(event.code ? { code: String(event.code).slice(0, 32) } : {}),
        // char 事件的 text 才是真正输入的字符;长度设上限防一次灌进整篇文本
        ...(event.text ? { text: String(event.text).slice(0, 256) } : {}),
        ...(typeof event.windowsVirtualKeyCode === 'number'
          ? { windowsVirtualKeyCode: clampInt(event.windowsVirtualKeyCode, 0, 255, 0) }
          : {}),
      },
      session,
    );
  }

  /** 同步远端视口尺寸(预览窗口大小变了,否则看到的排版不是这个宽度该有的样子)。 */
  async resizeViewport(
    width: number,
    height: number,
    deviceScaleFactor = 1,
    tabId?: string,
  ): Promise<void> {
    const { b, session } = await this.target(tabId);
    await b.conn.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: clampInt(width, 1, 8192, 1280),
        height: clampInt(height, 1, 8192, 800),
        deviceScaleFactor: Math.min(Math.max(deviceScaleFactor || 1, 1), 3),
        mobile: false,
      },
      session,
    );
  }

  // ---- 生命周期 ----

  /** 关掉 Chromium(幂等)。空闲回收与 host 退出都走这里。 */
  async shutdown(): Promise<void> {
    this.stopPreview(); // 先撤推流(订阅 + ack 计时器),再动连接
    const b = this.running;
    this.running = null;
    this.starting = null;
    this.clearIdleTimer();
    if (!b) return;
    // 优雅关:让 Chromium 自己落盘 cookie/localStorage 并清掉 profile 锁。
    // 🔴 要等它真的退出再 SIGKILL —— 抢在清理完成前杀掉就会留下 SingletonLock,
    // 下次启动直接以退出码 21 死掉(有 clearStaleProfileLock 兜底,但别主动制造)。
    const exited = new Promise<void>((resolve) => {
      b.proc.on('exit', () => resolve());
    });
    try {
      await b.conn.send('Browser.close', undefined, undefined, 5_000);
      await Promise.race([
        exited,
        new Promise<void>((resolve) =>
          this.deps.setTimer(() => resolve(), GRACEFUL_EXIT_WAIT_MS),
        ),
      ]);
    } catch {
      // 已经死了或不理我们 —— 下面 SIGKILL 兜底
    }
    b.conn.close();
    try {
      b.proc.kill('SIGKILL');
    } catch {
      // 进程已退出
    }
    this.deps.logger.log('[browser] chromium stopped');
  }

  /** host 退出时调用:同步收尾,确保不给用户服务器留僵尸进程。 */
  dispose(): void {
    this.disposed = true;
    this.stopPreview();
    const b = this.running;
    this.running = null;
    this.starting = null;
    this.clearIdleTimer();
    if (!b) return;
    b.conn.close();
    try {
      b.proc.kill('SIGKILL');
    } catch {
      // 已退出
    }
  }

  // ---- 内部 ----

  private locateExecutable(): string | null {
    return (this.deps.locate ?? locateChromium)();
  }

  private async ensure(): Promise<RunningBrowser> {
    if (this.disposed) throw new Error('browser service disposed');
    this.touch();
    if (this.running) return this.running;
    // 并发调用共享同一次启动:两个 agent 同时开工不该起两个 Chromium
    if (this.starting) return this.starting;
    this.starting = this.launch().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /**
   * 拉起 Chromium。
   * 🔴 带一次重试:上一个实例刚退出时 user-data-dir 的 lock 还没释放,新实例会
   * 立刻以退出码 21 死掉(真 Chromium 上撞到过——页面 window.close 关掉最后一个
   * 标签会让 headless Chromium 整个退出,紧接着的调用正好落在这个窗口里)。
   * 只对「没报端口就退出」重试;「起来了但不吭声」重试没意义。
   */
  private async launch(): Promise<RunningBrowser> {
    let lastError: unknown;
    for (let attempt = 0; attempt < LAUNCH_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) =>
          this.deps.setTimer(() => resolve(), LAUNCH_RETRY_DELAY_MS),
        );
        if (this.disposed) break;
      }
      try {
        return await this.launchOnce();
      } catch (err) {
        lastError = err;
        if (!(err instanceof ChromiumStartupExitError)) throw err;
        this.deps.logger.error(
          `[browser] chromium start failed (attempt ${attempt + 1}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // 🔴 被锁挡住,而锁的主人正是**我们自己刚杀掉**的那个进程:强制清掉。
        // clearStaleProfileLock 的 pid 存活检查在这个时机会误判——SIGKILL 之后进程
        // 短时间内仍在进程表里(还没被回收),kill(pid,0) 照样返回成功。
        // 只认自己的 pid:别人的实例真占着这个 profile 时不动它,如实报错。
        if (/SingletonLock/.test(err.message)) this.clearOwnProfileLock();
      }
    }
    throw lastError;
  }

  /** profile 锁归我们自己上一个 Chromium 所有时,把它清掉(见 launch 的调用处注释)。 */
  private clearOwnProfileLock(): void {
    const userDataDir = path.join(this.deps.dataDir, 'chromium');
    const lockPath = path.join(userDataDir, 'SingletonLock');
    let owner: number;
    try {
      owner = Number(fs.readlinkSync(lockPath).split('-').pop());
    } catch {
      return;
    }
    if (!Number.isFinite(owner) || !this.launchedPids.includes(owner)) return;
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      try {
        fs.unlinkSync(path.join(userDataDir, name));
      } catch {
        // 本来就不在
      }
    }
    this.deps.logger.log(`[browser] cleared own profile lock (pid=${owner})`);
  }

  private async launchOnce(): Promise<RunningBrowser> {
    const executablePath = this.locateExecutable();
    if (!executablePath) {
      throw new BrowserUnavailableError(chromiumInstallHint(this.deps.platform));
    }
    const userDataDir = path.join(this.deps.dataDir, 'chromium');
    fs.mkdirSync(userDataDir, { recursive: true });
    clearStaleProfileLock(userDataDir, this.deps.logger);
    const args = buildChromiumArgs({
      userDataDir,
      platform: this.deps.platform,
      isRoot: this.deps.isRoot,
    });
    const proc = (this.deps.launch ?? defaultLaunch)(executablePath, args);
    if (typeof proc.pid === 'number') {
      this.launchedPids.push(proc.pid);
      if (this.launchedPids.length > 8) this.launchedPids.shift();
    }
    const endpoint = await this.readEndpoint(proc);
    const conn = await (this.deps.connect ?? ((url: string) => CdpConnection.open(url)))(
      endpoint,
    );

    const b: RunningBrowser = { proc, conn, sessions: new Map(), activeTabId: null };
    proc.on('exit', (code) => {
      if (this.running === b) {
        this.running = null;
        this.deps.logger.error(`[browser] chromium exited code=${code}`);
      }
      // 浏览器没了,推流态必须一起清:留着的话 previewing 恒 true,
      // 空闲回收会被一个不存在的预览永久顶住
      this.stopPreview();
      conn.close();
    });
    // Chromium 自己没了(OOM kill / crash)也要让状态归零,下次调用重新拉起
    conn.on('Inspector.detached', () => {
      if (this.running === b) this.running = null;
    });
    // 🔴 标签消失(页面 window.close / 用户在别处关掉)必须让缓存跟着走:
    // session 是缓存的,死标签不会触发重新 attach,后续命令会一直打向一个
    // 不存在的 session —— 这台机器的浏览器就此永久失灵。
    conn.on('Target.targetDestroyed', (e) => {
      const targetId = String((e.params as { targetId?: string }).targetId ?? '');
      if (!targetId) return;
      b.sessions.delete(targetId);
      if (b.activeTabId === targetId) b.activeTabId = null;
      this.stopPreview(targetId);
    });
    this.running = b;
    // targetDestroyed 只在开了 target 发现后才会推送
    await conn.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
    this.deps.logger.log(`[browser] chromium started pid=${proc.pid ?? '?'}`);
    return b;
  }

  /** 从 stderr 等 "DevTools listening on ws://..."(Chromium 只在这里公布端口)。 */
  private readEndpoint(proc: BrowserProcessLike): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let buf = '';
      let settled = false;
      const timer = this.deps.setTimer(() => {
        if (settled) return;
        settled = true;
        try {
          proc.kill('SIGKILL');
        } catch {
          // 起不来又杀不掉:让 reject 带出去,不吞
        }
        reject(new Error('chromium did not report a DevTools endpoint in time'));
      }, LAUNCH_TIMEOUT_MS);
      const onChunk = (chunk: Buffer | string) => {
        if (settled) return;
        buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const endpoint = parseDevToolsEndpoint(buf);
        if (!endpoint) return;
        settled = true;
        this.deps.clearTimer(timer);
        resolve(endpoint);
      };
      proc.stderr?.on('data', onChunk);
      // 某些构建把它打到 stdout,两边都收
      proc.stdout?.on('data', onChunk);
      proc.on('exit', (code) => {
        if (settled) return;
        settled = true;
        this.deps.clearTimer(timer);
        reject(new ChromiumStartupExitError(code, buf));
      });
    });
  }

  /** 拿到某标签的 CDP session(首次 attach,之后复用)。 */
  private async attach(b: RunningBrowser, tabId: string): Promise<string> {
    const cached = b.sessions.get(tabId);
    if (cached) return cached;
    const { sessionId } = await b.conn.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: tabId,
      flatten: true,
    });
    b.sessions.set(tabId, sessionId);
    // Page 域要显式开,否则 loadEventFired/screencast 一类事件不会来
    await b.conn.send('Page.enable', undefined, sessionId).catch(() => undefined);
    return sessionId;
  }

  /**
   * 解析目标标签(省略 → 活跃标签;一个都没有 → 开一个),返回其 session。
   * 🔴 活跃标签可能已经不在了(页面自己 window.close / 用户在别处关掉):
   * attach 会失败。此时不能就此瘫痪——清掉陈旧的 activeTabId 与 session 缓存,
   * 开一个新标签重来。否则「某次页面自关」会让这台机器的浏览器永久失灵。
   * 显式传 tabId 的调用不做这个兜底:那是调用方指名的标签,不存在就该报错。
   */
  private async target(
    tabId?: string,
  ): Promise<{ b: RunningBrowser; session: string; tabId: string }> {
    const b = await this.ensure();
    const explicit = tabId !== undefined;
    const target = tabId ?? b.activeTabId ?? (await this.openTab());
    try {
      return { b, session: await this.attach(b, target), tabId: target };
    } catch (err) {
      if (explicit) throw err;
      b.sessions.delete(target);
      if (b.activeTabId === target) b.activeTabId = null;
      const fresh = await this.openTab();
      return { b, session: await this.attach(b, fresh), tabId: fresh };
    }
  }

  private async evalInPage(
    code: string,
    tabId: string | undefined,
    awaitPromise: boolean,
  ): Promise<unknown> {
    const { b, session } = await this.target(tabId);
    return this.evalInSession(b, session, code, awaitPromise);
  }

  private async evalInSession(
    b: RunningBrowser,
    session: string,
    code: string,
    awaitPromise: boolean,
    timeoutMs?: number,
  ): Promise<unknown> {
    const res = await b.conn.send<EvaluateResult>(
      'Runtime.evaluate',
      {
        expression: code,
        returnByValue: true,
        awaitPromise,
        // 按「用户手势」求值:剪贴板/全屏/自动播放一类 API 只在有手势时才放行,
        // 否则 agent 在页面里跑的脚本会莫名其妙被拒。
        userGesture: true,
      },
      session,
      timeoutMs,
    );
    // 页面里抛的错要变成我们的 Error,而不是一个 exceptionDetails 对象静静返回
    // ——agent 靠这句文案定位问题(「element not found: #x」就是从这儿冒上来的)。
    if (res.exceptionDetails) {
      const detail =
        res.exceptionDetails.exception?.description ??
        res.exceptionDetails.text ??
        'evaluation failed';
      throw new Error(detail.split('\n')[0]);
    }
    return res.result?.value;
  }

  /** 有活动就把空闲回收推后;idleTimeoutMs<=0 视为不回收。 */
  private touch(): void {
    this.clearIdleTimer();
    if (this.deps.idleTimeoutMs <= 0) return;
    this.idleTimer = this.deps.setTimer(() => {
      this.idleTimer = null;
      // 🔴 有人正看着预览就不能回收:画面前一秒还在动,下一秒浏览器被关掉。
      // 预览本身不算「调用」(帧是 host 推的,不经 ensure),所以这里要单独判。
      if (this.previewing) {
        this.touch();
        return;
      }
      void this.shutdown();
    }, this.deps.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.deps.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

/** pid 是否还活着(signal 0 = 只探测不发信号;EPERM = 存在但不归我们管)。 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string })?.code === 'EPERM';
  }
}

/**
 * 清掉上一个实例留下的陈旧 profile 锁。
 * Chromium 被 SIGKILL / OOM killer 干掉时来不及清 SingletonLock,下次启动会直接
 * 以退出码 21 死掉(`Failed to create ... SingletonLock: File exists`)——远端服务器上
 * 内存紧张时这是常态,不能让一次 OOM 把云端浏览器永久钉死。
 * 🔴 只清「主人已经不在」的锁:锁是个符号链接,内容形如 `hostname-<pid>`;进程还活着
 * 就不动它——同机真有另一个实例在用这个 profile 时,删锁会让两个实例共写、profile 损坏。
 */
function clearStaleProfileLock(
  userDataDir: string,
  logger: { log(msg: string): void },
): void {
  const lockPath = path.join(userDataDir, 'SingletonLock');
  let target: string;
  try {
    target = fs.readlinkSync(lockPath);
  } catch {
    return; // 没有锁,或不是符号链接 —— 没什么要清的
  }
  const pid = Number(target.split('-').pop());
  if (Number.isFinite(pid) && pid > 0 && processAlive(pid)) return;
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      fs.unlinkSync(path.join(userDataDir, name));
    } catch {
      // 本来就不在
    }
  }
  logger.log(`[browser] cleared stale profile lock (owner pid=${pid} is gone)`);
}

function defaultLaunch(executablePath: string, args: string[]): BrowserProcessLike {
  const child: ChildProcess = spawn(executablePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // 独立进程组:host 收到 SIGINT 时 Chromium 不跟着被终端信号带走,
    // 由我们自己按 dispose() 的顺序收尾(先关 CDP 再 kill)。
    detached: false,
  });
  return child as unknown as BrowserProcessLike;
}

/** host 数据目录下的云端浏览器落点(与 hostCore 的 hostDataDir 同源)。 */
export function browserDataDir(hostDataDir: string): string {
  return path.join(hostDataDir || path.join(os.homedir(), '.termpro-host'), 'browser');
}

export { CdpError };
