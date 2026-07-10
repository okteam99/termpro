// 机器分组头(BL-004 · AC-1/AC-2/AC-8/AC-10/AC-11)。移植自设计预览
// docs/design/preview-project/src/main.jsx L199-279(MachineGroup)。
// 与预览的关键差异:runtime 直接吃真实 useRemoteHostRuntimeStore.runtime[configId](BL-003 事件面),
// 失败文案改用 shared/remoteHost.ts 的 FAIL_REASON_COPY 单源(而非预览本地字面量)。

import './Sidebar.css';
import {
  MachineWorkspaceRow,
  type MachineWorkspaceRowData,
} from './MachineWorkspaceRow';
import { FAIL_REASON_COPY, type RemoteEvent } from '../../shared/remoteHost';

/**
 * 连接生命周期(AC-8)进行中各态的徽标文案。
 * 🔴 镜像 `components/settings/RemoteHostsPage.tsx` 内同名常量的文案(非同一 JS 引用——
 * 该常量未从 RemoteHostsPage 导出,且改它不在本 Feature write scope 内);两处均由
 * shared/remoteHost.ts 的 RemoteStage 枚举驱动,新增/改 stage 文案需同步两处,防措辞漂移。
 */
const CONNECT_STAGE_LABEL: Record<string, string> = {
  connecting: '连接中…',
  deploying: '部署中…',
  starting: '启动 host…',
  claiming: '认领中…',
  verifying: '握手校验…',
};

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
  /** dot 颜色语义:connected=绿 / connecting=琥珀 / disconnected=灰(从未连接) / lost=红(断线) */
  status?: 'connected' | 'connecting' | 'disconnected' | 'lost';
  /** 连接生命周期进行中/失败态(BL-003 remoteHostStore);'ready'/'disconnected' 不传,由 status 呈现 */
  runtime?: RemoteEvent;
  /** true = 断线后已折叠回未连接态外观(D-8 folded 阶段);与"从未连接"灰态视觉区分(仍标红点) */
  foldedLost?: boolean;
  emptyLabel?: string;
  /** null = 未连接(不展开);数组(含空数组)= 已连接,渲染其 workspace 行 */
  workspaces: MachineWorkspaceRowData[] | null;
}

export interface MachineGroupProps {
  machine: MachineInfo;
  onConnect?: (machineId: string) => void;
  onRetry?: (machineId: string) => void;
  onSelectWorkspace?: (machine: MachineInfo, ws: MachineWorkspaceRowData) => void;
}

export function MachineGroup({
  machine,
  onConnect,
  onRetry,
  onSelectWorkspace,
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
          <button className="sidebar-machine-connect" onClick={() => onRetry?.(machine.id)}>
            重试
          </button>
        </span>
      );
    }
    const label = CONNECT_STAGE_LABEL[rt.stage] ?? '连接中…';
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

  // machine.workspaces===null = 未连接分支(AC-1);!==null(含空数组)= 已连接分支渲染行(可能 0 行)
  const showWorkspaces = machine.workspaces !== null && !machine.foldedLost;

  return (
    <div className={groupClasses} data-testid="machine-group" data-machine-id={machine.id}>
      <div className="sidebar-machine-header" title={isRemote ? machine.addr : undefined}>
        {isRemote && (
          <span className={`sidebar-machine-dot sidebar-machine-dot--${machine.status ?? 'disconnected'}`} />
        )}
        <span className="sidebar-machine-label">
          {isRemote ? machine.alias : (machine.label ?? '本机')}
        </span>
        {isRemote && runtime && renderRuntimeStatus(runtime)}
        {isRemote && !runtime && machine.foldedLost && (
          <button className="sidebar-machine-connect" onClick={() => onConnect?.(machine.id)}>
            重连
          </button>
        )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'disconnected' && (
          <button className="sidebar-machine-connect" onClick={() => onConnect?.(machine.id)}>
            连接
          </button>
        )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'connecting' && (
          <span className="sidebar-machine-connecting">连接中…</span>
        )}
      </div>
      {showWorkspaces && machine.workspaces ? (
        machine.workspaces.map((ws) => (
          <MachineWorkspaceRow
            key={ws.id}
            ws={ws}
            onClick={onSelectWorkspace ? () => onSelectWorkspace(machine, ws) : undefined}
          />
        ))
      ) : (
        <div className="sidebar-machine-empty">
          {machine.emptyLabel ?? '未连接 · 连接后显示该机上的 workspace'}
        </div>
      )}
    </div>
  );
}
