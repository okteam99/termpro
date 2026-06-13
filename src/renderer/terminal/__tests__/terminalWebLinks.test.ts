import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SystemWebLinkProviderCtor =
  typeof import('../terminalLinks')['SystemWebLinkProvider'];

const openExternal = vi.fn();
const windowOpen = vi.fn();
const windowConfirm = vi.fn();
let SystemWebLinkProvider: SystemWebLinkProviderCtor;

interface Cell {
  getWidth(): number;
  getChars(): string;
}

function line(text: string) {
  return {
    length: text.length,
    isWrapped: false,
    getCell(x: number): Cell | undefined {
      const ch = text[x];
      if (ch == null) return undefined;
      return {
        getWidth: () => 1,
        getChars: () => ch,
      };
    },
  };
}

function terminalWithLine(text: string): Terminal {
  const row = line(text);
  return {
    buffer: {
      active: {
        length: 1,
        getLine: (y: number) => (y === 0 ? row : undefined),
      },
    },
  } as unknown as Terminal;
}

beforeEach(async () => {
  vi.resetModules();
  openExternal.mockReset();
  windowOpen.mockReset();
  windowConfirm.mockReset();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    open: windowOpen,
    confirm: windowConfirm,
    termpro: {
      openExternal,
    },
  });
  ({ SystemWebLinkProvider } = await import('../terminalLinks'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SystemWebLinkProvider', () => {
  it('opens terminal http links through the system browser without confirmation', () => {
    const term = terminalWithLine(
      'Release: https://github.com/okteam99/termpro/releases/tag/v0.3.11',
    );
    const provider = new SystemWebLinkProvider(term);
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    provider.provideLinks(1, (links) => {
      const provided = links ?? [];
      expect(provided).toHaveLength(1);
      const link = provided[0];
      expect(link.text).toBe(
        'https://github.com/okteam99/termpro/releases/tag/v0.3.11',
      );
      link.activate(event, link.text);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/okteam99/termpro/releases/tag/v0.3.11',
    );
    expect(windowOpen).not.toHaveBeenCalled();
    expect(windowConfirm).not.toHaveBeenCalled();
  });
});
