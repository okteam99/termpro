import { contextBridge, ipcRenderer } from 'electron';

// 壳层 API:仅暴露与「本地 OS / 窗口」相关的能力。
// 一切工程数据(fs/pty/git)走 HostService 协议,不经过这里。
contextBridge.exposeInMainWorld('termpro', {
  platform: process.platform,
  smoke: process.argv.includes('--termpro-smoke'),
  devChannel: process.argv.includes('--termpro-dev'),
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
  setDockBadge(count: number): void {
    ipcRenderer.send('dock:badge', count);
  },
  openInEditor(editor: 'vscode' | 'zed', path: string): void {
    ipcRenderer.send('editor:open', editor, path);
  },
  /** 订阅更新事件(available/downloading/restarting/error),返回退订函数 */
  onUpdateEvent(
    callback: (e: { state: string; version?: string }) => void,
  ): () => void {
    const listener = (
      _e: unknown,
      payload: { state: string; version?: string },
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
  openExternal(url: string): void {
    ipcRenderer.send('shell:open-external', url);
  },
  openPath(path: string): void {
    ipcRenderer.send('shell:open-path', path);
  },
  /** 在独立窗口打开查看器(file/diff),不占用主视图 */
  openViewerWindow(payload: unknown): void {
    ipcRenderer.send('viewer:open-window', payload);
  },
  /** 文件内容窗口:订阅"追加 tab"指令(窗口复用),返回退订函数 */
  onViewerAddTab(callback: (path: string) => void): () => void {
    const listener = (_e: unknown, path: string) => callback(path);
    ipcRenderer.on('viewer:add-tab', listener);
    return () => {
      ipcRenderer.removeListener('viewer:add-tab', listener);
    };
  },
  focusWindow(): void {
    ipcRenderer.send('window:focus-self');
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
