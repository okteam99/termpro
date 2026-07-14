// 终端文件/路径链接提供器:hover 才做存在性校验(fs.stat),
// 相对路径按会话实时 cwd 解析(2.5s 记忆),命中后下划线 + 点击打开。
// 列映射按 buffer cell 逐格构建——路径前有 CJK 宽字符时索引≠列号。

import type {
  IBufferLine,
  ILink,
  ILinkHandler,
  ILinkProvider,
  Terminal,
} from '@xterm/xterm';
import type { HostClient } from '../services/hostClient';
import { tryLocateInFilePanel } from '../filepanel/locateRegistry';
import {
  extractCandidates,
  fileUrlToPath,
  stripLineCol,
  trimTrailingPunct,
} from './terminalLinkParse';

const STAT_CACHE_MS = 5_000;
const CWD_CACHE_MS = 2_500;

// 交给系统打开的扩展名(媒体/压缩包等);图片与文本进 OkWork 文件窗口
// export:权威集合单源,测试 import 校验文件分流边界(不硬编码列表)
export const SYSTEM_OPEN_EXT =
  /\.(icns|pdf|zip|gz|tgz|tar|7z|dmg|app|mp4|mov|avi|mkv|mp3|wav|flac|woff2?|ttf|otf|eot)$/i;

let locateRequestSeq = 0;

function openTargetFallback(
  absPath: string,
  kind: 'file' | 'dir',
  hostId?: string | null,
): void {
  // 远程终端的路径在远端机上:本机 openPath 会静默作用于本机同名路径(D-7 误路由)。
  // 远程一律进查看器窗口(带 hostId 直连该 host;目录 → listing,媒体/压缩包 →
  // 查看器给出确定性「二进制/过大」提示),绝不落本机 OS 动作。
  if (hostId && hostId !== 'local') {
    window.okwork.openViewerWindow({ mode: kind, path: absPath, hostId });
    return;
  }
  if (kind === 'dir' || SYSTEM_OPEN_EXT.test(absPath)) {
    window.okwork.openPath(absPath);
  } else {
    window.okwork.openViewerWindow({ mode: 'file', path: absPath });
  }
}

export async function openTargetInFilePanelFirst(
  tabId: string,
  absPath: string,
  kind: 'file' | 'dir',
  hostId?: string | null,
): Promise<void> {
  const located = await tryLocateInFilePanel(tabId, {
    id: ++locateRequestSeq,
    path: absPath,
    kind,
    sourceTabId: tabId,
  });
  if (!located) openTargetFallback(absPath, kind, hostId);
}

// 链接激活路由:目录回 File Panel 定位优先(留在工作面看上下文/git);
// 单个文件直接打开——文本/图片进 OkWork 窗口,媒体/系统扩展名走系统打开,
// 不再因落在 root/worktree 内就降级成「只定位」。
// hostId = 该终端绑定 workspace 的路由键(缺省/'local' = 本机)。
export function openTarget(
  tabId: string,
  absPath: string,
  kind: 'file' | 'dir',
  hostId?: string | null,
): void {
  if (kind === 'dir') {
    void openTargetInFilePanelFirst(tabId, absPath, kind, hostId);
  } else {
    openTargetFallback(absPath, kind, hostId);
  }
}

/** buffer 行 → 文本 + 每个 code unit 对应的列号(0 基) */
function lineToString(line: IBufferLine): { text: string; cols: number[] } {
  let text = '';
  const cols: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    if (cell.getWidth() === 0) continue; // 宽字符尾随占位格
    const chars = cell.getChars() || ' ';
    for (let k = 0; k < chars.length; k++) {
      text += chars[k];
      cols.push(x);
    }
  }
  return { text, cols };
}

/**
 * 该行内容是否铺满到最后一列。用于识别「硬折行」——Ink/Claude Code 等 TUI
 * 自行把长行折到终端宽度(发真实换行),续行不带 isWrapped 标记;但被折的首行
 * 一定铺满到行尾。尾随空格(右对齐填充)不算,避免把它当续接拼进逻辑行。
 */
