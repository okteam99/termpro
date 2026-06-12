import { contextBridge, ipcRenderer } from 'electron';

// 壳层 API:仅暴露与「本地 OS / 窗口」相关的能力。
// 一切工程数据(fs/pty/git)走 HostService 协议,不经过这里。
contextBridge.exposeInMainWorld('termpro', {
  platform: process.platform,
  /** 请求 main 建一条直连 Host 的 MessageChannel,port 经 window message 送达 */
  requestHostPort(): void {
    ipcRenderer.send('host:request-port');
  },
  pickDirectory(): Promise<string | null> {
    return ipcRenderer.invoke('dialog:pick-directory');
  },
  smokeOk(): void {
    ipcRenderer.send('smoke:ok');
  },
});

// 把 main 转交的 MessagePort 透传给主世界(Electron 官方模式:
// preload 无法直接把 port 挂上 contextBridge,需经 window.postMessage 转移)
ipcRenderer.on('host:port', (event) => {
  window.postMessage({ t: 'host:port' }, '*', event.ports);
});
