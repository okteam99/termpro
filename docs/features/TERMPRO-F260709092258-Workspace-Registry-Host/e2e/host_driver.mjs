// api-e2e 驱动:在独立 node 进程里加载「真实构建产物」.vite/build/host.js,
// 伪造 Electron utilityProcess 注入的 process.parentPort(host 对传输的唯一假设),
// 把 客户端 MessagePort ↔ stdio JSON-lines 桥接给 Python 编排方。
// 真跨进程:Python(编排/断言)⇄ 本进程(真实 host 代码 + 真实磁盘注册表)。
//
// 协议(行分隔 JSON · 防 host 自身 console 输出污染,协议行带 @@E2E@@ 前缀):
//   Python → driver: {"op":"attach","client":N} | {"op":"send","client":N,"msg":{...}} | {"op":"exit"}
//   driver → Python: {"ev":"ready"} | {"ev":"attached","client":N} | {"ev":"msg","client":N,"msg":{...}}

import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = '@@E2E@@';
const out = (obj) => process.stdout.write(MARK + JSON.stringify(obj) + '\n');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// e2e/ 在 docs/features/<F>/e2e/ 下,worktree 根 = ../../../..
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const hostBundle = path.join(repoRoot, '.vite', 'build', 'host.js');

// ---- 伪造 parentPort(host.ts 的 PortLike 契约:postMessage/on/start/close)----
const parentHandlers = new Map();
process.parentPort = {
  postMessage() {},
  on(ev, fn) {
    parentHandlers.set(ev, fn);
  },
  start() {},
  close() {},
};

// ---- 客户端端口工厂(host 侧视角的 PortLike)----
const clients = new Map(); // clientId -> { emit(msg) }
function makeClientPort(clientId) {
  const handlers = new Map();
  return {
    // host → client:转发给 Python
    postMessage(msg) {
      out({ ev: 'msg', client: clientId, msg });
    },
    on(ev, fn) {
      handlers.set(ev, fn);
    },
    start() {},
    close() {
      handlers.get('close')?.();
    },
    // Python → host:投递进 host 注册的 message 监听
    _emit(msg) {
      handlers.get('message')?.({ data: msg, ports: [] });
    },
  };
}

// ---- 加载真实 host bundle(模块顶层即注册 parentPort.on('message'))----
await import(hostBundle);

// ---- stdio 桥 ----
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  if (cmd.op === 'attach') {
    const port = makeClientPort(cmd.client);
    clients.set(cmd.client, port);
    // 模拟 main.ts:向 host 发 {t:'client'} + ports[0]
    parentHandlers.get('message')?.({ data: { t: 'client' }, ports: [port] });
    out({ ev: 'attached', client: cmd.client });
  } else if (cmd.op === 'send') {
    clients.get(cmd.client)?._emit(cmd.msg);
  } else if (cmd.op === 'exit') {
    process.exit(0);
  }
});

out({ ev: 'ready' });
