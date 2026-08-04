// 底部输入栏「固定(pin)」:Codex / Claude Code 等 TUI 内联渲染在主屏缓冲区,
// 输入栏只是「最近打印的几行」,无任何标记。用户向上滚 scrollback 时整个视口上移,
// 输入栏随之消失。本模块在「滚离底部」时,把 live 屏幕区域底部(启发式识别的输入栏块)
// 实时镜像成一块不透明 DOM 面板,贴在视口底部 —— 滚上去读历史时输入栏仍可见可输入。
//
// 关键约束:
// - 内容来自 buffer 的 live 区域(baseY..baseY+rows-1),无论滚动位置该区域始终被 TUI 重绘,
//   故面板能实时反映「正在输入的内容」。
// - 仅 normal buffer 生效;alt-screen(vim/less/htop)无 scrollback,强制隐藏。
// - 纯展示层(pointer-events:none),键盘输入照常由 term.onData 转发 PTY,无需路由。

import type { IBufferLine, Terminal } from '@xterm/xterm';
import {
  type BarTheme,
  type CellStyle,
  readCellAttrs,
  resolveCellStyle,
} from './barCellStyle';
import { t } from '../../shared/i18n';

/** 默认前景/背景/光标兜底(与 terminalRegistry 主题一致) */
const FALLBACK_FG = '#e8e6e3';
const FALLBACK_BG = '#1b1b1b';
const FALLBACK_CURSOR = '#f49a55';
/** 面板顶部留白:与上方橙色分隔线、下方内容拉开间距 */
const PANEL_PAD_TOP = 6;

/** 至少固定的行数(输入栏 + 状态行的最小高度) */
const MIN_ROWS = 4;
/** 最多固定的行数(防止多行输入/异常把面板撑满半屏) */
const MAX_ROWS = 12;
/** 光标行之上额外纳入的行数(覆盖输入框上边框 / 多行输入) */
const PAD_ABOVE_CURSOR = 3;

export interface RegionInput {
  /** buffer.active.baseY:live 屏幕区域首行的绝对行号 */
  baseY: number;
  /** buffer.active.cursorY:光标相对 baseY 的行偏移 */
  cursorY: number;
  /** terminal.rows:可视行数 */
  rows: number;
  /** buffer.active.viewportY:当前视口顶部的绝对行号 */
  viewportY: number;
}

export interface BarRegion {
  /** 固定区首行绝对行号(含) */
  top: number;
  /** 固定区末行绝对行号(含)= live 区域底部 */
  bottom: number;
}

/**
 * 启发式计算「输入栏」绝对行区间。返回 null 表示不该显示(已在底部)。
 * 锚定光标:输入框总含光标,故从「光标上方 PAD 行」与「底部至少 MIN 行」取更靠上者,
 * 这样多行输入时面板自动长高;再以 MAX 行封顶、不越过 live 区域上沿。
 */
export function computeBarRegion(inp: RegionInput): BarRegion | null {
  // 在底部(或内容不足一屏)→ 输入栏本就可见,无需固定
  if (inp.viewportY >= inp.baseY) return null;

  const liveTop = inp.baseY;
  const liveBottom = inp.baseY + inp.rows - 1;
  const cursorAbs = inp.baseY + inp.cursorY;

  let top = Math.min(liveBottom - (MIN_ROWS - 1), cursorAbs - PAD_ABOVE_CURSOR);
  top = Math.max(top, liveBottom - (MAX_ROWS - 1)); // 封顶高度
  top = Math.max(top, liveTop); // 不越过 live 区域上沿
  if (top > liveBottom) return null;
  return { top, bottom: liveBottom };
}

/**
 * 把一行 buffer 逐格渲染进 rowEl。每格用 inline-block + 固定宽度(cell 宽 × 占格数)
 * 保证列对齐,不依赖字体 advance(CJK 宽字符按 getWidth()=2 占两格)。
 * 配色经 barCellStyle 解析,与 xterm 默认调色板一致(前景/背景/粗斜体/下划线/反显/dim)。
 */
interface RenderCell {
  chars: string;
  /** 占格数(CJK 宽字符=2) */
  width: number;
  style: CellStyle;
}

/** 一行 buffer → 渲染中间模型(读 cell + 解析样式,不碰 DOM)。用于脏检查与建 DOM 复用。 */
function buildRowCells(line: IBufferLine, theme: BarTheme): RenderCell[] {
  const cells: RenderCell[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    const w = cell.getWidth();
    if (w === 0) continue; // 宽字符尾随占位格
    cells.push({
      chars: cell.getChars() || ' ',
      width: w,
      style: resolveCellStyle(readCellAttrs(cell), theme),
    });
  }
  return cells;
}

