import { useCallback, useEffect, useRef, useState } from 'react';
import { hostClient } from '../services/hostClient';
import { useAppStore, selectActiveWorkspace, tildify } from '../state/store';
import { getSessionId } from '../terminal/terminalRegistry';
import type { DirEntry, GitFileStatus, GitInfo } from '../../shared/protocol';
import './FilePanel.css';

type Mode = 'root' | 'worktree';

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

export function FilePanel() {
  const workspace = useAppStore(selectActiveWorkspace);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const [mode, setMode] = useState<Mode>('root');

  // Active tab from the workspace
  const activeTab = workspace?.tabs.find((t) => t.id === workspace.activeTabId);

  // Resolved displayed root (computed async, stored here)
  const [displayedRoot, setDisplayedRoot] = useState<string>('');
  // gitInfo for the resolved cwd
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  // Git status: map relPath -> status, plus dirty-dir set
  const [statusMap, setStatusMap] = useState<Map<string, GitFileStatus>>(new Map());
  const [dirtyDirs, setDirtyDirs] = useState<Set<string>>(new Set());

  // 顶层条目
  const [topEntries, setTopEntries] = useState<DirEntry[]>([]);
  // 展开状态 Set<absPath>
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 子目录缓存 Map<absPath, DirEntry[]>
  const [cache, setCache] = useState<Map<string, DirEntry[]>>(new Map());
  // 加载错误路径 Set<absPath>
  const [errPaths, setErrPaths] = useState<Set<string>>(new Set());
  // 刷新计数器，用于强制重取
  const [refreshKey, setRefreshKey] = useState(0);

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

  // ── Phase 1: resolve displayedRoot whenever active tab / mode / refreshKey changes ──
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

      // Derive displayed root based on mode
      let root: string;
      if (mode === 'root') {
        root = info.mainWorktree ?? workspace.root;
      } else {
        root = info.toplevel ?? cwd;
      }

      setDisplayedRoot(root);
      setGitInfo(info);
    }

    void resolve();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, workspace?.activeTabId, activeTab?.cwd, mode, refreshKey]);

  // ── Phase 2: when displayedRoot changes, fetch tree + git status + setup watcher ──
  useEffect(() => {
    if (!displayedRoot) return;

    const epoch = ++epochRef.current;
    // 卸载时 effect body 不再执行、epoch 不会推进,必须用本地 cancelled 旗标
    // 兜住「unmount 与在途 fs.watch 竞态」,否则 host 侧 watcher 泄漏
    let cancelled = false;
    const stale = () => cancelled || epochRef.current !== epoch;

    // Clean up old watcher before setting a new one
    cleanupWatcher();

    // Reset tree state only when root actually changes (not on watch-driven refresh)
    // We track previous root to decide whether to reset expansion
    setTopEntries([]);
    setStatusMap(new Map());
    setDirtyDirs(new Set());

    async function fetchAll() {
      // Fetch top-level entries
      try {
        const { entries } = await hostClient.rpc('fs.readdir', { path: displayedRoot });
        if (stale()) return;
        setTopEntries(sortEntries(entries));
      } catch {
        if (stale()) return;
        setTopEntries([]);
      }

      // Fetch git status if this root is a git toplevel
      if (gitInfo?.toplevel) {
        try {
          const { entries } = await hostClient.rpc('git.status', { toplevel: displayedRoot });
          if (stale()) return;
          const map = new Map<string, GitFileStatus>();
          for (const e of entries) map.set(e.path, e.status);
          setStatusMap(map);
          setDirtyDirs(computeDirtyDirs(entries, displayedRoot));
        } catch {
          // ignore git status errors
        }
      }

      // Setup fs.watch — stale(含 unmount)时立即归还 watchId
      if (stale()) return;
      try {
        const { watchId } = await hostClient.rpc('fs.watch', { path: displayedRoot });
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
  }, [displayedRoot]);

  // ── Watch-triggered partial refresh: re-fetch top-level + expanded dirs + git status ──
  // We use a separate effect that responds to refreshKey but NOT displayedRoot reset
  const displayedRootRef = useRef(displayedRoot);
  displayedRootRef.current = displayedRoot;
  const gitInfoRef = useRef(gitInfo);
  gitInfoRef.current = gitInfo;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // When refreshKey increments due to watcher (not root-change), do a partial refresh
  // 独立 epoch:不与 Phase 1/2 共用,否则会把同样由 refreshKey 触发的
  // Phase 1 重解析(手动 ⟳ 需要重新拿 cwd)误判为过期
  const refreshEpochRef = useRef(0);
  const prevRootRef = useRef('');
  useEffect(() => {
    const root = displayedRootRef.current;
    if (!root) return;
    // If root changed, Phase 2 effect handles it; skip here
    if (prevRootRef.current !== root) {
      prevRootRef.current = root;
      return;
    }

    const epoch = ++refreshEpochRef.current;

    async function partialRefresh() {
      const root = displayedRootRef.current;
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
      const info = gitInfoRef.current;
      if (info?.toplevel) {
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

  // Reset tree expansion only when displayedRoot actually changes
  useEffect(() => {
    setExpanded(new Set());
    setCache(new Map());
    setErrPaths(new Set());
  }, [displayedRoot]);

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
    if (!gitInfo?.toplevel || !displayedRoot) return '';
    // relPath relative to displayedRoot
    const rel = absPath.startsWith(displayedRoot + '/')
      ? absPath.slice(displayedRoot.length + 1)
      : absPath.startsWith(displayedRoot)
        ? absPath.slice(displayedRoot.length)
        : '';
    if (!rel) return '';

    if (kind === 'dir') {
      return dirtyDirs.has(rel) ? 'git-modified-dim' : '';
    }
    const status = statusMap.get(rel);
    return status ? gitStatusClass(status) : '';
  }

  const homedir = hostClient.info?.homedir;
  const displayPath = displayedRoot ? tildify(displayedRoot, homedir) : '';

  if (!workspace) {
    return (
      <div className="file-panel">
        <div className="file-panel__empty">No workspace</div>
      </div>
    );
  }

  const rows = flattenTree(topEntries, displayedRoot, 0);

  return (
    <div className="file-panel">
      {/* 可拖拽顶栏 + 分段切换 */}
      <div className="file-panel__header">
        <div className="file-panel__seg">
          <button
            className={`file-panel__seg-btn${mode === 'root' ? ' file-panel__seg-btn--active' : ''}`}
            onClick={() => setMode('root')}
          >
            Root
          </button>
          <button
            className={`file-panel__seg-btn${mode === 'worktree' ? ' file-panel__seg-btn--active' : ''}`}
            onClick={() => setMode('worktree')}
          >
            WorkTree
          </button>
        </div>
      </div>

      {/* 当前根路径（rtl截断头部） */}
      <div className="file-panel__root-path" title={displayedRoot}>
        {displayPath}
      </div>

      {/* 元行：条目数 + 刷新 */}
      <div className="file-panel__meta">
        <span className="file-panel__count">{topEntries.length} entries</span>
        <button className="file-panel__refresh" onClick={handleRefresh} title="Refresh">
          ⟳
        </button>
      </div>

      <div className="file-panel__divider" />

      {/* 文件树 */}
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
