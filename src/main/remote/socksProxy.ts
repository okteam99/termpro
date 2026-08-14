// 内置浏览器"经远程机网络"用的最小 SOCKS5 代理(RFC 1928 子集,只认 CONNECT)。
// 纯 Node,零 Electron import(与 ssh.ts 同纪律)。每条浏览器 TCP 连接经 openOutbound()
// 换成一条 SSH direct-tcpip channel(见 ssh.ts SshConnectionLike.openOutbound)。
//
// 域名一律走远程 DNS:Chromium 的 socks5:// scheme 把域名原样交给代理(ATYP=domain,
// 0x03),本模块不在本地解析——真正的域名解析发生在远端 sshd,这正是「流量走远程
// 机网络」的核心语义(而非仅仅转发已解析好的 IP)。

import * as net from 'node:net';
import type { Duplex } from 'node:stream';

export type OpenOutbound = (dstHost: string, dstPort: number) => Promise<Duplex>;

/**
 * 握手阶段(greeting + request)缓冲上限:字节可能一字节一字节到,也可能多次
 * "还差一点"迟迟凑不齐一帧——真实 SOCKS5 握手帧顶多几百字节(域名 ATYP 最长
 * 1+255+2),远超此值即判定畸形/恶意客户端,直接 destroy 防止无限攒缓冲。
 * 一旦请求帧解析完成(state 推进到 connecting/piping),buf 里剩的是客户端管线化
 * 提前发送的真实负载,不再受此上限约束。
 */
const MAX_HANDSHAKE_BYTES = 512;

/** 握手期空闲超时:超时仍未进入 piping 态 → 判定客户端卡死,destroy。 */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * connecting 态(openOutbound 在途、等远端 connect resolve 的窗口)客户端管线化提前
 * 发的负载缓冲上限(评审 P3)。此态尚未 pipe 到 duplex,数据只累积在 buf——回环+浏览器
 * 正常场景远小于此值,恶意本地进程可在建连窗口猛发大包占内存,超限即 destroy。
 * 比握手上限宽松得多(正常管线化负载如 TLS ClientHello + 首包可达数 KB~几十 KB)。
 */
const MAX_CONNECTING_BYTES = 256 * 1024;

type ConnState = 'greeting' | 'request' | 'connecting' | 'piping';

/**
 * SOCKS CONNECT 失败 → REP 码映射(纯函数,便于单测,不碰 socket/网络)。
 * err 的形状不保证是 Error(openOutbound 桩/上游 ssh2 出错路径可能就是裸字符串),
 * 故统一转 message 文案再关键字匹配。
 */
export function mapConnectError(err: unknown): number {
  // ssh2 的 channel open failure 带数字 reason(RFC 4254 §5.1),比文案可靠:
  // 远端「那个端口没人监听」走的正是 CONNECT_FAILED(2),而它的 description 是
  // OpenSSH 的一句 "open failed" —— 只匹配文案会漏成兜底的 0x01(2026-08-14 报障
  // 现场:用户看到 ERR_SOCKS_CONNECTION_FAILED,以为隧道挂了,其实是远端没起服务)。
  const reason = (err as { reason?: unknown } | null)?.reason;
  if (reason === 2) return 0x05; // CONNECT_FAILED → Connection refused
  if (reason === 1) return 0x02; // ADMINISTRATIVELY_PROHIBITED → not allowed by ruleset
  if (reason === 4) return 0x01; // RESOURCE_SHORTAGE → general failure
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('econnrefused') || msg.includes('refused')) return 0x05; // Connection refused
  if (msg.includes('open failed')) return 0x05; // OpenSSH 对 direct-tcpip 失败的通用描述
  if (
    msg.includes('enotfound') ||
    msg.includes('ehostunreach') ||
    msg.includes('unreachable') ||
    msg.includes('getaddrinfo')
  ) {
    return 0x04; // Host unreachable
  }
  return 0x01; // General SOCKS server failure(兜底,不识别的失败原因)
}

