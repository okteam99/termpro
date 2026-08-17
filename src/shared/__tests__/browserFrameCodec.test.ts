// 预览帧的二进制线格式:编解码往返 + 畸形输入一律丢弃(不抛)。
import { describe, expect, it } from 'vitest';
import {
  decodeBrowserFrame,
  decodeFrameAck,
  encodeBrowserFrame,
  encodeFrameAck,
  isValidStreamId,
  type BrowserFrameHeader,
} from '../browserFrameCodec';

const META = {
  deviceWidth: 1280,
  deviceHeight: 800,
  pageScaleFactor: 1,
  offsetTop: 0,
  scrollOffsetX: 0,
  scrollOffsetY: 0,
};

const header: BrowserFrameHeader = { tabId: 'target-1', seq: 42, metadata: META };

describe('帧编解码', () => {
  it('往返:头与字节都原样回来', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    const decoded = decodeBrowserFrame(encodeBrowserFrame(header, jpeg));
    expect(decoded?.header).toEqual(header);
    expect(Array.from(decoded!.data)).toEqual(Array.from(jpeg));
  });

  it('🔴 载荷不经 base64:编码长度 ≈ 头 + 原始字节(不是 4/3 倍)', () => {
    const jpeg = new Uint8Array(30_000).fill(7);
    const encoded = encodeBrowserFrame(header, jpeg);
    // base64 会把 30000 变成 40000;这里的开销只有一个小 JSON 头
    expect(encoded.length).toBeLessThan(jpeg.length + 512);
    expect(encoded.length).toBeGreaterThanOrEqual(jpeg.length);
  });

  it('空载荷帧也合法(极端场景下 host 仍可能发出)', () => {
    const decoded = decodeBrowserFrame(encodeBrowserFrame(header, new Uint8Array()));
    expect(decoded?.data.length).toBe(0);
  });

  it('中文/emoji 的 tabId 不破坏长度前缀(头按 UTF-8 字节数计,不是字符数)', () => {
    const wide: BrowserFrameHeader = { ...header, tabId: '标签-🧭-1' };
    const jpeg = new Uint8Array([1, 2, 3]);
    const decoded = decodeBrowserFrame(encodeBrowserFrame(wide, jpeg));
    expect(decoded?.header.tabId).toBe('标签-🧭-1');
    expect(Array.from(decoded!.data)).toEqual([1, 2, 3]);
  });

  it('🔴 畸形一律返回 null,绝不抛(每秒几十帧,一个坏帧不该打断渲染循环)', () => {
    expect(decodeBrowserFrame(new Uint8Array())).toBeNull();
    expect(decodeBrowserFrame(new Uint8Array([0, 0, 0]))).toBeNull(); // 短于长度前缀
    // 头长度为 0
    expect(decodeBrowserFrame(new Uint8Array([0, 0, 0, 0, 1, 2]))).toBeNull();
    // 头长度超上限
    const huge = new Uint8Array(8);
    new DataView(huge.buffer).setUint32(0, 0xffffff, false);
    expect(decodeBrowserFrame(huge)).toBeNull();
    // 声称的头长度超出实际缓冲
    const truncated = new Uint8Array(8);
    new DataView(truncated.buffer).setUint32(0, 100, false);
    expect(decodeBrowserFrame(truncated)).toBeNull();
    // 头不是合法 JSON
    const badJson = new Uint8Array(4 + 3);
    new DataView(badJson.buffer).setUint32(0, 3, false);
    badJson.set(new TextEncoder().encode('{ab'), 4);
    expect(decodeBrowserFrame(badJson)).toBeNull();
  });

  it('头缺字段 → null(不把半个头当成有效帧)', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ tabId: 'x' })); // 缺 seq/metadata
    const buf = new Uint8Array(4 + bytes.length);
    new DataView(buf.buffer).setUint32(0, bytes.length, false);
    buf.set(bytes, 4);
    expect(decodeBrowserFrame(buf)).toBeNull();
  });
});

describe('ack 与 streamId', () => {
  it('ack 往返', () => {
    expect(decodeFrameAck(encodeFrameAck({ tabId: 't', seq: 9 }))).toEqual({
      tabId: 't',
      seq: 9,
    });
  });

  it('畸形 ack → null', () => {
    expect(decodeFrameAck('nope')).toBeNull();
    expect(decodeFrameAck('{"tabId":"t"}')).toBeNull();
    expect(decodeFrameAck('{"seq":1}')).toBeNull();
  });

  it('streamId 形状校验(host 不信任 renderer 给的字符串)', () => {
    expect(isValidStreamId(crypto.randomUUID())).toBe(true);
    expect(isValidStreamId('short')).toBe(false);
    expect(isValidStreamId('../../etc/passwd')).toBe(false);
    expect(isValidStreamId('a'.repeat(65))).toBe(false);
    expect(isValidStreamId(42)).toBe(false);
    expect(isValidStreamId(undefined)).toBe(false);
  });
});
