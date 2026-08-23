// 浏览器 webview 元素的模块级注册表(AI 浏览器控制 · 2026-07-15):BrowserPanel/壳窗
// 渲染每个浏览器标签的 <webview> 时把元素注册进来,控制服务(browserControl)据此在
// 组件外拿到 webview 驱动它(executeJavaScript/capturePage/loadURL)。跨组件挂载周期
// 存活(像 terminalRegistry),键 = 浏览器标签 id(全局唯一 uuid)。

type WebviewEl = HTMLWebViewElement;

const views = new Map<string, WebviewEl>();
const pendingMounts = new Set<string>();
const mountListeners = new Set<(browserTabId: string) => void>();
const mountWaiters = new Map<
  string,
  Set<{
    resolve: (el: WebviewEl) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>
>();

const MOUNT_TIMEOUT_MS = 15_000;

/** BrowserPanel handleWebviewRef 调用:node 存在即注册,null 即注销。 */
export function registerBrowserView(browserTabId: string, el: WebviewEl | null): void {
  if (el) {
    views.set(browserTabId, el);
    pendingMounts.delete(browserTabId);
    const waiters = mountWaiters.get(browserTabId);
    if (waiters) {
      mountWaiters.delete(browserTabId);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(el);
      }
    }
  } else {
    views.delete(browserTabId);
  }
}

/** 控制服务据此取 webview 元素;未挂载(刚开标签/已关)→ undefined。 */
export function getBrowserView(browserTabId: string): WebviewEl | undefined {
  return views.get(browserTabId);
}

/** BrowserPanel 订阅程序化挂载意图。订阅建立前到达的请求会立即 replay。 */
export function onBrowserViewMountRequested(
  listener: (browserTabId: string) => void,
): () => void {
  mountListeners.add(listener);
  for (const browserTabId of pendingMounts) listener(browserTabId);
  return () => mountListeners.delete(listener);
}

/**
 * AI/browserControl 显式访问尚未挂载的后台标签:通知 BrowserPanel 把它纳入本次
 * keep-alive,并等 ref 真注册后才宣称 view 可用。超时即失败,不返回假成功。
 */
export function requestBrowserViewMount(browserTabId: string): Promise<WebviewEl> {
  const existing = views.get(browserTabId);
  if (existing) return Promise.resolve(existing);

  return new Promise<WebviewEl>((resolve, reject) => {
    const waiters = mountWaiters.get(browserTabId) ?? new Set();
    const waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        waiters.delete(waiter);
        if (waiters.size === 0) {
          mountWaiters.delete(browserTabId);
          pendingMounts.delete(browserTabId);
        }
        reject(new Error(`browser view mount timed out for tab ${browserTabId}`));
      }, MOUNT_TIMEOUT_MS),
    };
    waiters.add(waiter);
    mountWaiters.set(browserTabId, waiters);
    pendingMounts.add(browserTabId);
    for (const listener of mountListeners) listener(browserTabId);
  });
}

/** 仅供单测:清空注册表。 */
export function __clearBrowserViewsForTest(): void {
  views.clear();
  pendingMounts.clear();
  mountListeners.clear();
  for (const waiters of mountWaiters.values()) {
    for (const waiter of waiters) clearTimeout(waiter.timer);
  }
  mountWaiters.clear();
}
