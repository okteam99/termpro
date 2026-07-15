// AI 浏览器 MCP:终端 env 注入。OkWork 起终端时把该 tab 绑定的 MCP 端点 URL 注入 pty
// env,session 内 agent 据此发现并连上(browser MCP 工具)。
// - 本地 session(阶段2c):URL 指本机 MCP server base。
// - 远程 session(阶段3):URL 指容器回环固定端口 127.0.0.1:BROWSER_MCP_REMOTE_PORT,
//   由 orchestrator 在 host ready 时建的反向转发打回本机 MCP server。
// 两者都以 getBase()!=null(本机 MCP server 已起)为特性开关——server 没起则反向转发
// 也不存在,远程注入亦无意义,故一并跳过。
//
// base URL 惰性缓存为一个 Promise:App 启动可先 prime;若未 prime,首个 spawn 会自行
// 拉一次(缓存复用)。ensureSession spawn 前 await 它,规避「hydrate 恢复的首个终端早于
// base 拉取完成 → 漏注入」的竞态(否则重开的那个终端恰好用不了)。

import { BROWSER_MCP_REMOTE_PORT } from '../../shared/browserMcp';

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

/** 该终端 tab 的 MCP 端点 env(本机 MCP 未起 → undefined)。本地用 base,远程用容器回环口。 */
export async function browserMcpEnvFor(
  terminalTabId: string,
  hostId: string | null,
): Promise<Record<string, string> | undefined> {
  const base = await getBase();
  if (!base) return undefined; // 本机 MCP server 未起 → 本地/远程都不注入(反向转发亦不存在)
  const path = `/mcp/${encodeURIComponent(terminalTabId)}`;
  const url =
    hostId === 'local' ? `${base}${path}` : `http://127.0.0.1:${BROWSER_MCP_REMOTE_PORT}${path}`;
  return { OKWORK_TERMINAL_TAB: terminalTabId, OKWORK_BROWSER_MCP_URL: url };
}

/** 仅供单测:清空缓存,使 base 可在多用例间重新解析。 */
export function __resetBrowserMcpEnvForTest(): void {
  basePromise = null;
}
