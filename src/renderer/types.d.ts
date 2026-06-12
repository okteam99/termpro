export {};

declare global {
  interface Window {
    termpro: {
      platform: string;
      smoke: boolean;
      devChannel: boolean;
      requestHostPort(): void;
      pickDirectory(): Promise<string | null>;
      onMenu(callback: (action: string) => void): () => void;
      smokeOk(): void;
      storeGet(): Promise<unknown>;
      storeSet(state: unknown): void;
      setDockBadge(count: number): void;
      focusWindow(): void;
      openInEditor(editor: 'vscode' | 'zed', path: string): void;
      onUpdateEvent(
        callback: (e: {
          state: 'available' | 'checking' | 'downloading' | 'restarting' | 'error';
          version?: string;
        }) => void,
      ): () => void;
      installUpdate(): void;
      openViewerWindow(payload: unknown): void;
      showTerminalContextMenu(opts: {
        hasSelection: boolean;
      }): Promise<string | null>;
      clipboardWriteText(text: string): void;
      clipboardReadText(): Promise<string>;
      openExternal(url: string): void;
      openPath(path: string): void;
      onViewerAddTab(callback: (path: string) => void): () => void;
    };
  }
}
