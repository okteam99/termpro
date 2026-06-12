import { useCallback, useEffect, useRef, useState } from 'react';
import { hostClient } from '../services/hostClient';
import { useAppStore, selectActiveWorkspace, tildify } from '../state/store';
import { getSessionId } from '../terminal/terminalRegistry';
import type { DirEntry, GitFileStatus, GitInfo, WorktreeInfo } from '../../shared/protocol';
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
function computeDirtyDirs(entries: { path: string }[], displayedRoot: string): Set<string> {
  const dirs = new Set<string>();
  for (const e of entries) {
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

  // epoch counter to guard stale async results
  const epochRef = useRef(0);

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

    const epoch = ++epochRef.current;

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

      if (epochRef.current !== epoch) return;

      // Resolve git info
      let info: GitInfo = { toplevel: null, mainWorktree: null, branch: null };
      try {
        info = await hostClient.rpc('git.info', { cwd });
      } catch {
        // not a git repo or unreachable
      }

      if (epochRef.current !== epoch) return;

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

      if (epochRef.current !== epoch) return;

      let wts: WorktreeInfo[] = [];
      try {
        const res = await hostClient.rpc('git.worktrees', { cwd: anchor });
        wts = res.worktrees;
      } catch {
        // non-git or unavailable
      }

      if (epochRef.current !== epoch) return;

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

      // Fetch git status — only when effectiveRoot is a known git toplevel.
      // Check: worktrees list contains effectiveRoot, or autoWorktree === effectiveRoot.
      const isGitToplevel =
        (worktrees.length > 0 && worktrees.some((wt) => wt.path === effectiveRoot)) ||
        (autoWorktree !== '' && autoWorktree === effectiveRoot);

      if (isGitToplevel) {
        try {
          const { entries } = await hostClient.rpc('git.status', { toplevel: effectiveRoot });
          if (stale()) return;
          const map = new Map<string, GitFileStatus>();
          for (const e of entries) map.set(e.path, e.status);
          setStatusMap(map);
          setDirtyDirs(computeDirtyDirs(entries, effectiveRoot));
        } catch {
          // ignore git status errors
        }
      }

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

  // ── Watch-triggered partial refresh ──
  const effectiveRootRef = useRef(effectiveRoot);
  effectiveRootRef.current = effectiveRoot;
  const gitInfoRef = useRef(gitInfo);
  gitInfoRef.current = gitInfo;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const worktreesRef = useRef(worktrees);
  worktreesRef.current = worktrees;
  const autoWorktreeRef = useRef(autoWorktree);
  autoWorktreeRef.current = autoWorktree;

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

      // Re-fetch git status
      const wts = worktreesRef.current;
      const awt = autoWorktreeRef.current;
      const isGitToplevel =
        (wts.length > 0 && wts.some((wt) => wt.path === root)) ||
        (awt !== '' && awt === root);

      if (isGitToplevel) {
        try {
          const { entries } = await hostClient.rpc('git.status', { toplevel: root });
          if (refreshEpochRef.current !== epoch) return;
          const map = new Map<string, GitFileStatus>();
          for (const e of entries) map.set(e.path, e.status);
          setStatusMap(map);
          setDirtyDirs(computeDirtyDirs(entries, root));
        } catch {
          // ignore
        }
      }
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
  function gitClassForPath(absPath: string, kind: DirEntry['kind']): string {
    if (!gitInfo?.toplevel || !effectiveRoot) return '';
    const rel = absPath.startsWith(effectiveRoot + '/')
      ? absPath.slice(effectiveRoot.length + 1)
      : absPath.startsWith(effectiveRoot)
        ? absPath.slice(effectiveRoot.length)
        : '';
    if (!rel) return '';

    if (kind === 'dir') {
      return dirtyDirs.has(rel) ? 'git-modified-dim' : '';
    }
    const status = statusMap.get(rel);
    return status ? gitStatusClass(status) : '';
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

      {/* Meta row: entry count + refresh */}
      <div className="file-panel__meta">
        <span className="file-panel__count">{topEntries.length} entries</span>
        <button className="file-panel__refresh" onClick={handleRefresh} title="Refresh">
          ⟳
        </button>
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

          return (
            <div
              key={node.absPath}
              className={rowClass}
              style={{ paddingLeft }}
              onClick={isDir && !isErr ? () => toggleDir(node.absPath) : undefined}
            >
              <span className="file-panel__arrow">
                {isDir && !isErr ? (isExpanded ? '▾' : '▸') : null}
              </span>
              <span className="file-panel__name">{node.entry.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
