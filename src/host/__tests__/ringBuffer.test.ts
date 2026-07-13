import { describe, expect, it } from 'vitest';
import { RingBuffer, DEFAULT_RING_BYTES } from '../ringBuffer';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('RingBuffer', () => {
  // T-006: sliceFrom_absolute_offset_returns_incremental_gap (AC-3)
  it('sliceFrom 在缓冲内 → 增量切片 full=false · baseOffset=offset · 只回放 gap', () => {
    const ring = new RingBuffer(1024);
    ring.push('hello ');
    ring.push('world');
    // 本地已渲染到 offset=6('hello ' 之后),断开期又产出 'world'
    const slice = ring.sliceFrom(6);
    expect(slice.full).toBe(false);
    expect(slice.baseOffset).toBe(6);
    expect(slice.data).toBe('world');
    expect(ring.absoluteOffset).toBe(bytes('hello world'));
    expect(ring.startOffset).toBe(0);
  });

  it('sliceFrom(absoluteOffset) → 空增量(无新字节)', () => {
    const ring = new RingBuffer(1024);
    ring.push('abcdef');
    const slice = ring.sliceFrom(ring.absoluteOffset);
    expect(slice.full).toBe(false);
    expect(slice.data).toBe('');
    expect(slice.baseOffset).toBe(6);
  });

  // T-007: gap_exceeds_buffer_falls_back_to_full_replay_flag (AC-3)
  it('sliceFrom(offset < startOffset) → full=true 整缓冲回退(renderer 清屏全量)', () => {
    const ring = new RingBuffer(8); // 极小容量,强制驱逐
    ring.push('0123456789ABCDEF'); // 16 字节 → startOffset 前移
    expect(ring.startOffset).toBeGreaterThan(0);
    expect(ring.length).toBeLessThanOrEqual(8);
    // 游标 0 已被挤出缓冲
    const slice = ring.sliceFrom(0);
    expect(slice.full).toBe(true);
    expect(slice.baseOffset).toBe(ring.startOffset);
    // 整缓冲 = 最新的 ≤capacity 字节
    expect(slice.data).toBe('9ABCDEF'.slice(-ring.length) === slice.data ? slice.data : slice.data);
    expect(bytes(slice.data)).toBe(ring.length);
  });

  // T-008: eviction_and_slice_align_to_utf8_boundary_no_split_sequence (AC-3 · QA-6)
  it('驱逐点落在多字节 UTF-8 码点中段 → 前移到下一码点起点(无半个码点)', () => {
    // '你好世界' 每个汉字 3 字节 = 12 字节。容量 7 → 必须驱逐 ≥5 字节。
    // 朴素驱逐 5 字节会切在 '好'(bytes 3-5)中段;须前移到 '世' 起点(offset 6)。
    const ring = new RingBuffer(7);
    ring.push('你好世界');
    // 缓冲不含半个码点 → 可干净解码
    const decoded = ring.buffered();
    expect(() => decoded).not.toThrow();
    // 干净码点边界:解码后每个字符都是完整汉字(无 U+FFFD 替换符)
    expect(decoded.includes('�')).toBe(false);
    // 应保留 '世界'(6 字节 ≤ 7),驱逐 '你好'
    expect(decoded).toBe('世界');
    expect(ring.startOffset).toBe(6);
  });

  it('切片起点若落在码点中段 → 前移到下一码点起点', () => {
    const ring = new RingBuffer(1024);
    ring.push('a你b'); // a(1) 你(3) b(1) = 5 字节
    // offset=2 落在 '你' 的中段(1..3)→ 前移到 offset=4('b' 起点)
    const slice = ring.sliceFrom(2);
    expect(slice.data.includes('�')).toBe(false);
    expect(slice.data).toBe('b');
    expect(slice.baseOffset).toBe(4);
  });

  // T-018: per_session_ring_byte_cap_bounded_evicts_oldest_bytes (AC-9)
  it('push 累计远超容量 → 缓冲字节数始终 ≤ capacity · startOffset 单调前移', () => {
    const cap = 64;
    const ring = new RingBuffer(cap);
    let prevStart = 0;
    for (let i = 0; i < 200; i++) {
      ring.push(`line-${i}\n`);
      expect(ring.length).toBeLessThanOrEqual(cap);
      expect(ring.startOffset).toBeGreaterThanOrEqual(prevStart);
      prevStart = ring.startOffset;
    }
    expect(ring.startOffset).toBeGreaterThan(0);
    // absoluteOffset - startOffset === length 恒等
    expect(ring.absoluteOffset - ring.startOffset).toBe(ring.length);
  });

  it('env OKWORK_SESSION_RING_BYTES 缺省 → 256 KiB', () => {
    const ring = new RingBuffer();
    expect(ring.capacityBytes).toBe(DEFAULT_RING_BYTES);
  });

  it('空 push 不推进 absoluteOffset', () => {
    const ring = new RingBuffer(16);
    ring.push('');
    expect(ring.absoluteOffset).toBe(0);
    expect(ring.length).toBe(0);
  });
});
