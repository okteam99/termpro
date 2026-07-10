// @vitest-environment jsdom
// api-e2e(Bug 回归 · BUG-TERMPRO-B260710093647-001):复跑触发 bug 的关键路径。
// 与单测的差异:**不打桩存在性** —— 在真实磁盘建截图同构目录树,fs.stat 走真实
// node:fs;终端文本逐字节复刻截图形态(Ink 硬折行 · 折行点在 apps/ 之后 · 续行
// 悬挂缩进 · 续段后跟 CJK label)。断言整条路径成链 + 点击打开的就是真实目录。
import { Terminal } from '@xterm/xterm';
import type { ILink } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HostClient } from '../../../../src/renderer/services/hostClient';

type Mod = typeof import('../../../../src/renderer/terminal/terminalLinks');
let FsLinkProvider: Mod['FsLinkProvider'];

let tmp: string;
const openPath = vi.fn();

// e2e host client:fs.stat 直连真实磁盘(host 侧同语义:kind = dir|file|null)
const realFsClient = {
  info: { homedir: os.homedir() },
  rpc: async (m: string, a: { path?: string }) => {
    if (m === 'fs.stat') {
      try {
        const st = await fs.promises.stat(String(a.path));
        return { kind: st.isDirectory() ? 'dir' : 'file' };
      } catch {
        return { kind: null };
      }
    }
    if (m === 'pty.cwd') return { cwd: tmp };
    return {};
  },
} as unknown as HostClient;

beforeEach(async () => {
  vi.resetModules();
  openPath.mockReset();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    termpro: { openPath, openViewerWindow: vi.fn(), requestHostPort: vi.fn() },
  });
  ({ FsLinkProvider } = await import('../../../../src/renderer/terminal/terminalLinks'));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-e2e-wrap-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('E2E · 截图场景回归(真实磁盘)', () => {
  it('Ink 折行命令中的长路径:整条成链 · 点击打开真实目标目录', async () => {
    // 真实目录树(镜像截图):<tmp>/.worktree/IOS-F001/apps/ios/docs/features/…
    const part1 = `${tmp}/.worktree/IOS-F001/apps/`;
    const part2 = 'ios/docs/features/IOS-F001-project-scaffold';
    const full = part1 + part2;
    fs.mkdirSync(full, { recursive: true });

    // 行 1 恰好铺满(Ink 在终端宽度处硬折行);行 2 悬挂缩进 + 续段 + CJK label
    const line1 = `Ran python3 state.py pause-mark --feature ${part1}`;
    const cols = line1.length;
    const line2 = `    ${part2} --label '目标确认'`;
    const term = new Terminal({ cols, rows: 10, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(false); // 硬折行前提

    const provider = new FsLinkProvider('tab-e2e', term, () => null, () => tmp, () => realFsClient);
    for (const y of [1, 2]) {
      const links = await new Promise<ILink[]>((res) =>
        provider.provideLinks(y, (l) => res(l ?? [])),
      );
      expect(links.map((l) => l.text)).toEqual([full]); // 整条成链 · 不再是半截 apps/
      expect(links[0].range).toMatchObject({ start: { y: 1 }, end: { y: 2 } });
    }

    // 激活:dir → File Panel 定位(e2e 无 panel)→ 系统 openPath 兜底 · 目标 = 真实目录
    const links = await new Promise<ILink[]>((res) =>
      provider.provideLinks(1, (l) => res(l ?? [])),
    );
    links[0].activate(new MouseEvent('click'), links[0].text);
    await vi.waitFor(() => expect(openPath).toHaveBeenCalledWith(full));
  });

  it('对照组:目标目录不存在时不成链(stat oracle · 无误链)', async () => {
    const part1 = `${tmp}/.worktree/IOS-F001/apps/`;
    const part2 = 'ios/docs/features/NOT-THERE';
    fs.mkdirSync(part1, { recursive: true }); // 只有前缀目录存在
    const line1 = `Ran python3 state.py pause-mark --feature ${part1}`;
    const line2 = `    ${part2} --label ok`;
    const term = new Terminal({ cols: line1.length, rows: 10, allowProposedApi: true });
    await new Promise<void>((r) => term.write(line1 + '\r\n' + line2, r));
    const provider = new FsLinkProvider('tab-e2e', term, () => null, () => tmp, () => realFsClient);
    const links = await new Promise<ILink[]>((res) =>
      provider.provideLinks(1, (l) => res(l ?? [])),
    );
    // 拼接落空 → 回退:前缀真实目录仍成链(修复前行为保持 · 不误拼)
    expect(links.map((l) => l.text)).toEqual([part1]);
  });
});
