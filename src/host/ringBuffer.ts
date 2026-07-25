// 会话回放源:字节上限的环形 scrollback 缓冲(BL-005)。每个 standalone session 一个。
//
// 记账:absoluteOffset = 累计 push 的总字节(单调递增);startOffset = absoluteOffset - length
// = 缓冲内最旧字节的绝对偏移。sliceFrom(offset) 据此产出增量切片(full=false)或整缓冲
// 回退(full=true)。驱逐点 / 缓冲切片起点均对齐 UTF-8 码点边界(无状态 · 看高位 bit)。
//
// 🔴 驱逐点还必须对齐【转义序列边界】(2026-07 修「远程重连后满屏 `0m` 垃圾」):
// full 回放前 renderer 会 term.reset() 清屏 —— 此时 xterm 解析器是 ground 态,若切片起点
// 落在 CSI/OSC 中段(如 `\x1b[0m` 被驱逐成 `0m`),残尾会被当【正文】打印到屏幕左上角。
// 早期注释称「内建 parser 是 YAGNI · 靠 proc.resize 逼重绘兜底」,但 reattach 的 resize
// 对账在尺寸未变时天然 no-op(不发 SIGWINCH),兜底并不存在 → 垃圾字符直接可见。
// 现在维持不变式:**buf[0] 恒为 ground 态字节**(不在任何转义序列内部)。因该不变式成立,
// 每次驱逐都能从 0 起以 ground 态重新解析,增量成本 O(驱逐字节数)、全程摊还 O(1)/字节。

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

// ---- 极简 ANSI 转义态机 ----------------------------------------------------
// 只为回答一个问题:「第 i 字节是不是新序列的起点(ground)」。不解释语义、不存参数,
// 因此不需要完整 VT 解析器。未终止的病态序列由 alignEvict 的搜索窗兜底(见下)。
const GROUND = 0; // 正文 / 序列之间 —— 可安全切片
const ESC = 1; // 刚吃到 ESC,等待类型字节
const ESC_INTER = 2; // ESC + 中间字节(如 `(`/`#`),再吃一个终止字节
const CSI = 3; // ESC [ …:参数/中间字节直到 0x40..0x7e 终止
const STR = 4; // OSC / DCS / SOS / PM / APC 字符串体:BEL 或 ST(ESC \)终止
const STR_ESC = 5; // 字符串体内吃到 ESC,等待 `\`(ST)

type EscState =
  | typeof GROUND
  | typeof ESC
  | typeof ESC_INTER
  | typeof CSI
  | typeof STR
  | typeof STR_ESC;

/** 吃一个字节,返回下一状态(state = 消费 b 之前的状态)。 */
function step(state: EscState, b: number): EscState {
  switch (state) {
    case GROUND:
      return b === 0x1b ? ESC : GROUND;
    case ESC:
      if (b === 0x5b) return CSI; // '['
      // ']' OSC · 'P' DCS · 'X' SOS · '^' PM · '_' APC —— 同为字符串型,终止符一致
      if (b === 0x5d || b === 0x50 || b === 0x58 || b === 0x5e || b === 0x5f) {
        return STR;
      }
      if (b >= 0x20 && b <= 0x2f) return ESC_INTER; // 中间字节:再吃一个终止字节
      return GROUND; // 单字节终止(ESC M / ESC 7 / ESC c …)
    case ESC_INTER:
      return b >= 0x20 && b <= 0x2f ? ESC_INTER : GROUND;
    case CSI:
      if (b === 0x1b) return ESC; // 序列被打断,新序列开始
      return b >= 0x40 && b <= 0x7e ? GROUND : CSI; // 终止字节 or 参数/中间字节
    case STR:
      if (b === 0x07) return GROUND; // BEL
      return b === 0x1b ? STR_ESC : STR;
    case STR_ESC:
      if (b === 0x5c) return GROUND; // ST = ESC \
      return b === 0x1b ? STR_ESC : STR; // 非 ST:仍在字符串体内
  }
}

/**
 * 未终止序列的搜索窗:从期望驱逐点再往后最多找这么多字节的 ground 点。
 * 超出即放弃转义对齐、退回纯 UTF-8 对齐(宁可留一小段残尾,也不为一条病态 OSC
 * 把整个 scrollback 吃光,并给每次 push 兜住 O(容量) 的扫描成本)。
 */
const GROUND_SEARCH_WINDOW = 4096;

/**
 * 求 ≥ want 的最小驱逐点,使新 buf[0] 落在 ground 态且非 UTF-8 续字节。
 * 前置不变式:buf[0] 本身是 ground(由上一次驱逐维持)→ 可从 0 起以 GROUND 重解析。
 * 找不到(病态未终止序列)→ 返回 -1,调用方退回纯 UTF-8 对齐。
 */
function alignEvict(buf: Buffer, want: number): number {
  const limit = Math.min(buf.length, want + GROUND_SEARCH_WINDOW);
  let state: EscState = GROUND;
  for (let i = 0; i < limit; i++) {
    if (i >= want && state === GROUND && !isContinuationByte(buf[i])) return i;
    state = step(state, buf[i]);
  }
  // 缓冲恰好在 ground 态收尾且 want 落在末尾 → 全驱逐是合法解
  if (limit === buf.length && buf.length >= want && state === GROUND) {
    return buf.length;
  }
  return -1;
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

    // 从头驱逐超出的字节;驱逐点前移到下一个「完整码点 + 非转义序列中段」的起点,
    // 维持 buf[0] 恒 ground 的不变式(full 回放切片据此天然不含残尾)。
    const want = this.buf.length - this.capacityBytes;
    const aligned = alignEvict(this.buf, want);
    let evict = aligned;
    if (evict < 0) {
      // 病态未终止序列:退回纯 UTF-8 对齐(旧行为)。不变式暂破,下次驱逐自愈。
      evict = want;
      while (evict < this.buf.length && isContinuationByte(this.buf[evict])) {
        evict++;
      }
    }
    this.buf = this.buf.subarray(evict);
  }

  /**
   * 从绝对偏移 offset 取回放切片。
   *  - offset ≥ startOffset → 增量切片(full=false),baseOffset=offset(对齐后)
   *  - offset < startOffset(最旧被挤出/新建 tab)→ 整缓冲(full=true),renderer 清屏全量
   *
   * full 切片起点 = buf[0] = ground 态(push 驱逐维持的不变式)→ term.reset() 后写入不会
   * 把转义残尾当正文打印。增量切片不做转义对齐,也不需要:offset 恒为 chunk 边界,残尾的
   * 前半截早已写进同一个 xterm 实例,其解析器跨 write 保持状态,续上即完整。
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
