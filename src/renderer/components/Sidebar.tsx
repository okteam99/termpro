import './Sidebar.css';
import { useState, useRef } from 'react';
import { useAppStore, tildify } from '../state/store';
import { hostClient } from '../services/hostClient';
import { RenameModal } from './RenameModal';
import { NotificationCenter } from './NotificationCenter';

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

/** Bell icon 13×13 */
function BellIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Bell body */}
      <path d="M6.5 1.5 C4.567 1.5 3 3.067 3 5 L3 8 L2 9 L11 9 L10 8 L10 5 C10 3.067 8.433 1.5 6.5 1.5 Z" />
      {/* Clapper */}
      <path d="M5.5 9.5 C5.5 10.328 5.948 11 6.5 11 C7.052 11 7.5 10.328 7.5 9.5" />
    </svg>
  );
}

export function Sidebar() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const updateWorkspace = useAppStore((s) => s.updateWorkspace);
  const notifications = useAppStore((s) => s.notifications);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  const homedir = hostClient.info?.homedir ?? undefined;

  // Modal state: null = closed, string = workspace id being renamed
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ncOpen, setNcOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);

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
        {/* Bell notification button */}
        <button
          ref={bellRef}
          className="sidebar-bell-btn"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setNcOpen((v) => !v)}
          title="通知"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="sidebar-bell-badge">{badgeLabel}</span>
          )}
        </button>
        <button
          className="sidebar-add-btn"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={handleAdd}
          title="Add workspace"
        >
          +
        </button>
      </div>

      {/* Notification center dropdown — anchored to sidebar */}
      <NotificationCenter open={ncOpen} onClose={() => setNcOpen(false)} />

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

            const attention = ws.tabs.filter((t) => t.waiting || t.unseenDone).length;

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
                {attention > 0 && (
                  <span className="sidebar-attention-pill">{attention}</span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Rename modal — rendered at sidebar root level */}
      {editingWorkspace && (
        <RenameModal
          title="重命名 Workspace"
          initialValue={editingWorkspace.name}
          onSave={(name) => handleModalSave(editingWorkspace.id, name)}
          onClose={handleModalClose}
        />
      )}
    </aside>
  );
}
