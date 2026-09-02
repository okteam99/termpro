// AI 浏览器控制服务(渲染层 · 2026-07-15):session 内的 AI 经 MCP → main → 本服务
// 驱动 OkWork 内置浏览器(真实 persist:browser 登录窗格)。控制原语(导航/执行 JS/
// 截图/取 DOM)走 webview 元素方法;标签管理走 store action。目标按 terminalTabId
// 定位其活跃浏览器窗格,或显式 browserTabId。
//
// 说明:AI 操作的就是用户真实登录会话(带 cookie)——刻意为之(用户指令 2026-07-15,
// 安全隔离暂不做)。控制层只做「能力」,不做「隔离/consent」。

import {
  getBrowserView,
  requestBrowserViewMount,
} from './browserViewRegistry';
import { resolveBrowserTabNet, useAppStore } from '../state/store';
import type { BrowserTabState } from '../state/store';
import {
  cloudBrowserHint,
  resolveBrowserBackend,
  type BrowserBackend,
} from './cloudBrowserRouting';

/** MCP 工具族:内置窗格 vs 远程 headless,互不自动分流。 */
export type BrowserSurface = 'inner' | 'headless-remote';

export interface BrowserTabInfo {
  id: string;
  url: string;
  title?: string;
  active: boolean;
  /** 该标签网络出口('local'|configId) */
  net: string;
}

/** 窗格已弹出到独立窗口时的清晰错误(非「稍后重试」的暂态语义)。 */
const POPPED_OUT_MSG =
  'browser pane is popped out to a separate window; dock it (click the tab browser icon) so the AI can drive it';

/** 预览标签(preview===true)的 URL 含一次性 token(HtmlPreview 起的本地预览 server),
 *  不该经 MCP 暴露给 AI(评审 P2-9,信息泄露面)——listTabs 脱敏成 preview://<文件名>,
 *  只留下「这是个预览标签」与「预览的哪个文件」,不带 host/port/token。取不到文件名时
 *  退化成裸 'preview://'。 */
function redactPreviewUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const basename = parsed.pathname.split('/').filter(Boolean).pop();
    return basename ? `preview://${basename}` : 'preview://';
  } catch {
    return 'preview://';
  }
}

/** 定位某终端 tab 的浏览器窗格(含所属 workspace,供出口解析)。 */
function findPane(terminalTabId: string): {
  tabs: BrowserTabState[];
  activeTabId: string | null;
  ownerHostId: string;
  poppedOut: boolean;
} | null {
  const s = useAppStore.getState();
  for (const w of s.workspaces) {
    const tab = w.tabs.find((t) => t.id === terminalTabId);
    if (tab) {
      return tab.browser
        ? {
            tabs: tab.browser.tabs,
            activeTabId: tab.browser.activeTabId,
            ownerHostId: w.hostId,
            poppedOut: tab.browser.poppedOut === true,
          }
        : { tabs: [], activeTabId: null, ownerHostId: w.hostId, poppedOut: false };
    }
  }
  return null;
}

/** 解析目标浏览器标签 id:显式 → 校验存在;缺省 → 窗格活跃标签。找不到/已弹出 → 抛。 */
function resolveTargetTabId(terminalTabId: string, browserTabId?: string): string {
  const pane = findPane(terminalTabId);
  if (!pane) throw new Error(`terminal tab not found: ${terminalTabId}`);
  // 弹出窗格的 webview 活在壳窗、其 store 才是权威;主窗只有镜像,view 取不到、写会被 sync 冲掉
  if (pane.poppedOut) throw new Error(POPPED_OUT_MSG);
  if (browserTabId) {
    if (!pane.tabs.some((b) => b.id === browserTabId)) {
      throw new Error(`browser tab not found: ${browserTabId}`);
    }
    return browserTabId;
  }
  if (!pane.activeTabId) throw new Error('no active browser tab; open one first');
  return pane.activeTabId;
}

