import type { DirEntry, GitFileStatus, GitInfo, GitStatusEntry, WorktreeInfo } from '../../shared/protocol';

export type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

/** Controller 的全部副作用入口。生产实现包 hostClient;测试注入 fake。 */
export interface FilePanelDeps {
  getSessionId(tabId: string): string | null;          // registry 实时读(spawn 不触发 React 渲染,必须每次现查)
  ptyCwd(sessionId: string): Promise<{ cwd: string | null }>;
  gitInfo(cwd: string): Promise<GitInfo>;
  gitWorktrees(cwd: string): Promise<{ worktrees: WorktreeInfo[] }>;
  gitStatus(toplevel: string): Promise<{ entries: GitStatusEntry[] }>;
  readdir(path: string): Promise<{ entries: DirEntry[] }>;
  realpath(path: string): Promise<{ path: string | null }>;
  watch(path: string): Promise<{ watchId: number }>;
  unwatch(watchId: number): Promise<void>;
  onFsChanged(cb: (watchId: number) => void): () => void;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(h: TimerHandle): void;
}

/** React 推入的外部输入。注意:不含 sessionId(经 deps.getSessionId 实时读)、不含 live cwd(Controller 自己解析)。 */
export interface FilePanelInputs {
  tabId: string | null;                 // null = 无 workspace/tab
  mode: 'root' | 'worktree';
  rootPath: string | undefined;         // tab 持久化绑定
  worktreePath: string | undefined;
  fallbackCwd: string;                  // tab.cwd ?? workspace.root ?? ''
  /** 该 tab 持久化的已展开目录(绝对路径)。仅在切到本 tab 时用于恢复展开态;
   *  不参与 inputs 全等短路与重解析判定(避免回写自激)。 */
  initialExpanded: string[];
}

export interface FilePanelState {
  /** resolve 链世代号:仅作废飞行中的 resolve(解析输入变/cd 漂移/refresh 时 +1)。树与着色不用它判过期。 */
  generation: number;
  /** 树顶层拉取序号:每次 fetchTop/partialRefreshTree 发起时 +1,结果带回比对,防同根乱序回写。 */
  topSeq: number;
  /** 着色拉取序号:每次 fetchStatus 发起或清色时 +1,同上。 */
  statusSeq: number;
  inputs: FilePanelInputs;
  // Phase 1 解析产物(null = 尚未解析;跨 tab 切换保留旧值直至新 resolveDone,与现码一致)
  autoRoot: string | null;
  autoWorktree: string | null;
  gitInfo: GitInfo | null;
  worktrees: WorktreeInfo[];
  /** 轮询基线;null = 本 tab 尚无观测(首测只记录不触发) */
  lastPolledCwd: string | null;
  // 树
  topEntries: DirEntry[];
  expanded: Set<string>;
  cache: Map<string, DirEntry[]>;
  errPaths: Set<string>;
  // 着色
  statusMap: Map<string, GitFileStatus>;
  dirtyDirs: Set<string>;
  // watch 句柄
  watchId: number | null;
  /** 派生缓存:mode==='root' ? (rootPath ?? autoRoot) : (worktreePath ?? autoWorktree);reduce 末尾维护 */
  effectiveRoot: string | null;
  activeLocateRequestId: number | null;
  activeLocateGeneration: number | null;
  activeLocateRoot: string | null;
  locateHighlightPath: string | null;
  locateScrollPath: string | null;
}

export interface LocateCommitPayload {
  targetId: number;
  generation: number;
  mode: 'root' | 'worktree';
  effectiveRoot: string;
  topEntries: DirEntry[];
  cacheDelta: Map<string, DirEntry[]>;
  requiredExpanded: Set<string>;
  highlightPath: string | null;
  scrollPath: string | null;
}

export type FilePanelEvent =
  | { t: 'inputs'; inputs: FilePanelInputs }
  | { t: 'locateStart'; targetId: number; generation: number; root: string | null }
  | { t: 'locateCommit'; payload: LocateCommitPayload }
  | { t: 'clearLocateHighlight' }
  | { t: 'clearLocateScrollPath' }
  | { t: 'resolveDone'; gen: number; autoRoot: string; autoWorktree: string | null; gitInfo: GitInfo; worktrees: WorktreeInfo[]; liveCwd: string }
  | { t: 'pollTick'; cwd: string | null }
  | { t: 'topDone'; root: string; seq: number; entries: DirEntry[] }
  | { t: 'topFail'; root: string; seq: number }
  | { t: 'watchReady'; root: string; watchId: number }
  | { t: 'statusDone'; root: string; seq: number; entries: GitStatusEntry[] }
  | { t: 'toggleDir'; absPath: string }
  | { t: 'childDone'; root: string; absPath: string; entries: DirEntry[] }
  | { t: 'childFail'; root: string; absPath: string }
  | { t: 'refresh' };

export type FilePanelEffect =
  | { k: 'resolve'; gen: number; tabId: string; rootPath: string | undefined; fallbackCwd: string }
  | { k: 'fetchTop'; root: string; seq: number }
  | { k: 'startWatch'; root: string }
  | { k: 'stopWatch'; watchId: number }
  | { k: 'fetchStatus'; root: string; seq: number }
  | { k: 'fetchChild'; root: string; absPath: string }
  | { k: 'lockRoot'; tabId: string; rootPath: string }
  | { k: 'persistMode'; tabId: string; mode: 'root' | 'worktree' }
  | { k: 'persistExpanded'; tabId: string; expanded: string[] }
  | { k: 'partialRefreshTree'; root: string; topSeq: number; expanded: string[] };

export interface ReduceOutput { state: FilePanelState; effects: FilePanelEffect[]; }

/** React 渲染用只读视图(getSnapshot 返回;字段语义与现组件渲染输入一一对应) */
export interface FilePanelView {
  effectiveRoot: string;        // '' = 未解析
  autoRoot: string;
  autoWorktree: string;
  gitInfo: GitInfo | null;
  worktrees: WorktreeInfo[];
  topEntries: DirEntry[];
  expanded: Set<string>;
  cache: Map<string, DirEntry[]>;
  errPaths: Set<string>;
  statusMap: Map<string, GitFileStatus>;
  dirtyDirs: Set<string>;
  locateHighlightPath: string | null;
  locateScrollPath: string | null;
}
