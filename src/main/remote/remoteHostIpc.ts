// remoteHost:* IPC 面(main handler)。加密敏感值只经 save 单向进 main,
// 永无 get-secret 通道(AC-3)——本文件注册的 handler 集合即 REMOTE_HOST_CHANNELS
// 全量,渲染层拿不到多出来的读凭据接口。

import { ipcMain } from 'electron';
import { REMOTE_HOST_CHANNELS } from '../../shared/remoteHost';
import { t } from '../../shared/i18n';
import type { RemoteHostConfigInput } from '../../shared/remoteHost';
import type { RemoteHostOrchestrator } from './orchestrator';
import type { CredentialStore, HostConfigStore } from './credentialStore';

interface SavePayload {
  config: RemoteHostConfigInput;
  password?: string;
  passphrase?: string;
}

/**
 * 注册全部 remoteHost:* handler + event 推送;返回反注册函数(dispose/测试用)。
 *
 * @param getMainWindow 🔴 E8(安全)修复:`remoteHost:event` 里 `verifying` 阶段携带
 *   隧道 capability token——此前广播给 `BrowserWindow.getAllWindows()` 的**全部**
 *   窗口(文件查看器/git diff 窗口等与远程机管理毫无关系的窗口也会收到 token)。
 *   Settings/RemoteHostsPage 只存在于主窗口,故只需推给主窗口;调用方传入取「当前
 *   主窗口」的 getter(不能传入固定引用——注册时主窗口可能尚未创建,getter 保证
 *   每次事件触发时都取到最新值)。
 */
export function registerRemoteHostIpc(
  orchestrator: RemoteHostOrchestrator,
  credentials: CredentialStore,
  configStore: HostConfigStore,
  getMainWindow: () => Electron.BrowserWindow | null | undefined,
): () => void {
  const unsubscribeEvents = orchestrator.onEvent((event) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(REMOTE_HOST_CHANNELS.event, event);
    }
  });

  ipcMain.handle(REMOTE_HOST_CHANNELS.list, () => configStore.list());

  ipcMain.handle(REMOTE_HOST_CHANNELS.save, (_event, payload: SavePayload) => {
    const { config, password, passphrase } = payload;
    const hasPassword = typeof password === 'string' && password.length > 0;
    const hasPassphrase = typeof passphrase === 'string' && passphrase.length > 0;

    // 🔴 A9 修复:此前先落盘 config(hasPassword:true 等旗标)再 setSecret,若
    // safeStorage 不可用,setSecret 抛错但 config 已带着「密码已存」的误导性旗标
    // 落盘(实际从未写入密文)。改为落盘前置校验,凭据请求了加密但加密不可用时
    // 直接拒绝整个 save(不产生半成品配置)。
    if ((hasPassword || hasPassphrase) && !credentials.isAvailable()) {
      throw new Error(
        t('Local credential encryption is unavailable — cannot store the password safely'),
      );
    }

    const saved = configStore.save({
      ...config,
      hasPassword: hasPassword || undefined,
      hasPassphrase: hasPassphrase || undefined,
    });

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
