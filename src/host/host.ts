// TermPro Host 进程 — 纯 Node,零 Electron import(README §5 远程就绪)。
// 本地模式:跑在 utilityProcess 里,经 parentPort 收取每个客户端的 MessagePort。
// 远程模式(M5):同一份代码改为监听 WebSocket,协议不变。

import os from 'node:os';
import {
  ClientMessage,
  HostMessage,
  PROTOCOL_VERSION,
  RpcMethods,
  SpawnOptions,
} from '../shared/protocol';
import { PtyPool } from './ptyPool';
import { homeDir, listDir, readTextFile, writeTextFile } from './fsService';
import {
  gitChangedFiles,
  gitInfo,
  gitShow,
  gitStatus,
  gitWorktrees,
} from './gitService';
import { WatchService } from './watchService';
import { processCwd } from './proc';

// utilityProcess 子进程里 Electron 注入的 parentPort(运行时存在,不引类型)
interface PortLike {
  postMessage(message: unknown): void;
  on(
    event: 'message',
    listener: (e: { data: unknown; ports: PortLike[] }) => void,
  ): void;
  start?(): void;
  close?(): void;
}

const parentPort = (process as unknown as { parentPort?: PortLike })
  .parentPort;

if (!parentPort) {
  console.error(
    '[host] no parentPort — standalone (remote) mode not implemented yet',
  );
  process.exit(1);
}

interface Client {
  port: PortLike;
  pool: PtyPool;
  watches: WatchService;
}

// M1 策略:单客户端。新客户端(窗口重载)接入时,旧客户端的会话全部回收,
// 避免泄漏。M3 做「UI 断开会话保活」时改为会话与客户端解耦。
let active: Client | null = null;

parentPort.on('message', (e) => {
  const data = e.data as { t?: string } | undefined;
  if (data?.t === 'client' && e.ports[0]) {
    attachClient(e.ports[0]);
  }
});

console.log('[host] ready, pid=%d, protocol=v%d', process.pid, PROTOCOL_VERSION);

// 冒烟自测:dev 下 host cwd 即项目仓库,验证 git 链路
if (process.env.TERMPRO_SMOKE) {
  void gitInfo(process.cwd()).then(
    (info) => console.log('[host] git smoke:', JSON.stringify(info)),
    (err) => console.error('[host] git smoke failed:', err),
  );
}

function attachClient(port: PortLike): void {
  if (active) {
    active.pool.dispose();
    active.watches.dispose();
    active.port.close?.();
  }
  const send = (msg: HostMessage) => port.postMessage(msg);
  const pool = new PtyPool(send);
  const watches = new WatchService(send);
  active = { port, pool, watches };

  port.on('message', (e) => {
    const msg = e.data as ClientMessage;
    switch (msg.t) {
      case 'rpc:req':
        void handleRpc(msg, send, pool, watches);
        break;
      case 'pty:input':
        pool.input(msg.sessionId, msg.data);
        break;
      case 'pty:resize':
        pool.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      case 'pty:ack':
        pool.ack(msg.sessionId, msg.bytes);
        break;
    }
  });
  port.start?.();
}

async function handleRpc(
  msg: Extract<ClientMessage, { t: 'rpc:req' }>,
  send: (m: HostMessage) => void,
  pool: PtyPool,
  watches: WatchService,
): Promise<void> {
  try {
    let result: unknown;
    switch (msg.method) {
      case 'host.info': {
        const info: RpcMethods['host.info']['result'] = {
          hostId: 'local',
          protocolVersion: PROTOCOL_VERSION,
          platform: os.platform(),
          homedir: os.homedir(),
          shell: process.env.SHELL ?? '/bin/zsh',
        };
        result = info;
        break;
      }
      case 'pty.spawn':
        result = { sessionId: pool.spawn(msg.params as SpawnOptions) };
        break;
      case 'pty.kill':
        pool.kill((msg.params as { sessionId: string }).sessionId);
        break;
      case 'pty.cwd': {
        const pid = pool.pid((msg.params as { sessionId: string }).sessionId);
        result = { cwd: pid === null ? null : await processCwd(pid) };
        break;
      }
      case 'fs.readdir':
        result = await listDir((msg.params as { path: string }).path);
        break;
      case 'fs.home':
        result = homeDir();
        break;
      case 'fs.watch':
        result = {
          watchId: watches.watch((msg.params as { path: string }).path),
        };
        break;
      case 'fs.unwatch':
        watches.unwatch((msg.params as { watchId: number }).watchId);
        break;
      case 'git.info':
        result = await gitInfo((msg.params as { cwd: string }).cwd);
        break;
      case 'git.status':
        result = await gitStatus(
          (msg.params as { toplevel: string }).toplevel,
        );
        break;
      case 'git.worktrees':
        result = await gitWorktrees((msg.params as { cwd: string }).cwd);
        break;
      case 'fs.readFile':
        result = await readTextFile((msg.params as { path: string }).path);
        break;
      case 'fs.writeFile': {
        const p = msg.params as { path: string; content: string };
        await writeTextFile(p.path, p.content);
        break;
      }
      case 'git.show': {
        const p = msg.params as { toplevel: string; ref: string; path: string };
        result = await gitShow(p.toplevel, p.ref, p.path);
        break;
      }
      case 'git.changedFiles': {
        const p = msg.params as { toplevel: string; baseRef?: string };
        result = await gitChangedFiles(p.toplevel, p.baseRef);
        break;
      }
      default:
        throw new Error(`unknown rpc method: ${String(msg.method)}`);
    }
    send({ t: 'rpc:res', id: msg.id, ok: true, result });
  } catch (err) {
    // 失败必须可观测:CLI 启动应用即可在 stderr 看到完整错误
    console.error('[host] rpc %s failed:', msg.method, err);
    send({
      t: 'rpc:res',
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
