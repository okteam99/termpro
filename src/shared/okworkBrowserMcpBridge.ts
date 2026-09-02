// OkWork 浏览器 MCP 的 stdio 桥(方案 A):Claude/Codex 配置里只存命令名,
// 每次启动从当前进程环境读 OKWORK_BROWSER_MCP_URL(含本终端 tab),转发到
// 本机/容器回环上的 streamable-HTTP MCP。不写共享文件、配置里不冻 uuid。
//
// 零依赖(只用 Node 20 fetch + stdio NDJSON),skill.install 把它写成
// ~/.agents/skills/okwork/okwork-browser-mcp 并 chmod +x。

export const OKWORK_BROWSER_MCP_BRIDGE_NAME = 'okwork-browser-mcp';

/** 可执行脚本全文(含 shebang)。skill.install / 测试共用这一份。 */
export const OKWORK_BROWSER_MCP_BRIDGE_SOURCE = `#!/usr/bin/env node
'use strict';

const url = process.env.OKWORK_BROWSER_MCP_URL || '';
if (!url) {
  process.stderr.write(
    'okwork-browser-mcp: OKWORK_BROWSER_MCP_URL is not set. Run this inside an OkWork terminal.\\n',
  );
  process.exit(1);
}

let sessionId = null;

async function rpc(message) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const raw = await res.text();
  if (!res.ok) {
    throw new Error('MCP HTTP ' + res.status + (raw ? ': ' + raw.slice(0, 300) : ''));
  }
  if (!raw) return undefined;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const datas = [];
    for (const line of raw.split(/\\r?\\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        datas.push(JSON.parse(payload));
      } catch {
        /* ignore malformed SSE data */
      }
    }
    if (message && message.id !== undefined) {
      const match = datas.find((d) => d && d.id === message.id);
      if (match) return match;
    }
    return datas.length ? datas[datas.length - 1] : undefined;
  }
  return JSON.parse(raw);
}

const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  rpc(msg)
    .then((result) => {
      if (result !== undefined) process.stdout.write(JSON.stringify(result) + '\\n');
    })
    .catch((err) => {
      if (msg.id === undefined) return;
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        }) + '\\n',
      );
    });
});
`;
