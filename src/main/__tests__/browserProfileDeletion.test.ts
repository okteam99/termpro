import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BROWSER_PROFILE_DELETION_ERROR_CODES,
  BROWSER_PROFILE_DELETE_REJECTION_CODES,
  DEFAULT_PROFILE_ID,
} from '../../shared/browserProfile';
import {
  BrowserProfileDeletionCoordinator,
  type BrowserProfileDeletionDeps,
  type BrowserProfileDeletionLogEvent,
} from '../browserProfileDeletion';
import { BrowserProfileStore } from '../browserProfileStore';
import { JsonFileSettingsStore } from '../settingsStore';
import type { ProfileDataProvider } from '../profileAuthorityService';
import { ProfileCatalogStore } from '../profileCatalogStore';
import {
  ProfileMigrationCoordinator,
  canonicalProfileBundleJson,
  type ProfileContinuityMigrationPort,
} from '../profileMigrationCoordinator';
import type { ProfileBundleV1 } from '../../shared/remoteProfileStore';

let tmpDir: string;
let profiles: BrowserProfileStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-profile-delete-'));
  profiles = makeStore();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeStore(): BrowserProfileStore {
  return new BrowserProfileStore(
    new JsonFileSettingsStore({
      userDataDir: () => tmpDir,
      file: 'browser-profiles.json',
    }),
  );
}

function makeHarness(
  overrides: Partial<BrowserProfileDeletionDeps> = {},
  store = profiles,
) {
  const calls: string[] = [];
  const errors: BrowserProfileDeletionLogEvent[] = [];
  const warnings: BrowserProfileDeletionLogEvent[] = [];
  const deps: BrowserProfileDeletionDeps = {
    profiles: store,
    disableProfileAccess: (id) => {
      expect(store.get(id)?.deletionState).toBe('deleting');
      expect(store.isActive(id)).toBe(false);
      calls.push(`disable:${id}`);
    },
    clearVault: (id) => {
      calls.push(`vault:${id}`);
    },
    partitionsForProfile: (id) => [
      `local:${id}`,
      `remote:${id}`,
      `local:${id}`,
    ],
    clearPartitionStorage: (partition) => {
      calls.push(`storage:${partition}`);
    },
    clearPartitionCache: (partition) => {
      calls.push(`cache:${partition}`);
    },
    notifyProfilesChanged: () => {
      calls.push('notify');
    },
    logger: {
      warn: (event) => warnings.push(event),
      error: (event) => errors.push(event),
    },
    now: () => 1_000,
    ...overrides,
  };
  return {
    coordinator: new BrowserProfileDeletionCoordinator(deps),
    calls,
    errors,
    warnings,
  };
}

