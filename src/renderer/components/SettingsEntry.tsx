import { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import type { LocalePref } from '../../shared/i18n';
import { useAppStore } from '../state/store';
import { BrowserSettingsPage } from './settings/BrowserSettingsPage';
import { LanguagePage } from './settings/LanguagePage';
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
        <img className="about-logo" src={appIconUrl} alt="OkWork" />
        <div className="about-name">OkWork</div>
        <div className="about-version">{versionText}</div>
      </div>
    </div>
  );
}

// ---- SettingsEntry --------------------------------------------------------

// 菜单里各设置项的当前值(右侧灰字);语言名以本族语显示,有意不译。
// t() 须在 render 期取词,故走函数而非模块级常量。
function localePrefLabel(pref: LocalePref): string {
  if (pref === 'en') return 'English';
  if (pref === 'zh-CN') return '简体中文';
  return t('System');
}

/** 菜单项挂载的弹层(互斥单选;null = 都不开)。设置项一律独立 modal,
 *  不再行内展开(用户指令 2026-07-20)。 */
type SettingsPage = 'language' | 'browser' | 'remoteHosts' | 'about';

/** 浏览器设置:指针点击链接轮廓 */
function LinkIcon() {
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
      <path d="M5.8 8.2 8.6 5.4" />
      <path d="M6.9 3.9 8 2.8a2.3 2.3 0 0 1 3.2 3.2L10.1 7.1" />
      <path d="M7.5 10.1 6.4 11.2a2.3 2.3 0 0 1-3.2-3.2L4.3 6.9" />
    </svg>
  );
}

interface SettingsEntryProps {
  devChannel?: boolean;
}

/**
 * 左下角用户信息入口:头像占位 + Settings + 上弹菜单(仅 About)→ About 弹版本。
 * devChannel / version 从 window.okwork 读取(安全读,bridge 缺失不抛错)。
 */
export function SettingsEntry({ devChannel }: SettingsEntryProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState<SettingsPage | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  // 持有打开弹窗前的聚焦元素,关闭时还原(AC-6 · 各设置弹层共用同一归还机制)
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const pinBottomBar = useAppStore((s) => s.pinBottomBar);
  const setPinBottomBar = useAppStore((s) => s.setPinBottomBar);
  const localePref = useAppStore((s) => s.localePref);
  const remoteHostsPageNonce = useAppStore((s) => s.remoteHostsPageNonce);
  // 首次挂载读到的 nonce 是「初值」,不算触发——只有后续自增(store.openRemoteHostsPage,
  // 如「host 过旧」死胡同提示引导)才应该弹开该页
  const prevRemoteHostsPageNonceRef = useRef(remoteHostsPageNonce);

  // 安全读 version:bridge 缺失或 version 空都回退 ""
  const version = window.okwork?.version ?? '';

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

  function openPage(next: SettingsPage) {
    // 焦点返还(AC-6):打开弹窗前捕获当前聚焦元素
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    setMenuOpen(false); // 菜单先关
    setPage(next);      // 弹窗后开(两态不共存)
  }

  function handleClosePage() {
    setPage(null);
    prevFocusRef.current?.focus();
    prevFocusRef.current = null;
  }

  // 远程机页深链打开信号(store.openRemoteHostsPage,如 FilePanel/terminalRegistry 里
  // 「host 过旧」死胡同提示的引导入口):nonce 变化(非初值)→ 复用 openPage,走同一套
  // 焦点捕获/菜单收起路径,不绕过焦点归还机制。
  useEffect(() => {
    if (remoteHostsPageNonce === prevRemoteHostsPageNonceRef.current) return;
    prevRemoteHostsPageNonceRef.current = remoteHostsPageNonce;
    openPage('remoteHosts');
  }, [remoteHostsPageNonce]);

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
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => openPage('language')}
          >
            <span className="settings-menu-icon">
              <GlobeIcon />
            </span>
            <span className="settings-menu-label">{t('Language')}</span>
            <span className="settings-menu-value">{localePrefLabel(localePref)}</span>
          </button>
          <button
            className="settings-menu-item"
            role="menuitem"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => openPage('browser')}
            title={t('Where terminal links open, and how the built-in browser opens.')}
          >
            <span className="settings-menu-icon">
              <LinkIcon />
            </span>
            <span className="settings-menu-label">{t('Browser Settings')}</span>
          </button>
          <button
            className="settings-menu-item"
            role="menuitem"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => openPage('remoteHosts')}
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
            onClick={() => openPage('about')}
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

      {page === 'about' && <AboutModal version={version} onClose={handleClosePage} />}
      {page === 'language' && <LanguagePage onClose={handleClosePage} />}
      {page === 'browser' && <BrowserSettingsPage onClose={handleClosePage} />}
      {page === 'remoteHosts' && <RemoteHostsPage onClose={handleClosePage} />}
    </div>
  );
}

export default SettingsEntry;
