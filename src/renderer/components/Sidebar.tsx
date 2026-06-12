import './Sidebar.css';
import { useState, useRef } from 'react';
import { useAppStore, tildify } from '../state/store';
import { hostClient } from '../services/hostClient';

/** Small pencil icon 12×12 */
function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8.5 1.5 L10.5 3.5 L4 10 L1.5 10.5 L2 8 Z" />
      <line x1="7" y1="3" x2="9" y2="5" />
    </svg>
  );
}

interface RenameModalProps {
  workspaceId: string;
  initialName: string;
  onSave: (id: string, name: string) => void;
  onClose: () => void;
}

function RenameModal({ workspaceId, initialName, onSave, onClose }: RenameModalProps) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSave() {
    const trimmed = value.trim();
    if (trimmed) {
      onSave(workspaceId, trimmed);
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    // Only close if the click was directly on the backdrop (not the card)
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className="rename-modal-backdrop"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onMouseDown={handleBackdropClick}
    >
      <div
        className="rename-modal-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="rename-modal-title">重命名 Workspace</div>
        <input
          ref={inputRef}
          className="rename-modal-input"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={handleKeyDown}
        />
        <div className="rename-modal-actions">
          <button className="rename-modal-cancel" onClick={onClose}>
            取消
          </button>
          <button className="rename-modal-save" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const updateWorkspace = useAppStore((s) => s.updateWorkspace);

  const homedir = hostClient.info?.homedir ?? undefined;

  // Modal state: null = closed, string = workspace id being renamed
  const [editingId, setEditingId] = useState<string | null>(null);

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

  function openRenameModal(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setEditingId(id);
  }

  function handleModalSave(id: string, name: string) {
    updateWorkspace(id, { name });
  }

  function handleModalClose() {
    setEditingId(null);
  }

  // Find the workspace being renamed (for the modal's initial name)
  const editingWorkspace = editingId
    ? workspaces.find((w) => w.id === editingId) ?? null
    : null;

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
            const tildifiedPath = tildify(ws.root, homedir);
            const metaLine = ws.branch
              ? `⎇ ${ws.branch} · ${tildifiedPath}`
              : tildifiedPath;

            return (
              <div
                key={ws.id}
                className={`sidebar-item${isActive ? ' sidebar-item--active' : ''}`}
                onClick={() => setActiveWorkspace(ws.id)}
              >
                <div className="sidebar-item-name-row">
                  <span className="sidebar-item-name">{ws.name}</span>
                  <button
                    className="sidebar-edit-btn no-drag"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    onClick={(e) => openRenameModal(e, ws.id)}
                    title="Rename workspace"
                  >
                    <PencilIcon />
                  </button>
                </div>
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

      {/* Rename modal — rendered at sidebar root level */}
      {editingWorkspace && (
        <RenameModal
          workspaceId={editingWorkspace.id}
          initialName={editingWorkspace.name}
          onSave={handleModalSave}
          onClose={handleModalClose}
        />
      )}
    </aside>
  );
}
