import { contextBridge, ipcRenderer } from 'electron';

// 壳层 API:仅暴露与「本地 OS / 窗口」相关的能力。
// 一切工程数据(fs/pty/git)走 HostService 协议,不经过这里。
contextBridge.exposeInMainWorld('termpro', {
  platform: process.platform,
  smoke: process.argv.includes('--termpro-smoke'),
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
});

// 把 main 转交的 MessagePort 透传给主世界(Electron 官方模式:
// preload 无法直接把 port 挂上 contextBridge,需经 window.postMessage 转移)
ipcRenderer.on('host:port', (event) => {
  window.postMessage({ t: 'host:port' }, '*', event.ports);
});

ipcRenderer.on('host:down', () => {
  window.postMessage({ t: 'host:down' }, '*');
});
