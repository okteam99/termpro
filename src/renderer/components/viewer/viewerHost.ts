// 查看器窗口的 host 连接选路:本机('local'/缺省)走既有 MessagePort 单例;
// 远程按 hostId 向 main 按需取隧道(remoteHost:getTunnel),经本地转发端口 ws 直连。
// 查看器是独立渲染进程,进程内 hostClient 单例只服务本窗口——一窗一 host,
// 窗口内所有组件(FileView/DirListing/MarkdownPreview/DiffPanel)零改动即得正确路由。
// 断线不自动重连(与本机 host 退出同口径):⌘R 重载会重新取隧道(端口轮换也能连回)。

import { hostClient } from '../../services/hostClient';
import type { HostInfo } from '../../../shared/protocol';
import { t } from '../../../shared/i18n';

/** 该查看器窗口是否服务远程 host(hostId 缺省/'local' = 本机)。 */
export function isRemoteHost(hostId: string | undefined): boolean {
  return typeof hostId === 'string' && hostId !== '' && hostId !== 'local';
}

/**
 * 按 hostId 连接本窗口的 hostClient 单例。远程机未连接(隧道不存在)→ 以
 * 确定性错误拒绝,由窗口的连接失败 UI 呈现,绝不静默回落本机(防误路由读错文件)。
 */
export function connectViewerHost(hostId: string | undefined): Promise<HostInfo> {
  if (!isRemoteHost(hostId)) return hostClient.connect();
  return window.okwork.remoteHost.getTunnel({ id: hostId! }).then((tunnel) => {
    if (!tunnel) {
      throw new Error(t('Remote machine is not connected'));
    }
    const wsUrl = `ws://127.0.0.1:${tunnel.localPort}?token=${encodeURIComponent(tunnel.token)}`;
    return hostClient.connect({ wsUrl });
  });
}

/**
 * 手动刷新用的重连(掉线后按钮触发)。必须走 hostClient.reconnect 而非 connect——
 * connect() 在 down 态会早返陈旧 connectPromise 不真重连(hostClient.ts 硬门④);reconnect
 * 复位 down/connectPromise、关旧 transport 重开。远程重新取隧道(host 重启端口轮换也连回)。
 */
export function reconnectViewerHost(hostId: string | undefined): Promise<HostInfo> {
  if (!isRemoteHost(hostId)) return hostClient.reconnect();
  return window.okwork.remoteHost.getTunnel({ id: hostId! }).then((tunnel) => {
    if (!tunnel) {
      throw new Error(t('Remote machine is not connected'));
    }
    const wsUrl = `ws://127.0.0.1:${tunnel.localPort}?token=${encodeURIComponent(tunnel.token)}`;
    return hostClient.reconnect({ wsUrl });
  });
}
