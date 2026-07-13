import type {
  RemoteEvent,
  RemoteHostConfig,
  RemoteHostConfigInput,
  TestResult,
} from '../shared/remoteHost';

export {};

declare global {
  interface Window {
    termpro: {
      platform: string;
      smoke: boolean;
      devChannel: boolean;
      version: string;
      /** 窗口创建时 main 已解析的生效 locale('en' | 'zh-CN';缺失 → "") */
      locale: string;
      /** 语言偏好切换 → main 即时换语言并重建原生菜单 */
      setAppLocale(pref: 'system' | 'en' | 'zh-CN'): void;
      requestHostPort(): void;
      pickDirectory(): Promise<string | null>;
      onMenu(callback: (action: string) => void): () => void;
      smokeOk(): void;
      storeGet(): Promise<unknown>;
      storeSet(state: unknown): void;
      /** 迁移前把 v1 存档复制为备份(state.v1-backup.json);失败 reject */
      backupV1Archive(): Promise<void>;
      setDockBadge(count: number): void;
      focusWindow(): void;
      onUpdateEvent(
        callback: (e: {
          state:
            | 'available'
            | 'checking'
            | 'downloading'
            | 'confirming'
            | 'restarting'
            | 'error';
          version?: string;
          percent?: number;
        }) => void,
      ): () => void;
      installUpdate(): void;
      openViewerWindow(payload: unknown): void;
      showTerminalContextMenu(opts: {
        hasSelection: boolean;
      }): Promise<string | null>;
      showTabContextMenu(): Promise<string | null>;
      clipboardWriteText(text: string): void;
      clipboardReadText(): Promise<string>;
      openExternal(url: string): void;
      openPath(path: string): void;
      showItemInFolder(path: string): void;
      openInBrowser(path: string): void;
      onViewerAddTab(
        callback: (tab: { path: string; kind: 'file' | 'dir' }) => void,
      ): () => void;
      /** 取拖入 File 的真实磁盘路径(Electron webUtils) */
      getPathForFile(file: File): string;
      /** 发起原生拖出(把本地文件/目录拖到 Finder 等) */
      startFileDrag(path: string): void;
      /** 远程机管理与连接编排(BL-003)· 无 get-secret 通道(AC-3) */
      remoteHost: {
        list(): Promise<RemoteHostConfig[]>;
        save(payload: {
          config: RemoteHostConfigInput;
          password?: string;
          passphrase?: string;
        }): Promise<RemoteHostConfig>;
        delete(payload: { id: string }): Promise<void>;
        test(payload: { id: string }): Promise<TestResult>;
        connect(payload: { id: string }): void;
        disconnect(payload: { id: string }): void;
        onEvent(callback: (e: RemoteEvent) => void): () => void;
      };
    };
  }
}
