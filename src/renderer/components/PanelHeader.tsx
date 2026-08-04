import type { ReactNode } from 'react';
import './PanelHeader.css';

/** ✕ 关闭图标:feather 风格叉,不用文本 &times;(与 PanelHeaderButton 的描边粗细呼应) */
function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
      <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
    </svg>
  );
}

/** 头部右侧动作按钮:26×26,两个面板的「新窗口」「✕」等钮共用同一视觉/交互规格。 */
export function PanelHeaderButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="panel-header__btn"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/**
 * 浏览器/文件面板统一头部(OpenChamber 风格):左侧图标+标题,右侧动作按钮(可选)+✕关闭。
 * 整条兼作窗口拖拽区(-webkit-app-region: drag),按钮自身声明 no-drag 以保持可点击。
 */
export function PanelHeader({
  icon,
  title,
  onClose,
  closeTitle,
  actions,
}: {
  icon: ReactNode;
  title: string;
  onClose: () => void;
  closeTitle: string;
  actions?: ReactNode;
}) {
  return (
    <div className="panel-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <span className="panel-header__icon">{icon}</span>
      <span className="panel-header__title">{title}</span>
      <div className="panel-header__spacer" />
      {actions}
      <PanelHeaderButton onClick={onClose} title={closeTitle}>
        <CloseIcon />
      </PanelHeaderButton>
    </div>
  );
}
