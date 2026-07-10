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

/**
 * 据快照对账 tab 徽标(AC-5/AC-12·渲染半侧·A3 review-fix):
 * - activity:running→保 running·idle/exited→归 idle(消除过期 running 残留);
 * - 🔴 status==='exited' → 落 `tab.exited=true` + 透传 `exitCode`(北极星:断线期 build 跑完·重连
 *   看到「✓ exit N 已完成」徽标)。host reattach 不重发 pty:exit、App.tsx onExit 不触发·唯有此接线
 *   能点亮 store 的 `tab.exited`(TabBar 据此渲染 tabbar-tab--exited + hint);缺此则徽标永不亮(Q2)。
 * 导出供 reconnectWiring.test.ts 对「真接线落 store」补真断言(非注入 spy)。
 */
export function reconcileBadge(
  hostId: string,
  sessionId: string,
  snapshot: SessionSnapshot,
): void {
  const tabId = findTab(hostId, sessionId);
  if (!tabId) return;
  const exited = snapshot.status === 'exited';
  useAppStore.getState().updateTab(tabId, {
    activity: snapshot.state === 'running' ? 'running' : 'idle',
    // exited 是单调终态,只在 exited 快照置真(不把 live 快照回写成 false·避免抹掉已亮徽标)
    ...(exited
      ? { exited: true, exitCode: snapshot.exitCode ?? undefined }
      : {}),
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
      // 🔴 E3(review-fix·显式 v1 defer·见 PENDING-006):path②(session.list 有会话、本地无 inst →
      // 据快照重建 tab)在 v1 生产不接线 → 恒返 null。理由:重建 tab 需把远程会话 cwd 映射到该机的某个
      // workspace、建 tab 并回传 tabId(store.addTab 不返回 tabId、且无 session→workspace 映射),牵扯
      // 面大于「极小复用」。常态重连(AC-15 抑制 drop → inst 存活 → path①)已覆盖北极星;path② 仅命中
      // 「断开期关过 tab / 曾 full-drop 后重连」的边缘。readoptHost 内 path② 逻辑 + 单测(T-036)俱在,
      // 待 PENDING-006 里程碑接 store 建 tab 路径后启用。非静默:已登记 PENDING + REVIEW deferred。
      rebuildTab: () => null,
    }),
  makeBackoff: defaultBackoffFactory,
});
