import './TabBar.css';
import { useState, useEffect, useRef } from 'react';
import { useAppStore, selectActiveWorkspace } from '../state/store';
import type { TabState } from '../state/store';

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

export function TabBar() {
  const ws = useAppStore(selectActiveWorkspace);
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const moveTab = useAppStore((s) => s.moveTab);

  const [menuOpen, setMenuOpen] = useState(false);
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

  // 无活跃工作区时渲染空拖拽条
  if (!ws) {
    return (
      <div
        className="tabbar tabbar--empty"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
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

  async function handleAddWithDir() {
    if (!ws) return;
    setMenuOpen(false);
    const dir = await window.termpro.pickDirectory();
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
          const label = tab.processName ?? tab.title;
          return (
            <div
              key={tab.id}
              draggable
              className={`tabbar-tab${isActive ? ' tabbar-tab--active' : ''}${tab.exited ? ' tabbar-tab--exited' : ''}${isDragging ? ' tabbar-tab--dragging' : ''}`}
              onClick={() => handleTabClick(tab)}
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, tab.id, idx)}
            >
              <TerminalIcon />
              <span className="tabbar-tab-title">{label}</span>
              {tab.exited && (
                <span className="tabbar-tab-exited-hint">exited</span>
              )}
              <button
                className={`tabbar-close-btn${isActive ? ' tabbar-close-btn--always' : ''}`}
                onClick={(e) => handleClose(e, tab.id)}
                title="Close tab"
              >
                &times;
              </button>
            </div>
          );
        })}

        {/* 新建标签按钮 */}
        <button className="tabbar-add-btn" onClick={handleAdd} title="New tab">
          +
        </button>

        {/* 下拉菜单触发按钮 */}
        <div className="tabbar-dropdown-wrap">
          <button
            ref={dropBtnRef}
            className="tabbar-dropdown-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title="New tab options"
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
                新 Tab（workspace 根）
              </button>
              <button
                className="tabbar-dropdown-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddWithDir}
              >
                新 Tab（选择目录…）
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
    </div>
  );
}