describe('BrowserProfileDeletionCoordinator', () => {
  it('test_AC10_remote_to_local_ends_sharing_and_cleanup_is_retryable_after_commit', async () => {
    const profileId = 'e'.repeat(32);
    const bundle: ProfileBundleV1 = {
      version: 1,
      profile: { id: profileId, name: 'Roaming', createdAt: 1 },
      credentials: [],
    };
    const catalog = new ProfileCatalogStore({
      userDataDir: tmpDir,
      localProfiles: () => [bundle.profile],
    });
    const localState = {
      live: structuredClone(bundle) as ProfileBundleV1 | null,
      staged: new Map<string, ProfileBundleV1>(),
    };
    const remoteState = {
      live: null as ProfileBundleV1 | null,
      staged: new Map<string, ProfileBundleV1>(),
    };
    let sharingActive = true;

    const makeProvider = (
      storage: { kind: 'local' } | { kind: 'remote'; hostId: string },
      state: typeof localState,
    ): ProfileDataProvider =>
      ({
        storage,
        availability: () => 'ready',
        currentGeneration: () =>
          storage.kind === 'remote' ? 'generation-1' : null,
        readBundle: async () => {
          if (!state.live) throw new Error('missing bundle');
          return structuredClone(state.live);
        },
        stage: async (operationId: string, value: ProfileBundleV1) => {
          state.staged.set(operationId, structuredClone(value));
        },
        verify: async (operationId: string, nonce: Buffer) => {
          const staged = state.staged.get(operationId);
          if (!staged) throw new Error('missing staging');
          return createHmac('sha256', nonce)
            .update(canonicalProfileBundleJson(staged))
            .digest();
        },
        publish: async (operationId: string) => {
          const staged = state.staged.get(operationId);
          if (!staged) throw new Error('missing staging');
          state.live = structuredClone(staged);
        },
        discard: async (operationId: string) => {
          state.staged.delete(operationId);
        },
        deleteProfile: async () => {
          const existed = state.live !== null;
          state.live = null;
          return existed;
        },
        retireAfterMigration: async () => {
          sharingActive = false;
          state.live = null;
          return 1;
        },
      }) as unknown as ProfileDataProvider;

    const local = makeProvider({ kind: 'local' }, localState);
    const remote = makeProvider(
      { kind: 'remote', hostId: 'remote-source' },
      remoteState,
    );
    const operationIds = [
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
    ];
    let localCompleteCalls = 0;
    const initiatingPartition = { signedInCookie: 'preserved-local-copy' };
    const continuity: ProfileContinuityMigrationPort = {
      prepareMigration: async () => undefined,
      activateMigration: async () => undefined,
      completeMigration: async (record) => {
        if (record.target.kind !== 'local') return;
        localCompleteCalls += 1;
        if (localCompleteCalls === 2) {
          throw Object.assign(new Error('fixed'), {
            code: 'PROFILE_STORAGE_IO_FAILED',
          });
        }
      },
    };
    const migration = new ProfileMigrationCoordinator({
      catalog,
      resolveProvider: (storage) =>
        storage.kind === 'local' ? local : remote,
      newOperationId: () => {
        const operationId = operationIds.shift();
        if (!operationId) throw new Error('operation id fixture exhausted');
        return operationId;
      },
      randomNonce: () => Buffer.alloc(32, 4),
      continuity,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    await expect(
      migration.migrate(profileId, {
        kind: 'remote',
        hostId: 'remote-source',
      }),
    ).resolves.toBeNull();
    sharingActive = true;

    const first = await migration.migrate(profileId, { kind: 'local' });
    expect(first).toMatchObject({
      committed: true,
      phase: 'cleanup_pending',
      errorCode: 'PROFILE_STORAGE_IO_FAILED',
    });
    expect(catalog.getEntry(profileId)?.storage).toEqual({ kind: 'local' });
    expect(sharingActive).toBe(false);
    expect(initiatingPartition.signedInCookie).toBe('preserved-local-copy');

    await expect(
      migration.retry('30000000-0000-4000-8000-000000000002'),
    ).resolves.toBeNull();
    expect(catalog.getMigration(profileId)).toBeNull();
    expect(sharingActive).toBe(false);
    expect(initiatingPartition.signedInCookie).toBe('preserved-local-copy');
  });

  it('test_AC7_remote_authority_profile_deletion_revokes_access_and_resumes_after_restart', async () => {
    const target = profiles.save({ name: 'A' });
    const untouched = profiles.save({ name: 'B' });
    const h = makeHarness();

    await expect(h.coordinator.deleteProfile(target.id)).resolves.toEqual({
      status: 'deleted',
      profileId: target.id,
    });
    expect(profiles.get(target.id)).toBeNull();
    expect(profiles.get(untouched.id)).toMatchObject({
      id: untouched.id,
      name: 'B',
    });
    expect(h.calls).toEqual([
      `disable:${target.id}`,
      'notify',
      `vault:${target.id}`,
      `storage:local:${target.id}`,
      `cache:local:${target.id}`,
      `storage:remote:${target.id}`,
      `cache:remote:${target.id}`,
      'notify',
    ]);
    expect(h.errors).toEqual([]);
  });

  it('test_AC7_profile_delete_stays_blocked_and_retryable_after_partial_failure_and_restart', async () => {
    const target = profiles.save({ name: 'A' });
    const untouched = profiles.save({ name: 'B' });
    let failCache = true;
    const first = makeHarness({
      clearPartitionCache: async (partition) => {
        if (failCache && partition.startsWith('remote:'))
          throw new Error('secret raw error');
      },
    });

    await expect(first.coordinator.deleteProfile(target.id)).resolves.toEqual({
      status: 'delete_failed',
      profileId: target.id,
      errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.cacheClearFailed,
      updatedAt: 1_000,
    });
    expect(first.errors).toEqual([
      {
        featureId: 'OKWORK-F260807022801-Profile-Password-Vault',
        profileId: target.id,
        step: 'clear_cache',
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.cacheClearFailed,
      },
    ]);

    profiles = makeStore();
    expect(profiles.get(target.id)).toMatchObject({
      deletionState: 'delete_failed',
      deletionErrorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.cacheClearFailed,
      deletionUpdatedAt: 1_000,
    });
    expect(profiles.isActive(target.id)).toBe(false);
    expect(profiles.isActive(untouched.id)).toBe(true);
    expect(
      await makeHarness({}, profiles).coordinator.resumeInterruptedDeletions(),
    ).toEqual([]);

    failCache = false;
    const retry = makeHarness({}, profiles);
    await expect(
      retry.coordinator.retryProfileDeletion(target.id),
    ).resolves.toEqual({
      status: 'deleted',
      profileId: target.id,
    });
    expect(profiles.get(target.id)).toBeNull();
    expect(profiles.get(untouched.id)).not.toBeNull();
  });

  it('snapshots historical partitions before vault cleanup and retains them for retry', async () => {
    const target = profiles.save({ name: 'Historical remote partition' });
    const historicalPartition = `persist:profile-${target.id}-removed-host`;
    const events: string[] = [];
    let cleanupHistoryRetained = true;
    let failStorage = true;
    const h = makeHarness({
      partitionsForProfile: () => {
        events.push(`list:${cleanupHistoryRetained ? 'retained' : 'forgotten'}`);
        return cleanupHistoryRetained ? [historicalPartition] : [];
      },
      clearVault: () => {
        events.push('vault');
      },
      clearPartitionStorage: (partition) => {
        events.push(`storage:${partition}`);
        if (failStorage) throw new Error('fixed fixture failure');
      },
      clearPartitionCache: (partition) => {
        events.push(`cache:${partition}`);
      },
      finalizeProfileCleanup: () => {
        events.push('finalize');
        cleanupHistoryRetained = false;
      },
    });

    await expect(h.coordinator.deleteProfile(target.id)).resolves.toMatchObject({
      status: 'delete_failed',
      errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.storageClearFailed,
    });
    expect(events).toEqual([
      'list:retained',
      'vault',
      `storage:${historicalPartition}`,
    ]);
    expect(cleanupHistoryRetained).toBe(true);

    failStorage = false;
    await expect(
      h.coordinator.retryProfileDeletion(target.id),
    ).resolves.toEqual({ status: 'deleted', profileId: target.id });
    expect(events).toEqual([
      'list:retained',
      'vault',
      `storage:${historicalPartition}`,
      'list:retained',
      'vault',
      `storage:${historicalPartition}`,
      `cache:${historicalPartition}`,
      'finalize',
    ]);
    expect(cleanupHistoryRetained).toBe(false);
  });

  it('Vault cleanup failure leaves the Profile persistently inactive before partition cleanup', async () => {
    const target = profiles.save({ name: 'A' });
    const h = makeHarness({
      clearVault: () => {
        throw new Error('raw vault failure must not escape');
      },
    });

    await expect(h.coordinator.deleteProfile(target.id)).resolves.toEqual({
      status: 'delete_failed',
      profileId: target.id,
      errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.vaultClearFailed,
      updatedAt: 1_000,
    });
    expect(profiles.get(target.id)).toMatchObject({
      deletionState: 'delete_failed',
      deletionErrorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.vaultClearFailed,
    });
    expect(profiles.isActive(target.id)).toBe(false);
    expect(h.calls).toEqual([
      `disable:${target.id}`,
      'notify', // deleting
      'notify', // delete_failed
    ]);
    expect(h.errors).toEqual([
      {
        featureId: 'OKWORK-F260807022801-Profile-Password-Vault',
        profileId: target.id,
        step: 'clear_vault',
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.vaultClearFailed,
      },
    ]);
  });

  it('启动续跑 interrupted deleting，并保持 delete_failed 等待显式重试', async () => {
    const interrupted = profiles.save({ name: 'interrupted' });
    const failed = profiles.save({ name: 'failed' });
    profiles.markDeleting(interrupted.id, 100);
    profiles.markDeleting(failed.id, 100);
    profiles.markDeleteFailed(
      failed.id,
      BROWSER_PROFILE_DELETION_ERROR_CODES.vaultClearFailed,
      200,
    );

    profiles = makeStore();
    const h = makeHarness({}, profiles);
    await expect(h.coordinator.resumeInterruptedDeletions()).resolves.toEqual([
      { status: 'deleted', profileId: interrupted.id },
    ]);
    expect(profiles.get(interrupted.id)).toBeNull();
    expect(profiles.get(failed.id)?.deletionState).toBe('delete_failed');
  });

  it('默认 Profile 和未知 Profile 拒绝，且不触发任何清理', async () => {
    const h = makeHarness();
    await expect(
      h.coordinator.deleteProfile(DEFAULT_PROFILE_ID),
    ).resolves.toEqual({
      status: 'rejected',
      profileId: DEFAULT_PROFILE_ID,
      errorCode: BROWSER_PROFILE_DELETE_REJECTION_CODES.defaultProfile,
    });
    await expect(h.coordinator.deleteProfile('f'.repeat(32))).resolves.toEqual({
      status: 'rejected',
      profileId: 'f'.repeat(32),
      errorCode: BROWSER_PROFILE_DELETE_REJECTION_CODES.notFound,
    });
    expect(h.calls).toEqual([]);
  });

  it('迁移中的 Profile 拒绝删除，且不进入删除状态机', async () => {
    const target = profiles.save({ name: 'A' });
    const h = makeHarness({ canBeginDeletion: () => false });

    await expect(h.coordinator.deleteProfile(target.id)).resolves.toEqual({
      status: 'rejected',
      profileId: target.id,
      errorCode: BROWSER_PROFILE_DELETE_REJECTION_CODES.migrationInProgress,
    });
    expect(profiles.get(target.id)?.deletionState).toBeUndefined();
    expect(h.calls).toEqual([]);
  });

  it('并发重复删除共享同一在途清理，避免重复触发资源步骤', async () => {
    const target = profiles.save({ name: 'A' });
    let releaseVault: (() => void) | undefined;
    const vaultGate = new Promise<void>((resolve) => {
      releaseVault = resolve;
    });
    const clearVault = vi.fn(() => vaultGate);
    const h = makeHarness({ clearVault });

    const first = h.coordinator.deleteProfile(target.id);
    const second = h.coordinator.deleteProfile(target.id);
    expect(clearVault).toHaveBeenCalledTimes(0);
    releaseVault?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'deleted', profileId: target.id },
      { status: 'deleted', profileId: target.id },
    ]);
    expect(clearVault).toHaveBeenCalledTimes(1);
  });
});
