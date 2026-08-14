// 浏览器面板的密码状态入口(用户指令 2026-08-14:「这些提示太多太乱,不该在这个位置展示」)。
//
// 旧形态是地址栏下方一叠常驻横幅(密码状态 + 存储位置 + 登录连续性),把网页内容一路顶下去。
// 现在收拢成导航行里的一枚 🔑 胶囊:状态只用颜色点表达,详情点开才看。
// 🔴 收进弹层不等于不播报:视觉横幅没了,但状态变化仍经视觉隐藏的 live region 播报
// (danger 用 assertive),否则读屏用户会彻底收不到「登录失败/保险箱不可用」这类必须知情的事。

import { useEffect, useRef, useState } from 'react';
import type { LoginContinuityState } from '../../../shared/browserProfile';
import type { PasswordGuestStatus } from '../../../shared/passwordVault';
import { t } from '../../../shared/i18n';
import './PasswordChip.css';

export type ChipTone = 'positive' | 'neutral' | 'warning' | 'danger';

export interface PasswordChipProps {
  status: PasswordGuestStatus;
  profileName?: string;
  storageLabel?: string;
  storageUnavailable?: boolean;
  /** 登录连续性一行(状态文案由调用方按 profile 快照算好);null = 不显示 */
  continuity?: { tone: ChipTone; text: string } | null;
  onChooseAccount?(): void;
  onManagePasswords?(): void;
}

interface StatusPresentation {
  icon: string;
  title: string;
  detail: string;
  tone: ChipTone;
}

function presentation(
  status: PasswordGuestStatus,
  profileName: string,
  storageLabel: string,
  storageUnavailable: boolean,
): StatusPresentation | null {
  const username = status.selectedUsername?.trim();
  switch (status.kind) {
    case 'idle':
      return null;
    case 'filled':
      return {
        icon: '✓',
        title: t('Password filled from {profile}', { profile: profileName }),
        detail: username
          ? t('Account: {username}', { username })
          : t('Saved account filled'),
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
        detail: t('{profile} · stored in {location}', {
          profile: profileName,
          location: storageLabel,
        }),
        tone: 'positive',
      };
    case 'updated':
      return {
        icon: '✓',
        title: t('Saved password updated'),
        detail: t(
          'The previous password was replaced only after a confirmed sign-in.',
        ),
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
        detail: storageUnavailable
          ? t(
              'The page session may continue, but password save and fill are paused.',
            )
          : t('OkWork will not save, fill, reveal or copy passwords.'),
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

/** 胶囊色调:密码状态优先;无密码状态时只有「需要注意」的连续性才点亮(进度/成功不点) */
export function chipTone(
  status: StatusPresentation | null,
  continuity?: { tone: ChipTone } | null,
): ChipTone {
  if (status) return status.tone;
  if (continuity?.tone === 'warning' || continuity?.tone === 'danger') {
    return continuity.tone;
  }
  return 'neutral';
}

/**
 * 登录连续性 → 弹层里的一行(原来是地址栏下方另一条常驻横幅)。
 * 成功/进行中只是信息(不点亮胶囊);paused/moved/host_upgrade/attention 需要用户处理。
 */
export function continuityRow(
  state: LoginContinuityState | undefined,
): { tone: ChipTone; text: string } | null {
  switch (state) {
    case undefined:
    case 'not_available':
      return null;
    case 'synced':
      return { tone: 'positive', text: t('Login status restored') };
    case 'hydrating':
    case 'syncing':
      return { tone: 'neutral', text: t('Restoring login status…') };
    case 'paused':
    case 'moved':
      return { tone: 'warning', text: t('Login continuity is paused') };
    case 'host_upgrade':
      return {
        tone: 'warning',
        text: t('Update the Remote Host to restore login status'),
      };
    default:
      return { tone: 'warning', text: t('Login continuity needs attention') };
  }
}

export function PasswordChip({
  status,
  profileName = t('current Profile'),
  storageLabel = t('This device'),
  storageUnavailable = false,
  continuity = null,
  onChooseAccount,
  onManagePasswords,
}: PasswordChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const content = presentation(
    status,
    profileName,
    storageLabel,
    storageUnavailable,
  );
  const tone = chipTone(content, continuity);

  // 打开期间:外部点击 / Esc 关闭(与出口选择器同惯例)
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const summary = content
    ? `${content.title} · ${content.detail}`
    : `${t('Password storage')}: ${storageLabel}`;

  return (
    <div className="password-chip" ref={rootRef}>
      <button
        type="button"
        className={`password-chip__button password-chip__button--${tone}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={summary}
        title={summary}
      >
        <span className="password-chip__key" aria-hidden="true">
          🔑
        </span>
        {tone !== 'neutral' && (
          <span
            className={`password-chip__dot password-chip__dot--${tone}`}
            aria-hidden="true"
          />
        )}
      </button>

      {/* 视觉隐藏的播报口:横幅撤了,读屏仍要收到状态变化 */}
      <span
        className="password-chip__live"
        role="status"
        aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      >
        {content ? summary : ''}
      </span>

      {open && (
        <div
          className="password-chip__popover"
          role="dialog"
          aria-label={t('Password storage')}
        >
          {content && (
            <div
              className={`password-chip__notice password-chip__notice--${content.tone}`}
            >
              <span className="password-chip__icon" aria-hidden="true">
                {content.icon}
              </span>
              <span className="password-chip__copy">
                <strong>{content.title}</strong>
                <small>{content.detail}</small>
              </span>
            </div>
          )}
          <div className="password-chip__row">
            {t('Password storage')}: {storageLabel}
            {storageUnavailable ? ` · ${t('Offline')}` : ''}
          </div>
          {continuity && (
            <div
              className={`password-chip__row password-chip__row--${continuity.tone}`}
            >
              {continuity.text}
            </div>
          )}
          {(onChooseAccount || onManagePasswords) && (
            <div className="password-chip__actions">
              {status.kind === 'multiple' && onChooseAccount && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChooseAccount();
                  }}
                >
                  {t('Switch account')}
                </button>
              )}
              {onManagePasswords && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onManagePasswords();
                  }}
                >
                  {t('Manage')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PasswordChip;
