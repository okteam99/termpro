import { useCallback, useEffect, useState } from 'react';
import { hostClient } from '../services/hostClient';
import { useAppStore, selectActiveWorkspace, tildify } from '../state/store';
import type { DirEntry, GitFileStatus } from '../../shared/protocol';
import { gitStatusClass, joinPath, worktreeLabel } from '../filepanel/core';
import { useFilePanel } from '../filepanel/useFilePanel';
import './FilePanel.css';

interface TreeNode {
  entry: DirEntry;
  absPath: string;
  depth: number;
}

// 异步编排(Phase 1 解析/树+watch/着色/刷新/cwd 轮询)全部收敛在
// src/renderer/filepanel/(单 reducer + Controller);本组件只剩
// 渲染派生与交互回调,不再持有任何 epoch ref / 异步 effect。
export function FilePanel() {
  const workspace = useAppStore(selectActiveWorkspace);
  const updateTabFilePanel = useAppStore((s) => s.updateTabFilePanel);

  // Active tab from the workspace
  const activeTab = workspace?.tabs.find((t) => t.id === workspace.activeTabId);

  // Per-tab persisted file panel state (read only — write via updateTabFilePanel)
  const fp = activeTab?.filePanel;
  const mode = fp?.mode ?? 'root';

  // 编排输入:tab 标识 + 持久化绑定 + 兜底 cwd。
  // sessionId 不在其中——spawn 不触发 React 渲染,由 deps.getSessionId 实时读。
  const { view, toggleDir, refresh } = useFilePanel({
    tabId: activeTab?.id ?? null,
    mode,
    rootPath: fp?.rootPath,
    worktreePath: fp?.worktreePath,
    fallbackCwd: activeTab?.cwd ?? workspace?.root ?? '',
  });
  const {
    effectiveRoot,
    autoRoot,
    autoWorktree,
    gitInfo,
    worktrees,
    topEntries,
    expanded,
    cache,
    errPaths,
    statusMap,
    dirtyDirs,
  } = view;

  // Root mode: draft path for the text input (mirrors effective root, reset on tab/root change)
  const [rootInputDraft, setRootInputDraft] = useState<string>('');

  // Reset rootInputDraft whenever the effective root or active tab changes
  const activeTabId = activeTab?.id;
  const fpRootPath = fp?.rootPath;
  useEffect(() => {
    setRootInputDraft(effectiveRoot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRoot, activeTabId, fpRootPath]);

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
      ? effectiveRoot
      : autoWorktree;
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
                onClick={refresh}
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
          <button className="file-panel__refresh" onClick={refresh} title="Refresh">
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
