import './TabBar.css';
import { useState, useEffect, useRef } from 'react';
import { t } from '../../shared/i18n';
import {
  useAppStore,
  selectActiveWorkspace,
  tabPathLabel,
} from '../state/store';
import type { TabState } from '../state/store';
import { hostRegistry } from '../services/hostRegistry';
import { RenameModal } from './RenameModal';

/** Small terminal icon: rounded rect with > chevron and underscore line */
function TerminalIcon() {
  return (
    <span className="tab-icon">
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
        {/* Rounded rect shell */}
        <rect x="0.6" y="1.2" width="10.8" height="9.6" rx="1.6" ry="1.6" />
        {/* > chevron */}
        <polyline points="3,4.8 5.2,6 3,7.2" />
        {/* Underscore/cursor line */}
        <line x1="6.2" y1="7.2" x2="8.6" y2="7.2" />
      </svg>
    </span>
  );
}

/** 文件面板开关图标:圆角矩形 + 右侧分栏竖线(panel-right) */
function FilePanelIcon() {
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
      <rect x="0.6" y="1.2" width="10.8" height="9.6" rx="1.6" ry="1.6" />
      <line x1="7.6" y1="1.2" x2="7.6" y2="10.8" />
    </svg>
  );
}

/** 内置浏览器开关图标:地球 12×12 */
function GlobeIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="6" cy="6" r="4.9" />
      <ellipse cx="6" cy="6" rx="2.2" ry="4.9" />
      <line x1="1.1" y1="6" x2="10.9" y2="6" />
    </svg>
  );
}

/** tabbar 最右的内置浏览器开关(与文件面板开关并列) */
function BrowserToggle() {
  const open = useAppStore((s) => s.browserPanelOpen);
  const toggle = useAppStore((s) => s.toggleBrowserPanel);
  return (
    <button
      className={`tabbar-panel-btn${open ? ' tabbar-panel-btn--active' : ''}`}
      onClick={toggle}
      title={open ? t('Hide browser') : t('Show browser')}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <GlobeIcon />
    </button>
  );
}

/** tabbar 最右的文件面板折叠/展开按钮(空 tabbar 也渲染,保证随时能展开) */
function FilePanelToggle() {
  const collapsed = useAppStore((s) => s.filePanelCollapsed);
  const toggle = useAppStore((s) => s.toggleFilePanelCollapsed);
  return (
    <button
      className={`tabbar-panel-btn${collapsed ? '' : ' tabbar-panel-btn--active'}`}
      onClick={toggle}
      title={collapsed ? t('Show file panel') : t('Hide file panel')}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <FilePanelIcon />
    </button>
  );
}

