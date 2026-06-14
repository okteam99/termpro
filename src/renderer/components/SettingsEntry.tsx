import { useEffect, useRef, useState } from 'react';

// 应用图标(About 弹窗 logo)· Vite 把资源打进 renderer bundle(dev + 打包均生效)
const appIconUrl = new URL('../../../assets/icon.png', import.meta.url).href;

// ---- Icons ----------------------------------------------------------------

function PersonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="4.3" r="2.4" />
      <path d="M2.5 12 C2.5 9.3 4.5 8 7 8 C9.5 8 11.5 9.3 11.5 12" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="7.5" r="6" />
      <line x1="7.5" y1="7" x2="7.5" y2="10.5" />
      <circle cx="7.5" cy="4.7" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ---- AboutModal -----------------------------------------------------------

interface AboutModalProps {
  version: string;
  onClose(): void;
}

/** About 弹窗:展示应用名 + 当前版本(version 为空 → 「版本未知」)。Esc / 遮罩 / × 关闭。 */
export function AboutModal({ version, onClose }: AboutModalProps) {
  const versionText = version ? `版本 ${version}` : '版本未知';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="about-backdrop"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="about-card" onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="about-close"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={onClose}
          title="关闭"
        >
          ×
        </button>
        <img className="about-logo" src={appIconUrl} alt="TermPro" />
        <div className="about-name">TermPro</div>
        <div className="about-version">{versionText}</div>
      </div>
    </div>
  );
}

// ---- SettingsEntry --------------------------------------------------------

interface SettingsEntryProps {
  devChannel?: boolean;
}

/**
 * 左下角用户信息入口:头像占位 + Settings + 上弹菜单(仅 About)→ About 弹版本。
 * devChannel / version 从 window.termpro 读取(安全读,bridge 缺失不抛错)。
 */
export function SettingsEntry({ devChannel }: SettingsEntryProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  // 持有打开弹窗前的聚焦元素,关闭时还原(AC-6)
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // 安全读 version:bridge 缺失或 version 空都回退 ""
  const version = window.termpro?.version ?? '';

  // 菜单:点击外部 / Esc 关闭(对齐 NotificationCenter 交互)
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function openAbout() {
    // 焦点返还(AC-6):打开弹窗前捕获当前聚焦元素
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    setMenuOpen(false);   // 菜单先关
    setAboutOpen(true);   // 弹窗后开(两态不共存)
  }

  function handleCloseAbout() {
    setAboutOpen(false);
    prevFocusRef.current?.focus();
    prevFocusRef.current = null;
  }

  return (
    <div className="settings-anchor" ref={anchorRef}>
      {menuOpen && (
        <div className="settings-menu" role="menu">
          <button
            className="settings-menu-item"
            role="menuitem"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={openAbout}
          >
            <span className="settings-menu-icon">
              <InfoIcon />
            </span>
            <span className="settings-menu-label">About</span>
          </button>
        </div>
      )}

      <button
        className={`settings-entry${menuOpen ? ' settings-entry--open' : ''}`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => setMenuOpen((v) => !v)}
        title="Settings"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="settings-avatar">
          <PersonIcon />
        </span>
        <span className="settings-entry-label">Settings</span>
        {devChannel && (
          <span
            className="sidebar-dev-badge"
            title="开发渠道构建,独立数据目录,不检查更新"
          >
            DEV
          </span>
        )}
        <span className="settings-entry-chevron">⌄</span>
      </button>

      {aboutOpen && <AboutModal version={version} onClose={handleCloseAbout} />}
    </div>
  );
}

export default SettingsEntry;
