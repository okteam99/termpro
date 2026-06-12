import './TabBar.css';
import { useAppStore, selectActiveWorkspace } from '../state/store';
import type { TabState } from '../state/store';

export function TabBar() {
  const ws = useAppStore(selectActiveWorkspace);
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

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

  return (
    <div className="tabbar">
      {/* 可横向滚动的标签列表 */}
      <div
        className="tabbar-tabs"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {ws.tabs.map((tab) => {
          const isActive = tab.id === ws.activeTabId;
          const label = tab.processName ?? tab.title;
          return (
            <div
              key={tab.id}
              className={`tabbar-tab${isActive ? ' tabbar-tab--active' : ''}${tab.exited ? ' tabbar-tab--exited' : ''}`}
              onClick={() => handleTabClick(tab)}
            >
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
      </div>

      {/* 末尾可拖拽空白区 */}
      <div
        className="tabbar-drag-strip"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
    </div>
  );
}
