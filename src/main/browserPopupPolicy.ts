// 内置浏览器弹窗策略(用户指令 2026-08-12):Google 登录一类的弹窗必须开【真窗】。
//
// 为什么不能一律转面板新标签(旧行为):OAuth 弹窗流依赖三件事——window.open() 的
// 返回值(WindowProxy,站点用它轮询 popup.closed)、window.opener(登录完回传
// postMessage)、弹窗自己 window.close()。转成面板标签后 window.open() 恒返回 null,
// 站点直接判定「弹窗被拦截」,登录走不下去。所以按 disposition/features 分流:
//   · 弹窗语义(window.open 带窗口特性 / disposition=new-window)→ 开子浏览器窗口
//     (真 popup,opener 链完整,分区跟着开启方 guest 走 → 登录态落对 profile)
//   · 普通 target=_blank / 无特性的新标签语义 → 仍落面板新标签(旧行为)
//   · 非 http(s) → 恒拒(与主框架导航同白名单)
//
// 纯函数模块(零 Electron import),main.ts 的 setWindowOpenHandler 据此分支。

export type PopupHostMode = 'pane' | 'external';

/** Electron WindowOpenHandlerDetails 的取用子集 */
export interface BrowserPopupRequest {
  url: string;
  disposition:
    | 'default'
    | 'foreground-tab'
    | 'background-tab'
    | 'new-window'
    | 'other';
  /** window.open(url, name) 的 name;空串 = 匿名 */
  frameName: string;
  /** window.open 的第三参(逗号分隔);链接 target=_blank 恒空串 */
  features: string;
}

export interface BrowserPopupContext {
  /** 宿主窗口的弹窗落位模式:pane = 面板新标签;external = 系统浏览器 */
  mode: PopupHostMode;
  now: number;
  /** 该 guest 上一次放行弹窗的时刻(限频用) */
  lastOpenAt: number;
  /** 同名(frameName)子窗已存在且存活 —— 浏览器语义是复用而非再开一个 */
  hasNamedWindow: boolean;
  /** 该 guest 当前存活的子窗数(防弹窗轰炸) */
  childWindowCount: number;
}

export type BrowserPopupDecision =
  /** 开子浏览器窗口(真 popup,保住 opener/window.close) */
  | { kind: 'child-window' }
  /** 同名子窗复用:聚焦并把它导航到新 URL,不再开窗 */
  | { kind: 'reuse-window' }
  /** 送回本窗 renderer,在浏览器面板里开新标签 */
  | { kind: 'pane-tab' }
  /** 送系统浏览器(查看器等无面板的窗口) */
  | { kind: 'external' }
  | { kind: 'deny'; reason: 'scheme' | 'flood' | 'window-cap' };

/** 同一 guest 两次放行弹窗的最小间隔(防脚本灌爆) */
export const POPUP_MIN_INTERVAL_MS = 300;
/** 单个 guest 同时存活的子浏览器窗上限 */
export const POPUP_MAX_CHILD_WINDOWS = 4;

/** noopener/noreferrer 是「怎么开」的修饰,不是窗口几何特性——带它们的 window.open
 *  在浏览器里开的是标签页而非弹窗,故不计入弹窗信号。 */
const NON_GEOMETRY_FEATURES = new Set([
  'noopener',
  'noreferrer',
  'nofollow',
  '',
]);

/** window.open 第三参非空(且不止 noopener 一类修饰)→ Chromium 语义即弹窗。
 *  disposition 判定之外再看 features,是为了不依赖 Chromium NEW_POPUP →
 *  Electron disposition 的映射细节(两条判据任一命中即按弹窗处理)。 */
export function hasWindowGeometryFeature(features: string): boolean {
  return features
    .split(',')
    .map((part) => (part.split('=')[0] ?? '').trim().toLowerCase())
    .some((key) => !NON_GEOMETRY_FEATURES.has(key));
}

export function isPopupRequest(req: BrowserPopupRequest): boolean {
  return (
    req.disposition === 'new-window' || hasWindowGeometryFeature(req.features)
  );
}

export function decideBrowserPopup(
  req: BrowserPopupRequest,
  ctx: BrowserPopupContext,
): BrowserPopupDecision {
  if (!/^https?:\/\//i.test(req.url)) return { kind: 'deny', reason: 'scheme' };
  const popup = isPopupRequest(req);
  // 复用不新建窗口 → 不受限频约束(用户连点「用 Google 登录」不该被吞)
  if (popup && req.frameName && ctx.hasNamedWindow)
    return { kind: 'reuse-window' };
  if (ctx.now - ctx.lastOpenAt <= POPUP_MIN_INTERVAL_MS) {
    return { kind: 'deny', reason: 'flood' };
  }
  // 无面板的宿主(查看器等)恒送系统浏览器:那里没有可落标签的窗格,
  // 也不该由它长出一套浏览器窗口体系。
  if (ctx.mode === 'external') return { kind: 'external' };
  if (!popup) return { kind: 'pane-tab' };
  return ctx.childWindowCount >= POPUP_MAX_CHILD_WINDOWS
    ? { kind: 'deny', reason: 'window-cap' }
    : { kind: 'child-window' };
}

/** 子浏览器窗标题:域名打头(反钓鱼——用户要在这窗里输密码,必须一眼看清是谁的页面) */
export function browserPopupWindowTitle(
  url: string,
  pageTitle: string,
): string {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }
  const title = pageTitle.trim();
  if (!host) return title || 'about:blank';
  return title ? `${host} · ${title}` : host;
}
