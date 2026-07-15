// AI 浏览器控制桥(渲染层侧 · 阶段2):订阅 main 转来的控制请求 → 派发到 browserControl
// 对应方法 → 结果回传 main。方法白名单(只放行 browserControl 的已知导出),防 main 侧
// (或其上游 MCP)调到任意函数。控制在渲染层(它有 webview 元素 + store)。

import * as bc from './browserControl';

// 白名单:方法名 → 实现。签名统一 (...args) → 结果(同步/异步都行)。
const METHODS: Record<string, (...args: never[]) => unknown> = {
  navigate: bc.navigate as never,
  evalJs: bc.evalJs as never,
  screenshot: bc.screenshot as never,
  getHtml: bc.getHtml as never,
  getText: bc.getText as never,
  listTabs: bc.listTabs as never,
  openTab: bc.openTab as never,
  closeTab: bc.closeTab as never,
  activateTab: bc.activateTab as never,
};

let initialized = false;

export function initBrowserControlBridge(): void {
  if (initialized) return;
  initialized = true;
  window.okwork?.browserControl?.onInvoke(async ({ requestId, method, args }) => {
    try {
      const fn = METHODS[method];
      if (!fn) throw new Error(`unknown browser control method: ${method}`);
      const value = await fn(...((args ?? []) as never[]));
      window.okwork.browserControl.sendResult({ requestId, ok: true, value });
    } catch (e) {
      window.okwork.browserControl.sendResult({
        requestId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

/** 仅供单测:复位初始化标志,使 initBrowserControlBridge 可在多用例间重挂。 */
export function __resetBrowserControlBridgeForTest(): void {
  initialized = false;
}
