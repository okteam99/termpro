// OkWork Host 核心:传输无关的多客户端路由 + RPC 分发 + 会话/watcher 归属回收。
// 纯 Node,零 Electron import(README §5 远程就绪)。两条传输(嵌入式 MessagePort /
// standalone WebSocket)都把自己包装成 PortLike 后调 attachClient 复用本模块全部逻辑。

import os from 'node:os';
import path from 'node:path';
import {
  BrowserInputEvent,
  ClientMessage,
  HostMessage,
  PROTOCOL_MIN_COMPATIBLE,
  PROTOCOL_VERSION,
  RpcMethods,
  SpawnOptions,
} from '../shared/protocol';
import { WorkspaceService } from './workspaceService';
import { PtyPool } from './ptyPool';
import {
  copyInto,
  createUploadRegistry,
  homeDir,
  listDir,
  makeDir,
  moveInto,
  readBinaryFile,
  readFileRange,
  readTextFile,
  realPath,
  statPath,
  UploadRegistry,
  writeTextFile,
  writeTempPng,
} from './fsService';
import { skillStatus, skillInstall } from './skillService';
import { createPreviewRegistry, PreviewRegistry } from './previewServer';
import { BrowserService, browserDataDir } from './browserService';
import { FrameChannelRegistry } from './frameChannel';
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
  /** 该客户端订阅的会话集(spawn 自动订阅 / session.attach 订阅 / unsubscribe·exclusive
   *  抢占摘除;端口关闭时按此集合逐一回收 · M2 订阅语义)。 */
  sessions: Set<string>;
  /** 该客户端在途的远程文件上传登记表(fs.uploadBegin/Chunk/End);端口关闭时 disposeAll。 */
  uploads: UploadRegistry;
  /** 该客户端开着预览的云端浏览器标签;端口关闭时逐一停流(人走画面停)。 */
  previewTabs: Set<string>;
}

export interface HostCore {
  /** 把一条传输接入 host:注册多客户端路由 + 归属回收(嵌入式/WS 共用)。 */
  attachClient(port: PortLike): void;
  pool: PtyPool;
  clients: Map<number, Client>;
  /** 项目内 HTML 预览 server 注册表(host/previewServer.ts)。多客户端语义:同 root
   *  共用同一预览 server 实例(ensure 幂等);客户端断开不回收(不做引用计数);
   *  preview.stop 是全局操作,不分发起方。 */
  previews: PreviewRegistry;
  /** 云端浏览器(headless Chromium · host/browserService.ts)。全 host 单实例:
   *  多客户端/多 agent 共用同一个浏览器与同一批标签(同 previews 的共用语义)。 */
  browser: BrowserService;
  /** 预览帧的独立二进制通道注册表(wsServer 的 /frames 路径接进来)。 */
  frames: FrameChannelRegistry;
}

/**
 * 创建一个 host 核心实例(共享一个 PTY 池 + 客户端表)。
 * 单进程只跑一种传输模式,但工厂化便于测试隔离。
 *
 * @param mode host 形态(D-1 · BL-005):
 *   - 'embedded'(默认):本机嵌入式 · 端口 close 即 kill 会话 · 不分配 ring · onExit 立即
 *     delete · host.info 不带 capabilities(零回归)。
 *   - 'standalone':远程/loopback · 端口 close 转 detach(断开续跑)· 分配 ring · onExit 转
 *     exited 保留态 · host.info 带 capabilities=['session.resume'] · 支持 session.list/attach。
 */
