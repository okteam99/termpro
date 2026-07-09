// TermPro Host 进程入口 — 纯 Node,零 Electron import(README §5 远程就绪)。
// 入口分流:
//   argv 含 --listen 127.0.0.1:<port> → standalone WebSocket 模式(远程/loopback)
//   否则                              → 嵌入式模式(utilityProcess + parentPort,现状)
// 两种模式共用 hostCore(传输无关);新增 WS 逻辑全在 wsServer,嵌入式路径零侵入。

import * as fs from 'node:fs';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { createHostCore, PortLike } from './hostCore';
import { gitInfo } from './gitService';
import { resolveToken } from './token';
import { startWsServer } from './wsServer';

const core = createHostCore();

// dev/远程冒烟自测:host cwd 即项目仓库时验证 git 链路
function maybeGitSmoke(): void {
  if (process.env.TERMPRO_SMOKE) {
    void gitInfo(process.cwd()).then(
      (info) => console.log('[host] git smoke:', JSON.stringify(info)),
      (err) => console.error('[host] git smoke failed:', err),
    );
  }
}

/** 解析 --listen <host:port> → { host, port };host 段须为 loopback。 */
function parseListen(argv: string[]): { host: string; port: number } {
  const i = argv.indexOf('--listen');
  const spec = argv[i + 1] ?? '127.0.0.1:0';
  // 支持 IPv6(::1):按最后一个冒号切端口
  const lastColon = spec.lastIndexOf(':');
  const host = lastColon > 0 ? spec.slice(0, lastColon) : '127.0.0.1';
  const port = lastColon > 0 ? Number(spec.slice(lastColon + 1)) : Number(spec);
  return { host: host.replace(/^\[|\]$/g, ''), port: Number.isNaN(port) ? 0 : port };
}

/** 取 flag 后紧跟的一个 argv 值;缺失返回 undefined。 */
function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

if (process.argv.includes('--listen')) {
  // ---- standalone WebSocket 模式 ----
  const { host, port } = parseListen(process.argv);
  // configId 自证标签(远程编排注入):仅写入端口文件/日志供 main 侧 reap 双验识别
  // 同机兄弟 host(SSH-4·ARCH-B2),绝不参与下方 token 端口闸——闸仍只认 token。
  const hostTag = argValue(process.argv, '--host-tag');
  // token 解析(env 读后即抹,置于任何 pool.spawn 之前);禁 argv 明文
  let token: string;
  let source: string;
  try {
    const resolved = resolveToken(process.argv, process.env);
    token = resolved.token;
    source = resolved.source;
  } catch (err) {
    console.error('[host]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  startWsServer({
    host,
    port,
    token,
    attachClient: (p: PortLike) => core.attachClient(p),
  }).then(
    (handle) => {
      // 自动生成 token 时单行打印供调用方/ssh exec 捕获(显式传入则不回显)
      if (source === 'generated') {
        console.log('[host] token=%s', token);
      }
      // 固定 listening 日志行(CI 可 grep · AC-4)
      console.log(
        '[host] listening ws://%s:%d protocol=v%d',
        handle.address,
        handle.port,
        PROTOCOL_VERSION,
      );
      // 驻留端口交接文件(main sftp 回读用 · SSH-4)。O_CREAT|O_EXCL|O_WRONLY:
      // 陈旧文件视为 main 未先清理 = bug,fail-closed 拒绝覆盖而非静默复用
      // (无 TOCTOU 窗口 · AC-8)。
      const portFile = process.env.TERMPRO_HOST_PORT_FILE;
      if (portFile) {
        let fd: number;
        try {
          fd = fs.openSync(portFile, 'wx', 0o600);
        } catch {
          console.error('[host] stale port file, refusing:', portFile);
          process.exit(1);
          return;
        }
        fs.writeFileSync(
          fd,
          JSON.stringify({ port: handle.port, pid: process.pid, hostTag }),
        );
        fs.closeSync(fd);
        // 正常回收:main 断连/重启前发 SIGTERM → 清端口文件,不留陈旧供下次 EEXIST 误判。
        process.on('SIGTERM', () => {
          try {
            fs.unlinkSync(portFile);
          } catch {
            /* 已被清理或从未创建,忽略 */
          }
          process.exit(0);
        });
      }
      maybeGitSmoke();
    },
    (err) => {
      console.error(
        '[host] failed to start ws server:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    },
  );
} else {
  // ---- 嵌入式模式(现状,一字不改语义)----
  // utilityProcess 子进程里 Electron 注入的 parentPort(运行时存在,不引类型)
  const parentPort = (process as unknown as { parentPort?: PortLike })
    .parentPort;

  if (!parentPort) {
    console.error(
      '[host] no parentPort — start with --listen <127.0.0.1:port> for standalone mode',
    );
    process.exit(1);
  } else {
    parentPort.on('message', (e) => {
      const data = e.data as { t?: string } | undefined;
      if (data?.t === 'client' && e.ports[0]) {
        core.attachClient(e.ports[0]);
      }
    });

    console.log(
      '[host] ready, pid=%d, protocol=v%d',
      process.pid,
      PROTOCOL_VERSION,
    );

    maybeGitSmoke();
  }
}
