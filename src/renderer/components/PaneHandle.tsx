import { useAppStore } from '../state/store';

const LIMITS = {
  left: { min: 180, max: 420 },
  right: { min: 220, max: 560 },
} as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 分栏拖拽手柄:left=侧栏右缘,right=文件面板左缘 */
export function PaneHandle({ side }: { side: 'left' | 'right' }) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const s = useAppStore.getState();
    const start = side === 'left' ? s.sidebarWidth : s.filePanelWidth;
    const { min, max } = LIMITS[side];

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const w = clamp(side === 'left' ? start + dx : start - dx, min, max);
      useAppStore
        .getState()
        .setPaneWidths(
          side === 'left' ? { sidebarWidth: w } : { filePanelWidth: w },
        );
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
