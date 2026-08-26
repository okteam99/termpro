import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { t } from '../../../shared/i18n';
import './SettingsPanel.css';

export type SettingsSection =
  | 'general'
  | 'language'
  | 'browser'
  | 'passwords'
  | 'remoteHosts';

export const SETTINGS_NAV: { id: SettingsSection; label(): string }[] = [
  { id: 'general', label: () => t('General') },
  { id: 'language', label: () => t('Language') },
  { id: 'browser', label: () => t('Browser Settings') },
  { id: 'passwords', label: () => t('Saved Passwords') },
  { id: 'remoteHosts', label: () => t('Remote Hosts') },
];

interface SettingsPanelProps {
  section: SettingsSection;
  onSection(next: SettingsSection): void;
  onClose(): void;
  children: ReactNode;
}

export function SettingsPanel({
  section,
  onSection,
  onClose,
  children,
}: SettingsPanelProps) {
  const active = SETTINGS_NAV.find((item) => item.id === section) ?? SETTINGS_NAV[0];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="settings-panel__backdrop"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('Settings')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="settings-panel__nav" aria-label={t('Settings')}>
          <div className="settings-panel__nav-title">{t('Settings')}</div>
          {SETTINGS_NAV.map((item) => (
            <button
              key={item.id}
              className={`settings-panel__nav-item${item.id === active.id ? ' settings-panel__nav-item--active' : ''}`}
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              onClick={() => onSection(item.id)}
            >
              {item.label()}
            </button>
          ))}
        </nav>
        <div className="settings-panel__main">
          <div className="settings-panel__header">
            <div>
              <div className="settings-panel__title">{active.label()}</div>
            </div>
            <button
              className="settings-panel__close"
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              onClick={onClose}
              title={t('Close')}
            >
              ×
            </button>
          </div>
          <div className="settings-panel__body">{children}</div>
        </div>
      </div>
    </div>
  );
}
