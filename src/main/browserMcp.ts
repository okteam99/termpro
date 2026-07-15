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
const N = { type: 'number' } as const;

// 工具全集(13 个)。browserTabId 缺省 → 该终端 tab 的活跃浏览器标签。
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
    name: 'browser_click',
    description: 'Click the first element matching a CSS selector (scrolls it into view first).',
    inputSchema: obj({ selector: S, browserTabId: S }, ['selector']),
    method: 'click',
    buildArgs: (t, a) => [t, a.selector, a.browserTabId],
  },
  {
    name: 'browser_type',
    description: 'Fill an input/textarea (by CSS selector) with text, firing input/change events.',
    inputSchema: obj({ selector: S, text: S, browserTabId: S }, ['selector', 'text']),
    method: 'typeText',
    buildArgs: (t, a) => [t, a.selector, a.text, a.browserTabId],
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page vertically by dy pixels (default ~one viewport); returns new scrollY.',
    inputSchema: obj({ dy: N, browserTabId: S }),
    method: 'scroll',
    buildArgs: (t, a) => [t, a.dy, a.browserTabId],
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until a CSS selector appears in the page, up to timeoutMs (default 5000).',
    inputSchema: obj({ selector: S, timeoutMs: N, browserTabId: S }, ['selector']),
    method: 'waitForSelector',
    buildArgs: (t, a) => [t, a.selector, a.timeoutMs ?? 5000, a.browserTabId],
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
  /** 当前活跃会话数(可观测性/测试:验证同 tab 重连逐旧、空闲回收生效)。 */
  sessionCount(): number;
  close(): Promise<void>;
}

/** 起 MCP HTTP server(127.0.0.1:随机端口),按 URL /mcp/<terminalTabId> 绑 tab,
 *  stateful 会话按 mcp-session-id 路由(初始化时按 URL 的 tabId 建绑定 server)。 */
// 会话空闲回收阈值:超过此时长没请求即判定 agent 已退出/断流,主动关。SDK 的
// transport.onclose 仅在显式 HTTP DELETE 或 transport.close() 触发——agent 被 Ctrl-C /
// tab 关 / 远程重连断 SSE 流时都不发 DELETE,不回收则 { transport, server } 永驻,
// 长时运行(尤其远程)无界增长。双保险:① 同 tab 重连时先逐旧会话(封顶≈标签数);
// ② 空闲扫描兜底(tab 关了不会再来新 init 的情形)。
const SESSION_IDLE_MS = 15 * 60 * 1000;
const SESSION_SWEEP_MS = 60 * 1000;

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
  terminalTabId: string;
  lastSeen: number;
}

export function startBrowserMcpServer(invoke: InvokeBrowserControl): Promise<BrowserMcpHandle> {
  // sessionId → 会话;初始化请求建立,后续按 mcp-session-id header 路由
  const sessions = new Map<string, McpSession>();

  // 空闲扫描:超阈值即 close(触发 onclose 从表删除)。unref 不拖住进程退出。
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) {
      if (now - s.lastSeen > SESSION_IDLE_MS) void s.transport.close();
    }
  }, SESSION_SWEEP_MS);
  sweeper.unref?.();

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
          // 同一 tab 的旧会话(agent 重启/重连但旧会话没发 DELETE)先逐掉,封顶≈标签数
          for (const s of sessions.values()) {
            if (s.terminalTabId === terminalTabId) void s.transport.close();
          }
          sessions.set(sid, { transport, server, terminalTabId, lastSeen: Date.now() });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      entry = { transport, server, terminalTabId, lastSeen: Date.now() };
    }
    entry.lastSeen = Date.now();
    await entry.transport.handleRequest(req, res, body);
  }

  return new Promise<BrowserMcpHandle>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        urlFor: (t) => `http://127.0.0.1:${port}/mcp/${encodeURIComponent(t)}`,
        sessionCount: () => sessions.size,
        close: () =>
          new Promise<void>((r) => {
            clearInterval(sweeper);
            for (const { transport } of sessions.values()) void transport.close();
            // keep-alive socket 会拖住 httpServer.close 不回调,显式销毁在途连接
            (httpServer as HttpServer & { closeAllConnections?: () => void }).closeAllConnections?.();
            httpServer.close(() => r());
          }),
      });
    });
  });
}