function reachesRightEdge(line: IBufferLine | undefined): boolean {
  if (!line || line.length === 0) return false;
  const last = line.getCell(line.length - 1);
  if (!last) return false;
  if (last.getWidth() === 0) {
    // 宽字符尾随占位格:真正字符落在前一格
    const prev = line.getCell(line.length - 2);
    return !!prev?.getChars();
  }
  const chars = last.getChars();
  return !!chars && chars !== ' ';
}

/**
 * 行尾「斜杠断点」检测:忽略尾随空白后,最后一个字符是否为 '/';是则返回
 * 空隙格数(右缘起的空白 cell 数),否则 null。配合 leadingPathSegmentLength
 * 识别 Claude Code 等 TUI 的【斜杠感知折行】——长路径不按字符折到行宽,而是
 * 在 '/' 边界断行,因此被折首行常差几列不铺满,reachesRightEdge 恒 false,
 * 三行路径一行都拼不起来(只剩前缀目录可点)。
 */
function trailingSlashGap(line: IBufferLine | undefined): number | null {
  if (!line || line.length === 0) return null;
  for (let x = line.length - 1; x >= 0; x--) {
    const chars = line.getCell(x)?.getChars() ?? '';
    if (!chars || chars === ' ') continue;
    return chars === '/' ? line.length - 1 - x : null;
  }
  return null;
}

/**
 * 续行首段长度:跳过悬挂缩进/gutter(空格、│、⎿)后,路径字符 run 到第一个
 * '/'(含)为止;无斜杠则取整个 run。CJK/无路径字符打头 → 0。
 */
function leadingPathSegmentLength(line: IBufferLine | undefined): number {
  if (!line) return 0;
  const { text } = lineToString(line);
  const m = /^[ │⎿]*([\w.@%+-]+\/|[\w.@%+-]+|\/)/.exec(text);
  return m ? m[1].length : 0;
}

/**
 * 硬折行「上一行 prevY 与下一行同属一条逻辑行」判定:
 * ① 铺满到最后一列(reachesRightEdge · 字符级折行);或
 * ② 斜杠折行:prevY 以 '/' 收尾留有空隙,且续行首段【放不下】该空隙
 *   (seg > gap,贪婪打包不变式——正因放不下才换行)。反之(seg ≤ gap)
 *   说明那不是折行,而是两行各自独立的内容(如目录列表短行),不得合并,
 *   否则 `src/`+`renderer/` 这类同级条目会被 stat 命中误拼成一条链接。
 */
function hardFoldContinues(buf: BufferLike, prevY: number): boolean {
  const prev = buf.getLine(prevY);
  if (reachesRightEdge(prev)) return true;
  const gap = trailingSlashGap(prev);
  if (gap === null) return false;
  return leadingPathSegmentLength(buf.getLine(prevY + 1)) > gap;
}

interface CellPos {
  row: number;
  col: number;
}

interface LogicalLine {
  startRow: number;
  endRow: number;
  text: string;
  /** 每个 code unit 的 (row, col) */
  pos: CellPos[];
}

/** 逻辑行最多拼接的物理行数(超长输出防御) */
const MAX_LOGICAL_ROWS = 60;

interface BufferLike {
  length: number;
  getLine(y: number): IBufferLine | undefined;
}

/**
 * 以任一物理行为起点拼出完整逻辑行(长 URL / 长路径折行场景)。
 * 三种折行都跟随:
 * - 软折行:终端 auto-wrap,续行 isWrapped=true;
 * - 硬折行(字符级):TUI(Ink/Claude Code)自行折到终端宽度发真实换行,续行
 *   isWrapped=false 但被折首行铺满到行尾(reachesRightEdge);
 * - 硬折行(斜杠级):TUI 在 '/' 边界断长路径,被折行差几列不铺满——按
 *   hardFoldContinues 的贪婪打包不变式(续行首段放不下空隙)识别。
 */
