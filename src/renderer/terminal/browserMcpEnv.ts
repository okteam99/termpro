// AI 浏览器 MCP:本地终端 env 注入(阶段2c)。OkWork 起终端时把该 tab 绑定的 MCP
// 端点 URL 注入 pty env,session 内 agent 据此发现并连上(browser MCP 工具)。
// 仅本地 session——远程 session 的 URL 指向本机端口,需 SSH 反向转发(阶段3)才可达。

let mcpBase: string | null = null;

/** App 启动拉一次 main 的 MCP base URL(browserControl.mcpBase)后设入。 */
export function setBrowserMcpBase(base: string | null): void {
  mcpBase = base;
}

/** 该终端 tab 若为本地 session 且 MCP 已就绪 → 返回注入 env;否则 undefined。 */
export function browserMcpEnvFor(
  terminalTabId: string,
  hostId: string | null,
): Record<string, string> | undefined {
  if (hostId !== 'local' || !mcpBase) return undefined;
  return {
    OKWORK_TERMINAL_TAB: terminalTabId,
    OKWORK_BROWSER_MCP_URL: `${mcpBase}/mcp/${encodeURIComponent(terminalTabId)}`,
  };
}
