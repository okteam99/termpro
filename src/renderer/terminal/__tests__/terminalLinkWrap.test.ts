// @vitest-environment jsdom
// 折行路径链接回归:
// - 软折行(终端 auto-wrap,续行 isWrapped=true)
// - 硬折行(Ink/Claude Code 等 TUI 自行折行发真实换行,续行 isWrapped=false,首行铺满行尾)
// 两者都应把跨行路径识别成一条完整链接;且回退不得误伤「恰好铺满行尾的完整路径 + 无关下一行」。
import { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../../services/hostClient';

// BL-004: FsLinkProvider takes a getClient() closure instead of importing the
// hostClient singleton — inject a fake client directly (see terminalRegistry.ts).
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
const fakeClient = { rpc, info: { homedir: '/home/u' } } as unknown as HostClient;
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
  const p = new FsLinkProvider('t', term, () => null, () => '/home/u', () => fakeClient);
  return new Promise<{ text: string; range: unknown }[]>((res) =>
    p.provideLinks(y, (links) => res((links ?? []).map((l) => ({ text: l.text, range: l.range })))),
  );
}

beforeEach(async () => {
  vi.resetModules();
  rpc.mockReset();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    okwork: { openPath: vi.fn(), openViewerWindow: vi.fn(), requestHostPort: vi.fn() },
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

  // BUG-OKWORK-B260710093647-001:Ink/Claude Code 硬折行 + 续行悬挂缩进 ——
  // 路径在缩进处被切成两个候选,前缀恰为真实目录时只高亮半截。
  // 修复:跨缩进拼接(贴行尾候选 + 续行缩进候选 · stat 拼接文本 · 最长优先)。
  it('Ink hanging-indent hard wrap: full path linked across rows (beats real prefix dir)', async () => {
    const cols = 40;
    const dir = '/home/u/aif/.worktree/F1/apps/'; // 30 chars · 本身是真实目录
    const tail = 'ios/docs/features/IOS-scaffold';
    const full = dir + tail;
    const line1 = 'x'.repeat(cols - dir.length - 1) + ' ' + dir; // 行1恰好铺满
    expect(line1.length).toBe(cols);
    const line2 = '    ' + tail; // Ink 悬挂缩进 4 空格
    statExisting({ [full]: 'dir', [dir.replace(/\/$/, '')]: 'dir' });
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(false); // 前提:硬折行
    for (const y of [1, 2]) {
      const links = await provide(term, y);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe(full); // 最长优先:整条压过前缀目录
      expect(links[0].range).toMatchObject({
        start: { x: 11, y: 1 },
        end: { x: 4 + tail.length, y: 2 },
      });
    }
  });

  it('hanging indent with unrelated continuation: falls back to the real prefix dir only', async () => {
    const cols = 40;
    const dir = '/home/u/aif/.worktree/F1/apps/';
    const line1 = 'x'.repeat(cols - dir.length - 1) + ' ' + dir;
    const line2 = '    unrelated/words here'; // 缩进后是无关相对路径 · 拼接 stat 落空
    statExisting({ [dir.replace(/\/$/, '')]: 'dir' });
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    const links = await provide(term, 1);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe(dir); // 不误拼 · 前缀目录照旧成链
    expect(links[0].range).toMatchObject({ start: { y: 1 }, end: { y: 1 } });
  });

  // REVIEW Q2:gutter 白名单(│/⎿)真被执行 · 且 gutter 字符不得混入链接 text
  it('gutter chars (│/⎿) in the gap: join still works, gutter stays out of link text', async () => {
    const cols = 40;
    const dir = '/home/u/aif/.worktree/F1/apps/';
    const tail = 'ios/docs/features/IOS-scaffold';
    const full = dir + tail;
    const line1 = 'x'.repeat(cols - dir.length - 1) + ' ' + dir;
    const line2 = '│ ⎿ ' + tail; // 两个 gutter 字符一起钉住白名单字符集
    statExisting({ [full]: 'dir' });
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    const links = await provide(term, 1);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe(full); // 不含 │/⎿/空格
    expect(links[0].range).toMatchObject({
      start: { x: 11, y: 1 },
      end: { x: 4 + tail.length, y: 2 },
    });
  });

  // REVIEW Q3:候选贴行尾判定的镜像分支 —— 候选后同行还有杂字符(tail 非空白)
  // 时不得跨行拼接(即便拼接路径真实存在 · 决定性断言)
  it('non-blank char between candidate and row edge: no join even if joined path exists', async () => {
    const cols = 40;
    const dir = '/home/u/aif/.worktree/F1/apps'; // 29 chars · 无尾斜杠
    const tail = 'ios/docs/thing';
    const line1 = 'x'.repeat(cols - dir.length - 2) + ' ' + dir + ')'; // ')' 铺满行尾
    expect(line1.length).toBe(cols);
    const line2 = '    ' + tail;
    statExisting({ [dir]: 'dir', [dir + tail]: 'dir' }); // 拼接路径也存在 · 仍不该拼
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    const links = await provide(term, 1);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe(dir); // tail 守卫生效 · 只有前缀成链
    expect(links[0].range).toMatchObject({ start: { y: 1 }, end: { y: 1 } });
  });

  // REVIEW E2:basename 内折行 —— 续段不含斜杠 · 不构成独立候选 · 仍须拼接
  it('continuation without slash (wrap inside basename): still joined', async () => {
    const cols = 40;
    const dir = '/home/u/aif/.worktree/F1/apps/';
    const tail = 'IOS-scaffold'; // 无斜杠
    const full = dir + tail;
    const line1 = 'x'.repeat(cols - dir.length - 1) + ' ' + dir;
    const line2 = '    ' + tail;
    statExisting({ [full]: 'dir', [dir.replace(/\/$/, '')]: 'dir' });
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    for (const y of [1, 2]) {
      const links = await provide(term, y);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe(full); // 整条压过真实前缀目录
      expect(links[0].range).toMatchObject({
        start: { x: 11, y: 1 },
        end: { x: 4 + tail.length, y: 2 },
      });
    }
  });

  // REVIEW E2 配套:无斜杠续段带尾随标点(引号等) · 修剪后拼接
  it('slash-less continuation with trailing punct: punct trimmed from joined text', async () => {
    const cols = 40;
    const dir = '/home/u/aif/.worktree/F1/apps/';
    const tail = 'IOS-scaffold';
    const full = dir + tail;
    const line1 = 'x'.repeat(cols - dir.length - 1) + ' ' + dir;
    const line2 = "    IOS-scaffold' --label ok"; // 尾引号来自 shell 引参
    statExisting({ [full]: 'dir' });
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    const links = await provide(term, 1);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe(full); // 引号不入链接
    expect(links[0].range).toMatchObject({
      start: { x: 11, y: 1 },
      end: { x: 4 + tail.length, y: 2 },
    });
  });

  it('3-row chain with indent on each continuation: single link spans all rows', async () => {
    const cols = 30;
    const c1 = '/home/u/wrap3/aaaaaaaa/bb'; // 25 chars
    const c2 = 'cccccccc/dddddddd/eeeeeeee/f'; // 28 chars · 行2 恰好铺满
    const c3 = 'gg/hh.ts';
    const full = c1 + c2 + c3;
    const line1 = 'y'.repeat(cols - c1.length - 1) + ' ' + c1;
    const line2 = '  ' + c2;
    const line3 = '  ' + c3;
    expect(line1.length).toBe(cols);
    expect(line2.length).toBe(cols);
    statExisting({ [full]: 'file' });
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2 + '\r\n' + line3, r));
    for (const y of [1, 2, 3]) {
      const links = await provide(term, y);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe(full);
      expect(links[0].range).toMatchObject({
        start: { x: 6, y: 1 },
        end: { x: 2 + c3.length, y: 3 },
      });
    }
  });

  // 斜杠级硬折行(Claude Code 真实形状):TUI 在 '/' 边界断长路径,被折行差几列
  // 不铺满(reachesRightEdge 恒 false)——按贪婪打包不变式(续行首段放不下空隙)
  // 识别为同一逻辑行,3 行拼成一条链接。
  it('slash-boundary hard wrap (rows end short of edge): 3-row path joined into one link', async () => {
    const cols = 40;
    const p1 = '/Users/liam/';
    const p2 = 'apps/okok/supersdk/.worktree/F1/dd/';
    const p3 = 'CW-App-Settings';
    const full = p1 + p2 + p3;
    const line1 = 'x'.repeat(24) + ' ' + p1; // 37 列 · gap=3 < 续行首段 apps/(5)
    const line2 = '  ' + p2; // 37 列 · gap=3 < 续行首段 CW-App-Settings(15)
    const line3 = '  ' + p3;
    expect(line1.length).toBe(37);
    expect(line2.length).toBe(37);
    statExisting({ [full]: 'dir', '/Users/liam': 'dir' }); // 前缀也真实存在,整条须压过
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2 + '\r\n' + line3, r));
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(false);
    for (const y of [1, 2, 3]) {
      const links = await provide(term, y);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe(full);
      expect(links[0].range).toMatchObject({
        start: { x: 26, y: 1 },
        end: { x: 2 + p3.length, y: 3 },
      });
    }
  });

  // 贪婪打包不变式的反面:行尾虽以 '/' 收尾但空隙塞得下续行首段 → 不是折行,
  // 是两行独立内容(目录列表同级条目)——即便拼接路径真实存在也不得误拼。
  it('short dir entry ending with slash + indented sibling: NOT merged even if joined path exists', async () => {
    const cols = 40;
    const line1 = '  docs/features/'; // gap=24 ≥ 续行首段 CW-Settings(11)→ 非折行
    const line2 = '  CW-Settings';
    statExisting({
      '/home/u/docs/features': 'dir',
      '/home/u/docs/features/CW-Settings': 'dir', // 拼接路径存在 · 仍不该拼
    });
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    const links = await provide(term, 1);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('docs/features/');
    expect(links[0].range).toMatchObject({ start: { y: 1 }, end: { y: 1 } });
  });

  // 2026-07-20 事故:codex 的 markdown 渲染按自身固定阅读宽度折行,与实际 pty
  // 列数无关(远窄于 200 列的宽终端)——断点落在连字符处,既不铺满行尾也不以 '/'
  // 收尾,前两种硬折行探测(reachesRightEdge / trailingSlashGap)都测不到,relative
  // 路径链接因此不可点。第三种探测(悬挂缩进续接)补上这个洞。
  it('codex-style narrow content-wrap (well short of wide pty, breaks mid-hyphen): still joined', async () => {
    const prefix = '- 方案: ';
    const relPath =
      '.worktree/INFRA-F260720081517-Static-Offerwall-Staging-Env-Release-Config/TECH.md';
    const wrapAt = 60; // codex 自己的阅读宽度,远窄于下方 200 列的 pty
    const avail = wrapAt - prefix.length;
    const line1 = prefix + relPath.slice(0, avail); // 远不到 200 列行尾,断在连字符
    const line2 = ' '.repeat(prefix.length) + relPath.slice(avail); // 悬挂缩进对齐
    const full = '/home/u' + '/' + relPath;
    statExisting({ [full]: 'file' });
    const term = new Terminal({ cols: 200, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    expect(line1.length).toBeLessThan(200); // 前提:远未铺满
    expect(line1.endsWith('/')).toBe(false); // 前提:不是斜杠折行
    for (const y of [1, 2]) {
      const links = await provide(term, y);
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe(relPath);
    }
  });

  it('codex-style narrow wrap: unrelated indented next line does not get merged (stat still gates)', async () => {
    const line1 = '- plan: .worktree/real-project/TECH.md'; // 真实存在,远不到 200 列
    const line2 = '        totally unrelated prose continues here'; // 悬挂缩进但非路径续接
    statExisting({ '/home/u/.worktree/real-project/TECH.md': 'file' });
    const term = new Terminal({ cols: 200, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    const links = await provide(term, 1);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('.worktree/real-project/TECH.md'); // 未被无关续行拼坏
    expect(links[0].range).toMatchObject({ start: { y: 1 }, end: { y: 1 } });
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
