import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
// Reverse-sync the shared panorama shell from the current renderer sources.
// These imports intentionally follow the panorama-specific stylesheet so the
// real application remains the visual authority for shell primitives.
import '../../../../src/renderer/index.css';
import '../../../../src/renderer/components/Sidebar.css';
import '../../../../src/renderer/components/TabBar.css';
import '../../../../src/renderer/components/SideRail.css';
import '../../../../src/renderer/components/PanelHeader.css';
import '../../../../src/renderer/components/FilePanel.css';
import './latest-ui-sync.css';

const scenarios = {
  worktree: {
    label: 'WorkTree',
    mode: 'worktree',
    terminalPath: 'src/renderer/components/FilePanel.tsx:81:5',
    terminalStatus: 'located in WorkTree',
    root: '/Users/liam/apps/okok/OkWork/.worktree/OKWORK-F260613053134-Terminal-Path-FilePanel',
    hint: 'feature/terminal-path-file-panel · 7c44c74',
    target: 'FilePanel.tsx',
    rows: [
      { name: 'docs', kind: 'dir', depth: 0, expanded: false },
      { name: 'src', kind: 'dir', depth: 0, expanded: true, status: 'modified-dim' },
      { name: 'renderer', kind: 'dir', depth: 1, expanded: true, status: 'modified-dim' },
      { name: 'components', kind: 'dir', depth: 2, expanded: true, status: 'modified-dim' },
      { name: 'FilePanel.tsx', kind: 'file', depth: 3, target: true, status: 'modified' },
      { name: 'FilePanel.css', kind: 'file', depth: 3 },
      { name: 'TabBar.tsx', kind: 'file', depth: 2 },
      { name: 'terminal', kind: 'dir', depth: 1, expanded: false },
      { name: 'state', kind: 'dir', depth: 1, expanded: false },
      { name: 'package.json', kind: 'file', depth: 0 },
    ],
  },
  root: {
    label: 'Root',
    mode: 'root',
    terminalPath: 'file:///Users/liam/apps/okok/OkWork/project-specs/GLOSSARY.md',
    terminalStatus: 'located in Root',
    root: '/Users/liam/apps/okok/OkWork',
    hint: '~/apps/okok/OkWork',
    target: 'GLOSSARY.md',
    rows: [
      { name: 'AGENTS.md', kind: 'file', depth: 0, status: 'untracked' },
      { name: 'docs', kind: 'dir', depth: 0, expanded: false },
      { name: 'product-overview', kind: 'dir', depth: 0, expanded: false },
      { name: 'project-specs', kind: 'dir', depth: 0, expanded: true, status: 'modified-dim' },
      { name: 'ARCHITECTURE.md', kind: 'file', depth: 1 },
      { name: 'DEV-RULES.md', kind: 'file', depth: 1 },
      { name: 'GLOSSARY.md', kind: 'file', depth: 1, target: true, status: 'modified' },
      { name: 'KNOWLEDGE.md', kind: 'file', depth: 1 },
      { name: 'src', kind: 'dir', depth: 0, expanded: false },
      { name: 'README.md', kind: 'file', depth: 0 },
    ],
  },
  external: {
    label: 'Fallback',
    mode: 'worktree',
    terminalPath: '/tmp/agent-output/build-report.html',
    terminalStatus: 'external fallback',
    root: '/Users/liam/apps/okok/OkWork/.worktree/OKWORK-F260613053134-Terminal-Path-FilePanel',
    hint: 'feature/terminal-path-file-panel · unchanged',
    target: null,
    rows: [
      { name: 'docs', kind: 'dir', depth: 0, expanded: false },
      { name: 'src', kind: 'dir', depth: 0, expanded: true, status: 'modified-dim' },
      { name: 'renderer', kind: 'dir', depth: 1, expanded: true, status: 'modified-dim' },
      { name: 'components', kind: 'dir', depth: 2, expanded: false, status: 'modified-dim' },
      { name: 'terminal', kind: 'dir', depth: 1, expanded: true },
      { name: 'terminalLinks.ts', kind: 'file', depth: 2, status: 'modified' },
      { name: 'state', kind: 'dir', depth: 1, expanded: false },
      { name: 'package.json', kind: 'file', depth: 0 },
    ],
  },
};

const KNOWN_ROUTES = [
  '/terminal/file-panel-path-location',
  '/sidebar/settings-about-entry',
  '/shell/close-install-confirmation',
  '/workspace/add-workspace',
  '/settings/remote-hosts',
  '/settings/browser-profiles',
  '/settings/browser-passwords',
  '/browser/password-save-fill',
  '/sidebar/machine-groups',
  '/session/reconnect-continuity',
];

const DEFAULT_ROUTE = '/workspace/add-workspace';

function normalizeInitialPath(pathname) {
  return KNOWN_ROUTES.includes(pathname) ? pathname : DEFAULT_ROUTE;
}

// ---- Preview dev bar: 全局预览工具顶栏(仅新路由渲染)----

const DEVBAR_ROUTES = [
  { path: '/terminal/file-panel-path-location', label: 'Terminal · FilePanel' },
  { path: '/sidebar/settings-about-entry', label: 'Sidebar · About' },
  { path: '/shell/close-install-confirmation', label: 'Close/Install' },
  { path: '/workspace/add-workspace', label: 'Add Workspace' },
  { path: '/settings/remote-hosts', label: 'Remote Hosts' },
  { path: '/settings/browser-profiles', label: 'Browser Profiles' },
  { path: '/settings/browser-passwords', label: 'Passwords' },
  { path: '/browser/password-save-fill', label: 'Save / Fill' },
  { path: '/sidebar/machine-groups', label: 'Sidebar · Machine Groups' },
  { path: '/session/reconnect-continuity', label: 'Session · Reconnect' },
];

