import { useAppStore } from '../state/store';

type PaneId = 'sidebar' | 'filepanel' | 'browser';

// dir=1:拖右缘(dx 增宽);dir=-1:拖左缘(dx 减宽)
const PANES = {
  sidebar: { min: 180, max: 420, dir: 1, key: 'sidebarWidth' },
  filepanel: { min: 220, max: 560, dir: -1, key: 'filePanelWidth' },
  browser: { min: 320, max: 960, dir: -1, key: 'browserPanelWidth' },
} as const;

// 中间终端区最小宽度(用户指令 2026-07):拖拽上限按「窗口宽 − 其余可见分栏」动态收紧,
// 与 index.css .main-column 的 min-width 硬底线成对
const MAIN_MIN_W = 50;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 分栏拖拽手柄:sidebar=侧栏右缘,filepanel=文件面板左缘,browser=浏览器面板左缘 */
export function PaneHandle({ pane }: { pane: PaneId }) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const { min, max, dir, key } = PANES[pane];
    const s = useAppStore.getState();
    const start = s[key];
    // 其余可见分栏宽度合计(拖拽期间不变),据此收紧本栏上限,保住终端区 MAIN_MIN_W
    let others = 0;
    if (pane !== 'sidebar') others += s.sidebarWidth;
    if (pane !== 'filepanel' && !s.filePanelCollapsed) others += s.filePanelWidth;
    if (pane !== 'browser' && s.browserPanelOpen) others += s.browserPanelWidth;
    const effMax = Math.max(min, Math.min(max, window.innerWidth - others - MAIN_MIN_W));

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const w = clamp(start + dir * dx, min, effMax);
      useAppStore.getState().setPaneWidths({ [key]: w });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('pane-dragging');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.classList.add('pane-dragging');
  };

  return <div className="pane-handle" onMouseDown={onMouseDown} />;
}
