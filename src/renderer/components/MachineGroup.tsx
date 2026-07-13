// 机器分组头(BL-004 · AC-1/AC-2/AC-8/AC-10/AC-11)。移植自设计预览
// docs/design/preview-project/src/main.jsx L199-279(MachineGroup)。
// 与预览的关键差异:runtime 直接吃真实 useRemoteHostRuntimeStore.runtime[configId](BL-003 事件面),
// 失败文案改用 shared/remoteHost.ts 的 FAIL_REASON_COPY 单源(而非预览本地字面量)。

import './Sidebar.css';
import {
  MachineWorkspaceRow,
  SessionBadge,
  type MachineWorkspaceRowData,
} from './MachineWorkspaceRow';
import { FAIL_REASON_COPY, type RemoteEvent } from '../../shared/remoteHost';
import { t } from '../../shared/i18n';

/**
 * 连接生命周期(AC-8)进行中各态的徽标文案。
 * 🔴 镜像 `components/settings/RemoteHostsPage.tsx` 内同名常量的文案(非同一 JS 引用——
 * 该常量未从 RemoteHostsPage 导出,且改它不在本 Feature write scope 内);两处均由
 * shared/remoteHost.ts 的 RemoteStage 枚举驱动,新增/改 stage 文案需同步两处,防措辞漂移。
 */
const CONNECT_STAGE_LABEL: Record<string, string> = {
  connecting: t('Connecting…'),
  deploying: t('Deploying…'),
  starting: t('Starting host…'),
  claiming: t('Claiming…'),
  verifying: t('Verifying handshake…'),
};

/** 组头折叠三角(disclosure):展开=向下,折叠=向右(CSS rotate)。 */
export function MachineChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`sidebar-machine-chevron${collapsed ? ' sidebar-machine-chevron--collapsed' : ''}`}
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** 折叠态组头的聚合会话徽标输入:全组 workspace 的 tab/running 计数求和。 */
export function aggregateBadge(rows: MachineWorkspaceRowData[]): {
  tabCount: number;
  tabRunning: number;
} {
  let tabCount = 0;
  let tabRunning = 0;
  for (const r of rows) {
    tabCount += r.tabCount;
    tabRunning += r.tabRunning ?? 0;
  }
  return { tabCount, tabRunning };
}