export function TabBar() {
  const ws = useAppStore(selectActiveWorkspace);
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const moveTab = useAppStore((s) => s.moveTab);
  const updateTab = useAppStore((s) => s.updateTab);

  const [menuOpen, setMenuOpen] = useState(false);
  // 双击 tab 弹出改名 modal
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropBtnRef = useRef<HTMLButtonElement>(null);

  // Track the id of the tab currently being dragged
  const draggingTabId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;

    function handleMouseDown(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        dropBtnRef.current &&
        !dropBtnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // 无活跃工作区时渲染空拖拽条(保留文件面板开关)
  if (!ws) {
    return (
      <div
        className="tabbar tabbar--empty"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <BrowserToggle />
        <FilePanelToggle />
      </div>
    );
  }

  function handleTabClick(tab: TabState) {
    if (!ws) return;
    setActiveTab(ws.id, tab.id);
  }

  function handleClose(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    if (!ws) return;
    closeTab(ws.id, tabId);
  }

  function handleAdd() {
    if (!ws) return;
    addTab(ws.id);
  }

  // 右键菜单(原生):重命名 / 关闭
  async function handleContextMenu(e: React.MouseEvent, tab: TabState) {
    e.preventDefault();
    const action = await window.okwork.showTabContextMenu();
    if (action === 'rename') setRenamingTabId(tab.id);
    else if (action === 'close' && ws) closeTab(ws.id, tab.id);
  }

  async function handleAddWithDir() {
    if (!ws) return;
    setMenuOpen(false);
    const dir = await window.okwork.pickDirectory();
    if (dir) addTab(ws.id, dir);
  }

  function handleMenuAddRoot() {
    if (!ws) return;
    setMenuOpen(false);
    addTab(ws.id);
  }

  // --- Drag handlers ---

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, tabId: string) {
    draggingTabId.current = tabId;
    setDraggingId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox compat
    e.dataTransfer.setData('text/plain', tabId);
  }

  function handleDragEnd() {
    draggingTabId.current = null;
    setDraggingId(null);
  }

  function handleDragOver(
    e: React.DragEvent<HTMLDivElement>,
    targetTabId: string,
    targetIndex: number,
  ) {
    e.preventDefault();
    const srcId = draggingTabId.current;
    if (!srcId || srcId === targetTabId || !ws) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    // If pointer is left of midpoint → insert at targetIndex; otherwise at targetIndex + 1
    const insertIndex = e.clientX < midX ? targetIndex : targetIndex + 1;

    const srcIndex = ws.tabs.findIndex((t) => t.id === srcId);
    if (srcIndex < 0) return;

    // Compute effective destination after removing src from array
    // Only call if the position actually changes
    let dest = insertIndex;
    if (srcIndex < insertIndex) dest = insertIndex - 1;
    if (dest === srcIndex) return;

    moveTab(ws.id, srcId, dest < 0 ? 0 : dest);
  }

  return (
    <div className="tabbar">
      {/* 可横向滚动的标签列表 */}
      <div
        className="tabbar-tabs"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {ws.tabs.map((tab, idx) => {
          const isActive = tab.id === ws.activeTabId;
          const isDragging = tab.id === draggingId;
          const hasAttention = !!(tab.waiting || tab.unseenDone);
          // 显示规则:用户改过名 → 只用自定义名;
          // 否则默认 = cwd 相对工作区根的路径(随 cd 联动)
          const label =
            tab.customName ??
            tabPathLabel(ws.root, tab.cwd, hostRegistry.forWorkspace(ws).info?.homedir);
          // Compute dot state class (priority order)
          const dotState = tab.waiting
            ? 'tab-dot--waiting'
            : tab.unseenDone
              ? 'tab-dot--done'
              : tab.activity === 'running'
                ? 'tab-dot--running'
                : 'tab-dot--idle';
          return (
            <div
              key={tab.id}
              draggable
              className={`tabbar-tab${isActive ? ' tabbar-tab--active' : ''}${tab.exited ? ' tabbar-tab--exited' : ''}${isDragging ? ' tabbar-tab--dragging' : ''}${hasAttention ? ' tabbar-tab--attention' : ''}`}
              onClick={() => handleTabClick(tab)}
              onDoubleClick={() => setRenamingTabId(tab.id)}
              onContextMenu={(e) => void handleContextMenu(e, tab)}
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, tab.id, idx)}
            >
              <span className={`tab-dot ${dotState}`} />
              <TerminalIcon />
              <span className="tabbar-tab-title">{label}</span>
              {tab.exited && (
                <span className="tabbar-tab-exited-hint">
                  {typeof tab.exitCode === 'number'
                    ? t('exit {code}', { code: tab.exitCode })
                    : t('exited')}
                </span>
              )}
              <button
                className={`tabbar-close-btn${isActive ? ' tabbar-close-btn--always' : ''}`}
                onClick={(e) => handleClose(e, tab.id)}
                title={t('Close tab')}
              >
                &times;
              </button>
            </div>
          );
        })}

        {/* 新建标签按钮 */}
        <button className="tabbar-add-btn" onClick={handleAdd} title={t('New tab')}>
          +
        </button>

        {/* 下拉菜单触发按钮 */}
        <div className="tabbar-dropdown-wrap">
          <button
            ref={dropBtnRef}
            className="tabbar-dropdown-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title={t('New tab options')}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            ▾
          </button>
          {menuOpen && (
            <div ref={menuRef} className="tabbar-dropdown-menu">
              <button
                className="tabbar-dropdown-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleMenuAddRoot}
              >
                {t('New tab (workspace root)')}
              </button>
              <button
                className="tabbar-dropdown-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddWithDir}
              >
                {t('New tab (choose directory…)')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 末尾可拖拽空白区 */}
      <div
        className="tabbar-drag-strip"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* 文件面板 / 内置浏览器开关 */}
      <BrowserToggle />
      <FilePanelToggle />

      {/* Tab 改名 modal:留空保存 = 恢复默认名 */}
      {renamingTabId &&
        (() => {
          const tab = ws.tabs.find((tb) => tb.id === renamingTabId);
          if (!tab) return null;
          return (
            <RenameModal
              title={t('Rename Tab')}
              initialValue={tab.customName ?? ''}
              placeholder={t('Leave empty to restore default name')}
              allowEmpty
              onSave={(v) => updateTab(tab.id, { customName: v || undefined })}
              onClose={() => setRenamingTabId(null)}
            />
          );
        })()}
    </div>
  );
}
