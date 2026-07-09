// 收到 workspace:changed 全量快照后的协调算法(纯函数,AC-3 P0 契约)。
// 输入:本地 workspace 视图态 + 本端 activeWorkspaceId + Host 全量快照;
// 输出:新 workspace 数组 + 新 activeWorkspaceId + 需释放的 tabId 列表(副作用由 store 执行)。
//
// 三分支(以 id 为键,非整体替换):
//   - snapshot 有、local 无 → 合成默认视图(单 root tab、不改 activeWorkspaceId、追加到末尾)。
//   - local 有、snapshot 无 → 回收(该 ws 全部 tab 记入 disposedTabIds,移除;若正激活→切首个剩余)。
//   - 两侧都有 → 仅同步 name/root,保留 tabs/activeTabId/branch 与数组位置。

import type { WorkspaceEntry } from '../../shared/protocol';
import type { TabState, WorkspaceState } from './store';
import { basename } from './pathLabel';

export interface ReconcileResult {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  /** 需 disposeTerminal 的 tabId(远端删除的 workspace 的全部 tab) */
  disposedTabIds: string[];
}

function makeTab(cwd: string): TabState {
  return { id: crypto.randomUUID(), title: basename(cwd), cwd };
}

export function reconcileWorkspaces(
  local: WorkspaceState[],
  activeWorkspaceId: string | null,
  snapshot: WorkspaceEntry[],
): ReconcileResult {
  const snapById = new Map(snapshot.map((e) => [e.id, e]));
  const localIds = new Set(local.map((w) => w.id));
  const disposedTabIds: string[] = [];

  const workspaces: WorkspaceState[] = [];
  // 先按本地顺序处理既有条目(保留排序位置)
  for (const w of local) {
    const entry = snapById.get(w.id);
    if (entry) {
      // 两侧都有:仅同步 name/root,视图态原样保留
      workspaces.push({ ...w, name: entry.name, root: entry.root });
    } else {
      // 快照缺失:远端已删除 → 回收该 ws 全部 tab
      for (const t of w.tabs) disposedTabIds.push(t.id);
    }
  }
  // 快照新增的 id → 合成默认视图,追加到末尾(不打乱既有顺序)
  for (const entry of snapshot) {
    if (localIds.has(entry.id)) continue;
    const tab = makeTab(entry.root);
    workspaces.push({
      id: entry.id,
      name: entry.name,
      root: entry.root,
      tabs: [tab],
      activeTabId: tab.id,
    });
  }

  // 激活态:仅当本端正激活的 ws 被远端删除时,切到剩余首个(不因新增/改名而变)
  let nextActive = activeWorkspaceId;
  if (activeWorkspaceId !== null && !snapById.has(activeWorkspaceId)) {
    nextActive = workspaces[0]?.id ?? null;
  }

  return { workspaces, activeWorkspaceId: nextActive, disposedTabIds };
}
