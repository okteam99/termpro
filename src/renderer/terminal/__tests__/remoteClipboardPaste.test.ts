// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  installRemoteClipboardPasteHandler,
  type ClipboardImagePayload,
  type RemoteClipboardPasteTerminal,
} from '../remoteClipboardPaste';

function makeTerminal() {
  let handler: ((event: KeyboardEvent) => boolean) | null = null;
  const terminal = {
    attachCustomKeyEventHandler: vi.fn((next) => {
      handler = next;
    }),
    paste: vi.fn(),
    focus: vi.fn(),
  } as RemoteClipboardPasteTerminal;
  return {
    terminal,
    dispatch(event: Partial<KeyboardEvent>): boolean {
      if (!handler) throw new Error('handler not installed');
      return handler({
        type: 'keydown',
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...event,
      } as KeyboardEvent);
    },
  };
}

const PNG: ClipboardImagePayload = {
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  size: 24,
};

async function flushAsyncPaste(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('remote clipboard paste handler', () => {
  it('远程 Ctrl+V:拦住 0x16,本地读图→远端临时文件→bracketed paste 图片路径', async () => {
    const { terminal, dispatch } = makeTerminal();
    const readImage = vi.fn(async () => PNG);
    const writeImage = vi.fn(async () => ({ path: '/tmp/okwork-clipboard-a/image.png' }));
    const readText = vi.fn(async () => 'should-not-win');
    const notify = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    installRemoteClipboardPasteHandler(terminal, {
      isRemote: () => true,
      readImage,
      readText,
      writeImage,
      notify,
    });

    expect(dispatch({ preventDefault, stopPropagation })).toBe(false);
    // 返回 false 只让 xterm 放弃键编码；必须取消 DOM 默认动作，否则浏览器 paste 事件
    // 与下方异步 bridge 各发一份，长文本会出现两个 Pasted Content。
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    await flushAsyncPaste();

    expect(readImage).toHaveBeenCalledTimes(1);
    expect(writeImage).toHaveBeenCalledWith(PNG);
    expect(readText).not.toHaveBeenCalled();
    expect(terminal.paste).toHaveBeenCalledWith('/tmp/okwork-clipboard-a/image.png');
    expect(terminal.focus).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('旧 Host 且剪贴板无图片:纯文本仍由本地 paste,不发图片 RPC', async () => {
    const { terminal, dispatch } = makeTerminal();
    const writeImage = vi.fn(async () => {
      throw new Error('old Host does not support fs.temp-png');
    });
    installRemoteClipboardPasteHandler(terminal, {
      isRemote: () => true,
      readImage: async () => null,
      readText: async () => 'hello remote',
      writeImage,
      notify: vi.fn(),
    });

    expect(dispatch({})).toBe(false);
    await flushAsyncPaste();

    expect(writeImage).not.toHaveBeenCalled();
    expect(terminal.paste).toHaveBeenCalledWith('hello remote');
  });

  it('本地会话 Ctrl+V 保持 Codex 原生图片粘贴路径', async () => {
    const { terminal, dispatch } = makeTerminal();
    const readImage = vi.fn(async () => PNG);
    installRemoteClipboardPasteHandler(terminal, {
      isRemote: () => false,
      readImage,
      readText: vi.fn(),
      writeImage: vi.fn(),
      notify: vi.fn(),
    });

    expect(dispatch({})).toBe(true);
    await flushAsyncPaste();
    expect(readImage).not.toHaveBeenCalled();
    expect(terminal.paste).not.toHaveBeenCalled();
  });

  it('远程会话未就绪时同步拒绝,不读剪贴板、不发 RPC', async () => {
    const { terminal, dispatch } = makeTerminal();
    const readImage = vi.fn(async () => PNG);
    const writeImage = vi.fn();
    const notify = vi.fn();
    installRemoteClipboardPasteHandler(terminal, {
      isRemote: () => true,
      begin: () => {
        throw new Error('remote terminal is not ready');
      },
      readImage,
      readText: vi.fn(),
      writeImage,
      notify,
    });

    expect(dispatch({})).toBe(false);
    await flushAsyncPaste();
    expect(readImage).not.toHaveBeenCalled();
    expect(writeImage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'Could not paste the clipboard into the remote terminal: remote terminal is not ready',
    );
  });

  it('按键连发只启动一次上传;失败走一次性提示且不把 0x16 发到远端', async () => {
    const { terminal, dispatch } = makeTerminal();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const readImage = vi.fn(async () => {
      await pending;
      return PNG;
    });
    const notify = vi.fn();
    installRemoteClipboardPasteHandler(terminal, {
      isRemote: () => true,
      readImage,
      readText: vi.fn(),
      writeImage: vi.fn(async () => {
        throw new Error('host disconnected');
      }),
      notify,
    });

    expect(dispatch({})).toBe(false);
    expect(dispatch({ repeat: true })).toBe(false);
    expect(readImage).toHaveBeenCalledTimes(1);
    release();
    await flushAsyncPaste();

    expect(terminal.paste).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'Could not paste the clipboard into the remote terminal: host disconnected',
    );
  });
});
