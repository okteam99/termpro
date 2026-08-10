import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n';
import type {
  PasswordVaultErrorCode,
  TrustedPasswordContext,
  TrustedPasswordCopyResult,
  TrustedPasswordRevealResult,
} from '../../../shared/passwordVault';
import './TrustedPasswordWindow.css';

export interface TrustedPasswordWindowProps {
  /** Production omits these props and uses the isolated window.passwordTrusted bridge. */
  context?: TrustedPasswordContext | null;
  loading?: boolean;
  errorCode?: PasswordVaultErrorCode;
  onReveal?(): Promise<TrustedPasswordRevealResult>;
  onCopy?(): Promise<TrustedPasswordCopyResult>;
  onClose?(): void;
}

interface TrustedPasswordBridge {
  context(): Promise<TrustedPasswordContext>;
  reveal(): Promise<TrustedPasswordRevealResult>;
  copy(): Promise<TrustedPasswordCopyResult>;
}

function trustedPasswordBridge(): TrustedPasswordBridge | undefined {
  return (window as unknown as { passwordTrusted?: TrustedPasswordBridge }).passwordTrusted;
}

function errorCodeFrom(value: unknown): PasswordVaultErrorCode | undefined {
  const code = (value as { code?: unknown } | null)?.code;
  switch (code) {
    case 'VAULT_ENCRYPTION_UNAVAILABLE':
    case 'VAULT_CORRUPT':
    case 'VAULT_DECRYPT_FAILED':
    case 'VAULT_ENTRY_NOT_FOUND':
    case 'VAULT_FORBIDDEN':
    case 'VAULT_INVALID_INPUT':
    case 'VAULT_INSECURE_ORIGIN':
    case 'VAULT_IO_FAILED':
    case 'VAULT_PROFILE_INACTIVE':
      return code;
    default:
      return undefined;
  }
}

function trustedErrorMessage(code?: PasswordVaultErrorCode): string {
  switch (code) {
    case 'VAULT_ENCRYPTION_UNAVAILABLE':
      return t('System encryption is unavailable. The password was not released.');
    case 'VAULT_DECRYPT_FAILED':
      return t('This password could not be decrypted. It was not released.');
    case 'VAULT_ENTRY_NOT_FOUND':
      return t('This saved password no longer exists.');
    case 'VAULT_FORBIDDEN':
      return t('This window is no longer authorized to access the saved password.');
    default:
      return t('The password action could not be completed safely. Try again.');
  }
}

function secondsRemaining(deadline: number | null, now: number): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}

