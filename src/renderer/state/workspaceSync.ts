// 收到 workspace:changed 全量快照后的协调算法(纯函数,AC-3 P0 契约)。
// 输入:本地 workspace 视图态(全量,含全部 host 的 ws)+ 本端 activeWorkspaceId + Host 全量快照
// (某一 host 的,由 scopeHostId 指明是哪一台)。输出:新 workspace 数组 + 新 activeWorkspaceId +
// 需释放的 tabId 列表(副作用由 store 执行)。这本身就是 BL-004 作用域隔离机制的完整落点——
// store 的 applyWorkspaceSnapshot/setHostWorkspaces 只调用本函数 + 派发 disposeTerminal 副作用,
// 不内联任何协调逻辑(architect NIT-N1:机制钉成可单测的纯函数)。
//
// BL-004 作用域隔离(修 review BLOCKER A1/E2):快照只覆盖 scopeHostId 这一台机,若对整个
// `local` 数组不加区分地跑三分支协调,会把作用域外(其它 host)的 workspace 全部当孤儿删掉。
// 机制:filter-in(按 scopeHostId 切出本作用域子集)→ 作用域内三分支协调 → 按 local 原位次
// merge-back(作用域外原样透传,新增追加末尾 · NIT-N2:交错作用域下落位语义不唯一,取「整个
// 数组末尾」这个合理默认即可)→ active 只在「原 active 属本作用域且被删」时复位。
//
// 作用域内三分支(以 id 为键,非整体替换):
//   - snapshot 有、inScope 无 → 合成默认视图(单 root tab、hostId=scopeHostId、不改 active、追加末尾)。
//   - inScope 有、snapshot 无 → 回收(该 ws 全部 tab 记入 disposedTabIds,移除)。
//   - 两侧都有 → 仅同步 name/root,保留 tabs/activeTabId/branch 与合并后的数组位置。
//
// active 复位(NIT-N3):仅当原 active 属本作用域且被本作用域快照删除时才复位——落点优先本机
// 首个 workspace(跨作用域找,不局限本作用域残留),其次数组首个,最后才是 null(避免「远程机
// 删了正在看的 workspace,但本机/其它机器明明还有 workspace 可看」时晾出空 active)。

import type { WorkspaceEntry } from '../../shared/protocol';
import type { TabState, WorkspaceState } from './store';
import { basename } from './pathLabel';

const LOCAL_HOST_ID = 'local';

export interface ReconcileResult {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  /** 需 disposeTerminal 的 tabId(该作用域内被远端删除的 workspace 的全部 tab) */
  disposedTabIds: string[];
}

function makeTab(cwd: string): TabState {
  return { id: crypto.randomUUID(), title: basename(cwd), cwd };
}

/**
 * @param local 本地 workspace 视图态全量(含全部 host,未按 scope 预过滤)
 * @param activeWorkspaceId 本端当前激活 workspace id
 * @param snapshot 某一台 host(=scopeHostId)的 workspace 全量快照
 * @param scopeHostId 本次快照归属的 host('local' 或 configId);只有该 host 的 ws 参与协调,
 *   其余 host 的 ws 原位透传不动。
 */
export function reconcileWorkspaces(
  local: WorkspaceState[],
  activeWorkspaceId: string | null,
  snapshot: WorkspaceEntry[],
  scopeHostId: string,
): ReconcileResult {
  const snapById = new Map(snapshot.map((e) => [e.id, e]));
  const inScope = local.filter((w) => w.hostId === scopeHostId);
  const inScopeIds = new Set(inScope.map((w) => w.id));
  const disposedTabIds: string[] = [];

  // ① 作用域内三分支协调(算法与单机场景等价,只是输入限定为 inScope 子集)
  const reconciled: WorkspaceState[] = [];
  for (const w of inScope) {
    const entry = snapById.get(w.id);
    if (entry) {
      // 两侧都有:仅同步 name/root,视图态原样保留
      reconciled.push({ ...w, name: entry.name, root: entry.root });
    } else {
      // 快照缺失:远端已删除 → 回收该 ws 全部 tab
      for (const t of w.tabs) disposedTabIds.push(t.id);
    }
  }
  // 快照新增的 id → 合成默认视图,hostId=scopeHostId,追加到(本作用域协调结果的)末尾
  for (const entry of snapshot) {
    if (inScopeIds.has(entry.id)) continue;
    const tab = makeTab(entry.root);
    reconciled.push({
      id: entry.id,
      name: entry.name,
      root: entry.root,
      hostId: scopeHostId,
      tabs: [tab],
      activeTabId: tab.id,
    });
  }

  // ② merge-back:按 local 原位次把 reconciled 结果填回本作用域槽位,作用域外原位透传;
  //    本作用域新增条目(local 中原本不存在的 id)追加到整个数组末尾(NIT-N2)。
  const reconciledById = new Map(reconciled.map((w) => [w.id, w]));
  const placedIds = new Set<string>();
  const workspaces: WorkspaceState[] = [];
  for (const w of local) {
    if (w.hostId === scopeHostId) {
      const r = reconciledById.get(w.id);
      if (r) {
        workspaces.push(r);
        placedIds.add(w.id);
      }
      // 否则:本作用域内被删除,位置丢弃(不占位)
    } else {
      workspaces.push(w); // 作用域外原位透传
    }
  }
  for (const r of reconciled) {
    if (!placedIds.has(r.id)) workspaces.push(r);
  }

  // ③ active 守卫:仅当原 active 属本作用域、且被本作用域快照删除时才复位;否则 active 原样
  //    不变(active 是其它 host 的 ws 时,本作用域协调不抢焦点)。复位落点在**合并后的全量数组**
  //    里找(NIT-N3):优先本机首个 workspace(不局限本作用域残留——如远程机删了正在看的
  //    workspace,本机/其它机器仍有 workspace 可看时不该晾出空 active),其次数组首个,最后 null。
  let nextActive = activeWorkspaceId;
  const activeWasInScope =
    activeWorkspaceId !== null && inScopeIds.has(activeWorkspaceId);
  if (activeWasInScope && !snapById.has(activeWorkspaceId as string)) {
    nextActive =
      workspaces.find((w) => w.hostId === LOCAL_HOST_ID)?.id ??
      workspaces[0]?.id ??
      null;
  }

  return { workspaces, activeWorkspaceId: nextActive, disposedTabIds };
}
