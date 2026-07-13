import { useCallback, useEffect, useRef, useState } from 'react';
import { hostRegistry } from '../services/hostRegistry';
import { useAppStore, selectActiveWorkspace, tildify } from '../state/store';
import type { DirEntry, GitFileStatus } from '../../shared/protocol';
import { t } from '../../shared/i18n';
import { gitStatusClass, joinPath } from '../filepanel/core';
import { registerFilePanelLocateHandler } from '../filepanel/locateRegistry';
import { useFilePanel } from '../filepanel/useFilePanel';
import { WorktreeDropdown } from './WorktreeDropdown';
import './FilePanel.css';

interface TreeNode {
  entry: DirEntry;
  absPath: string;
  depth: number;
}

// 面板内拖拽的源路径:dragstart 记下(此时用原生 startDrag 接管,拖出到 Finder
// 也走这里)。drop 时若落回面板,据此判定「内部移动」;外部拖入无此记录 → 复制。
// ts:新鲜度戳。dragstart 用原生拖拽接管后 HTML5 dragend 不一定触发,靠 drop 清、
// onDragEnd 清、以及新鲜度窗口三重兜底,杜绝陈旧源被误判为内部移动。单例面板,模块级即可。
const DRAG_FRESH_MS = 15_000;
const dragState: { path: string | null; ts: number } = { path: null, ts: 0 };

// 远程 workspace 本机 OS 动作禁用提示(D-7):浏览器打开 / Finder 显示 / Finder 打开
// 三个入口触发同一条确定性提示,1.8s 后自动消失(非 modal,不打断操作)。
// 文件内容 / Diff 入口已远程可用(查看器窗口按 hostId 直连远程 host),不再禁用。
const LOCAL_ONLY_HINT_MS = 1_800;

/** 行级动作:文件夹图标 11×11 */
function FolderIcon() {
  return (
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
  );
}

