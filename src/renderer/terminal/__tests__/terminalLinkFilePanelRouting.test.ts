import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type OpenTargetInFilePanelFirst = typeof import('../terminalLinks')['openTargetInFilePanelFirst'];
type RegisterFilePanelLocateHandler = typeof import('../../filepanel/locateRegistry')['registerFilePanelLocateHandler'];

const openPath = vi.fn();
const openViewerWindow = vi.fn();
const unregisters: Array<() => void> = [];
let openTargetInFilePanelFirst: OpenTargetInFilePanelFirst;
let registerFilePanelLocateHandler: RegisterFilePanelLocateHandler;

beforeEach(async () => {
  vi.resetModules();
  openPath.mockReset();
  openViewerWindow.mockReset();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    termpro: {
      openPath,
      openViewerWindow,
      requestHostPort: vi.fn(),
    },
  });
  ({ openTargetInFilePanelFirst } = await import('../terminalLinks'));
  ({ registerFilePanelLocateHandler } = await import('../../filepanel/locateRegistry'));
});

afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
  vi.unstubAllGlobals();
});

describe('terminal file links route to FilePanel before fallback', () => {
  it('uses file viewer fallback when there is no locate handler', async () => {
    await openTargetInFilePanelFirst('missing-tab', '/repo/src/App.tsx', 'file');

    expect(openViewerWindow).toHaveBeenCalledWith({ mode: 'file', path: '/repo/src/App.tsx' });
    expect(openPath).not.toHaveBeenCalled();
  });

  it('uses original directory fallback when locate returns false', async () => {
    unregisters.push(registerFilePanelLocateHandler('t1', vi.fn().mockResolvedValue(false)));

    await openTargetInFilePanelFirst('t1', '/repo/src', 'dir');

    expect(openPath).toHaveBeenCalledWith('/repo/src');
    expect(openViewerWindow).not.toHaveBeenCalled();
  });

  it('uses original fallback when locate rejects', async () => {
    unregisters.push(registerFilePanelLocateHandler('t1', vi.fn().mockRejectedValue(new Error('boom'))));

    await openTargetInFilePanelFirst('t1', '/repo/archive.zip', 'file');

    expect(openPath).toHaveBeenCalledWith('/repo/archive.zip');
    expect(openViewerWindow).not.toHaveBeenCalled();
  });

  it('keeps repository system-open extensions location-only when locate succeeds', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    unregisters.push(registerFilePanelLocateHandler('t1', handler));

    await openTargetInFilePanelFirst('t1', '/repo/archive.zip', 'file');

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      path: '/repo/archive.zip',
      kind: 'file',
      sourceTabId: 't1',
    }));
    expect(openPath).not.toHaveBeenCalled();
    expect(openViewerWindow).not.toHaveBeenCalled();
  });
});
