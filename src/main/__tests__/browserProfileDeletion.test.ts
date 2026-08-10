import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
