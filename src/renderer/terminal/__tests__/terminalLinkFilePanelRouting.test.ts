import type { ILink, Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// hostClient mock — only the FsLinkProvider end-to-end test (T-006) hits it;
// the openTarget routing tests stay synchronous on window.termpro.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../services/hostClient', () => ({
  hostClient: { rpc, info: { homedir: '/home/u' } },
}));

type Mod = typeof import('../terminalLinks');
type RegisterFilePanelLocateHandler =
  typeof import('../../filepanel/locateRegistry')['registerFilePanelLocateHandler'];

const openPath = vi.fn();
const openViewerWindow = vi.fn();
const unregisters: Array<() => void> = [];
let openTarget: Mod['openTarget'];
let FsLinkProvider: Mod['FsLinkProvider'];
let registerFilePanelLocateHandler: RegisterFilePanelLocateHandler;

// 让 dir 分支的 async 定位链(openTargetInFilePanelFirst → tryLocateInFilePanel → handler)跑完
const flush = () => new Promise((r) => setTimeout(r, 0));

interface Cell {
  getWidth(): number;
  getChars(): string;
}
function fakeLine(text: string) {
  return {
    length: text.length,
    isWrapped: false,
    getCell(x: number): Cell | undefined {
      const ch = text[x];
      if (ch == null) return undefined;
      return { getWidth: () => 1, getChars: () => ch };
    },
  };
}
function terminalWithLine(text: string): Terminal {
  const row = fakeLine(text);
  return {
    buffer: { active: { length: 1, getLine: (y: number) => (y === 0 ? row : undefined) } },
  } as unknown as Terminal;
}

beforeEach(async () => {
  vi.resetModules();
  openPath.mockReset();
  openViewerWindow.mockReset();
  rpc.mockReset();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    termpro: { openPath, openViewerWindow, requestHostPort: vi.fn() },
  });
  ({ openTarget, FsLinkProvider } = await import('../terminalLinks'));
  ({ registerFilePanelLocateHandler } = await import('../../filepanel/locateRegistry'));
});

afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
  vi.unstubAllGlobals();
});

describe('terminal link activation routes by kind', () => {
  // T-001 · AC-2
  it('opens a non-system-ext file directly in the viewer, without locating', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    unregisters.push(registerFilePanelLocateHandler('t1', handler));

    openTarget('t1', '/repo/src/App.tsx', 'file');
    await flush();

    expect(openViewerWindow).toHaveBeenCalledWith({ mode: 'file', path: '/repo/src/App.tsx' });
    expect(openPath).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  // T-002 · AC-2
  it('opens a SYSTEM_OPEN_EXT file via the system opener, without locating', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    unregisters.push(registerFilePanelLocateHandler('t1', handler));

    openTarget('t1', '/repo/assets/clip.mp4', 'file');
    await flush();

    expect(openPath).toHaveBeenCalledWith('/repo/assets/clip.mp4');
    expect(openViewerWindow).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  // T-003 · AC-3 — replaces the old "keeps system-open extensions location-only when locate succeeds"
  it('opens an in-root file directly even when a locate handler is registered (no longer location-only)', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    unregisters.push(registerFilePanelLocateHandler('t1', handler));

    openTarget('t1', '/repo/archive.zip', 'file');
    await flush();

    expect(openPath).toHaveBeenCalledWith('/repo/archive.zip');
    expect(handler).not.toHaveBeenCalled();
    expect(openViewerWindow).not.toHaveBeenCalled();
  });

  // T-004 · AC-1
  it('locates a directory in the File Panel and does not fall back when locate succeeds', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    unregisters.push(registerFilePanelLocateHandler('t1', handler));

    openTarget('t1', '/repo/src', 'dir');
    await flush();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/repo/src', kind: 'dir', sourceTabId: 't1' }),
    );
    expect(openPath).not.toHaveBeenCalled();
    expect(openViewerWindow).not.toHaveBeenCalled();
  });

  // T-005 · AC-1
  it('falls back to the system opener for a directory when locate returns false', async () => {
    unregisters.push(registerFilePanelLocateHandler('t1', vi.fn().mockResolvedValue(false)));

    openTarget('t1', '/repo/src', 'dir');
    await flush();

    expect(openPath).toHaveBeenCalledWith('/repo/src');
    expect(openViewerWindow).not.toHaveBeenCalled();
  });

  // T-006 · AC-4 — :line:col file opens via the stripped path (end-to-end through FsLinkProvider)
  it('activates a :line:col file link using the stripped path, no line-jump claim', async () => {
    rpc.mockImplementation(async (method: string) => {
      if (method === 'fs.stat') return { kind: 'file' };
      if (method === 'pty.cwd') return { cwd: '/repo' };
      return {};
    });
    const term = terminalWithLine('see /repo/src/App.tsx:42:10 for details');
    const provider = new FsLinkProvider(
      't1',
      term,
      () => null,
      () => '/repo',
    );

    const links = await new Promise<ILink[] | undefined>((resolve) => {
      provider.provideLinks(1, resolve);
    });
    expect(links).toBeDefined();
    expect(links).toHaveLength(1);
    const link = links![0];
    expect(link.text).toBe('/repo/src/App.tsx:42:10'); // underline keeps the suffix
    link.activate({} as MouseEvent, link.text);
    await flush();

    // opened with the stripped path — no :42:10
    expect(openViewerWindow).toHaveBeenCalledWith({ mode: 'file', path: '/repo/src/App.tsx' });
    expect(openPath).not.toHaveBeenCalled();
  });
});
