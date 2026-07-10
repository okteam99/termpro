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
} from './terminalLinkParse';

const STAT_CACHE_MS = 5_000;
const CWD_CACHE_MS = 2_500;

// 交给系统打开的扩展名(媒体/压缩包等);图片与文本进 TermPro 文件窗口
// export:权威集合单源,测试 import 校验文件分流边界(不硬编码列表)
export const SYSTEM_OPEN_EXT =
  /\.(icns|pdf|zip|gz|tgz|tar|7z|dmg|app|mp4|mov|avi|mkv|mp3|wav|flac|woff2?|ttf|otf|eot)$/i;

let locateRequestSeq = 0;

function openTargetFallback(absPath: string, kind: 'file' | 'dir'): void {
  if (kind === 'dir' || SYSTEM_OPEN_EXT.test(absPath)) {
    window.termpro.openPath(absPath);
  } else {
    window.termpro.openViewerWindow({ mode: 'file', path: absPath });
  }
}

export async function openTargetInFilePanelFirst(
  tabId: string,
  absPath: string,
  kind: 'file' | 'dir',
): Promise<void> {
  const located = await tryLocateInFilePanel(tabId, {
    id: ++locateRequestSeq,
    path: absPath,
    kind,
    sourceTabId: tabId,
  });
  if (!located) openTargetFallback(absPath, kind);
}

// 链接激活路由:目录回 File Panel 定位优先(留在工作面看上下文/git);
// 单个文件直接打开——文本/图片进 TermPro 窗口,媒体/系统扩展名走系统打开,
// 不再因落在 root/worktree 内就降级成「只定位」。
export function openTarget(
  tabId: string,
  absPath: string,
  kind: 'file' | 'dir',
): void {
  if (kind === 'dir') {
    void openTargetInFilePanelFirst(tabId, absPath, kind);
  } else {
    openTargetFallback(absPath, kind);
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
 * 两种折行都跟随:
 * - 软折行:终端 auto-wrap,续行 isWrapped=true;
 * - 硬折行:TUI(Ink/Claude Code)自行折到终端宽度发真实换行,续行 isWrapped=false
 *   但被折首行铺满到行尾(reachesRightEdge)——据此把相邻行视作续接。
 */
function buildLogicalLine(buf: BufferLike, row: number): LogicalLine | null {
  let start = row;
  while (start > 0 && start > row - MAX_LOGICAL_ROWS) {
    const cur = buf.getLine(start);
    // 本行是续行(软),或上一行铺满到行尾(硬)→ 上一行属于同一逻辑行
    if (!cur?.isWrapped && !reachesRightEdge(buf.getLine(start - 1))) break;
    start--;
  }
  let end = row;
  while (end + 1 < buf.length && end - start < MAX_LOGICAL_ROWS) {
    const next = buf.getLine(end + 1);
    // 下一行是续行(软),或本行铺满到行尾(硬)→ 下一行属于同一逻辑行
    if (!next?.isWrapped && !reachesRightEdge(buf.getLine(end))) break;
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

// OSC 8 超链接(程序用转义序列 ESC]8;;URI ST … 内嵌的可点链接)由 xterm 核心
// 自带的 OscLinkProvider 处理 —— 它注册早于本文件的 SystemWebLinkProvider,
// 优先级更高,会抢走同格链接。未给 Terminal 设 linkHandler 时,OscLinkProvider
// 的激活落到内置 defaultActivate → confirm('…could potentially be dangerous')
// + window.open()(就是用户看到的确认框)。设此 handler 把 OSC 8 链接激活也
// 路由到系统默认浏览器,与纯文本链接同一条路径,弹框被釜底抽薪。
// 不开 allowNonHttpProtocols:OscLinkProvider 仅把 http/https 交到这里(与 main
// 进程 shell:open-external 的 ^https?:// 守卫一致,双重防护)。
export function createOscLinkHandler(): ILinkHandler {
  return {
    activate: (event, uri) => {
      event.preventDefault();
      window.termpro.openExternal(uri);
    },
  };
}

export class SystemWebLinkProvider implements ILinkProvider {
  constructor(private term: Terminal) {}

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
            window.termpro.openExternal(text);
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

  private async resolve(
    cands: ReturnType<typeof extractCandidates>,
    ll: LogicalLine,
  ): Promise<ILink[] | undefined> {
    const links: ILink[] = [];
    await Promise.all(
      cands.map(async (c) => {
        const hit = await this.resolveCandidateSpanning(ll, c);
        if (!hit) return;
        const s = ll.pos[hit.startIdx];
        const e = ll.pos[hit.endIdx - 1];
        links.push({
          // 折行链接:范围跨物理行(x/y 均 1 基)
          range: {
            start: { x: s.col + 1, y: s.row + 1 },
            end: { x: e.col + 1, y: e.row + 1 },
          },
          text: ll.text.slice(hit.startIdx, hit.endIdx),
          decorations: { underline: true, pointerCursor: true },
          activate: () => {
            openTarget(this.tabId, hit.abs, hit.kind);
          },
        });
      }),
    );
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
      for (const c of extractCandidates(ll.text)) {
        let startIdx = c.start;
        let endIdx = c.end;
        if (c.kind === 'fs') {
          const hit = await this.provider.resolveCandidateSpanning(ll, c);
          if (this.epoch !== myEpoch) return; // 已有新一轮扫描
          if (!hit) continue;
          startIdx = hit.startIdx; // 硬折行回退后的实际起止
          endIdx = hit.endIdx;
        }
        for (const seg of rowSegments(ll.pos, startIdx, endIdx)) {
          hits.push({
            row: seg.row,
            startCol: seg.startCol,
            widthCells: seg.width,
          });
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