export function createHostCore(
  mode: 'embedded' | 'standalone' = 'embedded',
): HostCore {
  const pool = new PtyPool(mode);
  const clients = new Map<number, Client>();
  let clientSeq = 0;
  const previews = createPreviewRegistry();

  // Workspace 注册表:数据目录经壳层(main)注入 env,不调 app.getPath(零 Electron)。
  // 未注入时兜底到 homedir 下的隐藏目录(dev/edge;正常 local 由 main 注入 userData)。
  // 品牌改名(TermPro → OkWork)刻意保留 `.termpro-host` 旧目录名:远端存量
  // host 的身份 token/会话 ring/已部署 bundle 都在这里,改名即全部失联。勿改。
  const hostDataDir =
    process.env.OKWORK_HOST_DATA_DIR || path.join(os.homedir(), '.termpro-host');
  const workspaces = new WorkspaceService(hostDataDir);
  // 云端浏览器:懒启动(status 探测不拉起进程),空闲自动回收,host 退出必 kill。
  const browser = new BrowserService({ dataDir: browserDataDir(hostDataDir) });
  const frames = new FrameChannelRegistry();
  // 启动即预读注册表进内存(RPC 到达前完成;handle 内亦 await load 幂等兜底)
  void workspaces.load().catch((err) =>
    console.error('[host] registry initial load failed:', err),
  );

  function attachClient(port: PortLike): void {
    const id = ++clientSeq;
    const send = (msg: HostMessage) => port.postMessage(msg);
    const client: Client = {
      id,
      port,
      watches: new WatchService(send),
      sessions: new Set(),
      uploads: createUploadRegistry(),
      previewTabs: new Set(),
    };
    clients.set(id, client);
    // 注册到 workspace 服务:注册表变更广播会推给该客户端
    workspaces.addClient(id, send);

    port.on('message', (e) => {
      const msg = e.data as ClientMessage;
      switch (msg.t) {
        case 'rpc:req':
          void handleRpc(
            msg, send, client, pool, workspaces, clients, mode, previews, browser, frames,
          );
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
            pool.resize(msg.sessionId, msg.cols, msg.rows, client.id);
          }
          break;
        // 预览帧确认:只认自己开着的标签(别的客户端的帧不该被这边推进)
        case 'browser:frameAck':
          if (client.previewTabs.has(msg.tabId)) {
            browser.ackFrame(msg.tabId, msg.seq);
          }
          break;
        case 'pty:ack':
          if (client.sessions.has(msg.sessionId)) {
            // 🔴 ack 只推进【自己】的 unacked(subscriberId=client.id · B6 安全关键):
            // 一个订阅者(误/恶)ack 无法替他人推进游标、无法伪造他人流控。
            pool.ack(msg.sessionId, msg.bytes, client.id);
          }
          break;
      }
    });

    // 窗口关闭/重载/WS 断开 → 端口关闭 → 只回收该客户端的会话与 watcher。
    // 🔴 形态分叉(D-1):embedded → kill 该 client 会话(本机语义,零回归);
    // standalone → detach(断开续跑:会话不 kill,旁路流控,输出入 ring 待重连回放 · AC-1)。
    port.on('close', () => {
      for (const sid of client.sessions) {
        // 🔴 只摘该 client 的订阅(M2):standalone 下其余订阅者(其他设备镜像中)不受影响,
        // 摘空才等价旧 detach 收尾(ptyPool.unsubscribe 内部处理 · B4)。
        if (mode === 'standalone') pool.unsubscribe(sid, id);
        else pool.kill(sid);
      }
      client.watches.dispose();
      void client.uploads.disposeAll();
      // 人走画面停:该客户端开的预览随连接一起撤(否则远端会对着一个没人收的
      // sink 继续截帧,白烧 CPU)。浏览器与标签本身不动——agent 可能还在用。
      for (const tabId of client.previewTabs) browser.stopPreview(tabId);
      workspaces.removeClient(id);
      clients.delete(id);
      console.log(
        '[host] client %d detached (sessions %s: %d, clients left: %d)',
        id,
        mode === 'standalone' ? 'unsubscribed' : 'killed',
        client.sessions.size,
        clients.size,
      );
    });

    port.start?.();
    console.log('[host] client %d attached (total %d)', id, clients.size);
  }

  return { attachClient, pool, clients, previews, browser, frames };
}

