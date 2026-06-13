import React, { useMemo, useState } from 'react';
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

function routeMatchesPreview() {
  return window.location.pathname === '/terminal/file-panel-path-location' || window.location.pathname === '/';
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
    </aside>
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
