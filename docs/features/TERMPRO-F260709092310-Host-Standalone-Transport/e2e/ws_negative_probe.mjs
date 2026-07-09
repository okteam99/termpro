// api-e2e 负向探针:对「真实打包产物」host 验证 token 闸与 host.info-first 门控的拒绝路径。
// 用法: node ws_negative_probe.mjs --dir <artifact-dir>
// 退出码 0 + 末行 PROBE_OK = 全部负向断言通过。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws'); // 复用 worktree node_modules 的 ws

const dirIdx = process.argv.indexOf('--dir');
if (dirIdx === -1) throw new Error('--dir <artifact dir> required');
const dir = path.resolve(process.argv[dirIdx + 1]);

const TOKEN = crypto.randomBytes(16).toString('base64url');

function fail(msg) {
  console.error(`PROBE_FAILED: ${msg}`);
  process.exit(1);
}

// 起真实产物 host
const host = spawn('node', ['host.js', '--listen', '127.0.0.1:0'], {
  cwd: dir,
  env: { ...process.env, TERMPRO_HOST_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const port = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('listening line timeout')), 15000);
  let buf = '';
  host.stdout.on('data', (d) => {
    buf += String(d);
    const m = buf.match(/listening ws:\/\/127\.0\.0\.1:(\d+)/);
    if (m) {
      clearTimeout(t);
      resolve(Number(m[1]));
    }
  });
}).catch((e) => {
  host.kill();
  fail(e.message);
});

/** 建连并收集结果:{closed, messages} */
function probe(url, firstMessage) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const messages = [];
    const done = (closed) => resolve({ closed, messages });
    const timer = setTimeout(() => {
      ws.terminate();
      done(false); // 5s 内未被断开 = 门没关
    }, 5000);
    ws.on('open', () => {
      if (firstMessage) ws.send(JSON.stringify(firstMessage));
    });
    ws.on('message', (d) => messages.push(String(d)));
    ws.on('close', () => {
      clearTimeout(timer);
      done(true);
    });
    ws.on('error', () => {
      clearTimeout(timer);
      done(true); // 握手被拒(HTTP 层)也算关闸
    });
  });
}

// ① 错误 token → 断开且零消息
{
  const r = await probe(`ws://127.0.0.1:${port}/?token=WRONG${TOKEN}`);
  if (!r.closed || r.messages.length > 0)
    fail(`wrong token not rejected: closed=${r.closed} msgs=${r.messages.length}`);
  console.log('✓ NEG-1 错误 token 被拒(断开且零消息)');
}

// ② 空 token(?token=)→ 断开且零消息(F3 回归)
{
  const r = await probe(`ws://127.0.0.1:${port}/?token=`);
  if (!r.closed || r.messages.length > 0)
    fail(`empty token not rejected: closed=${r.closed} msgs=${r.messages.length}`);
  console.log('✓ NEG-2 空 token 被拒(F3 fail-closed 回归)');
}

// ③ 正确 token 但首条消息不是 host.info → 断开且无响应(门控)
{
  const r = await probe(`ws://127.0.0.1:${port}/?token=${TOKEN}`, {
    t: 'rpc:req',
    id: 1,
    method: 'pty.spawn',
    params: { cwd: dir, cols: 80, rows: 24 },
  });
  if (!r.closed || r.messages.length > 0)
    fail(`gate violation not rejected: closed=${r.closed} msgs=${r.messages.length}`);
  console.log('✓ NEG-3 首条非 host.info 被断开(门控)');
}

// ④ 正确 token + host.info-first → 正常应答(阳性对照,证明上面三条不是"闸全关")
{
  const r = await probe(`ws://127.0.0.1:${port}/?token=${TOKEN}`, {
    t: 'rpc:req',
    id: 1,
    method: 'host.info',
    params: undefined,
  });
  const ok = r.messages.some((m) => {
    try {
      const j = JSON.parse(m);
      return j.t === 'rpc:res' && j.id === 1 && j.ok === true;
    } catch {
      return false;
    }
  });
  if (!ok) fail(`positive control failed: msgs=${r.messages.slice(0, 2)}`);
  console.log('✓ NEG-4 阳性对照:正确 token + host.info 正常应答');
}

host.kill();
console.log('PROBE_OK');
