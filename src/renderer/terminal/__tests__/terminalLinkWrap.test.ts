// @vitest-environment jsdom
// 折行路径链接回归:
// - 软折行(终端 auto-wrap,续行 isWrapped=true)
// - 硬折行(Ink/Claude Code 等 TUI 自行折行发真实换行,续行 isWrapped=false,首行铺满行尾)
// 两者都应把跨行路径识别成一条完整链接;且回退不得误伤「恰好铺满行尾的完整路径 + 无关下一行」。
import { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../services/hostClient', () => ({
  hostClient: { rpc, info: { homedir: '/home/u' } },
}));
type Mod = typeof import('../terminalLinks');
let FsLinkProvider: Mod['FsLinkProvider'];

// 指定哪些绝对路径「存在」(stat 命中);末尾斜杠归一,模拟真实 fs
function statExisting(existing: Record<string, 'file' | 'dir'>) {
  rpc.mockImplementation(async (m: string, a: { path?: string }) => {
    if (m !== 'fs.stat') return {};
    const p = String(a.path).replace(/\/+$/, '') || '/';
    return { kind: existing[p] ?? null };
  });
}

async function provide(term: Terminal, y: number) {
  const p = new FsLinkProvider('t', term, () => null, () => '/home/u');
  return new Promise<{ text: string; range: unknown }[]>((res) =>
    p.provideLinks(y, (links) => res((links ?? []).map((l) => ({ text: l.text, range: l.range })))),
  );
}

beforeEach(async () => {
  vi.resetModules();
  rpc.mockReset();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    termpro: { openPath: vi.fn(), openViewerWindow: vi.fn(), requestHostPort: vi.fn() },
  });
  ({ FsLinkProvider } = await import('../terminalLinks'));
});

describe('wrapped path links', () => {
  it('soft wrap (auto-wrap): full path linked across both rows', async () => {
    const full = '/home/u/aaaaaaaa/bbbbbbbb/cccc/dddd/file.ts';
    statExisting({ [full]: 'file' });
    const term = new Terminal({ cols: 30, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(full, r)); // 终端自动折行
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(true); // 前提:软折行
    for (const y of [1, 2]) {
      const links = await provide(term, y);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe(full);
      expect(links[0].range).toMatchObject({ start: { y: 1 }, end: { y: 2 } });
    }
  });

  it('hard wrap (program newline, isWrapped=false): full path still linked across both rows', async () => {
    // 首行恰好 30 列铺满,续行另起(真实换行)
    const line1 = '/home/u/aaaaaaaa/bbbbbbbb/cccc'; // 30 chars
    const line2 = '/dddd/file.ts';
    const full = line1 + line2;
    expect(line1.length).toBe(30);
    statExisting({ [full]: 'file' });
    const term = new Terminal({ cols: 30, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(false); // 前提:硬折行
    for (const y of [1, 2]) {
      const links = await provide(term, y);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe(full);
      expect(links[0].range).toMatchObject({ start: { y: 1 }, end: { y: 2 } });
    }
  });

  it('no regression (downward): full-width path at edge + unrelated next line falls back to the real path', async () => {
    const line1 = '/home/u/realdir/realfile12.txt'; // 30 chars, a real file
    const line2 = 'unrelatedword and more';          // 紧贴行首、无前导空格的路径字符
    expect(line1.length).toBe(30);
    statExisting({ [line1]: 'file' }); // 只有首行那条路径存在,拼接后的不存在
    const term = new Terminal({ cols: 30, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    const links = await provide(term, 1);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe(line1); // 未被误拼进 unrelatedword
    expect(links[0].range).toMatchObject({ start: { y: 1 }, end: { y: 1 } }); // 仅首行
  });

  it('no regression (upward): a real path is not swallowed by a coincidentally full line above it', async () => {
    const above = 'Some long status line that fills up to'; // 38 chars -> pad to 38? make exactly 38
    const filler = 'x'.repeat(38 - above.length);
    const line1 = above + filler; // exactly 38, full row, ends with word char, unrelated
    const path = '/home/u/realdir/realfile.ts';
    expect(line1.length).toBe(38);
    statExisting({ [path]: 'file' }); // 只有 path 存在
    const term = new Terminal({ cols: 38, rows: 8, allowProposedApi: true });
    // line1 fills the row, then a real newline, then the path on its own line
    await new Promise<void>((r) => term.write(line1 + '\r\n' + path, r));
    // hover the path's line (row 2): must still resolve to the real path, not be eaten by line1
    const links = await provide(term, 2);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe(path);
    expect(links[0].range).toMatchObject({ start: { y: 2 }, end: { y: 2 } });
  });
});
