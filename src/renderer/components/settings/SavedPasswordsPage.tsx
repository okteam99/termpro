import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PasswordCredentialMetadata,
  PasswordMetadataSnapshot,
  PasswordVaultActionResult,
  PasswordVaultCapabilities,
  PasswordVaultErrorCode,
} from '../../../shared/passwordVault';
import { getLocale, t } from '../../../shared/i18n';
import './SavedPasswordsPage.css';

export interface SavedPasswordProfileOption {
  id: string;
  name: string;
}

export type SavedPasswordsPageState =
  | 'loading'
  | 'error'
  | 'ready'
  | 'unavailable';

export interface SavedPasswordsPageProps {
  /** Omit data props in production to load through the ordinary metadata-only bridge. */
  entries?: readonly PasswordCredentialMetadata[];
  profiles?: readonly SavedPasswordProfileOption[];
  state?: SavedPasswordsPageState;
  errorCode?: PasswordVaultErrorCode;
  onBack?(): void;
  onClose?(): void;
  onRetry?(): void | Promise<void>;
  onDelete?(entry: PasswordCredentialMetadata): void | Promise<void>;
  onOpenTrusted?(entry: PasswordCredentialMetadata): void | Promise<void>;
}

interface OrdinaryPasswordVaultBridge {
  capabilities(): Promise<PasswordVaultCapabilities>;
  listMetadata(query?: {
    profileId?: string;
    query?: string;
  }): Promise<PasswordMetadataSnapshot>;
  deleteEntry(payload: {
    profileId: string;
    id: string;
  }): Promise<PasswordVaultActionResult>;
  openTrusted(payload: {
    profileId: string;
    id: string;
  }): Promise<PasswordVaultActionResult | void>;
  onChanged?(callback: () => void): () => void;
}

function ordinaryPasswordVaultBridge():
  | OrdinaryPasswordVaultBridge
  | undefined {
  return (
    window as unknown as {
      okwork?: { passwordVault?: OrdinaryPasswordVaultBridge };
    }
  ).okwork?.passwordVault;
}

function knownErrorCode(value: unknown): PasswordVaultErrorCode | undefined {
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
    case 'VAULT_REMOTE_AUTHORITY_OFFLINE':
    case 'VAULT_REMOTE_TIMEOUT':
    case 'VAULT_MIGRATION_IN_PROGRESS':
    case 'VAULT_REMOTE_ENCRYPTION_UNAVAILABLE':
    case 'VAULT_REMOTE_CORRUPT':
    case 'VAULT_PROFILE_MISMATCH':
    case 'VAULT_REMOTE_INCOMPATIBLE':
      return code;
    default:
      return undefined;
  }
}

function safeErrorMessage(code?: PasswordVaultErrorCode): string {
  switch (code) {
    case 'VAULT_ENCRYPTION_UNAVAILABLE':
      return t(
        'System encryption is unavailable. No passwords were returned or changed.',
      );
    case 'VAULT_CORRUPT':
      return t(
        'The local vault could not be read safely. No passwords were returned or changed.',
      );
    case 'VAULT_IO_FAILED':
      return t('The local vault could not be opened. Try again.');
    case 'VAULT_REMOTE_AUTHORITY_OFFLINE':
      return t(
        'The Remote Host storing this Profile is offline. Reconnect it and retry.',
      );
    case 'VAULT_REMOTE_TIMEOUT':
      return t(
        'The Remote Host did not respond. Check the connection and retry.',
      );
    case 'VAULT_MIGRATION_IN_PROGRESS':
      return t('Password changes are paused while this Profile is moving.');
    case 'VAULT_REMOTE_ENCRYPTION_UNAVAILABLE':
    case 'VAULT_REMOTE_CORRUPT':
    case 'VAULT_PROFILE_MISMATCH':
      return t(
        'The remote password storage could not be opened safely. No passwords were returned.',
      );
    case 'VAULT_REMOTE_INCOMPATIBLE':
      return t('Update the Remote Host before using password storage.');
    default:
      return t(
        'The local vault is temporarily unavailable. No passwords were returned or changed.',
      );
  }
}

