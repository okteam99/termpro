// 预览帧的独立通道(renderer 侧)。
//
// 与主连接分开的理由见 host/frameChannel.ts:主连接那条 WS 跑在一个 SSH channel 里,
// 和 pty 输出、RPC 挤同一条 FIFO;画面插进去会把终端输入和心跳推到队尾。
// 这里另开一条 WS —— 对 SSH 来说就是另一个 direct-tcpip channel,有自己的流控窗口。
//
// 帧走二进制:省掉 base64 的 33% 和一次 JSON 解析,字节直接交给 createImageBitmap。

import {
  BROWSER_FRAME_PATH,
  decodeBrowserFrame,
  encodeFrameAck,
  type BrowserFrameHeader,
} from '../../shared/browserFrameCodec';

export interface BrowserFrameChannel {
  readonly streamId: string;
  /** 连接就绪(host 侧已能按 streamId 找到它);失败即 reject */
  readonly ready: Promise<void>;
  onFrame(cb: (header: BrowserFrameHeader, jpeg: Uint8Array) => void): () => void;
  /** 确认收到某帧 → host 放行下一帧(背压见 browserService.startPreview) */
  ack(tabId: string, seq: number): void;
  close(): void;
}

/** 由主连接的 ws URL 推出帧通道 URL:同主机同端口同 token,只换路径 + 带 sid。 */
export function frameChannelUrl(mainWsUrl: string, streamId: string): string {
  const url = new URL(mainWsUrl);
  url.pathname = BROWSER_FRAME_PATH;
  url.searchParams.set('sid', streamId);
  return url.toString();
}

export function openBrowserFrameChannel(
  mainWsUrl: string,
  streamId: string,
  opts: { timeoutMs?: number } = {},
): BrowserFrameChannel {
  const ws = new WebSocket(frameChannelUrl(mainWsUrl, streamId));
  ws.binaryType = 'arraybuffer';
  const listeners = new Set<(header: BrowserFrameHeader, jpeg: Uint8Array) => void>();
  let closed = false;

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('frame channel open timeout'));
      try {
        ws.close();
      } catch {
        /* 已经在关 */
      }
    }, opts.timeoutMs ?? 8000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('frame channel failed to open'));
    });
  });
  // 未被消费时不要变成 unhandled rejection(调用方可能只关心 onFrame)
  void ready.catch(() => undefined);

  ws.addEventListener('message', (e: MessageEvent) => {
    if (!(e.data instanceof ArrayBuffer)) return; // 上行/文本一律不是帧
    const decoded = decodeBrowserFrame(new Uint8Array(e.data));
    // 畸形帧丢弃不抛:这条路径每秒跑几十次,一个坏帧不该打断渲染循环
    if (!decoded) return;
    for (const cb of listeners) cb(decoded.header, decoded.data);
  });
  ws.addEventListener('close', () => {
    closed = true;
    listeners.clear();
  });

  return {
    streamId,
    ready,
    onFrame(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    ack(tabId, seq) {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      ws.send(encodeFrameAck({ tabId, seq }));
    },
    close() {
      closed = true;
      listeners.clear();
      try {
        ws.close();
      } catch {
        /* 已经在关 */
      }
    },
  };
}
