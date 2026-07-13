import type {
  RemoteEvent,
  RemoteHostCapabilities,
  RemoteHostConfig,
  RemoteHostConfigInput,
  RemoteTunnelInfo,
  TestResult,
} from '../shared/remoteHost';

export {};

declare global {
  interface Window {
    okwork: {
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
      clipboardReadImage(): Promise<{ base64: string; size: number } | null>;
      openExternal(url: string): void;
      /** 订阅内置浏览器新开标签请求(webview 内 target=_blank/window.open),返回退订函数 */
      onBrowserOpenUrl(callback: (url: string) => void): () => void;
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
        /** 凭据面能力(safeStorage 是否可用);false 时页面挂警示横幅 */
        capabilities(): Promise<RemoteHostCapabilities>;
        save(payload: {
          config: RemoteHostConfigInput;
          password?: string;
          passphrase?: string;
        }): Promise<RemoteHostConfig>;
        delete(payload: { id: string }): Promise<void>;
        test(payload: { id: string }): Promise<TestResult>;
        connect(payload: { id: string }): void;
        disconnect(payload: { id: string }): void;
        /** 已就绪会话的本地转发隧道(查看器窗口直连远程 host 用);未连接 → null */
        getTunnel(payload: { id: string }): Promise<RemoteTunnelInfo | null>;
        onEvent(callback: (e: RemoteEvent) => void): () => void;
      };
    };
  }
}