function formatLastUsed(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return t('Unknown');
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function siteInitial(origin: string): string {
  try {
    const hostname = new URL(origin).hostname;
    return hostname.charAt(0).toUpperCase() || '•';
  } catch {
    return '•';
  }
}

function LoadingList() {
  return (
    <div
      className="saved-passwords__list saved-passwords__list--loading"
      role="status"
      aria-label={t('Loading saved passwords')}
    >
      {[0, 1, 2].map((row) => (
        <div className="saved-passwords__skeleton" key={row} aria-hidden="true">
          <i />
          <span />
          <b />
        </div>
      ))}
      <span className="saved-passwords__sr-only">
        {t('Loading saved passwords')}
      </span>
    </div>
  );
}

export function SavedPasswordsPage({
  entries: controlledEntries,
  profiles = [],
  state: controlledState,
  errorCode,
  onBack,
  onClose,
  onRetry,
  onDelete,
  onOpenTrusted,
}: SavedPasswordsPageProps) {
  const [loadedEntries, setLoadedEntries] = useState<
    PasswordCredentialMetadata[]
  >([]);
  const [loadedState, setLoadedState] =
    useState<SavedPasswordsPageState>('loading');
  const [loadedErrorCode, setLoadedErrorCode] =
    useState<PasswordVaultErrorCode>();
  const [unavailableProfiles, setUnavailableProfiles] = useState<
    PasswordMetadataSnapshot['unavailableProfiles']
  >([]);
  const [query, setQuery] = useState('');
  const [profileId, setProfileId] = useState('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const entries = controlledEntries ?? loadedEntries;
  const state = controlledState ?? loadedState;
  const effectiveErrorCode = errorCode ?? loadedErrorCode;

  const reload = useCallback(async (showLoading = true) => {
    const bridge = ordinaryPasswordVaultBridge();
    if (!bridge) {
      setLoadedState('error');
      setLoadedErrorCode(undefined);
      return;
    }
    if (showLoading) setLoadedState('loading');
    setLoadedErrorCode(undefined);
    try {
      const snapshot = await bridge.listMetadata();
      const unavailableProfileIds = new Set(
        snapshot.unavailableProfiles.map((profile) => profile.profileId),
      );
      // Defense in depth: even a stale/older main must not surface cached rows for an
      // unavailable remote Profile.
      const availableEntries = snapshot.entries.filter(
        (entry) => !unavailableProfileIds.has(entry.profileId),
      );
      setLoadedEntries(availableEntries);
      setUnavailableProfiles(snapshot.unavailableProfiles);
      setLoadedState(
        availableEntries.length === 0 && snapshot.unavailableProfiles.length > 0
          ? 'unavailable'
          : 'ready',
      );
      setLoadedErrorCode(snapshot.unavailableProfiles[0]?.code);
    } catch (error) {
      setLoadedEntries([]);
      setUnavailableProfiles([]);
      setLoadedErrorCode(knownErrorCode(error));
      setLoadedState('error');
    }
  }, []);

  useEffect(() => {
    if (controlledEntries !== undefined || controlledState !== undefined)
      return;
    void reload();
    return ordinaryPasswordVaultBridge()?.onChanged?.(() => void reload(false));
  }, [controlledEntries, controlledState, reload]);

  const profileNames = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile.name])),
    [profiles],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (profileId !== 'all' && entry.profileId !== profileId) return false;
        if (!normalizedQuery) return true;
        const profileName =
          profileNames.get(entry.profileId) ?? entry.profileId;
        return `${entry.origin} ${entry.username} ${profileName}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      }),
    [entries, normalizedQuery, profileId, profileNames],
  );

  const controlsDisabled = state === 'loading' || state === 'error';
  const trustedDisabled = state === 'unavailable';

  async function confirmDelete(entry: PasswordCredentialMetadata) {
    setBusyId(entry.id);
    setActionError(null);
    try {
      if (onDelete) {
        await onDelete(entry);
      } else {
        const result = await ordinaryPasswordVaultBridge()?.deleteEntry({
          profileId: entry.profileId,
          id: entry.id,
        });
        if (!result?.ok) throw result;
        await reload(false);
      }
      setDeleteId(null);
    } catch {
      setActionError(
        t(
          'Could not delete this saved password. The entry was kept; try again.',
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function openTrusted(entry: PasswordCredentialMetadata) {
    setBusyId(entry.id);
    setActionError(null);
    try {
      if (onOpenTrusted) {
        await onOpenTrusted(entry);
      } else {
        const bridge = ordinaryPasswordVaultBridge();
        if (!bridge) throw new Error('bridge unavailable');
        const result = await bridge.openTrusted({
          profileId: entry.profileId,
          id: entry.id,
        });
        if (result && !result.ok) throw result;
      }
    } catch {
      setActionError(
        t('Could not open the trusted password window. Try again.'),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      className="saved-passwords"
      aria-labelledby="saved-passwords-title"
    >
      <header className="saved-passwords__header">
        <div>
          {onBack && (
            <button
              type="button"
              className="saved-passwords__back"
              onClick={onBack}
            >
              ‹ {t('Browser Settings')}
            </button>
          )}
          <h1 id="saved-passwords-title">{t('Saved Passwords')}</h1>
          <p>
            {t(
              'This list contains metadata only. Passwords stay encrypted and bound to an exact site and Profile.',
            )}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            className="saved-passwords__close"
            onClick={onClose}
            aria-label={t('Close')}
            title={t('Close')}
          >
            ×
          </button>
        )}
      </header>

      <div className="saved-passwords__body">
        {state === 'unavailable' && (
          <div
            className="saved-passwords__scope saved-passwords__scope--danger"
            role="alert"
          >
            <span>
              <strong>{t('Password protection is unavailable')}</strong>
              <small>
                {t(
                  'The selected password storage is unavailable. OkWork will not save, fill, reveal or copy passwords until it reconnects.',
                )}
              </small>
            </span>
            <b>{t('Disabled')}</b>
          </div>
        )}

        {state === 'ready' && unavailableProfiles.length > 0 && (
          <div className="saved-passwords__error" role="alert">
            <strong>
              {t('Some password storage locations are unavailable')}
            </strong>
            <span>
              {t(
                'Unavailable Profiles are hidden. Reconnect their Remote Host, then retry.',
              )}
            </span>
            <button type="button" onClick={() => void reload()}>
              {t('Retry')}
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="saved-passwords__error" role="alert">
            <strong>{t('Could not load saved passwords')}</strong>
            <span>{safeErrorMessage(effectiveErrorCode)}</span>
            {(onRetry || controlledState === undefined) && (
              <button
                type="button"
                onClick={() => void (onRetry?.() ?? reload())}
              >
                {t('Retry')}
              </button>
            )}
          </div>
        )}

        {actionError && (
          <div className="saved-passwords__action-error" role="alert">
            {actionError}
          </div>
        )}

        <div className="saved-passwords__toolbar">
          <label className="saved-passwords__search">
            <span className="saved-passwords__sr-only">
              {t('Search saved passwords')}
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search site, username or Profile')}
              disabled={controlsDisabled}
            />
          </label>
          <label className="saved-passwords__filter">
            <span className="saved-passwords__sr-only">
              {t('Filter by Profile')}
            </span>
            <select
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              disabled={controlsDisabled}
              aria-label={t('Filter by Profile')}
            >
              <option value="all">{t('All Profiles')}</option>
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <span className="saved-passwords__local-badge">
            {t('Password storage follows each Profile')}
          </span>
        </div>

        {state === 'loading' ? (
          <LoadingList />
        ) : filteredEntries.length ? (
          <div
            className={`saved-passwords__list${
              state === 'error' ? ' saved-passwords__list--disabled' : ''
            }`}
          >
            {filteredEntries.map((entry) => {
              const profileName =
                profileNames.get(entry.profileId) ?? entry.profileId;
              const isBusy = busyId === entry.id;
              return (
                <article className="saved-passwords__row" key={entry.id}>
                  <span
                    className="saved-passwords__site-icon"
                    aria-hidden="true"
                  >
                    {siteInitial(entry.origin)}
                  </span>
                  <span className="saved-passwords__identity">
                    <strong>{entry.origin}</strong>
                    <span>{entry.username}</span>
                  </span>
                  <span className="saved-passwords__profile">
                    {profileName}
                  </span>
                  <span
                    className="saved-passwords__masked"
                    aria-label={t('Password masked')}
                  >
                    ••••••••
                  </span>
                  <span className="saved-passwords__used">
                    {formatLastUsed(entry.lastUsedAt)}
                  </span>
                  {deleteId === entry.id ? (
                    <span className="saved-passwords__confirm">
                      <span>{t('Delete this saved password?')}</span>
                      <button
                        type="button"
                        className="saved-passwords__danger"
                        disabled={isBusy}
                        onClick={() => void confirmDelete(entry)}
                      >
                        {isBusy ? t('Deleting…') : t('Delete')}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setDeleteId(null)}
                      >
                        {t('Cancel')}
                      </button>
                    </span>
                  ) : (
                    <span className="saved-passwords__actions">
                      <button
                        type="button"
                        disabled={trustedDisabled || isBusy}
                        onClick={() => void openTrusted(entry)}
                      >
                        {isBusy ? t('Opening…') : t('Open trusted window…')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(entry.id)}
                      >
                        {t('Delete')}
                      </button>
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="saved-passwords__empty" role="status">
            <span className="saved-passwords__empty-icon" aria-hidden="true">
              ◇
            </span>
            <strong>
              {entries.length
                ? t('No matching saved passwords')
                : t('No saved passwords yet')}
            </strong>
            <span>
              {entries.length
                ? t('Try another site, username or Profile filter.')
                : t(
                    'A password appears here after a confirmed sign-in in OkBrowser.',
                  )}
            </span>
          </div>
        )}

        <div
          className="saved-passwords__disclosures"
          aria-label={t('Password safety notes')}
        >
          <div>
            <strong>{t('After filling a web page')}</strong>
            <span>
              {t(
                'The website and connected OkBrowser Agents can read values in the page DOM.',
              )}
            </span>
          </div>
          <div>
            <strong>{t('After copying to the clipboard')}</strong>
            <span>
              {t(
                'Other apps and ordinary OkWork pages may read the exported value until it is cleared.',
              )}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default SavedPasswordsPage;