function PreviewDevBar({ currentPath, onNavigate, statePresets, activeStateKey, onSelectState }) {
  const currentRoute = DEVBAR_ROUTES.find((route) => route.path === currentPath);
  return (
    <details className="preview-devbar">
      <summary className="preview-devbar__summary">
        <span className="preview-devbar__label">DESIGN PREVIEW</span>
        <span>{currentRoute?.label ?? currentPath}</span>
      </summary>
      <div className="preview-devbar__content">
        <nav className="preview-devbar__routes" aria-label="Preview routes">
          {DEVBAR_ROUTES.map((r) => (
            <a
              key={r.path}
              href={r.path}
              className={`preview-devbar__route${currentPath === r.path ? ' preview-devbar__route--active' : ''}`}
              onClick={(e) => { e.preventDefault(); onNavigate(r.path); }}
            >
              {r.label}
            </a>
          ))}
        </nav>
        <div className="preview-devbar__states" aria-label="State presets">
          {statePresets.map((s) => (
            <button
              key={s.key}
              className={`preview-devbar__state-chip${activeStateKey === s.key ? ' preview-devbar__state-chip--active' : ''}`}
              onClick={() => onSelectState(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

function PreviewPage({ currentPath, onNavigate, statePresets, activeStateKey, onSelectState, children }) {
  return (
    <>
      <PreviewDevBar
        currentPath={currentPath}
        onNavigate={onNavigate}
        statePresets={statePresets}
        activeStateKey={activeStateKey}
        onSelectState={onSelectState}
      />
      <div className="preview-devbar__body">{children}</div>
    </>
  );
}

const DEFAULT_WORKSPACES = [
  { id: 'okwork', name: 'OkWork', active: true, meta: 'main · ~/apps/okok/OkWork', tabCount: 2, tabRunning: 1 },
  { id: 'aon-core', name: 'aon-core', active: false, meta: 'staging · ~/apps/joli/aon', tabCount: 1, tabRunning: 0 },
];

function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.2 6.7a4.8 4.8 0 0 1 9.6 0c0 4 1.5 4.3 1.5 4.3H1.7s1.5-.3 1.5-4.3Z" />
      <path d="M6.3 13a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M6.8 1.8h2.4l.5 1.5 1.4.6 1.4-.7 1.7 1.7-.7 1.4.6 1.4 1.5.5v2.4l-1.5.5-.6 1.4.7 1.4-1.7 1.7-1.4-.7-1.4.6-.5 1.5H6.8l-.5-1.5-1.4-.6-1.4.7-1.7-1.7.7-1.4-.6-1.4-1.5-.5V8.2l1.5-.5.6-1.4-.7-1.4 1.7-1.7 1.4.7 1.4-.6.5-1.5Z" />
    </svg>
  );
}

function Sidebar({
  updatePillLabel = '⬆ 新版本 v0.4.0 — 点击升级',
  updatePillTitle = '下载新版本并自动重启升级',
  updatePillState = 'available',
  workspaces = DEFAULT_WORKSPACES,
  machines,
  onConnectMachine,
  onDisconnectMachine,
  onCancelMachine,
  onRetryMachine,
  onAddWorkspaceMachine,
  collapsedIds,
  onToggleCollapseMachine,
  onSelectWorkspace,
  onAddWorkspace,
  onOpenRemoteHosts,
  onOpenBrowserSettings,
  onReconnectWorkspace,
} = {}) {
  return (
    <aside className="sidebar" aria-label="Workspaces">
      <div className="sidebar-header">
        <button className="sidebar-bell-btn" title="Notifications"><BellIcon /></button>
        <button className="sidebar-add-btn" title="Add Project" onClick={onAddWorkspace}>+</button>
      </div>
      <div className="sidebar-list">
        {machines ? (
          machines.map((m) => (
            <MachineGroup
              key={m.id}
              machine={m}
              onConnect={onConnectMachine}
              onDisconnect={onDisconnectMachine}
              onCancel={onCancelMachine}
              onRetry={onRetryMachine}
              onSelectWorkspace={onSelectWorkspace}
              onAddWorkspace={onAddWorkspaceMachine}
              collapsed={collapsedIds ? collapsedIds.has(m.id) : false}
              onToggleCollapse={onToggleCollapseMachine}
            />
          ))
        ) : (
          <div className="sidebar-machine-group" data-machine-id="local">
            <div className="sidebar-machine-header sidebar-machine-header--clickable">
              <MachineChevron collapsed={false} />
              <MachineGroupLocalIcon />
              <span className="sidebar-machine-label">Local</span>
              <button className="sidebar-machine-add" title="Add Project" aria-label="Add Project" onClick={onAddWorkspace}>+</button>
            </div>
            {workspaces.map((item) => (
              <WorkspaceItem key={item.id} item={item} onReconnect={onReconnectWorkspace} />
            ))}
          </div>
        )}
      </div>
      <SidebarFooter
        devChannel
        updateAvailable
        version="0.3.12"
        updatePillLabel={updatePillLabel}
        updatePillTitle={updatePillTitle}
        updatePillState={updatePillState}
        onOpenRemoteHosts={onOpenRemoteHosts}
        onOpenBrowserSettings={onOpenBrowserSettings}
      />
    </aside>
  );
}

// ---- Sidebar 机器分组(模型 A:远程机为中心,workspace 注册表驻留 Host 侧)----

/**
 * 机器分组:本机组头无状态点;远程组头 = 状态点 + 别名(title 显 addr)。
 * status: 'connected' | 'connecting' | 'disconnected'(未连接·灰)| 'lost'(断线·红)。
 * workspaces 为 null = 未连接,连接后才能看到该机上的 workspace(A 模型核心)。
 *
 * machine.runtime(可选 · AC-8 连接生命周期):{stage, percent?, reason?, fast?, arch?} ·
 * 形状与 /settings/remote-hosts 的 hostRuntime 条目一致(CONNECT_STAGE_LABEL / FAIL_REASONS 复用) ·
 * stage='failed' → 组头显示原因 + 重试;stage∈连接中各态 → 显示阶段文案(+ deploying 时的 %)。
 * 不传 runtime 时保持旧有基于 machine.status 的渲染(零回归)。
 *
 * machine.foldedLost(可选 · D-8/AC-11):true = 断线后折叠回未连接态外观(隐藏 workspace 列表·
 * 显示 emptyLabel + 重连入口),区别于旧有「lost 仅整体变灰但仍展开」的呈现(该呈现继续保留·
 * 供未设置 foldedLost 的既有场景使用,零回归)。
 *
 * machine.status === 'reconnecting'(可选 · BL-005 AC-15):瞬时断线保活态 —— 区别于 'lost'(确定断线·
 * BL-004 full drop 边界)。组头黄点脉冲 + 「重连中…」而非红点/「已断开」·workspace 列表**照常展开**
 * (非 foldedLost·会话仍在远端跑·非消失)。
 */

// ---- 组头连接控件图标化(OKWORK-F260805033051):文字按钮(连接/重连/重试/连接中…)→ 纯图标钮,
// 新增断开钮与取消钮。语义:连接=相连的链环、断开=断裂的同一链环(互为反义,一眼看懂是同一件事的两个
// 方向)、取消=×、立即重试=循环箭头。视觉上向既有 .sidebar-machine-add(+)的「安静图标钮」看齐,
// 用 hover 语义色补偿去文字后的可发现性下降(见 styles.css .sidebar-machine-ctl--*)。----

function MachineConnectIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 7h3a5 5 0 0 1 0 10h-3m-6 0H6a5 5 0 0 1 0-10h3" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function MachineDisconnectIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 7h3a5 5 0 0 1 3.9 8.1M9 17H6a5 5 0 0 1-3.9-8.1" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function MachineCancelIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MachineRetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

/** 组头连接控件统一图标钮:variant 只管 hover 语义色(见 styles.css),title/aria-label 双写。
 *  onClick 内部统一 stopPropagation —— 组头本身现在可能挂了折叠点击(onToggleCollapse),控件点击
 *  不该顺带触发折叠。 */
function MachineCtlButton({ variant, icon, label, onClick }) {
  return (
    <button
      className={`sidebar-machine-ctl sidebar-machine-ctl--${variant}`}
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
    >
      {icon}
    </button>
  );
}

// ---- 复现门补齐(OKWORK-F260805033051):这个全景的 MachineGroup 停在 BL-004 形态,缺折叠三角 /
// 机器类别图标 / RTT 读数 / 组头「+」—— 真实 src/renderer/components/MachineGroup.tsx 早就有。
// 位置不变式是围绕「+」定义的,不补齐这几样就没有东西可以「贴最右」,所以一并照真实组件的图形补上。----

/** 组头折叠三角(disclosure):展开=向下,折叠=向右(CSS rotate)。只有 onToggleCollapse 传入时才
 *  渲染(与真实组件一致)—— 没接线的页面(A/E/G)不会平白多出一个点了没反应的三角。 */
function MachineChevron({ collapsed }) {
  return (
    <svg
      className={`sidebar-machine-chevron${collapsed ? ' sidebar-machine-chevron--collapsed' : ''}`}
      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** 组头机器类别图标:本机=显示器 / 远程=云。照抄真实 MachineGroup.tsx 的图形(与本文件另一个
 *  用途不同的 LocalMachineIcon/RemoteIcon 是两回事——那两个是 About/RemoteHosts 页用的独立风格)。 */
function MachineGroupLocalIcon() {
  return (
    <svg className="sidebar-machine-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function MachineGroupRemoteIcon() {
  return (
    <svg className="sidebar-machine-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

/** 连接延迟分级(与真实组件一致):<200ms 绿 · 200-499ms 琥珀 · ≥500ms 红 */
function rttTier(ms) {
  if (ms < 200) return 'good';
  if (ms < 500) return 'fair';
  return 'poor';
}

/** 折叠态组头的聚合会话徽标(仅 collapsed 且该机有 workspace 时用):对全组 workspace 的
 *  tabCount/tabRunning 求和,复用既有 formatTabBadge 的文案口径(定义在 MachineWorkspaceRow 上方)。 */
function aggregateTabs(workspaces) {
  let tabCount = 0;
  let tabRunning = 0;
  for (const ws of workspaces) {
    tabCount += typeof ws.tabCount === 'number' ? ws.tabCount : 0;
    tabRunning += ws.tabRunning || 0;
  }
  return { tabCount, tabRunning };
}

function MachineGroup({
  machine, onConnect, onDisconnect, onCancel, onRetry, onSelectWorkspace,
  onAddWorkspace, collapsed = false, onToggleCollapse,
}) {
  const isRemote = machine.kind === 'remote';
  // 🔴 AC-7:failed 运行态**不进组头渲染**——它改由全局 toast 一次性呈现,组头回落「未连接」外观。
  // 过滤成 null 后,下方 `!runtime && status === 'disconnected'` 分支自然接管,渲染连接图标钮。
  const runtime = machine.runtime && machine.runtime.stage !== 'failed' ? machine.runtime : null;
  const groupClasses = [
    'sidebar-machine-group',
    machine.status === 'lost' ? 'sidebar-machine-group--lost' : '',
  ].filter(Boolean).join(' ');

  function renderRuntimeStatus() {
    // 🔴 AC-7:failed 不再进组头(此前是常驻 `✗ 原因` + 重试钮)。失败改由全局 toast 一次性呈现,
    // 组头回落到「未连接」外观(连接图标钮)。故上方 runtime 已把 failed 过滤成 null,
    // 本函数不会再收到 failed —— 这里不留分支,免得日后有人以为组头还该显示失败。
    const label = CONNECT_STAGE_LABEL[runtime.stage] || '连接中…';
    const pct = runtime.stage === 'deploying' && typeof runtime.percent === 'number' ? ` ${runtime.percent}%` : '';
    return (
      <span className="sidebar-machine-status sidebar-machine-status--active">
        <span className="add-ws__spinner add-ws__spinner--sm" />
        {label}{pct}
        <MachineCtlButton variant="cancel" icon={<MachineCancelIcon />} label="取消" onClick={() => onCancel && onCancel(machine.id)} />
      </span>
    );
  }

  const showWorkspaces = machine.workspaces && !machine.foldedLost;
  const agg = collapsed && machine.workspaces && machine.workspaces.length > 0
    ? aggregateTabs(machine.workspaces)
    : null;
  const aggBadge = agg ? formatTabBadge(agg) : null;

  return (
    <div className={groupClasses}>
      <div
        className={`sidebar-machine-header${onToggleCollapse ? ' sidebar-machine-header--clickable' : ''}`}
        title={isRemote ? machine.addr : undefined}
        onClick={onToggleCollapse ? () => onToggleCollapse(machine.id) : undefined}
      >
        {onToggleCollapse && <MachineChevron collapsed={collapsed} />}
        {isRemote ? <MachineGroupRemoteIcon /> : <MachineGroupLocalIcon />}
        <span className="sidebar-machine-label">{isRemote ? machine.alias : machine.label}</span>
        {aggBadge && (
          <span className={`sidebar-machine-sessions${aggBadge.zero ? ' sidebar-machine-sessions--zero' : ''}`}>
            {aggBadge.text}
          </span>
        )}
        {/* connected 且有 RTT:单一小圆点并入延迟单元(圆点=毫秒数同色,按分级上色);其余状态维持
            原语义状态圆点(与真实 MachineGroup.tsx 的三元逻辑一致)。 */}
        {isRemote && machine.status === 'connected' && machine.rttMs !== undefined ? (
          <span className={`sidebar-machine-rtt sidebar-machine-rtt--${rttTier(machine.rttMs)}`}>
            <span className="sidebar-machine-rtt-dot" />
            {Math.round(machine.rttMs)}ms
          </span>
        ) : (
          isRemote && <span className={`sidebar-machine-dot sidebar-machine-dot--${machine.status}`} />
        )}
        {isRemote && runtime && renderRuntimeStatus()}
        {isRemote && !runtime && machine.foldedLost && (
          <MachineCtlButton variant="connect" icon={<MachineConnectIcon />} label="连接" onClick={() => onConnect && onConnect(machine.id)} />
        )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'disconnected' && (
          <MachineCtlButton variant="connect" icon={<MachineConnectIcon />} label="连接" onClick={() => onConnect && onConnect(machine.id)} />
        )}
        {/* 断线过渡(0–900ms · AC-15):此前该态组头不出任何控件,补齐一个连接钮,让用户不必等 900ms 折叠 */}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'lost' && (
          <MachineCtlButton variant="connect" icon={<MachineConnectIcon />} label="连接" onClick={() => onConnect && onConnect(machine.id)} />
        )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'connecting' && (
          <span className="sidebar-machine-connecting">
            连接中…
            <MachineCtlButton variant="cancel" icon={<MachineCancelIcon />} label="取消" onClick={() => onCancel && onCancel(machine.id)} />
          </span>
        )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'connected' && (
          <MachineCtlButton variant="disconnect" icon={<MachineDisconnectIcon />} label="断开" onClick={() => onDisconnect && onDisconnect(machine.id)} />
        )}
        {isRemote && !runtime && !machine.foldedLost && machine.status === 'reconnecting' && (
          <span className="sidebar-machine-status sidebar-machine-status--active">
            <span className="add-ws__spinner add-ws__spinner--sm" />
            重连中…
            <MachineCtlButton variant="retry" icon={<MachineRetryIcon />} label="立即重试" onClick={() => onRetry && onRetry(machine.id)} />
            <MachineCtlButton variant="disconnect" icon={<MachineDisconnectIcon />} label="断开" onClick={() => onDisconnect && onDisconnect(machine.id)} />
          </span>
        )}
        {/* 组头「+」:在该机添加项目(已连接才有意义——本机恒有 workspaces,远程仅连接后有)。
            恒为组头 DOM 最后一个元素,只在 onAddWorkspace 传入时渲染(与真实组件一致,A/E/G 三页
            未接线故不出现,零回归)。 */}
        {onAddWorkspace && machine.workspaces !== null && (
          <button
            className="sidebar-machine-add"
            title="添加项目"
            aria-label="添加项目"
            onClick={(e) => { e.stopPropagation(); onAddWorkspace(machine.id); }}
          >
            +
          </button>
        )}
      </div>
      {!collapsed && (showWorkspaces ? (
        machine.workspaces.map((ws, i) => (
          <MachineWorkspaceRow
            key={`${ws.name}-${i}`}
            ws={ws}
            onClick={onSelectWorkspace ? () => onSelectWorkspace(machine, ws) : undefined}
          />
        ))
      ) : (
        <div className="sidebar-machine-empty">
          {machine.emptyLabel || '未连接 · 连接后显示该机上的 workspace'}
        </div>
      ))}
    </div>
  );
}

/**
 * 机器组内 workspace 条目。会话徽标(AC-2/D-9)= 本客户端在该 workspace 的活跃 tab 数(hostId-aware) ·
 * 首连远程机可为 0(显式呈现「0 个标签」· 非隐藏)。
 * 优先用 ws.tabCount(number,新语义);兼容旧 ws.sessions(string · 既有页面未改动的调用点零回归)。
 * ws.disconnectedPanel(可选 · D-8):该 workspace 所在机器刚断线且它正是活跃态,行内打「已断开」态标签。
 */
function formatTabBadge(ws) {
  if (typeof ws.tabCount === 'number') {
    const running = ws.tabRunning || 0;
    const text = ws.tabCount === 0 ? '0 个标签' : `${ws.tabCount} 个标签${running ? ` · ${running} running` : ''}`;
    return { text, zero: ws.tabCount === 0 };
  }
  if (ws.sessions) return { text: ws.sessions, zero: false };
  return null;
}

/** ws.reconnectingPanel(可选 · BL-005 AC-15):瞬时断线保活态,复用同一条目视觉家族但标签是「重连中」
 *  (琥珀色·区别于「已断开」的红色·D-13 与 BL-004 full-drop 的关键区分——保活非移除)。 */
function MachineWorkspaceRow({ ws, onClick }) {
  const badge = formatTabBadge(ws);
  const classes = [
    'sidebar-item',
    ws.active ? 'sidebar-item--active' : '',
    (ws.disconnectedPanel || ws.reconnectingPanel) ? 'sidebar-item--disconnected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="sidebar-item-name-row">
        <span className="sidebar-item-name">{ws.name}</span>
        {ws.disconnectedPanel && <span className="sidebar-item-lost-tag">已断开</span>}
        {ws.reconnectingPanel && (
          <span className="sidebar-item-lost-tag sidebar-item-lost-tag--reconnecting">重连中</span>
        )}
      </div>
      <div className="sidebar-item-meta">
        <span className="sidebar-item-meta-row">
          <span className="sidebar-remote-meta-text">{ws.meta}</span>
          {badge && (
            <span className={`sidebar-machine-sessions${badge.zero ? ' sidebar-machine-sessions--zero' : ''}`}>
              {badge.text}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** Sidebar 单条 workspace 条目;支持 remote 字段(host 别名 + 连接状态)。 */
function WorkspaceItem({ item, onReconnect }) {
  const classes = [
    'sidebar-item',
    item.active ? 'sidebar-item--active' : '',
  ].filter(Boolean).join(' ');
  const remote = item.remote;
  const badge = formatTabBadge(item);

  return (
    <div className={classes}>
      <div className="sidebar-item-name-row">
        <span className="sidebar-item-name">{item.name}</span>
        {badge && <span className={`sidebar-machine-sessions${badge.zero ? ' sidebar-machine-sessions--zero' : ''}`}>{badge.text}</span>}
        <button className="sidebar-edit-btn" title="Edit project"><GearIcon /></button>
      </div>
      <div className="sidebar-item-meta">
        {remote ? (
          <span className="sidebar-item-meta-row">
            <span className={`sidebar-remote-chip sidebar-remote-chip--${remote.status}`}>
              <span className="sidebar-remote-dot" />
              {remote.host}
            </span>
            <span className="sidebar-remote-meta-text">{item.meta}</span>
            {remote.status === 'disconnected' && (
              <button
                className="sidebar-remote-reconnect"
                onClick={(e) => { e.stopPropagation(); onReconnect && onReconnect(item.id); }}
              >
                重连
              </button>
            )}
          </span>
        ) : (
          item.meta
        )}
      </div>
      <button className="sidebar-remove-btn" title="Remove project">×</button>
    </div>
  );
}

// ---- Sidebar footer: 左下角用户信息入口(Settings / About)----

function PersonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="4.3" r="2.4" />
      <path d="M2.5 12 C2.5 9.3 4.5 8 7 8 C9.5 8 11.5 9.3 11.5 12" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="6" />
      <line x1="7.5" y1="7" x2="7.5" y2="10.5" />
      <circle cx="7.5" cy="4.7" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RemoteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2" width="12" height="4.6" rx="1.1" />
      <rect x="1.5" y="8.4" width="12" height="4.6" rx="1.1" />
      <circle cx="4.1" cy="4.3" r="0.55" fill="currentColor" stroke="none" />
      <circle cx="4.1" cy="10.7" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BrowserIdentityIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="4.3" />
      <path d="M1.9 6h8.2M6 1.7c1.2 1.2 1.8 2.6 1.8 4.3S7.2 9.1 6 10.3C4.8 9.1 4.2 7.7 4.2 6S4.8 2.9 6 1.7Z" />
      <circle cx="10.8" cy="10.8" r="2.1" fill="var(--bg-panel)" />
      <path d="M12.3 12.3l1.3 1.3" />
    </svg>
  );
}

function LocalMachineIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="7.5" rx="1.2" />
      <line x1="5" y1="12" x2="9" y2="12" />
      <line x1="7" y1="10" x2="7" y2="12" />
    </svg>
  );
}

/** About 弹窗:展示应用名 + 当前版本(version 为空 → 「版本未知」)。Esc / 遮罩 / × 关闭。 */
function AboutModal({ version, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="about-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="about-card" onMouseDown={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose} title="关闭">×</button>
        <div className="about-logo">T</div>
        <div className="about-name">OkWork</div>
        <div className="about-version">{version ? `版本 ${version}` : '版本未知'}</div>
      </div>
    </div>
  );
}

/** 左下角用户信息入口:头像占位 + Settings + 上弹菜单(仅 About)→ About 弹版本。 */
function SidebarFooter({
  devChannel = false,
  updateAvailable = false,
  version = '',
  updatePillLabel = '⬆ 新版本 v0.4.0 — 点击升级',
  updatePillTitle = '下载新版本并自动重启升级',
  updatePillState = 'available',
  onOpenRemoteHosts,
  onOpenBrowserSettings,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const footerRef = useRef(null);

  // 菜单:点击外部 / Esc 关闭(对齐通知中心交互)
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e) {
      if (footerRef.current && !footerRef.current.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setMenuOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function openAbout() {
    setMenuOpen(false);   // 点 About:菜单先关
    setAboutOpen(true);   // 弹窗后开(两态不共存)
  }

  return (
    <div className="sidebar-footer" ref={footerRef}>
      {updateAvailable && (
        <button
          className={`sidebar-update-pill sidebar-update-pill--${updatePillState}`}
          title={updatePillTitle}
        >
          {updatePillLabel}
        </button>
      )}

      <div className="settings-anchor">
        {menuOpen && (
          <div className="settings-menu" role="menu">
            {onOpenBrowserSettings && (
              <button
                className="settings-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onOpenBrowserSettings(); }}
              >
                <span className="settings-menu-icon"><BrowserIdentityIcon /></span>
                <span className="settings-menu-label">Browser Settings</span>
              </button>
            )}
            {onOpenRemoteHosts && (
              <button
                className="settings-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onOpenRemoteHosts(); }}
              >
                <span className="settings-menu-icon"><RemoteIcon /></span>
                <span className="settings-menu-label">Remote Hosts</span>
              </button>
            )}
            <button className="settings-menu-item" role="menuitem" onClick={openAbout}>
              <span className="settings-menu-icon"><InfoIcon /></span>
              <span className="settings-menu-label">About</span>
            </button>
          </div>
        )}

        <button
          className={`settings-entry${menuOpen ? ' settings-entry--open' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          title="Settings"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="settings-avatar"><PersonIcon /></span>
          <span className="settings-entry-label">Settings</span>
          {devChannel && <span className="sidebar-dev-badge">DEV</span>}
          <span className="settings-entry-chevron">⌄</span>
        </button>
      </div>

      {aboutOpen && <AboutModal version={version} onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

const confirmationScenarios = {
  close: {
    label: 'Close Window',
    shellEvent: 'main-window close requested',
    title: '关闭主窗口?',
    message: '关闭后再打开，Tab 内容可能丢失。取消后 Workspace、Tab 和 Terminal 视图保持可用。',
    confirm: '关闭窗口',
    cancel: '取消',
    accent: 'neutral',
    updateLabel: '⬆ 新版本 v0.4.0 — 下载后确认安装',
    updateState: 'available',
    note: 'AC-1: 取消保持主窗口打开;确认继续 close window。',
  },
  quit: {
    label: 'App Quit',
    shellEvent: 'application quit requested',
    title: '退出 OkWork?',
    message: '退出后再打开，Tab 内容可能丢失。确认退出前会保留原有状态落盘机会。',
    confirm: '退出',
    cancel: '取消',
    accent: 'danger',
    updateLabel: '⬆ 新版本 v0.4.0 — 下载后确认安装',
    updateState: 'available',
    note: 'AC-2: 取消保持应用运行;确认继续 App Quit / Cmd+Q。',
  },
  install: {
    label: 'Install Ready',
    shellEvent: 'update downloaded, install pending',
    title: '安装 v0.4.0 并重启?',
    message: '升级包已下载完成。确认后 OkWork 会重启并交给 Squirrel.Mac 完成安装。',
    confirm: '安装并重启',
    cancel: '稍后',
    accent: 'primary',
    updateLabel: '下载完成 — 确认后安装',
    updateState: 'ready',
    note: 'AC-3/AC-5: 下载完成后先确认;确认才广播 restarting 并 quitAndInstall。',
  },
  retry: {
    label: 'Install Canceled',
    shellEvent: 'install canceled, update retryable',
    title: null,
    message: null,
    confirm: null,
    cancel: null,
    accent: 'success',
    updateLabel: '⬆ 新版本 v0.4.0 — 可重新安装',
    updateState: 'retryable',
    note: 'AC-4: 取消后不重启,watchdog 清理,installing 复位,胶囊恢复可点。',
  },
};

function ConfirmationDialog({ scenario }) {
  if (!scenario.title) return null;
  const confirmClass = [
    'confirm-dialog__button',
    'confirm-dialog__button--confirm',
    scenario.accent === 'danger' ? 'confirm-dialog__button--danger' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="confirm-backdrop" data-ac="AC-1 AC-2 AC-3 AC-5 AC-6">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-dialog__icon">!</div>
        <div className="confirm-dialog__body">
          <h1 id="confirm-title">{scenario.title}</h1>
          <p>{scenario.message}</p>
          <div className="confirm-dialog__actions">
            <button className="confirm-dialog__button confirm-dialog__button--cancel">
              {scenario.cancel}
            </button>
            <button className={confirmClass}>
              {scenario.confirm}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ConfirmationStatusPanel({ scenario }) {
  return (
    <div className="confirmation-status" data-ac="AC-4 AC-7">
      <div className="confirmation-status__eyebrow">Update state</div>
      <div className="confirmation-status__title">{scenario.updateLabel}</div>
      <div className="confirmation-status__body">{scenario.note}</div>
    </div>
  );
}

function ConfirmationTerminal({ scenario, onScenario }) {
  const lines = [
    ['event', scenario.shellEvent],
    ['guard', scenario.title ? 'confirmation pending' : 'retryable state restored'],
    ['result', scenario.note],
    ['smoke', 'OKWORK_SMOKE bypasses this confirmation path'],
  ];

  return (
    <div className="terminal-host" aria-label="Terminal">
      <div className="terminal-toolbar">
        {Object.entries(confirmationScenarios).map(([key, item]) => (
          <button
            key={key}
            className={`scenario-chip${scenario === item ? ' scenario-chip--active' : ''}`}
            onClick={() => onScenario(key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="terminal-screen">
        {lines.map(([prefix, value], index) => (
          <div className="terminal-line" key={`${prefix}-${index}`}>
            <span className="terminal-prefix">{prefix}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmationPreview() {
  const [scenarioKey, setScenarioKey] = useState('close');
  const scenario = confirmationScenarios[scenarioKey];

  return (
    <div className="app-shell">
      <Sidebar
        updatePillLabel={scenario.updateLabel}
        updatePillTitle="下载完成后确认安装/重启"
        updatePillState={scenario.updateState}
      />
      <div className="pane-handle" />
      <main className="main-column">
        <TabBar />
        <div className="terminal-area terminal-area--confirm-preview">
          <ConfirmationTerminal scenario={scenario} onScenario={setScenarioKey} />
          <ConfirmationStatusPanel scenario={scenario} />
          <ConfirmationDialog scenario={scenario} />
        </div>
      </main>
      <div className="pane-handle" />
      <FilePanel scenario={scenarios.worktree} />
      <SideRail />
    </div>
  );
}

function TabBar() {
  return (
    <div className="tabbar" aria-label="Tabs">
      <div className="tabbar-tabs">
        <div className="tabbar-tab tabbar-tab--active">
          <span className="tab-dot tab-dot--running" />
          <span className="tab-icon">▱</span>
          <span className="tabbar-tab-title">feature/terminal-path-file-panel</span>
          <button className="tabbar-close-btn tabbar-close-btn--always" title="Close tab">×</button>
        </div>
        <div className="tabbar-tab">
          <span className="tab-dot tab-dot--idle" />
          <span className="tab-icon">▱</span>
          <span className="tabbar-tab-title">main</span>
        </div>
        <button className="tabbar-add-btn" title="New tab">+</button>
        <button className="tabbar-dropdown-btn" title="New tab options">▾</button>
      </div>
      <div className="tabbar-drag-strip" />
    </div>
  );
}

function RailGlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <ellipse cx="8" cy="8" rx="2.9" ry="6.5" />
      <line x1="1.5" y1="8" x2="14.5" y2="8" />
    </svg>
  );
}

function RailFolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 4a1 1 0 0 1 1-1h3l1.5 1.8h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" />
    </svg>
  );
}

function SideRail({ active = 'files' }) {
  return (
    <div className="side-rail" aria-label="Side panel controls">
      <button className={`side-rail-btn${active === 'browser' ? ' side-rail-btn--active' : ''}`} title="Show browser"><RailGlobeIcon /></button>
      <button className={`side-rail-btn${active === 'files' ? ' side-rail-btn--active' : ''}`} title="Hide file panel"><RailFolderIcon /></button>
    </div>
  );
}

function PanelCloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
      <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
    </svg>
  );
}

function PreviewPanelHeader({ title, icon }) {
  return (
    <div className="panel-header">
      <span className="panel-header__icon">{icon}</span>
      <span className="panel-header__title">{title}</span>
      <div className="panel-header__spacer" />
      <button type="button" className="panel-header__btn" title={`Hide ${title.toLowerCase()}`}><PanelCloseIcon /></button>
    </div>
  );
}

function Terminal({ scenario, onScenario }) {
  const lines = useMemo(() => [
    ['codex', 'review found path candidate'],
    ['path', scenario.terminalPath],
    ['okwork', scenario.terminalStatus],
    ['shell', 'ready'],
  ], [scenario]);

  return (
    <div className="terminal-host" aria-label="Terminal">
      <div className="terminal-toolbar">
        {Object.entries(scenarios).map(([key, item]) => (
          <button
            key={key}
            className={`scenario-chip${scenario === item ? ' scenario-chip--active' : ''}`}
            onClick={() => onScenario(key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="terminal-screen">
        {lines.map(([prefix, value], index) => (
          <div className="terminal-line" key={`${prefix}-${index}`}>
            <span className="terminal-prefix">{prefix}</span>
            {prefix === 'path' ? (
              <button className="terminal-link" onClick={() => onScenario(Object.keys(scenarios).find((key) => scenarios[key] === scenario))}>
                {value}
              </button>
            ) : (
              <span>{value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 远程 workspace「文件」= 树浏览 + git 着色(在范围·D-7)。remote=true 时:
 * 点文件行 / 行内 diff 按钮 / 顶部 Diff 按钮一律**禁用弹窗** + 显示确定性提示
 * 「远程文件独立窗口暂不支持」(非静默失败·AC-5)。remote 默认 false,其余调用点零变化。
 */
function FilePanel({ scenario, remote = false }) {
  const mode = scenario.mode;
  const [hint, setHint] = useState(false);
  const hintTimer = useRef(null);

  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  function showRemoteHint() {
    if (!remote) return;
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), 1800);
  }

  return (
    <section className={`file-panel${remote ? ' file-panel--remote' : ''}`} aria-label="File Panel">
      <PreviewPanelHeader title="Files" icon={<RailFolderIcon />} />
      <div className="file-panel__header">
        <div className="file-panel__seg">
          <button className={`file-panel__seg-btn${mode === 'root' ? ' file-panel__seg-btn--active' : ''}`}>Root</button>
          <button className={`file-panel__seg-btn${mode === 'worktree' ? ' file-panel__seg-btn--active' : ''}`}>WorkTree</button>
        </div>
      </div>

      <div className="file-panel__controls">
        {mode === 'root' ? (
          <>
            <div className="file-panel__ctrl-row">
              <input className="file-panel__path-input" value={scenario.root} readOnly />
              <button className="file-panel__ctrl-btn">Choose…</button>
            </div>
            <div className="file-panel__ctrl-row file-panel__ctrl-row--hint">
              <span className="file-panel__hint">{scenario.hint}</span>
              <button className="file-panel__ctrl-btn" disabled>Apply</button>
            </div>
          </>
        ) : (
          <>
            <div className="file-panel__ctrl-row">
              <select className="file-panel__wt-select" value={scenario.root} readOnly>
                <option>{scenario.root}</option>
              </select>
              <button className="file-panel__ctrl-btn file-panel__ctrl-btn--icon" title="Reload worktrees">⟳</button>
            </div>
            <div className="file-panel__ctrl-row file-panel__ctrl-row--hint">
              <span className="file-panel__hint">{scenario.hint}</span>
            </div>
          </>
        )}
      </div>

      <div className="file-panel__meta">
        <span className="file-panel__count">{scenario.rows.length} entries</span>
        <div className="file-panel__meta-actions">
          <button
            className="file-panel__diff-btn"
            onClick={remote ? showRemoteHint : undefined}
            title={remote ? '远程文件独立窗口暂不支持' : undefined}
            aria-disabled={remote || undefined}
          >
            Diff
          </button>
          <button className="file-panel__refresh" title="Refresh">⟳</button>
        </div>
      </div>
      <div className="file-panel__divider" />

      <div className="file-panel__tree">
        {scenario.rows.map((row) => (
          <TreeRow key={`${row.depth}-${row.name}`} row={row} remote={remote} onFileClick={showRemoteHint} />
        ))}
      </div>

      {remote && hint && (
        <div className="file-panel__remote-hint" role="status">远程文件独立窗口暂不支持</div>
      )}
    </section>
  );
}

function TreeRow({ row, remote = false, onFileClick }) {
  const isDir = row.kind === 'dir';
  const classes = [
    'file-panel__row',
    isDir ? 'file-panel__row--dir' : 'file-panel__row--file',
    row.status ? `file-panel__row--git-${row.status}` : '',
    row.target ? 'file-panel__row--locate-target' : '',
  ].filter(Boolean).join(' ');
  const fileDisabled = !isDir && remote;

  return (
    <div
      className={classes}
      style={{ paddingLeft: 10 + row.depth * 14 }}
      onClick={fileDisabled ? onFileClick : undefined}
      title={fileDisabled ? '远程文件独立窗口暂不支持' : undefined}
    >
      <span className="file-panel__arrow">{isDir ? (row.expanded ? '▾' : '▸') : null}</span>
      <span className="file-panel__name">{row.name}</span>
      {!isDir && (
        <button
          className="file-panel__row-action"
          aria-disabled={fileDisabled || undefined}
          onClick={fileDisabled ? (e) => { e.stopPropagation(); onFileClick(); } : undefined}
          title={fileDisabled ? '远程文件独立窗口暂不支持' : undefined}
        >
          diff
        </button>
      )}
    </div>
  );
}

/** 无 dev 工具栏的纯净终端:新路由背景用,不带预览专属的场景切换控件。 */
function PlainTerminal({ promptUser = 'liam@local' }) {
  return (
    <div className="terminal-host" aria-label="Terminal">
      <div className="terminal-screen">
        <div className="terminal-line">
          <span className="terminal-prefix">{promptUser}</span>
          <span>~ $</span>
        </div>
      </div>
    </div>
  );
}

// ---- Remote workspace mock data(add-workspace 与 remote-hosts 两个预览路由共用)----

// 全部主机归「手动添加」区(CRUD);lastUsed 有值的同时出现在「最近使用」快捷区
const REMOTE_HOSTS_SEED = [
  { id: 'mini-pc', alias: 'mini-pc', user: 'liam', host: '192.168.1.40', port: 22, auth: 'key', identityFile: 'id_ed25519', status: 'connected', lastUsed: '2 小时前' },
  { id: 'build-mac', alias: 'build-mac', user: 'builder', host: '192.168.1.52', port: 22, auth: 'key', identityFile: 'id_ed25519', status: 'connected', lastUsed: '刚刚' },
  { id: 'dev-server', alias: 'dev-server', user: 'liam', host: '10.0.0.8', port: 22, auth: 'key', identityFile: 'id_ed25519', status: 'disconnected', lastUsed: '昨天' },
  { id: 'gpu-box', alias: 'gpu-box', user: 'root', host: 'gpu.lan', port: 2222, auth: 'password', identityFile: null, status: 'disconnected' },
  { id: 'vps-hk', alias: 'vps-hk', user: 'deploy', host: 'hk1.example.com', port: 22, auth: 'key', identityFile: 'id_ed25519', status: 'disconnected' },
];

const DEFAULT_MANUAL_HOSTS = REMOTE_HOSTS_SEED;

// ---- 机器分组 mock(模型 A):Sidebar 按机器分组,workspace 注册表在各机 Host 侧 ----

/** 「连上即发现」演示数据:连接成功后从该机 Host 拉到的 workspace 列表。 */
const DISCOVERED_WORKSPACES = [
  { name: 'web-app', meta: 'main · ~/apps/web-app', sessions: '1 会话' },
  { name: 'data-sync', meta: 'main · ~/work/data-sync' },
];

const BASE_MACHINES = [
  {
    id: 'local', kind: 'local', label: '本机',
    workspaces: [{ name: 'OkWork', meta: 'main · ~/apps/okok/OkWork', active: true }],
  },
  {
    id: 'mini-pc', kind: 'remote', alias: 'mini-pc', addr: 'liam@192.168.1.40', status: 'connected',
    workspaces: [
      { name: 'aon-edge', meta: 'dev · ~/apps/aon-edge', sessions: '2 会话 · 1 running' },
      { name: 'ml-lab', meta: 'main · ~/work/ml-lab' },
    ],
  },
  {
    id: 'dev-server', kind: 'remote', alias: 'dev-server', addr: 'liam@10.0.0.8', status: 'disconnected',
    workspaces: null,
  },
];

/** 「连接」模拟:600ms 连接中(黄点)→ 已连接(绿点)并列出该机 workspace。 */
function startMachineConnect(setConnState, id) {
  setConnState((prev) => ({ ...prev, [id]: 'connecting' }));
  setTimeout(() => {
    setConnState((prev) => ({ ...prev, [id]: 'connected' }));
  }, 600);
}

/** 按连接模拟状态解析 machines:connecting 盖状态;connected 盖状态并注入发现的 workspace;
 *  disconnected(AC-2 · 手动断开钮)立即回未连接态、workspace 清空,不经 900ms 过渡态。 */
function applyConnectionSim(machines, connState) {
  return machines.map((m) => {
    const st = connState[m.id];
    if (!st) return m;
    if (st === 'connecting') return { ...m, status: 'connecting' };
    if (st === 'disconnected') return { ...m, status: 'disconnected', workspaces: null };
    return { ...m, status: 'connected', workspaces: m.workspaces || DISCOVERED_WORKSPACES };
  });
}

const REMOTE_DIR_TREE = {
  '': ['home'],
  home: ['liam'],
  'home/liam': ['apps', 'work', '.config'],
  'home/liam/apps': ['aon-edge', 'tools'],
  'home/liam/apps/aon-edge': [],
  'home/liam/apps/tools': [],
  'home/liam/work': [],
  'home/liam/.config': [],
};

function listRemoteDir(segments) {
  return REMOTE_DIR_TREE[segments.join('/')] || [];
}

/** fs.readdir over 远程 host 的错误态 mock(AC-3):键命中即模拟该目录读取失败(权限拒绝)。 */
const REMOTE_DIR_ERRORS = {
  'home/liam/.config': 'EACCES: permission denied, scandir \'/home/liam/.config\'',
};

function formatRemotePath(segments) {
  if (segments.length >= 2 && segments[0] === 'home' && segments[1] === 'liam') {
    const rest = segments.slice(2);
    return rest.length ? `~/${rest.join('/')}` : '~';
  }
  return `/${segments.join('/')}`;
}

function buildCrumbs(segments) {
  const crumbs = [{ label: '/', segments: [] }];
  let acc = [];
  for (const seg of segments) {
    acc = [...acc, seg];
    crumbs.push({ label: seg, segments: acc });
  }
  return crumbs;
}

// ---- A. /workspace/add-workspace ----

const ADD_WS_STATE_PRESETS = [
  { key: 'idle', label: '默认交互' },
  { key: 'connecting', label: '连接中' },
  { key: 'deploying', label: '首次部署 Host' },
  { key: 'error', label: '连接失败' },
  { key: 'disconnected', label: '远程断线' },
];

/**
 * 「添加项目」modal(模型 A):第一步选机器(本机置顶 + 远程机分组)→
 * 本机目录面板 / 远程目录浏览器;connecting/deploying/error 三态以内覆盖层呈现。
 */
function AddWorkspaceModal({
  overlay,
  retrying,
  onRetry,
  onEditConfig,
  onClose,
  step,
  hosts,
  onSelectLocal,
  onSelectHost,
  onManageHosts,
  selectedHost,
  dirSegments,
  dirLoading,
  dirError,
  onRetryDir,
  onCrumb,
  onDescend,
  onBackToPick,
  onCreate,
}) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hostGroups = [
    { title: '最近使用', hosts: hosts.filter((h) => h.lastUsed) },
    { title: '手动添加', hosts: hosts.filter((h) => !h.lastUsed) },
  ];
  const dirs = step === 'dir' ? listRemoteDir(dirSegments) : [];
  const crumbs = step === 'dir' ? buildCrumbs(dirSegments) : [];
  const pathDisplay = step === 'dir' ? formatRemotePath(dirSegments) : '';

  return (
    <div
      className="add-ws__backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="add-ws__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="add-ws__header">
          <div>
            <div className="add-ws__title">添加项目</div>
            <div className="add-ws__subtitle">项目注册在所选机器上 · 任何设备连接后可见</div>
          </div>
          <button className="add-ws__close" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="add-ws__body">
          {overlay === 'connecting' && (
            <div className="add-ws__overlay">
              <span className="add-ws__spinner" />
              <div className="add-ws__overlay-text">正在建立 SSH 隧道 → mini-pc…</div>
            </div>
          )}

          {overlay === 'deploying' && (
            <div className="add-ws__overlay add-ws__overlay--deploy">
              <div className="add-ws__deploy-title">首次部署 Host</div>
              <ul className="add-ws__deploy-list">
                <li className="add-ws__deploy-item">
                  <span className="add-ws__deploy-check">✓</span>
                  <span>上传 host bundle</span>
                </li>
                <li className="add-ws__deploy-item">
                  <span className="add-ws__deploy-check">✓</span>
                  <span>启动 host 进程</span>
                </li>
                <li className="add-ws__deploy-item">
                  <span className="add-ws__spinner add-ws__spinner--sm" />
                  <span>协议握手 v1 …</span>
                </li>
              </ul>
            </div>
          )}

          {overlay === 'error' && (
            <div className="add-ws__overlay add-ws__overlay--error">
              {retrying ? (
                <>
                  <span className="add-ws__spinner" />
                  <div className="add-ws__overlay-text">正在重试 → dev-server…</div>
                </>
              ) : (
                <>
                  <div className="add-ws__error-summary">ssh: connect to host 10.0.0.8 port 22: Connection refused (exit 255)</div>
                  <div className="add-ws__error-actions">
                    <button className="add-ws__btn" onClick={onEditConfig}>编辑配置</button>
                    <button className="add-ws__btn add-ws__btn--primary" onClick={onRetry}>重试</button>
                  </div>
                </>
              )}
            </div>
          )}

          {!overlay && step === 'pick' && (
            <div className="add-ws__panel">
              <div className="add-ws__host-list add-ws__host-list--local">
                <button className="add-ws__host-row" onClick={onSelectLocal}>
                  <span className="add-ws__local-icon"><LocalMachineIcon /></span>
                  <span className="add-ws__host-alias">本机</span>
                  <span className="add-ws__host-addr">macOS · 本地目录</span>
                  <span className="add-ws__host-chevron">›</span>
                </button>
              </div>
              {hostGroups.map((group) => group.hosts.length > 0 && (
                <div key={group.title} className="add-ws__host-group">
                  <div className="add-ws__host-group-title">{group.title}</div>
                  <div className="add-ws__host-list">
                    {group.hosts.map((h) => (
                      <button key={h.id} className="add-ws__host-row" onClick={() => onSelectHost(h.id)}>
                        <span className={`add-ws__host-dot add-ws__host-dot--${h.status}`} />
                        <span className="add-ws__host-alias">{h.alias}</span>
                        <span className="add-ws__host-addr">{h.user}@{h.host}:{h.port}</span>
                        <span className="add-ws__host-auth">{h.auth === 'password' ? '密码' : '密钥'}</span>
                        <span className="add-ws__host-chevron">›</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="add-ws__host-footer">
                <a className="add-ws__manage-link" onClick={onManageHosts}>管理远程机…</a>
              </div>
            </div>
          )}

          {!overlay && step === 'local' && (
            <div className="add-ws__panel">
              <div className="add-ws__dirhead">
                <button className="add-ws__back" onClick={onBackToPick}>‹ 返回</button>
                <span className="add-ws__machine-chip">本机</span>
              </div>
              <p className="add-ws__desc">选择本机目录作为项目根</p>
              <button className="add-ws__btn add-ws__btn--primary">选择目录…</button>
              <div className="add-ws__hint">真实应用中打开系统目录选择器</div>
            </div>
          )}

          {!overlay && step === 'dir' && selectedHost && (
            <div className="add-ws__panel">
              <div className="add-ws__dirhead">
                <button className="add-ws__back" onClick={onBackToPick}>‹ 返回</button>
                <span className={`add-ws__machine-chip add-ws__machine-chip--${selectedHost.status}`}>
                  <span className="add-ws__machine-dot" />
                  {selectedHost.alias}
                </span>
              </div>
              <div className="add-ws__breadcrumb">
                {crumbs.map((c, i) => (
                  <span key={i} className="add-ws__crumb-wrap">
                    {i > 0 && <span className="add-ws__crumb-sep">/</span>}
                    <button className="add-ws__crumb" onClick={() => onCrumb(c.segments)}>{c.label}</button>
                  </span>
                ))}
              </div>
              {dirLoading ? (
                <div className="add-ws__dirlist add-ws__dirlist--loading">
                  <span className="add-ws__spinner add-ws__spinner--sm" />
                  <span>正在读取目录…</span>
                </div>
              ) : dirError ? (
                <div className="add-ws__dir-error">
                  <div className="add-ws__dir-error-text">{dirError}</div>
                  <button className="add-ws__btn" onClick={onRetryDir}>重试</button>
                </div>
              ) : (
                <div className="add-ws__dirlist">
                  {dirs.length === 0 && <div className="add-ws__dir-empty">(空目录)</div>}
                  {dirs.map((name) => (
                    <div key={name} className="file-panel__row file-panel__row--dir" onClick={() => onDescend(name)}>
                      <span className="file-panel__arrow">▸</span>
                      <span className="file-panel__name">{name}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="add-ws__pathrow">
                <input className="file-panel__path-input add-ws__path-input" value={pathDisplay} readOnly />
              </div>
              <div className="add-ws__actions">
                <button className="add-ws__btn" onClick={onClose}>取消</button>
                <button
                  className="add-ws__btn add-ws__btn--primary"
                  onClick={onCreate}
                  disabled={dirLoading || !!dirError}
                >
                  在 {selectedHost.alias} 上创建项目
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddWorkspacePage({ currentPath, onNavigate }) {
  const [devState, setDevState] = useState('idle');
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [step, setStep] = useState('pick');
  const [selectedHostId, setSelectedHostId] = useState(null);
  const [dirSegments, setDirSegments] = useState(['home', 'liam']);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState(null);
  const dirLoadTimer = useRef(null);
  const [connState, setConnState] = useState({});
  const [extraByMachine, setExtraByMachine] = useState({});
  const [createdMachines, setCreatedMachines] = useState([]);
  const [retrying, setRetrying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    setUserModalOpen(false);
    setRetrying(false);
    setReconnecting(false);
    setReconnected(false);
    setConnState({});
    setExtraByMachine({});
    setCreatedMachines([]);
  }, [devState]);

  useEffect(() => () => { if (dirLoadTimer.current) clearTimeout(dirLoadTimer.current); }, []);

  /** fs.readdir over 该 host client 的加载态模拟(AC-3):落定 segments 前先转圈,命中 REMOTE_DIR_ERRORS 则呈现错误态。 */
  function loadDir(nextSegments) {
    setDirSegments(nextSegments);
    setDirLoading(true);
    setDirError(null);
    if (dirLoadTimer.current) clearTimeout(dirLoadTimer.current);
    dirLoadTimer.current = setTimeout(() => {
      setDirLoading(false);
      const key = nextSegments.join('/');
      if (REMOTE_DIR_ERRORS[key]) setDirError(REMOTE_DIR_ERRORS[key]);
    }, 350);
  }

  function resetModalFlow() {
    setStep('pick');
    setSelectedHostId(null);
    setDirSegments(['home', 'liam']);
    setDirLoading(false);
    setDirError(null);
    if (dirLoadTimer.current) { clearTimeout(dirLoadTimer.current); dirLoadTimer.current = null; }
  }

  function openModal() {
    resetModalFlow();
    setUserModalOpen(true);
  }

  function closeModal() {
    setUserModalOpen(false);
    resetModalFlow();
  }

  function selectLocal() {
    setStep('local');
    setSelectedHostId(null);
  }

  function selectHost(id) {
    setSelectedHostId(id);
    setStep('dir');
    loadDir(['home', 'liam']);
  }

  function backToPick() {
    setStep('pick');
    setSelectedHostId(null);
  }

  /** 创建远程项目:新 workspace 条目落入 Sidebar 对应机器组(组不存在则新建机器组)。 */
  function handleCreate() {
    const host = REMOTE_HOSTS_SEED.find((h) => h.id === selectedHostId);
    if (!host) { closeModal(); return; }
    const name = dirSegments[dirSegments.length - 1] || host.alias;
    const ws = { name, meta: `main · ${formatRemotePath(dirSegments)}` };
    const inBase = BASE_MACHINES.some((m) => m.id === host.id);
    const inCreated = createdMachines.some((m) => m.id === host.id);
    if (inCreated) {
      setCreatedMachines((prev) => prev.map((m) => (
        m.id === host.id ? { ...m, workspaces: [...m.workspaces, ws] } : m
      )));
    } else if (inBase) {
      const baseMachine = BASE_MACHINES.find((m) => m.id === host.id);
      if (!baseMachine.workspaces) {
        // 创建成功隐含 SSH 已连通:未连接的基础机器视为已连接(已连接/断线机器不动状态)
        setConnState((prev) => ({ ...prev, [host.id]: 'connected' }));
      }
      setExtraByMachine((prev) => ({ ...prev, [host.id]: [...(prev[host.id] || []), ws] }));
    } else {
      setCreatedMachines((prev) => [
        ...prev,
        { id: host.id, kind: 'remote', alias: host.alias, addr: `${host.user}@${host.host}`, status: 'connected', workspaces: [ws] },
      ]);
    }
    closeModal();
  }

  function handleRetry() {
    setRetrying(true);
    setTimeout(() => setRetrying(false), 1200);
  }

  function handleEditConfig() {
    onNavigate('/settings/remote-hosts');
  }

  function handleReconnectNow() {
    setReconnecting(true);
    setTimeout(() => {
      setReconnecting(false);
      setReconnected(true);
    }, 900);
  }

  const overlay = ['connecting', 'deploying', 'error'].includes(devState) ? devState : null;
  const modalVisible = devState === 'disconnected' ? userModalOpen : (userModalOpen || !!overlay);
  const miniPcLost = devState === 'disconnected' && !reconnected;
  const showReconnectBanner = miniPcLost;
  const selectedHost = REMOTE_HOSTS_SEED.find((h) => h.id === selectedHostId) || null;

  // 机器分组:断线注入 → mini-pc 组头红点、组内条目变灰;连接模拟 → 状态/发现的 workspace;创建 → 追加条目
  const baseMachines = BASE_MACHINES.map((m) => (
    m.id === 'mini-pc' && miniPcLost ? { ...m, status: 'lost' } : m
  ));
  const machines = [
    ...applyConnectionSim(baseMachines, connState).map((m) => {
      const extra = extraByMachine[m.id] || [];
      if (!extra.length || !m.workspaces) return m;
      return { ...m, workspaces: [...m.workspaces, ...extra] };
    }),
    ...createdMachines,
  ];

  return (
    <PreviewPage
      currentPath={currentPath}
      onNavigate={onNavigate}
      statePresets={ADD_WS_STATE_PRESETS}
      activeStateKey={devState}
      onSelectState={setDevState}
    >
      <div className="app-shell">
        <Sidebar
          machines={machines}
          onConnectMachine={(id) => startMachineConnect(setConnState, id)}
          onAddWorkspace={openModal}
          onOpenRemoteHosts={() => onNavigate('/settings/remote-hosts')}
        />
        <div className="pane-handle" />
        <main className="main-column">
          <TabBar />
          <div className="terminal-area">
            <div className="add-ws__terminal-wrap">
              {showReconnectBanner && (
                <div className="add-ws__reconnect-banner">
                  <span>与 mini-pc 的连接已断开 · 正在重连(第 2 次)…</span>
                  <button className="add-ws__reconnect-btn" onClick={handleReconnectNow} disabled={reconnecting}>
                    {reconnecting ? '重连中…' : '立即重连'}
                  </button>
                </div>
              )}
              <PlainTerminal />
            </div>
          </div>
        </main>
        <div className="pane-handle" />
        <FilePanel scenario={scenarios.worktree} />
        <SideRail />
      </div>

      {modalVisible && (
        <AddWorkspaceModal
          overlay={overlay}
          retrying={retrying}
          onRetry={handleRetry}
          onEditConfig={handleEditConfig}
          onClose={closeModal}
          step={step}
          hosts={REMOTE_HOSTS_SEED}
          onSelectLocal={selectLocal}
          onSelectHost={selectHost}
          onManageHosts={() => onNavigate('/settings/remote-hosts')}
          selectedHost={selectedHost}
          dirSegments={dirSegments}
          dirLoading={dirLoading}
          dirError={dirError}
          onRetryDir={() => loadDir(dirSegments)}
          onCrumb={loadDir}
          onDescend={(name) => loadDir([...dirSegments, name])}
          onBackToPick={backToPick}
          onCreate={handleCreate}
        />
      )}
    </PreviewPage>
  );
}

// ---- E. BL-006 Browser Profile password vault (local-first) ----

const BROWSER_PROFILE_STATE_PRESETS = [
  { key: 'ready', label: '正常' },
  { key: 'syncing', label: '登录状态同步中' },
  { key: 'sync-skipped', label: 'Cookie 跳过项' },
  { key: 'sync-conflict', label: '冲突已处理' },
  { key: 'host-upgrade', label: 'Host 需升级' },
  { key: 'profile-moved', label: 'Profile 已移走' },
  { key: 'loading', label: '加载中' },
  { key: 'empty', label: '无自定义 Profile' },
  { key: 'authority-offline', label: '远程存储离线' },
  { key: 'migration-error', label: '迁移失败 · 源仍有效' },
  { key: 'cleanup-pending', label: '源清理待重试' },
  { key: 'encryption-unavailable', label: '系统加密不可用' },
  { key: 'delete-failed', label: '删除失败 · 可重试' },
];

const PASSWORD_STATE_PRESETS = [
  { key: 'ready', label: '正常' },
  { key: 'loading', label: '加载中' },
  { key: 'empty', label: '空态' },
  { key: 'remote-offline', label: '远程密码库离线' },
  { key: 'trusted-offline', label: '受信任窗口打开后断线' },
  { key: 'error', label: '加载失败' },
  { key: 'encryption-unavailable', label: '系统加密不可用' },
];

const PASSWORD_FLOW_STATE_PRESETS = [
  { key: 'login-restored', label: '登录状态已恢复' },
  { key: 'continuity-syncing', label: '正在准备登录状态' },
  { key: 'continuity-error', label: '登录状态准备失败' },
  { key: 'autofilled', label: '静默填充' },
  { key: 'loading', label: '密码库连接中' },
  { key: 'empty', label: '密码库空态' },
  { key: 'saved', label: '自动保存' },
  { key: 'updated', label: '自动更新' },
  { key: 'multi', label: '多账号' },
  { key: 'no-match', label: '无匹配' },
  { key: 'other-profile', label: 'Profile 隔离' },
  { key: 'uncertain', label: '无法确认 · 未保存' },
  { key: 'auth-failed', label: '登录失败 · 未覆盖' },
  { key: 'remote-offline', label: '远程存储离线' },
  { key: 'encryption-unavailable', label: '系统加密不可用' },
  { key: 'insecure-origin', label: '普通 HTTP · 已停用' },
];

function BrowserIdentityWorkbench({ currentPath, onNavigate, presets, state, setState, children }) {
  return (
    <PreviewPage
      currentPath={currentPath}
      onNavigate={onNavigate}
      statePresets={presets}
      activeStateKey={state}
      onSelectState={setState}
    >
      <div className="app-shell">
        <Sidebar
          onAddWorkspace={() => onNavigate('/workspace/add-workspace')}
          onOpenRemoteHosts={() => onNavigate('/settings/remote-hosts')}
          onOpenBrowserSettings={() => onNavigate('/settings/browser-profiles')}
        />
        <div className="pane-handle" />
        <main className="main-column">
          <TabBar />
          <div className="terminal-area"><PlainTerminal /></div>
        </main>
        <div className="pane-handle" />
        <FilePanel scenario={scenarios.worktree} />
        <SideRail />
      </div>
      {children}
    </PreviewPage>
  );
}

function BrowserSettingOption({ selected, title, detail, onSelect }) {
  return (
    <button className={`browser-settings__option${selected ? ' browser-settings__option--selected' : ''}`} onClick={onSelect}>
      <span className="browser-settings__radio">{selected ? '✓' : ''}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </button>
  );
}

function BrowserSettingGroups() {
  const [linkMode, setLinkMode] = useState('builtin');
  const [surface, setSurface] = useState('pane');
  return (
    <div className="browser-settings__groups">
      <div>
        <div className="browser-profile__section-title">Open links in</div>
        <div className="browser-settings__option-list">
          <BrowserSettingOption selected={linkMode === 'builtin'} onSelect={() => setLinkMode('builtin')} title="Built-in browser" detail="Terminal links open in OkWork’s own browser." />
          <BrowserSettingOption selected={linkMode === 'system'} onSelect={() => setLinkMode('system')} title="System browser" detail="Terminal links open in your default browser." />
          <BrowserSettingOption selected={linkMode === 'remote'} onSelect={() => setLinkMode('remote')} title="Built-in for remote terminals only" detail="Remote terminals use the built-in browser; local terminals use the system browser." />
        </div>
      </div>
      <div>
        <div className="browser-profile__section-title">Open the built-in browser in</div>
        <div className="browser-settings__option-list">
          <BrowserSettingOption selected={surface === 'window'} onSelect={() => setSurface('window')} title="Separate window" detail="The built-in browser opens as its own OkBrowser window." />
          <BrowserSettingOption selected={surface === 'pane'} onSelect={() => setSurface('pane')} title="In the app panel" detail="The built-in browser opens in the panel on the right of the main window." />
        </div>
      </div>
    </div>
  );
}

function BrowserPasswordScope() {
  return (
    <div className="browser-profile__scope browser-profile__scope--danger">
      <div>
        <div className="browser-profile__scope-title">密码保护暂不可用</div>
        <div className="browser-profile__scope-copy">
          系统钥匙串未授权。OkWork 不会明文保存、填充、显示或复制密码。
        </div>
      </div>
    </div>
  );
}

function ProfileSkeletons() {
  return (
    <div className="browser-profile__list browser-profile__list--loading" aria-label="Loading browser profiles">
      {[0, 1, 2].map((i) => <div className="browser-profile__skeleton" key={i}><i /><span /><b /></div>)}
    </div>
  );
}

const PROFILE_SEED = [
  { id: 'default', name: 'OkWork', meta: '系统默认 UA · 默认 Profile', count: 2, builtIn: true },
  { id: 'work', name: 'Work', meta: 'Chrome 兼容 UA · 3 个 Project', count: 3 },
  { id: 'personal', name: 'Personal', meta: '系统默认 UA · 1 个 Project', count: 1 },
];

const AUTHORITY_TARGETS = [
  { id: 'local', label: 'This device', detail: '本机系统钥匙串加密', kind: 'local' },
  { id: 'mini-pc', label: 'mini-pc', detail: 'liam@192.168.1.40 · 已连接 · Profile storage compatible', kind: 'remote' },
  { id: 'build-mac', label: 'build-mac', detail: 'builder@192.168.1.52 · 已连接 · Profile storage compatible', kind: 'remote' },
];

const EXCLUDED_AUTHORITY_TARGETS = [
  { id: 'dev-server', label: 'dev-server', reason: '未连接' },
  { id: 'vps-hk', label: 'vps-hk', reason: 'Host 版本不兼容' },
];

function authorityName(authorityId) {
  return authorityId === 'local' ? 'This device' : authorityId;
}

function AuthorityChangeDialog({ profile, currentAuthority, onCommit, onClose }) {
  const targetChoices = AUTHORITY_TARGETS.filter((target) => target.id !== currentAuthority);
  const [targetId, setTargetId] = useState(targetChoices[0]?.id ?? 'local');
  const [phase, setPhase] = useState('choose');
  const target = AUTHORITY_TARGETS.find((item) => item.id === targetId);
  const stopsSharing = currentAuthority !== 'local' && targetId === 'local';
  const movesSharedProfile = currentAuthority !== 'local' && target?.kind === 'remote';
  const activeStep = phase === 'copying' ? 0 : phase === 'verifying' ? 1 : phase === 'switching' ? 2 : 3;

  function beginMigration() {
    setPhase('copying');
    window.setTimeout(() => setPhase('verifying'), 900);
    window.setTimeout(() => setPhase('switching'), 1800);
    window.setTimeout(() => {
      onCommit(profile.id, targetId);
      setPhase('success');
    }, 2700);
  }

  const migrating = ['copying', 'verifying', 'switching'].includes(phase);

  return (
    <div className="authority-dialog__backdrop">
      <section className="authority-dialog" role="dialog" aria-modal="true" aria-labelledby="authority-dialog-title">
        <header className="authority-dialog__header">
          <div>
            <strong id="authority-dialog-title">更改存储位置 · {profile.name}</strong>
            <span>配置、密码 Vault 与兼容登录 Cookie 将一起迁移；网络出口不变。</span>
          </div>
          <button onClick={onClose} disabled={migrating} aria-label="关闭存储位置对话框">×</button>
        </header>

        {phase === 'choose' ? (
          <div className="authority-dialog__body">
            <div className="authority-dialog__route" aria-label="存储位置迁移路径">
              <span><small>当前</small><strong>{authorityName(currentAuthority)}</strong></span>
              <b aria-hidden="true">→</b>
              <span><small>目标</small><strong>{target?.label}</strong></span>
            </div>
            <fieldset className="authority-dialog__targets">
              <legend>选择目标</legend>
              {targetChoices.map((choice) => (
                <label key={choice.id} className={targetId === choice.id ? 'authority-dialog__target authority-dialog__target--selected' : 'authority-dialog__target'}>
                  <input type="radio" name="authority-target" value={choice.id} checked={targetId === choice.id} onChange={() => setTargetId(choice.id)} />
                  <span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
                  {choice.kind === 'remote' && <em>已连接</em>}
                </label>
              ))}
            </fieldset>
            <div className="authority-dialog__excluded" aria-label="不可用的存储位置">
              <strong>未列入可选目标</strong>
              <span>{EXCLUDED_AUTHORITY_TARGETS.map((choice) => <em key={choice.id}>{choice.label} · {choice.reason}</em>)}</span>
            </div>
            {(stopsSharing || movesSharedProfile) && (
              <div className="authority-dialog__global-impact" role="alert" data-ac="AC-10">
                <strong>{stopsSharing ? '这会终止所有设备共享' : `这会把共享 Profile 移到 ${target?.label}`}</strong>
                <span>{stopsSharing
                  ? '只有此设备保留本机副本；其他设备下次连接原 Host 时会移除该 Profile 与本机会话。'
                  : `其他设备需要连接 ${target?.label} 才能继续使用；原 Host 只保留“已移走”状态，不能继续写入。`}</span>
              </div>
            )}
            {target?.kind === 'remote' && (
              <div className="authority-dialog__trust" role="note">
                <strong>Remote Host 可解密此 Profile</strong>
                <span>目标机管理员、同一 SSH 用户以及以该用户运行的终端/Agent 都可访问并解密配置、Vault 与兼容登录 Cookie。普通 renderer 只获得脱敏状态与数量。</span>
              </div>
            )}
            <ol className="authority-dialog__plan" aria-label="Migration plan">
              <li><b>1</b><span><strong>Copy</strong><small>复制配置、加密 Vault 与登录连续性记录；此时仍从 {authorityName(currentAuthority)} 读取。</small></span></li>
              <li><b>2</b><span><strong>Verify</strong><small>读回并完整性校验目标副本。</small></span></li>
              <li><b>3</b><span><strong>Switch</strong><small>仅校验通过后原子切换唯一存储位置。</small></span></li>
            </ol>
            <div className="authority-dialog__safety">
              迁移期间 Profile 与密码修改暂停，浏览器产生的 Cookie 变化进入加密待同步队列。提交前失败会保留原位置，不会使用不完整副本。
            </div>
            <footer className="authority-dialog__actions">
              <button onClick={onClose}>取消</button>
              <button className="authority-dialog__primary" onClick={beginMigration}>确认并迁移到 {target?.label}</button>
            </footer>
          </div>
        ) : phase === 'success' ? (
          <div className="authority-dialog__result" role="status" aria-live="polite">
            <span className="authority-dialog__result-icon">✓</span>
            <strong>存储位置已切换到 {authorityName(targetId)}</strong>
            <p>{stopsSharing ? '共享已终止。此设备保留本机副本，其他设备将在下次对账时移除。' : '目标已校验并成为唯一读写源。源副本将在后台安全清理。'}</p>
            <button className="authority-dialog__primary" onClick={onClose}>完成</button>
          </div>
        ) : (
          <div className="authority-dialog__progress" role="status" aria-live="polite">
            <span className="add-ws__spinner" aria-hidden="true" />
            <strong>{phase === 'copying' ? '正在复制…' : phase === 'verifying' ? '正在校验…' : '正在切换存储位置…'}</strong>
            <p>当前位置：{authorityName(currentAuthority)} · 编辑操作已暂停 · 仍从原位置读取</p>
            <div className="authority-dialog__stepper">
              {['Copy', 'Verify', 'Switch'].map((label, index) => (
                <span key={label} className={index < activeStep ? 'authority-dialog__step authority-dialog__step--done' : index === activeStep ? 'authority-dialog__step authority-dialog__step--active' : 'authority-dialog__step'}>
                  <i>{index < activeStep ? '✓' : index + 1}</i>{label}
                </span>
              ))}
            </div>
            <small>请保持两端在线。关闭设置不会取消已持久化的迁移。</small>
          </div>
        )}
      </section>
    </div>
  );
}

const AVAILABLE_REMOTE_PROFILE = {
  id: 'shared-qa',
  name: 'Shared QA',
  meta: 'mini-pc · 远程 Profile · 4 个 Project',
  count: 5,
};

function ProfileContinuityDetail({ profile, authorityId, state, reportOpen, onToggleReport, onRetry, onOpenRemoteHosts }) {
  if (authorityId === 'local') {
    return (
      <div className="browser-profile__detail browser-profile__detail--local">
        <span className="browser-profile__detail-dot browser-profile__detail-dot--muted" />
        <div><strong>登录连续性 · 仅此设备</strong><span>Cookie 与其他网站存储不会上传。</span></div>
      </div>
    );
  }

  if (state === 'syncing') {
    return (
      <div className="browser-profile__detail browser-profile__detail--syncing" role="status" data-ac="AC-1 AC-6 AC-9">
        <span className="browser-profile__sync-spinner" aria-hidden="true" />
        <div><strong>正在同步登录状态…</strong><span>已同步 42 项 · 3 项待确认；完成前新页面不会访问网站。</span></div>
      </div>
    );
  }

  if (state === 'sync-skipped') {
    return (
      <>
        <div className="browser-profile__detail browser-profile__detail--warn" role="status">
          <span className="browser-profile__detail-dot browser-profile__detail-dot--warn" />
          <div><strong>登录状态已同步 · 3 项跳过</strong><span>支持的项目已完成；跳过项不会阻断其他登录状态。</span></div>
          <button onClick={onToggleReport}>{reportOpen ? '收起详情' : '查看详情'}</button>
        </div>
        {reportOpen && (
          <div className="browser-profile__sync-report" role="region" aria-label={`${profile.name} 登录连续性详情`} data-ac="AC-7 AC-8 AC-9">
            <div><span>已同步</span><strong>42</strong></div>
            <div><span>待同步</span><strong>0</strong></div>
            <div><span>已跳过</span><strong>3</strong><small>临时 Cookie 2 · 属性不兼容 1</small></div>
            <div><span>已处理冲突</span><strong>0</strong></div>
            <p>LocalStorage、IndexedDB、Service Worker 和 Cache 保留在此设备，不会上传。</p>
          </div>
        )}
      </>
    );
  }

  if (state === 'sync-conflict') {
    return (
      <div className="browser-profile__detail browser-profile__detail--warn" role="status">
        <span className="browser-profile__detail-dot browser-profile__detail-dot--warn" />
        <div><strong>已处理 1 个冲突 · 采用 Host 后收到的变更</strong><span>所有设备已收敛；没有 Cookie 名称、网站或值进入报告。</span></div>
      </div>
    );
  }

  if (state === 'authority-offline') {
    return (
      <div className="browser-profile__detail browser-profile__detail--danger" role="alert" data-ac="AC-6 AC-9">
        <span className="browser-profile__detail-dot browser-profile__detail-dot--danger" />
        <div><strong>登录连续性已暂停 · 2 项待同步</strong><span>已打开页面可能继续；新建、重载与恢复页面会等待 Host，密码能力同样暂停。</span></div>
        <button onClick={onRetry}>重试</button>
      </div>
    );
  }

  if (state === 'host-upgrade') {
    return (
      <div className="browser-profile__detail browser-profile__detail--warn" role="alert">
        <span className="browser-profile__detail-dot browser-profile__detail-dot--warn" />
        <div><strong>mini-pc 需要升级后才能同步登录状态</strong><span>Profile 配置和密码仍可用；Cookie 漫游不会静默降级。</span></div>
        <button onClick={onOpenRemoteHosts}>查看 Host</button>
      </div>
    );
  }

  if (state === 'profile-moved') {
    return (
      <div className="browser-profile__detail browser-profile__detail--warn" role="alert">
        <span className="browser-profile__detail-dot browser-profile__detail-dot--warn" />
        <div><strong>此 Profile 已移到 build-mac</strong><span>mini-pc 不再接受写入；连接目标 Host 后可重新在此设备使用。</span></div>
        <button onClick={onOpenRemoteHosts}>查看 Host</button>
      </div>
    );
  }

  return (
    <div className="browser-profile__detail" role="status">
      <span className="browser-profile__detail-dot" />
      <div><strong>登录连续性 · 已同步</strong><span>刚刚 · 42 项已同步 · 0 项待同步 · 0 项跳过</span></div>
    </div>
  );
}

function BrowserProfilesModal({ state, onClose, onOpenPasswords, onOpenRemoteHosts, onRetry }) {
  const [formDraft, setFormDraft] = useState(null);
  const [created, setCreated] = useState(false);
  const [joinedRemoteProfile, setJoinedRemoteProfile] = useState(false);
  const [joiningRemoteProfile, setJoiningRemoteProfile] = useState(false);
  const [syncReportOpen, setSyncReportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [authorityDialogId, setAuthorityDialogId] = useState(null);
  const [authorities, setAuthorities] = useState({ default: 'mini-pc', work: 'mini-pc', personal: 'local', research: 'local', 'shared-qa': 'mini-pc' });
  const showCustom = state !== 'empty';
  const unavailable = state === 'encryption-unavailable';
  const profiles = [PROFILE_SEED[0], ...(showCustom ? PROFILE_SEED.slice(1) : []), ...(joinedRemoteProfile ? [AVAILABLE_REMOTE_PROFILE] : []), ...(created ? [{ id: 'research', name: 'Research', meta: '系统默认 UA · 尚未绑定 Project', count: 0 }] : [])];
  const failedDelete = state === 'delete-failed';
  const remoteOffline = state === 'authority-offline';
  const migrationError = state === 'migration-error';
  const cleanupPending = state === 'cleanup-pending';
  const activeDialogProfile = profiles.find((profile) => profile.id === authorityDialogId);

  useEffect(() => {
    if (!joiningRemoteProfile) return undefined;
    const timer = window.setTimeout(() => setJoiningRemoteProfile(false), 1200);
    return () => window.clearTimeout(timer);
  }, [joiningRemoteProfile]);

  function displayedAuthority(profileId) {
    return cleanupPending && profileId === 'work' ? 'build-mac' : authorities[profileId];
  }

  function commitAuthority(profileId, authorityId) {
    setAuthorities((current) => ({ ...current, [profileId]: authorityId }));
  }

  function joinRemoteProfile() {
    setJoinedRemoteProfile(true);
    setJoiningRemoteProfile(true);
  }

  return (
    <div className="browser-profile__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="browser-profile__card browser-profile__card--settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="browser-profile__header">
          <div>
            <div className="browser-profile__title">Browser Settings</div>
            <div className="browser-profile__subtitle">⌘/Ctrl+click a terminal link always opens the system browser.</div>
          </div>
          <button className="remote-hosts__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="browser-profile__body">
          <BrowserSettingGroups />
          <div className="browser-settings__divider" />
          {unavailable && <BrowserPasswordScope />}

          <div className="browser-profile__section-head">
            <div><div className="browser-profile__section-title">Browser profiles</div><p>每个 Profile 隔离 Cookie、网站存储、缓存和已保存密码；存储位置不影响浏览器网络出口。</p></div>
            <button className="remote-hosts__action" onClick={onOpenPasswords}>管理已保存密码</button>
          </div>

          {remoteOffline && (
            <div className="browser-profile__global-alert" role="alert">
              <div><strong>mini-pc 当前离线</strong><span>Profile 修改、密码能力与登录连续性同步已暂停；不会回退本机存储。</span></div>
              <button onClick={onOpenRemoteHosts}>前往 Remote Hosts</button>
            </div>
          )}

          {!joinedRemoteProfile && state !== 'loading' && (
            <section className="browser-profile__available" aria-labelledby="available-profile-title" data-ac="AC-1">
              <div className="browser-profile__available-head">
                <div><strong id="available-profile-title">可在此设备使用</strong><span>mini-pc 上有 1 个尚未加入的 Profile</span></div>
              </div>
              <div className="browser-profile__available-row">
                <div className="browser-profile__avatar">S</div>
                <div><strong>{AVAILABLE_REMOTE_PROFILE.name}</strong><span>{AVAILABLE_REMOTE_PROFILE.meta} · {AVAILABLE_REMOTE_PROFILE.count} 个密码</span></div>
                <button disabled={remoteOffline || state === 'host-upgrade'} onClick={joinRemoteProfile}>在此设备使用</button>
              </div>
            </section>
          )}

          {state === 'loading' ? <ProfileSkeletons /> : (
            <div className="browser-profile__list">
              {profiles.map((profile) => (
                <div key={profile.id}>
                  <div className={`browser-profile__row${profile.builtIn ? ' browser-profile__row--muted' : ''}${failedDelete && profile.id === 'work' ? ' browser-profile__row--disabled' : ''}`}>
                    <div className="browser-profile__avatar">{profile.name[0]}</div>
                    <div className="browser-profile__identity">
                      <div><strong>{profile.name}</strong>{profile.builtIn && <span className="browser-profile__tag">Built-in</span>}</div>
                      <span>{profile.meta}</span>
                    </div>
                    <span className={`browser-profile__authority${displayedAuthority(profile.id) !== 'local' ? ' browser-profile__authority--remote' : ''}${remoteOffline && displayedAuthority(profile.id) !== 'local' ? ' browser-profile__authority--offline' : ''}`} aria-label={`Storage location：${authorityName(displayedAuthority(profile.id))}`}>
                      <small>Storage location</small>
                      <strong>{authorityName(displayedAuthority(profile.id))}</strong>
                    </span>
                    <span className="browser-profile__count">{profile.count} 个密码</span>
                    <span className="browser-profile__row-actions">
                      <button disabled={remoteOffline && displayedAuthority(profile.id) !== 'local'} aria-label={`更改 ${profile.name} 的存储位置`} onClick={() => setAuthorityDialogId(profile.id)}>更改位置</button>
                      {!profile.builtIn && <button disabled={remoteOffline && displayedAuthority(profile.id) !== 'local'} onClick={() => setFormDraft({ id: profile.id, name: profile.name, ua: profile.meta.startsWith('Chrome') ? 'Mozilla/5.0 Chrome/127' : '' })}>编辑</button>}
                      {!profile.builtIn && <button disabled={remoteOffline && displayedAuthority(profile.id) !== 'local'} onClick={() => setDeleteTarget(profile.id)}>删除</button>}
                    </span>
                  </div>
                  {!(failedDelete && profile.id === 'work') && !(migrationError && profile.id === 'work') && !(cleanupPending && profile.id === 'work') && (
                    <ProfileContinuityDetail
                      profile={profile}
                      authorityId={displayedAuthority(profile.id)}
                      state={joiningRemoteProfile && profile.id === 'shared-qa' ? 'syncing' : profile.id === 'work' ? state : 'ready'}
                      reportOpen={syncReportOpen && profile.id === 'work'}
                      onToggleReport={() => setSyncReportOpen((value) => !value)}
                      onRetry={onRetry}
                      onOpenRemoteHosts={onOpenRemoteHosts}
                    />
                  )}
                  {deleteTarget === profile.id && (
                    <div className="browser-profile__inline-confirm">
                      <span>{displayedAuthority(profile.id) === 'local'
                        ? `删除 ${profile.name}？密码、Cookie、站点存储和缓存全部清理完成后才会移除。`
                        : `删除 ${profile.name}？这会影响所有使用此 Remote Profile 的设备，并在各设备下次对账时清理本机会话。`}</span>
                      <button className="browser-profile__danger-btn" onClick={() => setDeleteTarget(null)}>确认删除</button>
                      <button onClick={() => setDeleteTarget(null)}>取消</button>
                    </div>
                  )}
                  {failedDelete && profile.id === 'work' && (
                    <div className="browser-profile__detail browser-profile__detail--danger browser-profile__delete-failed">
                      <span className="browser-profile__detail-dot browser-profile__detail-dot--danger" />
                      <div><strong>删除未完成 · Profile 已停用</strong><span>缓存清理失败。密码不会再保存、填充、显示或复制；重启后仍可继续重试。</span></div>
                      <button className="remote-hosts__action">重试清理</button>
                    </div>
                  )}
                  {migrationError && profile.id === 'work' && (
                    <div className="browser-profile__detail browser-profile__detail--danger" role="alert">
                      <span className="browser-profile__detail-dot browser-profile__detail-dot--danger" />
                      <div><strong>Verify 失败 · 数据仍存于 mini-pc</strong><span>目标副本未启用，源数据未减少。可重新开始迁移。</span></div>
                      <button className="remote-hosts__action" onClick={() => setAuthorityDialogId(profile.id)}>Retry</button>
                    </div>
                  )}
                  {cleanupPending && profile.id === 'work' && (
                    <div className="browser-profile__detail browser-profile__detail--warn" role="status">
                      <span className="browser-profile__detail-dot browser-profile__detail-dot--warn" />
                      <div><strong>已切换到 build-mac · 原位置待清理</strong><span>待清理位置是 mini-pc，且永不再读取。删除 mini-pc 前必须完成清理。</span></div>
                      <button className="remote-hosts__action">重试清理</button>
                    </div>
                  )}
                </div>
              ))}
              {profiles.length === 1 && (
                <div className="browser-profile__empty-row"><strong>还没有自定义 Profile</strong><span>新建 Profile，为不同工程隔离登录身份。</span></div>
              )}
            </div>
          )}

          {formDraft ? (
            <div className="browser-profile__new-form">
              <input autoFocus value={formDraft.name} onChange={(event) => setFormDraft({ ...formDraft, name: event.target.value })} placeholder="Profile name" aria-label="Profile name" />
              <input value={formDraft.ua} onChange={(event) => setFormDraft({ ...formDraft, ua: event.target.value })} placeholder="System default User-Agent" aria-label="User agent" />
              <button type="button" onClick={() => setFormDraft({ ...formDraft, ua: 'Mozilla/5.0 Chrome/127 Safari/537.36' })}>🎲 随机</button>
              <button onClick={() => { if (!formDraft.id) setCreated(true); setFormDraft(null); }}>保存</button>
              <button onClick={() => setFormDraft(null)}>取消</button>
            </div>
          ) : (
            <button className="browser-profile__add" onClick={() => setFormDraft({ id: null, name: '', ua: '' })}>+ 新建 Profile</button>
          )}

        </div>
        <div className="browser-profile__footer"><button onClick={onClose}>完成</button></div>
        {activeDialogProfile && (
          <AuthorityChangeDialog
            profile={activeDialogProfile}
            currentAuthority={displayedAuthority(activeDialogProfile.id)}
            onCommit={commitAuthority}
            onClose={() => setAuthorityDialogId(null)}
          />
        )}
      </div>
    </div>
  );
}

function BrowserProfilesPage({ currentPath, onNavigate }) {
  const [state, setState] = useState('ready');
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(true), [state]);
  return (
    <BrowserIdentityWorkbench currentPath={currentPath} onNavigate={onNavigate} presets={BROWSER_PROFILE_STATE_PRESETS} state={state} setState={setState}>
      {open && <BrowserProfilesModal state={state} onClose={() => setOpen(false)} onOpenPasswords={() => onNavigate('/settings/browser-passwords')} onOpenRemoteHosts={() => onNavigate('/settings/remote-hosts')} onRetry={() => setState('ready')} />}
    </BrowserIdentityWorkbench>
  );
}

const PASSWORD_ROWS = [
  { id: 'github-primary', origin: 'https://github.com', username: 'liam@example.com', profile: 'Work', authority: 'mini-pc', changed: '今天', initial: 'G', secret: 'orange-harbor-42' },
  { id: 'github-work', origin: 'https://github.com', username: 'liam@okteam99.com', profile: 'Work', authority: 'mini-pc', changed: '昨天', initial: 'G', secret: 'misty-forest-17' },
  { id: 'aws', origin: 'https://console.aws.amazon.com', username: 'liam@okteam99.com', profile: 'Work', authority: 'mini-pc', changed: '7 月 29 日', initial: 'A', secret: 'amber-cloud-88' },
];

function TrustedPasswordSurface({ row, mode, authorityOnline = true, onRetry, onClose }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (authorityOnline) return;
    setRevealed(false);
    setCopied(false);
  }, [authorityOnline]);
  useEffect(() => {
    if (!revealed) return undefined;
    const timer = window.setTimeout(() => setRevealed(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 60_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="trusted-password__backdrop">
      <div className="trusted-password__window" role="dialog" aria-modal="true" aria-label="Trusted password window">
        <div className="trusted-password__titlebar"><span>受信任密码窗口</span><button onClick={onClose} aria-label="Close trusted password window">×</button></div>
        <div className="trusted-password__seal">隔离呈现 · 普通 OkWork 页面无法读取或触发解密</div>
        <div className="trusted-password__meta"><strong>{row.origin}</strong><span>{row.username} · {row.profile} · 存于 {row.authority}</span></div>
        {!authorityOnline ? (
          <div className="trusted-password__offline" role="alert" aria-live="assertive">
            <strong>远程密码库连接已失效</strong>
            <span>mini-pc 在此窗口打开后离线。旧 secret 已立即清除；不会显示缓存值或回退本机 Vault。</span>
            <div><button className="trusted-password__primary" onClick={onRetry}>Retry</button><button className="trusted-password__cancel" onClick={onClose}>关闭</button></div>
          </div>
        ) : mode === 'reveal' ? (
          <>
            <div className="trusted-password__secret">{revealed ? row.secret : '••••••••••••••••'}</div>
            <p>密码仅在此窗口短时显示，10 秒后自动重新遮罩。</p>
            <button className="trusted-password__primary" onClick={() => setRevealed(true)}>{revealed ? '已显示 · 10 秒' : '显示密码'}</button>
          </>
        ) : (
          <>
            <div className="trusted-password__warning">复制后，密码会进入系统剪贴板，本机其他应用和 OkWork 页面可能读取。</div>
            <p>{copied ? '已复制 · 若内容未变化，将在 60 秒后自动清除。' : '只有你在此窗口中的明确操作会解密并复制这一条密码。'}</p>
            <button className="trusted-password__primary" onClick={() => setCopied(true)}>{copied ? '✓ 已复制 · 60 秒' : '仍要复制'}</button>
          </>
        )}
        <button className="trusted-password__cancel" onClick={onClose}>完成</button>
      </div>
    </div>
  );
}

function PasswordListSkeleton() {
  return <div className="browser-passwords__list browser-passwords__list--loading">{[0, 1, 2].map((i) => <div className="browser-passwords__skeleton" key={i}><i /><span /><b /></div>)}</div>;
}

function PasswordsModal({ state, onClose, onBack, onOpenRemoteHosts, onRetry }) {
  const [query, setQuery] = useState('');
  const [profileFilter, setProfileFilter] = useState('all');
  const [rows, setRows] = useState(() => state === 'empty' || state === 'remote-offline' ? [] : PASSWORD_ROWS);
  const [deleteId, setDeleteId] = useState(null);
  const [trustedAction, setTrustedAction] = useState(null);
  const remoteOffline = state === 'remote-offline';
  const trustedOffline = state === 'trusted-offline';
  useEffect(() => {
    setRows(state === 'empty' || state === 'remote-offline' ? [] : PASSWORD_ROWS);
    setTrustedAction(state === 'trusted-offline' ? { row: PASSWORD_ROWS[0], mode: 'reveal' } : null);
  }, [state]);
  const unavailable = state === 'encryption-unavailable';
  const visibleRows = remoteOffline ? [] : rows;
  const normalized = query.trim().toLowerCase();
  const filtered = visibleRows.filter((row) =>
    (profileFilter === 'all' || row.profile === profileFilter)
    && (!normalized || `${row.origin} ${row.username} ${row.profile}`.toLowerCase().includes(normalized)),
  );

  return (
    <div className="browser-profile__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="browser-profile__card browser-passwords__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="browser-profile__header">
          <div>
            <button className="browser-passwords__back" onClick={onBack}>‹ Browser Settings</button>
            <div className="browser-profile__title">Saved Passwords</div>
            <div className="browser-profile__subtitle">列表只显示脱敏元数据。密码与 Profile、scheme、host、port 精确绑定，并只从该 Profile 的存储位置读取。</div>
          </div>
          <button className="remote-hosts__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="browser-profile__body">
          {unavailable && <BrowserPasswordScope />}
          {state === 'error' && (
            <div className="browser-passwords__status browser-passwords__status--danger"><strong>无法读取密码列表</strong><span>本机 Vault 暂时不可用。没有密码被返回或修改。</span><button>重试</button></div>
          )}
          {remoteOffline && (
            <div className="browser-passwords__status browser-passwords__status--danger browser-passwords__remote-offline" role="alert">
              <div><strong>Work 的远程密码库离线</strong><span>mini-pc 未通过当前连接代校验。未显示任何陈旧条目，密码保存、填充、显示、复制与删除全部暂停，也不会回退本机 Vault。</span><small>已打开页面的 Chromium Cookie / session 可能继续工作；这不代表密码库可用。</small></div>
              <span className="browser-passwords__status-actions"><button onClick={onRetry}>Retry</button><button onClick={onOpenRemoteHosts}>前往 Remote Hosts</button></span>
            </div>
          )}
          <div className="browser-passwords__toolbar">
            <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search passwords" placeholder="搜索站点、用户名或 Profile" disabled={state === 'loading' || state === 'error' || remoteOffline} />
            <select aria-label="Profile filter" value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)} disabled={state === 'loading' || state === 'error' || remoteOffline}>
              <option value="all">全部 Profile</option><option value="Work">Work</option><option value="Personal">Personal</option>
            </select>
          </div>

          {state === 'loading' ? <PasswordListSkeleton /> : filtered.length ? (
            <div className={`browser-passwords__list${state === 'error' ? ' browser-passwords__list--disabled' : ''}`}>
              {filtered.map((row) => (
                <div className="browser-passwords__row" key={row.id}>
                  <span className="browser-passwords__site-icon">{row.initial}</span>
                  <span className="browser-passwords__origin"><strong>{row.origin}</strong><span>{row.username}</span></span>
                  <span className="browser-passwords__profile"><strong>{row.profile}</strong><small>{row.authority}</small></span>
                  <span className="browser-passwords__secret">已保存</span>
                  <span className="browser-passwords__changed">{row.changed}</span>
                  {deleteId === row.id ? (
                    <span className="browser-passwords__confirm"><span>删除这一条？</span><button onClick={() => { setRows((items) => items.filter((item) => item.id !== row.id)); setDeleteId(null); }}>删除</button><button onClick={() => setDeleteId(null)}>取消</button></span>
                  ) : (
                    <span className="browser-passwords__actions">
                      <button disabled={unavailable || remoteOffline} onClick={() => setTrustedAction({ row, mode: 'reveal' })}>显示…</button>
                      <button disabled={unavailable || remoteOffline} onClick={() => setTrustedAction({ row, mode: 'copy' })}>复制…</button>
                      <button disabled={remoteOffline} onClick={() => setDeleteId(row.id)}>删除</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : remoteOffline ? (
            <div className="browser-passwords__empty browser-passwords__empty--offline" role="status"><BrowserIdentityIcon /><strong>远程条目未显示</strong><span>连接并重新校验 mini-pc 后，列表才会从远程密码库重新加载。</span></div>
          ) : (
            <div className="browser-passwords__empty"><BrowserIdentityIcon /><strong>{visibleRows.length ? '没有匹配结果' : '还没有已保存密码'}</strong><span>{visibleRows.length ? '尝试搜索其他站点、用户名或 Profile。' : '在 OkBrowser 成功登录后，密码会自动保存到当前 Profile。'}</span></div>
          )}

          <div className="browser-passwords__disclosures">
            <div><strong>填入网页后</strong><span>网站与连接 OkBrowser 的 Agent 可以读取页面中的用户名和密码。</span></div>
            <div><strong>复制到剪贴板后</strong><span>本机应用可能读取；若内容未变化，OkWork 会在 60 秒后清除。</span></div>
          </div>
        </div>
      </div>
      {trustedAction && <TrustedPasswordSurface row={trustedAction.row} mode={trustedAction.mode} authorityOnline={!trustedOffline} onRetry={onRetry} onClose={() => setTrustedAction(null)} />}
    </div>
  );
}

function BrowserPasswordsPage({ currentPath, onNavigate }) {
  const [state, setState] = useState('ready');
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(true), [state]);
  return (
    <BrowserIdentityWorkbench currentPath={currentPath} onNavigate={onNavigate} presets={PASSWORD_STATE_PRESETS} state={state} setState={setState}>
      {open && <PasswordsModal state={state} onClose={() => setOpen(false)} onBack={() => onNavigate('/settings/browser-profiles')} onOpenRemoteHosts={() => onNavigate('/settings/remote-hosts')} onRetry={() => setState('ready')} />}
    </BrowserIdentityWorkbench>
  );
}

function PasswordFlowNotice({ state, onOpenAccounts, onRetry, onOpenRemoteHosts }) {
  const notices = {
    'login-restored': ['✓', '已恢复 Work 的登录状态', '兼容登录 Cookie 已从 mini-pc 准备完成'],
    'continuity-syncing': ['…', '正在准备 Work 的登录状态', '完成前不会向 github.com 发送请求'],
    'continuity-error': ['!', '登录状态准备失败', '尚未访问 github.com；可重试或检查 mini-pc'],
    autofilled: ['✓', '已从 Work 静默填充', 'liam@example.com · 存于 mini-pc'],
    loading: ['…', '正在连接 Work 密码库', '等待 mini-pc 校验；不会使用本机缓存填充'],
    empty: ['–', 'Work 中还没有已保存密码', '成功登录后会保存到 mini-pc'],
    saved: ['✓', '新密码已自动保存', 'https://github.com · Work · mini-pc'],
    updated: ['✓', '密码已自动更新', '旧密码已替换 · Work · mini-pc'],
    multi: ['2', '已填充最近成功使用的账号', 'liam@example.com · 此站点共 2 个账号'],
    'no-match': ['–', 'Work 中没有匹配密码', '成功登录后会自动保存'],
    'other-profile': ['↔', 'Profile 隔离生效', 'Personal 中有密码；当前 Work 不会读取'],
    uncertain: ['?', '无法确认登录结果 · 未保存', '现有密码保持不变'],
    'auth-failed': ['!', '登录失败 · 未覆盖旧密码', '修正密码后可再次尝试'],
    'remote-offline': ['!', 'Work 的远程存储离线', '登录连续性与密码能力已暂停；已打开页面的本机会话可能继续'],
    'encryption-unavailable': ['!', '密码保护暂不可用', '系统钥匙串未授权；不会保存或填充'],
    'insecure-origin': ['!', '普通 HTTP 页面已停用密码功能', '仅 HTTPS 与本机 loopback HTTP 可保存和填充'],
  };
  const [icon, title, detail] = notices[state];
  const danger = ['continuity-error', 'auth-failed', 'remote-offline', 'encryption-unavailable', 'insecure-origin'].includes(state);
  return (
    <div className={`password-flow__notice password-flow__notice--${danger ? 'danger' : state}`} role={danger ? 'alert' : 'status'} aria-live={danger ? 'assertive' : 'polite'} data-ac="AC-6 AC-9">
      <span className="password-flow__notice-icon">{icon}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
      {state === 'multi' && <button onClick={onOpenAccounts}>切换账号</button>}
      {['continuity-error', 'remote-offline'].includes(state) && <span className="password-flow__notice-actions"><button onClick={onRetry}>重试</button><button onClick={onOpenRemoteHosts}>查看 Host</button></span>}
    </div>
  );
}

function PasswordFlowPage({ currentPath, onNavigate }) {
  const [state, setState] = useState('autofilled');
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [username, setUsername] = useState('liam@example.com');
  const [password, setPassword] = useState('orange-harbor-42');
  const noFillStates = ['login-restored', 'continuity-syncing', 'continuity-error', 'loading', 'empty', 'no-match', 'other-profile', 'uncertain', 'auth-failed', 'remote-offline', 'encryption-unavailable', 'insecure-origin'];
  const filled = !noFillStates.includes(state);
  useEffect(() => {
    setAccountsOpen(false);
    setUsername(filled ? 'liam@example.com' : '');
    setPassword(filled ? 'orange-harbor-42' : '');
  }, [state, filled]);
  const insecure = state === 'insecure-origin';
  const hydrationGated = ['continuity-syncing', 'continuity-error'].includes(state);
  const loginRestored = state === 'login-restored';

  return (
    <PreviewPage currentPath={currentPath} onNavigate={onNavigate} statePresets={PASSWORD_FLOW_STATE_PRESETS} activeStateKey={state} onSelectState={setState}>
      <div className="password-flow__stage">
        <div className="password-flow__window">
          <div className="password-flow__titlebar">
            <span className="password-flow__lights"><i /><i /><i /></span>
            <strong>OkBrowser · feature/password-vault</strong>
            <span className="password-flow__shell-actions">
              <button className="password-flow__profile"><small>Profile</small><span>Work</span></button>
              <button className="password-flow__dock">收回面板</button>
            </span>
          </div>
          <div className="password-flow__tabs"><span className="password-flow__tab">Sign in to GitHub <b>×</b></span><button>+</button></div>
          <div className="password-flow__toolbar">
            <button>‹</button><button>›</button><button>↻</button>
            <div className={`password-flow__address${insecure ? ' password-flow__address--insecure' : ''}`}>{insecure ? 'ⓘ http://example.test/login' : '🔒 https://github.com/login'}</div>
            <button className="password-flow__nav-action" title="在系统浏览器中打开">↗</button>
            <button className="password-flow__network" title="网络出口" aria-label="Network exit: this device">◉ 此设备 ▾</button>
            <span className={`password-flow__storage-location${state === 'remote-offline' ? ' password-flow__storage-location--offline' : ''}`}>密码存储：mini-pc{state === 'remote-offline' ? ' · 离线' : ''}</span>
          </div>
          <PasswordFlowNotice state={state} onOpenAccounts={() => setAccountsOpen((value) => !value)} onRetry={() => setState(['continuity-error', 'remote-offline'].includes(state) ? 'continuity-syncing' : 'autofilled')} onOpenRemoteHosts={() => onNavigate('/settings/remote-hosts')} />
          {accountsOpen && (
            <div className="password-flow__accounts">
              <button onClick={() => { setUsername('liam@example.com'); setPassword('orange-harbor-42'); setAccountsOpen(false); }}><strong>liam@example.com</strong><span>最近成功使用</span></button>
              <button onClick={() => { setUsername('liam@okteam99.com'); setPassword('misty-forest-17'); setAccountsOpen(false); }}><strong>liam@okteam99.com</strong><span>昨天使用</span></button>
              <button onClick={() => onNavigate('/settings/browser-passwords')}>管理已保存密码…</button>
            </div>
          )}
          <div className="password-flow__page">
            {hydrationGated ? (
              <div className={`password-flow__hydration-gate${state === 'continuity-error' ? ' password-flow__hydration-gate--error' : ''}`} role={state === 'continuity-error' ? 'alert' : 'status'} data-ac="AC-1">
                {state === 'continuity-syncing' ? <span className="password-flow__gate-spinner" aria-hidden="true" /> : <span className="password-flow__gate-error" aria-hidden="true">!</span>}
                <strong>{state === 'continuity-syncing' ? '正在准备登录状态…' : '暂时无法准备登录状态'}</strong>
                <p>{state === 'continuity-syncing' ? '正在从 mini-pc 同步 Work 的兼容登录 Cookie。' : 'mini-pc 未在 30 秒内完成同步；本页尚未访问网站。'}</p>
                <small>0 个网站请求已发送</small>
                {state === 'continuity-error' && <button onClick={() => setState('continuity-syncing')}>重试</button>}
              </div>
            ) : loginRestored ? (
              <div className="password-flow__restored-page">
                <div className="password-flow__github-mark">◉</div>
                <strong>Welcome back, liam</strong>
                <p>GitHub 已识别 Work Profile 的登录状态。</p>
                <div><span>Repositories</span><b>24</b><span>Pull requests</span><b>7</b></div>
              </div>
            ) : (
              <div className="password-flow__login-card">
              <div className="password-flow__github-mark">◉</div>
              <h2>Sign in to GitHub</h2>
              <label>Username or email address<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
              <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              <button className="password-flow__signin" onClick={() => { if (state !== 'remote-offline') setState(state === 'autofilled' ? 'updated' : 'saved'); }}>Sign in</button>
              <div className="password-flow__page-foot">{state === 'remote-offline' ? 'Page remains usable · password save/fill paused' : filled ? 'Filled by OkWork · Work profile · 页面与 Agent 可读取填充值' : 'No saved password used'}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PreviewPage>
  );
}

// ---- F. /settings/remote-hosts ----

const REMOTE_HOSTS_STATE_PRESETS = [
  { key: 'default', label: '默认' },
  { key: 'empty', label: '空态' },
  { key: 'test-fail', label: '测试失败' },
  { key: 'deploying', label: '部署中 · 63%' },
  { key: 'node-missing', label: '失败 · 缺 Node' },
  { key: 'incompatible', label: '失败 · 版本不兼容' },
  { key: 'lost', label: '连接已断开' },
];

/**
 * 失败原因口径:「测试连接」(仅认证 + 可达探测)与「连接」(完整部署编排)共用同一分类文案(AC-2)。
 * nodeMissing / incompatible 只会在「连接」的部署/握手阶段出现,测试连接不会触发这两类。
 */
const FAIL_REASONS = {
  unreachable: { label: '不可达', detail: 'ssh: connect to host: Connection refused' },
  auth: { label: '认证失败', detail: 'Permission denied (publickey)' },
  timeout: { label: '超时', detail: 'Connection timed out (10s)' },
  nodeMissing: {
    label: '缺少 Node.js 运行时',
    detail: '远端未检测到 node ≥ 20',
    guidance: '请在远端机器安装 Node.js 20 或更高版本后重试连接',
  },
  incompatible: {
    label: '版本不兼容',
    detail: '远端 host v0.2.1 与当前应用 v0.3.12 协议不兼容 · 已断开',
  },
};

/** 连接生命周期(AC-5)进行中各态的徽标文案;ready/failed/lost 另有专属徽标(见 renderStageBadge)。 */
const CONNECT_STAGE_LABEL = {
  connecting: '连接中…',
  deploying: '部署中…',
  starting: '启动 host…',
  claiming: '认领中…',
  verifying: '握手校验…',
};

function isActiveStage(stage) {
  return stage === 'connecting' || stage === 'deploying' || stage === 'starting'
    || stage === 'claiming' || stage === 'verifying';
}

function hasProgressPanel(stage) {
  return stage === 'deploying' || stage === 'starting' || stage === 'claiming' || stage === 'verifying';
}

function hostDotModifier(host, runtime) {
  if (runtime && runtime.stage) {
    if (runtime.stage === 'failed' || runtime.stage === 'lost') return 'fail';
    if (isActiveStage(runtime.stage)) return 'active';
  }
  return host.status === 'connected' ? 'connected' : 'disconnected';
}

/**
 * 「连接」编排模拟(mock 定时器,镜像 add-workspace 页已用户确认的部署时序):
 * fast(曾成功连接过 · lastUsed 有值)→ connecting → claiming → verifying → ready(认领驻留进程 · 跳过上传,AC-13);
 * 否则走首次部署全链路 → connecting → deploying(0~100%)→ starting → verifying → ready(AC-4)。
 * 失败/断线态不由本函数产生 —— 由顶栏 preset 注入(见 RemoteHostsPage 的 devState 分支)。
 */
function beginHostConnect(host, setHostRuntime, onReady) {
  const id = host.id;
  const fast = !!host.lastUsed;
  setHostRuntime((prev) => ({ ...prev, [id]: { stage: 'connecting', fast } }));

  window.setTimeout(() => {
    if (fast) {
      setHostRuntime((prev) => ({ ...prev, [id]: { stage: 'claiming', fast: true } }));
      window.setTimeout(() => {
        setHostRuntime((prev) => ({ ...prev, [id]: { stage: 'verifying', fast: true } }));
        window.setTimeout(() => {
          setHostRuntime((prev) => { const next = { ...prev }; delete next[id]; return next; });
          onReady(id);
        }, 550);
      }, 500);
      return;
    }

    setHostRuntime((prev) => ({ ...prev, [id]: { stage: 'deploying', percent: 0, arch: 'darwin-arm64', fast: false } }));
    let pct = 0;
    const timer = window.setInterval(() => {
      pct = Math.min(100, pct + 25);
      if (pct < 100) {
        setHostRuntime((prev) => ({ ...prev, [id]: { stage: 'deploying', percent: pct, arch: 'darwin-arm64', fast: false } }));
        return;
      }
      window.clearInterval(timer);
      setHostRuntime((prev) => ({ ...prev, [id]: { stage: 'starting', arch: 'darwin-arm64', fast: false } }));
      window.setTimeout(() => {
        setHostRuntime((prev) => ({ ...prev, [id]: { stage: 'verifying', arch: 'darwin-arm64', fast: false } }));
        window.setTimeout(() => {
          setHostRuntime((prev) => { const next = { ...prev }; delete next[id]; return next; });
          onReady(id);
        }, 550);
      }, 450);
    }, 260);
  }, 500);
}

const PROFILE_AUTHORITY_DEPENDENCIES = {
  'mini-pc': [
    { profile: 'OkWork', type: '当前存储位置' },
    { profile: 'Work', type: '当前存储位置' },
  ],
};

/** 「远程机」管理 modal:最近使用快捷区(一键连接)+ 手动添加区(增/改/删/测试连接/连接生命周期)。 */
function RemoteHostsModal({
  recentHosts,
  manualHosts,
  testState,
  testFailReason,
  onTest,
  hostRuntime,
  onConnect,
  onDisconnect,
  deleteConfirmId,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onOpenBrowserProfiles,
  formMode,
  formValues,
  onFormChange,
  onOpenAdd,
  onOpenEdit,
  onCancelForm,
  onSaveForm,
  showEmptyState,
  onClose,
}) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function renderStageBadge(runtime) {
    if (runtime.stage === 'failed') {
      const reason = FAIL_REASONS[runtime.reason] || FAIL_REASONS.unreachable;
      return <span className="remote-hosts__badge remote-hosts__badge--fail">✗ {reason.label}</span>;
    }
    if (runtime.stage === 'lost') {
      return <span className="remote-hosts__badge remote-hosts__badge--lost">⚠ 连接已断开</span>;
    }
    const label = CONNECT_STAGE_LABEL[runtime.stage] || '连接中…';
    const pct = runtime.stage === 'deploying' && typeof runtime.percent === 'number' ? ` ${runtime.percent}%` : '';
    return (
      <span className="remote-hosts__badge remote-hosts__badge--active">
        <span className="add-ws__spinner add-ws__spinner--sm" />
        {label}{pct}
      </span>
    );
  }

  function renderActionButtons(host, stage, compact) {
    const buttons = [];
    if (stage === 'ready') {
      buttons.push(<button key="disc" className="remote-hosts__action" onClick={() => onDisconnect(host.id)}>断开</button>);
    } else if (stage === 'failed') {
      buttons.push(<button key="retry" className="remote-hosts__action remote-hosts__action--primary" onClick={() => onConnect(host)}>重试</button>);
    } else if (stage === 'lost') {
      buttons.push(<button key="reconn" className="remote-hosts__action remote-hosts__action--primary" onClick={() => onConnect(host)}>重连</button>);
    } else {
      buttons.push(<button key="conn" className="remote-hosts__action remote-hosts__action--primary" onClick={() => onConnect(host)}>连接</button>);
    }
    if (!compact) {
      if (stage === 'idle' || stage === 'ready') {
        buttons.push(<button key="test" className="remote-hosts__action" onClick={() => onTest(host.id)}>测试连接</button>);
      }
      buttons.push(<button key="edit" className="remote-hosts__action" onClick={() => onOpenEdit(host)}>编辑</button>);
      buttons.push(<button key="del" className="remote-hosts__action remote-hosts__action--danger" onClick={() => onRequestDelete(host.id)}>删除</button>);
    }
    return buttons;
  }

  /** 行内状态/动作区:连接生命周期(非闲置)优先于测试态;两者共用 FAIL_REASONS 口径(AC-2)。 */
  function renderStatusArea(host, runtime, compact) {
    if (runtime && runtime.stage) {
      if (isActiveStage(runtime.stage)) {
        return renderStageBadge(runtime);
      }
      return (
        <span className="remote-hosts__row-actions">
          {renderStageBadge(runtime)}
          {renderActionButtons(host, runtime.stage, compact)}
        </span>
      );
    }
    if (!compact) {
      const testStatus = testState[host.id];
      if (testStatus === 'testing') {
        return (
          <span className="remote-hosts__badge remote-hosts__badge--pending">
            <span className="add-ws__spinner add-ws__spinner--sm" />
            测试连接中…
          </span>
        );
      }
      if (testStatus === 'ok') {
        return <span className="remote-hosts__badge remote-hosts__badge--ok">✓ 已连通 · 384ms</span>;
      }
      if (testStatus === 'fail') {
        const reason = FAIL_REASONS[testFailReason[host.id]] || FAIL_REASONS.auth;
        return <span className="remote-hosts__badge remote-hosts__badge--fail">✗ {reason.label} · {reason.detail}</span>;
      }
    }
    const stage = host.status === 'connected' ? 'ready' : 'idle';
    return (
      <span className="remote-hosts__row-actions">
        {stage === 'ready' && <span className="remote-hosts__badge remote-hosts__badge--ok">✓ 已连接</span>}
        {renderActionButtons(host, stage, compact)}
      </span>
    );
  }

  /** 部署进度(AC-4):快路径(fast)呈现「认领驻留进程」单行提示;否则三段 stepper(上传/启动/握手),上传段带百分比。 */
  function renderProgressPanel(runtime) {
    if (runtime.fast) {
      const verifying = runtime.stage === 'verifying';
      return (
        <div className="remote-hosts__progress-claim">
          <span className="add-ws__spinner add-ws__spinner--sm" />
          {verifying ? '已认领运行中的 host 进程 · 握手校验…' : '发现已运行的 host 进程 · 认领中…'}
        </div>
      );
    }
    const steps = [
      { key: 'upload', label: '上传 bundle' },
      { key: 'start', label: '启动 host' },
      { key: 'verify', label: '握手验证' },
    ];
    const order = ['deploying', 'starting', 'verifying'];
    const idx = order.indexOf(runtime.stage);
    return (
      <>
        {runtime.arch && <div className="remote-hosts__progress-arch">已探测远端架构 · {runtime.arch}</div>}
        <div className="remote-hosts__progress">
          {steps.map((s, i) => {
            const state = i < idx ? 'done' : i === idx ? 'active' : 'pending';
            return (
              <React.Fragment key={s.key}>
                {i > 0 && <span className="remote-hosts__progress-connector" />}
                <span className={`remote-hosts__progress-step remote-hosts__progress-step--${state}`}>
                  {state === 'done' && <span className="remote-hosts__progress-check">✓</span>}
                  {state === 'active' && <span className="add-ws__spinner add-ws__spinner--sm" />}
                  {state === 'pending' && <span className="remote-hosts__progress-dot-pending" />}
                  {s.label}
                  {state === 'active' && s.key === 'upload' && typeof runtime.percent === 'number' && (
                    <span className="remote-hosts__progress-percent"> {runtime.percent}%</span>
                  )}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </>
    );
  }

  function renderFailDetail(runtime) {
    const reason = FAIL_REASONS[runtime.reason] || FAIL_REASONS.unreachable;
    return (
      <div className="remote-hosts__fail-detail">
        <span className="remote-hosts__fail-detail-code">{reason.detail}</span>
        {reason.guidance && <span>{reason.guidance}</span>}
      </div>
    );
  }

  return (
    <div
      className="remote-hosts__backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="remote-hosts__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="remote-hosts__header">
          <div>
            <div className="remote-hosts__title">远程机</div>
            <div className="remote-hosts__subtitle">SSH 密钥或密码登录 · 密码/私钥密码存入系统钥匙串</div>
          </div>
          <button className="remote-hosts__close" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="remote-hosts__body">
          {showEmptyState ? (
            <div className="remote-hosts__empty">
              <div className="remote-hosts__empty-text">还没有远程机 · 点击下方添加</div>
              <button className="remote-hosts__btn remote-hosts__btn--primary" onClick={onOpenAdd}>添加远程机</button>
            </div>
          ) : (
            <>
              {recentHosts.length > 0 && (
                <div className="remote-hosts__section">
                  <div className="remote-hosts__section-title">最近使用</div>
                  <div className="remote-hosts__list">
                    {recentHosts.map((h) => {
                      const runtime = hostRuntime[h.id];
                      return (
                        <div key={h.id} className="remote-hosts__entry">
                          <div className="remote-hosts__row">
                            <span className={`remote-hosts__dot remote-hosts__dot--${hostDotModifier(h, runtime)}`} />
                            <span className="remote-hosts__alias">{h.alias}</span>
                            <span className="remote-hosts__addr">{h.user}@{h.host}:{h.port}</span>
                            <span className="remote-hosts__identity">{h.identityFile || '—'}</span>
                            <span className="remote-hosts__auth">{h.auth === 'password' ? '密码' : '密钥'}</span>
                            <span className="remote-hosts__last-used">{h.lastUsed}</span>
                            {renderStatusArea(h, runtime, true)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="remote-hosts__section">
                <div className="remote-hosts__section-title">手动添加</div>
                <div className="remote-hosts__list">
                  {manualHosts.map((h) => {
                    const runtime = hostRuntime[h.id];
                    const dependencies = PROFILE_AUTHORITY_DEPENDENCIES[h.id] ?? [];
                    return (
                      <div key={h.id} className="remote-hosts__entry">
                        <div className="remote-hosts__row">
                          {deleteConfirmId === h.id ? (
                            dependencies.length ? (
                              <div className="remote-hosts__dependency-block" role="alert" aria-labelledby={`host-dependency-${h.id}`}>
                                <div className="remote-hosts__dependency-head">
                                  <span><strong id={`host-dependency-${h.id}`}>无法删除 {h.alias}</strong><small>仍有 Profile 的数据存放在此 Remote Host。系统不会自动迁回本机，也不会调用删除动作。</small></span>
                                  <span className="remote-hosts__dependency-count">{dependencies.length} 个依赖</span>
                                </div>
                                <div className="remote-hosts__dependency-list">
                                  {dependencies.map((dependency) => <span key={dependency.profile}><strong>{dependency.profile}</strong><small>Profile · {dependency.type}</small></span>)}
                                </div>
                                <div className="remote-hosts__dependency-actions">
                                  <span>请先迁移或删除这些 Profile；cleanup pending 也必须先完成。</span>
                                  <button className="remote-hosts__action remote-hosts__action--primary" onClick={onOpenBrowserProfiles}>前往 Browser Profiles</button>
                                  <button className="remote-hosts__action" onClick={onCancelDelete}>关闭</button>
                                </div>
                              </div>
                            ) : (
                              <span className="remote-hosts__confirm">
                                <span className="remote-hosts__confirm-text">
                                  确认删除 {h.alias}?将同时清除已存凭据{(runtime || h.status === 'connected') ? ' · 将先断开当前连接' : ''}
                                </span>
                                <button className="remote-hosts__action remote-hosts__action--danger" onClick={() => onConfirmDelete(h.id)}>是</button>
                                <button className="remote-hosts__action" onClick={onCancelDelete}>否</button>
                              </span>
                            )
                          ) : (
                            <>
                              <span className={`remote-hosts__dot remote-hosts__dot--${hostDotModifier(h, runtime)}`} />
                              <span className="remote-hosts__alias">{h.alias}</span>
                              <span className="remote-hosts__addr">{h.user}@{h.host}:{h.port}</span>
                              <span className="remote-hosts__identity">{h.identityFile || '—'}</span>
                              <span className="remote-hosts__auth">{h.auth === 'password' ? '密码' : '密钥'}</span>
                              {renderStatusArea(h, runtime, false)}
                            </>
                          )}
                        </div>
                        {runtime && hasProgressPanel(runtime.stage) && renderProgressPanel(runtime)}
                        {runtime && runtime.stage === 'failed' && renderFailDetail(runtime)}
                      </div>
                    );
                  })}
                  {manualHosts.length === 0 && <div className="remote-hosts__section-empty">暂无手动添加的远程机</div>}
                </div>
              </div>

              {formMode ? (
                <div className="remote-hosts__form">
                  <div className="remote-hosts__form-title">{formMode === 'edit' ? '编辑远程机' : '添加远程机'}</div>
                  <div className="remote-hosts__form-grid">
                    <label className="remote-hosts__field">
                      <span>名称</span>
                      <input value={formValues.alias} onChange={(e) => onFormChange({ ...formValues, alias: e.target.value })} placeholder="alias" />
                    </label>
                    <label className="remote-hosts__field">
                      <span>Host</span>
                      <input value={formValues.host} onChange={(e) => onFormChange({ ...formValues, host: e.target.value })} placeholder="192.168.1.10" />
                    </label>
                    <label className="remote-hosts__field">
                      <span>User</span>
                      <input value={formValues.user} onChange={(e) => onFormChange({ ...formValues, user: e.target.value })} placeholder="root" />
                    </label>
                    <label className="remote-hosts__field">
                      <span>Port</span>
                      <input value={formValues.port} onChange={(e) => onFormChange({ ...formValues, port: e.target.value })} placeholder="22" />
                    </label>
                    <div className="remote-hosts__field remote-hosts__field--wide">
                      <span>认证方式</span>
                      <div className="file-panel__seg remote-hosts__auth-seg">
                        <button
                          type="button"
                          className={`file-panel__seg-btn${formValues.auth === 'key' ? ' file-panel__seg-btn--active' : ''}`}
                          onClick={() => onFormChange({ ...formValues, auth: 'key' })}
                        >SSH 密钥</button>
                        <button
                          type="button"
                          className={`file-panel__seg-btn${formValues.auth === 'password' ? ' file-panel__seg-btn--active' : ''}`}
                          onClick={() => onFormChange({ ...formValues, auth: 'password' })}
                        >密码</button>
                      </div>
                    </div>
                    {formValues.auth === 'password' ? (
                      <label className="remote-hosts__field remote-hosts__field--wide">
                        <span>密码</span>
                        <input
                          type="password"
                          value={formValues.password}
                          onChange={(e) => onFormChange({ ...formValues, password: e.target.value })}
                        />
                        <span className="remote-hosts__field-hint">密码存入 macOS 钥匙串,不明文落盘</span>
                      </label>
                    ) : (
                      <>
                        <label className="remote-hosts__field remote-hosts__field--wide">
                          <span>私钥路径</span>
                          <input
                            value={formValues.identityFile}
                            onChange={(e) => onFormChange({ ...formValues, identityFile: e.target.value })}
                            placeholder="例如 ~/.ssh/id_ed25519"
                          />
                        </label>
                        <label className="remote-hosts__field remote-hosts__field--wide">
                          <span>私钥密码(可选)</span>
                          <input
                            type="password"
                            value={formValues.passphrase}
                            onChange={(e) => onFormChange({ ...formValues, passphrase: e.target.value })}
                          />
                          <span className="remote-hosts__field-hint">加密私钥的 passphrase · 存入系统钥匙串,不明文落盘</span>
                        </label>
                      </>
                    )}
                  </div>
                  <div className="remote-hosts__form-actions">
                    <button className="remote-hosts__btn" onClick={onCancelForm}>取消</button>
                    <button className="remote-hosts__btn remote-hosts__btn--primary" onClick={onSaveForm}>保存</button>
                  </div>
                </div>
              ) : (
                <button className="remote-hosts__btn remote-hosts__btn--primary remote-hosts__add-btn" onClick={onOpenAdd}>添加远程机</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RemoteHostsPage({ currentPath, onNavigate }) {
  const [devState, setDevState] = useState('default');
  const [modalOpen, setModalOpen] = useState(true);
  const [connState, setConnState] = useState({});
  const [manualHosts, setManualHosts] = useState(DEFAULT_MANUAL_HOSTS);
  const [testState, setTestState] = useState({});
  const [testFailReason, setTestFailReason] = useState({});
  const [hostRuntime, setHostRuntime] = useState({});
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [formMode, setFormMode] = useState(null);
  const [formHostId, setFormHostId] = useState(null);
  const [formValues, setFormValues] = useState({ alias: '', host: '', user: '', port: '22', auth: 'key', identityFile: '', passphrase: '', password: '' });

  useEffect(() => {
    setManualHosts(devState === 'empty' ? [] : DEFAULT_MANUAL_HOSTS);
    setDeleteConfirmId(null);
    setFormMode(null);
    setFormHostId(null);
    setConnState({});
    setModalOpen(true);

    if (devState === 'test-fail') {
      setTestState({ 'vps-hk': 'fail' });
      setTestFailReason({ 'vps-hk': 'auth' });
    } else {
      setTestState({});
      setTestFailReason({});
    }

    // 顶栏 preset:注入页面难自然触达的连接生命周期态(部署中快照/失败分类/断线待重连);
    // 真实点击「连接/重试/重连」走 beginHostConnect 演示成功路径(见下方 handleConnect)。
    if (devState === 'deploying') {
      setHostRuntime({ 'gpu-box': { stage: 'deploying', percent: 63, arch: 'darwin-arm64', fast: false } });
    } else if (devState === 'node-missing') {
      setHostRuntime({ 'vps-hk': { stage: 'failed', reason: 'nodeMissing' } });
    } else if (devState === 'incompatible') {
      setHostRuntime({ 'gpu-box': { stage: 'failed', reason: 'incompatible' } });
    } else if (devState === 'lost') {
      setHostRuntime({ 'mini-pc': { stage: 'lost' } });
    } else {
      setHostRuntime({});
    }
  }, [devState]);

  // 最近使用 = 手动添加主机中 lastUsed 有值的子集(只读快捷区 + 一键连接,AC-7)
  const recentHosts = manualHosts.filter((h) => h.lastUsed);
  // 空态引导:无远程机且未展开表单时显示;点「添加远程机」→ 展开表单,保存后真实落入手动区
  const showEmptyState = manualHosts.length === 0 && !formMode;

  function runTest(id) {
    setTestState((prev) => ({ ...prev, [id]: 'testing' }));
    setTimeout(() => {
      setTestState((prev) => ({ ...prev, [id]: 'ok' }));
    }, 600);
  }

  /** 「连接」(AC-4/AC-5/AC-13):清掉过期测试徽标,交给 beginHostConnect 走 mock 时序,ready 后回写 manualHosts。 */
  function handleConnect(host) {
    setTestState((prev) => { const next = { ...prev }; delete next[host.id]; return next; });
    beginHostConnect(host, setHostRuntime, (id) => {
      setManualHosts((prev) => prev.map((h) => (
        h.id === id ? { ...h, status: 'connected', lastUsed: h.lastUsed || '刚刚' } : h
      )));
    });
  }

  /** 「断开」(AC-5 · ready → idle):清运行态,行回落到未连接展示。 */
  function handleDisconnect(id) {
    setHostRuntime((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setManualHosts((prev) => prev.map((h) => (h.id === id ? { ...h, status: 'disconnected' } : h)));
  }

  function openAddForm() {
    setFormMode('add');
    setFormHostId(null);
    setFormValues({ alias: '', host: '', user: '', port: '22', auth: 'key', identityFile: '', passphrase: '', password: '' });
  }

  function openEditForm(host) {
    setFormMode('edit');
    setFormHostId(host.id);
    setFormValues({
      alias: host.alias,
      host: host.host,
      user: host.user,
      port: String(host.port),
      auth: host.auth || 'key',
      identityFile: host.identityFile || '',
      passphrase: '',
      // 密码不回显明文:回填占位圆点,表示钥匙串里已有凭据
      password: host.auth === 'password' ? '••••••••' : '',
    });
  }

  function cancelForm() {
    setFormMode(null);
    setFormHostId(null);
  }

  function saveForm() {
    const port = parseInt(formValues.port, 10) || 22;
    const auth = formValues.auth || 'key';
    const identityFile = auth === 'key' ? (formValues.identityFile || null) : null;
    if (formMode === 'edit' && formHostId) {
      setManualHosts((prev) => prev.map((h) => (
        h.id === formHostId
          ? { ...h, alias: formValues.alias || h.alias, host: formValues.host || h.host, user: formValues.user || h.user, port, auth, identityFile }
          : h
      )));
    } else {
      const id = `${(formValues.alias || 'host').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${Date.now()}`;
      setManualHosts((prev) => [
        ...prev,
        {
          id,
          alias: formValues.alias || '未命名',
          host: formValues.host || '',
          user: formValues.user || '',
          port,
          auth,
          identityFile,
          status: 'disconnected',
        },
      ]);
    }
    setFormMode(null);
    setFormHostId(null);
  }

  function requestDelete(id) { setDeleteConfirmId(id); }
  function cancelDelete() { setDeleteConfirmId(null); }
  function confirmDelete(id) {
    // AC-14:删除随清 safeStorage 凭据(mock 侧同步清运行态/测试态,防孤儿展示态)
    setManualHosts((prev) => prev.filter((h) => h.id !== id));
    setHostRuntime((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setTestState((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setDeleteConfirmId(null);
  }

  return (
    <PreviewPage
      currentPath={currentPath}
      onNavigate={onNavigate}
      statePresets={REMOTE_HOSTS_STATE_PRESETS}
      activeStateKey={devState}
      onSelectState={setDevState}
    >
      <div className="app-shell">
        <Sidebar
          machines={applyConnectionSim(BASE_MACHINES, connState)}
          onConnectMachine={(id) => startMachineConnect(setConnState, id)}
          onAddWorkspace={() => onNavigate('/workspace/add-workspace')}
          onOpenRemoteHosts={() => setModalOpen(true)}
        />
        <div className="pane-handle" />
        <main className="main-column">
          <TabBar />
          <div className="terminal-area">
            <PlainTerminal />
          </div>
        </main>
        <div className="pane-handle" />
        <FilePanel scenario={scenarios.worktree} />
        <SideRail />
      </div>

      {modalOpen && (
        <RemoteHostsModal
          recentHosts={recentHosts}
          manualHosts={manualHosts}
          testState={testState}
          testFailReason={testFailReason}
          onTest={runTest}
          hostRuntime={hostRuntime}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          deleteConfirmId={deleteConfirmId}
          onRequestDelete={requestDelete}
          onCancelDelete={cancelDelete}
          onConfirmDelete={confirmDelete}
          onOpenBrowserProfiles={() => onNavigate('/settings/browser-profiles')}
          formMode={formMode}
          formValues={formValues}
          onFormChange={setFormValues}
          onOpenAdd={openAddForm}
          onOpenEdit={openEditForm}
          onCancelForm={cancelForm}
          onSaveForm={saveForm}
          showEmptyState={showEmptyState}
          onClose={() => setModalOpen(false)}
        />
      )}
    </PreviewPage>
  );
}

// ---- F. /sidebar/machine-groups ----
// Sidebar 机器分组主视图(AC-1/AC-2/AC-8/AC-10/AC-11):本机组置顶 + 远程机组 +
// 连接生命周期在组头呈现 + 断线确定性回落。dev 顶栏只放页面到不了的态(M=0 / 部署中%快照 /
// 连接失败 / 断线回落);默认态可真实点「连接」跑完整连接编排(复用 startMachineConnect)。

const SIDEBAR_MG_STATE_PRESETS = [
  { key: 'idle', label: '默认交互' },
  { key: 'm0', label: 'M=0 · 纯本机' },
  { key: 'deploying', label: '部署中快照 · 47%' },
  { key: 'lost', label: '断线过渡(0–900ms)' },
  { key: 'reconnecting', label: '自动重连中' },
  { key: 'failed', label: '连接失败' },
  { key: 'disconnected', label: '断线回落(AC-11)' },
];

const SIDEBAR_MG_LOCAL_WORKSPACES = [
  { name: 'OkWork', meta: 'main · ~/apps/okok/OkWork', tabCount: 2, tabRunning: 1 },
];

const SIDEBAR_MG_MINIPC_WORKSPACES = [
  { name: 'aon-edge', meta: 'dev · ~/apps/aon-edge', tabCount: 2, tabRunning: 1 },
  { name: 'ml-lab', meta: 'main · ~/work/ml-lab', tabCount: 0 },
];

/** 远程 workspace 文件树 mock(供 FilePanel remote=true 演示 D-7:树浏览 + git 着色在范围)。 */
const SIDEBAR_MG_REMOTE_FILES = [
  { name: 'src', kind: 'dir', depth: 0, expanded: true, status: 'modified-dim' },
  { name: 'edge', kind: 'dir', depth: 1, expanded: true, status: 'modified-dim' },
  { name: 'inference.py', kind: 'file', depth: 2, status: 'modified' },
  { name: 'config.yaml', kind: 'file', depth: 1, status: 'untracked' },
  { name: 'README.md', kind: 'file', depth: 0 },
];

function buildSidebarMgMachines() {
  return [
    { id: 'local', kind: 'local', label: '本机', workspaces: SIDEBAR_MG_LOCAL_WORKSPACES.map((w) => ({ ...w })) },
    {
      id: 'mini-pc', kind: 'remote', alias: 'mini-pc', addr: 'liam@192.168.1.40', status: 'connected',
      rttMs: 87,
      workspaces: SIDEBAR_MG_MINIPC_WORKSPACES.map((w) => ({ ...w })),
    },
    { id: 'dev-server', kind: 'remote', alias: 'dev-server', addr: 'liam@10.0.0.8', status: 'disconnected', workspaces: null },
  ];
}

/** 本页专属极简 TabBar:单活跃 tab 跟随当前选中 workspace(+ 远程机小标签),仅作定位锚 · 不是通用 TabBar 的替代。 */
function MachineGroupsTabBar({ activeWs, activeMachine }) {
  const label = activeWs ? activeWs.name : '—';
  const remote = !!(activeMachine && activeMachine.kind === 'remote');
  return (
    <div className="tabbar" aria-label="Tabs">
      <div className="tabbar-tabs">
        <div className="tabbar-tab tabbar-tab--active">
          <span className="tab-dot tab-dot--running" />
          <span className="tab-icon">▱</span>
          <span className="tabbar-tab-title">{label}</span>
          {remote && <span className="tabbar-tab-host">{activeMachine.alias}</span>}
          <button className="tabbar-close-btn tabbar-close-btn--always" title="Close tab">×</button>
        </div>
      </div>
      <div className="tabbar-drag-strip" />
    </div>
  );
}

/**
 * 全局一次性轻量提示(AC-7 · 镜像真实 `src/renderer/components/TransientToast.tsx` 的语义):
 * 单槽字符串(后写覆盖前写)· 5000ms 自动消失 · role=status + aria-live=polite。
 * 这是真实产品里就有的组件,不是预览专属控件 —— 不违反 UI-RULES「页面内禁内嵌预览控件」那条
 * (那条禁的是状态切换器一类真实 app 没有的东西)。
 */
const TOAST_AUTO_DISMISS_MS = 5000;
function PreviewTransientToast({ notice, onDismiss }) {
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(onDismiss, TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [notice, onDismiss]);
  if (!notice) return null;
  return <div className="transient-toast" role="status" aria-live="polite">{notice}</div>;
}

function SidebarMachineGroupsPage({ currentPath, onNavigate }) {
  const [devState, setDevState] = useState('idle');
  // AC-7:连接失败的呈现出口(组头不再常驻失败文案)
  const [toast, setToast] = useState(null);
  const [connState, setConnState] = useState({});
  const [active, setActive] = useState({ machineId: 'mini-pc', name: 'aon-edge' });
  const [lostPhase, setLostPhase] = useState(null); // null | 'panel' | 'folded'(D-8 两段式回落)
  const lostTimer = useRef(null);
  // 连接钮点击后的 600ms 模拟连接定时器,按 machine.id 存放(取消钮/切 preset 需能中止,AC-6)。
  const connectTimerRef = useRef({});
  // devState 切回 'idle' 时这条 effect 会把 connState 重置为 {}(见下)——但「自动重连中」态点断开
  // 需要落到「未连接」而非 mini-pc 默认的「已连接」,故用这个 ref 把目标 connState 带过重置。
  const pendingConnRef = useRef(null);
  // 组头折叠(chevron · 复现门补齐):按 machine.id 记哪些组被用户折叠;与 devState/connState 无关,
  // 切预设不重置——用户手动折叠的意图应该跨预设保留。
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());

  function toggleCollapse(id) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    Object.values(connectTimerRef.current).forEach((t) => clearTimeout(t));
    connectTimerRef.current = {};
    setConnState(pendingConnRef.current || {});
    pendingConnRef.current = null;
    setLostPhase(null);
    if (lostTimer.current) { clearTimeout(lostTimer.current); lostTimer.current = null; }

    if (devState === 'disconnected') {
      // AC-11 演示:先呈现该 workspace 面板断线态(900ms)· 再确定性回落到本机首个 workspace + 组头折叠
      setActive({ machineId: 'mini-pc', name: 'aon-edge' });
      setLostPhase('panel');
      lostTimer.current = setTimeout(() => {
        setLostPhase('folded');
        setActive({ machineId: 'local', name: 'OkWork' });
      }, 900);
    } else if (devState === 'idle' || devState === 'reconnecting' || devState === 'lost') {
      setActive({ machineId: 'mini-pc', name: 'aon-edge' });
    } else {
      setActive({ machineId: 'local', name: 'OkWork' });
    }

    return () => { if (lostTimer.current) clearTimeout(lostTimer.current); };
  }, [devState]);

  const baseMachines = useMemo(() => buildSidebarMgMachines(), []);

  // AC-7:任一远程机进入 failed → 弹一条全局 toast(文案取 FAIL_REASONS 单源,不另写字面量)。
  // 单槽语义:多机近同时失败只留最近一条(PRD D-2 已由用户显式接受)。
  useEffect(() => {
    if (devState !== 'failed') return;
    const failed = buildSidebarMgMachines().find((m) => m.id === 'dev-server');
    const reason = FAIL_REASONS.unreachable;
    setToast(`连接 ${failed ? failed.alias : 'dev-server'} 失败:${reason.label}`);
  }, [devState]);

  const machines = useMemo(() => {
    if (devState === 'm0') {
      return [{ id: 'local', kind: 'local', label: '本机', workspaces: SIDEBAR_MG_LOCAL_WORKSPACES.map((w) => ({ ...w, active: true })) }];
    }

    let list = applyConnectionSim(baseMachines, connState);

    if (devState === 'deploying') {
      list = list.map((m) => (m.id === 'dev-server' ? { ...m, runtime: { stage: 'deploying', percent: 47, arch: 'linux-x64', fast: false } } : m));
    } else if (devState === 'lost') {
      // 断线过渡快照(0–900ms · AC-15):与 devState='disconnected' 的 panel 阶段视觉一致(status=lost ·
      // foldedLost=false · workspace 保活),但这里是静止不动的独立预设——不会 900ms 后自动折叠,
      // 方便走查这个此前组头完全空白的态(现在补了连接图标)。
      list = list.map((m) => {
        if (m.id !== 'mini-pc') return m;
        return {
          ...m,
          status: 'lost',
          workspaces: m.workspaces.map((ws) => (ws.name === 'aon-edge' ? { ...ws, disconnectedPanel: true } : ws)),
        };
      });
    } else if (devState === 'reconnecting') {
      // 自动重连中(BL-005 AC-15):黄点脉冲 + 「重连中…」,workspace 列表照常展开(会话仍在远端跑 ·
      // 非 foldedLost),活跃 workspace 打「重连中」态标签(视觉家族同 disconnectedPanel,标签色区分)。
      list = list.map((m) => {
        if (m.id !== 'mini-pc') return m;
        return {
          ...m,
          status: 'reconnecting',
          workspaces: m.workspaces.map((ws) => (ws.name === 'aon-edge' ? { ...ws, reconnectingPanel: true } : ws)),
        };
      });
    } else if (devState === 'failed') {
      // runtime 仍写 failed(数据面保留),但 MachineGroup 不再把它渲染进组头(AC-7);
      // 呈现出口 = 下方 effect 触发的全局 toast,组头则回落成连接图标钮。
      list = list.map((m) => (m.id === 'dev-server' ? { ...m, runtime: { stage: 'failed', reason: 'unreachable' } } : m));
    } else if (devState === 'disconnected') {
      list = list.map((m) => {
        if (m.id !== 'mini-pc') return m;
        if (lostPhase === 'folded') {
          return { ...m, status: 'lost', foldedLost: true, workspaces: null, emptyLabel: '已断开 · 点击重连' };
        }
        return {
          ...m,
          status: 'lost',
          workspaces: m.workspaces.map((ws) => (ws.name === 'aon-edge' ? { ...ws, disconnectedPanel: true } : ws)),
        };
      });
    }

    return list.map((m) => ({
      ...m,
      workspaces: m.workspaces
        ? m.workspaces.map((ws) => ({ ...ws, active: m.id === active.machineId && ws.name === active.name }))
        : null,
    }));
  }, [baseMachines, connState, devState, lostPhase, active]);

  function selectWorkspace(machine, ws) {
    if (devState === 'disconnected' && lostPhase === 'panel') return; // 断线瞬间锁定选择,等待确定性回落完成
    setActive({ machineId: machine.id, name: ws.name });
  }

  function retryMachine() {
    // 自动重连中「立即重试」:退出快照 preset,回到可真实交互的默认态——mini-pc 基础态本就是
    // 已连接,退出后天然回落到位,不需要像 handleDisconnectClick 那样借 pendingConnRef 显式覆盖
    // connState。(AC-7 之后失败态不再有组头内的「重试」按钮——那条已改走全局 toast + 回落连接图标钮,
    // 见 renderRuntimeStatus 与上方 useEffect 的 AC-7 注释;此函数不再服务那条路径。)
    setDevState('idle');
  }

  /** 连接图标钮(未连接 / 断线过渡 / 已断开折叠三态共用):idle 态走 600ms 模拟连接编排;
   *  预设快照态(断线过渡/已断开折叠)先退出 preset —— mini-pc 基础态本就是「已连接」,天然回落。 */
  function handleConnectClick(id) {
    if (devState !== 'idle') {
      setDevState('idle');
      return;
    }
    setConnState((prev) => ({ ...prev, [id]: 'connecting' }));
    connectTimerRef.current[id] = window.setTimeout(() => {
      setConnState((prev) => ({ ...prev, [id]: 'connected' }));
      delete connectTimerRef.current[id];
    }, 600);
  }

  /** 取消图标钮(连接中 / 部署中% 两态共用,AC-4/AC-5):立即回未连接态,且中止残余定时器/事件写入
   *  (AC-6 —— 取消后不得静默「复活」成已连接)。 */
  function handleCancelClick(id) {
    if (connectTimerRef.current[id]) {
      clearTimeout(connectTimerRef.current[id]);
      delete connectTimerRef.current[id];
    }
    if (devState !== 'idle') {
      setDevState('idle');
      return;
    }
    setConnState((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /** 断开图标钮(已连接 / 自动重连中两态共用):AC-2 立即回未连接态、不经 900ms 过渡;
   *  在自动重连中点断开 = 终止自动重连(D-4),借 pendingConnRef 让退出 preset 落到「未连接」
   *  而不是 mini-pc 默认的「已连接」。 */
  function handleDisconnectClick(id) {
    if (connectTimerRef.current[id]) {
      clearTimeout(connectTimerRef.current[id]);
      delete connectTimerRef.current[id];
    }
    if (devState !== 'idle') {
      pendingConnRef.current = { [id]: 'disconnected' };
      setDevState('idle');
      return;
    }
    setConnState((prev) => ({ ...prev, [id]: 'disconnected' }));
  }

  const activeMachine = machines.find((m) => m.id === active.machineId);
  const activeWs = activeMachine && activeMachine.workspaces ? activeMachine.workspaces.find((w) => w.active) : null;
  const activeIsRemote = !!(activeMachine && activeMachine.kind === 'remote');
  const panelDisconnected = devState === 'disconnected' && lostPhase === 'panel' && !!(activeWs && activeWs.disconnectedPanel);

  const remoteScenario = activeIsRemote && activeMachine ? {
    mode: 'worktree',
    root: `~/apps/${activeWs ? activeWs.name : ''}`,
    hint: `${activeMachine.alias} · ${activeMachine.addr}`,
    rows: SIDEBAR_MG_REMOTE_FILES,
  } : null;

  return (
    <PreviewPage
      currentPath={currentPath}
      onNavigate={onNavigate}
      statePresets={SIDEBAR_MG_STATE_PRESETS}
      activeStateKey={devState}
      onSelectState={setDevState}
    >
      <PreviewTransientToast notice={toast} onDismiss={() => setToast(null)} />
      <div className="app-shell">
        <Sidebar
          machines={machines}
          onConnectMachine={handleConnectClick}
          onDisconnectMachine={handleDisconnectClick}
          onCancelMachine={handleCancelClick}
          onRetryMachine={retryMachine}
          onAddWorkspaceMachine={() => onNavigate('/workspace/add-workspace')}
          collapsedIds={collapsedIds}
          onToggleCollapseMachine={toggleCollapse}
          onSelectWorkspace={selectWorkspace}
          onAddWorkspace={() => onNavigate('/workspace/add-workspace')}
          onOpenRemoteHosts={() => onNavigate('/settings/remote-hosts')}
        />
        <div className="pane-handle" />
        <main className="main-column">
          <MachineGroupsTabBar activeWs={activeWs} activeMachine={activeMachine} />
          <div className="terminal-area">
            {panelDisconnected ? (
              <div className="terminal-host" aria-label="Terminal">
                <div className="terminal-disconnected">
                  <span className="terminal-disconnected__icon">⚠</span>
                  <div className="terminal-disconnected__title">与 mini-pc 的连接已断开</div>
                  <div className="terminal-disconnected__hint">workspace「aon-edge」面板已失联 · 即将回落到本机工作区…</div>
                </div>
              </div>
            ) : (
              <PlainTerminal promptUser={activeIsRemote && activeMachine ? `liam@${activeMachine.alias}` : 'liam@local'} />
            )}
          </div>
        </main>
        <div className="pane-handle" />
        {panelDisconnected ? (
          <section className="file-panel file-panel--disconnected" aria-label="File Panel">
            <PreviewPanelHeader title="Files" icon={<RailFolderIcon />} />
            <div className="file-panel__disconnected-note">连接已断开 · 文件树暂不可用</div>
          </section>
        ) : (
          <FilePanel scenario={remoteScenario || scenarios.worktree} remote={activeIsRemote} />
        )}
        <SideRail />
      </div>
    </PreviewPage>
  );
}

// ---- G. /session/reconnect-continuity(BL-005:断线重连与会话连续性)----

const RECONNECT_STATE_PRESETS = [
  { key: 'live', label: '在线基线' },
  { key: 'disconnected', label: '断线 · T 秒内' },
  { key: 'reconnecting', label: '重连握手中' },
  { key: 'reconnected-running', label: '重连成功 · 仍在跑' },
  { key: 'reconnected-completed', label: '断开期已完成' },
  { key: 'retry-failed', label: '重连失败' },
];

const RC_LOCAL_WORKSPACES = [
  { name: 'OkWork', meta: 'main · ~/apps/okok/OkWork', tabCount: 1, tabRunning: 0 },
];

const RC_DEFAULT_TABS = [
  { id: 'build', title: 'aon-edge · build', primary: true },
  { id: 'agent', title: 'aon-edge · agent', primary: false },
];

/** 断开前已知的终端快照(6 态共用「历史部分」·冻结态只展示这段·重连后在其后追加,AC-3 增量回放)。 */
const RC_SNAPSHOT_LINES = [
  { prefix: '12:04:01', value: 'Compiling src/edge/inference.py' },
  { prefix: '12:04:03', value: 'Compiling src/edge/config.yaml' },
  { prefix: '12:04:05', value: 'Running unit tests (42/58)…' },
  { prefix: '12:04:07', value: 'Running unit tests (55/58)…' },
  { prefix: '12:04:09', value: 'Running unit tests (58/58) ✓' },
];

const RC_LIVE_STREAM_LINE = { prefix: '12:04:11', value: 'Bundling assets (2/6)…', streaming: true };

const RC_RESUME_RUNNING_LINES = [
  { prefix: '12:09:12', value: 'Bundling assets (5/6)…' },
  { prefix: '12:09:16', value: 'Starting dev server…', streaming: true },
];

const RC_COMPLETED_LINES = [
  { prefix: '12:11:02', value: 'Bundling assets (6/6)…' },
  { prefix: '12:11:05', value: '✓ build succeeded in 3m12s', tone: 'success' },
  { prefix: '12:11:05', value: 'process exited (code 0)', tone: 'exit' },
];

/** 终端条目按态拼装:disconnected/reconnecting/retry-failed 三态**冻结在断开前快照**(断开期无新输出可见 ·
 * 与「远端仍在跑但本地画面暂停」的叙事一致);reconnected-* 两态在快照后接**补回断开期 gap** 的分隔行(AC-3)。 */
function buildRcEntries(devState) {
  const snapshot = RC_SNAPSHOT_LINES.map((l) => ({ type: 'line', ...l }));
  if (devState === 'live') {
    return [...snapshot, { type: 'line', ...RC_LIVE_STREAM_LINE }];
  }
  if (devState === 'reconnected-running') {
    return [
      ...snapshot,
      { type: 'divider', label: '补回断开期间 128 行' },
      ...RC_RESUME_RUNNING_LINES.map((l) => ({ type: 'line', ...l })),
    ];
  }
  if (devState === 'reconnected-completed') {
    return [
      ...snapshot,
      { type: 'divider', label: '补回断开期间 214 行' },
      ...RC_COMPLETED_LINES.map((l) => ({ type: 'line', ...l })),
    ];
  }
  // disconnected / reconnecting / retry-failed:冻结在断开前快照,无新增
  return snapshot;
}

/** Sidebar 机器分组按态拼装:reconnecting = AC-15 瞬时断线保活(黄点·workspace 打「重连中」·不折叠);
 * retry-failed = 逼近 BL-004 full-drop 边界(红点 lost·仍展示为可重连,非真的从 Sidebar 消失)。 */
function buildRcMachines(devState) {
  const minipcStatus = devState === 'retry-failed'
    ? 'lost'
    : (devState === 'disconnected' || devState === 'reconnecting')
      ? 'reconnecting'
      : 'connected';

  const ws = {
    name: 'aon-edge',
    meta: 'dev · ~/apps/aon-edge',
    tabCount: 2,
    tabRunning: devState === 'reconnected-completed' ? 0 : 1,
    active: true,
  };
  if (devState === 'disconnected' || devState === 'reconnecting') {
    ws.reconnectingPanel = true;
  }

  return [
    { id: 'local', kind: 'local', label: '本机', workspaces: RC_LOCAL_WORKSPACES.map((w) => ({ ...w })) },
    {
      id: 'mini-pc', kind: 'remote', alias: 'mini-pc', addr: 'liam@192.168.1.40',
      status: minipcStatus,
      workspaces: [ws],
    },
  ];
}

/** 断开前已知态(running)在未对账前维持不变(AC-5 对账只在重连收敛后发生)·reconnected-completed 才翻新态。 */
function rcTabMeta(devState) {
  if (devState === 'reconnected-completed') {
    return { dotClass: 'tab-dot--exited', exitTag: '✓ exit 0' };
  }
  return { dotClass: 'tab-dot--running', exitTag: null };
}

const RC_REMOTE_FILE_SCENARIO = {
  mode: 'worktree',
  root: '~/apps/aon-edge',
  hint: 'mini-pc · liam@192.168.1.40',
  rows: SIDEBAR_MG_REMOTE_FILES,
};

function ReconnectTabBar({ devState, tabs, onCloseTab }) {
  const { dotClass, exitTag } = rcTabMeta(devState);
  return (
    <div className="tabbar" aria-label="Tabs">
      <div className="tabbar-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`tabbar-tab${t.primary ? ' tabbar-tab--active' : ''}`}>
            <span className={`tab-dot ${t.primary ? dotClass : 'tab-dot--idle'}`} />
            <span className="tab-icon">▱</span>
            <span className="tabbar-tab-title">{t.title}</span>
            {t.primary && <span className="tabbar-tab-host">mini-pc</span>}
            {t.primary && exitTag && (
              <span className="tab-exit-tag" data-ac="AC-12">{exitTag}</span>
            )}
            <button
              className="tabbar-close-btn tabbar-close-btn--always"
              title="Close tab"
              onClick={() => onCloseTab(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tabbar-drag-strip" />
    </div>
  );
}

/** 重连横幅:disconnected(自动重连倒计时 + 手动立即重试)/ reconnecting(隧道重建中 · spinner)/
 * retry-failed(失败态 · 重试 + 查看远程机)三态各自的真实可点交互(AC-6/AC-10/AC-13)。 */
function ReconnectBanner({ devState, manualRetrying, onManualRetry, onViewHost }) {
  if (devState === 'disconnected') {
    return (
      <div className="add-ws__reconnect-banner" role="status" data-ac="AC-6 AC-13 AC-15">
        <span>与 mini-pc 的连接已断开 · 正在重连…(第 2 次 · 4s 后重试)</span>
        <button className="add-ws__reconnect-btn" onClick={onManualRetry} disabled={manualRetrying}>
          {manualRetrying ? '重试中…' : '立即重试'}
        </button>
      </div>
    );
  }
  if (devState === 'reconnecting') {
    return (
      <div className="add-ws__reconnect-banner" role="status" data-ac="AC-6 AC-10">
        <span className="add-ws__spinner add-ws__spinner--sm" />
        <span>正在重建隧道 → mini-pc…</span>
      </div>
    );
  }
  if (devState === 'retry-failed') {
    return (
      <div className="add-ws__reconnect-banner add-ws__reconnect-banner--failed" role="status" data-ac="AC-6">
        <span>重连失败 · 已重试 5 次</span>
        <div className="rc-banner-actions">
          <button className="add-ws__reconnect-btn" onClick={onManualRetry} disabled={manualRetrying}>
            {manualRetrying ? '重试中…' : '重试'}
          </button>
          <button className="add-ws__reconnect-btn" onClick={onViewHost}>查看远程机</button>
        </div>
      </div>
    );
  }
  return null;
}

function ReconnectContinuityPage({ currentPath, onNavigate }) {
  const [devState, setDevState] = useState('live');
  const [tabs, setTabs] = useState(RC_DEFAULT_TABS);
  const [manualRetrying, setManualRetrying] = useState(false);

  useEffect(() => {
    setTabs(RC_DEFAULT_TABS);
    setManualRetrying(false);
  }, [devState]);

  function closeTab(id) {
    setTabs((prev) => prev.filter((t) => t.id !== id));
  }

  function handleManualRetry() {
    setManualRetrying(true);
    setTimeout(() => setManualRetrying(false), 900);
  }

  const machines = useMemo(() => buildRcMachines(devState), [devState]);
  const entries = useMemo(() => buildRcEntries(devState), [devState]);
  const frozen = devState === 'disconnected' || devState === 'reconnecting' || devState === 'retry-failed';

  return (
    <PreviewPage
      currentPath={currentPath}
      onNavigate={onNavigate}
      statePresets={RECONNECT_STATE_PRESETS}
      activeStateKey={devState}
      onSelectState={setDevState}
    >
      <div className="app-shell">
        <div data-ac="AC-15" style={{ display: 'contents' }}>
          <Sidebar
            machines={machines}
            onAddWorkspace={() => onNavigate('/workspace/add-workspace')}
            onOpenRemoteHosts={() => onNavigate('/settings/remote-hosts')}
          />
        </div>
        <div className="pane-handle" />
        <main className="main-column">
          <ReconnectTabBar devState={devState} tabs={tabs} onCloseTab={closeTab} />
          <div className="terminal-area">
            <div className="add-ws__terminal-wrap">
              <div className="terminal-host" aria-label="Terminal">
                <ReconnectBanner
                  devState={devState}
                  manualRetrying={manualRetrying}
                  onManualRetry={handleManualRetry}
                  onViewHost={() => onNavigate('/settings/remote-hosts')}
                />
                {frozen && (
                  <div className="rc-frozen-note" role="status">● 远端进程仍在运行 · 本地画面已暂停</div>
                )}
                <div className={`terminal-screen${frozen ? ' rc-frozen' : ''}`} data-ac="AC-1 AC-3">
                  {entries.map((e, i) => (
                    e.type === 'divider' ? (
                      <div className="rc-gap-divider" key={`d-${i}`}>— {e.label} —</div>
                    ) : (
                      <div className={`terminal-line${e.tone ? ` terminal-line--${e.tone}` : ''}`} key={`l-${i}`}>
                        <span className="terminal-prefix">{e.prefix}</span>
                        <span>
                          {e.value}
                          {e.streaming && !frozen && <span className="rc-cursor">▍</span>}
                        </span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
        <div className="pane-handle" />
        <FilePanel scenario={RC_REMOTE_FILE_SCENARIO} remote />
        <SideRail />
      </div>
    </PreviewPage>
  );
}

function App() {
  const [path, setPath] = useState(() => normalizeInitialPath(window.location.pathname));
  const [scenarioKey, setScenarioKey] = useState('worktree');

  useEffect(() => {
    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path);
    }
  }, [path]);

  useEffect(() => {
    function onPopState() {
      setPath(normalizeInitialPath(window.location.pathname));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(next) {
    setPath((prev) => {
      if (next === prev) return prev;
      window.history.pushState(null, '', next);
      return next;
    });
  }

  if (path === '/shell/close-install-confirmation') {
    return <ConfirmationPreview />;
  }

  if (path === '/workspace/add-workspace') {
    return <AddWorkspacePage currentPath={path} onNavigate={navigate} />;
  }

  if (path === '/settings/remote-hosts') {
    return <RemoteHostsPage currentPath={path} onNavigate={navigate} />;
  }

  if (path === '/settings/browser-profiles') {
    return <BrowserProfilesPage currentPath={path} onNavigate={navigate} />;
  }

  if (path === '/settings/browser-passwords') {
    return <BrowserPasswordsPage currentPath={path} onNavigate={navigate} />;
  }

  if (path === '/browser/password-save-fill') {
    return <PasswordFlowPage currentPath={path} onNavigate={navigate} />;
  }

  if (path === '/sidebar/machine-groups') {
    return <SidebarMachineGroupsPage currentPath={path} onNavigate={navigate} />;
  }

  if (path === '/session/reconnect-continuity') {
    return <ReconnectContinuityPage currentPath={path} onNavigate={navigate} />;
  }

  const scenario = scenarios[scenarioKey];

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="pane-handle" />
      <main className="main-column">
        <TabBar />
        <div className="terminal-area">
          <Terminal scenario={scenario} onScenario={setScenarioKey} />
        </div>
      </main>
      <div className="pane-handle" />
      <FilePanel scenario={scenario} />
      <SideRail />
    </div>
  );
}

const rootElement = document.getElementById('root');
const root = import.meta.hot?.data.root ?? createRoot(rootElement);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<App />);
