// 断线重连编排的默认实例接线(BL-005)。把纯 reconnectController(注入式)接到真实
// window.okwork.remoteHost / remoteHostStore / remoteWorkspaceSync / sessionReadopt。
// 与 reconnectController.ts 分离:后者零重依赖便于单测,本文件承接 store/registry 具体接线。
//
// readopt 走 sessionReadopt.readoptHostSessions(生产 hooks 单源 + 每 hostId 串行化):
// reconcileBadge(AC-5/AC-12 徽标对账)+ rebuildTab(PENDING-006 已接线——session.list 有、
// 本地无 inst → cwd 映射 workspace → adoptSessionTab 重建 tab 收养回放)。
// reconcileBadge 实现迁至 sessionReadopt.ts(避免循环依赖),此处 re-export 兼容既有引用。

import {
  createReconnectController,
  defaultBackoffFactory,
  type ReconnectController,
} from './reconnectController';
import { stopRemoteWorkspaceSync } from './remoteWorkspaceSync';
import { useRemoteHostRuntimeStore } from '../state/remoteHostStore';
import { readoptHostSessions } from './sessionReadopt';

export { reconcileBadge } from './sessionReadopt';

export const reconnectController: ReconnectController = createReconnectController({
  connect: (configId) => window.okwork.remoteHost.connect({ id: configId }),
  // disconnect-first:复位 main stage ready→disconnected(否则 connect() 在 ready 是 no-op)
  disconnect: (configId) => window.okwork.remoteHost.disconnect({ id: configId }),
  setReconnecting: (configId, on) =>
    useRemoteHostRuntimeStore.getState().setReconnecting(configId, on),
  isReconnecting: (configId) =>
    useRemoteHostRuntimeStore.getState().isReconnecting(configId),
  stopSync: (configId) => stopRemoteWorkspaceSync(configId),
  readopt: (configId) => readoptHostSessions(configId),
  makeBackoff: defaultBackoffFactory,
});
