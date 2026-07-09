// remoteHost:* IPC 面(main handler)。加密敏感值只经 save 单向进 main,
// 永无 get-secret 通道(AC-3)——本文件注册的 handler 集合即 REMOTE_HOST_CHANNELS
// 全量,渲染层拿不到多出来的读凭据接口。

import { BrowserWindow, ipcMain } from 'electron';
import { REMOTE_HOST_CHANNELS } from '../../shared/remoteHost';
import type { RemoteHostConfigInput } from '../../shared/remoteHost';
import type { RemoteHostOrchestrator } from './orchestrator';
import type { CredentialStore, HostConfigStore } from './credentialStore';

interface SavePayload {
  config: RemoteHostConfigInput;
  password?: string;
  passphrase?: string;
}

/** 注册全部 remoteHost:* handler + event 推送;返回反注册函数(dispose/测试用)。 */
export function registerRemoteHostIpc(
  orchestrator: RemoteHostOrchestrator,
  credentials: CredentialStore,
  configStore: HostConfigStore,
): () => void {
  const unsubscribeEvents = orchestrator.onEvent((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(REMOTE_HOST_CHANNELS.event, event);
      }
    }
  });

  ipcMain.handle(REMOTE_HOST_CHANNELS.list, () => configStore.list());

  ipcMain.handle(REMOTE_HOST_CHANNELS.save, (_event, payload: SavePayload) => {
    const { config, password, passphrase } = payload;
    const hasPassword = typeof password === 'string' && password.length > 0;
    const hasPassphrase = typeof passphrase === 'string' && passphrase.length > 0;

    const saved = configStore.save({
      ...config,
      hasPassword: hasPassword || undefined,
      hasPassphrase: hasPassphrase || undefined,
    });

    // safeStorage 不可用时 setSecret 抛错(AC-3)——配置本身已落盘,凭据缺失由
    // renderer 据抛出的 Error message 呈现「本机凭据加密不可用」提示。
    if (hasPassword) credentials.setSecret(`cred:${saved.id}:password`, password!);
    if (hasPassphrase) credentials.setSecret(`cred:${saved.id}:passphrase`, passphrase!);

    return saved;
  });

  ipcMain.handle(REMOTE_HOST_CHANNELS.delete, async (_event, payload: { id: string }) => {
    // AC-14:活跃连接先 best-effort 断开,再清配置+凭据(失败不阻断删除)
    await orchestrator.disconnect(payload.id).catch(() => undefined);
    configStore.delete(payload.id);
    credentials.deleteAllForConfig(payload.id);
  });

  ipcMain.handle(REMOTE_HOST_CHANNELS.test, (_event, payload: { id: string }) => {
    return orchestrator.test(payload.id);
  });

  ipcMain.on(REMOTE_HOST_CHANNELS.connect, (_event, payload: { id: string }) => {
    void orchestrator.connect(payload.id);
  });

  ipcMain.on(REMOTE_HOST_CHANNELS.disconnect, (_event, payload: { id: string }) => {
    void orchestrator.disconnect(payload.id);
  });

  return () => {
    unsubscribeEvents();
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.list);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.save);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.delete);
    ipcMain.removeHandler(REMOTE_HOST_CHANNELS.test);
    ipcMain.removeAllListeners(REMOTE_HOST_CHANNELS.connect);
    ipcMain.removeAllListeners(REMOTE_HOST_CHANNELS.disconnect);
  };
}
