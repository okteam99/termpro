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
    // 回归:绝不 stopPropagation——否则 mouseup 到不了 document,xterm
    // SelectionService 的拖选 mousemove 监听残留 → 点 url 切回应用后选区自动蔓延。
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/okteam99/termpro/releases/tag/v0.3.11',
    );
    expect(windowOpen).not.toHaveBeenCalled();
    expect(windowConfirm).not.toHaveBeenCalled();
  });
});

describe('createOscLinkHandler (OSC 8 hyperlinks)', () => {
  // 回归 BUG-TERMPRO-B260614085337-001:OSC 8 超链接由 xterm 核心 OscLinkProvider
  // 处理,未设 linkHandler 时会落 defaultActivate → confirm 弹框 + window.open。
  // 设 linkHandler 后必须直接走系统浏览器,且不触碰 confirm / window.open。
  const range = {
    start: { x: 1, y: 1 },
    end: { x: 10, y: 1 },
  };

  it('routes OSC 8 link activation to the system browser, no confirm dialog', async () => {
    const { createOscLinkHandler } = await import('../terminalLinks');
    const handler = createOscLinkHandler();
    const uri = 'http://localhost:56868/shell/close-install-confirmation';
    const event = { preventDefault: vi.fn() } as unknown as MouseEvent;

    handler.activate(event, uri, range);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(uri);
    // 关键:不再走 xterm 默认弹框/新窗口路径
    expect(windowConfirm).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('opens https OSC 8 links too', async () => {
    const { createOscLinkHandler } = await import('../terminalLinks');
    const handler = createOscLinkHandler();
    const uri = 'https://example.com/path?q=1';
    const event = { preventDefault: vi.fn() } as unknown as MouseEvent;

    handler.activate(event, uri, range);

    expect(openExternal).toHaveBeenCalledWith(uri);
    expect(windowConfirm).not.toHaveBeenCalled();
  });
});
