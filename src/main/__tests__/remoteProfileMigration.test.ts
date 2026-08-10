import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BrowserProfile,
  BrowserProfileInput,
  ProfileStorageRef,
} from '../../shared/browserProfile';
import type {
  PasswordCredentialMetadata,
  PasswordMetadataQuery,
} from '../../shared/passwordVault';
import type {
  DecryptedProfileCredential,
  ProfileBundleV1,
} from '../../shared/remoteProfileStore';
import type {
  PasswordUpsertInput,
  PasswordUpsertResult,
  ProfileDataProvider,
} from '../profileAuthorityService';
import { ProfileCatalogStore } from '../profileCatalogStore';
import {
  ProfileMigrationCoordinator,
  canonicalProfileBundleJson,
  type ProfileContinuityMigrationPort,
} from '../profileMigrationCoordinator';

const PROFILE_ID = 'b'.repeat(32);
const HOST_ID = 'migration-host';
const OPERATION_ID = '10000000-0000-4000-8000-000000000001';
const ENTRY_ID = '20000000-0000-4000-8000-000000000001';

function bundle(name = 'Migrating profile'): ProfileBundleV1 {
  return {
    version: 1,
    profile: { id: PROFILE_ID, name, createdAt: 1 },
    credentials: [
      {
        id: ENTRY_ID,
        profileId: PROFILE_ID,
        origin: 'https://example.test',
        username: 'alice',
        password: 'migration-secret',
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: 1,
      },
    ],
  };
}

class MigrationProvider implements ProfileDataProvider {
  readonly staged = new Map<string, ProfileBundleV1>();
  live = new Map<string, ProfileBundleV1>();
  generation: string | null;
  failStage = false;
  failCleanup = false;
  failRetireResponseOnce = false;
  readonly retireCalls: Array<{
    profileId: string;
    operationId: string;
    movedTo: 'remote' | 'local';
  }> = [];
  private readonly retired = new Map<
    string,
    { operationId: string; movedTo: 'remote' | 'local' }
  >();
  blockRead: (() => void) | null = null;
  readStarted: (() => void) | null = null;

  constructor(
    readonly storage: ProfileStorageRef,
    generation: string | null = null,
  ) {
    this.generation = generation;
  }

  availability(): 'ready' | 'offline' {
    return this.generation === 'offline' ? 'offline' : 'ready';
  }
  currentGeneration(): string | null {
    return this.generation;
  }
  async createProfile(input: BrowserProfileInput): Promise<BrowserProfile> {
    void input;
    throw new Error('unused');
  }
  async getProfile(profileId: string): Promise<BrowserProfile> {
    return this.require(profileId).profile;
  }
  async writeProfile(profile: BrowserProfile): Promise<BrowserProfile> {
    this.live.set(profile.id, { ...this.require(profile.id), profile });
    return profile;
  }
  async readBundle(profileId: string): Promise<ProfileBundleV1> {
    this.readStarted?.();
    if (this.blockRead)
      await new Promise<void>((resolve) => {
        this.blockRead = resolve;
      });
    return structuredClone(this.require(profileId));
  }
  async listMetadata(
    profileId: string,
    query?: PasswordMetadataQuery,
  ): Promise<PasswordCredentialMetadata[]> {
    void query;
    return this.require(profileId).credentials.map((credential) => ({
      id: credential.id,
      profileId: credential.profileId,
      origin: credential.origin,
      username: credential.username,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      lastUsedAt: credential.lastUsedAt,
    }));
  }
  async lookup(
    profileId: string,
    origin: string,
  ): Promise<DecryptedProfileCredential[]> {
    return this.require(profileId).credentials.filter(
      (credential) => credential.origin === origin,
    );
  }
  async getDecrypted(
    profileId: string,
    entryId: string,
  ): Promise<DecryptedProfileCredential> {
    const credential = this.require(profileId).credentials.find(
      (candidate) => candidate.id === entryId,
    );
    if (!credential) throw new Error('missing credential');
    return credential;
  }
  async upsert(input: PasswordUpsertInput): Promise<PasswordUpsertResult> {
    void input;
    throw new Error('unused');
  }
  async deleteEntry(): Promise<boolean> {
    return false;
  }
  async deleteProfile(profileId: string): Promise<boolean> {
    if (this.failCleanup)
      throw Object.assign(new Error('private failure'), {
        code: 'PROFILE_STORAGE_IO_FAILED',
      });
    return this.live.delete(profileId);
  }
  async retireAfterMigration(
    profileId: string,
    operationId: string,
    movedTo: 'remote' | 'local',
  ): Promise<number> {
    this.retireCalls.push({ profileId, operationId, movedTo });
    const retired = this.retired.get(profileId);
    if (retired) {
      if (
        retired.operationId !== operationId ||
        retired.movedTo !== movedTo
      ) {
        throw Object.assign(new Error('fixed'), {
          code: 'PROFILE_STORAGE_FORBIDDEN',
        });
      }
      return 1;
    }
    this.retired.set(profileId, { operationId, movedTo });
    this.live.delete(profileId);
    if (this.failRetireResponseOnce) {
      this.failRetireResponseOnce = false;
      throw Object.assign(new Error('response lost after durable move'), {
        code: 'PROFILE_STORAGE_OFFLINE',
      });
    }
    return 1;
  }
  async stage(operationId: string, value: ProfileBundleV1): Promise<void> {
    if (this.failStage)
      throw Object.assign(new Error('secret must not escape'), {
        code: 'PROFILE_STORAGE_IO_FAILED',
      });
    this.staged.set(operationId, structuredClone(value));
  }
  async verify(operationId: string, nonce: Buffer): Promise<Buffer> {
    const staged = this.staged.get(operationId);
    if (!staged) throw new Error('missing staging');
    return createHmac('sha256', nonce)
      .update(canonicalProfileBundleJson(staged))
      .digest();
  }
  async publish(operationId: string, profileId: string): Promise<void> {
    const staged = this.staged.get(operationId);
    if (!staged) throw new Error('missing staging');
    this.live.set(profileId, structuredClone(staged));
  }
  async discard(operationId: string): Promise<void> {
    this.staged.delete(operationId);
  }

