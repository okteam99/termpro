import type {
  BrowserNetworkSnapshot,
  RemoteEvent,
  RemoteHostCapabilities,
  RemoteHostConfig,
  RemoteHostConfigInput,
  RemoteStage,
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
      /** 弹出浏览器标签为独立窗口(OkBrowser-<标题>) */
      openBrowserWindow(payload: { url: string; title?: string }): void;
      /** 订阅内置浏览器新开标签请求(webview 内 target=_blank/window.open),返回退订函数;
       *  sourceWebContentsId=来源 guest 的 webContents id(据此把新标签落回来源终端 tab 的窗格) */
      onBrowserOpenUrl(
        callback: (url: string, sourceWebContentsId: number) => void,
      ): () => void;
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
        /** 全部会话阶段快照(浏览器网络选择器列出可用出口;configId→RemoteStage) */
        stages(): Promise<Record<string, RemoteStage>>;
        onEvent(callback: (e: RemoteEvent) => void): () => void;
      };
      /** 内置浏览器网络出口(标签级:每标签 netHostId → 独立分区;main 按在用集合对账) */
      browserNet: {
        /** 声明式上报在用出口集合;main 对账 acquire/release,返回快照 */
        syncExits(hostIds: string[]): Promise<BrowserNetworkSnapshot>;
        /** 查询当前快照(选择器挂载时对齐权威态) */
        get(): Promise<BrowserNetworkSnapshot>;
        /** 订阅快照变更(断线标 down/重连恢复),返回退订函数 */
        onChanged(callback: (s: BrowserNetworkSnapshot) => void): () => void;
      };
    };
  }
}