/** SOCKS5 reply 恒定 10 字节;BND.ADDR/BND.PORT 全零(浏览器代理场景调用方不关心)。 */
function reply(rep: number): Buffer {
  return Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

/**
 * 创建未监听的 SOCKS5 代理 server;调用方自行 listen(0, '127.0.0.1')(端口分配、
 * 生命周期编排交给远程隧道层,本模块只管协议)。
 * server.close() 除停止 accept 新连接外,必须销毁全部在途连接——断开远程机
 * (调用方 close 这个 server)= 立即断流,不允许旧连接残留继续走已失效的 SSH 会话。
 */
export function createSocksProxyServer(openOutbound: OpenOutbound): net.Server {
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handleConnection(socket, openOutbound);
  });

  // 🔴 net.Server 的 'close' 事件语义是"停止 accept 之后,等全部现存连接都
  // 结束才触发"(经 node -e 实测验证:一条连接在途时 server.close() 之后,
  // 'close' 事件/回调迟迟不来,连接原样挂着)。若指望监听 'close' 事件反过来
  // 触发销毁在途连接,会死锁——没人主动断开连接,'close' 永远等不到。必须在
  // 调用方"调用 close() 这一刻"就动手销毁,而不是等 close 事件。故这里改写
  // (而非监听)close() 本身:调用即立即销毁全部在途 socket(=断开远程机 立即
  // 断流),再转发给原始 close() 完成"停止 accept + 等连接终结后真正 emit close"。
  const originalClose = server.close.bind(server);
  server.close = ((callback?: (err?: Error) => void): net.Server => {
    for (const s of sockets) s.destroy();
    return originalClose(callback);
  }) as typeof server.close;

  // 🔴 持久 server 级 error 监听(评审 P2-2):net.Server emit 'error' 而无监听会被当
  // 未捕获异常抛出崩主进程。orchestrator.startSocksProxy 在 listen 成功后会摘掉它那个
  // 仅用于「启动失败」的 once('error'),此后 accept 阶段的 error(EMFILE 等 fd 耗尽)
  // 若无人接就会崩——这里挂持久监听兜住(记录即可;在途连接各自 socket error 收场)。
  server.on('error', (err) => {
    console.error('[socksProxy] server error:', err.message);
  });

  return server;
}

