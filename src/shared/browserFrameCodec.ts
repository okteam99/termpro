// 云端浏览器预览帧的二进制线格式(两端共用,防形状漂移)。
//
// 为什么不塞进 JSON:JPEG 走 base64 要多付 33% 体积,而画面是这条链路上最大的一股
// 流量;JSON.parse 还要把整帧字符串再解一遍。二进制帧直接把字节交给 createImageBitmap。
//
// 布局:
//   [u32 BE headerLen][headerLen 字节 UTF-8 JSON 头][剩余全部 = JPEG 原始字节]
// 头里只放路由与换算需要的元数据(tabId / seq / metadata),不放任何字节负载。

import type { BrowserFrameMetadata } from './protocol';

/** 帧通道的 WS 路径(与主连接同端口、同 token 闸,不同路径)。 */
export const BROWSER_FRAME_PATH = '/frames';

/** 帧通道单帧上限:画面帧不该有几十 MB,给 8MiB 足够(主连接仍是 32MiB)。 */
export const BROWSER_FRAME_MAX_PAYLOAD = 8 * 1024 * 1024;

/** 头部长度前缀占 4 字节(u32 BE)。 */
const HEADER_LEN_BYTES = 4;
/** 头部 JSON 的合理上限:超过必是畸形/攻击,直接拒。 */
const MAX_HEADER_BYTES = 8 * 1024;

export interface BrowserFrameHeader {
  tabId: string;
  seq: number;
  metadata: BrowserFrameMetadata;
}

export function encodeBrowserFrame(
  header: BrowserFrameHeader,
  jpeg: Uint8Array,
): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(HEADER_LEN_BYTES + headerBytes.length + jpeg.length);
  new DataView(out.buffer).setUint32(0, headerBytes.length, false);
  out.set(headerBytes, HEADER_LEN_BYTES);
  out.set(jpeg, HEADER_LEN_BYTES + headerBytes.length);
  return out;
}

/**
 * 解一帧。畸形一律返回 null(调用方按「丢弃该帧」处理)——
 * 🔴 不抛:这条路径每秒跑几十次,一个坏帧不该把连接或渲染循环打断。
 */
export function decodeBrowserFrame(
  buf: Uint8Array,
): { header: BrowserFrameHeader; data: Uint8Array } | null {
  if (buf.length < HEADER_LEN_BYTES) return null;
  const headerLen = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(
    0,
    false,
  );
  if (headerLen === 0 || headerLen > MAX_HEADER_BYTES) return null;
  if (buf.length < HEADER_LEN_BYTES + headerLen) return null;
  let header: BrowserFrameHeader;
  try {
    header = JSON.parse(
      new TextDecoder().decode(buf.subarray(HEADER_LEN_BYTES, HEADER_LEN_BYTES + headerLen)),
    );
  } catch {
    return null;
  }
  if (
    !header ||
    typeof header.tabId !== 'string' ||
    typeof header.seq !== 'number' ||
    !header.metadata
  ) {
    return null;
  }
  return { header, data: buf.subarray(HEADER_LEN_BYTES + headerLen) };
}

/** 帧确认(客户端 → host)。走同一条帧通道的**文本**帧:小且可读,不值得再编一套二进制。 */
export interface BrowserFrameAck {
  tabId: string;
  seq: number;
}

export function encodeFrameAck(ack: BrowserFrameAck): string {
  return JSON.stringify(ack);
}

export function decodeFrameAck(text: string): BrowserFrameAck | null {
  try {
    const parsed = JSON.parse(text) as Partial<BrowserFrameAck>;
    if (typeof parsed?.tabId !== 'string' || typeof parsed?.seq !== 'number') return null;
    return { tabId: parsed.tabId, seq: parsed.seq };
  } catch {
    return null;
  }
}

/** streamId 形状校验(renderer 生成的 UUID;host 只做关联,不信任长度/字符集)。 */
export function isValidStreamId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
}