function buildLogicalLine(buf: BufferLike, row: number): LogicalLine | null {
  let start = row;
  while (start > 0 && start > row - MAX_LOGICAL_ROWS) {
    const cur = buf.getLine(start);
    // 本行是续行(软),或上一行构成硬折行断点 → 上一行属于同一逻辑行
    if (!cur?.isWrapped && !hardFoldContinues(buf, start - 1)) break;
    start--;
  }
  let end = row;
  while (end + 1 < buf.length && end - start < MAX_LOGICAL_ROWS) {
    const next = buf.getLine(end + 1);
    // 下一行是续行(软),或本行构成硬折行断点 → 下一行属于同一逻辑行
    if (!next?.isWrapped && !hardFoldContinues(buf, end)) break;
    end++;
  }
  let text = '';
  const pos: CellPos[] = [];
  for (let y = start; y <= end; y++) {
    const line = buf.getLine(y);
    if (!line) break;
    const { text: t, cols } = lineToString(line);
    for (let i = 0; i < t.length; i++) {
      text += t[i];
      pos.push({ row: y, col: cols[i] });
    }
  }
  if (!text) return null;
  return { startRow: start, endRow: end, text, pos };
}

/** 候选区间 [start, endExcl) 按物理行切段(跨行高亮用) */
function rowSegments(
  pos: CellPos[],
  start: number,
  endExcl: number,
): { row: number; startCol: number; width: number }[] {
  const segs: { row: number; startCol: number; width: number }[] = [];
  let i = start;
  while (i < endExcl) {
    const row = pos[i].row;
    const startCol = pos[i].col;
    let endCol = startCol;
    while (i < endExcl && pos[i].row === row) {
      endCol = pos[i].col;
      i++;
    }
    segs.push({ row, startCol, width: endCol - startCol + 1 });
  }
  return segs;
}

/** 跨缩进拼接链最多段数(限 stat RPC 次数;缝隙拼接每链最多试 MAX-1 次) */
const MAX_JOIN_PARTS = 6;

/** 每条逻辑行 join 尝试的 stat 预算(REVIEW E3:拼接落空时重叠后缀链最坏
 *  O(链²) 次 stat;statCache 亦缓存 miss,此处再给确定性上限) */
const MAX_JOIN_STATS_PER_LINE = 12;

/** 续接段字符 run:与 PATH_RE 主体字符集一致 + 斜杠,可带 :行(:列) 后缀 */
const CONT_RUN_RE = /^[\w.@%+/-]+(?::\d+(?::\d+)?)?/;

/**
 * Ink/Claude Code 等 TUI 硬折行时给续行加「悬挂缩进」(前导空格,可带 gutter
 * 竖线),路径在缝隙处被截断。从上一段末尾 prevEnd 找下一物理行的续接段:
 * - 上一段之后到行尾只能是空白(候选后有杂字符 → 不续);
 * - 紧邻下一物理行行首只跳过空白/gutter(空格、│、⎿);
 * - 其后取路径字符 run(尾部标点修剪)。
 * 续接段**不要求是独立候选**(REVIEW E2:basename 内折行的续段不含斜杠,
 * 不会被 extractCandidates 收录,但仍是合法续接)。
 */
function continuationPiece(
  ll: LogicalLine,
  prevEnd: number,
): { start: number; end: number } | null {
  const r1 = ll.pos[prevEnd - 1]?.row;
  if (r1 === undefined) return null;
  let j = prevEnd;
  while (j < ll.text.length && ll.pos[j].row === r1) {
    if (ll.text[j] !== ' ') return null;
    j++;
  }
  if (j >= ll.text.length || ll.pos[j].row !== r1 + 1) return null;
  while (
    j < ll.text.length &&
    ll.pos[j].row === r1 + 1 &&
    /[ │⎿]/.test(ll.text[j])
  ) {
    j++;
  }
  if (j >= ll.text.length || ll.pos[j].row !== r1 + 1) return null;
  const m = CONT_RUN_RE.exec(ll.text.slice(j));
  if (!m) return null;
  const run = trimTrailingPunct(m[0]);
  if (!run) return null;
  return { start: j, end: j + run.length };
}

/** 逻辑行内已命中的 fs 链接(hover 与常驻高亮共用;跨缩进拼接时多段) */
export interface ResolvedFsLink {
  abs: string;
  kind: 'file' | 'dir';
  /** 各高亮段 index 区间 [start, endExcl)(拼接链接跳过缩进缝 · 单候选仅一段) */
  parts: Array<[number, number]>;
  /** 链接文本(各段拼接 · 不含缝隙字符) */
  text: string;
}

