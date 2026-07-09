// TermPro Host 核心:传输无关的多客户端路由 + RPC 分发 + 会话/watcher 归属回收。
// 纯 Node,零 Electron import(README §5 远程就绪)。两条传输(嵌入式 MessagePort /
// standalone WebSocket)都把自己包装成 PortLike 后调 attachClient 复用本模块全部逻辑。

import os from 'node:os';
import {
  ClientMessage,
  HostMessage,
  PROTOCOL_MIN_COMPATIBLE,
  PROTOCOL_VERSION,
  RpcMethods,
  SpawnOptions,
} from '../shared/protocol';
import { PtyPool } from './ptyPool';
import {
  copyInto,
  homeDir,
  listDir,
  moveInto,
  readBinaryFile,
  readTextFile,
  realPath,
  statPath,
  writeTextFile,
} from './fsService';
import {
  gitChangedFiles,
  gitInfo,
  gitShow,
  gitStatus,
  gitWorktrees,
} from './gitService';
import { WatchService } from './watchService';
import { processCwd } from './proc';

// 传输层契约:MessagePort(嵌入式)与 wsPortAdapter(standalone)均实现之。
// ports 数组在 WS 下恒空(无 MessagePort 转移)。
export interface PortLike {
  postMessage(message: unknown): void;
  on(
    event: 'message',
    listener: (e: { data: unknown; ports: PortLike[] }) => void,
  ): void;
  on(event: 'close', listener: () => void): void;
  start?(): void;
  close?(): void;
}

export interface Client {
  id: number;
  port: PortLike;
  watches: WatchService;
  /** 该客户端 spawn 的会话(端口关闭时回收) */
  sessions: Set<string>;
}

export interface HostCore {
  /** 把一条传输接入 host:注册多客户端路由 + 归属回收(嵌入式/WS 共用)。 */
  attachClient(port: PortLike): void;
  pool: PtyPool;
  clients: Map<number, Client>;
}

/**
 * 创建一个 host 核心实例(共享一个 PTY 池 + 客户端表)。
 * 单进程只跑一种传输模式,但工厂化便于测试隔离。
 */
export function createHostCore(): HostCore {
  const pool = new PtyPool();
  const clients = new Map<number, Client>();
  let clientSeq = 0;

  function attachClient(port: PortLike): void {
    const id = ++clientSeq;
    const send = (msg: HostMessage) => port.postMessage(msg);
    const client: Client = {
      id,
      port,
      watches: new WatchService(send),
      sessions: new Set(),
    };
    clients.set(id, client);

    port.on('message', (e) => {
      const msg = e.data as ClientMessage;
      switch (msg.t) {
        case 'rpc:req':
          void handleRpc(msg, send, client, pool);
          break;
        // PTY 控制消息只接受会话归属方(sessionId 不当 capability 用;
        // 多连接下的防御纵深)
        case 'pty:input':
          if (client.sessions.has(msg.sessionId)) {
            pool.input(msg.sessionId, msg.data);
          }
          break;
        case 'pty:resize':
          if (client.sessions.has(msg.sessionId)) {
            pool.resize(msg.sessionId, msg.cols, msg.rows);
          }
          break;
        case 'pty:ack':
          if (client.sessions.has(msg.sessionId)) {
            pool.ack(msg.sessionId, msg.bytes);
          }
          break;
      }
    });

    // 窗口关闭/重载/WS 断开 → 端口关闭 → 只回收该客户端的会话与 watcher
    port.on('close', () => {
      for (const sid of client.sessions) pool.kill(sid);
      client.watches.dispose();
      clients.delete(id);
      console.log(
        '[host] client %d detached (sessions cleaned: %d, clients left: %d)',
        id,
        client.sessions.size,
        clients.size,
      );
    });

    port.start?.();
    console.log('[host] client %d attached (total %d)', id, clients.size);
  }

  return { attachClient, pool, clients };
}

async function handleRpc(
  msg: Extract<ClientMessage, { t: 'rpc:req' }>,
  send: (m: HostMessage) => void,
  client: Client,
  pool: PtyPool,
): Promise<void> {
  try {
    let result: unknown;
    switch (msg.method) {
      case 'host.info': {
        const info: RpcMethods['host.info']['result'] = {
          hostId: 'local',
          protocolVersion: PROTOCOL_VERSION,
          minCompatible: PROTOCOL_MIN_COMPATIBLE,
          platform: os.platform(),
          homedir: os.homedir(),
          shell: process.env.SHELL ?? '/bin/zsh',
        };
        result = info;
        break;
      }
      case 'pty.spawn': {
        const sessionId = pool.spawn(msg.params as SpawnOptions, send, (sid) =>
          client.sessions.delete(sid),
        );
        client.sessions.add(sessionId);
        result = { sessionId };
        break;
      }
      case 'pty.kill': {
        const sid = (msg.params as { sessionId: string }).sessionId;
        // 归属守卫(QA-R3-1):非归属会话静默忽略,零信息 —— 防多连接下 A 杀 B 的会话
        if (!client.sessions.has(sid)) break;
        pool.kill(sid);
        client.sessions.delete(sid);
        break;
      }
      case 'pty.cwd': {
        const sid = (msg.params as { sessionId: string }).sessionId;
        // 同源归属守卫(本 RD 追加):非归属会话返回 null,不泄露 B 的 cwd
        if (!client.sessions.has(sid)) {
          result = { cwd: null };
          break;
        }
        const pid = pool.pid(sid);
        result = { cwd: pid === null ? null : await processCwd(pid) };
        break;
      }
      case 'fs.readdir':
        result = await listDir((msg.params as { path: string }).path);
        break;
      case 'fs.home':
        result = homeDir();
        break;
      case 'fs.stat':
        result = await statPath((msg.params as { path: string }).path);
        break;
      case 'fs.realpath':
        result = await realPath((msg.params as { path: string }).path);
        break;
      case 'fs.watch':
        result = {
          watchId: client.watches.watch((msg.params as { path: string }).path),
        };
        break;
      case 'fs.unwatch':
        client.watches.unwatch((msg.params as { watchId: number }).watchId);
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
      case 'fs.readFileBinary':
        result = await readBinaryFile((msg.params as { path: string }).path);
        break;
      case 'fs.writeFile': {
        const p = msg.params as { path: string; content: string };
        await writeTextFile(p.path, p.content);
        break;
      }
      case 'fs.move': {
        const p = msg.params as { src: string; destDir: string };
        result = await moveInto(p.src, p.destDir);
        break;
      }
      case 'fs.copy': {
        const p = msg.params as { src: string; destDir: string };
        result = await copyInto(p.src, p.destDir);
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
