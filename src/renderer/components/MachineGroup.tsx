// 机器分组头(BL-004 · AC-1/AC-2/AC-8/AC-10/AC-11)。移植自设计预览
// docs/design/preview-project/src/main.jsx L199-279(MachineGroup)。
// 与预览的关键差异:runtime 直接吃真实 useRemoteHostRuntimeStore.runtime[configId](BL-003 事件面)。
// 组头连接控件图标化(OKWORK-F260805033051)后,failed 运行态不再在此渲染——改由全局 toast 一次性
// 呈现(文案取 shared/remoteHost.ts 的 failReasonCopy 单源,在 toast 侧调用,不在本组件)。

import type { ReactNode } from 'react';
import './Sidebar.css';
import {
  MachineWorkspaceRow,
  SessionBadge,
  type MachineWorkspaceRowData,
} from './MachineWorkspaceRow';
import type { RemoteEvent } from '../../shared/remoteHost';
import { t } from '../../shared/i18n';

/**
 * 连接生命周期(AC-8)进行中各态的徽标文案。调用期取词(模块级 t() 常量会被
 * 冻结在导入期语言,语言切换/持久化偏好均不生效)。
 * 🔴 镜像 `components/settings/RemoteHostsPage.tsx` 内同名函数的文案(非同一 JS 引用);
 * 两处均由 shared/remoteHost.ts 的 RemoteStage 枚举驱动,新增/改 stage 文案需同步两处,
 * 防措辞漂移。
 */
function connectStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    connecting: t('Connecting…'),
    deploying: t('Deploying…'),
    starting: t('Starting host…'),
    claiming: t('Claiming…'),
    verifying: t('Verifying handshake…'),
  };
  return labels[stage] ?? t('Connecting…');
}

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
  attention: number;
} {
  let tabCount = 0;
  let tabRunning = 0;
  let attention = 0;
  for (const r of rows) {
    tabCount += r.tabCount;
    tabRunning += r.tabRunning ?? 0;
    attention += r.attention ?? 0;
  }
  return { tabCount, tabRunning, attention };
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

/** 延迟文案:<1s 取整毫秒;≥1s 转秒 —— 远端卡住时会是 5000/8000 这种数,组头里既挤又难读 */
export function formatRtt(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
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

// ---- 组头连接控件图标化(OKWORK-F260805033051):文字按钮(连接/重连/重试/连接中…)→ 纯图标钮,
// 新增断开钮与取消钮。语义:连接=相连的链环、断开=断裂的同一链环(互为反义,一眼看懂是同一件事的两个
// 方向)、取消=×、立即重试=循环箭头。视觉上向既有 .sidebar-machine-add(+)的「安静图标钮」看齐,
// 用 hover 语义色补偿去文字后的可发现性下降(见 Sidebar.css .sidebar-machine-ctl--*)。
// 移植自设计预览 docs/design/preview-project/src/main.jsx(MachineConnectIcon 起)。----

function MachineConnectIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 7h3a5 5 0 0 1 0 10h-3m-6 0H6a5 5 0 0 1 0-10h3" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function MachineDisconnectIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 7h3a5 5 0 0 1 3.9 8.1M9 17H6a5 5 0 0 1-3.9-8.1" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function MachineCancelIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MachineRetryIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

/**
 * 组头连接控件统一图标钮:variant 只管 hover 语义色(见 Sidebar.css),title/aria-label 双写。
 * onClick 内部统一 stopPropagation —— 组头本身可能挂了折叠点击(onToggleCollapse),控件点击
 * 不该顺带触发折叠。
 * busy(AC-13):断开 IPC 在途时连接钮的忙碌指示。🔴 用 `aria-busy`,不用 `disabled`/`aria-disabled`
 * ——按钮必须仍可点击(点击由 Sidebar 排队兑现,不拒绝)。
 * 🔴 忙碌**必须有可见反馈**(TECH 裁决:spinner + aria-busy):只写 aria-busy 而外观不变,
 * 用户点了排队最长 5 秒看不到任何变化,正是 AC-13 明令禁止的症状(a11y 属性不是给眼睛看的)。
 * 图标换成同尺寸(12px)spinner —— 同尺寸是为了不让按钮宽度跳变(AC-15 位置不变式)。
 * tooltip 同时换成「正在断开…」;aria-label **保持动作名不变**(按钮的动作仍是「连接」,
 * 让读屏把它读成「正在断开」会误导),忙碌语义由 aria-busy 承载。
 */
function MachineCtlButton({
  variant,
  icon,
  label,
  onClick,
  busy,
}: {
  variant: 'connect' | 'disconnect' | 'cancel' | 'retry';
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  busy?: boolean;
}) {
  return (
    <button
      className={`sidebar-machine-ctl sidebar-machine-ctl--${variant}`}
      title={busy ? t('Disconnecting…') : label}
      aria-label={label}
      aria-busy={busy || undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {busy ? <span className="sidebar-machine-ctl__busy" aria-hidden="true" /> : icon}
    </button>
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
  /** 断开图标钮(已连接态 · 自动重连中态均可用) */
  onDisconnect?: (machineId: string) => void;
  /** 取消图标钮(连接中态) */
  onCancel?: (machineId: string) => void;
  onRetry?: (machineId: string) => void;
  /** 断开 IPC 在途:连接图标钮显示忙碌态(aria-busy),但仍可点(点击被 Sidebar 排队兑现,AC-13) */
  settling?: boolean;
  onSelectWorkspace?: (machine: MachineInfo, ws: MachineWorkspaceRowData) => void;
  /** 行级 × 删除钮(与本机行同款);缺省不渲染 */
  onRemoveWorkspace?: (machine: MachineInfo, ws: MachineWorkspaceRowData) => void;
  /** 行级铅笔编辑钮(改名 + 浏览器 profile,与本机行同款);缺省不渲染 */
  onRenameWorkspace?: (machine: MachineInfo, ws: MachineWorkspaceRowData) => void;
  /** 「在该机添加项目」入口:组头 +(已连接才渲染)与 0 workspace 空态文案共用;缺省均不可点 */
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
  onDisconnect,
  onCancel,
  onRetry,
  settling,
  onSelectWorkspace,
  onRemoveWorkspace,
  onRenameWorkspace,
  onAddWorkspace,
  onManualRetry,
  collapsed = false,
  onToggleCollapse,
}: MachineGroupProps) {
  const isRemote = machine.kind === 'remote';
  // 🔴 AC-7:failed 运行态不再进组头渲染——它改由全局 toast 一次性呈现,组头回落「未连接」外观。
  // 过滤成 null 后,下方 `!runtime && status === 'disconnected'` 分支自然接管,渲染连接图标钮。
  const runtime = machine.runtime && machine.runtime.stage !== 'failed' ? machine.runtime : null;
  const groupClasses = [
    'sidebar-machine-group',
    machine.status === 'lost' ? 'sidebar-machine-group--lost' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // 🔴 AC-7:failed 不再进组头(此前是常驻 `✗ 原因` + 重试钮)。失败改由全局 toast 一次性呈现,
  // 组头回落到「未连接」外观(连接图标钮)。故上方 runtime 已把 failed 过滤成 null,本函数不会再
  // 收到 failed 态 —— 这里不留分支,免得日后有人以为组头还该显示失败。
  function renderRuntimeStatus(rt: RemoteEvent) {
    const label = connectStageLabel(rt.stage);
    const pct =
      rt.stage === 'deploying' && typeof rt.percent === 'number' ? ` ${rt.percent}%` : '';
    return (
      <span className="sidebar-machine-status sidebar-machine-status--active">
        <span className="add-ws__spinner add-ws__spinner--sm" />
        {label}
        {pct}
        <MachineCtlButton
          variant="cancel"
          icon={<MachineCancelIcon />}
          label={t('Cancel')}
          onClick={() => onCancel?.(machine.id)}
        />
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
        {agg && agg.attention > 0 && (
          <span className="sidebar-attention-pill sidebar-attention-pill--inline">
            {agg.attention}
          </span>
        )}
        {/* connected 且有 RTT:单一小圆点并入延迟单元(圆点=毫秒数同色,按分级上色);
            其余状态维持原语义状态圆点 */}
        {isRemote && machine.status === 'connected' && machine.rttMs !== undefined ? (
          <span
            className={`sidebar-machine-rtt sidebar-machine-rtt--${rttTier(machine.rttMs)}`}
            title={t('Round-trip time of the last health probe')}
          >
            <span className="sidebar-machine-rtt-dot" />
            {formatRtt(machine.rttMs)}
          </span>
        ) : (
          isRemote && (
            <span className={`sidebar-machine-dot sidebar-machine-dot--${machine.status ?? 'disconnected'}`} />
          )
        )}
        {/* BL-005:重连中——琥珀脉冲 + 「重连中…」文案(区别于确定断线的 lost·保活不折叠·AC-6/15)。
            断开钮在此态可用 = 终止自动重连(D-4) */}
        {isRemote && machine.status === 'reconnecting' && (
          <span className="sidebar-machine-status sidebar-machine-status--active">
            <span className="add-ws__spinner add-ws__spinner--sm" />
            {t('Reconnecting…')}
            <MachineCtlButton
              variant="retry"
              icon={<MachineRetryIcon />}
              label={t('Retry now')}
              onClick={() => onManualRetry?.(machine.id)}
            />
            <MachineCtlButton
              variant="disconnect"
              icon={<MachineDisconnectIcon />}
              label={t('Disconnect')}
              onClick={() => onDisconnect?.(machine.id)}
            />
          </span>
        )}
        {isRemote && machine.status !== 'reconnecting' && runtime && renderRuntimeStatus(runtime)}
        {/* 三态共用一个连接钮(REVIEW F10:原先是三个只差 label 的同构分支 —— 29 行重复,
            而「每个新增不变式要记得在每个分支各写一遍」正是本 Feature 已经踩过两次的坑):
            · foldedLost = 断线后已折叠 → 文案「重连」
            · disconnected = 从未连接 → 文案「连接」
            · lost = 断线过渡(0–900ms · 行仍保活 · AC-15)→ 文案「连接」;此前该态组头不出
              任何控件,补一个连接钮,用户不必等 900ms 折叠才能重连 */}
        {isRemote &&
          !runtime &&
          (machine.foldedLost ||
            machine.status === 'disconnected' ||
            machine.status === 'lost') && (
            <MachineCtlButton
              variant="connect"
              icon={<MachineConnectIcon />}
              label={machine.foldedLost ? t('Reconnect') : t('Connect')}
              busy={settling}
              onClick={() => onConnect?.(machine.id)}
            />
          )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'connected' && (
          <MachineCtlButton
            variant="disconnect"
            icon={<MachineDisconnectIcon />}
            label={t('Disconnect')}
            onClick={() => onDisconnect?.(machine.id)}
          />
        )}
        {/* 组头 + :在该机添加项目(已连接才有意义——目录浏览/对话框都需要活的 host) */}
        {onAddWorkspace && machine.workspaces !== null && (
          <button
            className="sidebar-machine-add"
            title={t('Add Project')}
            aria-label={t('Add Project')}
            onClick={(e) => { e.stopPropagation(); onAddWorkspace(machine.id); }}
          >
            +
          </button>
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
            {machine.emptyLabel ?? t('Not connected · Connect to see its projects')}
          </div>
        ))}
    </div>
  );
}
