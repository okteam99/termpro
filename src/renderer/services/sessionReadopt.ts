// 服务端会话收养(PENDING-006 落地):以服务端 session.list 为单源,把客户端没有对应
// tab/inst 的既有会话重建成 tab 并 attach 回放——覆盖「客户端重启后重连」「断开期丢过
// inst / full-drop 后重连」两类场景。语义:只要用户没主动关 tab(pty.kill)/删项目,
// 服务端会话(live 续跑 + exited 保留)在下次连接时全量回到 UI。
//
// 结构:mapSessionCwdToWorkspace(纯函数·最长 root 前缀匹配)→ rebuildTabForSnapshot
// (store.adoptSessionTab 建 tab 回传 tabId)→ readoptRemoteSessions(readoptHost 的
// 生产 hooks 单源 + 每 configId 串行化)。reconcileBadge 从 reconnectWiring 迁入本模块
// (wiring 保留 re-export 兼容),避免 wiring↔本模块循环依赖。
//
// 调用方两处:reconnectWiring(闪断重连 onReconnected)与 remoteWorkspaceSync
// (host ready 首拉 workspace.list 落地后)——后者是「重启后重连」的收养入口:
// 必须等注册表进 store,cwd→workspace 映射才有素材。

import { readoptHost, findTab } from '../terminal/terminalRegistry';
import { useAppStore } from '../state/store';
import type { WorkspaceState } from '../state/store';
import type { SessionSnapshot } from '../../shared/protocol';

/**
 * 据快照对账 tab 徽标(AC-5/AC-12·渲染半侧·A3 review-fix):
 * - activity:running→保 running·idle/exited→归 idle(消除过期 running 残留);
 * - 🔴 status==='exited' → 落 `tab.exited=true` + 透传 `exitCode`(北极星:断线期 build 跑完·重连
 *   看到「✓ exit N 已完成」徽标)。host reattach 不重发 pty:exit、App.tsx onExit 不触发·唯有此接线
 *   能点亮 store 的 `tab.exited`(TabBar 据此渲染 tabbar-tab--exited + hint);缺此则徽标永不亮(Q2)。
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

/**
 * 会话 cwd → 该 host 下归属 workspace(最长 root 前缀匹配·纯函数)。
 * 匹配不到(如 spawn cwd 回退过家目录 / 项目已删)→ null,调用方跳过该会话
 * (留在服务端,不 kill——收养只做加法)。
 */
export function mapSessionCwdToWorkspace(
  workspaces: readonly WorkspaceState[],
  hostId: string,
  cwd: string,
): WorkspaceState | null {
  let best: WorkspaceState | null = null;
  let bestLen = -1; // 归一化 root 长度(比较基准统一用归一化值,不混用原始 w.root)
  for (const w of workspaces) {
    if (w.hostId !== hostId) continue;
    const root = w.root.endsWith('/') ? w.root.slice(0, -1) : w.root;
    if (cwd !== root && !cwd.startsWith(root + '/')) continue;
    if (root.length > bestLen) {
      best = w;
      bestLen = root.length;
    }
  }
  return best;
}

/** readoptHost path② 的生产 rebuildTab:cwd 映射到 workspace → 建 tab 回传 tabId。 */
export function rebuildTabForSnapshot(
  hostId: string,
  snap: SessionSnapshot,
): string | null {
  const s = useAppStore.getState();
  const ws = mapSessionCwdToWorkspace(s.workspaces, hostId, snap.cwd);
  if (!ws) return null;
  return s.adoptSessionTab(ws.id, snap.cwd, snap.title);
}

/** configId → 在途收养 promise(串行化尾指针) */
const inflight = new Map<string, Promise<void>>();

/**
 * 收养入口(生产 hooks 单源):同 configId 的并发调用串行执行——
 * onReconnected(闪断)与 startRemoteWorkspaceSync(ready 首拉后)可能背靠背触发,
 * 并行跑会双双看到「本地无 inst」而重建两份 tab;串行后后一轮经 adoptedSids/localSids
 * 去重自然收敛为 no-op。失败只 WARN(收养是尽力恢复,不阻断连接可用性)。
 */
export function readoptRemoteSessions(
  configId: string,
  readopt: typeof readoptHost = readoptHost,
): Promise<void> {
  const prev = inflight.get(configId) ?? Promise.resolve();
  const next = prev
    .then(() =>
      readopt(configId, { reconcileBadge, rebuildTab: rebuildTabForSnapshot }),
    )
    .catch((err) => {
      console.warn('[sessionReadopt] readopt failed configId=%s', configId, err);
    })
    .finally(() => {
      if (inflight.get(configId) === next) inflight.delete(configId);
    });
  inflight.set(configId, next);
  return next;
}
