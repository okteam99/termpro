import './Sidebar.css';
import { useState, useRef } from 'react';
import { useAppStore, tildify } from '../state/store';
import { hostClient } from '../services/hostClient';

export function Sidebar() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const updateWorkspace = useAppStore((s) => s.updateWorkspace);

  const homedir = hostClient.info?.homedir ?? undefined;

  // Track which workspace is being renamed and the draft value
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleAdd() {
    const path = await window.termpro.pickDirectory();
    if (path) addWorkspace(path);
  }

  function handleRemove(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    if (window.confirm(`Remove workspace "${name}"? Terminal sessions will be closed.`)) {
      removeWorkspace(id);
    }
  }

  function startRename(e: React.MouseEvent, id: string, currentName: string) {
    e.stopPropagation();
    setRenamingId(id);
    setRenameValue(currentName);
    // autofocus + select-all happens via autoFocus + onFocus on the input
  }

  function commitRename(id: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      updateWorkspace(id, { name: trimmed });
    }
    setRenamingId(null);
  }

  function cancelRename() {
    setRenamingId(null);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  return (
    <aside className="sidebar">
      {/* 顶部标题栏,留出 traffic light 空间 */}
      <div className="sidebar-header">
        <span className="sidebar-title">Workspaces</span>
        <button
          className="sidebar-add-btn"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={handleAdd}
          title="Add workspace"
        >
          +
        </button>
      </div>

      {/* 工作区列表 */}
      <div className="sidebar-list">
        {workspaces.length === 0 ? (
          <div className="sidebar-empty">
            <span className="sidebar-empty-text">No workspaces</span>
            <button className="sidebar-add-ws-btn" onClick={handleAdd}>
              Add Workspace
            </button>
          </div>
        ) : (
          workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            const isRenaming = renamingId === ws.id;
            const tildifiedPath = tildify(ws.root, homedir);
            const metaLine = ws.branch
              ? `⎇ ${ws.branch} · ${tildifiedPath}`
              : tildifiedPath;

            return (
              <div
                key={ws.id}
                className={`sidebar-item${isActive ? ' sidebar-item--active' : ''}`}
                onClick={() => {
                  if (!isRenaming) setActiveWorkspace(ws.id);
                }}
              >
                {isRenaming ? (
                  <input
                    ref={inputRef}
                    className="sidebar-item-rename-input"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => commitRename(ws.id)}
                    onKeyDown={(e) => handleRenameKeyDown(e, ws.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  />
                ) : (
                  <span
                    className="sidebar-item-name"
                    onDoubleClick={(e) => startRename(e, ws.id, ws.name)}
                  >
                    {ws.name}
                  </span>
                )}
                <span className="sidebar-item-meta">{metaLine}</span>
                <button
                  className="sidebar-remove-btn"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  onClick={(e) => handleRemove(e, ws.id, ws.name)}
                  title="Remove workspace"
                >
                  &times;
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