  private require(profileId: string): ProfileBundleV1 {
    const value = this.live.get(profileId);
    if (!value)
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_CORRUPT',
      });
    return value;
  }
}

let tmpDir: string;
let catalog: ProfileCatalogStore;
let source: MigrationProvider;
let target: MigrationProvider;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-migration-'));
  catalog = new ProfileCatalogStore({
    userDataDir: tmpDir,
    localProfiles: () => [
      { id: PROFILE_ID, name: 'Migrating profile', createdAt: 1 },
    ],
  });
  source = new MigrationProvider({ kind: 'local' });
  target = new MigrationProvider({ kind: 'remote', hostId: HOST_ID }, 'g1');
  source.live.set(PROFILE_ID, bundle());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function coordinator(
  logger?: { warn(message: string): void; error(message: string): void },
  onChanged?: () => void,
  continuity: ProfileContinuityMigrationPort = {
    prepareMigration: async () => undefined,
    activateMigration: async () => undefined,
    completeMigration: async () => undefined,
  },
) {
  return new ProfileMigrationCoordinator({
    catalog,
    resolveProvider: (storage) => (storage.kind === 'local' ? source : target),
    newOperationId: () => OPERATION_ID,
    randomNonce: () => Buffer.alloc(32, 7),
    logger,
    onChanged,
    continuity,
  });
}

