// AI 浏览器控制 MCP server(main · 阶段2b):把 browserControl 的能力暴露成 MCP 工具,
// session 内的 agent(Claude Code/Codex)连上即可驱动 OkWork 内置浏览器(真实登录会话)。
//
// 绑定(用户选 A):每个连接绑一个【终端 tab】——URL 路径 /mcp/<terminalTabId> 携带,
// 工具默认操作该 tab 的浏览器窗格。OkWork spawn 终端时把该 URL 经 env 注入(接线见 main.ts)。
// 传输:MCP streamable HTTP(stateful,按 mcp-session-id 路由),经 SDK。工具执行走
// invokeBrowserControl → 渲染层 browserControl。

import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export type InvokeBrowserControl = (method: string, args: unknown[]) => Promise<unknown>;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  method: string;
  /** MCP 工具入参 → browserControl 位置参数(首位恒为绑定的 terminalTabId)。 */
  buildArgs: (terminalTabId: string, a: Record<string, unknown>) => unknown[];
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties: props,
  required,
});
const S = { type: 'string' } as const;

// 工具全集(9 个)。browserTabId 缺省 → 该终端 tab 的活跃浏览器标签。
const TOOLS: ToolDef[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL (opens a new tab if none exists).',
    inputSchema: obj({ url: S, browserTabId: S }, ['url']),
    method: 'navigate',
    buildArgs: (t, a) => [t, a.url, a.browserTabId],
  },
  {
    name: 'browser_eval',
    description: 'Run JavaScript in the active page and return the (structured-cloneable) result.',
    inputSchema: obj({ code: S, browserTabId: S }, ['code']),
    method: 'evalJs',
    buildArgs: (t, a) => [t, a.code, a.browserTabId],
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a PNG screenshot of the visible page.',
    inputSchema: obj({ browserTabId: S }),
    method: 'screenshot',
    buildArgs: (t, a) => [t, a.browserTabId],
  },
  {
    name: 'browser_get_html',
    description: 'Get the full page HTML (document.documentElement.outerHTML).',
    inputSchema: obj({ browserTabId: S }),
    method: 'getHtml',
    buildArgs: (t, a) => [t, a.browserTabId],
  },
  {
    name: 'browser_get_text',
    description: 'Get the visible page text (document.body.innerText).',
    inputSchema: obj({ browserTabId: S }),
    method: 'getText',
    buildArgs: (t, a) => [t, a.browserTabId],
  },
  {
    name: 'browser_list_tabs',
    description: 'List the browser tabs bound to this terminal (id, url, title, active, net exit).',
    inputSchema: obj({}),
    method: 'listTabs',
    buildArgs: (t) => [t],
  },
  {
    name: 'browser_open_tab',
    description: 'Open a new browser tab (optional url); returns the new tab id.',
    inputSchema: obj({ url: S }),
    method: 'openTab',
    buildArgs: (t, a) => [t, a.url ?? ''],
  },
  {
    name: 'browser_close_tab',
    description: 'Close a browser tab by id.',
    inputSchema: obj({ browserTabId: S }, ['browserTabId']),
    method: 'closeTab',
    buildArgs: (t, a) => [t, a.browserTabId],
  },
  {
    name: 'browser_activate_tab',
    description: 'Activate (focus) a browser tab by id.',
    inputSchema: obj({ browserTabId: S }, ['browserTabId']),
    method: 'activateTab',
    buildArgs: (t, a) => [t, a.browserTabId],
  },
];

/** 建一个绑定到某终端 tab 的 MCP Server(工具经 invoke 调 browserControl)。 */
export function buildBrowserMcpServer(
  terminalTabId: string,
  invoke: InvokeBrowserControl,
): Server {
  const server = new Server(
    { name: 'okwork-browser', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = TOOLS.find((t) => t.name === req.params.name);
    if (!def) {
      return { isError: true, content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }] };
    }
    try {
      const args = def.buildArgs(terminalTabId, (req.params.arguments ?? {}) as Record<string, unknown>);
      const result = await invoke(def.method, args);
      if (def.name === 'browser_screenshot') {
        const data = String(result).replace(/^data:image\/png;base64,/, '');
        return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
      }
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
      };
    }
  });
  return server;
}

export interface BrowserMcpHandle {
  port: number;
  /** 给定终端 tab 的 MCP 端点 URL(env 注入用) */
  urlFor(terminalTabId: string): string;
  close(): Promise<void>;
}

/** 起 MCP HTTP server(127.0.0.1:随机端口),按 URL /mcp/<terminalTabId> 绑 tab,
 *  stateful 会话按 mcp-session-id 路由(初始化时按 URL 的 tabId 建绑定 server)。 */
export function startBrowserMcpServer(invoke: InvokeBrowserControl): Promise<BrowserMcpHandle> {
  // sessionId → { transport, server };初始化请求建立,后续按 header 路由
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

  const httpServer: HttpServer = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : undefined;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const m = req.url?.match(/^\/mcp\/([^/?]+)/);
    if (!m) {
      res.writeHead(404);
      res.end();
      return;
    }
    const terminalTabId = decodeURIComponent(m[1]);
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const body = req.method === 'POST' ? await readBody(req) : undefined;

    let entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry) {
      // 新会话:建绑定到该 tab 的 server + transport(sessionId 由 transport 生成)。
      // 显式类型的前置声明避免闭包引用自身初始化器(TS7022)。
      const server = buildBrowserMcpServer(terminalTabId, invoke);
      let transport: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, server });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      entry = { transport, server };
    }
    await entry.transport.handleRequest(req, res, body);
  }

  return new Promise<BrowserMcpHandle>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        urlFor: (t) => `http://127.0.0.1:${port}/mcp/${encodeURIComponent(t)}`,
        close: () =>
          new Promise<void>((r) => {
            for (const { transport } of sessions.values()) void transport.close();
            httpServer.close(() => r());
          }),
      });
    });
  });
}
