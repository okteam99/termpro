// 浏览器设置弹层(用户指令 2026-07-20):把原来挂在 Settings 菜单里的「链接打开方式」
// 提出来,和新增的「内置浏览器默认打开方式」一起放进独立 modal——设置项会继续长,
// 左下角菜单不再承担设置面板的职责。
//
// 交互对齐既有 AboutModal / RemoteHostsPage:backdrop + card + Esc/遮罩/× 关闭,
// 焦点归还由挂载方(SettingsEntry)负责。选项即时生效(无保存按钮),随 ui 存档持久化。

import { useEffect } from 'react';
import './BrowserSettingsPage.css';
import { t } from '../../../shared/i18n';
import { useAppStore } from '../../state/store';
import type { BuiltinBrowserSurface, LinkBrowserMode } from '../../state/store';

// label/desc 用函数:t() 须在 render 期取词,模块级常量会被冻结在导入期语言
const LINK_MODE_OPTIONS: {
  mode: LinkBrowserMode;
  label(): string;
  desc(): string;
}[] = [
  {
    mode: 'builtin',
    label: () => t('Built-in browser'),
    desc: () => t('Terminal links open in OkWork’s own browser.'),
  },
  {
    mode: 'system',
    label: () => t('System browser'),
    desc: () => t('Terminal links open in your default browser.'),
  },
  {
    mode: 'builtinForRemote',
    label: () => t('Built-in for remote terminals only'),
    desc: () =>
      t(
        'Remote terminals use the built-in browser (localhost URLs are only reachable through it); local terminals use the system browser.',
      ),
  },
];

const SURFACE_OPTIONS: {
  surface: BuiltinBrowserSurface;
  label(): string;
  desc(): string;
}[] = [
  {
    surface: 'window',
    label: () => t('Separate window'),
    desc: () => t('The built-in browser opens as its own OkBrowser window.'),
  },
  {
    surface: 'pane',
    label: () => t('In the app panel'),
    desc: () => t('The built-in browser opens in the panel on the right of the main window.'),
  },
];

interface OptionRowProps {
  selected: boolean;
  label: string;
  desc: string;
  onSelect(): void;
}

function OptionRow({ selected, label, desc, onSelect }: OptionRowProps) {
  return (
    <button
      className={`browser-settings__opt${selected ? ' browser-settings__opt--selected' : ''}`}
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
    >
      <span className="browser-settings__opt-check" aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
      <span className="browser-settings__opt-text">
        <span className="browser-settings__opt-label">{label}</span>
        <span className="browser-settings__opt-desc">{desc}</span>
      </span>
    </button>
  );
}

export function BrowserSettingsPage({ onClose }: { onClose(): void }) {
  const linkBrowserMode = useAppStore((s) => s.linkBrowserMode);
  const setLinkBrowserMode = useAppStore((s) => s.setLinkBrowserMode);
  const builtinBrowserSurface = useAppStore((s) => s.builtinBrowserSurface);
  const setBuiltinBrowserSurface = useAppStore((s) => s.setBuiltinBrowserSurface);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="browser-settings__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="browser-settings__card"
        role="dialog"
        aria-modal="true"
        aria-label={t('Browser Settings')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="browser-settings__header">
          <div>
            <div className="browser-settings__title">{t('Browser Settings')}</div>
            <div className="browser-settings__subtitle">
              {t('⌘/Ctrl+click a terminal link always opens the system browser.')}
            </div>
          </div>
          <button className="browser-settings__close" onClick={onClose} title={t('Close')}>
            ×
          </button>
        </div>

        <div className="browser-settings__body">
          <div className="browser-settings__section">
            <div className="browser-settings__section-title" id="bs-link-mode">
              {t('Open links in')}
            </div>
            <div className="browser-settings__opts" role="radiogroup" aria-labelledby="bs-link-mode">
              {LINK_MODE_OPTIONS.map((o) => (
                <OptionRow
                  key={o.mode}
                  selected={o.mode === linkBrowserMode}
                  label={o.label()}
                  desc={o.desc()}
                  onSelect={() => setLinkBrowserMode(o.mode)}
                />
              ))}
            </div>
          </div>

          <div className="browser-settings__section">
            <div className="browser-settings__section-title" id="bs-surface">
              {t('Open the built-in browser in')}
            </div>
            <div className="browser-settings__opts" role="radiogroup" aria-labelledby="bs-surface">
              {SURFACE_OPTIONS.map((o) => (
                <OptionRow
                  key={o.surface}
                  selected={o.surface === builtinBrowserSurface}
                  label={o.label()}
                  desc={o.desc()}
                  onSelect={() => setBuiltinBrowserSurface(o.surface)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BrowserSettingsPage;
