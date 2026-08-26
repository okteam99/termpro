// 浏览器 Profile 管理区块(BrowserSettingsPage 追加区块 · 用户指令 2026-07-21):
// 展示内置默认 profile(虚拟实体,恒在列表首行,无编辑/删除)+ 自定义 profile 列表,
// 支持增/改/删。列表数据来自 store 镜像(profilesSync 服务已订阅 main 的
// browserProfile:changed 推送,增删改后自动刷新,本组件无需手动 list()/refresh)。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import './BrowserProfilesSection.css';
import { t } from '../../../shared/i18n';
import { useAppStore } from '../../state/store';
import { randomUserAgent } from './randomUserAgent';
import type {
  BrowserProfile,
  BrowserProfileSummary,
  LoginContinuityReasonCode,
  ProfileStorageChangePlan,
  ProfileStorageRef,
  ProfileStorageTargetStatus,
  RemoteBrowserProfileSummary,
} from '../../../shared/browserProfile';
import { DEFAULT_PROFILE_ID } from '../../../shared/browserProfile';
import type { RemoteHostConfig, RemoteStage } from '../../../shared/remoteHost';

interface FormValues {
  name: string;
  userAgent: string;
}

const EMPTY_FORM: FormValues = { name: '', userAgent: '' };

function continuityStateText(profile: BrowserProfileSummary): string | null {
  const continuity = profile.loginContinuity;
  if (!continuity || continuity.state === 'not_available') return null;
  switch (continuity.state) {
    case 'host_upgrade':
      return t('Login continuity · Update Remote Host');
    case 'hydrating':
      return t('Login continuity · Restoring login status…');
    case 'syncing':
      return t('Login continuity · Syncing…');
    case 'synced':
      return t('Login continuity · Synced');
    case 'paused':
      return t('Login continuity · Paused');
    case 'attention':
      return t('Login continuity · Needs attention');
    case 'moved':
      return t('Login continuity · Profile moved');
  }
}

