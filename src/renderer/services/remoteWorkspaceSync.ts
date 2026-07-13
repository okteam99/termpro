// 远程 host「连接就绪」后的一次性编排(BL-004 TECH §远程 workspace 发现 + CRUD · E5):
// workspace 发现(workspace.list 首拉 + onWorkspaceChanged 实时协调)与 session 事件路由
// 三者绑定同一生命周期——都在 host ready 时建立、host drop/断线时一次性退订,避免
// 「谁在 host 连上时挂 session 订阅」职责悬空(TECH 明确不放进 sessionEvents 模块级 init)。
//
// 调用方(Sidebar/MachineGroup,不在本 Feature RD write scope 内):观测到
// useRemoteHostRuntimeStore.runtime[configId].stage === 'ready' → startRemoteWorkspaceSync;
// 断线/删除该远程机 → stopRemoteWorkspaceSync。本模块不做模块级自动订阅(与既有
// remoteHostStore 同惯例:window.okwork/hostRegistry 在测试/构建时机不定,交给调用方
// 生命周期管理更可测)。

import { hostRegistry } from './hostRegistry';
import { routeSessionEvent } from './sessionEvents';
import { readoptRemoteSessions, restoreRemoteTabLayouts } from './sessionReadopt';
import { useAppStore } from '../state/store';

interface HostSyncHandle {
  unsubWorkspaceChanged: () => void;
  unsubSessionEvent: () => void;
}

/** configId → 该 host 当前存活的订阅句柄。有 entry = 正在 sync。 */
const active = new Map<string, HostSyncHandle>();

function teardownListeners(configId: string): void {
  const handle = active.get(configId);
  if (!handle) return;
  handle.unsubWorkspaceChanged();
  handle.unsubSessionEvent();
  active.delete(configId);
}

/**
 * host ready 编排:
 * 1. `workspace.list` 拉该机首批 workspace → `setHostWorkspaces(configId, entries)`
 *    (作用域隔离机制注入 hostId=configId·不动本机/他机·见 store.applyWorkspaceSnapshot 对称实现)
 * 2. `onWorkspaceChanged` 订阅该机注册表实时广播 → 同一 action 幂等协调
 * 3. `onSessionEvent` 订阅该机会话事件 → 路由进 `routeSessionEvent(configId, sid, ev)`(E5)
 *
 * 失败路径(E-1):`workspace.list` 失败只 WARN + 不注入 ws + 不影响本机/他机——host 本身
 * 已连通(ready 才会调用本函数),订阅本身无副作用,仍照常建立 2/3,调用方可展示
 * 「加载失败·重试」并再次调用本函数重试(list 幂等)。
 *
 * 重入安全:同 configId 重复调用(如断线重连后再次 ready)先清旧订阅再重建,不留悬挂监听。
 */
/** 首拉重试:main 的 ready 事件(verifying 后自主推进)与 renderer ws 握手是并行竞态,
 *  transport 未就绪时 rpc 立即拒绝 'host not connected'——短退避重试等 ws open。 */
const LIST_RETRY_DELAY_MS = 300;
const LIST_RETRY_MAX = 10;

export async function startRemoteWorkspaceSync(
  configId: string,
  wsUrl: string,
): Promise<void> {
  teardownListeners(configId);
  const client = hostRegistry.getOrCreateRemote(configId, wsUrl);

  // 订阅先于首拉建立:首拉重试期间 host 若广播 workspace:changed 不丢
  const handle: HostSyncHandle = {
    unsubWorkspaceChanged: client.onWorkspaceChanged((workspaces) => {
      useAppStore.getState().setHostWorkspaces(configId, workspaces);
    }),
    unsubSessionEvent: client.onSessionEvent((sessionId, event) => {
      routeSessionEvent(configId, sessionId, event);
    }),
  };
  active.set(configId, handle);

  for (let attempt = 1; attempt <= LIST_RETRY_MAX; attempt++) {
    // 已被 stop/重入顶替 → 本轮首拉作废(不往已回收的视图态注水)
    if (active.get(configId) !== handle) return;
    try {
      const { workspaces } = await client.rpc('workspace.list', undefined);
      if (active.get(configId) !== handle) return;
      useAppStore.getState().setHostWorkspaces(configId, workspaces);
      // 远程 tab 布局恢复(用户规则 2026-07):必须在 setHostWorkspaces 之后【同步】执行
      // ——恢复 tab 的 sessionId 预绑定要赶在 React 挂载 ensureSession 之前(见
      // restoreRemoteTabLayouts 文档),收养路径① 才能接管(host 活→回放内容;
      // host 已重启→原位重 spawn,tab 名称/数量/顺序不丢)。
      restoreRemoteTabLayouts(configId);
      // 服务端会话收养(PENDING-006):注册表落地后据 session.list 重建既有会话 tab
      // (客户端重启后重连的收养入口——此刻 cwd→workspace 映射才有素材;list 成功
      // 亦证明 transport 已开,session.attach 不会撞 A1 的「transport=null 同步 reject」)。
      void readoptRemoteSessions(configId);
      return;
    } catch (err) {
      if (attempt === LIST_RETRY_MAX) {
        console.warn(
          `[remoteWorkspaceSync] workspace.list failed feature=OKWORK-F260710011342 configId=${configId} attempts=${attempt}`,
          err,
        );
        return;
      }
      await new Promise((r) => setTimeout(r, LIST_RETRY_DELAY_MS));
    }
  }
}

/**
 * 断线/删除该远程机:三步同一原子操作,顺序不可换——
 * ① 退订 workspace/session 全部监听(不留悬挂订阅继续路由到已回收的视图态)
 * ② `dropHostWorkspaces(configId)`(store 侧移除该 host 全部 workspace + disposeTerminal
 *    其全部 tab + active 属该 host 时回落本机首个,见 E-4 断线回落)
 * ③ `hostRegistry.drop(configId)` 释放该 client(dispose 连接 + 从 map 移除)
 */
export function stopRemoteWorkspaceSync(configId: string): void {
  teardownListeners(configId);
  useAppStore.getState().dropHostWorkspaces(configId);
  hostRegistry.drop(configId);
}

/** 该 configId 当前是否正在 sync(测试 / 调用方判定用,如避免重复挂「连接」态)。 */
export function isRemoteWorkspaceSyncing(configId: string): boolean {
  return active.has(configId);
}