/** 取目标 webview 元素;未挂载(刚开/切换未就绪)→ 抛,调用方可重试。 */
function requireView(terminalTabId: string, browserTabId?: string): HTMLWebViewElement {
  const id = resolveTargetTabId(terminalTabId, browserTabId);
  const el = getBrowserView(id);
  if (!el) throw new Error(`browser view not ready for tab ${id}; retry shortly`);
  return el;
}

// ---- 云端 / 本机 后端路由(见 cloudBrowserRouting.ts)----

/**
 * MCP 工具显式选表面,不再按 host 自动分流。
 * inner → 本机 OkWork 内置 webview(即使用户在远程 session)。
 * headless-remote → 远端 Chromium;本机 session / 没装浏览器 / 旧 host 直接报错。
 */
async function backendFor(
  terminalTabId: string,
  surface: BrowserSurface,
): Promise<BrowserBackend> {
  if (surface === 'inner') {
    return { kind: 'local', reason: 'local-host' };
  }
  const pane = findPane(terminalTabId);
  if (!pane) throw new Error(`terminal tab not found: ${terminalTabId}`);
  if (!pane.ownerHostId || pane.ownerHostId === 'local') {
    throw new Error(
      'headless remote browser is only available in a remote OkWork session',
    );
  }
  const backend = await resolveBrowserBackend(pane.ownerHostId);
  if (backend.kind !== 'cloud') {
    const hint = cloudBrowserHint(pane.ownerHostId);
    throw new Error(
      hint
        ? `headless remote browser is not available on this host: ${hint}`
        : 'headless remote browser is not available on this host (no Chromium, or host too old)',
    );
  }
  return backend;
}

// ---- 控制原语 ----

