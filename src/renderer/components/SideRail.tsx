import './SideRail.css';
import { t } from '../../shared/i18n';
import { useAppStore } from '../state/store';
import { openBuiltinBrowser } from '../services/openBuiltinBrowser';

/** rail 图标:内置浏览器(地球),16×16,feather 风格 */
function GlobeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" r="6.5" />
      <ellipse cx="8" cy="8" rx="2.9" ry="6.5" />
      <line x1="1.5" y1="8" x2="14.5" y2="8" />
    </svg>
  );
}

/** rail 图标:文件管理(文件夹),16×16,feather 风格 */
function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M1.5 4a1 1 0 0 1 1-1h3l1.5 1.8h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" />
    </svg>
  );
}

/** rail 最右列的内置浏览器按钮:逻辑与旧 tabbar BrowserToggle 完全一致——
 *  已弹出独立窗口 → 聚焦该窗口;面板关着且设置为独立窗口 → 直接弹窗;否则开关面板。 */
function BrowserRailButton() {
  const open = useAppStore((s) => s.browserPanelOpen);
  const toggle = useAppStore((s) => s.toggleBrowserPanel);
  const activeTabId = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return ws?.tabs.find((tb) => tb.id === ws.activeTabId)?.id ?? null;
  });
  const poppedTabId = useAppStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    const tab = ws?.tabs.find((tb) => tb.id === ws.activeTabId);
    return tab?.browser?.poppedOut ? tab.id : null;
  });
  const surface = useAppStore((s) => s.builtinBrowserSurface);
  const active = open || !!poppedTabId;
  return (
    <button
      className={`side-rail-btn${active ? ' side-rail-btn--active' : ''}`}
      onClick={() => {
        if (poppedTabId) window.okwork?.browserPane?.focus?.(poppedTabId);
        // 面板开着 → 收起(关);从零打开且设置为独立窗口 → 直接弹窗
        else if (!open && surface === 'window' && activeTabId) openBuiltinBrowser(activeTabId);
        else toggle();
      }}
      title={
        poppedTabId
          ? t('Focus the OkBrowser window')
          : open
            ? t('Hide browser')
            : t('Show browser')
      }
    >
      <GlobeIcon />
    </button>
  );
}

/** rail 最右列的文件管理按钮:开关文件面板 */
function FilePanelRailButton() {
  const collapsed = useAppStore((s) => s.filePanelCollapsed);
  const toggle = useAppStore((s) => s.toggleFilePanelCollapsed);
  return (
    <button
      className={`side-rail-btn${!collapsed ? ' side-rail-btn--active' : ''}`}
      onClick={toggle}
      title={collapsed ? t('Show file panel') : t('Hide file panel')}
    >
      <FolderIcon />
    </button>
  );
}

/** 应用窗口最右侧的竖直功能图标栏(OpenChamber 风格 activity bar):
 *  内置浏览器 / 文件管理两个面板的开关入口,面板互斥由 store action 保证
 *  (见 store.ts toggleBrowserPanel / toggleFilePanelCollapsed 的互斥注释)。 */
export function SideRail() {
  return (
    <div className="side-rail" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <BrowserRailButton />
      <FilePanelRailButton />
    </div>
  );
}
