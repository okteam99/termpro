// 预览帧的独立通道(host 侧注册表)。
//
// 为什么单开一条:主连接那条 WS 跑在**一个** SSH direct-tcpip channel 里,pty 输出、
// RPC、事件全在同一条 FIFO 上;画面帧插进去就会把终端输入和心跳推到队尾。
// 独立的 WS = 独立的 SSH channel,有自己的流控窗口——画面再忙也压不到终端那条队列。
// (底层 TCP 带宽仍然共享,所以 ack 门控的「最多一帧在途」照旧保留。)
//
// 帧走二进制(见 shared/browserFrameCodec.ts),省掉 base64 的 33% 和一次 JSON 解析。

import type { WebSocket } from 'ws';
import {
  decodeFrameAck,
  encodeBrowserFrame,
  type BrowserFrameHeader,
} from '../shared/browserFrameCodec';

export interface FrameChannel {
  streamId: string;
  send(header: BrowserFrameHeader, jpeg: Uint8Array): void;
  close(): void;
  /** 该通道断开时通知(host 据此停掉对应预览:人走画面停) */
  onClose(cb: () => void): void;
  /** 客户端回的帧确认 */
  onAck(cb: (tabId: string, seq: number) => void): void;
}

/**
 * 帧通道注册表:按 streamId 关联「主连接发起的预览」与「独立通道」。
 * streamId 由 renderer 生成并在两处出示(连通道时的查询参数 + startPreview 的参数),
 * host 只做关联,不签发——通道本身已经过 token 闸,streamId 只解决路由。
 */
export class FrameChannelRegistry {
  private readonly channels = new Map<string, FrameChannel>();

  register(ws: WebSocket, streamId: string, logger: (line: string) => void): FrameChannel {
    this.channels.get(streamId)?.close(); // 同 streamId 重连:旧的让位
    const closeCbs = new Set<() => void>();
    const ackCbs = new Set<(tabId: string, seq: number) => void>();

    const channel: FrameChannel = {
      streamId,
      send: (header, jpeg) => {
        if (ws.readyState !== ws.OPEN) return;
        try {
          ws.send(encodeBrowserFrame(header, jpeg), { binary: true });
        } catch (err) {
          logger(
            `[host] frame channel send failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
      close: () => {
        try {
          ws.close();
        } catch {
          // 已经关了
        }
      },
      onClose: (cb) => closeCbs.add(cb),
      onAck: (cb) => ackCbs.add(cb),
    };

    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      // 上行只允许文本 ack;二进制上行没有任何用途,直接忽略(不给意外解析面)
      if (isBinary) return;
      const ack = decodeFrameAck(raw.toString('utf8'));
      if (!ack) return;
      for (const cb of ackCbs) cb(ack.tabId, ack.seq);
    });
    ws.on('close', () => {
      if (this.channels.get(streamId) === channel) this.channels.delete(streamId);
      for (const cb of closeCbs) cb();
    });
    ws.on('error', (err: Error) => {
      logger(`[host] frame channel error: ${err.message}`);
    });

    this.channels.set(streamId, channel);
    return channel;
  }

  get(streamId: string): FrameChannel | undefined {
    return this.channels.get(streamId);
  }

  closeAll(): void {
    for (const channel of this.channels.values()) channel.close();
    this.channels.clear();
  }
}
