import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const scenarios = {
  worktree: {
    label: 'WorkTree',
    mode: 'worktree',
    terminalPath: 'src/renderer/components/FilePanel.tsx:81:5',
    terminalStatus: 'located in WorkTree',
    root: '/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-F260613053134-Terminal-Path-FilePanel',
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
    terminalPath: 'file:///Users/liam/apps/okok/TermPro/project-specs/GLOSSARY.md',
    terminalStatus: 'located in Root',
    root: '/Users/liam/apps/okok/TermPro',
    hint: '~/apps/okok/TermPro',
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
    root: '/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-F260613053134-Terminal-Path-FilePanel',
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
];

function PreviewDevBar({ currentPath, onNavigate, statePresets, activeStateKey, onSelectState }) {
  return (
    <div className="preview-devbar">
      <div className="preview-devbar__left">
        <span className="preview-devbar__label">DESIGN PREVIEW</span>
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
      </div>
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
  { id: 'termpro', name: 'TermPro', active: true, meta: 'main · ~/apps/okok/TermPro' },
  { id: 'aon-core', name: 'aon-core', active: false, meta: 'staging · ~/apps/joli/aon' },
];

function Sidebar({
  updatePillLabel = '⬆ 新版本 v0.4.0 — 点击升级',
  updatePillTitle = '下载新版本并自动重启升级',
  updatePillState = 'available',
  workspaces = DEFAULT_WORKSPACES,
  machines,
  onConnectMachine,
  onAddWorkspace,
  onOpenRemoteHosts,
  onReconnectWorkspace,
} = {}) {
  return (
    <aside className="sidebar" aria-label="Workspaces">
      <div className="sidebar-header">
        <button className="icon-button" title="Notifications">◦</button>
        <button className="icon-button" title="Add workspace" onClick={onAddWorkspace}>+</button>
      </div>
      <div className="sidebar-list">
        {machines ? (
          machines.map((m) => (
            <MachineGroup key={m.id} machine={m} onConnect={onConnectMachine} />
          ))
        ) : (
          workspaces.map((item) => (
            <WorkspaceItem key={item.id} item={item} onReconnect={onReconnectWorkspace} />
          ))
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
      />
    </aside>
  );
}

// ---- Sidebar 机器分组(模型 A:远程机为中心,workspace 注册表驻留 Host 侧)----

/**
 * 机器分组:本机组头无状态点;远程组头 = 状态点 + 别名(title 显 addr)。
 * status: 'connected' | 'connecting' | 'disconnected'(未连接·灰)| 'lost'(断线·红)。
 * workspaces 为 null = 未连接,连接后才能看到该机上的 workspace(A 模型核心)。
 */
function MachineGroup({ machine, onConnect }) {
  const isRemote = machine.kind === 'remote';
  const groupClasses = [
    'sidebar-machine-group',
    machine.status === 'lost' ? 'sidebar-machine-group--lost' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={groupClasses}>
      <div className="sidebar-machine-header" title={isRemote ? machine.addr : undefined}>
        {isRemote && <span className={`sidebar-machine-dot sidebar-machine-dot--${machine.status}`} />}
        <span className="sidebar-machine-label">{isRemote ? machine.alias : machine.label}</span>
        {isRemote && machine.status === 'disconnected' && (
          <button
            className="sidebar-machine-connect"
            onClick={() => onConnect && onConnect(machine.id)}
          >
            连接
          </button>
        )}
        {isRemote && machine.status === 'connecting' && (
          <span className="sidebar-machine-connecting">连接中…</span>
        )}
      </div>
      {machine.workspaces ? (
        machine.workspaces.map((ws, i) => <MachineWorkspaceRow key={`${ws.name}-${i}`} ws={ws} />)
      ) : (
        <div className="sidebar-machine-empty">未连接 · 连接后显示该机上的 workspace</div>
      )}
    </div>
  );
}

/** 机器组内 workspace 条目;sessions = 会话活动徽标(UI 断开期间会话仍在 Host 上活着)。 */
function MachineWorkspaceRow({ ws }) {
  return (
    <div className={`sidebar-item${ws.active ? ' sidebar-item--active' : ''}`}>
      <div className="sidebar-item-name-row">
        <span className="sidebar-item-name">{ws.name}</span>
      </div>
      <div className="sidebar-item-meta">
        <span className="sidebar-item-meta-row">
          <span className="sidebar-remote-meta-text">{ws.meta}</span>
          {ws.sessions && <span className="sidebar-machine-sessions">{ws.sessions}</span>}
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

  return (
    <div className={classes}>
      <div className="sidebar-item-name-row">
        <span className="sidebar-item-name">{item.name}</span>
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
        <div className="about-name">TermPro</div>
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
    title: '退出 TermPro?',
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
    message: '升级包已下载完成。确认后 TermPro 会重启并交给 Squirrel.Mac 完成安装。',
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
    ['smoke', 'TERMPRO_SMOKE bypasses this confirmation path'],
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

function Terminal({ scenario, onScenario }) {
  const lines = useMemo(() => [
    ['codex', 'review found path candidate'],
    ['path', scenario.terminalPath],
    ['termpro', scenario.terminalStatus],
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

function FilePanel({ scenario }) {
  const mode = scenario.mode;
  return (
    <section className="file-panel" aria-label="File Panel">
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
          <button className="file-panel__diff-btn">Diff</button>
          <button className="file-panel__refresh" title="Refresh">⟳</button>
        </div>
      </div>
      <div className="file-panel__divider" />

      <div className="file-panel__tree">
        {scenario.rows.map((row) => (
          <TreeRow key={`${row.depth}-${row.name}`} row={row} />
        ))}
      </div>
    </section>
  );
}

function TreeRow({ row }) {
  const isDir = row.kind === 'dir';
  const classes = [
    'file-panel__row',
    isDir ? 'file-panel__row--dir' : 'file-panel__row--file',
    row.status ? `file-panel__row--git-${row.status}` : '',
    row.target ? 'file-panel__row--locate-target' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} style={{ paddingLeft: 10 + row.depth * 14 }}>
      <span className="file-panel__arrow">{isDir ? (row.expanded ? '▾' : '▸') : null}</span>
      <span className="file-panel__name">{row.name}</span>
      {!isDir && <button className="file-panel__row-action">diff</button>}
    </div>
  );
}

/** 无 dev 工具栏的纯净终端:新路由背景用,不带预览专属的场景切换控件。 */
function PlainTerminal() {
  return (
    <div className="terminal-host" aria-label="Terminal">
      <div className="terminal-screen">
        <div className="terminal-line">
          <span className="terminal-prefix">liam@local</span>
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
    workspaces: [{ name: 'TermPro', meta: 'main · ~/apps/okok/TermPro', active: true }],
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

/** 按连接模拟状态解析 machines:connecting 盖状态;connected 盖状态并注入发现的 workspace。 */
function applyConnectionSim(machines, connState) {
  return machines.map((m) => {
    const st = connState[m.id];
    if (!st) return m;
    if (st === 'connecting') return { ...m, status: 'connecting' };
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
              <div className="add-ws__dirlist">
                {dirs.length === 0 && <div className="add-ws__dir-empty">(空目录)</div>}
                {dirs.map((name) => (
                  <div key={name} className="file-panel__row file-panel__row--dir" onClick={() => onDescend(name)}>
                    <span className="file-panel__arrow">▸</span>
                    <span className="file-panel__name">{name}</span>
                  </div>
                ))}
              </div>
              <div className="add-ws__pathrow">
                <input className="file-panel__path-input add-ws__path-input" value={pathDisplay} readOnly />
              </div>
              <div className="add-ws__actions">
                <button className="add-ws__btn" onClick={onClose}>取消</button>
                <button className="add-ws__btn add-ws__btn--primary" onClick={onCreate}>在 {selectedHost.alias} 上创建项目</button>
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

  function resetModalFlow() {
    setStep('pick');
    setSelectedHostId(null);
    setDirSegments(['home', 'liam']);
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
    setDirSegments(['home', 'liam']);
    setStep('dir');
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
          onCrumb={setDirSegments}
          onDescend={(name) => setDirSegments((prev) => [...prev, name])}
          onBackToPick={backToPick}
          onCreate={handleCreate}
        />
      )}
    </PreviewPage>
  );
}

// ---- E. /settings/remote-hosts ----

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
                    return (
                      <div key={h.id} className="remote-hosts__entry">
                        <div className="remote-hosts__row">
                          {deleteConfirmId === h.id ? (
                            <span className="remote-hosts__confirm">
                              <span className="remote-hosts__confirm-text">
                                确认删除 {h.alias}?将同时清除已存凭据{(runtime || h.status === 'connected') ? ' · 将先断开当前连接' : ''}
                              </span>
                              <button className="remote-hosts__action remote-hosts__action--danger" onClick={() => onConfirmDelete(h.id)}>是</button>
                              <button className="remote-hosts__action" onClick={onCancelDelete}>否</button>
                            </span>
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
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
