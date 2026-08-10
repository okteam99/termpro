// 浏览器 Profile 管理区块(BrowserSettingsPage 追加区块 · 用户指令 2026-07-21):
// 展示内置默认 profile(虚拟实体,恒在列表首行,无编辑/删除)+ 自定义 profile 列表,
// 支持增/改/删。列表数据来自 store 镜像(profilesSync 服务已订阅 main 的
// browserProfile:changed 推送,增删改后自动刷新,本组件无需手动 list()/refresh)。

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import './BrowserProfilesSection.css';
import { t } from '../../../shared/i18n';
import { useAppStore } from '../../state/store';
import { randomUserAgent } from './randomUserAgent';
import type {
  BrowserProfile,
  BrowserProfileSummary,
  ProfileStorageChangePlan,
  ProfileStorageRef,
} from '../../../shared/browserProfile';
import { DEFAULT_PROFILE_ID } from '../../../shared/browserProfile';
import type { RemoteHostConfig, RemoteStage } from '../../../shared/remoteHost';

interface FormValues {
  name: string;
  userAgent: string;
}

const EMPTY_FORM: FormValues = { name: '', userAgent: '' };

function sameStorageRef(
  left: ProfileStorageRef,
  right: ProfileStorageRef,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'local' ||
      (right.kind === 'remote' && left.hostId === right.hostId))
  );
}

