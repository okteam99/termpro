import type { PasswordGuestStatus } from '../../../shared/passwordVault';
import { t } from '../../../shared/i18n';
import './PasswordStatusBar.css';

export interface PasswordStatusBarProps {
  status: PasswordGuestStatus;
  profileName?: string;
  onChooseAccount?(): void;
  onManagePasswords?(): void;
}

interface StatusPresentation {
  icon: string;
  title: string;
  detail: string;
  tone: 'positive' | 'neutral' | 'warning' | 'danger';
}

function presentation(status: PasswordGuestStatus, profileName: string): StatusPresentation | null {
  const username = status.selectedUsername?.trim();
  switch (status.kind) {
    case 'idle':
      return null;
    case 'filled':
      return {
        icon: '✓',
        title: t('Password filled from {profile}', { profile: profileName }),
        detail: username ? t('Account: {username}', { username }) : t('Saved account filled'),
        tone: 'positive',
      };
    case 'multiple':
      return {
        icon: String(status.usernames?.length ?? 2),
        title: t('A saved account was selected'),
        detail: username
          ? t('{username} · more accounts are available', { username })
          : t('More saved accounts are available for this site'),
        tone: 'positive',
      };
    case 'saved':
      return {
        icon: '✓',
        title: t('New password saved automatically'),
        detail: t('{profile} · encrypted on this device', { profile: profileName }),
        tone: 'positive',
      };
    case 'updated':
      return {
        icon: '✓',
        title: t('Saved password updated'),
        detail: t('The previous password was replaced only after a confirmed sign-in.'),
        tone: 'positive',
      };
    case 'auth_failed':
      return {
        icon: '!',
        title: t('Sign-in failed · saved password unchanged'),
        detail: t('Correct the password and try again.'),
        tone: 'danger',
      };
    case 'uncertain':
      return {
        icon: '?',
        title: t('Could not confirm sign-in · password not saved'),
        detail: t('Any existing saved password remains unchanged.'),
        tone: 'warning',
      };
    case 'unavailable':
      return {
        icon: '!',
        title: t('Password protection is unavailable'),
        detail: t('OkWork will not save, fill, reveal or copy passwords.'),
        tone: 'danger',
      };
    case 'insecure_origin':
      return {
        icon: '!',
        title: t('Password features are disabled on this HTTP page'),
        detail: t('Use HTTPS or loopback HTTP to save and fill passwords.'),
        tone: 'danger',
      };
  }
}

export function PasswordStatusBar({
  status,
  profileName = t('current Profile'),
  onChooseAccount,
  onManagePasswords,
}: PasswordStatusBarProps) {
  const content = presentation(status, profileName);
  const role = content?.tone === 'danger' ? 'alert' : 'status';

  return (
    <div className={`password-status${content ? '' : ' password-status--idle'}`}>
      {content && (
        <div
          className={`password-status__notice password-status__notice--${content.tone}`}
          role={role}
          aria-live={role === 'alert' ? 'assertive' : 'polite'}
        >
          <span className="password-status__icon" aria-hidden="true">
            {content.icon}
          </span>
          <span className="password-status__copy">
            <strong>{content.title}</strong>
            <small>{content.detail}</small>
          </span>
          {status.kind === 'multiple' && onChooseAccount && (
            <button type="button" onClick={onChooseAccount}>
              {t('Switch account')}
            </button>
          )}
          {onManagePasswords && (
            <button type="button" onClick={onManagePasswords}>
              {t('Manage')}
            </button>
          )}
        </div>
      )}

      <div className="password-status__disclosure">
        <span className="password-status__vault">{t('Password vault · this device')}</span>
        <span className="password-status__agent">
          {t('Filled values are readable by this page and connected OkBrowser Agents')}
        </span>
        <span className="password-status__clipboard">
          {t(
            'After an explicit copy, other local apps and ordinary OkWork pages may read the password from the system clipboard; OkWork clears it after 60 seconds only if unchanged.',
          )}
        </span>
      </div>
    </div>
  );
}

export default PasswordStatusBar;