/** 在已有标签导航;标签不存在时开新标签(store src 自动加载,免竞态)。 */
export async function navigate(
  terminalTabId: string,
  url: string,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<{ browserTabId: string }> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { tabId } = await backend.client.rpc('browser.navigate', {
      url,
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return { browserTabId: tabId };
  }
  const s = useAppStore.getState();
  const pane = findPane(terminalTabId);
  if (!pane) throw new Error(`terminal tab not found: ${terminalTabId}`);
  if (pane.poppedOut) throw new Error(POPPED_OUT_MSG);
  // 无标签或指定空标签 → 开新标签(url 经 store src 加载);否则 loadURL 现有 webview
  if (!browserTabId && !pane.activeTabId) {
    s.addBrowserTab(terminalTabId, url);
    return { browserTabId: findPane(terminalTabId)!.activeTabId! };
  }
  const targetId = resolveTargetTabId(terminalTabId, browserTabId);
  // 预览标签(preview===true)出口钉死所属机器、URL 含一次性 token——不许 AI 导航走
  // (评审 P2-9):既会打穿「出口钉死」语义(导航到别处等于把预览 webview 借去访问任意
  // 站点),也无意义(预览标签本就是给 HtmlPreview 展示某个本地文件用的)。
  if (pane.tabs.find((b) => b.id === targetId)?.preview) {
    throw new Error(`browser tab ${targetId} is a preview tab (read-only; open a new tab to navigate)`);
  }
  const el = getBrowserView(targetId);
  // 先写 store 再导航:失败页(SSL/DNS 错)did-navigate 不回写,url 得先落镜像
  // (与地址栏手动导航同语义)。未挂载的后台标签须显式请求 BrowserPanel lazy mount
  // 并等 ref 注册;否则只改 store 就返回会形成「成功但零网络请求」的假成功。
  s.updateBrowserTab(terminalTabId, targetId, { url });
  if (el) {
    await el.loadURL(url);
  } else {
    // browserControl 需要真实 view 才能完成后续 eval/screenshot。面板隐藏时把它打开,
    // 但不切 workspace/terminal/browser tab 焦点;mount request 只增加后台 keep-alive。
    if (!useAppStore.getState().browserPanelOpen) {
      useAppStore.setState({ browserPanelOpen: true, filePanelCollapsed: true });
    }
    await requestBrowserViewMount(targetId);
    // 新 webview 的初始 src 已取上面写入的 store URL,不可再 loadURL 一次造成双导航。
  }
  return { browserTabId: targetId };
}

/** 在页面上下文执行 JS,返回结果(需可结构化克隆)。 */
export async function evalJs(
  terminalTabId: string,
  code: string,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<unknown> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { value } = await backend.client.rpc('browser.eval', {
      code,
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return value;
  }
  return requireView(terminalTabId, browserTabId).executeJavaScript(code, false);
}

/** 截图当前可见区,返回 data:image/png;base64,... */
export async function screenshot(
  terminalTabId: string,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<string> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    // host 侧返回裸 base64;这里补回 data: 前缀,保持与本机路径同一契约
    const { base64 } = await backend.client.rpc('browser.screenshot', {
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return `data:image/png;base64,${base64}`;
  }
  const img = await requireView(terminalTabId, browserTabId).capturePage();
  return img.toDataURL();
}

/** 取整页 HTML(document.documentElement.outerHTML)。 */
export async function getHtml(
  terminalTabId: string,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<string> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { html } = await backend.client.rpc('browser.getHtml', {
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return html;
  }
  return String(
    await requireView(terminalTabId, browserTabId).executeJavaScript(
      'document.documentElement.outerHTML',
      false,
    ),
  );
}

/** 取可见文本(document.body.innerText),便于 AI 读页面内容。 */
export async function getText(
  terminalTabId: string,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<string> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { text } = await backend.client.rpc('browser.getText', {
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return text;
  }
  return String(
    await requireView(terminalTabId, browserTabId).executeJavaScript(
      'document.body ? document.body.innerText : ""',
      false,
    ),
  );
}

// ---- 交互原语(经 executeJavaScript 在页面上下文操作,免 CDP;够覆盖多数站点)----

/** 点击匹配选择器的元素(先滚入视图 + 原生 click,React onClick 等冒泡处理器可响应)。 */
export async function click(
  terminalTabId: string,
  selector: string,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<boolean> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    // 云端派发的是真实鼠标事件(isTrusted=true),比这里的 el.click() 更接近真人
    const { ok } = await backend.client.rpc('browser.click', {
      selector,
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return ok;
  }
  const sel = JSON.stringify(selector);
  const code = `(function(){
    const el = document.querySelector(${sel});
    if (!el) throw new Error('element not found: ' + ${sel});
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return true;
  })()`;
  return Boolean(await requireView(terminalTabId, browserTabId).executeJavaScript(code, true));
}

/** 向 input/textarea 填入文本(原生 value setter + 派发 input/change,React 受控组件可感知)。 */
export async function typeText(
  terminalTabId: string,
  selector: string,
  text: string,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<boolean> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { ok } = await backend.client.rpc('browser.type', {
      selector,
      text,
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return ok;
  }
  const sel = JSON.stringify(selector);
  const val = JSON.stringify(text);
  const code = `(function(){
    const el = document.querySelector(${sel});
    if (!el) throw new Error('element not found: ' + ${sel});
    el.focus();
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, ${val});
    else el.value = ${val};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
  return Boolean(await requireView(terminalTabId, browserTabId).executeJavaScript(code, true));
}

/** 竖向滚动 dy 像素(缺省约一屏),返回滚动后的 scrollY。 */
export async function scroll(
  terminalTabId: string,
  dy?: number,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<number> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { scrollY } = await backend.client.rpc('browser.scroll', {
      ...(typeof dy === 'number' ? { dy } : {}),
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return scrollY;
  }
  const amount = typeof dy === 'number' ? dy : 0;
  const code = `(function(){
    const d = ${amount} || Math.round(window.innerHeight * 0.9);
    window.scrollBy(0, d);
    return window.scrollY;
  })()`;
  return Number(await requireView(terminalTabId, browserTabId).executeJavaScript(code, false));
}

/** 轮询等待选择器出现,最长 timeoutMs(缺省 5000);超时抛错。 */
export async function waitForSelector(
  terminalTabId: string,
  selector: string,
  timeoutMs = 5000,
  browserTabId?: string,
  surface: BrowserSurface = 'inner',
): Promise<boolean> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { ok } = await backend.client.rpc('browser.waitFor', {
      selector,
      timeoutMs,
      ...(browserTabId ? { tabId: browserTabId } : {}),
    });
    return ok;
  }
  const sel = JSON.stringify(selector);
  const to = Math.max(0, Math.floor(timeoutMs));
  const code = `new Promise((resolve, reject) => {
    if (document.querySelector(${sel})) { resolve(true); return; }
    const deadline = Date.now() + ${to};
    const iv = setInterval(() => {
      if (document.querySelector(${sel})) { clearInterval(iv); resolve(true); }
      else if (Date.now() > deadline) { clearInterval(iv); reject(new Error('timeout waiting for ' + ${sel})); }
    }, 100);
  })`;
  return Boolean(await requireView(terminalTabId, browserTabId).executeJavaScript(code, false));
}

// ---- 标签管理 ----

/** 列出该终端 tab 的浏览器标签(含活跃标记与出口)。预览标签(preview===true)的 url
 *  脱敏成 preview://<文件名>(见 redactPreviewUrl);title 照常保留。 */
export async function listTabs(
  terminalTabId: string,
  surface: BrowserSurface = 'inner',
): Promise<BrowserTabInfo[]> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { tabs } = await backend.client.rpc('browser.listTabs', undefined);
    // 云端标签的「出口」就是那台机器本身(没有本机窗格的 per-tab 出口概念)
    return tabs.map((t) => ({
      id: t.tabId,
      url: t.url,
      title: t.title,
      active: t.active,
      net: backend.hostId,
    }));
  }
  const pane = findPane(terminalTabId);
  if (!pane) throw new Error(`terminal tab not found: ${terminalTabId}`);
  return pane.tabs.map((b) => ({
    id: b.id,
    url: b.preview ? redactPreviewUrl(b.url) : b.url,
    title: b.title,
    active: b.id === pane.activeTabId,
    net: resolveBrowserTabNet(b, pane.ownerHostId),
  }));
}

/** 开新浏览器标签(url 缺省空);返回新标签 id(addBrowserTab 会把它设为活跃)。 */
export async function openTab(
  terminalTabId: string,
  url = '',
  surface: BrowserSurface = 'inner',
): Promise<{ browserTabId: string }> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    const { tabId } = await backend.client.rpc('browser.openTab', {
      ...(url ? { url } : {}),
    });
    return { browserTabId: tabId };
  }
  const s = useAppStore.getState();
  const pane = findPane(terminalTabId);
  if (!pane) throw new Error(`terminal tab not found: ${terminalTabId}`);
  if (pane.poppedOut) throw new Error(POPPED_OUT_MSG);
  s.addBrowserTab(terminalTabId, url);
  return { browserTabId: findPane(terminalTabId)!.activeTabId! };
}

/** 关闭某浏览器标签。 */
export async function closeTab(
  terminalTabId: string,
  browserTabId: string,
  surface: BrowserSurface = 'inner',
): Promise<void> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    await backend.client.rpc('browser.closeTab', { tabId: browserTabId });
    return;
  }
  resolveTargetTabId(terminalTabId, browserTabId); // 校验存在
  useAppStore.getState().closeBrowserTab(terminalTabId, browserTabId);
}

/** 激活某浏览器标签。 */
export async function activateTab(
  terminalTabId: string,
  browserTabId: string,
  surface: BrowserSurface = 'inner',
): Promise<void> {
  const backend = await backendFor(terminalTabId, surface);
  if (backend.kind === 'cloud') {
    await backend.client.rpc('browser.activateTab', { tabId: browserTabId });
    return;
  }
  resolveTargetTabId(terminalTabId, browserTabId);
  useAppStore.getState().setBrowserActiveTab(terminalTabId, browserTabId);
}