/** 行级动作:浏览器(地球)图标 11×11 */
function GlobeIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <circle cx="8" cy="8" r="6.2" />
      <ellipse cx="8" cy="8" rx="2.8" ry="6.2" />
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  );
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
  const {
    view,
    toggleDir,
    refresh,
    locateTarget,
    clearLocateHighlight,
    clearLocateScrollPath,
  } = useFilePanel({
    tabId: activeTab?.id ?? null,
    mode,
    rootPath: fp?.rootPath,
    worktreePath: fp?.worktreePath,
    fallbackCwd: activeTab?.cwd ?? workspace?.root ?? '',
    initialExpanded: fp?.expanded ?? [],
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
    locateHighlightPath,
    locateScrollPath,
  } = view;
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // render 期取词(P2:模块级 t() 常量会被冻结在导入期语言,切换/持久化偏好均不生效)。
  // UNREADABLE_LABEL 兼作错误行哨兵:合成(flattenTree)与判定(isErr)同一 render 内
  // 取同一值,rows 无 memo,语言切换后两端一致。
  const LOCAL_ONLY_HINT_TEXT = t('Local-only action — unavailable in remote workspaces');
  const UNREADABLE_LABEL = t('(unreadable)');

  // Root mode: draft path for the text input (mirrors effective root, reset on tab/root change)
  const [rootInputDraft, setRootInputDraft] = useState<string>('');

  // Reset rootInputDraft whenever the effective root or active tab changes
  const activeTabId = activeTab?.id;
  const fpRootPath = fp?.rootPath;
  useEffect(() => {
    setRootInputDraft(effectiveRoot);
  }, [effectiveRoot, activeTabId, fpRootPath]);

  useEffect(() => {
    if (!activeTabId) return;
    return registerFilePanelLocateHandler(activeTabId, locateTarget);
  }, [activeTabId, locateTarget]);

  useEffect(() => {
    clearLocateHighlight();
  }, [activeTabId, clearLocateHighlight]);

  useEffect(() => {
    if (!locateScrollPath) return;
    const row = rowRefs.current.get(locateScrollPath);
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    clearLocateScrollPath();
  }, [locateScrollPath, clearLocateScrollPath]);

  // ── Flatten tree ──
  function flattenTree(entries: DirEntry[], parentPath: string, depth: number): TreeNode[] {
    const rows: TreeNode[] = [];
    for (const entry of entries) {
      const absPath = joinPath(parentPath, entry.name);
      rows.push({ entry, absPath, depth });
      if (entry.kind === 'dir' && expanded.has(absPath)) {
        if (errPaths.has(absPath)) {
          rows.push({
            entry: { name: UNREADABLE_LABEL, kind: 'other' },
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

  // BL-004:该 workspace 路由到的 host client(本机 workspace 无 hostId 字段落地前
  // hostRegistry.forWorkspace 兜底 local,行为等价迁移前)。远程 workspace(hostId!=='local')
  // 文件内容/Diff 走查看器窗口按 hostId 直连远程 host(payload 带 remoteHostId);
  // 仅本机 OS 动作(Finder/系统浏览器)保持 D-7 禁用。
  const wsClient = workspace ? hostRegistry.forWorkspace(workspace) : hostRegistry.local();
  const isRemote = workspace ? workspace.hostId !== 'local' : false;
  // 查看器窗口 payload 的 host 路由键:远程 = workspace 的 configId;本机不带(零变化)
  const remoteHostId = isRemote && workspace ? workspace.hostId : null;
  const homedir = wsClient.info?.homedir;

  // 本机 OS 动作禁用提示:三入口(浏览器打开 / Finder 显示 / Finder 打开)共用 1.8s 行内提示
  const [localOnlyHintVisible, setLocalOnlyHintVisible] = useState(false);
  const localOnlyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLocalOnlyHint = useCallback(() => {
    setLocalOnlyHintVisible(true);
    if (localOnlyHintTimerRef.current) clearTimeout(localOnlyHintTimerRef.current);
    localOnlyHintTimerRef.current = setTimeout(() => {
      setLocalOnlyHintVisible(false);
      localOnlyHintTimerRef.current = null;
    }, LOCAL_ONLY_HINT_MS);
  }, []);
  useEffect(
    () => () => {
      if (localOnlyHintTimerRef.current) clearTimeout(localOnlyHintTimerRef.current);
    },
    [],
  );

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
  const handleWorktreeSelect = useCallback(
    (path: string) => {
      if (!activeTab) return;
      updateTabFilePanel(activeTab.id, { worktreePath: path, mode: 'worktree' });
    },
    [activeTab, updateTabFilePanel],
  );

  // ── Mode toggle ──
  const handleModeRoot = useCallback(() => {
    if (!activeTab) return;
    clearLocateHighlight();
    updateTabFilePanel(activeTab.id, { mode: 'root' });
  }, [activeTab, clearLocateHighlight, updateTabFilePanel]);

  const handleModeWorktree = useCallback(() => {
    if (!activeTab) return;
    clearLocateHighlight();
    updateTabFilePanel(activeTab.id, { mode: 'worktree' });
  }, [activeTab, clearLocateHighlight, updateTabFilePanel]);

  const handleRefresh = useCallback(() => {
    clearLocateHighlight();
    refresh();
  }, [clearLocateHighlight, refresh]);

  const handleToggleDir = useCallback((path: string) => {
    clearLocateHighlight();
    toggleDir(path);
  }, [clearLocateHighlight, toggleDir]);

  // 落点统一处理:内部拖动(源路径 = 本次 dragstart 记录)→ 移动;外部拖入 → 复制。
  // 原生同窗口拖放个别情况下 dataTransfer.files 为空,用 dragState 兜底走移动。
  const performDrop = useCallback(
    async (destDir: string, dt: DataTransfer) => {
      // 仅新鲜的本次 dragstart 才算内部拖动;陈旧值一律当外部(复制),最坏「该移变复制」不丢数据
      const internal =
        dragState.path && Date.now() - dragState.ts < DRAG_FRESH_MS
          ? dragState.path
          : null;
      dragState.path = null;
      const dropped: string[] = [];
      for (const f of Array.from(dt.files)) {
        const p = window.termpro.getPathForFile(f);
        if (p) dropped.push(p);
      }
      const ops: { src: string; move: boolean }[] = dropped.length
        ? dropped.map((p) => ({ src: p, move: p === internal }))
        : internal
          ? [{ src: internal, move: true }]
          : [];
      let changed = false;
      for (const { src, move } of ops) {
        try {
          // fs.move/copy 走该 workspace 的 host(远程内部移动/复制正确路由)。跨 host
          // 从 Finder 拖入远程面板(src 是本地路径、destDir 在远程机)会 ENOENT——
          // 这条 catch 已兜底(E-3 确定性拒绝,不崩溃),不做跨机文件传输。
          await wsClient.rpc(move ? 'fs.move' : 'fs.copy', { src, destDir });
          changed = true;
        } catch (err) {
          console.error('[filepanel] drop failed', src, '→', destDir, err);
        }
      }
      if (changed) refresh();
    },
    [refresh, wsClient],
  );

  if (!workspace) {
    return (
      <div className="file-panel">
        <div className="file-panel__empty">{t('No session')}</div>
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
    <div className="file-panel" style={{ position: 'relative' }}>
      {localOnlyHintVisible && (
        <div
          className="file-panel__remote-hint"
          role="status"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 20,
            background: 'rgba(20,20,24,0.92)',
            color: '#e4e6eb',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {LOCAL_ONLY_HINT_TEXT}
        </div>
      )}
      {/* Draggable top bar + segmented toggle */}
      <div className="file-panel__header">
        <div className="file-panel__seg">
          <button
            className={`file-panel__seg-btn${mode === 'root' ? ' file-panel__seg-btn--active' : ''}`}
            onClick={handleModeRoot}
          >
            {t('Root')}
          </button>
          <button
            className={`file-panel__seg-btn${mode === 'worktree' ? ' file-panel__seg-btn--active' : ''}`}
            onClick={handleModeWorktree}
          >
            {t('WorkTree')}
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
                {t('Choose…')}
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
                {t('Apply')}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Row 1: worktree dropdown + reload button */}
            <div className="file-panel__ctrl-row">
              <WorktreeDropdown
                worktrees={worktrees}
                selectedPath={selectedWorktreePath}
                mainPath={mainWorktreePath}
                disabled={!isGitRepo}
                onSelect={handleWorktreeSelect}
              />
              <button
                className="file-panel__ctrl-btn file-panel__ctrl-btn--icon"
                onClick={handleRefresh}
                title={t('Reload worktrees')}
              >
                ⟳
              </button>
            </div>
            {/* Row 2: branch · head info */}
            <div className="file-panel__ctrl-row file-panel__ctrl-row--hint">
              <span className="file-panel__hint">
                {isGitRepo && selectedWt
                  ? t('{branch} · {head}', {
                      branch: selectedWt.branch ?? t('detached'),
                      head: selectedWt.head,
                    })
                  : t('not a git repo')}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Meta row: entry count + Diff button + refresh */}
      <div className="file-panel__meta">
        <span className="file-panel__count">
          {t('{count} entries', { count: topEntries.length })}
        </span>
        <div className="file-panel__meta-actions">
          {isGitRepo && (
            <button
              className="file-panel__diff-btn"
              title={t('Open diff view')}
              onClick={() => {
                const { toplevel, baseRef } = diffContext();
                // 远程带 hostId:diff 窗口按它直连远程 host 跑 git RPC
                window.termpro.openViewerWindow({
                  mode: 'diff',
                  toplevel,
                  baseRef,
                  ...(remoteHostId ? { hostId: remoteHostId } : {}),
                });
              }}
            >
              {t('Diff')}
            </button>
          )}
          <button className="file-panel__refresh" onClick={handleRefresh} title={t('Refresh')}>
            ⟳
          </button>
        </div>
      </div>

      <div className="file-panel__divider" />

      {/* File tree.根落点:拖到空白/文件行(冒泡至此)→ 放进 effectiveRoot。
          目录行自身停冒泡,单独作为目标。 */}
      <div
        className="file-panel__tree"
        onDragOver={
          effectiveRoot
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = dragState.path ? 'move' : 'copy';
                e.currentTarget.classList.add('file-panel__tree--drop-target');
              }
            : undefined
        }
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            e.currentTarget.classList.remove('file-panel__tree--drop-target');
          }
        }}
        onDrop={
          effectiveRoot
            ? (e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('file-panel__tree--drop-target');
                void performDrop(effectiveRoot, e.dataTransfer);
              }
            : undefined
        }
      >
        {rows.map((node) => {
          const isDir = node.entry.kind === 'dir';
          const isErr = node.entry.name === UNREADABLE_LABEL;
          const isExpanded = expanded.has(node.absPath);
          const paddingLeft = 10 + node.depth * 14;

          const gitCls = isErr ? '' : gitClassForPath(node.absPath, node.entry.kind);

          let rowClass = 'file-panel__row';
          if (isErr) rowClass += ' file-panel__row--unreadable';
          else if (isDir) rowClass += ' file-panel__row--dir';
          else rowClass += ' file-panel__row--file';
          if (gitCls) rowClass += ` file-panel__row--${gitCls}`;
          if (node.absPath === locateHighlightPath) {
            rowClass += ' file-panel__row--locate-target';
          }

          // 有变动的文件(着色非 ignored)hover 时给行级 diff 直达按钮
          const fileStatus =
            isDir || isErr ? null : fileStatusForPath(node.absPath);
          const canDiff = !!fileStatus && fileStatus !== 'ignored';
          const isFile = !isDir && !isErr;
          const isHtml = isFile && /\.html?$/i.test(node.entry.name);

          return (
            <div
              key={node.absPath}
              ref={(el) => {
                if (el) rowRefs.current.set(node.absPath, el);
                else rowRefs.current.delete(node.absPath);
              }}
              className={rowClass}
              style={{ paddingLeft }}
              draggable={!isErr}
              onDragStart={
                isErr
                  ? undefined
                  : (e) => {
                      dragState.path = node.absPath;
                      dragState.ts = Date.now();
                      // 交给原生 startDrag:可拖到 Finder(复制),落回面板则据
                      // dragState 判为内部移动。preventDefault 取消 HTML5 拖拽。
                      e.preventDefault();
                      window.termpro.startFileDrag(node.absPath);
                    }
              }
              onDragEnd={isErr ? undefined : () => { dragState.path = null; }}
              onDragOver={
                isDir && !isErr
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation(); // 本目录即目标,别再冒泡到根
                      e.dataTransfer.dropEffect = dragState.path ? 'move' : 'copy';
                      e.currentTarget.classList.add('file-panel__row--drop-target');
                    }
                  : undefined
              }
              onDragLeave={
                isDir && !isErr
                  ? (e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        e.currentTarget.classList.remove('file-panel__row--drop-target');
                      }
                    }
                  : undefined
              }
              onDrop={
                isDir && !isErr
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.classList.remove('file-panel__row--drop-target');
                      void performDrop(node.absPath, e.dataTransfer);
                    }
                  : undefined
              }
              onClick={
                isErr
                  ? undefined
                  : isDir
                    ? () => handleToggleDir(node.absPath)
                    : () => {
                        // 远程带 hostId:文件内容窗口按它直连远程 host(读/编辑/保存)
                        window.termpro.openViewerWindow({
                          mode: 'file',
                          path: node.absPath,
                          ...(remoteHostId ? { hostId: remoteHostId } : {}),
                        });
                      }
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
                      ...(remoteHostId ? { hostId: remoteHostId } : {}),
                    });
                  }}
                >
                  {t('diff')}
                </button>
              )}
              {isHtml && (
                <button
                  className="file-panel__row-action"
                  aria-disabled={isRemote ? 'true' : undefined}
                  title={isRemote ? LOCAL_ONLY_HINT_TEXT : t('Open with default browser')}
                  style={isRemote ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    // 远程 ws 的路径是该机上的路径,交给本机 openInBrowser 会静默作用于
                    // 本机同名(但无关)文件——D-7 一律禁用 + 提示,而非静默走错文件。
                    if (isRemote) {
                      showLocalOnlyHint();
                      return;
                    }
                    window.termpro.openInBrowser(node.absPath);
                  }}
                >
                  <GlobeIcon />
                </button>
              )}
              {isFile && (
                <button
                  className="file-panel__row-action"
                  aria-disabled={isRemote ? 'true' : undefined}
                  title={isRemote ? LOCAL_ONLY_HINT_TEXT : t('Show in Finder')}
                  style={isRemote ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isRemote) {
                      showLocalOnlyHint();
                      return;
                    }
                    window.termpro.showItemInFolder(node.absPath);
                  }}
                >
                  <FolderIcon />
                </button>
              )}
              {isDir && !isErr && (
                <button
                  className="file-panel__row-action"
                  aria-disabled={isRemote ? 'true' : undefined}
                  title={isRemote ? LOCAL_ONLY_HINT_TEXT : t('Open in Finder')}
                  style={isRemote ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    // 目录展开/收起(行点击 handleToggleDir)不受影响——这个按钮是「本机
                    // Finder 打开」,是本地 OS 动作,与树浏览是两回事,D-7 同样要禁用。
                    if (isRemote) {
                      showLocalOnlyHint();
                      return;
                    }
                    window.termpro.openPath(node.absPath);
                  }}
                >
                  <FolderIcon />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
