import { useCallback, useEffect, useRef, useState } from 'react';
import { hostClient } from '../services/hostClient';
import { useAppStore, selectActiveWorkspace, tildify } from '../state/store';
import type { DirEntry } from '../../shared/protocol';
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

// 目录优先排序（host 已排序，但保险起见）
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (a.kind !== 'dir' && b.kind === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });
}

export function FilePanel() {
  const workspace = useAppStore(selectActiveWorkspace);
  const [mode, setMode] = useState<Mode>('root');

  // 当前树根路径
  const activeTab = workspace?.tabs.find((t) => t.id === workspace.activeTabId);
  const rootPath =
    mode === 'worktree'
      ? (activeTab?.cwd ?? workspace?.root ?? '')
      : (workspace?.root ?? '');

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

  // 用 ref 跟踪 rootPath，避免过时闭包
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;

  // 取顶层
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    setTopEntries([]);
    setExpanded(new Set());
    setCache(new Map());
    setErrPaths(new Set());
    hostClient
      .rpc('fs.readdir', { path: rootPath })
      .then(({ entries }) => {
        if (cancelled) return;
        setTopEntries(sortEntries(entries));
      })
      .catch(() => {
        if (cancelled) return;
        setTopEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, refreshKey]);

  // 刷新：清空缓存并重取
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // 展开/收起目录
  const toggleDir = useCallback(
    (absPath: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(absPath)) {
          next.delete(absPath);
        } else {
          next.add(absPath);
          // 第一次展开时，懒加载
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

  // 将树展平为行列表（深度优先）
  function flattenTree(entries: DirEntry[], parentPath: string, depth: number): TreeNode[] {
    const rows: TreeNode[] = [];
    for (const entry of entries) {
      const absPath = joinPath(parentPath, entry.name);
      rows.push({ entry, absPath, depth });
      if (entry.kind === 'dir' && expanded.has(absPath)) {
        if (errPaths.has(absPath)) {
          // 无法读取，显示占位行
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

  const homedir = hostClient.info?.homedir;
  const displayPath = rootPath ? tildify(rootPath, homedir) : '';

  if (!workspace) {
    return (
      <div className="file-panel">
        <div className="file-panel__empty">No workspace</div>
      </div>
    );
  }

  const rows = flattenTree(topEntries, rootPath, 0);

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
      <div className="file-panel__root-path" title={rootPath}>
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

          let rowClass = 'file-panel__row';
          if (isErr) rowClass += ' file-panel__row--unreadable';
          else if (isDir) rowClass += ' file-panel__row--dir';
          else rowClass += ' file-panel__row--file';

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