// ---- 终端 web 链接激活路由(用户指令 2026-07-14:优先内置浏览器) -------------
// 缺省落内置浏览器窗格(落到来源终端 tab · opener 由 App 启动时注册,本模块保持
// 零 store 依赖——registry↔store 不成环的纪律不破);⌘/Ctrl+点击 → 系统默认浏览器
// (逃生口);opener 未注册(测试态/极早期)→ 兜底系统浏览器,行为安全降级。
let builtinWebLinkOpener: ((terminalTabId: string, url: string) => void) | null = null;

/** App 启动时注册「在内置浏览器打开」的实现(指向 store.addBrowserTab)。 */
export function setBuiltinWebLinkOpener(
  fn: (terminalTabId: string, url: string) => void,
): void {
  builtinWebLinkOpener = fn;
}

function activateWebLink(terminalTabId: string, event: MouseEvent, uri: string): void {
  if (event.metaKey || event.ctrlKey || !builtinWebLinkOpener) {
    window.okwork.openExternal(uri);
    return;
  }
  builtinWebLinkOpener(terminalTabId, uri);
}

// OSC 8 超链接(程序用转义序列 ESC]8;;URI ST … 内嵌的可点链接)由 xterm 核心
// 自带的 OscLinkProvider 处理 —— 它注册早于本文件的 SystemWebLinkProvider,
// 优先级更高,会抢走同格链接。未给 Terminal 设 linkHandler 时,OscLinkProvider
// 的激活落到内置 defaultActivate → confirm('…could potentially be dangerous')
// + window.open()(就是用户看到的确认框)。设此 handler 把 OSC 8 链接激活也
// 路由到与纯文本链接同一条路径(内置浏览器优先),弹框被釜底抽薪。
// 不开 allowNonHttpProtocols:OscLinkProvider 仅把 http/https 交到这里(与 main
// 进程 shell:open-external 的 ^https?:// 守卫一致,双重防护)。
export function createOscLinkHandler(terminalTabId: string): ILinkHandler {
  return {
    activate: (event, uri) => {
      event.preventDefault();
      activateWebLink(terminalTabId, event, uri);
    },
  };
}

export class SystemWebLinkProvider implements ILinkProvider {
  constructor(
    private tabId: string,
    private term: Terminal,
  ) {}

  provideLinks(
    y: number,
    callback: (links: ILink[] | undefined) => void,
  ): void {
    const ll = buildLogicalLine(this.term.buffer.active, y - 1);
    if (!ll) {
      callback(undefined);
      return;
    }
    const links = extractCandidates(ll.text)
      .filter((c) => c.kind === 'web')
      .map((c): ILink | null => {
        const s = ll.pos[c.start];
        const e = ll.pos[c.end - 1];
        if (!s || !e) return null;
        return {
          range: {
            start: { x: s.col + 1, y: s.row + 1 },
            end: { x: e.col + 1, y: e.row + 1 },
          },
          text: c.text,
          decorations: { underline: true, pointerCursor: true },
          // 只 preventDefault,**绝不 stopPropagation**:链接激活由 xterm Linkifier2
          // 在 screenElement 上的 mouseup 里触发,而 SelectionService 的收尾监听挂在
          // document 上(冒泡更外层)。一旦在这里 stopPropagation,这发 mouseup 就到不了
          // document → SelectionService 的 _removeMouseDownListeners 不执行 → 它在
          // mousedown 时挂到 document 的「拖选 mousemove」永久残留(且 _handleMouseMove
          // 不校验 buttons)。点完 url 切去浏览器再切回、一动鼠标,选区就从单击点疯狂蔓延。
          // 文件链接(FsLinkProvider)从不 stopPropagation,故只有 url 会犯——根因即此。
          activate: (event, text) => {
            event.preventDefault();
            activateWebLink(this.tabId, event, text);
          },
        };
      })
      .filter((link): link is ILink => link !== null);
    callback(links.length > 0 ? links : undefined);
  }
}

