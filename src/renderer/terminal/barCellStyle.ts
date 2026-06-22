// barCellStyle.ts — xterm buffer cell → CSS 样式纯转换模块
// 不碰 DOM,只做属性解析。
import type { IBufferCell } from '@xterm/xterm';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type ColorMode = 'default' | 'palette' | 'rgb';

export interface CellAttrs {
  fg: number;        // palette=0..255;rgb=0xRRGGBB
  bg: number;
  fgMode: ColorMode;
  bgMode: ColorMode;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  invisible: boolean;
  strikethrough: boolean;
}

export interface BarTheme {
  foreground: string; // 默认前景,如 '#d7dae0'
  background: string; // 默认背景,如 '#1e2227'
}

export interface CellStyle {
  color?: string;          // 前景色
  background?: string;     // 非默认背景时才给出
  fontWeight?: string;     // 'bold' 或省略
  fontStyle?: string;      // 'italic' 或省略
  textDecoration?: string; // 'underline' / 'line-through' / 两者合并
}

// ─────────────────────────────────────────────
// ANSI 16 色调色板(精确值来自 xterm 源码)
// 来源:node_modules/@xterm/xterm/src/browser/Types.ts 第 182-201 行
// DEFAULT_ANSI_COLORS IIFE 中的 dark + bright 列表
// ─────────────────────────────────────────────
const ANSI_16: readonly string[] = [
  // dark (0-7)
  '#2e3436', // 0  black
  '#cc0000', // 1  red
  '#4e9a06', // 2  green
  '#c4a000', // 3  yellow
  '#3465a4', // 4  blue
  '#75507b', // 5  magenta
  '#06989a', // 6  cyan
  '#d3d7cf', // 7  white
  // bright (8-15)
  '#555753', // 8  bright black
  '#ef2929', // 9  bright red
  '#8ae234', // 10 bright green
  '#fce94f', // 11 bright yellow
  '#729fcf', // 12 bright blue
  '#ad7fa8', // 13 bright magenta
  '#34e2e2', // 14 bright cyan
  '#eeeeec', // 15 bright white
];

// 256 色立方分量值表(来自 xterm Types.ts 第 205 行)
const CUBE_VALS: readonly number[] = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

// ─────────────────────────────────────────────
// 辅助:数字转两位十六进制
// ─────────────────────────────────────────────
function byte2hex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

// ─────────────────────────────────────────────
// 辅助:十六进制色 '#rrggbb' → rgba 字符串
// ─────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────

/** xterm 256 色索引 → '#rrggbb'(0..15 用 xterm 默认 ANSI 调色板) */
export function ansi256ToHex(idx: number): string {
  if (idx < 0 || idx > 255) throw new RangeError(`ansi256ToHex: 索引越界 ${idx}`);
  if (idx < 16) return ANSI_16[idx];
  if (idx < 232) {
    // 6×6×6 色立方,索引从 16 开始
    const i = idx - 16;
    const r = CUBE_VALS[Math.floor(i / 36) % 6];
    const g = CUBE_VALS[Math.floor(i / 6) % 6];
    const b = CUBE_VALS[i % 6];
    return `#${byte2hex(r)}${byte2hex(g)}${byte2hex(b)}`;
  }
  // 灰阶 232..255
  const c = 8 + (idx - 232) * 10;
  return `#${byte2hex(c)}${byte2hex(c)}${byte2hex(c)}`;
}

/** 0xRRGGBB → '#rrggbb' */
export function rgbToHex(v: number): string {
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `#${byte2hex(r)}${byte2hex(g)}${byte2hex(b)}`;
}

/** 读取 xterm IBufferCell → CellAttrs(适配 xterm v6 proposed API) */
export function readCellAttrs(cell: IBufferCell): CellAttrs {
  // 前景颜色模式
  let fgMode: ColorMode = 'default';
  if (cell.isFgRGB()) fgMode = 'rgb';
  else if (cell.isFgPalette()) fgMode = 'palette';

  // 背景颜色模式
  let bgMode: ColorMode = 'default';
  if (cell.isBgRGB()) bgMode = 'rgb';
  else if (cell.isBgPalette()) bgMode = 'palette';

  return {
    fg: cell.getFgColor(),
    bg: cell.getBgColor(),
    fgMode,
    bgMode,
    bold: !!cell.isBold(),
    dim: !!cell.isDim(),
    italic: !!cell.isItalic(),
    underline: !!cell.isUnderline(),
    inverse: !!cell.isInverse(),
    invisible: !!cell.isInvisible(),
    strikethrough: !!cell.isStrikethrough(),
  };
}

// ─────────────────────────────────────────────
// 内部:颜色模式 → 实际十六进制色
// ─────────────────────────────────────────────
function resolveColor(value: number, mode: ColorMode, defaultColor: string): string {
  if (mode === 'default') return defaultColor;
  if (mode === 'palette') return ansi256ToHex(value);
  return rgbToHex(value);
}

/** 解析 CellAttrs → CSS 样式 */
export function resolveCellStyle(attrs: CellAttrs, theme: BarTheme): CellStyle {
  const style: CellStyle = {};

  // ── 1. 先解析出真实颜色(inverse 交换前) ──
  let fgHex = resolveColor(attrs.fg, attrs.fgMode, theme.foreground);
  let bgHex: string | undefined =
    attrs.bgMode === 'default' ? undefined : resolveColor(attrs.bg, attrs.bgMode, theme.background);

  // ── 2. inverse:交换前背景色落地成 theme,再互换 ──
  if (attrs.inverse) {
    const resolvedBg = bgHex ?? theme.background;
    bgHex = fgHex;
    fgHex = resolvedBg;
  }

  // ── 3. invisible → transparent,覆盖前景 ──
  if (attrs.invisible) {
    style.color = 'transparent';
  } else {
    // ── 4. dim → 前景降透明度 ──
    if (attrs.dim) {
      style.color = hexToRgba(fgHex, 0.55);
    } else {
      style.color = fgHex;
    }
  }

  // 背景:inverse 后 bgHex 一定有值;原始 default bg 为 undefined(让面板底色透出)
  if (bgHex !== undefined) {
    style.background = bgHex;
  }

  // ── 5. 字重 ──
  if (attrs.bold) style.fontWeight = 'bold';

  // ── 6. 斜体 ──
  if (attrs.italic) style.fontStyle = 'italic';

  // ── 7. 文字装饰 ──
  const decos: string[] = [];
  if (attrs.underline) decos.push('underline');
  if (attrs.strikethrough) decos.push('line-through');
  if (decos.length > 0) style.textDecoration = decos.join(' ');

  return style;
}