function handleConnection(socket: net.Socket, openOutbound: OpenOutbound): void {
  let buf = Buffer.alloc(0);
  let state: ConnState = 'greeting';

  socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => {
    if (state !== 'piping') socket.destroy();
  });

  // 始终挂至少一个 error 监听——net.Socket 的 'error' 事件若无人监听,Node 会
  // 当成未捕获异常炸掉进程。真正的清理由下面的 'close'(及 piping 后追加的
  // error/close 监听)负责,这里留空即可。
  socket.on('error', () => {});

  const onData = (chunk: Buffer): void => {
    buf = Buffer.concat([buf, chunk]);
    processBuffer();
    // 只在仍处握手态才查缓冲上限——请求帧解析完成后 buf 剩的是正常负载,
    // 可能合法地超过 512 字节,不该被当成畸形握手判死刑。
    if ((state === 'greeting' || state === 'request') && buf.length > MAX_HANDSHAKE_BYTES) {
      socket.destroy();
    } else if (state === 'connecting' && buf.length > MAX_CONNECTING_BYTES) {
      // 建连窗口累积的管线化负载超宽松上限(评审 P3):防恶意本地进程灌内存
      socket.destroy();
    }
  };
  socket.on('data', onData);

  function processBuffer(): void {
    if (state === 'greeting') {
      if (buf.length < 2) return; // VER+NMETHODS 未齐,等下一包/下一字节
      const nmethods = buf[1];
      const total = 2 + nmethods;
      if (buf.length < total) return; // METHODS 未齐
      const ver = buf[0];
      const methods = buf.subarray(2, total);
      buf = buf.subarray(total);
      if (ver !== 0x05) {
        socket.destroy();
        return;
      }
      if (!methods.includes(0x00)) {
        socket.write(Buffer.from([0x05, 0xff]), () => socket.end());
        return;
      }
      socket.write(Buffer.from([0x05, 0x00]));
      state = 'request';
      processBuffer(); // 管线化:greeting+request 可能已在同一个 write 里全到齐
      return;
    }

    if (state === 'request') {
      if (buf.length < 4) return; // VER+CMD+RSV+ATYP 未齐
      const ver = buf[0];
      if (ver !== 0x05) {
        socket.destroy();
        return;
      }
      const cmd = buf[1];
      const atyp = buf[3];
      if (cmd !== 0x01) {
        // 只支持 CONNECT;BIND/UDP ASSOCIATE 浏览器代理用不上,一律拒绝
        socket.write(reply(0x07), () => socket.end());
        return;
      }

      const addrStart = 4;
      let host: string;
      let addrLen: number;
      if (atyp === 0x01) {
        addrLen = 4;
        if (buf.length < addrStart + addrLen + 2) return;
        host = Array.from(buf.subarray(addrStart, addrStart + 4)).join('.');
      } else if (atyp === 0x03) {
        if (buf.length < addrStart + 1) return; // 域名长度字节未到
        const len = buf[addrStart];
        addrLen = 1 + len;
        if (buf.length < addrStart + addrLen + 2) return;
        host = buf.subarray(addrStart + 1, addrStart + 1 + len).toString('utf8');
      } else if (atyp === 0x04) {
        addrLen = 16;
        if (buf.length < addrStart + addrLen + 2) return;
        const ip = buf.subarray(addrStart, addrStart + 16);
        const groups: string[] = [];
        for (let i = 0; i < 16; i += 2) groups.push(ip.readUInt16BE(i).toString(16));
        host = groups.join(':');
      } else {
        socket.write(reply(0x08), () => socket.end());
        return;
      }

      const portOffset = addrStart + addrLen;
      const port = buf.readUInt16BE(portOffset);
      const consumed = portOffset + 2;
      // 请求帧已完整消费;buf 剩下的是客户端管线化提前发的负载,connect 成功后
      // 要先冲入 duplex 再建立双向管道,不能丢。
      buf = buf.subarray(consumed);
      state = 'connecting';
      connect(host, port);
      return;
    }
    // state === 'connecting' | 'piping':数据只在 onData 里累积/直接流动,不在此处理
  }

  function connect(host: string, port: number): void {
    openOutbound(host, port).then(
      (duplex) => {
        // 竞态:resolve 时 server 可能已 close 并把本 socket destroy 掉了
        if (socket.destroyed) {
          duplex.destroy();
          return;
        }
        socket.write(reply(0x00));
        const pending = buf;
        buf = Buffer.alloc(0);
        if (pending.length > 0) duplex.write(pending); // 先冲入管线化负载,再建管道
        state = 'piping';
        socket.setTimeout(0); // 握手期超时到此为止,piping 态不再受它管
        socket.removeListener('data', onData); // 交由 pipe() 接管流动
        socket.pipe(duplex);
        duplex.pipe(socket);
        // 镜像 ssh.ts forwardOut 的既有惯用式:任一端 close/error 都 destroy 另一端
        socket.on('close', () => duplex.destroy());
        socket.on('error', () => duplex.destroy());
        duplex.on('close', () => socket.destroy());
        duplex.on('error', () => socket.destroy());
      },
      (err: unknown) => {
        const rep = mapConnectError(err);
        // 🔴 唯一的现场:Chromium 把所有非零 REP 都收敛成 ERR_SOCKS_CONNECTION_FAILED
        // (实测,见 renderer/services/navErrorText.ts),分不清「没人监听 / 被策略拒 /
        // 资源不足」。这条日志是排障时唯一能看到真实原因的地方。
        console.warn(
          `[socksProxy] connect ${host}:${port} failed (rep=0x0${rep}): ` +
            (err instanceof Error ? err.message : String(err)),
        );
        socket.write(reply(rep), () => socket.end());
      },
    );
  }
}