export class FsLinkProvider implements ILinkProvider {
  private statCache = new Map<
    string,
    { kind: 'file' | 'dir' | null; ts: number }
  >();
  private cwdCache: { cwd: string; ts: number } | null = null;

  constructor(
    private tabId: string,
    private term: Terminal,
    private getSessionId: () => string | null,
    private getFallbackCwd: () => string,
    /** BL-004:该终端绑定的 host client(call-time 读——构造早于 spawn 绑定,A6) */
    private getClient: () => HostClient,
    /** 该终端绑定的 hostId(call-time 读,同 getClient;null/'local' = 本机) */
    private getHostId: () => string | null = () => null,
  ) {}

  provideLinks(
    y: number,
    callback: (links: ILink[] | undefined) => void,
  ): void {
    const ll = buildLogicalLine(this.term.buffer.active, y - 1);
    if (!ll) {
      callback(undefined);
      return;
    }
    const cands = extractCandidates(ll.text).filter((c) => c.kind === 'fs');
    if (cands.length === 0) {
      callback(undefined);
      return;
    }
    void this.resolve(cands, ll).then(callback, () => callback(undefined));
  }

  private async cwd(): Promise<string> {
    const now = Date.now();
    if (this.cwdCache && now - this.cwdCache.ts < CWD_CACHE_MS) {
      return this.cwdCache.cwd;
    }
    let cwd = this.getFallbackCwd();
    const sid = this.getSessionId();
    if (sid) {
      try {
        const r = await this.getClient().rpc('pty.cwd', { sessionId: sid });
        if (r.cwd) cwd = r.cwd;
      } catch {
        /* host 忙时退回 fallback */
      }
    }
    this.cwdCache = { cwd, ts: now };
    return cwd;
  }

  private async stat(p: string): Promise<'file' | 'dir' | null> {
    const now = Date.now();
    const hit = this.statCache.get(p);
    if (hit && now - hit.ts < STAT_CACHE_MS) return hit.kind;
    let kind: 'file' | 'dir' | null = null;
    try {
      kind = (await this.getClient().rpc('fs.stat', { path: p })).kind;
    } catch {
      kind = null;
    }
    this.statCache.set(p, { kind, ts: now });
    if (this.statCache.size > 500) this.statCache.clear();
    return kind;
  }

  /** 文本候选 → 绝对路径 + 类型(不存在返回 null);高亮器复用同一套缓存 */
  async resolveCandidateText(
    text: string,
  ): Promise<{ abs: string; kind: 'file' | 'dir' } | null> {
    let p: string | null = text;
    if (p.startsWith('file://')) {
      p = fileUrlToPath(p);
      if (!p) return null;
    }
    p = stripLineCol(p);
    const home = this.getClient().info?.homedir ?? '';
    if (p.startsWith('~')) p = home + p.slice(1);
    if (!p.startsWith('/')) {
      const cwd = await this.cwd();
      p = `${cwd.replace(/\/$/, '')}/${p}`;
    }
    const kind = await this.stat(p);
    return kind ? { abs: p, kind } : null;
  }

  /**
   * 解析候选,带「硬折行回退」。逻辑行可能因硬折行把若干物理行拼在一起,候选区间
   * 也可能跨行。按物理行边界生成「行对齐前缀 + 后缀」子区间,从最长到最短逐一尝试:
   * - 整段命中 → 链接跨多行(修复 TUI 折行路径只半截可点);
   * - 某行恰好铺满行尾、其后被无关行误拼进来 → 回退到前缀(下行误拼);
   * - 其前被无关满行误拼进来 → 回退到后缀(上行误拼)。
   * 只取前缀/后缀(O(R) 段),不枚举任意中段(两侧同时被无关满行夹击才需要,极罕见,
   * 不值 O(R²) 次 stat)。最长优先:若拼接后的整段本身也是真实路径,按「显示成一条
   * 高亮即视作一条」处理——点击打开的就是高亮的那条,行为自洽。
   * 返回命中信息 + 实际起止 index(用于裁剪范围 / 高亮段)。
   */
  async resolveCandidateSpanning(
    ll: LogicalLine,
    c: { start: number; end: number },
  ): Promise<{ abs: string; kind: 'file' | 'dir'; startIdx: number; endIdx: number } | null> {
    // 候选内每个物理行的起始 index
    const starts = [c.start];
    for (let i = c.start + 1; i < c.end; i++) {
      if (ll.pos[i].row !== ll.pos[i - 1].row) starts.push(i);
    }
    const ends = starts.map((_, k) => starts[k + 1] ?? c.end); // 各行结束(末行=c.end)
    const spans: Array<[number, number]> = [];
    for (const e of ends) spans.push([c.start, e]); // 前缀(含整段)
    for (let k = 1; k < starts.length; k++) spans.push([starts[k], c.end]); // 后缀(去重整段)
    spans.sort((x, y) => y[1] - y[0] - (x[1] - x[0])); // 长 → 短
    for (const [s, e] of spans) {
      const text = ll.text.slice(s, e);
      if (!text) continue;
      const hit = await this.resolveCandidateText(text);
      if (hit) return { ...hit, startIdx: s, endIdx: e };
    }
    return null;
  }

