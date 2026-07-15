// AI 浏览器控制服务(渲染层 · 2026-07-15):session 内的 AI 经 MCP → main → 本服务
// 驱动 OkWork 内置浏览器(真实 persist:browser 登录窗格)。控制原语(导航/执行 JS/
// 截图/取 DOM)走 webview 元素方法;标签管理走 store action。目标按 terminalTabId
// 定位其活跃浏览器窗格,或显式 browserTabId。
//
// 说明:AI 操作的就是用户真实登录会话(带 cookie)——刻意为之(用户指令 2026-07-15,
// 安全隔离暂不做)。控制层只做「能力」,不做「隔离/consent」。

import { getBrowserView } from './browserViewRegistry';
import { resolveBrowserTabNet, useAppStore } from '../state/store';
import type { BrowserTabState } from '../state/store';

export interface BrowserTabInfo {
  id: string;
  url: string;
  title?: string;
  active: boolean;
  /** 该标签网络出口('local'|configId) */
  net: string;
}

/** 定位某终端 tab 的浏览器窗格(含所属 workspace,供出口解析)。 */
function findPane(terminalTabId: string): {
  tabs: BrowserTabState[];
  activeTabId: string | null;
  ownerHostId: string;
} | null {
  const s = useAppStore.getState();
  for (const w of s.workspaces) {
    const tab = w.tabs.find((t) => t.id === terminalTabId);
    if (tab) {
      return tab.browser
        ? { tabs: tab.browser.tabs, activeTabId: tab.browser.activeTabId, ownerHostId: w.hostId }
        : { tabs: [], activeTabId: null, ownerHostId: w.hostId };
    }
  }
  return null;
}

/** 解析目标浏览器标签 id:显式 → 校验存在;缺省 → 窗格活跃标签。找不到 → 抛。 */
function resolveTargetTabId(terminalTabId: string, browserTabId?: string): string {
  const pane = findPane(terminalTabId);
  if (!pane) throw new Error(`terminal tab not found: ${terminalTabId}`);
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

// ---- 控制原语 ----

/** 在已有标签导航;标签不存在时开新标签(store src 自动加载,免竞态)。 */
export async function navigate(
  terminalTabId: string,
  url: string,
  browserTabId?: string,
): Promise<{ browserTabId: string }> {
  const s = useAppStore.getState();
  const pane = findPane(terminalTabId);
  if (!pane) throw new Error(`terminal tab not found: ${terminalTabId}`);
  // 无标签或指定空标签 → 开新标签(url 经 store src 加载);否则 loadURL 现有 webview
  if (!browserTabId && !pane.activeTabId) {
    s.addBrowserTab(terminalTabId, url);
    return { browserTabId: findPane(terminalTabId)!.activeTabId! };
  }
  const targetId = resolveTargetTabId(terminalTabId, browserTabId);
  const el = getBrowserView(targetId);
  if (el) await el.loadURL(url);
  else s.updateBrowserTab(terminalTabId, targetId, { url }); // 未挂载:写 store 触发 src 加载
  return { browserTabId: targetId };
}

/** 在页面上下文执行 JS,返回结果(需可结构化克隆)。 */
export async function evalJs(
  terminalTabId: string,
  code: string,
  browserTabId?: string,
): Promise<unknown> {
  return requireView(terminalTabId, browserTabId).executeJavaScript(code, false);
}

/** 截图当前可见区,返回 data:image/png;base64,... */
export async function screenshot(
  terminalTabId: string,
  browserTabId?: string,
): Promise<string> {
  const img = await requireView(terminalTabId, browserTabId).capturePage();
  return img.toDataURL();
}

/** 取整页 HTML(document.documentElement.outerHTML)。 */
export async function getHtml(terminalTabId: string, browserTabId?: string): Promise<string> {
  return String(
    await requireView(terminalTabId, browserTabId).executeJavaScript(
      'document.documentElement.outerHTML',
      false,
    ),
  );
}

/** 取可见文本(document.body.innerText),便于 AI 读页面内容。 */
export async function getText(terminalTabId: string, browserTabId?: string): Promise<string> {
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
): Promise<boolean> {
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
): Promise<boolean> {
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
): Promise<number> {
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
): Promise<boolean> {
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

/** 列出该终端 tab 的浏览器标签(含活跃标记与出口)。 */
export function listTabs(terminalTabId: string): BrowserTabInfo[] {
  const pane = findPane(terminalTabId);
  if (!pane) throw new Error(`terminal tab not found: ${terminalTabId}`);
  return pane.tabs.map((b) => ({
    id: b.id,
    url: b.url,
    title: b.title,
    active: b.id === pane.activeTabId,
    net: resolveBrowserTabNet(b, pane.ownerHostId),
  }));
}

/** 开新浏览器标签(url 缺省空);返回新标签 id(addBrowserTab 会把它设为活跃)。 */
export function openTab(terminalTabId: string, url = ''): { browserTabId: string } {
  const s = useAppStore.getState();
  if (!findPane(terminalTabId)) throw new Error(`terminal tab not found: ${terminalTabId}`);
  s.addBrowserTab(terminalTabId, url);
  return { browserTabId: findPane(terminalTabId)!.activeTabId! };
}

/** 关闭某浏览器标签。 */
export function closeTab(terminalTabId: string, browserTabId: string): void {
  resolveTargetTabId(terminalTabId, browserTabId); // 校验存在
  useAppStore.getState().closeBrowserTab(terminalTabId, browserTabId);
}

/** 激活某浏览器标签。 */
export function activateTab(terminalTabId: string, browserTabId: string): void {
  resolveTargetTabId(terminalTabId, browserTabId);
  useAppStore.getState().setBrowserActiveTab(terminalTabId, browserTabId);
}
