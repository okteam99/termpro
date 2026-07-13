import { t } from '../../shared/i18n';

export interface ClipboardImagePayload {
  base64: string;
  size: number;
}

export interface RemoteClipboardPasteTerminal {
  attachCustomKeyEventHandler(handler: ((event: KeyboardEvent) => boolean) | null): void;
  paste(text: string): void;
  focus(): void;
}

export interface RemoteClipboardPasteDeps {
  isRemote(): boolean;
  readImage(): Promise<ClipboardImagePayload | null>;
  readText(): Promise<string>;
  writeImage(image: ClipboardImagePayload): Promise<{ path: string }>;
  notify(message: string): void;
  /** 可选输入顺序屏障:keydown 内同步 begin,异步流程 finally end。 */
  begin?(): void;
  paste?(text: string): void;
  end?(): void;
}

function isCtrlV(event: KeyboardEvent): boolean {
  return (
    event.type === 'keydown' &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'v'
  );
}

/**
 * 远程 PTY 的 Ctrl+V 不能交给远端进程读 clipboard:它看不到本机剪贴板,headless Linux
 * 还会卡到 X11 timeout。这里同步返回 false 拦下原始 0x16,异步由 Electron main 读本机
 * 剪贴板;图片经 HostService 落成远端临时 PNG,路径再走 xterm paste(bracketed paste)。
 * Codex 等支持“粘贴图片路径”的 TUI 会据此生成原生图片附件;普通 CLI 则得到可访问路径。
 */
export function installRemoteClipboardPasteHandler(
  terminal: RemoteClipboardPasteTerminal,
  deps: RemoteClipboardPasteDeps,
): () => void {
  let inFlight = false;
  let disposed = false;

  const handler = (event: KeyboardEvent): boolean => {
    if (!deps.isRemote() || !isCtrlV(event)) return true;
    // 无论是否 key repeat 都吞掉原始 0x16;同一时刻只准一条上传,防重复附件。
    if (inFlight) return false;
    try {
      deps.begin?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.notify(
        t('Could not paste the clipboard into the remote terminal: {message}', { message }),
      );
      return false;
    }
    inFlight = true;
    void (async () => {
      try {
        const image = await deps.readImage();
        if (disposed) return;
        if (image) {
          const { path } = await deps.writeImage(image);
          if (disposed) return;
          (deps.paste ?? ((text) => terminal.paste(text)))(path);
          terminal.focus();
          return;
        }

        // 远程 Ctrl+V 也由终端所有者负责文本剪贴板,不再回发 0x16 让远端误读 X11。
        const text = await deps.readText();
        if (disposed) return;
        if (text) {
          (deps.paste ?? ((value) => terminal.paste(value)))(text);
          terminal.focus();
          return;
        }
        deps.notify(t('The local clipboard has no image or text to paste'));
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        deps.notify(
          t('Could not paste the clipboard into the remote terminal: {message}', { message }),
        );
      } finally {
        deps.end?.();
        inFlight = false;
      }
    })();
    return false;
  };

  terminal.attachCustomKeyEventHandler(handler);
  return () => {
    disposed = true;
    terminal.attachCustomKeyEventHandler(null);
  };
}