async function handleRpc(
  msg: Extract<ClientMessage, { t: 'rpc:req' }>,
  send: (m: HostMessage) => void,
  client: Client,
  pool: PtyPool,
  workspaces: WorkspaceService,
  clients: Map<number, Client>,
  mode: 'embedded' | 'standalone',
  previews: PreviewRegistry,
  browser: BrowserService,
  frames: FrameChannelRegistry,
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
          // 能力位(向后兼容追加):standalone 支持断线重连回放收养、多订阅镜像、
          // 远程临时 PNG 与远程文件传输(分块下载/上传)。embedded 省略 → renderer
          // 对旧/本地 host 按各功能安全降级。
          capabilities:
            mode === 'standalone'
              ? [
                  'session.resume',
                  'session.mirror',
                  'fs.temp-png',
                  'fs.transfer',
                  // 云端浏览器 RPC 存在性(不代表远端**装了** Chromium —— 装没装问
                  // browser.status。两层分开:能力位是协议面,可用性是运行时事实)。
                  'browser.headless',
                ]
              : undefined,
          // 应用版本:启动方(远程编排 buildStartCommand / 本机 main fork)经 env 注入,
          // 与部署的 bundle/<version>/ 同源。缺省(旧启动方/手工启动)→ 字段省略,
          // main 侧按过旧处理,连接时升级(用户规则 2026-07-13)。
          appVersion: process.env.OKWORK_HOST_APP_VERSION || undefined,
        };
        result = info;
        break;
      }
      case 'pty.spawn': {
        const sessionId = pool.spawn(
          msg.params as SpawnOptions,
          send,
          (sid) => client.sessions.delete(sid),
          client.id,
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
      case 'fs.writeTempFile': {
        const p = msg.params as { kind: string; base64: string };
        if (p.kind !== 'png') throw new Error('unsupported temporary file kind');
        result = await writeTempPng(p.base64);
        break;
      }
      case 'fs.move': {
        const p = msg.params as { src: string; destDir: string };
        result = await moveInto(p.src, p.destDir);
        break;
      }
      case 'fs.mkdir':
        await makeDir((msg.params as { path: string }).path);
        break;
      case 'fs.copy': {
        const p = msg.params as { src: string; destDir: string };
        result = await copyInto(p.src, p.destDir);
        break;
      }
      // ---- 远程文件传输:下载(分块读)/ 上传(分块写)----
      case 'fs.readFileRange': {
        const p = msg.params as { path: string; offset: number; length: number };
        result = await readFileRange(p.path, p.offset, p.length);
        break;
      }
      case 'fs.uploadBegin': {
        const p = msg.params as { destDir: string; name: string; size: number };
        result = await client.uploads.begin(p);
        break;
      }
      case 'fs.uploadChunk': {
        const p = msg.params as { transferId: string; offset: number; base64: string };
        result = await client.uploads.chunk(p.transferId, p.offset, p.base64);
        break;
      }
      case 'fs.uploadEnd': {
        const p = msg.params as { transferId: string; commit: boolean };
        result = await client.uploads.end(p.transferId, p.commit);
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
      case 'workspace.list':
      case 'workspace.create':
      case 'workspace.remove':
      case 'workspace.update':
        // 服务内部:mutate 注册表 → 落盘 → 向全部客户端广播 workspace:changed
        result = await workspaces.handle(msg.method, msg.params);
        break;
      case 'skill.status':
        result = skillStatus((msg.params as { name: string }).name);
        break;
      case 'skill.install': {
        const p = msg.params as { name: string; content: string };
        result = skillInstall(p.name, p.content);
        break;
      }
      // ---- 项目内 HTML 预览:同 root 跨客户端共用同一 server 实例(previews 单例
      // 挂在 HostCore 上,不下沉进 per-client 状态);preview.stop 全局停,不判归属。
      case 'preview.ensure':
        result = await previews.ensure((msg.params as { root: string }).root);
        break;
      case 'preview.stop': {
        const stopped = await previews.stop((msg.params as { root: string }).root);
        result = { stopped };
        break;
      }
      // ---- 云端浏览器(headless Chromium · 全 host 单实例,多 agent 共用同一批标签)----
      // 🔴 status 只探测不启动:UI 拿它决定要不要显示入口,不该因为看了一眼就在
      // 用户服务器上拉起一个浏览器进程。其余方法首次调用才懒启动。
      case 'browser.status':
        result = browser.status();
        break;
      case 'browser.listTabs':
        result = { tabs: await browser.listTabs() };
        break;
      case 'browser.openTab':
        result = {
          tabId: await browser.openTab((msg.params as { url?: string })?.url),
        };
        break;
      case 'browser.closeTab':
        await browser.closeTab((msg.params as { tabId: string }).tabId);
        break;
      case 'browser.activateTab':
        await browser.activateTab((msg.params as { tabId: string }).tabId);
        break;
      case 'browser.navigate': {
        const p = msg.params as { tabId?: string; url: string };
        result = { tabId: await browser.navigate(p.url, p.tabId) };
        break;
      }
      case 'browser.eval': {
        const p = msg.params as { tabId?: string; code: string };
        result = { value: await browser.evaluate(p.code, p.tabId) };
        break;
      }
      case 'browser.screenshot': {
        const p = msg.params as { tabId?: string };
        result = { base64: await browser.screenshot(p?.tabId) };
        break;
      }
      case 'browser.getHtml': {
        const p = msg.params as { tabId?: string };
        result = { html: await browser.getHtml(p?.tabId) };
        break;
      }
      case 'browser.getText': {
        const p = msg.params as { tabId?: string };
        result = { text: await browser.getText(p?.tabId) };
        break;
      }
      case 'browser.click': {
        const p = msg.params as { tabId?: string; selector: string };
        result = { ok: await browser.click(p.selector, p.tabId) };
        break;
      }
      case 'browser.type': {
        const p = msg.params as { tabId?: string; selector: string; text: string };
        result = { ok: await browser.typeText(p.selector, p.text, p.tabId) };
        break;
      }
      case 'browser.scroll': {
        const p = msg.params as { tabId?: string; dy?: number };
        result = { scrollY: await browser.scroll(p?.dy, p?.tabId) };
        break;
      }
      case 'browser.waitFor': {
        const p = msg.params as { tabId?: string; selector: string; timeoutMs?: number };
        result = { ok: await browser.waitFor(p.selector, p.timeoutMs ?? 5000, p.tabId) };
        break;
      }
      case 'browser.shutdown':
        await browser.shutdown();
        break;
      // ---- 本地预览:帧只推给**发起预览的那个客户端**(不广播:另一端没要画面,
      // 白占它的隧道)。该客户端断开时随 client.previewTabs 一并停流。
      case 'browser.startPreview': {
        const p = (msg.params ?? {}) as {
          tabId?: string;
          maxWidth?: number;
          maxHeight?: number;
          quality?: number;
          streamId?: string;
        };
        // 帧优先走独立二进制通道:主连接那条 WS 与 pty 输出同挤一个 SSH channel,
        // 画面插进去会把终端输入和心跳推到队尾。通道没接上(旧客户端/还没连)→
        // 退回主连接的 JSON 消息,功能不缺,只是贵一点。
        const channel = p.streamId ? frames.get(p.streamId) : undefined;
        const binary = channel !== undefined;
        const tabId = await browser.startPreview((frame) => {
          if (channel) {
            channel.send(
              { tabId: frame.tabId, seq: frame.seq, metadata: frame.metadata },
              Buffer.from(frame.data, 'base64'),
            );
          } else {
            send({ t: 'browser:frame', ...frame });
          }
        }, p);
        // 🔴 所有权转移(last-preview-wins,同 session.attach 的 exclusive 惯例):
        // browserService 每标签只留一个 sink,后开的顶掉先开的。若不把该 tabId 从
        // 其他客户端的 previewTabs 里摘掉,先开的那个断开时会去 stopPreview,
        // 把**后开者正在看的**流一起停掉。
        for (const other of clients.values()) {
          if (other !== client) other.previewTabs.delete(tabId);
        }
        client.previewTabs.add(tabId);
        // 帧通道自己就是「人还在不在」的信号:它断了就停这个标签的推流
        // (比等 ack 超时快,也比主连接断开更贴近「关掉了预览窗」)。
        channel?.onClose(() => browser.stopPreview(tabId));
        channel?.onAck((ackTabId, seq) => browser.ackFrame(ackTabId, seq));
        result = { tabId, binary };
        break;
      }
      case 'browser.stopPreview': {
        const p = (msg.params ?? {}) as { tabId?: string };
        if (p.tabId) client.previewTabs.delete(p.tabId);
        else client.previewTabs.clear();
        browser.stopPreview(p.tabId);
        break;
      }
      case 'browser.input': {
        const p = msg.params as { tabId?: string; event: BrowserInputEvent };
        await browser.dispatchInput(p.event, p.tabId);
        break;
      }
      case 'browser.resize': {
        const p = msg.params as {
          tabId?: string;
          width: number;
          height: number;
          deviceScaleFactor?: number;
        };
        await browser.resizeViewport(p.width, p.height, p.deviceScaleFactor, p.tabId);
        break;
      }
      // ---- 断线重连回放收养(BL-005)----
      case 'session.list': {
        // token 闸后单租户全可见:遍历 pool 全部会话(live + exited)产快照(AC-8)
        result = { sessions: pool.list() };
        break;
      }
      case 'session.attach': {
        const p = msg.params as {
          sessionId: string;
          resumeOffset: number;
          cols: number;
          rows: number;
          mode?: 'mirror' | 'exclusive';
        };
        // 缺省 'exclusive':旧客户端不带 mode → 独占接续,零回归(M2 B3)。
        const attachMode = p.mode ?? 'exclusive';
        if (attachMode === 'exclusive') {
          // 🔴 last-attach-wins 所有权转移(CR-2/ARCH-B-5):同步原子三步 —— 无 await 插入。
          // ① 从旧 owner 的 client.sessions 摘除 sid(否则旧连接稍后 close 回收会误
          //    unsubscribe 已转移会话 · 把新 owner 输出转进 ring 不回屏 · 楔死 · ARCH-B-5②)。
          // 仅 exclusive 分支摘他人:mirror 保留他人订阅(不摘 client.sessions · B3)。
          for (const c of clients.values()) {
            if (c !== client) c.sessions.delete(p.sessionId);
          }
        }
        // ② reattach 换/加订阅者 + 回放切片(同步)。
        const res = pool.reattach(p.sessionId, send, {
          cols: p.cols,
          rows: p.rows,
          resumeOffset: p.resumeOffset,
          mode: attachMode,
          subscriberId: client.id,
        });
        if (res === null) {
          // found=false:该 sessionId 已不存在(被逐/从未有)→ renderer 退化 new spawn。
          // snapshot 必填但会被 renderer 的 found=false 分支忽略 → 占位空快照。
          result = {
            found: false,
            full: false,
            baseOffset: 0,
            data: '',
            nextOffset: 0,
            snapshot: {
              sessionId: p.sessionId,
              cwd: '',
              title: '',
              status: 'exited' as const,
              state: 'idle' as const,
              quiet: false,
              altscreen: false,
              exitCode: null,
            },
          } satisfies RpcMethods['session.attach']['result'];
        } else {
          // ③ 加入本 client(成为新 owner)。
          client.sessions.add(p.sessionId);
          result = res;
        }
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
