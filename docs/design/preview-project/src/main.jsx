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
];

function routeMatchesPreview() {
  const p = window.location.pathname;
  return KNOWN_ROUTES.includes(p) || p === '/';
}

function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Workspaces">
      <div className="sidebar-header">
        <button className="icon-button" title="Notifications">◦</button>
        <button className="icon-button" title="Add workspace">+</button>
      </div>
      <div className="sidebar-list">
        <div className="sidebar-item sidebar-item--active">
          <div className="sidebar-item-name-row">
            <span className="sidebar-item-name">TermPro</span>
          </div>
          <div className="sidebar-item-meta">main · ~/apps/okok/TermPro</div>
        </div>
        <div className="sidebar-item">
          <div className="sidebar-item-name-row">
            <span className="sidebar-item-name">aon-core</span>
          </div>
          <div className="sidebar-item-meta">staging · ~/apps/joli/aon</div>
        </div>
      </div>
      <SidebarFooter devChannel updateAvailable version="0.3.12" />
    </aside>
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
function SidebarFooter({ devChannel = false, updateAvailable = false, version = '' }) {
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
        <button className="sidebar-update-pill" title="下载新版本并自动重启升级">
          ⬆ 新版本 v0.4.0 — 点击升级
        </button>
      )}

      <div className="settings-anchor">
        {menuOpen && (
          <div className="settings-menu" role="menu">
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

function App() {
  const [scenarioKey, setScenarioKey] = useState('worktree');

  if (!routeMatchesPreview()) {
    window.history.replaceState(null, '', '/terminal/file-panel-path-location');
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