export function TrustedPasswordWindow({
  context: controlledContext,
  loading: controlledLoading,
  errorCode,
  onReveal,
  onCopy,
  onClose,
}: TrustedPasswordWindowProps) {
  const [loadedContext, setLoadedContext] = useState<TrustedPasswordContext | null>(null);
  const [loadedLoading, setLoadedLoading] = useState(controlledContext === undefined);
  const [loadedErrorCode, setLoadedErrorCode] = useState<PasswordVaultErrorCode>();
  const [password, setPassword] = useState<string | null>(null);
  const [hideAt, setHideAt] = useState<number | null>(null);
  const [clipboardExpiresAt, setClipboardExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busyAction, setBusyAction] = useState<'reveal' | 'copy' | null>(null);
  const [actionError, setActionError] = useState<PasswordVaultErrorCode | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const context = controlledContext === undefined ? loadedContext : controlledContext;
  const loading = controlledLoading ?? (controlledContext === undefined && loadedLoading);

  useEffect(() => {
    if (controlledContext !== undefined) return;
    let disposed = false;
    const bridge = trustedPasswordBridge();
    if (!bridge) {
      setLoadedLoading(false);
      setLoadedErrorCode('VAULT_FORBIDDEN');
      return;
    }
    bridge.context().then(
      (nextContext) => {
        if (disposed) return;
        setLoadedContext(nextContext);
        setLoadedLoading(false);
      },
      (error) => {
        if (disposed) return;
        setLoadedErrorCode(errorCodeFrom(error) ?? 'VAULT_FORBIDDEN');
        setLoadedLoading(false);
      },
    );
    return () => {
      disposed = true;
    };
  }, [controlledContext]);

  useEffect(() => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    if (hideAt === null || password === null) return;
    const delay = Math.max(0, hideAt - Date.now());
    hideTimerRef.current = window.setTimeout(() => {
      setPassword(null);
      setHideAt(null);
      hideTimerRef.current = null;
    }, delay);
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };
  }, [hideAt, password]);

  useEffect(() => {
    if (hideAt === null && clipboardExpiresAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [clipboardExpiresAt, hideAt]);

  useEffect(() => {
    if (clipboardExpiresAt !== null && clipboardExpiresAt <= now) {
      setClipboardExpiresAt(null);
    }
  }, [clipboardExpiresAt, now]);

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  async function revealPassword() {
    setBusyAction('reveal');
    setActionError(null);
    try {
      const reveal = onReveal ?? trustedPasswordBridge()?.reveal;
      if (!reveal) throw { code: 'VAULT_FORBIDDEN' };
      const result = await reveal();
      if (!result.ok || typeof result.password !== 'string') {
        setPassword(null);
        setHideAt(null);
        setActionError(result.code ?? 'VAULT_DECRYPT_FAILED');
        return;
      }
      const deadline = result.hideAt ?? Date.now() + (context?.revealDurationMs ?? 10_000);
      setNow(Date.now());
      setPassword(result.password);
      setHideAt(deadline);
    } catch (error) {
      setPassword(null);
      setHideAt(null);
      setActionError(errorCodeFrom(error) ?? 'VAULT_DECRYPT_FAILED');
    } finally {
      setBusyAction(null);
    }
  }

  async function copyPassword() {
    setBusyAction('copy');
    setActionError(null);
    try {
      const copy = onCopy ?? trustedPasswordBridge()?.copy;
      if (!copy) throw { code: 'VAULT_FORBIDDEN' };
      const result = await copy();
      if (!result.ok || !Number.isFinite(result.expiresAt)) {
        setClipboardExpiresAt(null);
        setActionError(result.code ?? 'VAULT_DECRYPT_FAILED');
        return;
      }
      setNow(Date.now());
      setClipboardExpiresAt(result.expiresAt!);
    } catch (error) {
      setClipboardExpiresAt(null);
      setActionError(errorCodeFrom(error) ?? 'VAULT_DECRYPT_FAILED');
    } finally {
      setBusyAction(null);
    }
  }

  const revealSeconds = secondsRemaining(hideAt, now);
  const clipboardSeconds = secondsRemaining(clipboardExpiresAt, now);
  const effectiveError = actionError ?? errorCode ?? loadedErrorCode;
  const close = onClose ?? (() => window.close());

  return (
    <main className="trusted-password-window">
      <header className="trusted-password-window__titlebar">
        <span>{t('Trusted password window')}</span>
        <button type="button" onClick={close} aria-label={t('Close')} title={t('Close')}>
          ×
        </button>
      </header>

      <div className="trusted-password-window__body">
        <div className="trusted-password-window__seal">
          {t('Isolated presentation · ordinary OkWork pages cannot trigger decryption')}
        </div>

        {loading ? (
          <div className="trusted-password-window__loading" role="status">
            {t('Loading saved password…')}
          </div>
        ) : context ? (
          <>
            <div className="trusted-password-window__meta">
              <strong>{context.metadata.origin}</strong>
              <span>
                {context.metadata.username} · {context.metadata.profileId}
              </span>
            </div>

            {effectiveError && (
              <div className="trusted-password-window__error" role="alert">
                {trustedErrorMessage(effectiveError)}
              </div>
            )}

            <section
              className="trusted-password-window__section"
              aria-labelledby="trusted-password-reveal-title"
            >
              <h2 id="trusted-password-reveal-title">{t('Reveal password')}</h2>
              <div
                className={`trusted-password-window__secret${
                  password === null ? ' trusted-password-window__secret--masked' : ''
                }`}
                aria-label={password === null ? t('Password masked') : t('Password revealed')}
              >
                {password ?? '••••••••••••••••'}
              </div>
              <p>
                {password === null
                  ? t('The password is hidden by default and is masked again after 10 seconds.')
                  : t('Visible only in this window. Masking again in {seconds} seconds.', {
                      seconds: revealSeconds,
                    })}
              </p>
              <button
                type="button"
                data-password-action="reveal"
                className="trusted-password-window__primary"
                disabled={busyAction !== null}
                onClick={() => void revealPassword()}
              >
                {busyAction === 'reveal'
                  ? t('Revealing…')
                  : password === null
                    ? t('Reveal password')
                    : t('Reveal for 10 seconds again')}
              </button>
            </section>

            <section
              className="trusted-password-window__section"
              aria-labelledby="trusted-password-copy-title"
            >
              <h2 id="trusted-password-copy-title">{t('Copy password')}</h2>
              <div className="trusted-password-window__warning">
                {t(
                  'Copying exports the password to the system clipboard. Other apps and ordinary OkWork pages may read it.',
                )}
              </div>
              <p>
                {clipboardExpiresAt === null
                  ? t(
                      'Only your explicit click in this window can decrypt and copy this password.',
                    )
                  : t(
                      'Copied. It will be cleared in {seconds} seconds only if the clipboard has not changed.',
                      { seconds: clipboardSeconds },
                    )}
              </p>
              <button
                type="button"
                data-password-action="copy"
                className="trusted-password-window__primary"
                disabled={busyAction !== null}
                onClick={() => void copyPassword()}
              >
                {busyAction === 'copy'
                  ? t('Copying…')
                  : clipboardExpiresAt === null
                    ? t('Copy to system clipboard')
                    : t('Copy again · reset 60 seconds')}
              </button>
              {clipboardExpiresAt !== null && (
                <div className="trusted-password-window__copy-status" role="status">
                  {t('Clipboard clear lease: {seconds} seconds remaining', {
                    seconds: clipboardSeconds,
                  })}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="trusted-password-window__error" role="alert">
            {trustedErrorMessage(errorCode)}
          </div>
        )}
      </div>

      <footer className="trusted-password-window__footer">
        <button type="button" className="trusted-password-window__done" onClick={close}>
          {t('Done')}
        </button>
      </footer>
    </main>
  );
}

export default TrustedPasswordWindow;
