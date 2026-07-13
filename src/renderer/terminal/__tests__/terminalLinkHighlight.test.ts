// @vitest-environment jsdom
// LinkHighlighter 常驻高亮回归(REVIEW Q1 · BUG-OKWORK-B260710093647-001):
// 跨缩进拼接的链接按 parts 分段上色 —— decoration 恰好覆盖两个候选段,
// 缩进缝(续行行首空白)不上色。spy registerDecoration 记录 x/width/行,
// 不依赖真实渲染上下文(marker 用真实 registerMarker · 行号取 marker.line)。
import { Terminal } from '@xterm/xterm';
import type { IDecoration, IDecorationOptions } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../../services/hostClient';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
const fakeClient = { rpc, info: { homedir: '/home/u' } } as unknown as HostClient;
type Mod = typeof import('../terminalLinks');
let FsLinkProvider: Mod['FsLinkProvider'];
let LinkHighlighter: Mod['LinkHighlighter'];

function statExisting(existing: Record<string, 'file' | 'dir'>) {
  rpc.mockImplementation(async (m: string, a: { path?: string }) => {
    if (m !== 'fs.stat') return {};
    const p = String(a.path).replace(/\/+$/, '') || '/';
    return { kind: existing[p] ?? null };
  });
}

beforeEach(async () => {
  vi.resetModules();
  rpc.mockReset();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    okwork: { openPath: vi.fn(), openViewerWindow: vi.fn(), requestHostPort: vi.fn() },
  });
  ({ FsLinkProvider, LinkHighlighter } = await import('../terminalLinks'));
});

describe('LinkHighlighter joined-link segments', () => {
  it('decorations cover exactly the two candidate segments, not the indent gap', async () => {
    const cols = 40;
    const dir = '/home/u/aif/.worktree/F1/apps/'; // 30 chars · 行1 col 10-39
    const tail = 'ios/docs/features/IOS-scaffold'; // 30 chars · 行2 col 4-33
    const full = dir + tail;
    const line1 = 'x'.repeat(cols - dir.length - 1) + ' ' + dir;
    const line2 = '    ' + tail;
    statExisting({ [full]: 'dir' });
    const term = new Terminal({ cols, rows: 8, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));

    const provider = new FsLinkProvider('t', term, () => null, () => '/home/u', () => fakeClient);
    const hl = new LinkHighlighter(term, provider);
    const decos: { row: number; x: number; width: number }[] = [];
    vi.spyOn(term, 'registerDecoration').mockImplementation(
      (opts: IDecorationOptions): IDecoration => {
        decos.push({
          row: opts.marker.line,
          x: (opts.x as number) ?? 0,
          width: (opts.width as number) ?? 1,
        });
        return { dispose: vi.fn() } as unknown as IDecoration;
      },
    );
    // 直接驱动一轮扫描(绕过 200ms debounce · scan 为私有,测试驱动入口)
    await (hl as unknown as { scan(): Promise<void> }).scan();

    decos.sort((a, b) => a.row - b.row || a.x - b.x);
    // 恰好两段:行1 候选段 + 行2 候选段;缩进缝(行2 col 0-3)无 decoration
    expect(decos).toEqual([
      { row: 0, x: 10, width: dir.length },
      { row: 1, x: 4, width: tail.length },
    ]);
  });
});
