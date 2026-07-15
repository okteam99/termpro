// AI 浏览器 MCP server(阶段2b):用 SDK 自带 client 真连自建 server,端到端验证
// tools/list(9 工具)+ tools/call 路由到 invokeBrowserControl(首参恒为 URL 绑的
// terminalTabId)+ 结果编码(文本/图片/错误)。stateful streamable-HTTP 传输真实握手。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startBrowserMcpServer, type BrowserMcpHandle } from '../browserMcp';

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
  it('tools/list 暴露 13 个浏览器工具(读取 + 交互 + 标签)', async () => {
    const c = await connect(async () => 'ok');
    const { tools } = await c.listTools();
    expect(tools).toHaveLength(13);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'browser_navigate',
        'browser_eval',
        'browser_screenshot',
        'browser_get_html',
        'browser_get_text',
        'browser_click',
        'browser_type',
        'browser_scroll',
        'browser_wait_for',
        'browser_list_tabs',
        'browser_open_tab',
        'browser_close_tab',
        'browser_activate_tab',
      ]),
    );
  });

  it('交互工具 → invoke 位置参数(首=绑定 tab,browserTabId 缺省 undefined)', async () => {
    const invoke = vi.fn(async () => true);
    const c = await connect(invoke as never, 'term-INT');

    await c.callTool({ name: 'browser_click', arguments: { selector: '#go' } });
    expect(invoke).toHaveBeenCalledWith('click', ['term-INT', '#go', undefined]);

    await c.callTool({ name: 'browser_type', arguments: { selector: 'input', text: 'hi' } });
    expect(invoke).toHaveBeenCalledWith('typeText', ['term-INT', 'input', 'hi', undefined]);

    await c.callTool({ name: 'browser_wait_for', arguments: { selector: '.done' } });
    expect(invoke).toHaveBeenCalledWith('waitForSelector', ['term-INT', '.done', 5000, undefined]);
  });

  it('tools/call 路由到 invoke,首参=URL 绑的 terminalTabId', async () => {
    const invoke = vi.fn(async (method: string) =>
      method === 'listTabs' ? [{ id: 'a', url: 'https://a.dev', active: true, net: 'local' }] : 'ok',
    );
    const c = await connect(invoke as never, 'term-XYZ');

    const res = await c.callTool({ name: 'browser_list_tabs', arguments: {} });
    expect(invoke).toHaveBeenCalledWith('listTabs', ['term-XYZ']); // 绑定 tab
    const content = (res.content as { type: string; text: string }[])[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('a.dev');

    await c.callTool({ name: 'browser_navigate', arguments: { url: 'https://x.dev' } });
    expect(invoke).toHaveBeenCalledWith('navigate', ['term-XYZ', 'https://x.dev', undefined]);
  });

  it('screenshot → image content(base64,去 data 前缀)', async () => {
    const c = await connect(async () => 'data:image/png;base64,ABCDEF');
    const res = await c.callTool({ name: 'browser_screenshot', arguments: {} });
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
    const res = await c.callTool({ name: 'browser_eval', arguments: { code: '1' } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toMatch(/not ready/);
  });
});
