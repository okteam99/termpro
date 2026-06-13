import './Sidebar.css';
import { useEffect, useState, useRef } from 'react';
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

/** 左下角升级胶囊:有新 Release 时出现,点击下载并升级 */
function UpdatePill() {
  const [ev, setEv] = useState<{
    state: 'available' | 'checking' | 'downloading' | 'restarting' | 'error';
    version?: string;
    percent?: number;
  } | null>(null);

  useEffect(() => window.termpro.onUpdateEvent(setEv), []);

  if (!ev) return null;
  // 真实下载进度(主进程流式下载广播);无 Content-Length 时退回脉冲动画
  const percent = ev.state === 'downloading' ? ev.percent : undefined;
  const label =
    ev.state === 'available'
      ? `⬆ 新版本 v${ev.version} — 点击升级`
      : ev.state === 'checking'
        ? '正在连接更新源…'
        : ev.state === 'downloading'
          ? percent != null
            ? `下载中 ${percent}%(完成后自动重启)`
            : '下载中(完成后自动重启)…'
          : ev.state === 'restarting'
            ? '即将重启完成升级…'
            : '自动升级失败,已打开发布页';

  const progressStyle: React.CSSProperties =
    percent != null
      ? {
          background: `linear-gradient(90deg, var(--accent) ${percent}%, var(--bg-active) ${percent}%)`,
          color: '#fff',
        }
      : {};

  return (
    <button
      className={`sidebar-update-pill sidebar-update-pill--${ev.state}${
        ev.state === 'downloading' && percent == null
          ? ' sidebar-update-pill--indeterminate'
          : ''
      }`}
      style={
        {
          WebkitAppRegion: 'no-drag',
          ...progressStyle,
        } as React.CSSProperties
      }
      disabled={
        ev.state === 'checking' ||
        ev.state === 'downloading' ||
        ev.state === 'restarting'
      }
      onClick={() => window.termpro.installUpdate()}
      title="下载新版本并自动重启升级"
    >
      {label}
    </button>
  );
}

export function Sidebar() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const updateWorkspace = useAppStore((s) => s.updateWorkspace);
  const moveWorkspace = useAppStore((s) => s.moveWorkspace);
  const notifications = useAppStore((s) => s.notifications);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  const homedir = hostClient.info?.homedir ?? undefined;

  // Modal state: null = closed, string = workspace id being renamed
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ncOpen, setNcOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Track the id of the workspace currently being dragged
  const draggingWsId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

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

  // --- Drag handlers ---

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, wsId: string) {
    draggingWsId.current = wsId;
    setDraggingId(wsId);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox compat
    e.dataTransfer.setData('text/plain', wsId);
  }

  function handleDragEnd() {
    draggingWsId.current = null;
    setDraggingId(null);
  }

  function handleDragOver(
    e: React.DragEvent<HTMLDivElement>,
    targetWsId: string,
    targetIndex: number,
  ) {
    e.preventDefault();
    const srcId = draggingWsId.current;
    if (!srcId || srcId === targetWsId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    // If pointer is above midpoint → insert at targetIndex; otherwise at targetIndex + 1
    const insertIndex = e.clientY < midY ? targetIndex : targetIndex + 1;

    const srcIndex = workspaces.findIndex((w) => w.id === srcId);
    if (srcIndex < 0) return;

    // Compute effective destination after removing src from array
    // Only call if the position actually changes
    let dest = insertIndex;
    if (srcIndex < insertIndex) dest = insertIndex - 1;
    if (dest === srcIndex) return;

    moveWorkspace(srcId, dest < 0 ? 0 : dest);
  }

  // Find the workspace being renamed (for the modal's initial name)
  const editingWorkspace = editingId
    ? workspaces.find((w) => w.id === editingId) ?? null
    : null;

  return (
    <aside className="sidebar">
      {/* 顶部标题栏,留出 traffic light 空间 */}
      <div className="sidebar-header">
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
          workspaces.map((ws, idx) => {
            const isActive = ws.id === activeWorkspaceId;
            const isDragging = ws.id === draggingId;
            const tildifiedPath = tildify(ws.root, homedir);
            const metaLine = ws.branch
              ? `⎇ ${ws.branch} · ${tildifiedPath}`
              : tildifiedPath;

            const attention = ws.tabs.filter((t) => t.waiting || t.unseenDone).length;

            return (
              <div
                key={ws.id}
                draggable
                className={`sidebar-item${isActive ? ' sidebar-item--active' : ''}${isDragging ? ' sidebar-item--dragging' : ''}`}
                onClick={() => setActiveWorkspace(ws.id)}
                onDragStart={(e) => handleDragStart(e, ws.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, ws.id, idx)}
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

      {/* 左下角:DEV 渠道标识 + 升级提示 */}
      <div className="sidebar-footer">
        {window.termpro.devChannel && (
          <span className="sidebar-dev-badge" title="开发渠道构建,独立数据目录,不检查更新">
            DEV
          </span>
        )}
        <UpdatePill />
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
