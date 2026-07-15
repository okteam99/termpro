// 浏览器 webview 元素的模块级注册表(AI 浏览器控制 · 2026-07-15):BrowserPanel/壳窗
// 渲染每个浏览器标签的 <webview> 时把元素注册进来,控制服务(browserControl)据此在
// 组件外拿到 webview 驱动它(executeJavaScript/capturePage/loadURL)。跨组件挂载周期
// 存活(像 terminalRegistry),键 = 浏览器标签 id(全局唯一 uuid)。

type WebviewEl = HTMLWebViewElement;

const views = new Map<string, WebviewEl>();

/** BrowserPanel handleWebviewRef 调用:node 存在即注册,null 即注销。 */
export function registerBrowserView(browserTabId: string, el: WebviewEl | null): void {
  if (el) views.set(browserTabId, el);
  else views.delete(browserTabId);
}

/** 控制服务据此取 webview 元素;未挂载(刚开标签/已关)→ undefined。 */
export function getBrowserView(browserTabId: string): WebviewEl | undefined {
  return views.get(browserTabId);
}

/** 仅供单测:清空注册表。 */
export function __clearBrowserViewsForTest(): void {
  views.clear();
}