/** 光标描述:滚离底部时真光标在视口外,面板内自绘一个块光标 */
interface CursorInfo {
  /** 光标所在列(该行无光标为 -1) */
  col: number;
  /** 光标块颜色 */
  color: string;
  /** 光标块上字符颜色(反显用面板底色) */
  textColor: string;
}

/** 渲染中间模型 → 一个 row div(每格 inline-block 定宽保证列对齐) */
function rowToDom(
  cells: RenderCell[],
  cellW: number,
  cellH: number,
  cursor: CursorInfo,
): HTMLDivElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'term-bar-pin-row';
  rowEl.style.height = `${cellH}px`;
  rowEl.style.lineHeight = `${cellH}px`;
  let col = 0;
  for (const c of cells) {
    const span = document.createElement('span');
    span.textContent = c.chars;
    span.style.display = 'inline-block';
    span.style.width = `${c.width * cellW}px`;
    const s = c.style;
    if (s.color) span.style.color = s.color;
    if (s.background) span.style.background = s.background;
    if (s.fontWeight) span.style.fontWeight = s.fontWeight;
    if (s.fontStyle) span.style.fontStyle = s.fontStyle;
    if (s.textDecoration) span.style.textDecoration = s.textDecoration;
    // 块光标:反显该格(背景=光标色,文字=面板底色),CSS 负责闪烁
    if (cursor.col >= 0 && col === cursor.col) {
      span.classList.add('term-bar-pin-cursor');
      span.style.background = cursor.color;
      span.style.color = cursor.textColor;
    }
    rowEl.appendChild(span);
    col += c.width;
  }
  return rowEl;
}

/** 内容+几何指纹:用于跳过未变帧的全量 DOM 重建(流式输出时输入栏多半不变) */
function signature(
  rows: RenderCell[][],
  cellW: number,
  cellH: number,
  top: number,
  bottom: number,
  cursorKey: string,
): string {
  const parts: string[] = [
    `${top}|${bottom}|${cellW.toFixed(3)}|${cellH.toFixed(3)}|${cursorKey}`,
  ];
  for (const row of rows) {
    for (const c of row) {
      const s = c.style;
      parts.push(
        `${c.chars}${c.width}${s.color ?? ''}${s.background ?? ''}` +
          `${s.fontWeight ?? ''}${s.fontStyle ?? ''}${s.textDecoration ?? ''}`,
      );
    }
    parts.push('');
  }
  return parts.join('');
}

/** 整行是否「空」:无可见字符且无非默认背景(纯色分隔条不算空,避免误裁) */
function isRowBlank(line: IBufferLine | undefined): boolean {
  if (!line) return true;
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    const ch = cell.getChars();
    if (ch && ch !== ' ') return false;
    if (!cell.isBgDefault()) return false;
  }
  return true;
}

export class BottomBarPin {
  private root: HTMLDivElement | null = null;
  private pill: HTMLButtonElement | null = null;
  private disposables: { dispose(): void }[] = [];
  private raf = 0;
  private mounted = false;
  /** 设置开关:关闭则永不显示面板(配合 scrollOnUserInput 恢复默认) */
  private enabled = true;
  /** 上次渲染的内容+几何指纹;隐藏时清空,确保再次显示必重建 */
  private lastSig = '';

  constructor(private term: Terminal) {}