describe('Profile migration authority switch', () => {
  it('test_AC4_migration_copies_verifies_and_switches_once_before_source_cleanup', async () => {
    const visiblePhases: Array<string | null> = [];
    const result = await coordinator(undefined, () => {
      visiblePhases.push(catalog.getMigration(PROFILE_ID)?.phase ?? null);
    }).migrate(PROFILE_ID, { kind: 'remote', hostId: HOST_ID });
    expect(result).toBeNull();
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: HOST_ID,
    });
    expect(catalog.getMigration(PROFILE_ID)).toBeNull();
    expect(source.live.has(PROFILE_ID)).toBe(false);
    expect(target.live.get(PROFILE_ID)).toEqual(bundle());
    expect(visiblePhases).toEqual([
      'copying',
      'verifying',
      'switching',
      'cleanup_pending',
      null,
    ]);
  });

  it('test_AC5_keeps_exactly_one_authority_on_pre_and_post_commit_failures', async () => {
    const warnings: string[] = [];
    target.failStage = true;
    const result = await coordinator({
      warn: (line) => warnings.push(line),
      error: () => undefined,
    }).migrate(PROFILE_ID, { kind: 'remote', hostId: HOST_ID });
    expect(result).toMatchObject({
      committed: false,
      phase: 'failed',
      errorCode: 'PROFILE_STORAGE_IO_FAILED',
    });
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({ kind: 'local' });
    expect(source.live.get(PROFILE_ID)).toEqual(bundle());
    expect(target.live.has(PROFILE_ID)).toBe(false);
    expect(warnings.join('\n')).not.toContain('secret must not escape');
    expect(warnings.join('\n')).not.toContain('migration-secret');
  });

  it('test_AC5_keeps_cleanup_pending_source_blocked_until_idempotent_retry_succeeds', async () => {
    source.failCleanup = true;
    const first = await coordinator().migrate(PROFILE_ID, {
      kind: 'remote',
      hostId: HOST_ID,
    });
    expect(first).toMatchObject({ committed: true, phase: 'cleanup_pending' });
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: HOST_ID,
    });
    expect(target.live.get(PROFILE_ID)).toEqual(bundle());

    source.failCleanup = false;
    expect(await coordinator().retry(OPERATION_ID)).toBeNull();
    expect(catalog.getMigration(PROFILE_ID)).toBeNull();
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: HOST_ID,
    });
  });

  it('test_AC4_restart resumes the same operationId from persisted precommit state', async () => {
    const firstCoordinator = coordinator();
    firstCoordinator.begin(PROFILE_ID, { kind: 'remote', hostId: HOST_ID });
    const restartedCatalog = new ProfileCatalogStore({
      userDataDir: tmpDir,
      localProfiles: () => [],
    });
    catalog = restartedCatalog;
    const resumed = await coordinator().resumeAll();
    expect(resumed).toEqual([]);
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: HOST_ID,
    });
    expect(catalog.getMigration(OPERATION_ID)).toBeNull();
  });

  it('test_AC4_recovers_after_restart_and_ignores_late_precommit_responses', async () => {
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    source.readStarted = readStarted;
    source.blockRead = () => undefined;
    source.readBundle = async (profileId: string) => {
      source.readStarted?.();
      await blocked;
      const value = source.live.get(profileId);
      if (!value) throw new Error('missing source bundle');
      return structuredClone(value);
    };
    const runner = coordinator();
    runner.begin(PROFILE_ID, { kind: 'remote', hostId: HOST_ID });
    const pending = runner.run(OPERATION_ID);
    await started;
    target.generation = 'g2';
    unblock();
    const result = await pending;
    expect(result).toMatchObject({
      committed: false,
      phase: 'copying',
      targetGeneration: 'g1',
    });
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({ kind: 'local' });
    expect(target.live.has(PROFILE_ID)).toBe(false);
  });

  it('test_AC10_delete_move_epoch_prevents_stale_catalog_or_journal_revival', async () => {
    // Establish the Remote authority first, then migrate it back to this
    // device. The second migration uses the same durable coordinator record
    // that production resumes after restart.
    expect(
      await coordinator().migrate(PROFILE_ID, {
        kind: 'remote',
        hostId: HOST_ID,
      }),
    ).toBeNull();
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: HOST_ID,
    });

    target.failRetireResponseOnce = true;
    const first = await coordinator().migrate(PROFILE_ID, { kind: 'local' });
    expect(first).toMatchObject({
      operationId: OPERATION_ID,
      phase: 'switching',
      committed: false,
      errorCode: 'PROFILE_STORAGE_OFFLINE',
    });
    // The source accepted the moved epoch even though its response was lost;
    // the local catalog therefore stays on the old authority until the same
    // operation can finish, and the old Remote bundle cannot be revived.
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: HOST_ID,
    });
    expect(target.live.has(PROFILE_ID)).toBe(false);
    expect(source.live.has(PROFILE_ID)).toBe(false);
    expect(source.staged.get(OPERATION_ID)).toEqual(bundle());

    expect(await coordinator().retry(OPERATION_ID)).toBeNull();
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({ kind: 'local' });
    expect(source.live.get(PROFILE_ID)).toEqual(bundle());
    expect(target.live.has(PROFILE_ID)).toBe(false);
    expect(target.retireCalls).toEqual([
      { profileId: PROFILE_ID, operationId: OPERATION_ID, movedTo: 'local' },
      { profileId: PROFILE_ID, operationId: OPERATION_ID, movedTo: 'local' },
      { profileId: PROFILE_ID, operationId: OPERATION_ID, movedTo: 'local' },
    ]);
  });

  it('test_AC5_cookie_seed_and_migration_resume_by_confirmed_cursor_under_payload_limit', async () => {
    await coordinator().migrate(PROFILE_ID, {
      kind: 'remote',
      hostId: HOST_ID,
    });

    const pageBytes = [400 * 1024, 400 * 1024, 128 * 1024];
    let confirmedCursor = 0;
    let interruptOnce = true;
    const resumedFrom: number[] = [];
    const continuity: ProfileContinuityMigrationPort = {
      prepareMigration: async () => {
        resumedFrom.push(confirmedCursor);
        while (confirmedCursor < pageBytes.length) {
          expect(pageBytes[confirmedCursor]).toBeLessThanOrEqual(512 * 1024);
          confirmedCursor += 1;
          if (interruptOnce) {
            interruptOnce = false;
            throw Object.assign(new Error('fixed'), {
              code: 'PROFILE_STORAGE_OFFLINE',
            });
          }
        }
      },
      activateMigration: async () => undefined,
      completeMigration: async () => undefined,
    };

    const first = await coordinator(undefined, undefined, continuity).migrate(
      PROFILE_ID,
      { kind: 'local' },
    );
    expect(first).toMatchObject({
      phase: 'switching',
      committed: false,
      errorCode: 'PROFILE_STORAGE_OFFLINE',
    });
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: HOST_ID,
    });
    expect(confirmedCursor).toBe(1);

    expect(
      await coordinator(undefined, undefined, continuity).retry(OPERATION_ID),
    ).toBeNull();
    expect(resumedFrom).toEqual([0, 1]);
    expect(confirmedCursor).toBe(pageBytes.length);
    expect(catalog.getEntry(PROFILE_ID)?.storage).toEqual({ kind: 'local' });
  });

  it('rebinds continuity before a Remote target catalog switch can be observed', async () => {
    await coordinator().migrate(PROFILE_ID, {
      kind: 'remote',
      hostId: HOST_ID,
    });
    const secondHostId = 'migration-host-2';
    const secondTarget = new MigrationProvider(
      { kind: 'remote', hostId: secondHostId },
      'g2',
    );
    const secondOperationId = '10000000-0000-4000-8000-000000000002';
    const completeCatalogAuthorities: ProfileStorageRef[] = [];
    let reboundBeforeExposure = false;
    const continuity: ProfileContinuityMigrationPort = {
      prepareMigration: async () => undefined,
      activateMigration: async () => undefined,
      completeMigration: async (record) => {
        if (
          record.target.kind === 'remote' &&
          record.target.hostId === secondHostId
        ) {
          const current = catalog.getEntry(PROFILE_ID);
          if (!current) throw new Error('missing migration profile');
          completeCatalogAuthorities.push(current.storage);
          reboundBeforeExposure = true;
        }
      },
    };
    const runner = new ProfileMigrationCoordinator({
      catalog,
      resolveProvider: (storage) => {
        if (storage.kind === 'local') return source;
        return storage.hostId === HOST_ID ? target : secondTarget;
      },
      newOperationId: () => secondOperationId,
      randomNonce: () => Buffer.alloc(32, 8),
      continuity,
      onChanged: () => {
        const storage = catalog.getEntry(PROFILE_ID)?.storage;
        if (
          storage?.kind === 'remote' &&
          storage.hostId === secondHostId
        ) {
          expect(reboundBeforeExposure).toBe(true);
        }
      },
    });

    await expect(
      runner.migrate(PROFILE_ID, {
        kind: 'remote',
        hostId: secondHostId,
      }),
    ).resolves.toBeNull();
    expect(completeCatalogAuthorities).toEqual([
      { kind: 'remote', hostId: HOST_ID },
      { kind: 'remote', hostId: secondHostId },
    ]);
  });
});
