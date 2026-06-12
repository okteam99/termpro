import './Sidebar.css';
import { useAppStore, tildify } from '../state/store';
import { hostClient } from '../services/hostClient';

export function Sidebar() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const addWorkspace = useAppStore((s) => s.addWorkspace);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);

  const homedir = hostClient.info?.homedir ?? undefined;

  async function handleAdd() {
    const path = await window.termpro.pickDirectory();
    if (path) addWorkspace(path);
  }

  function handleRemove(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    if (window.confirm(`Remove workspace "${name}"? Terminal sessions will be closed.`)) {
      removeWorkspace(id);
    }
  }

  return (
    <aside className="sidebar">
      {/* 顶部标题栏,留出 traffic light 空间 */}
      <div className="sidebar-header">
        <span className="sidebar-title">Workspaces</span>
        <button
          className="sidebar-add-btn"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={handleAdd}
          title="Add workspace"
        >
          +
        </button>
      </div>

      {/* 工作区列表 */}
      <div className="sidebar-list">
        {workspaces.length === 0 ? (
          <div className="sidebar-empty">
            <span className="sidebar-empty-text">No workspaces</span>
            <button className="sidebar-add-ws-btn" onClick={handleAdd}>
              Add Workspace
            </button>
          </div>
        ) : (
          workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            return (
              <div
                key={ws.id}
                className={`sidebar-item${isActive ? ' sidebar-item--active' : ''}`}
                onClick={() => setActiveWorkspace(ws.id)}
              >
                <span className="sidebar-item-name">{ws.name}</span>
                <span className="sidebar-item-path">
                  {tildify(ws.root, homedir)}
                </span>
                <span className="sidebar-item-tabs">
                  {ws.tabs.length} {ws.tabs.length === 1 ? 'tab' : 'tabs'}
                </span>
                <button
                  className="sidebar-remove-btn"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  onClick={(e) => handleRemove(e, ws.id, ws.name)}
                  title="Remove workspace"
                >
                  &times;
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
