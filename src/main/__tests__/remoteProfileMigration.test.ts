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
    this.staged.delete(operationId);
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
) {
  return new ProfileMigrationCoordinator({
    catalog,
    resolveProvider: (storage) => (storage.kind === 'local' ? source : target),
    newOperationId: () => OPERATION_ID,
    randomNonce: () => Buffer.alloc(32, 7),
    logger,
    onChanged,
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
});