  /**
   * 跨缩进拼接(BUG-OKWORK-B260710093647-001):从候选 i 起沿「贴行尾 + 续行
   * 缩进续接段」链尽量延伸(续接段从文本派生 · 可不含斜杠 · REVIEW E2),
   * 按最长优先 stat 拼接文本(不含缝隙字符)。
   * 命中 → 合并为一条链接(返回 endIdx 供调用方吞掉链覆盖区间内的候选);
   * 落空 → null(调用方回退单候选解析,前缀目录命中仍照旧成链)。stat 是最终
   * oracle:只有拼出的完整路径真实存在才成链,无关缩进行不会误拼。
   * join 只对拼接整段做 exact 解析,不叠加 resolveCandidateSpanning 的
   * 前缀/后缀修剪(混合形态与 Ink 一致缩进的渲染相悖 · REVIEW A2)。
   */
  private async resolveJoinedAcrossIndent(
    ll: LogicalLine,
    cands: ReturnType<typeof extractCandidates>,
    i: number,
    budget: { left: number },
  ): Promise<{ link: ResolvedFsLink; endIdx: number } | null> {
    const chain: Array<[number, number]> = [[cands[i].start, cands[i].end]];
    while (chain.length < MAX_JOIN_PARTS) {
      const piece = continuationPiece(ll, chain[chain.length - 1][1]);
      if (!piece) break;
      chain.push([piece.start, piece.end]);
    }
    for (let n = chain.length; n >= 2; n--) {
      if (budget.left <= 0) return null;
      budget.left--;
      const parts = chain.slice(0, n);
      const text = parts.map(([s, e]) => ll.text.slice(s, e)).join('');
      const hit = await this.resolveCandidateText(text);
      if (hit) {
        return { link: { ...hit, parts, text }, endIdx: parts[n - 1][1] };
      }
    }
    return null;
  }

  /** 解析逻辑行内全部 fs 候选(hover 与常驻高亮共用;拼接命中的候选被吞掉) */
  async resolveFsCandidates(
    ll: LogicalLine,
    cands: ReturnType<typeof extractCandidates>,
  ): Promise<ResolvedFsLink[]> {
    const out: ResolvedFsLink[] = [];
    const budget = { left: MAX_JOIN_STATS_PER_LINE };
    for (let i = 0; i < cands.length; i++) {
      const joined = await this.resolveJoinedAcrossIndent(ll, cands, i, budget);
      if (joined) {
        out.push(joined.link);
        // 吞掉链覆盖区间内的全部候选(含派生续接段恰好也是候选的情形)
        while (i + 1 < cands.length && cands[i + 1].start < joined.endIdx) i++;
        continue;
      }
      const hit = await this.resolveCandidateSpanning(ll, cands[i]);
      if (hit) {
        out.push({
          abs: hit.abs,
          kind: hit.kind,
          parts: [[hit.startIdx, hit.endIdx]],
          text: ll.text.slice(hit.startIdx, hit.endIdx),
        });
      }
    }
    return out;
  }