  /** 设置变更:开关固定面板。关闭立即隐藏,开启重新评估。 */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) this.schedule();
    else this.hide();
  }

  /** term.open() 之后调用:在 .xterm 内建面板并挂事件。幂等。 */
  mount(): void {
    if (this.mounted) return;
    const el = this.term.element;
    if (!el) return;
    const root = document.createElement('div');
    root.className = 'term-bar-pin';
    root.style.display = 'none';
    // 作为 .xterm 子节点:切 tab 时 .xterm 整体搬运,面板自动跟随,无需重挂
    el.appendChild(root);
    this.root = root;

    // 「回到底部」胶囊:关掉 scrollOnUserInput 后给个明确回底入口。
    // 单独挂(不进 root,因 root overflow:hidden 会裁掉浮在其上方的胶囊)。
    const pill = document.createElement('button');
    pill.className = 'term-bar-pin-jump';
    pill.type = 'button';
    pill.textContent = t('↓ Back to bottom');
    pill.style.display = 'none';
    pill.addEventListener('click', () => {
      this.term.scrollToBottom();
      this.term.focus();
    });
    el.appendChild(pill);
    this.pill = pill;
    this.mounted = true;

    this.disposables.push(this.term.onScroll(() => this.schedule()));
    this.disposables.push(this.term.onRender(() => this.schedule()));
    this.disposables.push(this.term.onResize(() => this.schedule()));
    this.schedule();
  }

  /** 外部触发重渲染(如 DPR 变化致 cell 尺寸改变但行列数未变、不发 onResize 时) */
  refresh(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private hide(): void {
    if (this.root) this.root.style.display = 'none';
    if (this.pill) this.pill.style.display = 'none';
    this.lastSig = '';
  }

  private render(): void {
    const root = this.root;
    const el = this.term.element;
    if (!root || !el) return;
    if (!this.enabled) return this.hide();

    const buf = this.term.buffer.active;
    // alt-screen 无 scrollback,固定无意义
    if (buf.type === 'alternate') return this.hide();

    const region = computeBarRegion({
      baseY: buf.baseY,
      cursorY: buf.cursorY,
      rows: this.term.rows,
      viewportY: buf.viewportY,
    });
    if (!region) return this.hide();

    const screen = el.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen || !screen.clientHeight || !screen.clientWidth) return this.hide();
    const cellW = screen.clientWidth / this.term.cols;
    const cellH = screen.clientHeight / this.term.rows;
    const themeOpt = this.term.options.theme;
    const theme: BarTheme = {
      foreground: themeOpt?.foreground ?? FALLBACK_FG,
      background: themeOpt?.background ?? FALLBACK_BG,
    };
    const cursorColor = themeOpt?.cursor ?? FALLBACK_CURSOR;

    // 裁掉底部全空行,使面板贴合实际输入栏内容(否则下方浮一截空白像 bug)
    let bottom = region.bottom;
    while (bottom >= region.top && isRowBlank(buf.getLine(bottom))) bottom--;
    if (bottom < region.top) return this.hide(); // 整块皆空

    // 光标:滚离底部时真光标在视口外,面板内自绘块光标。仅 normal buffer、光标在区间内且终端聚焦时显示。
    const cursorAbs = buf.baseY + buf.cursorY;
    const showCursor =
      cursorAbs >= region.top &&
      cursorAbs <= bottom &&
      el.contains(document.activeElement);
    const cursorX = buf.cursorX;

    // 建中间模型 + 指纹;内容/几何/光标都未变则跳过全量 DOM 重建(流式输出时输入栏多半不变)
    const rows: RenderCell[][] = [];
    for (let y = region.top; y <= bottom; y++) {
      const line = buf.getLine(y);
      rows.push(line ? buildRowCells(line, theme) : []);
    }
    const cursorKey = showCursor ? `${cursorAbs}:${cursorX}` : '';
    const sig = signature(rows, cellW, cellH, region.top, bottom, cursorKey);
    if (sig === this.lastSig && root.style.display === 'block') return;
    this.lastSig = sig;

    const frag = document.createDocumentFragment();
    rows.forEach((cells, i) => {
      const y = region.top + i;
      const cursor: CursorInfo = {
        col: showCursor && y === cursorAbs ? cursorX : -1,
        color: cursorColor,
        textColor: theme.background,
      };
      frag.appendChild(rowToDom(cells, cellW, cellH, cursor));
    });
    root.replaceChildren(frag);

    root.style.left = `${screen.offsetLeft}px`;
    root.style.width = `${screen.clientWidth}px`;
    root.style.paddingTop = `${PANEL_PAD_TOP}px`;
    root.style.fontFamily = String(this.term.options.fontFamily ?? '');
    root.style.fontSize = `${this.term.options.fontSize ?? 13}px`;
    root.style.display = 'block';

    // 回底胶囊:浮在面板右上角之上(含面板顶部留白)
    const pill = this.pill;
    if (pill) {
      const panelHeight = (bottom - region.top + 1) * cellH + PANEL_PAD_TOP;
      const scrollbarRight = el.clientWidth - (screen.offsetLeft + screen.clientWidth);
      pill.style.bottom = `${panelHeight + 6}px`;
      pill.style.right = `${Math.max(scrollbarRight, 0) + 12}px`;
      pill.style.display = 'block';
    }
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root?.remove();
    this.root = null;
    this.pill?.remove();
    this.pill = null;
    this.mounted = false;
  }
}
