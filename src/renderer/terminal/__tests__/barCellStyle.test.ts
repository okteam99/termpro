// @vitest-environment jsdom
// barCellStyle 单测:cell 属性 → CSS 样式纯转换。
// 端到端用真实 xterm Terminal 写转义序列,也直接构造 CellAttrs 测边界。
import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import {
  ansi256ToHex,
  resolveCellStyle,
  readCellAttrs,
  rgbToHex,
  type BarTheme,
  type CellAttrs,
} from '../barCellStyle';

// ─────────────────────────────────────────────
// 测试用 theme
// ─────────────────────────────────────────────
const THEME: BarTheme = {
  foreground: '#d7dae0',
  background: '#1e2227',
};

// ─────────────────────────────────────────────
// 辅助:写入 xterm 并返回指定 cell
// ─────────────────────────────────────────────
async function writeAndGetCell(esc: string, col: number): Promise<ReturnType<typeof readCellAttrs>> {
  const term = new Terminal({ cols: 80, rows: 5, allowProposedApi: true });
  await new Promise<void>((r) => term.write(esc, r));
  const line = term.buffer.active.getLine(0);
  const cell = line?.getCell(col);
  if (!cell) throw new Error(`getCell(${col}) 返回 undefined`);
  return readCellAttrs(cell);
}

// ─────────────────────────────────────────────
// ansi256ToHex
// ─────────────────────────────────────────────
describe('ansi256ToHex', () => {
  it('idx 16 → #000000(色立方起点)', () => {
    expect(ansi256ToHex(16)).toBe('#000000');
  });

  it('idx 231 → #ffffff(色立方终点)', () => {
    expect(ansi256ToHex(231)).toBe('#ffffff');
  });

  it('idx 232 → #080808(灰阶起点)', () => {
    expect(ansi256ToHex(232)).toBe('#080808');
  });

  it('idx 255 → #eeeeee(灰阶终点)', () => {
    expect(ansi256ToHex(255)).toBe('#eeeeee');
  });

  it('idx 0 → xterm 默认 black #2e3436', () => {
    expect(ansi256ToHex(0)).toBe('#2e3436');
  });

  it('idx 1 → xterm 默认 red #cc0000', () => {
    expect(ansi256ToHex(1)).toBe('#cc0000');
  });

  it('idx 15 → xterm 默认 bright white #eeeeec', () => {
    expect(ansi256ToHex(15)).toBe('#eeeeec');
  });

  it('色立方中间值 idx 196(r=255,g=0,b=0)→ #ff0000', () => {
    // idx=196: i=180, r=CUBE_VALS[5]=255, g=CUBE_VALS[0]=0, b=CUBE_VALS[0]=0
    expect(ansi256ToHex(196)).toBe('#ff0000');
  });

  it('色立方中间值 idx 46(r=0,g=215,b=0)→ #00d700', () => {
    // idx=46: i=30, r=CUBE_VALS[0]=0, g=CUBE_VALS[5]=255... wait: i=30,floor(30/36)=0,floor(30/6)%6=5,30%6=0
    // g=CUBE_VALS[5]=255? let me verify: 46-16=30, r=CUBE[floor(30/36)]=CUBE[0]=0, g=CUBE[floor(30/6)%6]=CUBE[5]=0xff=255? no...
    // floor(30/6)=5, 5%6=5, CUBE[5]=0xff=255. b=CUBE[30%6]=CUBE[0]=0
    // so #00ff00
    expect(ansi256ToHex(46)).toBe('#00ff00');
  });

  it('灰阶中间值 idx 244 → #808080', () => {
    // 8 + (244-232)*10 = 8 + 120 = 128 = 0x80
    expect(ansi256ToHex(244)).toBe('#808080');
  });
});

// ─────────────────────────────────────────────
// rgbToHex
// ─────────────────────────────────────────────
describe('rgbToHex', () => {
  it('0xff0000 → #ff0000', () => {
    expect(rgbToHex(0xff0000)).toBe('#ff0000');
  });

  it('补零正确:0x001234 → #001234', () => {
    expect(rgbToHex(0x001234)).toBe('#001234');
  });

  it('0x123456 → #123456', () => {
    expect(rgbToHex(0x123456)).toBe('#123456');
  });

  it('0x000000 → #000000', () => {
    expect(rgbToHex(0x000000)).toBe('#000000');
  });
});

