// 会话回放源:字节上限的环形 scrollback 缓冲(BL-005)。每个 standalone session 一个。
// 只存字节、不解析 CSI/OSC 转义语法(跨 chunk 转义态拿不到 · 内建 parser 是 YAGNI)——
// 转义序列完整性靠 gap 超缓冲 full=true 回退清屏 + proc.resize 逼重绘兜底(ARCH-B-7/QA-B-3)。
//
// 记账:absoluteOffset = 累计 push 的总字节(单调递增);startOffset = absoluteOffset - length
// = 缓冲内最旧字节的绝对偏移。sliceFrom(offset) 据此产出增量切片(full=false)或整缓冲
// 回退(full=true)。驱逐点 / 缓冲切片起点均对齐 UTF-8 码点边界(无状态 · 看高位 bit)。

/** 默认容量:256 KiB。env OKWORK_SESSION_RING_BYTES 可注入(测试/运维调优)。 */
export const DEFAULT_RING_BYTES = 256 * 1024;

function envCapacity(): number {
  const raw = process.env.OKWORK_SESSION_RING_BYTES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_RING_BYTES;
}

/** UTF-8 续字节(10xxxxxx):不能作为码点/切片起点。 */
function isContinuationByte(b: number): boolean {
  return (b & 0xc0) === 0x80;
}

export interface RingSlice {
  /** 回放载荷(UTF-8 安全边界切片) */
  data: string;
  /** data 首字节的绝对偏移 */
  baseOffset: number;
  /** true = 游标不在缓冲内(被挤出/新建 tab)→ 整缓冲 · renderer 须先清屏全量 */
  full: boolean;
}

export class RingBuffer {
  readonly capacityBytes: number;
  /** 累计 push 的总字节数(单调递增);= 缓冲末字节后的绝对偏移 */
  private _absoluteOffset = 0;
  /** 当前保留的字节(length ≤ capacityBytes) */
  private buf: Buffer = Buffer.alloc(0);

  constructor(capacityBytes: number = envCapacity()) {
    this.capacityBytes = capacityBytes > 0 ? Math.floor(capacityBytes) : DEFAULT_RING_BYTES;
  }

  /** 缓冲末字节后的绝对偏移(= 累计发出总字节) */
  get absoluteOffset(): number {
    return this._absoluteOffset;
  }

  /** 缓冲内最旧字节的绝对偏移 */
  get startOffset(): number {
    return this._absoluteOffset - this.buf.length;
  }

  /** 当前保留字节数(有界 ≤ capacityBytes) */
  get length(): number {
    return this.buf.length;
  }

  /** 当前整缓冲的解码内容(只读 · 测试/诊断用) */
  buffered(): string {
    return this.buf.toString('utf8');
  }

  /** 追加一段输出;超容量从头按字节驱逐,驱逐点对齐 UTF-8 码点边界。 */
  push(data: string): void {
    const chunk = Buffer.from(data, 'utf8');
    if (chunk.length === 0) return;
    this._absoluteOffset += chunk.length;
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    if (this.buf.length <= this.capacityBytes) return;

    // 从头驱逐超出的字节;驱逐点前移到下一个完整码点起点(不切多字节码点)。
    let evict = this.buf.length - this.capacityBytes;
    while (evict < this.buf.length && isContinuationByte(this.buf[evict])) {
      evict++;
    }
    this.buf = this.buf.subarray(evict);
  }

  /**
   * 从绝对偏移 offset 取回放切片。
   *  - offset ≥ startOffset → 增量切片(full=false),baseOffset=offset(对齐后)
   *  - offset < startOffset(最旧被挤出/新建 tab)→ 整缓冲(full=true),renderer 清屏全量
   */
  sliceFrom(offset: number): RingSlice {
    const startOffset = this.startOffset;
    if (offset < startOffset) {
      // 游标不在缓冲内:整缓冲全量回退(renderer term.reset 清屏)
      return { data: this.buf.toString('utf8'), baseOffset: startOffset, full: true };
    }
    // 增量:clamp 到缓冲末尾(offset > absoluteOffset 时返回空增量)
    let from = Math.min(offset - startOffset, this.buf.length);
    // 防御性对齐(offset 恒为 chunk 边界即码点边界 · 此处兜底不切坏码点)
    while (from < this.buf.length && isContinuationByte(this.buf[from])) {
      from++;
    }
    return {
      data: this.buf.subarray(from).toString('utf8'),
      baseOffset: startOffset + from,
      full: false,
    };
  }
}
