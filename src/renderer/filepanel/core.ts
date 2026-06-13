// 纯 reducer + 纯 helper。零 React/hostClient/timer 依赖。
// 所有副作用意图以 FilePanelEffect 数组返回,由 Controller 执行。
// 不可变更新:每个分支产生新对象/Map/Set;「全等 inputs」路径复用原引用。

import type {
  DirEntry,
  GitStatusEntry,
  WorktreeInfo,
  GitFileStatus,
} from '../../shared/protocol';
import type {
  FilePanelEffect,
  FilePanelEvent,
  FilePanelState,
  FilePanelView,
  ReduceOutput,
} from './types';

// ── 从 FilePanel.tsx 原样迁移的纯函数(连注释一起) ──────────────────────────

// 路径拼接
export function joinPath(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : parent + '/' + name;
}

// 目录优先排序
export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (a.kind !== 'dir' && b.kind === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });
}

// Compute set of ancestor dir rel-paths that have any git status
// (ignored 不参与上卷:被忽略的内容不该把祖先目录标脏)
export function computeDirtyDirs(entries: GitStatusEntry[], _displayedRoot: string): Set<string> {
  const dirs = new Set<string>();
  for (const e of entries) {
    if (e.status === 'ignored') continue;
    // e.path is relative to the git toplevel which equals displayedRoot in both modes
    const parts = e.path.split('/');
    // add all ancestor dirs (not the file itself)
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  return dirs;
}

// Build a CSS class suffix for a given git status
export function gitStatusClass(status: GitFileStatus): string {
  switch (status) {
    case 'modified':   return 'git-modified';
    case 'added':      return 'git-added';
    case 'untracked':  return 'git-untracked';
    case 'deleted':    return 'git-deleted';
    case 'renamed':    return 'git-renamed';
    case 'ignored':    return 'git-ignored';
    case 'conflicted': return 'git-conflicted';
  }
}

// Compute a display label for a worktree entry relative to the main worktree path
export function worktreeLabel(wt: WorktreeInfo, mainPath: string): string {
  if (wt.path === mainPath) return '.';
  if (wt.path.startsWith(mainPath + '/')) return wt.path.slice(mainPath.length + 1);
  return wt.path;
}

// ── 核心状态机 ─────────────────────────────────────────────────────────────

export function initialState(): FilePanelState {
  return {
    generation: 0,
    topSeq: 0,
    statusSeq: 0,
    inputs: {
      tabId: null,
      mode: 'root',
      rootPath: undefined,
      worktreePath: undefined,
      fallbackCwd: '',
      initialExpanded: [],
    },
    autoRoot: null,
    autoWorktree: null,
    gitInfo: null,
    worktrees: [],
    lastPolledCwd: null,
    topEntries: [],
    expanded: new Set(),
    cache: new Map(),
    errPaths: new Set(),
    statusMap: new Map(),
    dirtyDirs: new Set(),
    watchId: null,
    effectiveRoot: null,
    activeLocateRequestId: null,
    activeLocateGeneration: null,
    activeLocateRoot: null,
    locateHighlightPath: null,
    locateScrollPath: null,
  };
}

/** '' 视为无值:返回值若为 '' 归一为 null */
export function computeEffectiveRoot(s: FilePanelState): string | null {
  const raw = s.inputs.mode === 'root'
    ? (s.inputs.rootPath ?? s.autoRoot ?? null)
    : (s.inputs.worktreePath ?? s.autoWorktree ?? null);
  if (!raw || raw === '') return null;
  return raw;
}

export function toView(s: FilePanelState): FilePanelView {
  return {
    effectiveRoot: s.effectiveRoot ?? '',
    autoRoot: s.autoRoot ?? '',
    autoWorktree: s.autoWorktree ?? '',
    gitInfo: s.gitInfo,
    worktrees: s.worktrees,
    topEntries: s.topEntries,
    expanded: s.expanded,
    cache: s.cache,
    errPaths: s.errPaths,
    statusMap: s.statusMap,
    dirtyDirs: s.dirtyDirs,
    locateHighlightPath: s.locateHighlightPath,
    locateScrollPath: s.locateScrollPath,
  };
}

// ── 内部 helper ──────────────────────────────────────────────────────────────

/** git 根判定:是否已知 worktree 之一(含 autoWorktree 首次解析场景) */
function isGitToplevel(s: FilePanelState, root: string): boolean {
  return s.worktrees.some((wt) => wt.path === root) || (s.autoWorktree !== null && s.autoWorktree === root);
}

/** 着色单一决策点:git 根→bump statusSeq 并发起 fetchStatus;
 *  否则若有残色→bump statusSeq(作废飞行)并清色 */
function issueStatusOrClear(
  s: FilePanelState,
  root: string | null,
): { state: FilePanelState; effects: FilePanelEffect[] } {
  if (root && isGitToplevel(s, root)) {
    const seq = s.statusSeq + 1;
    return {
      state: { ...s, statusSeq: seq },
      effects: [{ k: 'fetchStatus', root, seq }],
    };
  }
  if (s.statusMap.size > 0 || s.dirtyDirs.size > 0) {
    return {
      state: { ...s, statusSeq: s.statusSeq + 1, statusMap: new Map(), dirtyDirs: new Set() },
      effects: [],
    };
  }
  return { state: s, effects: [] };
}

/** root 变更时的树重置(topSeq/statusSeq 保持单调,不归零) */
function resetTreeForRoot(s: FilePanelState): FilePanelState {
  return {
    ...s,
    topEntries: [],
    expanded: new Set(),
    cache: new Map(),
    errPaths: new Set(),
    statusMap: new Map(),
    dirtyDirs: new Set(),
    watchId: null,
  };
}

/** 用持久化展开集恢复展开态:过滤到 root 之内(异根残留丢弃),按需补拉子目录。
 *  cacheCleared=true(刚 resetTreeForRoot 清空缓存)→ 全部补拉;
 *  否则(同根换 tab,缓存仍在)→ 仅补拉未缓存且非 errPaths 的。 */
function seedExpanded(
  s: FilePanelState,
  seed: string[],
  root: string,
  cacheCleared: boolean,
): { expanded: Set<string>; effects: FilePanelEffect[] } {
  const prefix = root + '/';
  const expanded = new Set<string>();
  const effects: FilePanelEffect[] = [];
  for (const p of seed) {
    if (!p.startsWith(prefix)) continue; // 越界(异根残留)丢弃
    expanded.add(p);
    if (cacheCleared || (!s.cache.has(p) && !s.errPaths.has(p))) {
      effects.push({ k: 'fetchChild', root, absPath: p });
    }
  }
  return { expanded, effects };
}

/** root 变化时的「停旧 watch + 重置树 + 拉新树 + 建新 watch + 恢复展开 + 着色」组合。
 *  seed 非空(切到某 tab 时传入该 tab 持久化展开集)→ 重置后立即恢复展开并补拉。 */
function applyRootChange(
  s: FilePanelState,
  newEff: string | null,
  prevWatchId: number | null,
  seed: string[] | null,
): { state: FilePanelState; effects: FilePanelEffect[] } {
  const effects: FilePanelEffect[] = [];

  // 停旧 watch
  if (prevWatchId !== null) {
    effects.push({ k: 'stopWatch', watchId: prevWatchId });
  }

  // 重置树
  let s2 = resetTreeForRoot(s);

  if (newEff !== null) {
    // 顶层拉取
    const topSeq = s2.topSeq + 1;
    s2 = { ...s2, topSeq };
    effects.push({ k: 'fetchTop', root: newEff, seq: topSeq });
    effects.push({ k: 'startWatch', root: newEff });

    // 恢复展开态(缓存已清,全部补拉)
    if (seed && seed.length > 0) {
      const seeded = seedExpanded(s2, seed, newEff, true);
      s2 = { ...s2, expanded: seeded.expanded };
      effects.push(...seeded.effects);
    }
  }

  // 更新 effectiveRoot
  s2 = { ...s2, effectiveRoot: newEff };

  // 着色
  const { state: s3, effects: statusEffects } = issueStatusOrClear(s2, newEff);
  return { state: s3, effects: [...effects, ...statusEffects] };
}

function clearLocateState(s: FilePanelState): FilePanelState {
  if (
    s.activeLocateRequestId === null &&
    s.activeLocateGeneration === null &&
    s.activeLocateRoot === null &&
    s.locateHighlightPath === null &&
    s.locateScrollPath === null
  ) {
    return s;
  }
  return {
    ...s,
    activeLocateRequestId: null,
    activeLocateGeneration: null,
    activeLocateRoot: null,
    locateHighlightPath: null,
    locateScrollPath: null,
  };
}

function applyLocateCommit(
  state: FilePanelState,
  ev: Extract<FilePanelEvent, { t: 'locateCommit' }>,
): ReduceOutput {
  const p = ev.payload;
  if (
    state.activeLocateRequestId !== p.targetId ||
    state.activeLocateGeneration !== p.generation ||
    state.generation !== p.generation
  ) {
    return { state, effects: [] };
  }

  const effects: FilePanelEffect[] = [];
  const rootChanged = state.effectiveRoot !== p.effectiveRoot;
  let cache: Map<string, DirEntry[]>;
  let topEntries = state.topEntries;
  let expanded: Set<string>;
  let s2: FilePanelState = {
    ...state,
    inputs: { ...state.inputs, mode: p.mode },
    effectiveRoot: p.effectiveRoot,
    locateHighlightPath: p.highlightPath,
    locateScrollPath: p.scrollPath,
    activeLocateRequestId: null,
    activeLocateGeneration: null,
    activeLocateRoot: null,
  };

  if (rootChanged) {
    if (state.watchId !== null) effects.push({ k: 'stopWatch', watchId: state.watchId });
    cache = new Map(p.cacheDelta);
    expanded = new Set(p.requiredExpanded);
    topEntries = sortEntries(p.topEntries);
    s2 = {
      ...s2,
      topSeq: state.topSeq + 1,
      topEntries,
      expanded,
      cache,
      errPaths: new Set(),
      statusMap: new Map(),
      dirtyDirs: new Set(),
      watchId: null,
    };
    effects.push({ k: 'startWatch', root: p.effectiveRoot });
    const issued = issueStatusOrClear(s2, p.effectiveRoot);
    s2 = issued.state;
    effects.push(...issued.effects);
  } else {
    cache = new Map(state.cache);
    for (const [path, entries] of p.cacheDelta) {
      if (!cache.has(path)) cache.set(path, sortEntries(entries));
    }
    expanded = new Set(state.expanded);
    for (const path of p.requiredExpanded) expanded.add(path);
    if (p.topEntries.length > 0 && state.topEntries.length === 0) {
      topEntries = sortEntries(p.topEntries);
    }
    s2 = { ...s2, topEntries, expanded, cache };
  }

  if (s2.inputs.tabId !== null) {
    if (state.inputs.mode !== p.mode) {
      effects.push({ k: 'persistMode', tabId: s2.inputs.tabId, mode: p.mode });
    }
    effects.push({ k: 'persistExpanded', tabId: s2.inputs.tabId, expanded: [...expanded] });
  }

  return { state: s2, effects };
}

// ── 全文件唯一过期闸(按序) ──────────────────────────────────────────────────
// 1. resolveDone gen 不符 → 丢弃
// 2. 含 root 字段的事件 root !== effectiveRoot → 丢弃
// 3. topDone/topFail seq 不符、statusDone seq 不符 → 丢弃

export function reduce(state: FilePanelState, ev: FilePanelEvent): ReduceOutput {
  if (ev.t === 'locateCommit') {
    return applyLocateCommit(state, ev);
  }

  // ── 过期闸 1:resolveDone gen ──
  if (ev.t === 'resolveDone' && ev.gen !== state.generation) {
    return { state, effects: [] };
  }

  // ── 过期闸 2:root 字段 ──
  if (
    ev.t === 'topDone' ||
    ev.t === 'topFail' ||
    ev.t === 'watchReady' ||
    ev.t === 'statusDone' ||
    ev.t === 'childDone' ||
    ev.t === 'childFail'
  ) {
    if (ev.root !== state.effectiveRoot) {
      return { state, effects: [] };
    }
  }

  // ── 过期闸 3:seq ──
  if ((ev.t === 'topDone' || ev.t === 'topFail') && ev.seq !== state.topSeq) {
    return { state, effects: [] };
  }
  if (ev.t === 'statusDone' && ev.seq !== state.statusSeq) {
    return { state, effects: [] };
  }

  // ── 各事件分支 ────────────────────────────────────────────────────────────

  switch (ev.t) {
    case 'locateStart':
      return {
        state: {
          ...state,
          activeLocateRequestId: ev.targetId,
          activeLocateGeneration: ev.generation,
          activeLocateRoot: ev.root,
          locateHighlightPath: null,
          locateScrollPath: null,
        },
        effects: [],
      };

    case 'clearLocateHighlight':
      return { state: clearLocateState(state), effects: [] };

    case 'clearLocateScrollPath':
      return state.locateScrollPath === null
        ? { state, effects: [] }
        : { state: { ...state, locateScrollPath: null }, effects: [] };

    case 'inputs': {
      const prev = state.inputs;
      const next = ev.inputs;

      // 全等短路:防重复推送
      if (
        prev.tabId === next.tabId &&
        prev.mode === next.mode &&
        prev.rootPath === next.rootPath &&
        prev.worktreePath === next.worktreePath &&
        prev.fallbackCwd === next.fallbackCwd
      ) {
        return { state, effects: [] };
      }

      const tabChanged = prev.tabId !== next.tabId;
      // mode/worktreePath 不触发重解析
      const resolveInputsChanged =
        tabChanged || prev.rootPath !== next.rootPath || prev.fallbackCwd !== next.fallbackCwd;

      let s2: FilePanelState = { ...state, inputs: next };
      if (tabChanged) s2 = clearLocateState({ ...s2, lastPolledCwd: null });

      const effects: FilePanelEffect[] = [];

      if (resolveInputsChanged) {
        const gen = s2.generation + 1;
        s2 = { ...s2, generation: gen };
        if (next.tabId !== null) {
          effects.push({
            k: 'resolve',
            gen,
            tabId: next.tabId,
            rootPath: next.rootPath,
            fallbackCwd: next.fallbackCwd,
          });
        }
        // tabId 变 null 只 bump gen,不发 resolve
      }

      // root 变化判定(依赖新 inputs,不依赖飞行中 resolve 结果)
      const newEff = computeEffectiveRoot(s2);
      if (newEff !== state.effectiveRoot) {
        // 切到本 tab 时用其持久化展开集恢复(树将重置,故全部补拉)
        const { state: s3, effects: rootEffects } = applyRootChange(
          s2,
          newEff,
          state.watchId,
          tabChanged ? next.initialExpanded : null,
        );
        return { state: clearLocateState(s3), effects: [...effects, ...rootEffects] };
      }

      // root 没变但换了 tab(两 tab 同根):树/缓存保留,展开集换成新 tab 的(隔离),
      // 缺失子目录按需补拉——否则上一 tab 的展开态会串到本 tab。
      if (tabChanged && newEff !== null) {
        const seeded = seedExpanded(s2, next.initialExpanded, newEff, false);
        s2 = { ...s2, expanded: seeded.expanded, effectiveRoot: newEff };
        return { state: clearLocateState(s2), effects: [...effects, ...seeded.effects] };
      }

      // root 没变且非换 tab:不碰树/着色
      s2 = { ...s2, effectiveRoot: newEff };
      return { state: s2, effects };
    }

    case 'resolveDone': {
      // gen 闸已过
      let s2: FilePanelState = {
        ...state,
        autoRoot: ev.autoRoot,
        autoWorktree: ev.autoWorktree,
        gitInfo: ev.gitInfo,
        worktrees: ev.worktrees,
        lastPolledCwd: ev.liveCwd,
      };

      const effects: FilePanelEffect[] = [];

      // Root 锁定:首次自动写死
      if (s2.inputs.tabId && ev.autoRoot && s2.inputs.rootPath === undefined) {
        effects.push({ k: 'lockRoot', tabId: s2.inputs.tabId, rootPath: ev.autoRoot });
      }

      const newEff = computeEffectiveRoot(s2);
      if (newEff !== state.effectiveRoot) {
        // 展开恢复由 inputs 路径负责(切 tab 时 rootPath 已锁定即走该路径);
        // 此处仅 cwd 漂移/首解析建根,无 seed。
        const { state: s3, effects: rootEffects } = applyRootChange(
          s2,
          newEff,
          state.watchId,
          null,
        );
        return { state: clearLocateState(s3), effects: [...effects, ...rootEffects] };
      }

      // root 没变:effectiveRoot 同值,但着色必须补拉(历史 bug 0907491 修复)
      s2 = { ...s2, effectiveRoot: newEff };
      const { state: s3, effects: statusEffects } = issueStatusOrClear(s2, newEff);
      return { state: s3, effects: [...effects, ...statusEffects] };
    }

    case 'pollTick': {
      // cwd 为 null/空 → 原 state
      if (!ev.cwd) return { state, effects: [] };

      const prev = state.lastPolledCwd;
      const s2 = { ...state, lastPolledCwd: ev.cwd };

      // 首测(prev===null)或同值 → 只记录
      if (prev === null || ev.cwd === prev) {
        return { state: s2, effects: [] };
      }

      // cd 漂移:gen+1,重解析,不碰树/watch/着色
      const gen = s2.generation + 1;
      const s3 = clearLocateState({ ...s2, generation: gen });
      const effects: FilePanelEffect[] = [];
      if (s3.inputs.tabId !== null) {
        effects.push({
          k: 'resolve',
          gen,
          tabId: s3.inputs.tabId,
          rootPath: s3.inputs.rootPath,
          fallbackCwd: s3.inputs.fallbackCwd,
        });
      }
      return { state: s3, effects };
    }

    case 'topDone': {
      // root+seq 闸已过
      return {
        state: { ...state, topEntries: sortEntries(ev.entries) },
        effects: [],
      };
    }

    case 'topFail': {
      // root+seq 闸已过;首拉失败显示空
      return { state: { ...state, topEntries: [] }, effects: [] };
    }

    case 'watchReady': {
      // root 闸已过。同根快速往返(A→B→A)可能并发两个 startWatch:
      // 采纳后到者,旧 watchId 必须补停,否则 host 侧 watcher 泄漏
      const effects: FilePanelEffect[] =
        state.watchId !== null && state.watchId !== ev.watchId
          ? [{ k: 'stopWatch', watchId: state.watchId }]
          : [];
      return { state: { ...state, watchId: ev.watchId }, effects };
    }

    case 'statusDone': {
      // root+seq 闸已过
      const map = new Map<string, GitFileStatus>();
      for (const e of ev.entries) map.set(e.path, e.status);
      const dirtyDirs = computeDirtyDirs(ev.entries, ev.root);
      return { state: { ...state, statusMap: map, dirtyDirs }, effects: [] };
    }

    case 'toggleDir': {
      const { absPath } = ev;
      const effects: FilePanelEffect[] = [];
      const expanded = new Set(state.expanded);

      if (expanded.has(absPath)) {
        // 收起:cache/errPaths 保留,re-expand 不重拉
        expanded.delete(absPath);
      } else {
        // 展开
        expanded.add(absPath);
        if (!state.cache.has(absPath) && state.effectiveRoot !== null) {
          effects.push({ k: 'fetchChild', root: state.effectiveRoot, absPath });
        }
      }

      // 持久化展开态到本 tab(切 tab/工作区/重启后恢复)
      if (state.inputs.tabId !== null) {
        effects.push({ k: 'persistExpanded', tabId: state.inputs.tabId, expanded: [...expanded] });
      }
      return { state: clearLocateState({ ...state, expanded }), effects };
    }

    case 'childDone': {
      // root 闸已过
      const cache = new Map(state.cache).set(ev.absPath, sortEntries(ev.entries));
      return { state: { ...state, cache }, effects: [] };
    }

    case 'childFail': {
      // root 闸已过;errPaths 一旦加入不移除(与现码语义一致)
      const errPaths = new Set(state.errPaths);
      errPaths.add(ev.absPath);
      return { state: { ...state, errPaths }, effects: [] };
    }

    case 'refresh': {
      // gen+1,重解析;effectiveRoot 非 null 时 partialRefreshTree + 着色
      const gen = state.generation + 1;
      let s2 = clearLocateState({ ...state, generation: gen });
      const effects: FilePanelEffect[] = [];

      // 无条件重发 resolve(即使 effectiveRoot 为 null,现码语义:refreshKey 无条件重跑 Phase 1)
      if (s2.inputs.tabId !== null) {
        effects.push({
          k: 'resolve',
          gen,
          tabId: s2.inputs.tabId,
          rootPath: s2.inputs.rootPath,
          fallbackCwd: s2.inputs.fallbackCwd,
        });
      }

      if (s2.effectiveRoot !== null) {
        const curRoot = s2.effectiveRoot;
        const topSeq = s2.topSeq + 1;
        s2 = { ...s2, topSeq };
        effects.push({
          k: 'partialRefreshTree',
          root: curRoot,
          topSeq,
          expanded: [...s2.expanded],
        });

        // 着色
        const { state: s3, effects: statusEffects } = issueStatusOrClear(s2, curRoot);
        return { state: s3, effects: [...effects, ...statusEffects] };
      }

      return { state: s2, effects };
    }
  }
}
