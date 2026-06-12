import './NotificationCenter.css';
import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/store';

/** Compute relative time string (Chinese) from a timestamp */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/** Kind indicator dot color class */
function kindClass(kind: 'waiting' | 'done' | 'bell' | 'notify'): string {
  if (kind === 'done') return 'nc-dot nc-dot--done';
  if (kind === 'notify') return 'nc-dot nc-dot--notify';
  return 'nc-dot nc-dot--waiting';
}

interface Props {
  open: boolean;
  onClose(): void;
}

export function NotificationCenter({ open, onClose }: Props) {
  const notifications = useAppStore((s) => s.notifications);
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useAppStore((s) => s.markAllNotificationsRead);
  const clearNotifications = useAppStore((s) => s.clearNotifications);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const clearTabAttention = useAppStore((s) => s.clearTabAttention);

  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleItemClick(id: string, workspaceId: string, tabId: string) {
    markNotificationRead(id);
    setActiveWorkspace(workspaceId);
    setActiveTab(workspaceId, tabId);
    clearTabAttention(tabId);
    onClose();
  }

  return (
    <div
      className="nc-panel"
      ref={panelRef}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Header */}
      <div className="nc-header">
        <span className="nc-title">通知</span>
        <div className="nc-header-actions">
          <button
            className="nc-action-btn"
            onClick={() => markAllNotificationsRead()}
            title="全部已读"
          >
            全部已读
          </button>
          <button
            className="nc-action-btn"
            onClick={() => clearNotifications()}
            title="清空"
          >
            清空
          </button>
        </div>
      </div>

      {/* List */}
      <div className="nc-list">
        {notifications.length === 0 ? (
          <div className="nc-empty">暂无通知</div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`nc-item${n.read ? ' nc-item--read' : ''}`}
              onClick={() => handleItemClick(n.id, n.workspaceId, n.tabId)}
            >
              <span className={kindClass(n.kind)} />
              <span className="nc-item-text">{n.text}</span>
              <span className="nc-item-time">{relativeTime(n.ts)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