function continuityReasonText(reason: LoginContinuityReasonCode): string {
  const labels: Record<LoginContinuityReasonCode, string> = {
    HOST_UPGRADE_REQUIRED: t('Remote Host update required'),
    PROFILE_CONTINUITY_OFFLINE: t('Remote Host offline'),
    PROFILE_CONTINUITY_TIMEOUT: t('Remote Host timed out'),
    CONTINUITY_JOURNAL_UNAVAILABLE: t('Protected local queue unavailable'),
    CONTINUITY_JOURNAL_CORRUPT: t('Protected local queue needs attention'),
    COOKIE_SESSION_POLICY: t('Session-only cookie kept on this device'),
    COOKIE_UNSUPPORTED: t('Cookie attributes not supported'),
    COOKIE_TOO_LARGE: t('Cookie exceeds sync limit'),
    COOKIE_APPLY_FAILED: t('Cookie could not be restored'),
    COOKIE_CONFLICT_RESOLVED: t('Conflict resolved by Host order'),
    PROFILE_MOVED: t('Profile moved'),
    PROFILE_DELETED: t('Profile deleted'),
  };
  return labels[reason];
}

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
  const [storageTargetStatuses, setStorageTargetStatuses] = useState<
    Record<string, ProfileStorageTargetStatus>
  >({});
  const storageLoadGeneration = useRef(0);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<
    RemoteBrowserProfileSummary[]
  >([]);
  const [availableBusy, setAvailableBusy] = useState(false);
  const [availableError, setAvailableError] = useState<string | null>(null);
  const [joiningProfileId, setJoiningProfileId] = useState<string | null>(null);

  const refreshAvailableProfiles = useCallback(async () => {
    const bridge = window.okwork?.browserProfile;
    if (!bridge?.listRemoteAvailable) return;
    setAvailableBusy(true);
    setAvailableError(null);
    try {
      const [hosts, stages] = await Promise.all([
        window.okwork.remoteHost.list(),
        window.okwork.remoteHost.stages(),
      ]);
      const pages = await Promise.all(
        hosts
          .filter((host) => stages[host.id] === 'ready')
          .map((host) => bridge.listRemoteAvailable({ hostId: host.id })),
      );
      const joinedIds = new Set(profiles.map((profile) => profile.id));
      setAvailableProfiles(
        pages
          .flat()
          .filter((profile) => !joinedIds.has(profile.profileId))
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name) ||
              left.hostId.localeCompare(right.hostId) ||
              left.profileId.localeCompare(right.profileId),
          ),
      );
    } catch {
      setAvailableError(
        t('Could not check Remote Hosts for available Profiles.'),
      );
    } finally {
      setAvailableBusy(false);
    }
  }, [profiles]);

  useEffect(() => {
    void refreshAvailableProfiles();
    return window.okwork?.remoteHost?.onEvent?.(() => {
      void refreshAvailableProfiles();
    });
  }, [refreshAvailableProfiles]);

  async function joinAvailableProfile(profile: RemoteBrowserProfileSummary) {
    setJoiningProfileId(profile.profileId);
    setAvailableError(null);
    try {
      await window.okwork.browserProfile.joinRemote({
        hostId: profile.hostId,
        profileId: profile.profileId,
      });
      setAvailableProfiles((current) =>
        current.filter(
          (candidate) =>
            candidate.profileId !== profile.profileId ||
            candidate.hostId !== profile.hostId,
        ),
      );
    } catch {
      setAvailableError(
        t('This Profile could not be used on this device.'),
      );
    } finally {
      setJoiningProfileId(null);
    }
  }

  async function retryContinuity(profileId: string) {
    setAvailableError(null);
    try {
      await window.okwork.browserProfile.retryContinuity({ profileId });
    } catch {
      setAvailableError(t('Login continuity retry could not start.'));
    }
  }

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

  async function handleDelete(profile: BrowserProfileSummary) {
    const ok = window.confirm(
      t(
        profile.storage.kind === 'remote'
          ? 'Delete shared Profile "{name}"? This affects every device using it. Saved passwords, compatible login cookies and local browser partitions will be removed.'
          : 'Delete Profile "{name}"? Its saved passwords, cookies, logins and cache will be cleared from its storage locations.',
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

  const loadStorageLocations = useCallback(async () => {
    const generation = ++storageLoadGeneration.current;
    setStorageBusy(true);
    setStorageHosts([]);
    setStorageStages({});
    setStorageTargetStatuses({});
    try {
      const [hosts, stages, targetStatuses] = await Promise.all([
        window.okwork.remoteHost.list(),
        window.okwork.remoteHost.stages(),
        window.okwork.browserProfile.listStorageTargets(),
      ]);
      if (generation !== storageLoadGeneration.current) return;
      setStorageHosts(hosts);
      setStorageStages(stages);
      setStorageTargetStatuses(
        Object.fromEntries(
          targetStatuses.map((status) => [status.hostId, status]),
        ),
      );
    } catch {
      if (generation !== storageLoadGeneration.current) return;
      setStorageError(t('Could not load storage locations. Try again.'));
    } finally {
      if (generation === storageLoadGeneration.current) setStorageBusy(false);
    }
  }, []);

  async function openStorageDialog(profile: BrowserProfileSummary) {
    setStorageProfile(profile);
    setStorageTarget(profile.storage);
    setStoragePlan(null);
    setStorageError(null);
    await loadStorageLocations();
  }

  useEffect(() => {
    if (!storageProfile) return;
    return window.okwork.remoteHost.onEvent(() => {
      // A ready stage can belong to a new connection generation. Drop old describe state first.
      setStoragePlan(null);
      setStorageTargetStatuses({});
      void loadStorageLocations();
    });
  }, [loadStorageLocations, storageProfile]);

  function closeStorageDialog() {
    // 加载目标列表时可关掉；真正 Copy→Verify 进行中才挡住。
    if (storageBusy && storagePlan) return;
    storageLoadGeneration.current += 1;
    setStorageProfile(null);
    setStoragePlan(null);
    setStorageError(null);
  }

  // 嵌入全局 Settings 面板时，document 上的 Esc 会关整块面板。
  // 存储迁移层必须在 capture 阶段截停，先关自己（AC-3 二级表单）。
  useEffect(() => {
    if (!storageProfile) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeStorageDialog();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [storageProfile, storageBusy]);

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

  const selectedStorageTargetEligible =
    storageTarget.kind === 'local' ||
    (storageStages[storageTarget.hostId] === 'ready' &&
      storageTargetStatuses[storageTarget.hostId]?.compatibility ===
        'compatible');

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
      {(availableProfiles.length > 0 || availableBusy || availableError) && (
        <div className="browser-profiles__available" aria-busy={availableBusy}>
          <div className="browser-profiles__available-title">
            {t('Available on connected Remote Hosts')}
          </div>
          {availableProfiles.map((profile) => (
            <div
              key={`${profile.hostId}:${profile.profileId}`}
              className="browser-profiles__available-row"
            >
              <span>
                <b>{profile.name}</b>
                <small>{t('Remote Host')} · {profile.hostId}</small>
              </span>
              <button
                className="browser-profiles__action"
                disabled={joiningProfileId !== null}
                onClick={() => void joinAvailableProfile(profile)}
              >
                {joiningProfileId === profile.profileId
                  ? t('Adding…')
                  : t('Use on this device')}
              </button>
            </div>
          ))}
          {availableBusy && (
            <div className="browser-profiles__available-status" role="status">
              {t('Checking connected Remote Hosts…')}
            </div>
          )}
          {availableError && (
            <div className="browser-profiles__available-status browser-profiles__detail--danger" role="alert">
              {availableError}
            </div>
          )}
        </div>
      )}
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
                  {t('Storage location')}: {profile.storageLabel}
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
              {continuityStateText(profile) && (
                <div
                  className={`browser-profiles__detail browser-profiles__continuity${profile.loginContinuity?.state === 'attention' || profile.loginContinuity?.state === 'host_upgrade' ? ' browser-profiles__detail--warn' : profile.loginContinuity?.state === 'paused' || profile.loginContinuity?.state === 'moved' ? ' browser-profiles__detail--danger' : ''}`}
                  role={
                    profile.loginContinuity?.state === 'paused' ||
                    profile.loginContinuity?.state === 'moved'
                      ? 'alert'
                      : 'status'
                  }
                >
                  <span>{continuityStateText(profile)}</span>
                  <span className="browser-profiles__continuity-counts">
                    {t('{count} synced', {
                      count: profile.loginContinuity?.syncedCount ?? 0,
                    })}
                    {' · '}
                    {t('{count} pending', {
                      count: profile.loginContinuity?.pendingCount ?? 0,
                    })}
                    {' · '}
                    {t('{count} skipped', {
                      count: profile.loginContinuity?.skippedCount ?? 0,
                    })}
                    {' · '}
                    {t('{count} conflicts', {
                      count: profile.loginContinuity?.conflictCount ?? 0,
                    })}
                  </span>
                  {profile.loginContinuity?.reasons.map((reason) => (
                    <span key={reason} className="browser-profiles__continuity-reason">
                      {continuityReasonText(reason)}
                    </span>
                  ))}
                  {profile.loginContinuity?.canRetry && (
                    <button
                      className="browser-profiles__action"
                      onClick={() => void retryContinuity(profile.id)}
                    >
                      {t('Retry')}
                    </button>
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
                  const targetStatus = storageTargetStatuses[host.id];
                  const eligible =
                    ready && targetStatus?.compatibility === 'compatible';
                  return (
                    <label
                      className="browser-profiles__storage-choice"
                      key={host.id}
                      aria-disabled={!eligible}
                    >
                      <input
                        type="radio"
                        name="profile-storage"
                        disabled={!eligible}
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
                          {!ready
                            ? t('Reconnect this Remote Host first')
                            : targetStatus?.compatibility === 'compatible'
                              ? t('Profile storage compatible')
                              : targetStatus?.compatibility === 'incompatible'
                                ? t(
                                    'Update this Remote Host to use Profile storage',
                                  )
                                : t(
                                    'Could not verify Profile storage. Reconnect this Remote Host.',
                                  )}
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
                      'This Remote Host, its administrators, and processes running as the configured SSH user can decrypt the Profile data and saved passwords.',
                    )}
                  </span>
                )}
                <span>
                  {t(
                    'Copying → Verifying → Switching. If the move fails before switching, the current location stays in use.',
                  )}
                </span>
                {storageProfile.storage.kind === 'remote' && (
                  <span className="browser-profiles__global-impact">
                    {storagePlan.target.kind === 'local'
                      ? t(
                          'This ends sharing for every other device. This device keeps the local copy; other devices remove the Profile after they reconnect.',
                        )
                      : t(
                          'This move changes the shared storage location for every device using this Profile.',
                        )}
                  </span>
                )}
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
                    (!selectedStorageTargetEligible ||
                      sameStorageRef(storageTarget, storageProfile.storage)))
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