export function BrowserProfilesSection() {
  const profiles = useAppStore((s) => s.browserProfiles);
  const displayProfiles = useMemo<BrowserProfileSummary[]>(() => {
    if (profiles.some((profile) => profile.id === DEFAULT_PROFILE_ID))
      return profiles;
    return [
      {
        id: DEFAULT_PROFILE_ID,
        name: t('OkWork (built-in)'),
        createdAt: 0,
        storage: { kind: 'local' },
        storageLabel: t('This device'),
        availability: 'ready',
      },
      ...profiles,
    ];
  }, [profiles]);

  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  // save IPC 失败的表单内呈现(不关表单,对齐 RemoteHostsPage 的既有约定)
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [passwordCounts, setPasswordCounts] = useState<Map<
    string,
    number
  > | null>(null);
  const [storageProfile, setStorageProfile] =
    useState<BrowserProfileSummary | null>(null);
  const [storageTarget, setStorageTarget] = useState<ProfileStorageRef>({
    kind: 'local',
  });
  const [storagePlan, setStoragePlan] =
    useState<ProfileStorageChangePlan | null>(null);
  const [storageHosts, setStorageHosts] = useState<RemoteHostConfig[]>([]);
  const [storageStages, setStorageStages] = useState<
    Record<string, RemoteStage>
  >({});
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const bridge = window.okwork?.passwordVault;
    if (!bridge) return;
    const refresh = async () => {
      try {
        const { entries } = await bridge.listMetadata();
        if (disposed) return;
        const counts = new Map<string, number>();
        for (const entry of entries) {
          counts.set(entry.profileId, (counts.get(entry.profileId) ?? 0) + 1);
        }
        setPasswordCounts(counts);
      } catch {
        if (!disposed) setPasswordCounts(null);
      }
    };
    void refresh();
    const unsubscribe = bridge.onChanged(() => void refresh());
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [profiles]);

  function openAddForm() {
    setFormMode('add');
    setFormId(null);
    setFormValues(EMPTY_FORM);
    setFormError(null);
  }

  function openEditForm(profile: BrowserProfile) {
    setFormMode('edit');
    setFormId(profile.id);
    setFormValues({ name: profile.name, userAgent: profile.userAgent ?? '' });
    setFormError(null);
  }

  function cancelForm() {
    setFormMode(null);
    setFormId(null);
    setFormError(null);
  }

  async function saveForm() {
    const name = formValues.name.trim();
    if (!name) return;
    try {
      await window.okwork?.browserProfile?.save?.({
        id: formId ?? undefined,
        name,
        userAgent: formValues.userAgent.trim() || undefined,
      });
    } catch (err) {
      setFormError(
        String((err as { message?: unknown } | undefined)?.message ?? err),
      );
      return;
    }
    setFormMode(null);
    setFormId(null);
    setFormError(null);
  }

  async function handleDelete(profile: BrowserProfile) {
    const ok = window.confirm(
      t(
        'Delete Profile "{name}"? Its saved passwords, cookies, logins and cache will be cleared from its storage locations.',
        {
          name: profile.name,
        },
      ),
    );
    if (!ok) return;
    setDeleteError(null);
    try {
      const result = await window.okwork?.browserProfile?.delete?.({
        id: profile.id,
      });
      if (result && result.status !== 'deleted') {
        setDeleteError(result.errorCode);
      }
    } catch {
      setDeleteError('BROWSER_PROFILE_DELETE_UNAVAILABLE');
    }
  }

  async function handleRetryDelete(profile: BrowserProfile) {
    setDeleteError(null);
    try {
      const result = await window.okwork?.browserProfile?.retryDelete?.({
        id: profile.id,
      });
      if (result && result.status !== 'deleted')
        setDeleteError(result.errorCode);
    } catch {
      setDeleteError('BROWSER_PROFILE_DELETE_UNAVAILABLE');
    }
  }

  async function openStorageDialog(profile: BrowserProfileSummary) {
    setStorageProfile(profile);
    setStorageTarget(profile.storage);
    setStoragePlan(null);
    setStorageError(null);
    setStorageBusy(true);
    try {
      const [hosts, stages] = await Promise.all([
        window.okwork.remoteHost.list(),
        window.okwork.remoteHost.stages(),
      ]);
      setStorageHosts(hosts);
      setStorageStages(stages);
    } catch {
      setStorageError(t('Could not load storage locations. Try again.'));
    } finally {
      setStorageBusy(false);
    }
  }

  function closeStorageDialog() {
    if (storageBusy) return;
    setStorageProfile(null);
    setStoragePlan(null);
    setStorageError(null);
  }

  async function planStorageChange() {
    if (!storageProfile) return;
    setStorageBusy(true);
    setStorageError(null);
    try {
      const plan = await window.okwork.browserProfile.planStorageChange({
        profileId: storageProfile.id,
        target: storageTarget,
      });
      setStoragePlan(plan);
    } catch {
      setStorageError(
        t(
          'This storage location is not available. Reconnect or update the Remote Host.',
        ),
      );
    } finally {
      setStorageBusy(false);
    }
  }

  async function confirmStorageChange() {
    if (!storagePlan) return;
    setStorageBusy(true);
    setStorageError(null);
    try {
      const result = await window.okwork.browserProfile.confirmStorageChange({
        planId: storagePlan.planId,
      });
      if (!result.accepted) {
        setStorageError(result.code);
        return;
      }
      setStorageProfile(null);
      setStoragePlan(null);
    } catch {
      setStorageError(
        t('The move could not start. The current storage location was kept.'),
      );
    } finally {
      setStorageBusy(false);
    }
  }

  async function retryStorageChange(profile: BrowserProfileSummary) {
    if (!profile.migration) return;
    setStorageError(null);
    try {
      const result = await window.okwork.browserProfile.retryStorageChange({
        operationId: profile.migration.operationId,
      });
      if (!result.accepted) setStorageError(result.code);
    } catch {
      setStorageError(t('Retry could not start.'));
    }
  }

  // Esc 只关本表单——SettingsModal 骨架在 document 上监听 Escape 关整个弹层,
  // stopPropagation 拦住冒泡即可(React 17+ 事件委托挂在根容器,原生 stopPropagation
  // 会在冒泡抵达 document 前截停)。
  function onFormKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancelForm();
    } else if (e.key === 'Enter') {
      saveForm();
    }
  }

  return (
    <div className="browser-profiles">
      <div className="browser-profiles__title">{t('Browser profiles')}</div>
      <div className="browser-profiles__desc">
        {t(
          'Each Profile has isolated cookies, saved passwords, storage and an optional custom User-Agent. Projects choose a Profile in their edit dialog.',
        )}
      </div>
      <div className="browser-profiles__list">
        {displayProfiles.map((profile) => {
          const unavailable = profile.availability !== 'ready';
          const hasMigration = Boolean(profile.migration);
          const profileMutationsPaused = Boolean(
            profile.migration && profile.migration.phase !== 'cleanup_pending',
          );
          return (
            <div key={profile.id} className="browser-profiles__item">
              <div className="browser-profiles__row">
                <span className="browser-profiles__name">{profile.name}</span>
                {profile.id === DEFAULT_PROFILE_ID && (
                  <span className="browser-profiles__badge">
                    {t('Built-in')}
                  </span>
                )}
                {profile.deletionState && (
                  <span
                    className={`browser-profiles__badge browser-profiles__badge--${profile.deletionState}`}
                  >
                    {profile.deletionState === 'deleting'
                      ? t('Deleting…')
                      : t('Delete failed')}
                  </span>
                )}
                <span className="browser-profiles__row-desc">
                  {profile.deletionState === 'delete_failed'
                    ? profile.deletionErrorCode
                    : profile.userAgent || t('System default User-Agent')}
                </span>
                <span
                  className={`browser-profiles__storage${unavailable ? ' browser-profiles__storage--offline' : ''}`}
                >
                  {t('Password storage')}: {profile.storageLabel}
                  {unavailable ? ` · ${t('Offline')}` : ''}
                </span>
                {passwordCounts && !unavailable && (
                  <span className="browser-profiles__password-count">
                    {t('{count} saved passwords', {
                      count: passwordCounts.get(profile.id) ?? 0,
                    })}
                  </span>
                )}
                <span className="browser-profiles__row-actions">
                  {!profile.deletionState && (
                    <button
                      className="browser-profiles__action"
                      disabled={unavailable || hasMigration}
                      onClick={() => void openStorageDialog(profile)}
                    >
                      {t('Change location')}
                    </button>
                  )}
                  {profile.deletionState === 'delete_failed' ? (
                    <button
                      className="browser-profiles__action browser-profiles__action--danger"
                      onClick={() => handleRetryDelete(profile)}
                    >
                      {t('Retry cleanup')}
                    </button>
                  ) : profile.deletionState === 'deleting' ||
                    profile.id === DEFAULT_PROFILE_ID ? null : (
                    <>
                      <button
                        className="browser-profiles__action"
                        disabled={unavailable || profileMutationsPaused}
                        onClick={() => openEditForm(profile)}
                      >
                        {t('Edit')}
                      </button>
                      <button
                        className="browser-profiles__action browser-profiles__action--danger"
                        disabled={unavailable || hasMigration}
                        onClick={() => handleDelete(profile)}
                      >
                        {t('Delete')}
                      </button>
                    </>
                  )}
                </span>
              </div>
              {unavailable && (
                <div
                  className="browser-profiles__detail browser-profiles__detail--danger"
                  role="alert"
                >
                  {t(
                    'The page session may continue with local cookies, but password and Profile changes are paused. Reconnect the Remote Host.',
                  )}
                </div>
              )}
              {profile.migration && (
                <div
                  className={`browser-profiles__detail${profile.migration.phase === 'cleanup_pending' ? ' browser-profiles__detail--warn' : profile.migration.phase === 'failed' ? ' browser-profiles__detail--danger' : ''}`}
                  role={
                    profile.migration.phase === 'failed' ? 'alert' : 'status'
                  }
                >
                  {profile.migration.phase === 'copying' &&
                    t('Copying Profile data…')}
                  {profile.migration.phase === 'verifying' &&
                    t('Verifying the new copy…')}
                  {profile.migration.phase === 'switching' &&
                    t('Switching storage location…')}
                  {profile.migration.phase === 'failed' &&
                    t(
                      'Move failed. The previous storage location is still in use.',
                    )}
                  {profile.migration.phase === 'cleanup_pending' &&
                    t('Move complete. The previous copy still needs cleanup.')}
                  {(profile.migration.phase === 'failed' ||
                    profile.migration.phase === 'cleanup_pending') && (
                    <button
                      className="browser-profiles__action"
                      onClick={() => void retryStorageChange(profile)}
                    >
                      {t('Retry')}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {deleteError && (
        <div className="browser-profiles__form-error" role="alert">
          {t(
            'Profile cleanup did not finish. The profile remains disabled and can be retried.',
          )}{' '}
          ({deleteError})
        </div>
      )}

      {storageError && !storageProfile && (
        <div className="browser-profiles__form-error" role="alert">
          {storageError}
        </div>
      )}

      {formMode ? (
        <div className="browser-profiles__form" onKeyDown={onFormKeyDown}>
          <label className="browser-profiles__field">
            <input
              autoFocus
              value={formValues.name}
              onChange={(e) =>
                setFormValues({ ...formValues, name: e.target.value })
              }
              placeholder={t('Profile name')}
            />
          </label>
          <label className="browser-profiles__field">
            <span className="browser-profiles__ua-row">
              <input
                value={formValues.userAgent}
                onChange={(e) =>
                  setFormValues({ ...formValues, userAgent: e.target.value })
                }
                placeholder={t('System default User-Agent')}
              />
              <button
                type="button"
                className="browser-profiles__btn"
                title={t('Generate a random User-Agent')}
                onClick={() =>
                  setFormValues({ ...formValues, userAgent: randomUserAgent() })
                }
              >
                🎲 {t('Random')}
              </button>
            </span>
          </label>
          {formError && (
            <div className="browser-profiles__form-error" role="alert">
              ✗ {formError}
            </div>
          )}
          <div className="browser-profiles__form-actions">
            <button className="browser-profiles__btn" onClick={cancelForm}>
              {t('Cancel')}
            </button>
            <button
              className="browser-profiles__btn browser-profiles__btn--primary"
              disabled={!formValues.name.trim()}
              onClick={saveForm}
            >
              {t('Save')}
            </button>
          </div>
        </div>
      ) : (
        <button className="browser-profiles__add-btn" onClick={openAddForm}>
          + {t('New profile')}
        </button>
      )}

      {storageProfile && (
        <div
          className="browser-profiles__storage-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeStorageDialog();
          }}
        >
          <section
            className="browser-profiles__storage-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-storage-title"
          >
            <strong id="profile-storage-title">
              {t('Change storage location')} · {storageProfile.name}
            </strong>
            {!storagePlan ? (
              <>
                <label className="browser-profiles__storage-choice">
                  <input
                    type="radio"
                    name="profile-storage"
                    checked={storageTarget.kind === 'local'}
                    onChange={() => setStorageTarget({ kind: 'local' })}
                  />
                  <span>
                    <b>{t('This device')}</b>
                    <small>{t('Available')}</small>
                  </span>
                </label>
                {storageHosts.map((host) => {
                  const ready = storageStages[host.id] === 'ready';
                  return (
                    <label
                      className="browser-profiles__storage-choice"
                      key={host.id}
                      aria-disabled={!ready}
                    >
                      <input
                        type="radio"
                        name="profile-storage"
                        disabled={!ready}
                        checked={
                          storageTarget.kind === 'remote' &&
                          storageTarget.hostId === host.id
                        }
                        onChange={() =>
                          setStorageTarget({ kind: 'remote', hostId: host.id })
                        }
                      />
                      <span>
                        <b>{host.alias}</b>
                        <small>
                          {ready
                            ? t('Connected')
                            : t('Reconnect this Remote Host first')}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </>
            ) : (
              <div className="browser-profiles__storage-confirm">
                <span>
                  {t('Move to {location}', {
                    location: storagePlan.targetLabel,
                  })}
                </span>
                {storagePlan.target.kind === 'remote' && (
                  <span>
                    {t(
                      'This Remote Host can decrypt the Profile data and saved passwords.',
                    )}
                  </span>
                )}
                <span>
                  {t(
                    'Copying → Verifying → Switching. If the move fails before switching, the current location stays in use.',
                  )}
                </span>
              </div>
            )}
            {storageError && (
              <div className="browser-profiles__form-error" role="alert">
                {storageError}
              </div>
            )}
            <div className="browser-profiles__form-actions">
              <button
                className="browser-profiles__btn"
                disabled={storageBusy}
                onClick={closeStorageDialog}
              >
                {t('Cancel')}
              </button>
              <button
                className="browser-profiles__btn browser-profiles__btn--primary"
                disabled={
                  storageBusy ||
                  (!storagePlan &&
                    sameStorageRef(storageTarget, storageProfile.storage))
                }
                onClick={() =>
                  void (storagePlan
                    ? confirmStorageChange()
                    : planStorageChange())
                }
              >
                {storageBusy
                  ? t('Working…')
                  : storagePlan
                    ? t('Move Profile')
                    : t('Continue')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default BrowserProfilesSection;
