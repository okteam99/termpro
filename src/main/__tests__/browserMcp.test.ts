// AI 浏览器 MCP server(阶段2b):用 SDK 自带 client 真连自建 server,端到端验证
// tools/list(9 工具)+ tools/call 路由到 invokeBrowserControl(首参恒为 URL 绑的
// terminalTabId)+ 结果编码(文本/图片/错误)。stateful streamable-HTTP 传输真实握手。
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startBrowserMcpServer, type BrowserMcpHandle } from '../browserMcp';
import { OKWORK_BROWSER_MCP_BRIDGE_SOURCE } from '../../shared/okworkBrowserMcpBridge';

let handle: BrowserMcpHandle | null = null;
let client: Client | null = null;

afterEach(async () => {
  await client?.close();
  await handle?.close();
  handle = null;
  client = null;
});

async function connect(invoke: (m: string, a: unknown[]) => Promise<unknown>, tabId = 'term1') {
  handle = await startBrowserMcpServer(invoke);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(handle.urlFor(tabId))));
  return client;
}

describe('browserMcp server', () => {
  it('tools/list 暴露 26 个工具:inner_browser_* 与 headless_remote_browser_* 两套,无旧 browser_*', async () => {
    const c = await connect(async () => 'ok');
    const { tools } = await c.listTools();
    expect(tools).toHaveLength(26);
    const names = tools.map((t) => t.name);
    expect(names.filter((n) => n.startsWith('inner_browser_'))).toHaveLength(13);
    expect(names.filter((n) => n.startsWith('headless_remote_browser_'))).toHaveLength(13);
    expect(names.filter((n) => n.startsWith('browser_'))).toEqual([]);
    expect(names).toEqual(
      expect.arrayContaining([
        'inner_browser_navigate',
        'inner_browser_wait_for',
        'headless_remote_browser_navigate',
        'headless_remote_browser_screenshot',
      ]),
    );
  });

  it('交互工具 → invoke 位置参数(首=绑定 tab,末=surface)', async () => {
    const invoke = vi.fn(async () => true);
    const c = await connect(invoke as never, 'term-INT');

    await c.callTool({ name: 'inner_browser_click', arguments: { selector: '#go' } });
    expect(invoke).toHaveBeenCalledWith('click', ['term-INT', '#go', undefined, 'inner']);

    await c.callTool({
      name: 'headless_remote_browser_type',
      arguments: { selector: 'input', text: 'hi' },
    });
    expect(invoke).toHaveBeenCalledWith('typeText', [
      'term-INT',
      'input',
      'hi',
      undefined,
      'headless-remote',
    ]);

    await c.callTool({ name: 'inner_browser_wait_for', arguments: { selector: '.done' } });
    expect(invoke).toHaveBeenCalledWith('waitForSelector', [
      'term-INT',
      '.done',
      5000,
      undefined,
      'inner',
    ]);
  });

  it('tools/call 路由到 invoke,首参=URL 绑的 terminalTabId', async () => {
    const invoke = vi.fn(async (method: string) =>
      method === 'listTabs' ? [{ id: 'a', url: 'https://a.dev', active: true, net: 'local' }] : 'ok',
    );
    const c = await connect(invoke as never, 'term-XYZ');

    const res = await c.callTool({ name: 'inner_browser_list_tabs', arguments: {} });
    expect(invoke).toHaveBeenCalledWith('listTabs', ['term-XYZ', 'inner']);
    const content = (res.content as { type: string; text: string }[])[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('a.dev');

    await c.callTool({ name: 'headless_remote_browser_navigate', arguments: { url: 'https://x.dev' } });
    expect(invoke).toHaveBeenCalledWith('navigate', [
      'term-XYZ',
      'https://x.dev',
      undefined,
      'headless-remote',
    ]);
  });

  it('screenshot → image content(base64,去 data 前缀)', async () => {
    const c = await connect(async () => 'data:image/png;base64,ABCDEF');
    const res = await c.callTool({ name: 'inner_browser_screenshot', arguments: {} });
    const content = (res.content as { type: string; data: string; mimeType: string }[])[0];
    expect(content.type).toBe('image');
    expect(content.data).toBe('ABCDEF');
    expect(content.mimeType).toBe('image/png');
  });

  it('同 tab 重连逐旧会话(P2:会话表封顶≈标签数,不无界增长)', async () => {
    handle = await startBrowserMcpServer(async () => 'ok');
    const url = handle.urlFor('term1');

    const c1 = new Client({ name: 't1', version: '1.0.0' });
    await c1.connect(new StreamableHTTPClientTransport(new URL(url)));
    expect(handle.sessionCount()).toBe(1);

    // 同 tab 再连(agent 重启/重连但旧会话未发 DELETE)→ 逐旧,仍为 1
    const c2 = new Client({ name: 't2', version: '1.0.0' });
    await c2.connect(new StreamableHTTPClientTransport(new URL(url)));
    await new Promise((r) => setTimeout(r, 60)); // 等旧 transport.close 传播到 onclose 删表
    expect(handle.sessionCount()).toBe(1);

    // 换个 tab(term2)→ 独立会话,计数升到 2(不同 tab 不互逐)
    const c3 = new Client({ name: 't3', version: '1.0.0' });
    await c3.connect(new StreamableHTTPClientTransport(new URL(handle.urlFor('term2'))));
    expect(handle.sessionCount()).toBe(2);

    await c2.close();
    await c3.close();
  });

  it('invoke 抛错 → isError + 错误文本(不崩连接)', async () => {
    const c = await connect(async () => {
      throw new Error('browser view not ready');
    });
    const res = await c.callTool({ name: 'inner_browser_eval', arguments: { code: '1' } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toMatch(/not ready/);
  });

  it('stdio 桥从当前 env 的 OKWORK_BROWSER_MCP_URL 转发,不把 uuid 写进命令', async () => {
    handle = await startBrowserMcpServer(async () => 'ok');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-mcp-bridge-'));
    const script = path.join(dir, 'okwork-browser-mcp');
    fs.writeFileSync(script, OKWORK_BROWSER_MCP_BRIDGE_SOURCE, 'utf8');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [script],
      env: {
        ...(process.env as Record<string, string>),
        OKWORK_BROWSER_MCP_URL: handle.urlFor('term-stdio'),
      },
    });
    const c = new Client({ name: 'stdio-bridge', version: '1.0.0' });
    try {
      await c.connect(transport);
      const { tools } = await c.listTools();
      expect(tools.some((t) => t.name === 'inner_browser_navigate')).toBe(true);
      const call = await c.callTool({
        name: 'inner_browser_navigate',
        arguments: { url: 'https://example.test' },
      });
      expect(call.isError).toBeFalsy();
    } finally {
      await c.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
