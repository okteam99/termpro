import { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { useAppStore } from '../state/store';
import { BrowserSettingsPage } from './settings/BrowserSettingsPage';
import { LanguagePage } from './settings/LanguagePage';
import { RemoteHostsPage } from './settings/RemoteHostsPage';
import { SavedPasswordsPage } from './settings/SavedPasswordsPage';
import {
  SettingsPanel,
  type SettingsSection,
} from './settings/SettingsPanel';

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
  const versionText = version
    ? t('Version {version}', { version })
    : t('Version unknown');

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
        <img className="about-logo" src={appIconUrl} alt="OkWork" />
        <div className="about-name">OkWork</div>
        <div className="about-version">{versionText}</div>
      </div>
    </div>
  );
}

// ---- SettingsEntry --------------------------------------------------------

function LogoutIcon() {
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
      <path d="M6 2.5H3.2A1.2 1.2 0 0 0 2 3.7v6.6c0 .66.54 1.2 1.2 1.2H6" />
      <path d="M8.2 9.5 11 7 8.2 4.5" />
      <path d="M11 7H5.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.2" />
      <path d="M6.8 1.8h2.4l.5 1.5 1.4.6 1.4-.7 1.7 1.7-.7 1.4.6 1.4 1.5.5v2.4l-1.5.5-.6 1.4.7 1.4-1.7 1.7-1.4-.7-1.4.6-.5 1.5H6.8l-.5-1.5-1.4-.6-1.4.7-1.7-1.7.7-1.4-.6-1.4-1.5-.5V8.2l1.5-.5.6-1.4-.7-1.4 1.7-1.7 1.4.7 1.4-.6.5-1.5Z" />
    </svg>
  );
}

type Overlay =
  | { kind: 'none' }
  | { kind: 'about' }
  | { kind: 'panel'; section: SettingsSection };

interface SettingsEntryProps {
  devChannel?: boolean;
}

/**
 * 左下角账号入口:Login + 账号菜单(Settings / About / Logout)。
 * Settings 打开全局两栏面板;深链 openRemoteHostsPage 落到 Remote Hosts 分类。
 */
export function SettingsEntry({ devChannel }: SettingsEntryProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [logoutHint, setLogoutHint] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const pinBottomBar = useAppStore((s) => s.pinBottomBar);
  const setPinBottomBar = useAppStore((s) => s.setPinBottomBar);
  const browserProfiles = useAppStore((s) => s.browserProfiles);
  const remoteHostsPageNonce = useAppStore((s) => s.remoteHostsPageNonce);
  const prevRemoteHostsPageNonceRef = useRef(remoteHostsPageNonce);
  const version = window.okwork?.version ?? '';

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

  function captureFocus() {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
  }

  function openAbout() {
    captureFocus();
    setMenuOpen(false);
    setLogoutHint(false);
    setOverlay({ kind: 'about' });
  }

  function openPanel(section: SettingsSection) {
    captureFocus();
    setMenuOpen(false);
    setLogoutHint(false);
    setOverlay({ kind: 'panel', section });
  }

  function handleCloseOverlay() {
    setOverlay({ kind: 'none' });
    prevFocusRef.current?.focus();
    prevFocusRef.current = null;
  }

  useEffect(() => {
    if (remoteHostsPageNonce === prevRemoteHostsPageNonceRef.current) return;
    prevRemoteHostsPageNonceRef.current = remoteHostsPageNonce;
    captureFocus();
    setMenuOpen(false);
    setLogoutHint(false);
    setOverlay({ kind: 'panel', section: 'remoteHosts' });
  }, [remoteHostsPageNonce]);

  const panelSection =
    overlay.kind === 'panel' ? overlay.section : null;

  return (
    <div className="settings-anchor" ref={anchorRef}>
      {menuOpen && (
        <div className="settings-menu" role="menu">
          <button
            className="settings-menu-item"
            role="menuitem"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => openPanel('general')}
          >
            <span className="settings-menu-icon">
              <GearIcon />
            </span>
            <span className="settings-menu-label">{t('Settings')}</span>
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
          <div className="settings-menu-sep" />
          <button
            className="settings-menu-item"
            role="menuitem"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => setLogoutHint(true)}
          >
            <span className="settings-menu-icon">
              <LogoutIcon />
            </span>
            <span className="settings-menu-label">{t('Log out')}</span>
          </button>
          {logoutHint && (
            <span className="settings-menu-hint">{t('Not signed in')}</span>
          )}
        </div>
      )}

      <button
        className={`settings-entry${menuOpen ? ' settings-entry--open' : ''}`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => {
          setLogoutHint(false);
          setMenuOpen((v) => !v);
        }}
        title={t('Login')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="settings-avatar">
          <PersonIcon />
        </span>
        <span className="settings-entry-label">{t('Login')}</span>
        {devChannel && (
          <span
            className="sidebar-dev-badge"
            title={t(
              'Dev-channel build, separate data directory, no update checks',
            )}
          >
            {t('DEV')}
          </span>
        )}
        <span className="settings-entry-chevron">⌄</span>
      </button>

      {overlay.kind === 'about' && (
        <AboutModal version={version} onClose={handleCloseOverlay} />
      )}
      {panelSection && (
        <SettingsPanel
          section={panelSection}
          onSection={(next) => setOverlay({ kind: 'panel', section: next })}
          onClose={handleCloseOverlay}
        >
          {panelSection === 'general' && (
            <div>
              <div className="settings-panel__group-title">{t('Appearance')}</div>
              <button
                className="settings-panel__row"
                role="switch"
                aria-checked={pinBottomBar}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onClick={() => setPinBottomBar(!pinBottomBar)}
                title={t(
                  'Keep the bottom input bar pinned to the viewport when scrolling up through history (visible and typeable)',
                )}
              >
                <span>
                  <span className="settings-panel__row-label" style={{ display: 'block' }}>
                    {t('Pin bottom bar')}
                  </span>
                </span>
                <span
                  className="settings-switch"
                  data-on={pinBottomBar ? 'true' : 'false'}
                  aria-hidden="true"
                >
                  <span className="settings-switch-knob" />
                </span>
              </button>
            </div>
          )}
          {panelSection === 'language' && (
            <LanguagePage onClose={handleCloseOverlay} embedded />
          )}
          {panelSection === 'browser' && (
            <BrowserSettingsPage
              onClose={handleCloseOverlay}
              onOpenPasswords={() =>
                setOverlay({ kind: 'panel', section: 'passwords' })
              }
              embedded
            />
          )}
          {panelSection === 'passwords' && (
            <SavedPasswordsPage
              onBack={() => setOverlay({ kind: 'panel', section: 'browser' })}
              profiles={browserProfiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
              }))}
            />
          )}
          {panelSection === 'remoteHosts' && (
            <RemoteHostsPage
              onClose={handleCloseOverlay}
              onOpenBrowserProfiles={() =>
                setOverlay({ kind: 'panel', section: 'browser' })
              }
              embedded
            />
          )}
        </SettingsPanel>
      )}
    </div>
  );
}

export default SettingsEntry;