// ─────────────────────────────────────────────
// 端到端:真实 xterm 写转义,readCellAttrs + resolveCellStyle
// ─────────────────────────────────────────────
describe('端到端:xterm buffer → CellAttrs → CellStyle', () => {
  it('\\x1b[31mX — palette 前景红色(idx=1)', async () => {
    const attrs = await writeAndGetCell('\x1b[31mX', 0);
    expect(attrs.fgMode).toBe('palette');
    expect(attrs.fg).toBe(1);
    const style = resolveCellStyle(attrs, THEME);
    expect(style.color).toBe(ansi256ToHex(1)); // '#cc0000'
  });

  it('\\x1b[1m bold', async () => {
    const attrs = await writeAndGetCell('\x1b[1mB', 0);
    expect(attrs.bold).toBe(true);
    const style = resolveCellStyle(attrs, THEME);
    expect(style.fontWeight).toBe('bold');
  });

  it('\\x1b[3m italic', async () => {
    const attrs = await writeAndGetCell('\x1b[3mI', 0);
    expect(attrs.italic).toBe(true);
    const style = resolveCellStyle(attrs, THEME);
    expect(style.fontStyle).toBe('italic');
  });

  it('\\x1b[4m underline', async () => {
    const attrs = await writeAndGetCell('\x1b[4mU', 0);
    expect(attrs.underline).toBe(true);
    const style = resolveCellStyle(attrs, THEME);
    expect(style.textDecoration).toContain('underline');
  });

  it('\\x1b[7m inverse — 交换默认前背景', async () => {
    const attrs = await writeAndGetCell('\x1b[7mV', 0);
    expect(attrs.inverse).toBe(true);
    const style = resolveCellStyle(attrs, THEME);
    // inverse: 原 fg=default→theme.foreground 变成 background;原 bg=default→theme.background 变成 color
    expect(style.color).toBe(THEME.background);
    expect(style.background).toBe(THEME.foreground);
  });

  it('\\x1b[38;2;18;52;86m 真彩(rgb)→ #123456', async () => {
    const attrs = await writeAndGetCell('\x1b[38;2;18;52;86mT', 0);
    expect(attrs.fgMode).toBe('rgb');
    const style = resolveCellStyle(attrs, THEME);
    expect(style.color).toBe('#123456');
  });

  it('\\x1b[48;5;240m 背景 palette idx=240', async () => {
    const attrs = await writeAndGetCell('\x1b[48;5;240mB', 0);
    expect(attrs.bgMode).toBe('palette');
    expect(attrs.bg).toBe(240);
    const style = resolveCellStyle(attrs, THEME);
    expect(style.background).toBe(ansi256ToHex(240));
  });
});

// ─────────────────────────────────────────────
// 直接构造 CellAttrs 测边界情况
// ─────────────────────────────────────────────

function makeAttrs(overrides: Partial<CellAttrs>): CellAttrs {
  return {
    fg: 0,
    bg: 0,
    fgMode: 'default',
    bgMode: 'default',
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    invisible: false,
    strikethrough: false,
    ...overrides,
  };
}

describe('resolveCellStyle 边界', () => {
  it('默认前景 → theme.foreground,默认背景 → background 省略', () => {
    const style = resolveCellStyle(makeAttrs({}), THEME);
    expect(style.color).toBe(THEME.foreground);
    expect(style.background).toBeUndefined();
  });

  it('dim → rgba(r,g,b,0.55)', () => {
    // palette idx=1 → #cc0000 → rgba(204,0,0,0.55)
    const style = resolveCellStyle(makeAttrs({ fgMode: 'palette', fg: 1, dim: true }), THEME);
    expect(style.color).toBe('rgba(204,0,0,0.55)');
  });

  it('invisible → transparent', () => {
    const style = resolveCellStyle(makeAttrs({ invisible: true }), THEME);
    expect(style.color).toBe('transparent');
  });

  it('underline + strikethrough → 合并 textDecoration', () => {
    const style = resolveCellStyle(makeAttrs({ underline: true, strikethrough: true }), THEME);
    expect(style.textDecoration).toBe('underline line-through');
  });

  it('strikethrough 独立 → line-through', () => {
    const style = resolveCellStyle(makeAttrs({ strikethrough: true }), THEME);
    expect(style.textDecoration).toBe('line-through');
  });

  it('inverse + dim:先 inverse 交换,再 dim 压暗最终前景', () => {
    // palette fg=7(#d3d7cf),bg=default
    // inverse: fg变background=theme.background(#1e2227),bg变fg的颜色(#d3d7cf)
    // dim: 对最终前景(#1e2227)应用 0.55 透明度 → rgba(30,34,39,0.55)
    const style = resolveCellStyle(
      makeAttrs({ fgMode: 'palette', fg: 7, inverse: true, dim: true }),
      THEME,
    );
    // theme.background = '#1e2227' → r=30,g=34,b=39
    expect(style.color).toBe('rgba(30,34,39,0.55)');
    // background = 原前景色 = ansi256ToHex(7) = '#d3d7cf'
    expect(style.background).toBe('#d3d7cf');
  });

  it('rgb 前景,inverse → color 变为原背景 theme.background', () => {
    const style = resolveCellStyle(
      makeAttrs({ fgMode: 'rgb', fg: 0x123456, inverse: true }),
      THEME,
    );
    expect(style.color).toBe(THEME.background);
    expect(style.background).toBe('#123456');
  });
});
