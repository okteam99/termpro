// 机器组内 workspace 条目(BL-004 · AC-2/D-9)。移植自设计预览
// docs/design/preview-project/src/main.jsx L281-323(MachineWorkspaceRow/formatTabBadge)。
// 与预览的差异:预览兼容旧 ws.sessions 字符串徽标(两套 mock 数据并存的历史包袱);
// 生产 workspace 行的 tabCount 恒为数字(派生自 store 的 ws.tabs),故本文件只保留数字分支。

import './Sidebar.css';
import { t } from '../../shared/i18n';

/** Small gear icon 12×12(workspace 行的设置钮,本机/远程共用;Sidebar 从这里 import) */
export function GearIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="6" r="1.2" />
      <line x1="9.6" y1="6" x2="11" y2="6" />
      <line x1="8.55" y1="3.45" x2="9.54" y2="2.46" />
      <line x1="6" y1="2.4" x2="6" y2="1" />
      <line x1="3.45" y1="3.45" x2="2.46" y2="2.46" />
      <line x1="2.4" y1="6" x2="1" y2="6" />
      <line x1="3.45" y1="8.55" x2="2.46" y2="9.54" />
      <line x1="6" y1="9.6" x2="6" y2="11" />
      <line x1="8.55" y1="8.55" x2="9.54" y2="9.54" />
    </svg>
  );
}

/** 徽标输入:tabCount = 本客户端在该 workspace 的活跃 tab 数(hostId-aware · ws.tabs.length)。 */
export interface TabBadgeInput {
  tabCount: number;
  tabRunning?: number;
}

export interface TabBadge {
  text: string;
  /** true = tabCount===0,渲染态需要显式区分(灰色而非绿色),不能被当作"无徽标"隐藏 */
  zero: boolean;
}

/**
 * 会话徽标(AC-2/D-9):本客户端在该 workspace 的活跃 tab 数,首连远程机可为 0。
 * 🔴 必须显式处理 0 —— `{tabCount && ...}` 会把 0 当 falsy 吞掉,违反「0 也要可见」的设计决策。
 * 视觉呈现已改图标 + 数字(SessionBadge);本函数产出的文本降级为 tooltip/aria-label。
 */
export function formatTabBadge(ws: TabBadgeInput): TabBadge {
  const running = ws.tabRunning ?? 0;
  const text =
    ws.tabCount === 0
      ? t('0 session')
      : running
        ? t('{count} session · {running} running', { count: ws.tabCount, running })
        : t('{count} session', { count: ws.tabCount });
  return { text, zero: ws.tabCount === 0 };
}

/** 会话计数图标:层叠窗格(多 session 语义,与 tab 的终端图标区分) */
function SessionsGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.4 1.4 H9.2 A1.4 1.4 0 0 1 10.6 2.8 V7.6" />
      <rect x="1.4" y="3.4" width="7.2" height="7.2" rx="1.4" />
    </svg>
  );
}

/** running 计数图标:实心播放三角 */
function RunningGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M3.5 2.2 L10 6 L3.5 9.8 Z" />
    </svg>
  );
}

/**
 * 会话徽标(图标形态):终端图标+session 数,有 running 再补 播放图标+running 数。
 * 无外框;语义文本(formatTabBadge)保留在 title/aria-label 上。0 会话仍显式渲染(灰态)。
 */
export function SessionBadge({ ws }: { ws: TabBadgeInput }) {
  const badge = formatTabBadge(ws);
  const running = ws.tabRunning ?? 0;
  return (
    <span
      className={`sidebar-machine-sessions${badge.zero ? ' sidebar-machine-sessions--zero' : ''}`}
      title={badge.text}
      aria-label={badge.text}
    >
      <span className="sidebar-badge-stat">
        <SessionsGlyph />
        {ws.tabCount}
      </span>
      {running > 0 && (
        <span className="sidebar-badge-stat">
          <RunningGlyph />
          {running}
        </span>
      )}
    </span>
  );
}

export interface MachineWorkspaceRowData extends TabBadgeInput {
  id: string;
  name: string;
  /** 分支 + tildify 路径(已按该 host homedir 格式化) */
  meta: string;
  active: boolean;
  /** 需要注意的 tab 数(waiting / unseenDone)——远程 workspace 行的注意力气泡(2026-07-15) */
  attention?: number;
  /** true = 该机刚断线且这正是活跃 workspace(D-8 panel 阶段行内态标签) */
  disconnectedPanel?: boolean;
}

export interface MachineWorkspaceRowProps {
  ws: MachineWorkspaceRowData;
  onClick?: () => void;
  /** 行右上角 hover 显现的 × 删除钮(与本机行同款);缺省不渲染 */
  onRemove?: () => void;
  /** 行尾(第一行最右)hover 显现的设置钮(改名 + 浏览器 profile,与本机行同款);缺省不渲染 */
  onRename?: () => void;
}

export function MachineWorkspaceRow({ ws, onClick, onRemove, onRename }: MachineWorkspaceRowProps) {
  const classes = [
    'sidebar-item',
    ws.active ? 'sidebar-item--active' : '',
    ws.disconnectedPanel ? 'sidebar-item--disconnected' : '',
    onRemove ? 'sidebar-item--removable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      data-testid="machine-workspace-row"
    >
      <div className="sidebar-item-name-row">
        <span className="sidebar-item-name">{ws.name}</span>
        <SessionBadge ws={ws} />
        {ws.disconnectedPanel && (
          <span className="sidebar-item-lost-tag">{t('Disconnected')}</span>
        )}
        {onRename && (
          <button
            className="sidebar-edit-btn no-drag"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            title={t('Edit workspace')}
          >
            <GearIcon />
          </button>
        )}
      </div>
      <div className="sidebar-item-meta">
        <span className="sidebar-remote-meta-text">{ws.meta}</span>
      </div>
      {onRemove && (
        <button
          className="sidebar-remove-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={t('Remove workspace')}
        >
          &times;
        </button>
      )}
      {ws.attention ? (
        <span className="sidebar-attention-pill">{ws.attention}</span>
      ) : null}
    </div>
  );
}
