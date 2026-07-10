// 断线重连编排的默认实例接线(BL-005)。把纯 reconnectController(注入式)接到真实
// window.termpro.remoteHost / remoteHostStore / remoteWorkspaceSync / terminalRegistry。
// 与 reconnectController.ts 分离:后者零重依赖便于单测,本文件承接 store/registry 具体接线。

import {
  createReconnectController,
  defaultBackoffFactory,
  type ReconnectController,
} from './reconnectController';
import { stopRemoteWorkspaceSync } from './remoteWorkspaceSync';
import { useRemoteHostRuntimeStore } from '../state/remoteHostStore';
import { readoptHost } from '../terminal/terminalRegistry';
import { findTab } from '../terminal/terminalRegistry';
import { useAppStore } from '../state/store';
import type { SessionSnapshot } from '../../shared/protocol';

/** 据快照对账 tab 徽标(AC-5·渲染半侧):running→保 running·idle/exited→归 idle(消除过期 running)。 */
function reconcileBadge(hostId: string, sessionId: string, snapshot: SessionSnapshot): void {
  const tabId = findTab(hostId, sessionId);
  if (!tabId) return;
  useAppStore.getState().updateTab(tabId, {
    activity: snapshot.state === 'running' ? 'running' : 'idle',
  });
}

export const reconnectController: ReconnectController = createReconnectController({
  connect: (configId) => window.termpro.remoteHost.connect({ id: configId }),
  // disconnect-first:复位 main stage ready→disconnected(否则 connect() 在 ready 是 no-op)
  disconnect: (configId) => window.termpro.remoteHost.disconnect({ id: configId }),
  setReconnecting: (configId, on) =>
    useRemoteHostRuntimeStore.getState().setReconnecting(configId, on),
  isReconnecting: (configId) =>
    useRemoteHostRuntimeStore.getState().isReconnecting(configId),
  stopSync: (configId) => stopRemoteWorkspaceSync(configId),
  readopt: (configId) =>
    readoptHost(configId, {
      reconcileBadge,
      // path②(session.list 有本地无 inst)重建 tab 的 store 接线属集成职责,
      // 由里程碑整合方补;readoptHost 内路径②逻辑已实现 + 单测覆盖(T-036)。
      rebuildTab: () => null,
    }),
  makeBackoff: defaultBackoffFactory,
});