/** 本机组头图标:显示器(与远程的云图标区分机器类别) */
export function LocalMachineIcon() {
  return (
    <svg
      className="sidebar-machine-icon"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

/** 连接延迟分级:<200ms 绿 · 200-499ms 琥珀 · ≥500ms 红(圆点与毫秒数同色) */
export function rttTier(ms: number): 'good' | 'fair' | 'poor' {
  if (ms < 200) return 'good';
  if (ms < 500) return 'fair';
  return 'poor';
}

/** 远程机组头图标:云 */
export function RemoteMachineIcon() {
  return (
    <svg
      className="sidebar-machine-icon"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

export interface MachineInfo {
  /** 'local' | RemoteHostConfig.id */
  id: string;
  kind: 'local' | 'remote';
  /** 本机组头展示名(默认"本机") */
  label?: string;
  /** 远程机别名 */
  alias?: string;
  /** 远程机地址(user@host),组头 title 悬浮展示 */
  addr?: string;
  /** dot 颜色语义:connected=绿 / connecting=琥珀 / disconnected=灰(从未连接) / lost=红(断线) /
   *  reconnecting=琥珀脉冲(BL-005 瞬时断线·重连中·保活不折叠·AC-6/15) */
  status?: 'connected' | 'connecting' | 'disconnected' | 'lost' | 'reconnecting';
  /** 连接生命周期进行中/失败态(BL-003 remoteHostStore);'ready'/'disconnected' 不传,由 status 呈现 */
  runtime?: RemoteEvent;
  /** true = 断线后已折叠回未连接态外观(D-8 folded 阶段);与"从未连接"灰态视觉区分(仍标红点) */
  foldedLost?: boolean;
  /** 最近一次心跳探活 RTT(ms);仅 connected 态展示于圆点右侧 */
  rttMs?: number;
  emptyLabel?: string;
  /** null = 未连接(不展开);数组(含空数组)= 已连接,渲染其 workspace 行 */
  workspaces: MachineWorkspaceRowData[] | null;
}

export interface MachineGroupProps {
  machine: MachineInfo;
  onConnect?: (machineId: string) => void;
  onRetry?: (machineId: string) => void;
  onSelectWorkspace?: (machine: MachineInfo, ws: MachineWorkspaceRowData) => void;
  /** 行级 × 删除钮(与本机行同款);缺省不渲染 */
  onRemoveWorkspace?: (machine: MachineInfo, ws: MachineWorkspaceRowData) => void;
  /** 行级铅笔重命名钮(与本机行同款);缺省不渲染 */
  onRenameWorkspace?: (machine: MachineInfo, ws: MachineWorkspaceRowData) => void;
  /** 已连接但该机 0 个 workspace 时的「添加项目」入口;缺省渲染纯文案不可点 */
  onAddWorkspace?: (machineId: string) => void;
  /** BL-005 AC-6:reconnecting 态「立即重试」→ reconnectController.manualRetry(复位退避即刻再试) */
  onManualRetry?: (machineId: string) => void;
  /** 折叠该机器分组(隐藏其全部 workspace 行;组头显示聚合会话徽标) */
  collapsed?: boolean;
  /** 点组头切换折叠;缺省组头不可点(测试/旧调用零变化) */
  onToggleCollapse?: (machineId: string) => void;
}

export function MachineGroup({
  machine,
  onConnect,
  onRetry,
  onSelectWorkspace,
  onRemoveWorkspace,
  onRenameWorkspace,
  onAddWorkspace,
  onManualRetry,
  collapsed = false,
  onToggleCollapse,
}: MachineGroupProps) {
  const isRemote = machine.kind === 'remote';
  const runtime = machine.runtime;
  const groupClasses = [
    'sidebar-machine-group',
    machine.status === 'lost' ? 'sidebar-machine-group--lost' : '',
  ]
    .filter(Boolean)
    .join(' ');

  function renderRuntimeStatus(rt: RemoteEvent) {
    if (rt.stage === 'failed') {
      const reason = FAIL_REASON_COPY[rt.reason ?? 'unreachable'] ?? FAIL_REASON_COPY.unreachable;
      return (
        <span
          className="sidebar-machine-status sidebar-machine-status--fail"
          title={reason.detail}
        >
          <span className="sidebar-machine-status-text">✗ {reason.label}</span>
          <button
            className="sidebar-machine-connect"
            onClick={(e) => { e.stopPropagation(); onRetry?.(machine.id); }}
          >
            {t('Retry')}
          </button>
        </span>
      );
    }
    const label = CONNECT_STAGE_LABEL[rt.stage] ?? t('Connecting…');
    const pct =
      rt.stage === 'deploying' && typeof rt.percent === 'number' ? ` ${rt.percent}%` : '';
    return (
      <span className="sidebar-machine-status sidebar-machine-status--active">
        <span className="add-ws__spinner add-ws__spinner--sm" />
        {label}
        {pct}
      </span>
    );
  }

  // machine.workspaces===null = 未连接分支(AC-1);!==null(含空数组)= 已连接分支渲染行(可能 0 行);
  // collapsed = 用户折叠(组体整体不渲染,组头聚合徽标兜底可见性)
  const showWorkspaces = machine.workspaces !== null && !machine.foldedLost;
  const agg =
    collapsed && machine.workspaces && machine.workspaces.length > 0
      ? aggregateBadge(machine.workspaces)
      : null;

  // 机器名最多 10 个字符,超出截断加省略号(全名在组头 title=addr 悬浮可见)
  const rawName = isRemote ? (machine.alias ?? '') : (machine.label ?? t('Local'));
  const displayName = rawName.length > 10 ? `${rawName.slice(0, 10)}…` : rawName;

  return (
    <div className={groupClasses} data-testid="machine-group" data-machine-id={machine.id}>
      <div
        className={`sidebar-machine-header${onToggleCollapse ? ' sidebar-machine-header--clickable' : ''}`}
        title={isRemote ? machine.addr : undefined}
        onClick={onToggleCollapse ? () => onToggleCollapse(machine.id) : undefined}
      >
        {onToggleCollapse && <MachineChevron collapsed={collapsed} />}
        {isRemote ? <RemoteMachineIcon /> : <LocalMachineIcon />}
        <span className="sidebar-machine-label" title={rawName}>
          {displayName}
        </span>
        {agg && <SessionBadge ws={agg} />}
        {/* connected 且有 RTT:单一小圆点并入延迟单元(圆点=毫秒数同色,按分级上色);
            其余状态维持原语义状态圆点 */}
        {isRemote && machine.status === 'connected' && machine.rttMs !== undefined ? (
          <span className={`sidebar-machine-rtt sidebar-machine-rtt--${rttTier(machine.rttMs)}`}>
            <span className="sidebar-machine-rtt-dot" />
            {Math.round(machine.rttMs)}ms
          </span>
        ) : (
          isRemote && (
            <span className={`sidebar-machine-dot sidebar-machine-dot--${machine.status ?? 'disconnected'}`} />
          )
        )}
        {/* BL-005:重连中——琥珀脉冲 + 「重连中…」文案(区别于确定断线的 lost·保活不折叠·AC-6/15) */}
        {isRemote && machine.status === 'reconnecting' && (
          <span className="sidebar-machine-status sidebar-machine-status--active">
            <span className="add-ws__spinner add-ws__spinner--sm" />
            {t('Reconnecting…')}
            <button
              className="sidebar-machine-connect"
              title={t('Retry now (reset backoff and reconnect immediately)')}
              onClick={(e) => { e.stopPropagation(); onManualRetry?.(machine.id); }}
            >
              {t('Retry now')}
            </button>
          </span>
        )}
        {isRemote && machine.status !== 'reconnecting' && runtime && renderRuntimeStatus(runtime)}
        {isRemote && !runtime && machine.foldedLost && (
          <button
            className="sidebar-machine-connect"
            onClick={(e) => { e.stopPropagation(); onConnect?.(machine.id); }}
          >
            {t('Reconnect')}
          </button>
        )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'disconnected' && (
          <button
            className="sidebar-machine-connect"
            onClick={(e) => { e.stopPropagation(); onConnect?.(machine.id); }}
          >
            {t('Connect')}
          </button>
        )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'connecting' && (
          <span className="sidebar-machine-connecting">{t('Connecting…')}</span>
        )}
      </div>
      {!collapsed &&
        (showWorkspaces && machine.workspaces ? (
          machine.workspaces.length > 0 ? (
            machine.workspaces.map((ws) => (
              <MachineWorkspaceRow
                key={ws.id}
                ws={ws}
                onClick={onSelectWorkspace ? () => onSelectWorkspace(machine, ws) : undefined}
                onRemove={onRemoveWorkspace ? () => onRemoveWorkspace(machine, ws) : undefined}
                onRename={onRenameWorkspace ? () => onRenameWorkspace(machine, ws) : undefined}
              />
            ))
          ) : (
            // 已连接但 0 个 workspace:此前什么都不渲染(看似没反应)→ 给「添加项目」入口
            <button
              className="sidebar-machine-empty sidebar-machine-empty--action"
              onClick={() => onAddWorkspace?.(machine.id)}
            >
              {t('No projects on this machine yet · Add one')}
            </button>
          )
        ) : (
          <div className="sidebar-machine-empty">
            {machine.emptyLabel ?? t('Not connected · Connect to see its workspaces')}
          </div>
        ))}
    </div>
  );
}
