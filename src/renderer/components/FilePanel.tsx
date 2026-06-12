import { useCallback, useEffect, useRef, useState } from 'react';
import { hostClient } from '../services/hostClient';
import { useAppStore, selectActiveWorkspace, tildify } from '../state/store';
import { getSessionId } from '../terminal/terminalRegistry';
import type { DirEntry, GitFileStatus, GitInfo, GitStatusEntry, WorktreeInfo } from '../../shared/protocol';
import './FilePanel.css';

interface TreeNode {
  entry: DirEntry;
  absPath: string;
  depth: number;
}

// 路径拼接
function joinPath(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : parent + '/' + name;
}

// 目录优先排序
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (a.kind !== 'dir' && b.kind === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });
}

// Compute set of ancestor dir rel-paths that have any git status
// (ignored 不参与上卷:被忽略的内容不该把祖先目录标脏)
function computeDirtyDirs(entries: GitStatusEntry[], displayedRoot: string): Set<string> {
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
function gitStatusClass(status: GitFileStatus): string {
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
function worktreeLabel(wt: WorktreeInfo, mainPath: string): string {
  if (wt.path === mainPath) return '.';
  if (wt.path.startsWith(mainPath + '/')) return wt.path.slice(mainPath.length + 1);
  return wt.path;
}

export function FilePanel() {
  const workspace = useAppStore(selectActiveWorkspace);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const updateTabFilePanel = useAppStore((s) => s.updateTabFilePanel);

  // Active tab from the workspace
  const activeTab = workspace?.tabs.find((t) => t.id === workspace.activeTabId);

  // Per-tab persisted file panel state (read only — write via updateTabFilePanel)
  const fp = activeTab?.filePanel;
  const mode = fp?.mode ?? 'root';

  // Auto-detected values (computed async)
  const [autoRoot, setAutoRoot] = useState<string>('');
  const [autoWorktree, setAutoWorktree] = useState<string>('');
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);

  // Root mode: draft path for the text input (mirrors effective root, reset on tab/root change)
  const [rootInputDraft, setRootInputDraft] = useState<string>('');

  // Effective displayed root
  const effectiveRoot = mode === 'root'
    ? (fp?.rootPath ?? autoRoot)
    : (fp?.worktreePath ?? autoWorktree);

  // Git status: map relPath -> status, plus dirty-dir set
  const [statusMap, setStatusMap] = useState<Map<string, GitFileStatus>>(new Map());
  const [dirtyDirs, setDirtyDirs] = useState<Set<string>>(new Set());

  // Top-level entries
  const [topEntries, setTopEntries] = useState<DirEntry[]>([]);
  // Expanded state Set<absPath>
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Child dir cache Map<absPath, DirEntry[]>
  const [cache, setCache] = useState<Map<string, DirEntry[]>>(new Map());
  // Error paths Set<absPath>
  const [errPaths, setErrPaths] = useState<Set<string>>(new Set());
  // Refresh counter for forced re-fetch
  const [refreshKey, setRefreshKey] = useState(0);
  // 活动 tab 实时 cwd 变化计数:只触发 Phase 1 重解析(提示行/auto 值),不重拉树
  const [cwdEpoch, setCwdEpoch] = useState(0);
  const lastCwdRef = useRef<string | null>(null);

  // epoch counters guard stale async results。Phase 1(auto 解析)与
  // Phase 2(树/watch)是相互独立的异步流,必须各用各的计数器:
  // 首启时持久化的 rootPath 让 Phase 2 与 Phase 1 并发,共用会互相误杀
  const epochRef = useRef(0);
  const resolveEpochRef = useRef(0);

  // Track current watchId and unsubscribe function so we can clean up
  const watchIdRef = useRef<number | null>(null);
  const fsUnsubRef = useRef<(() => void) | null>(null);
  // debounce timer ref for watch-triggered refresh
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scheduled refresh: re-fetch tree + expanded dirs + git status without collapsing
  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setRefreshKey((k) => k + 1);
    }, 250);
  }, []);

  // Cleanup watcher helper
  const cleanupWatcher = useCallback(() => {
    if (fsUnsubRef.current) {
      fsUnsubRef.current();
      fsUnsubRef.current = null;
    }
    if (watchIdRef.current !== null) {
      const id = watchIdRef.current;
      watchIdRef.current = null;
      void hostClient.rpc('fs.unwatch', { watchId: id }).catch(() => {});
    }
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  // 轮询活动 tab 的 shell 实时 cwd(2s):没有 OSC 7 的 shell 下,
  // 提示行与 WorkTree 默认值也能跟随 cd。只盯一个会话,lsof 成本可忽略。
  const pollTabId = activeTab?.id;
  useEffect(() => {
    if (!pollTabId) return;
    lastCwdRef.current = null;
    const timer = setInterval(() => {
      const sid = getSessionId(pollTabId);
      if (!sid) return;
      hostClient
        .rpc('pty.cwd', { sessionId: sid })
        .then(({ cwd }) => {
          if (!cwd) return;
          if (lastCwdRef.current !== null && cwd !== lastCwdRef.current) {
            setCwdEpoch((e) => e + 1);
          }
          lastCwdRef.current = cwd;
        })
        .catch(() => {});
    }, 2_000);
    return () => clearInterval(timer);
  }, [pollTabId]);

  // ── Phase 1: resolve auto root/worktree + git info + worktrees whenever active tab / refreshKey changes ──
  useEffect(() => {
    if (!workspace) return;

    const epoch = ++resolveEpochRef.current;

    async function resolve() {
      if (!workspace) return;

      const tab = workspace.tabs.find((t) => t.id === workspace.activeTabId);

      // Resolve live cwd
      const sid = tab ? getSessionId(tab.id) : null;
      let cwd: string | null = null;
      if (sid) {
        try {
          const res = await hostClient.rpc('pty.cwd', { sessionId: sid });
          cwd = res.cwd;
        } catch {
          cwd = null;
        }
      }
      cwd = cwd ?? tab?.cwd ?? workspace.root;

      if (resolveEpochRef.current !== epoch) return;

      // Resolve git info
      let info: GitInfo = { toplevel: null, mainWorktree: null, branch: null };
      try {
        info = await hostClient.rpc('git.info', { cwd });
      } catch {
        // not a git repo or unreachable
      }

      if (resolveEpochRef.current !== epoch) return;

      // live cwd 只用于提示行与首次锁定
      const newAutoRoot = info.mainWorktree ?? cwd;

      // WorkTree 锚点 = Root 绑定目录(未绑定则用本次解析的主目录):
      // worktree 列表、默认选中、着色守卫都从锚点仓库推导,不随 cd 漂移
      const anchor = tab?.filePanel?.rootPath ?? newAutoRoot;

      let anchorInfo: GitInfo = {
        toplevel: null,
        mainWorktree: null,
        branch: null,
      };
      try {
        anchorInfo = await hostClient.rpc('git.info', { cwd: anchor });
      } catch {
        // 锚点不是 git 目录
      }

      if (resolveEpochRef.current !== epoch) return;

      let wts: WorktreeInfo[] = [];
      try {
        const res = await hostClient.rpc('git.worktrees', { cwd: anchor });
        wts = res.worktrees;
      } catch {
        // non-git or unavailable
      }

      if (resolveEpochRef.current !== epoch) return;

      setAutoRoot(newAutoRoot);
      setAutoWorktree(anchorInfo.toplevel ?? anchor);
      setGitInfo(anchorInfo);
      setWorktrees(wts);

      // Root 锁定语义:tab 首次进入时把主目录写死到绑定里,
      // 此后不随终端 cd 漂移,只有显式输入/Choose/Apply 才变更
      if (tab && newAutoRoot) {
        const live = useAppStore.getState();
        const liveTab = live.workspaces
          .flatMap((w) => w.tabs)
          .find((t) => t.id === tab.id);
        if (liveTab && liveTab.filePanel?.rootPath === undefined) {
          live.updateTabFilePanel(tab.id, { rootPath: newAutoRoot });
        }
      }
    }

    void resolve();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, workspace?.activeTabId, activeTab?.cwd, fp?.rootPath, refreshKey, cwdEpoch]);

  // Reset rootInputDraft whenever the effective root or active tab changes
  const activeTabId = activeTab?.id;
  const fpRootPath = fp?.rootPath;
  useEffect(() => {
    setRootInputDraft(effectiveRoot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRoot, activeTabId, fpRootPath]);

  // ── Phase 2: when effectiveRoot changes, fetch tree + git status + setup watcher ──
  useEffect(() => {
    if (!effectiveRoot) return;

    const epoch = ++epochRef.current;
    // cancelled flag covers unmount race vs in-flight fs.watch
    let cancelled = false;
    const stale = () => cancelled || epochRef.current !== epoch;

    // Clean up old watcher before setting a new one
    cleanupWatcher();

    // Reset tree state when root changes
    setTopEntries([]);
    setStatusMap(new Map());
    setDirtyDirs(new Set());

    async function fetchAll() {
      // Fetch top-level entries
      try {
        const { entries } = await hostClient.rpc('fs.readdir', { path: effectiveRoot });
        if (stale()) return;
        setTopEntries(sortEntries(entries));
      } catch {
        if (stale()) return;
        setTopEntries([]);
      }

      // git 状态由独立 effect 拉取(见下),这里只管树与 watch

      // Setup fs.watch — return watchId immediately if stale
      if (stale()) return;
      try {
        const { watchId } = await hostClient.rpc('fs.watch', { path: effectiveRoot });
        if (stale()) {
          void hostClient.rpc('fs.unwatch', { watchId }).catch(() => {});
          return;
        }
        watchIdRef.current = watchId;
        fsUnsubRef.current = hostClient.onFsChanged((id) => {
          if (id === watchId) scheduleRefresh();
        });
      } catch {
        // fs.watch not available, continue without watcher
      }
    }

    void fetchAll();

    return () => {
      cancelled = true;
      cleanupWatcher();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRoot]);

  // ── git 状态着色:独立 effect ──
  // 首启竞态:持久化 rootPath 使 Phase 2 先于 Phase 1 执行,彼时
  // worktrees/autoWorktree 还是空值,「是否 git 根」误判为否而跳过
  // git.status;Phase 1 补全后 effectiveRoot 未变、Phase 2 不重跑,
  // 颜色永远缺席。独立依赖这些输入后,谁后到都能补上。
  const statusEpochRef = useRef(0);
  useEffect(() => {
    if (!effectiveRoot) return;
    const epoch = ++statusEpochRef.current;
    const isGitToplevel =
      (worktrees.length > 0 &&
        worktrees.some((wt) => wt.path === effectiveRoot)) ||
      (autoWorktree !== '' && autoWorktree === effectiveRoot);
    if (!isGitToplevel) {
      setStatusMap(new Map());
      setDirtyDirs(new Set());
      return;
    }
    hostClient
      .rpc('git.status', { toplevel: effectiveRoot })
      .then(({ entries }) => {
        if (statusEpochRef.current !== epoch) return;
        const map = new Map<string, GitFileStatus>();
        for (const e of entries) map.set(e.path, e.status);
        setStatusMap(map);
        setDirtyDirs(computeDirtyDirs(entries, effectiveRoot));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRoot, worktrees, autoWorktree, refreshKey]);

  // ── Watch-triggered partial refresh ──
  const effectiveRootRef = useRef(effectiveRoot);
  effectiveRootRef.current = effectiveRoot;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const refreshEpochRef = useRef(0);
  const prevRootRef = useRef('');
  useEffect(() => {
    const root = effectiveRootRef.current;
    if (!root) return;
    // If root changed, Phase 2 handles it; skip partial refresh here
    if (prevRootRef.current !== root) {
      prevRootRef.current = root;
      return;
    }

    const epoch = ++refreshEpochRef.current;

    async function partialRefresh() {
      const root = effectiveRootRef.current;
      if (!root) return;

      // Re-fetch top-level
      try {
        const { entries } = await hostClient.rpc('fs.readdir', { path: root });
        if (refreshEpochRef.current !== epoch) return;
        setTopEntries(sortEntries(entries));
      } catch {
        if (refreshEpochRef.current !== epoch) return;
      }

      // Re-fetch all expanded dirs to keep cache fresh
      const expandedPaths = [...expandedRef.current];
      for (const absPath of expandedPaths) {
        try {
          const { entries } = await hostClient.rpc('fs.readdir', { path: absPath });
          if (refreshEpochRef.current !== epoch) return;
          setCache((c) => new Map(c).set(absPath, sortEntries(entries)));
        } catch {
          // keep existing cached data
        }
      }

      // git 状态:由独立的着色 effect 随 refreshKey 一并刷新
    }

    void partialRefresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Reset tree expansion only when effectiveRoot actually changes
  useEffect(() => {
    setExpanded(new Set());
    setCache(new Map());
    setErrPaths(new Set());
  }, [effectiveRoot]);

  // ── Manual refresh ──
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // ── Expand / collapse ──
  const toggleDir = useCallback(
    (absPath: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(absPath)) {
          next.delete(absPath);
        } else {
          next.add(absPath);
          // lazy-load if not yet cached
          if (!cache.has(absPath)) {
            hostClient
              .rpc('fs.readdir', { path: absPath })
              .then(({ entries }) => {
                setCache((c) => new Map(c).set(absPath, sortEntries(entries)));
              })
              .catch(() => {
                setErrPaths((s) => new Set(s).add(absPath));
              });
          }
        }
        return next;
      });
    },
    [cache],
  );

  // ── Flatten tree ──
  function flattenTree(entries: DirEntry[], parentPath: string, depth: number): TreeNode[] {
    const rows: TreeNode[] = [];
    for (const entry of entries) {
      const absPath = joinPath(parentPath, entry.name);
      rows.push({ entry, absPath, depth });
      if (entry.kind === 'dir' && expanded.has(absPath)) {
        if (errPaths.has(absPath)) {
          rows.push({
            entry: { name: '(unreadable)', kind: 'other' },
            absPath: absPath + '/__err__',
            depth: depth + 1,
          });
        } else {
          const children = cache.get(absPath);
          if (children) {
            rows.push(...flattenTree(children, absPath, depth + 1));
          }
        }
      }
    }
    return rows;
  }

  // ── Git class for a row ──
  /** 最近被整体折叠的祖先目录状态(git status 把未跟踪/忽略目录
   *  折叠成一条 `?? dir/`,目录内的条目没有自己的记录,需继承) */
  function ancestorStatus(rel: string): GitFileStatus | null {
    let idx = rel.lastIndexOf('/');
    while (idx > 0) {
      const s = statusMap.get(rel.slice(0, idx));
      if (s === 'untracked' || s === 'ignored') return s;
      idx = rel.lastIndexOf('/', idx - 1);
    }
    return null;
  }

  function gitClassForPath(absPath: string, kind: DirEntry['kind']): string {
    if (!gitInfo?.toplevel || !effectiveRoot) return '';
    const rel = absPath.startsWith(effectiveRoot + '/')
      ? absPath.slice(effectiveRoot.length + 1)
      : absPath.startsWith(effectiveRoot)
        ? absPath.slice(effectiveRoot.length)
        : '';
    if (!rel) return '';

    if (kind === 'dir') {
      // 目录自身状态优先(整目录 ignored/untracked),再看祖先折叠,
      // 否则看子孙上卷
      const direct = statusMap.get(rel) ?? ancestorStatus(rel);
      if (direct === 'ignored') return 'git-ignored';
      if (direct === 'untracked') return 'git-untracked';
      return dirtyDirs.has(rel) ? 'git-modified-dim' : '';
    }
    const status = statusMap.get(rel) ?? ancestorStatus(rel);
    return status ? gitStatusClass(status) : '';
  }

  /** 文件相对 effectiveRoot 的 git 状态(无状态/越界 → null) */
  function fileStatusForPath(absPath: string): GitFileStatus | null {
    if (!effectiveRoot || !absPath.startsWith(effectiveRoot + '/')) return null;
    return statusMap.get(absPath.slice(effectiveRoot.length + 1)) ?? null;
  }

  /** Diff 窗口上下文(头部 Diff 按钮与行级 diff 按钮共用) */
  function diffContext(): { toplevel: string; baseRef: string | null } {
    const toplevel = worktrees.some((wt) => wt.path === effectiveRoot)
      ? effectiveRoot!
      : autoWorktree!;
    const isMainWorktree = effectiveRoot === mainWorktreePath;
    const mainBranch = worktrees[0]?.branch ?? null;
    return {
      toplevel,
      baseRef: !isMainWorktree && mainBranch ? mainBranch : null,
    };
  }

  const homedir = hostClient.info?.homedir;

  // ── Header control: Root mode ──
  const handleRootChoose = useCallback(async () => {
    if (!activeTab) return;
    const dir = await window.termpro.pickDirectory();
    if (dir) {
      updateTabFilePanel(activeTab.id, { rootPath: dir });
    }
  }, [activeTab, updateTabFilePanel]);

  const handleRootInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const trimmed = rootInputDraft.trim();
        if (trimmed && activeTab) {
          updateTabFilePanel(activeTab.id, { rootPath: trimmed });
        }
      }
    },
    [rootInputDraft, activeTab, updateTabFilePanel],
  );

  const handleRootApply = useCallback(() => {
    if (!activeTab || !autoRoot) return;
    updateTabFilePanel(activeTab.id, { rootPath: autoRoot });
  }, [activeTab, autoRoot, updateTabFilePanel]);

  // ── Header control: WorkTree mode ──
  const handleWorktreeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!activeTab) return;
      updateTabFilePanel(activeTab.id, { worktreePath: e.target.value, mode: 'worktree' });
    },
    [activeTab, updateTabFilePanel],
  );

  const handleWorktreeReload = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // ── Mode toggle ──
  const handleModeRoot = useCallback(() => {
    if (!activeTab) return;
    updateTabFilePanel(activeTab.id, { mode: 'root' });
  }, [activeTab, updateTabFilePanel]);

  const handleModeWorktree = useCallback(() => {
    if (!activeTab) return;
    updateTabFilePanel(activeTab.id, { mode: 'worktree' });
  }, [activeTab, updateTabFilePanel]);

  if (!workspace) {
    return (
      <div className="file-panel">
        <div className="file-panel__empty">No session</div>
      </div>
    );
  }

  const rows = flattenTree(topEntries, effectiveRoot, 0);

  // Worktree: selected worktree info for the info line
  const selectedWorktreePath = fp?.worktreePath ?? autoWorktree;
  const selectedWt = worktrees.find((wt) => wt.path === selectedWorktreePath) ?? worktrees[0];
  const isGitRepo = worktrees.length > 0;
  const mainWorktreePath = worktrees[0]?.path ?? '';

  // Root mode: autoRoot tildified for hint
  const autoRootDisplay = autoRoot ? tildify(autoRoot, homedir) : '';
  const effectiveRootForRoot = fp?.rootPath ?? autoRoot;
  const applyDisabled = !autoRoot || effectiveRootForRoot === autoRoot;

  return (
    <div className="file-panel">
      {/* Draggable top bar + segmented toggle */}
      <div className="file-panel__header">
        <div className="file-panel__seg">
          <button
            className={`file-panel__seg-btn${mode === 'root' ? ' file-panel__seg-btn--active' : ''}`}
            onClick={handleModeRoot}
          >
            Root
          </button>
          <button
            className={`file-panel__seg-btn${mode === 'worktree' ? ' file-panel__seg-btn--active' : ''}`}
            onClick={handleModeWorktree}
          >
            WorkTree
          </button>
        </div>
      </div>

      {/* Control rows */}
      <div className="file-panel__controls">
        {mode === 'root' ? (
          <>
            {/* Row 1: path input + Choose button */}
            <div className="file-panel__ctrl-row">
              <input
                className="file-panel__path-input"
                type="text"
                value={rootInputDraft}
                onChange={(e) => setRootInputDraft(e.target.value)}
                onKeyDown={handleRootInputKeyDown}
                spellCheck={false}
                title={rootInputDraft}
              />
              <button className="file-panel__ctrl-btn" onClick={() => void handleRootChoose()}>
                Choose…
              </button>
            </div>
            {/* Row 2: autoRoot hint + Apply button */}
            <div className="file-panel__ctrl-row file-panel__ctrl-row--hint">
              <span className="file-panel__hint" title={autoRoot}>
                {autoRootDisplay || '—'}
              </span>
              <button
                className="file-panel__ctrl-btn"
                onClick={handleRootApply}
                disabled={applyDisabled}
              >
                Apply
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Row 1: worktree select + reload button */}
            <div className="file-panel__ctrl-row">
              <select
                className="file-panel__wt-select"
                value={selectedWorktreePath}
                onChange={handleWorktreeChange}
                disabled={!isGitRepo}
              >
                {isGitRepo ? (
                  worktrees.map((wt) => {
                    const label = worktreeLabel(wt, mainWorktreePath);
                    const optLabel = `${label} · ${wt.branch ?? wt.head}`;
                    return (
                      <option key={wt.path} value={wt.path}>
                        {optLabel}
                      </option>
                    );
                  })
                ) : (
                  <option value="">—</option>
                )}
              </select>
              <button
                className="file-panel__ctrl-btn file-panel__ctrl-btn--icon"
                onClick={handleWorktreeReload}
                title="Reload worktrees"
              >
                ⟳
              </button>
            </div>
            {/* Row 2: branch · head info */}
            <div className="file-panel__ctrl-row file-panel__ctrl-row--hint">
              <span className="file-panel__hint">
                {isGitRepo && selectedWt
                  ? `${selectedWt.branch ?? 'detached'} · ${selectedWt.head}`
                  : 'not a git repo'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Meta row: entry count + Diff button + refresh */}
      <div className="file-panel__meta">
        <span className="file-panel__count">{topEntries.length} entries</span>
        <div className="file-panel__meta-actions">
          {isGitRepo && (
            <button
              className="file-panel__diff-btn"
              title="打开 Diff 视图"
              onClick={() => {
                const { toplevel, baseRef } = diffContext();
                window.termpro.openViewerWindow({
                  mode: 'diff',
                  toplevel,
                  baseRef,
                });
              }}
            >
              Diff
            </button>
          )}
          <button className="file-panel__refresh" onClick={handleRefresh} title="Refresh">
            ⟳
          </button>
        </div>
      </div>

      <div className="file-panel__divider" />

      {/* File tree */}
      <div className="file-panel__tree">
        {rows.map((node) => {
          const isDir = node.entry.kind === 'dir';
          const isErr = node.entry.name === '(unreadable)';
          const isExpanded = expanded.has(node.absPath);
          const paddingLeft = 10 + node.depth * 14;

          const gitCls = isErr ? '' : gitClassForPath(node.absPath, node.entry.kind);

          let rowClass = 'file-panel__row';
          if (isErr) rowClass += ' file-panel__row--unreadable';
          else if (isDir) rowClass += ' file-panel__row--dir';
          else rowClass += ' file-panel__row--file';
          if (gitCls) rowClass += ` file-panel__row--${gitCls}`;

          // 有变动的文件(着色非 ignored)hover 时给行级 diff 直达按钮
          const fileStatus =
            isDir || isErr ? null : fileStatusForPath(node.absPath);
          const canDiff = !!fileStatus && fileStatus !== 'ignored';

          return (
            <div
              key={node.absPath}
              className={rowClass}
              style={{ paddingLeft }}
              onClick={
                isErr
                  ? undefined
                  : isDir
                    ? () => toggleDir(node.absPath)
                    : () => window.termpro.openViewerWindow({ mode: 'file', path: node.absPath })
              }
            >
              <span className="file-panel__arrow">
                {isDir && !isErr ? (isExpanded ? '▾' : '▸') : null}
              </span>
              <span className="file-panel__name">{node.entry.name}</span>
              {canDiff && (
                <button
                  className="file-panel__row-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    const { toplevel, baseRef } = diffContext();
                    if (!node.absPath.startsWith(toplevel + '/')) return;
                    window.termpro.openViewerWindow({
                      mode: 'diff',
                      toplevel,
                      baseRef,
                      initialPath: node.absPath.slice(toplevel.length + 1),
                    });
                  }}
                >
                  diff
                </button>
              )}
              {isDir && !isErr && (
                <button
                  className="file-panel__row-action"
                  title="在 Finder 中打开"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.termpro.openPath(node.absPath);
                  }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  >
                    <path d="M1.5 4a1 1 0 0 1 1-1h3l1.5 1.8h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
