import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { parseLocaleArg, parseVersionArg } from './parseVersionArg';
import { REMOTE_HOST_CHANNELS } from '../shared/remoteHost';
import type {
  RemoteEvent,
  RemoteHostCapabilities,
  RemoteHostConfig,
  RemoteHostConfigInput,
  RemoteTunnelInfo,
  TestResult,
} from '../shared/remoteHost';

// 壳层 API:仅暴露与「本地 OS / 窗口」相关的能力。
// 一切工程数据(fs/pty/git)走 HostService 协议,不经过这里。
contextBridge.exposeInMainWorld('okwork', {
  platform: process.platform,
  smoke: process.argv.includes('--okwork-smoke'),
  devChannel: process.argv.includes('--okwork-dev'),
  version: parseVersionArg(process.argv),
  /** 窗口创建时 main 已解析的生效 locale(renderer 首帧前应用) */
  locale: parseLocaleArg(process.argv),
  /** 语言偏好切换 → main 即时换语言并重建原生菜单(偏好本体随 ui 存档持久化) */
  setAppLocale(pref: 'system' | 'en' | 'zh-CN'): void {
    ipcRenderer.send('locale:set', pref);
  },
  /** 请求 main 建一条直连 Host 的 MessageChannel,port 经 window message 送达 */
  requestHostPort(): void {
    ipcRenderer.send('host:request-port');
  },
  pickDirectory(): Promise<string | null> {
    return ipcRenderer.invoke('dialog:pick-directory');
  },
  /** 订阅原生菜单动作(new-tab / close-tab),返回退订函数 */
  onMenu(callback: (action: string) => void): () => void {
    const listener = (_e: unknown, action: string) => callback(action);
    ipcRenderer.on('menu', listener);
    return () => {
      ipcRenderer.removeListener('menu', listener);
    };
  },
  smokeOk(): void {
    ipcRenderer.send('smoke:ok');
  },
  storeGet(): Promise<unknown> {
    return ipcRenderer.invoke('store:get');
  },
  storeSet(state: unknown): void {
    ipcRenderer.send('store:set', state);
  },
  /** 迁移前把 v1 存档(state.json)复制为备份;失败 reject → 计入迁移失败 */
  backupV1Archive(): Promise<void> {
    return ipcRenderer.invoke('store:backup-v1');
  },
  setDockBadge(count: number): void {
    ipcRenderer.send('dock:badge', count);
  },
  /** 订阅更新事件(available/downloading/confirming/restarting/error),返回退订函数 */
  onUpdateEvent(
    callback: (e: { state: string; version?: string; percent?: number }) => void,
  ): () => void {
    const listener = (
      _e: unknown,
      payload: { state: string; version?: string; percent?: number },
    ) => callback(payload);
    ipcRenderer.on('update:event', listener);
    ipcRenderer.send('update:query');
    return () => {
      ipcRenderer.removeListener('update:event', listener);
    };
  },
  installUpdate(): void {
    ipcRenderer.send('update:install');
  },
  /** 终端右键菜单:返回用户选择的动作(copy/paste/selectAll/clear/null) */
  showTerminalContextMenu(opts: {
    hasSelection: boolean;
  }): Promise<string | null> {
    return ipcRenderer.invoke('terminal:context-menu', opts);
  },
  /** Tab 右键菜单:返回动作(rename/close/null) */
  showTabContextMenu(): Promise<string | null> {
    return ipcRenderer.invoke('tab:context-menu');
  },
  clipboardWriteText(text: string): void {
    ipcRenderer.send('clipboard:write-text', text);
  },
  clipboardReadText(): Promise<string> {
    return ipcRenderer.invoke('clipboard:read-text');
  },
  /** 本机系统剪贴板图片统一编码成 PNG;空剪贴板返回 null。 */
  clipboardReadImage(): Promise<{ base64: string; size: number } | null> {
    return ipcRenderer.invoke('clipboard:read-image');
  },
  openExternal(url: string): void {
    ipcRenderer.send('shell:open-external', url);
  },
  /** 订阅内置浏览器新开标签请求(webview 内 target=_blank/window.open),返回退订函数 */
  onBrowserOpenUrl(callback: (url: string) => void): () => void {
    const listener = (_e: unknown, url: string) => callback(url);
    ipcRenderer.on('browser:open-url', listener);
    return () => {
      ipcRenderer.removeListener('browser:open-url', listener);
    };
  },
  openPath(path: string): void {
    ipcRenderer.send('shell:open-path', path);
  },
  /** 在 Finder 中显示文件(打开所在目录并高亮) */
  showItemInFolder(path: string): void {
    ipcRenderer.send('shell:show-item-in-folder', path);
  },
  /** 本地 HTML 用系统默认浏览器打开 */
  openInBrowser(path: string): void {
    ipcRenderer.send('shell:open-in-browser', path);
  },
  /** 在独立窗口打开查看器(file/diff),不占用主视图 */
  openViewerWindow(payload: unknown): void {
    ipcRenderer.send('viewer:open-window', payload);
  },
  /** 文件内容窗口:订阅"追加 tab"指令(窗口复用),返回退订函数 */
  onViewerAddTab(
    callback: (tab: { path: string; kind: 'file' | 'dir' }) => void,
  ): () => void {
    const listener = (_e: unknown, tab: { path: string; kind: 'file' | 'dir' }) =>
      callback(tab);
    ipcRenderer.on('viewer:add-tab', listener);
    return () => {
      ipcRenderer.removeListener('viewer:add-tab', listener);
    };
  },
  focusWindow(): void {
    ipcRenderer.send('window:focus-self');
  },
  /** 取拖入 File 的真实磁盘路径(Electron webUtils;file.path 已废弃) */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  /** 发起原生拖出:把本地文件/目录拖到 Finder 等(OS 默认=复制) */
  startFileDrag(path: string): void {
    ipcRenderer.send('file:start-drag', path);
  },
  // 远程机管理与连接编排(BL-003)· 通道名单源 = shared/remoteHost.ts REMOTE_HOST_CHANNELS。
  // 🔴 无 get-secret 通道:加密敏感值只经 save 单向进 main(AC-3)。
  remoteHost: {
    list(): Promise<RemoteHostConfig[]> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.list);
    },
    /** 凭据面能力(safeStorage 是否可用);false 时页面挂警示横幅 */
    capabilities(): Promise<RemoteHostCapabilities> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.capabilities);
    },
    save(payload: {
      config: RemoteHostConfigInput;
      password?: string;
      passphrase?: string;
    }): Promise<RemoteHostConfig> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.save, payload);
    },
    delete(payload: { id: string }): Promise<void> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.delete, payload);
    },
    test(payload: { id: string }): Promise<TestResult> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.test, payload);
    },
    connect(payload: { id: string }): void {
      ipcRenderer.send(REMOTE_HOST_CHANNELS.connect, payload);
    },
    disconnect(payload: { id: string }): void {
      ipcRenderer.send(REMOTE_HOST_CHANNELS.disconnect, payload);
    },
    /** 已就绪会话的本地转发隧道(查看器窗口直连远程 host 用);未连接 → null */
    getTunnel(payload: { id: string }): Promise<RemoteTunnelInfo | null> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.tunnel, payload);
    },
    /** 订阅远程机连接生命周期事件,返回退订函数 */
    onEvent(callback: (e: RemoteEvent) => void): () => void {
      const listener = (_e: unknown, payload: RemoteEvent) => callback(payload);
      ipcRenderer.on(REMOTE_HOST_CHANNELS.event, listener);
      return () => {
        ipcRenderer.removeListener(REMOTE_HOST_CHANNELS.event, listener);
      };
    },
  },
});

// 把 main 转交的 MessagePort 透传给主世界(Electron 官方模式:
// preload 无法直接把 port 挂上 contextBridge,需经 window.postMessage 转移)
ipcRenderer.on('host:port', (event) => {
  window.postMessage({ t: 'host:port' }, '*', event.ports);
});

ipcRenderer.on('host:down', () => {
  window.postMessage({ t: 'host:down' }, '*');
});