  private async resolve(
    cands: ReturnType<typeof extractCandidates>,
    ll: LogicalLine,
  ): Promise<ILink[] | undefined> {
    const resolved = await this.resolveFsCandidates(ll, cands);
    const links: ILink[] = [];
    for (const r of resolved) {
      const s = ll.pos[r.parts[0][0]];
      const e = ll.pos[r.parts[r.parts.length - 1][1] - 1];
      if (!s || !e) continue;
      links.push({
        // 折行链接:范围跨物理行(x/y 均 1 基)。拼接链接的 hover 下划线由 xterm
        // 按 range 起止连画、会盖住中间缩进缝(与 VS Code 折行链接一致);常驻
        // 高亮走 parts 分段,跳过缝隙。
        range: {
          start: { x: s.col + 1, y: s.row + 1 },
          end: { x: e.col + 1, y: e.row + 1 },
        },
        text: r.text,
        decorations: { underline: true, pointerCursor: true },
        activate: () => {
          openTarget(this.tabId, r.abs, r.kind, this.getHostId());
        },
      });
    }
    return links.length > 0 ? links : undefined;
  }
}

// ---- 链接常驻高亮(蓝色):随输出/滚动扫描可视区,decoration 上色 ----

const LINK_COLOR = '#4a8df8';
const HIGHLIGHT_DEBOUNCE_MS = 200;

export class LinkHighlighter {
  private decos: { dispose(): void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;

  constructor(
    private term: Terminal,
    private provider: FsLinkProvider,
  ) {}

  attach(): void {
    this.term.onWriteParsed(() => this.schedule());
    this.term.onScroll(() => this.schedule());
    this.term.onResize(() => this.schedule());
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.scan();
    }, HIGHLIGHT_DEBOUNCE_MS);
  }

  private clear(): void {
    for (const d of this.decos) d.dispose();
    this.decos = [];
  }

  private async scan(): Promise<void> {
    const myEpoch = ++this.epoch;
    const buf = this.term.buffer.active;
    const top = buf.viewportY;
    const bottom = Math.min(top + this.term.rows, buf.length);

    interface Hit {
      row: number;
      startCol: number;
      widthCells: number;
    }
    const hits: Hit[] = [];
    const seenStarts = new Set<number>();

    for (let y = top; y < bottom; y++) {
      const ll = buildLogicalLine(buf, y);
      if (!ll) continue;
      // 该逻辑行已覆盖到 endRow,跳过其余物理行,避免每行重拼(硬折行可拼很多行)
      y = Math.max(y, ll.endRow);
      if (seenStarts.has(ll.startRow)) continue;
      seenStarts.add(ll.startRow);
      const cands = extractCandidates(ll.text);
      for (const c of cands) {
        if (c.kind !== 'web') continue;
        for (const seg of rowSegments(ll.pos, c.start, c.end)) {
          hits.push({
            row: seg.row,
            startCol: seg.startCol,
            widthCells: seg.width,
          });
        }
      }
      // fs 候选走与 hover 相同的 resolver(含跨缩进拼接 · 回退);拼接链接按
      // parts 分段高亮,缩进缝不上色
      const resolved = await this.provider.resolveFsCandidates(
        ll,
        cands.filter((c) => c.kind === 'fs'),
      );
      if (this.epoch !== myEpoch) return; // 已有新一轮扫描
      for (const r of resolved) {
        for (const [s, e] of r.parts) {
          for (const seg of rowSegments(ll.pos, s, e)) {
            hits.push({
              row: seg.row,
              startCol: seg.startCol,
              widthCells: seg.width,
            });
          }
        }
      }
    }
    if (this.epoch !== myEpoch) return;

    this.clear();
    const cursorAbs = buf.baseY + buf.cursorY;
    for (const h of hits) {
      // marker 以光标行为锚点
      const marker = this.term.registerMarker(h.row - cursorAbs);
      if (!marker) continue;
      const deco = this.term.registerDecoration({
        marker,
        x: h.startCol,
        width: h.widthCells,
        foregroundColor: LINK_COLOR,
      });
      if (deco) {
        this.decos.push({
          dispose: () => {
            deco.dispose();
            marker.dispose();
          },
        });
      } else {
        marker.dispose();
      }
    }
  }
}
