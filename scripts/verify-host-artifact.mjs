#!/usr/bin/env node
// 验证 package-host.mjs 产出的 standalone host 产物「实机可运行」(阶段 F spike 判据 · AC-4):
//   ① 起真实进程 `node host.js --listen 127.0.0.1:0`,抓固定日志行拿到实际端口
//   ② 真实 WebSocket 客户端完成 token 闸 + host.info-first 握手
//   ③ pty.spawn 一个 /bin/sh 会话,写入 echo 命令,验证真实收到 PTY 输出(证明 node-pty
//     原生 .node + spawn-helper 在该产物里被成功加载并 spawn 成功)
//
// 用法:node scripts/verify-host-artifact.mjs --dir <产物目录> [--node <node 可执行路径>]
//
// 设计给 CI 复用:同一脚本在 macos-14 / ubuntu-latest 两个 job 里各跑一次。
// 本脚本自身用仓库的 `ws` 依赖做客户端(纯 JS,无原生部分,跨平台一致);
// 与被验证产物完全解耦 —— 产物只需自带 node-pty 原生二进制。

import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

function parseArgs(argv) {
  const opts = { dir: null, node: 'node', timeoutMs: 20_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--node') opts.node = argv[++i];
    else if (a === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!opts.dir) throw new Error('--dir <package dir> is required');
  return opts;
}

function fail(reason) {
  console.error(`[verify] VERIFY_FAILED: ${reason}`);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = path.resolve(opts.dir);
  const token = crypto.randomBytes(16).toString('base64url');

  console.log(`[verify] spawning: ${opts.node} host.js --listen 127.0.0.1:0 (cwd=${dir})`);
  const child = spawn(opts.node, ['host.js', '--listen', '127.0.0.1:0'], {
    cwd: dir,
    env: { ...process.env, TERMPRO_HOST_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString('utf8');
  });
  child.stderr.on('data', (d) => {
    stderrBuf += d.toString('utf8');
  });

  const overallTimer = setTimeout(() => {
    console.error('[verify] stdout so far:\n' + stdoutBuf);
    console.error('[verify] stderr so far:\n' + stderrBuf);
    child.kill('SIGKILL');
    fail(`timed out after ${opts.timeoutMs}ms`);
  }, opts.timeoutMs);
  overallTimer.unref?.();

  let exitedEarly = false;
  child.on('exit', (code, signal) => {
    if (!exitedEarly) {
      // 正常路径下我们会在校验成功后主动 kill;这里捕获的是「host 自己异常退出」
      exitedEarly = true;
      console.error('[verify] stdout so far:\n' + stdoutBuf);
      console.error('[verify] stderr so far:\n' + stderrBuf);
      clearTimeout(overallTimer);
      fail(`host process exited early (code=${code}, signal=${signal})`);
    }
  });

  const port = await new Promise((resolve) => {
    const iv = setInterval(() => {
      const m = /\[host\] listening ws:\/\/([^:]+):(\d+) protocol=v(\d+)/.exec(stdoutBuf);
      if (m) {
        clearInterval(iv);
        console.log(`[verify] listening line found: ${m[0]}`);
        resolve(Number(m[2]));
      }
    }, 100);
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}`);

  let sessionId = null;
  let ptyOk = false;
  let hostInfoOk = false;

  await new Promise((resolve, reject) => {
    ws.on('error', (err) => reject(err));

    ws.on('open', () => {
      console.log('[verify] ws open, sending host.info (must be first message)');
      ws.send(JSON.stringify({ t: 'rpc:req', id: 1, method: 'host.info' }));
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        reject(new Error(`non-JSON message from host: ${raw}`));
        return;
      }

      if (msg.t === 'rpc:res' && msg.id === 1) {
        if (!msg.ok) return reject(new Error(`host.info failed: ${msg.error}`));
        hostInfoOk = true;
        console.log('[verify] host.info ok:', JSON.stringify(msg.result));
        ws.send(
          JSON.stringify({
            t: 'rpc:req',
            id: 2,
            method: 'pty.spawn',
            params: { cwd: os.tmpdir(), shell: '/bin/sh', cols: 80, rows: 24 },
          }),
        );
        return;
      }

      if (msg.t === 'rpc:res' && msg.id === 2) {
        if (!msg.ok) return reject(new Error(`pty.spawn failed: ${msg.error}`));
        sessionId = msg.result.sessionId;
        console.log(`[verify] pty.spawn ok: sessionId=${sessionId}`);
        ws.send(
          JSON.stringify({
            t: 'pty:input',
            sessionId,
            data: 'echo TERMPRO_SPIKE_OK\n',
          }),
        );
        return;
      }

      if (msg.t === 'pty:data' && msg.sessionId === sessionId) {
        if (msg.data.includes('TERMPRO_SPIKE_OK')) {
          ptyOk = true;
          console.log('[verify] pty output received: TERMPRO_SPIKE_OK matched');
          ws.send(JSON.stringify({ t: 'rpc:req', id: 3, method: 'pty.kill', params: { sessionId } }));
        }
        return;
      }

      if (msg.t === 'rpc:res' && msg.id === 3) {
        ws.close();
        resolve();
      }
    });

    ws.on('close', () => {
      if (!ptyOk) reject(new Error('ws closed before pty output was observed'));
    });
  });

  clearTimeout(overallTimer);
  exitedEarly = true; // 后续的正常 kill 不应被当成「异常退出」上报
  child.kill('SIGTERM');

  if (!hostInfoOk || !ptyOk || !sessionId) {
    fail('handshake or pty verification incomplete');
  }

  console.log(`[verify] VERIFY_OK dir=${dir} sessionEcho=true`);
}

main().catch((err) => {
  console.error('[verify] error:', err);
  process.exit(1);
});
