// AI 浏览器 MCP:本地终端 env 注入(阶段2c)。OkWork 起终端时把该 tab 绑定的 MCP
// 端点 URL 注入 pty env,session 内 agent 据此发现并连上(browser MCP 工具)。
// 仅本地 session——远程 session 的 URL 指向本机端口,需 SSH 反向转发(阶段3)才可达。
//
// base URL 惰性缓存为一个 Promise:App 启动可先 prime;若未 prime,首个本地 spawn
// 会自行拉一次(缓存复用)。ensureSession spawn 前 await 它,规避「hydrate 恢复的
// 首个终端早于 base 拉取完成 → 漏注入」的竞态(否则重开的那个终端恰好用不了)。

let basePromise: Promise<string | null> | null = null;

/** App 启动拉一次 main 的 MCP base URL 后设入(prime 缓存,后续 spawn 复用)。 */
export function setBrowserMcpBase(base: string | null): void {
  basePromise = Promise.resolve(base);
}

function getBase(): Promise<string | null> {
  if (!basePromise) {
    basePromise = window.okwork?.browserControl?.mcpBase?.() ?? Promise.resolve(null);
  }
  return basePromise;
}

/** 该终端 tab 若为本地 session 且 MCP 就绪 → 返回注入 env;否则 undefined。 */
export async function browserMcpEnvFor(
  terminalTabId: string,
  hostId: string | null,
): Promise<Record<string, string> | undefined> {
  if (hostId !== 'local') return undefined;
  const base = await getBase();
  if (!base) return undefined;
  return {
    OKWORK_TERMINAL_TAB: terminalTabId,
    OKWORK_BROWSER_MCP_URL: `${base}/mcp/${encodeURIComponent(terminalTabId)}`,
  };
}

/** 仅供单测:清空缓存,使 base 可在多用例间重新解析。 */
export function __resetBrowserMcpEnvForTest(): void {
  basePromise = null;
}
