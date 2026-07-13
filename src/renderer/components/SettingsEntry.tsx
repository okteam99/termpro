import { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import type { LocalePref } from '../../shared/i18n';
import { useAppStore } from '../state/store';
import { RemoteHostsPage } from './settings/RemoteHostsPage';

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

/** 远程机:简化机箱/服务器轮廓 */
function ServerIcon() {
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
      <rect x="1.5" y="2" width="11" height="4" rx="1" />
      <rect x="1.5" y="8" width="11" height="4" rx="1" />
      <circle cx="3.7" cy="4" r="0.55" fill="currentColor" stroke="none" />
      <circle cx="3.7" cy="10" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 语言:地球轮廓 + 经纬线 */
function GlobeIcon() {
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
      <circle cx="7" cy="7" r="5.5" />
      <ellipse cx="7" cy="7" rx="2.4" ry="5.5" />
      <line x1="1.5" y1="7" x2="12.5" y2="7" />
    </svg>
  );
}

/** 底部输入栏固定:外框 + 底部填充条 */
function BottomBarIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <rect x="1.8" y="2.5" width="11.4" height="10" rx="1.5" />
      <rect x="1.8" y="9.5" width="11.4" height="3" rx="0" fill="currentColor" stroke="none" />
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
  const versionText = version ? t('Version {version}', { version }) : t('Version unknown');

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
          title={t('Close')}
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

// 语言选项:label 用函数(t() 须在 render 期取词);语言名以本族语显示,有意不译
const LOCALE_OPTIONS: { pref: LocalePref; label(): string }[] = [
  { pref: 'system', label: () => t('System') },
  { pref: 'en', label: () => 'English' },
  { pref: 'zh-CN', label: () => '简体中文' },
];

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
  const [remoteHostsOpen, setRemoteHostsOpen] = useState(false);
  // 语言项的行内展开态(菜单关闭时复位)
  const [langOpen, setLangOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  // 持有打开弹窗前的聚焦元素,关闭时还原(AC-6 · About/Remote Hosts 弹层共用同一归还机制)
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const pinBottomBar = useAppStore((s) => s.pinBottomBar);
  const setPinBottomBar = useAppStore((s) => s.setPinBottomBar);
  const localePref = useAppStore((s) => s.localePref);
  const setLocalePref = useAppStore((s) => s.setLocalePref);

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

  // 菜单关闭 → 语言展开态复位(下次打开回到收起)
  useEffect(() => {
    if (!menuOpen) setLangOpen(false);
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

  function openRemoteHosts() {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    setMenuOpen(false);
    setRemoteHostsOpen(true);
  }

  function handleCloseRemoteHosts() {
    setRemoteHostsOpen(false);
    prevFocusRef.current?.focus();
    prevFocusRef.current = null;
  }

  return (
    <div className="settings-anchor" ref={anchorRef}>
      {menuOpen && (
        <div className="settings-menu" role="menu">
          <button
            className="settings-menu-item"
            role="menuitemcheckbox"
            aria-checked={pinBottomBar}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => setPinBottomBar(!pinBottomBar)}
            title={t(
              'Keep the bottom input bar pinned to the viewport when scrolling up through history (visible and typeable)',
            )}
          >
            <span className="settings-menu-icon">
              <BottomBarIcon />
            </span>
            <span className="settings-menu-label">{t('Pin bottom bar')}</span>
            <span
              className="settings-switch"
              data-on={pinBottomBar ? 'true' : 'false'}
              aria-hidden="true"
            >
              <span className="settings-switch-knob" />
            </span>
          </button>
          <button
            className="settings-menu-item"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={langOpen}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => setLangOpen((v) => !v)}
          >
            <span className="settings-menu-icon">
              <GlobeIcon />
            </span>
            <span className="settings-menu-label">{t('Language')}</span>
            <span className="settings-menu-value">
              {LOCALE_OPTIONS.find((o) => o.pref === localePref)?.label()}
            </span>
          </button>
          {langOpen &&
            LOCALE_OPTIONS.map((o) => (
              <button
                key={o.pref}
                className="settings-menu-item settings-menu-option"
                role="menuitemradio"
                aria-checked={o.pref === localePref}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onClick={() => setLocalePref(o.pref)}
              >
                <span className="settings-menu-option-check" aria-hidden="true">
                  {o.pref === localePref ? '✓' : ''}
                </span>
                <span className="settings-menu-label">{o.label()}</span>
              </button>
            ))}
          <button
            className="settings-menu-item"
            role="menuitem"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={openRemoteHosts}
          >
            <span className="settings-menu-icon">
              <ServerIcon />
            </span>
            <span className="settings-menu-label">{t('Remote Hosts')}</span>
          </button>
          <button
            className="settings-menu-item"
            role="menuitem"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={openAbout}
          >
            <span className="settings-menu-icon">
              <InfoIcon />
            </span>
            <span className="settings-menu-label">{t('About')}</span>
          </button>
        </div>
      )}

      <button
        className={`settings-entry${menuOpen ? ' settings-entry--open' : ''}`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => setMenuOpen((v) => !v)}
        title={t('Settings')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="settings-avatar">
          <PersonIcon />
        </span>
        <span className="settings-entry-label">{t('Settings')}</span>
        {devChannel && (
          <span
            className="sidebar-dev-badge"
            title={t('Dev-channel build, separate data directory, no update checks')}
          >
            {t('DEV')}
          </span>
        )}
        <span className="settings-entry-chevron">⌄</span>
      </button>

      {aboutOpen && <AboutModal version={version} onClose={handleCloseAbout} />}
      {remoteHostsOpen && <RemoteHostsPage onClose={handleCloseRemoteHosts} />}
    </div>
  );
}

export default SettingsEntry;
