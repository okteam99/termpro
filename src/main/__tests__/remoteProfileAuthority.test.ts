import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserProfile,
  BrowserProfileInput,
  ProfileMigrationPhase,
  ProfileStorageRef,
} from '../../shared/browserProfile';
import { browserPartition } from '../../shared/browserProfile';
import {
  continuityCookieIdentityKey,
  normalizeContinuityCookieIdentity,
  parseContinuityCookieChange,
  type ContinuityCookieChange,
  type ContinuityCookieIdentity,
  type ContinuityCookieRecord,
  type ContinuityMigrationActivateRequest,
  type ContinuityMigrationFreezeRequest,
  type ContinuityMigrationFreezeResult,
  type ContinuityMigrationPublishRequest,
  type ContinuityMigrationStageRequest,
  type ContinuityMigrationStageResult,
  type ContinuityMigrationVerifyRequest,
  type ContinuityMigrationVerifyResult,
  type ContinuityOperation,
  type ContinuityOperationResult,
  type ContinuityPage,
  type ProfileContinuityLifecycleResult,
} from '../../shared/profileContinuity';
import type {
  PasswordCredentialMetadata,
  PasswordMetadataQuery,
} from '../../shared/passwordVault';
import type {
  DecryptedProfileCredential,
  ProfileBundleV1,
} from '../../shared/remoteProfileStore';
import {
  ProfileAuthorityService,
  RoutedPasswordVaultError,
  type PasswordUpsertInput,
  type PasswordUpsertResult,
  type ProfileDataProvider,
} from '../profileAuthorityService';
import {
  PROFILE_CATALOG_FILE,
  ProfileCatalogError,
  ProfileCatalogStore,
} from '../profileCatalogStore';
import {
  ProfileContinuityController,
  type ContinuityCookieChangedCause,
  type ContinuityCookieStorePort,
  type ContinuityElectronCookie,
  type ProfileContinuityControllerDeps,
  type ProfileContinuityRemotePort,
} from '../profileContinuityController';
import {
  PROFILE_CONTINUITY_JOURNAL_DIRECTORY,
  ProfileContinuityJournal,
} from '../profileContinuityJournal';

const PROFILE_ID = 'a'.repeat(32);
const REMOTE_HOST_ID = 'remote-host-a';

class MemoryProvider implements ProfileDataProvider {
  generation: string | null;
  ready = true;
  readonly bundles = new Map<string, ProfileBundleV1>();
  readonly calls: string[] = [];

  constructor(
    readonly storage: ProfileStorageRef,
    generation: string | null = null,
  ) {
    this.generation = generation;
  }

  availability(): 'ready' | 'offline' {
    return this.ready ? 'ready' : 'offline';
  }

  currentGeneration(): string | null {
    return this.generation;
  }

  async createProfile(input: BrowserProfileInput): Promise<BrowserProfile> {
    const profile = { id: PROFILE_ID, name: input.name, createdAt: 1 };
    this.bundles.set(profile.id, { version: 1, profile, credentials: [] });
    return profile;
  }

  async getProfile(profileId: string): Promise<BrowserProfile> {
    this.calls.push(`get:${profileId}`);
    const bundle = this.requireBundle(profileId);
    return bundle.profile;
  }

  async writeProfile(profile: BrowserProfile): Promise<BrowserProfile> {
    this.calls.push(`write:${profile.id}`);
    const bundle = this.requireBundle(profile.id);
    this.bundles.set(profile.id, { ...bundle, profile });
    return profile;
  }

  async readBundle(profileId: string): Promise<ProfileBundleV1> {
    this.calls.push(`bundle:${profileId}`);
    return structuredClone(this.requireBundle(profileId));
  }

  async listMetadata(
    profileId: string,
    query?: PasswordMetadataQuery,
  ): Promise<PasswordCredentialMetadata[]> {
    void query;
    this.calls.push(`list:${profileId}`);
    return this.requireBundle(profileId).credentials.map((credential) => ({
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
    this.calls.push(`lookup:${profileId}`);
    return this.requireBundle(profileId).credentials.filter(
      (entry) => entry.origin === origin,
    );
  }

  async getDecrypted(
    profileId: string,
    entryId: string,
  ): Promise<DecryptedProfileCredential> {
    const entry = this.requireBundle(profileId).credentials.find(
      (candidate) => candidate.id === entryId,
    );
    if (!entry)
      throw Object.assign(new Error('fixed'), {
        code: 'VAULT_ENTRY_NOT_FOUND',
      });
    return entry;
  }

  async upsert(input: PasswordUpsertInput): Promise<PasswordUpsertResult> {
    this.calls.push(`upsert:${input.profileId}`);
    const bundle = this.requireBundle(input.profileId);
    const credential: DecryptedProfileCredential = {
      id: '00000000-0000-4000-8000-000000000001',
      profileId: input.profileId,
      origin: input.origin,
      username: input.username,
      password: input.password,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: 1,
    };
    bundle.credentials = [credential];
    const metadata: PasswordCredentialMetadata = {
      id: credential.id,
      profileId: credential.profileId,
      origin: credential.origin,
      username: credential.username,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      lastUsedAt: credential.lastUsedAt,
    };
    return { kind: 'saved', metadata };
  }

  async deleteEntry(profileId: string, entryId: string): Promise<boolean> {
    const bundle = this.requireBundle(profileId);
    const before = bundle.credentials.length;
    bundle.credentials = bundle.credentials.filter(
      (entry) => entry.id !== entryId,
    );
    return bundle.credentials.length !== before;
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    return this.bundles.delete(profileId);
  }

  async stage(): Promise<void> {
    return undefined;
  }
  async verify(): Promise<Buffer> {
    return Buffer.alloc(32);
  }
  async publish(): Promise<void> {
    return undefined;
  }
  async discard(): Promise<void> {
    return undefined;
  }

  private requireBundle(profileId: string): ProfileBundleV1 {
    if (!this.ready) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_OFFLINE',
      });
    }
    const bundle = this.bundles.get(profileId);
    if (!bundle)
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_CORRUPT',
      });
    return bundle;
  }
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-authority-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function catalog(localProfiles: BrowserProfile[] = []): ProfileCatalogStore {
  return new ProfileCatalogStore({
    userDataDir: tmpDir,
    localProfiles: () => localProfiles,
    defaultProfile: { id: 'default', name: 'Default', createdAt: 0 },
  });
}

describe('Profile remote authority catalog and router', () => {
  it('joins a discovered Remote Profile idempotently but never rebinds its authority', () => {
    const profile = { id: PROFILE_ID, name: 'Remote Work', createdAt: 10 };
    const store = catalog();

    expect(
      store.joinRemoteProfile(profile, {
        kind: 'remote',
        hostId: REMOTE_HOST_ID,
      }),
    ).toEqual(
      expect.objectContaining({
        profileId: PROFILE_ID,
        storage: { kind: 'remote', hostId: REMOTE_HOST_ID },
        lifecycle: 'active',
      }),
    );

    store.joinRemoteProfile(
      { ...profile, name: 'Renamed on Host' },
      { kind: 'remote', hostId: REMOTE_HOST_ID },
    );
    expect(store.getEntry(PROFILE_ID)?.nameHint).toBe('Renamed on Host');

    expect(() =>
      store.joinRemoteProfile(profile, {
        kind: 'remote',
        hostId: 'another-authority',
      }),
    ).toThrow(ProfileCatalogError);
    expect(store.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: REMOTE_HOST_ID,
    });
  });

  it('test_AC1_persists_one_authority_for_default_and_custom_profiles', () => {
    const custom = { id: PROFILE_ID, name: 'Work', createdAt: 10 };
    const first = catalog([custom]);
    expect(first.listEntries()).toEqual([
      expect.objectContaining({
        profileId: 'default',
        storage: { kind: 'local' },
      }),
      expect.objectContaining({
        profileId: PROFILE_ID,
        storage: { kind: 'local' },
      }),
    ]);

    const operationId = '00000000-0000-4000-8000-000000000010';
    first.beginMigration({
      operationId,
      profileId: PROFILE_ID,
      source: { kind: 'local' },
      target: { kind: 'remote', hostId: REMOTE_HOST_ID },
      phase: 'copying',
      committed: false,
      targetGeneration: 'g1',
      updatedAt: 10,
    });
    first.updateMigration(operationId, { phase: 'switching' });
    first.commitMigration(operationId, 20);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, PROFILE_CATALOG_FILE), 'utf8'),
    );
    expect(
      onDisk.profiles.find(
        (entry: { profileId: string }) => entry.profileId === PROFILE_ID,
      ).storage,
    ).toEqual({ kind: 'remote', hostId: REMOTE_HOST_ID });
    expect(onDisk.migrations[0]).toMatchObject({
      committed: true,
      phase: 'cleanup_pending',
    });
    expect(
      fs.statSync(path.join(tmpDir, PROFILE_CATALOG_FILE)).mode & 0o777,
    ).toBe(0o600);

    const restarted = catalog([]);
    expect(restarted.getEntry(PROFILE_ID)?.storage).toEqual({
      kind: 'remote',
      hostId: REMOTE_HOST_ID,
    });

    first.completeMigration(operationId);
    const defaultOperationId = '00000000-0000-4000-8000-000000000013';
    first.beginMigration({
      operationId: defaultOperationId,
      profileId: 'default',
      source: { kind: 'local' },
      target: { kind: 'remote', hostId: 'default-profile-host' },
      phase: 'copying',
      committed: false,
      targetGeneration: 'g-default',
      updatedAt: 30,
    });
    first.updateMigration(defaultOperationId, { phase: 'switching' });
    first.commitMigration(defaultOperationId, 40);
    first.completeMigration(defaultOperationId);
    expect(catalog([]).getEntry('default')?.storage).toEqual({
      kind: 'remote',
      hostId: 'default-profile-host',
    });
  });

  it('fails closed on a corrupt existing catalog and preserves its bytes', () => {
    const file = path.join(tmpDir, PROFILE_CATALOG_FILE);
    const corrupt = '{"version":1,"profiles":"local please"}';
    fs.writeFileSync(file, corrupt);
    expect(() =>
      catalog([{ id: PROFILE_ID, name: 'Must not bootstrap', createdAt: 1 }]),
    ).toThrowError(
      expect.objectContaining<Partial<ProfileCatalogError>>({
        code: 'PROFILE_CATALOG_CORRUPT',
      }),
    );
    expect(fs.readFileSync(file, 'utf8')).toBe(corrupt);
  });

  it('test_AC6_fails_closed_for_all_password_and_profile_mutations_until_current_generation_revalidates', async () => {
    const authorityCatalog = catalog([
      { id: PROFILE_ID, name: 'Local stale', createdAt: 1 },
    ]);
    const operationId = '00000000-0000-4000-8000-000000000011';
    authorityCatalog.beginMigration({
      operationId,
      profileId: PROFILE_ID,
      source: { kind: 'local' },
      target: { kind: 'remote', hostId: REMOTE_HOST_ID },
      phase: 'copying',
      committed: false,
      targetGeneration: 'g1',
      updatedAt: 1,
    });
    authorityCatalog.updateMigration(operationId, { phase: 'switching' });
    authorityCatalog.commitMigration(operationId);
    authorityCatalog.completeMigration(operationId);

    const local = new MemoryProvider({ kind: 'local' });
    const remote = new MemoryProvider(
      { kind: 'remote', hostId: REMOTE_HOST_ID },
      'g1',
    );
    local.bundles.set(PROFILE_ID, {
      version: 1,
      profile: { id: PROFILE_ID, name: 'Local stale', createdAt: 1 },
      credentials: [],
    });
    remote.bundles.set(PROFILE_ID, {
      version: 1,
      profile: { id: PROFILE_ID, name: 'Remote live', createdAt: 1 },
      credentials: [],
    });
    const service = new ProfileAuthorityService({
      catalog: authorityCatalog,
      resolveProvider: (storage) => (storage.kind === 'local' ? local : remote),
    });

    expect(
      (await service.listSummaries()).map((profile) => profile.id),
    ).toEqual(['default', PROFILE_ID]);
    expect((await service.getProfile(PROFILE_ID)).name).toBe('Remote live');
    await expect(
      service.saveProfile({ id: 'default', name: 'Mutable?' }),
    ).rejects.toMatchObject({
      code: 'PROFILE_STORAGE_INVALID_INPUT',
    });
    await service.saveProfile({ id: PROFILE_ID, name: 'Remote renamed' });
    expect(remote.calls).toContain(`write:${PROFILE_ID}`);
    expect(local.calls).not.toContain(`get:${PROFILE_ID}`);
    expect(local.calls).not.toContain(`write:${PROFILE_ID}`);

    remote.ready = false;
    service.invalidateRemoteHost(REMOTE_HOST_ID, 'g1');
    const offline = (await service.listSummaries()).find(
      (profile) => profile.id === PROFILE_ID,
    );
    expect(offline).toBeDefined();
    if (!offline) throw new Error('missing remote summary');
    expect(offline).toMatchObject({
      name: 'Remote renamed',
      availability: 'offline',
    });
    expect(offline.userAgent).toBeUndefined();
    expect(service.getCachedProfileForAttach(PROFILE_ID)).toBeNull();
    expect(service.isAvailable(PROFILE_ID)).toBe(false);
    await expect(service.getProfile(PROFILE_ID)).rejects.toMatchObject({
      code: 'PROFILE_STORAGE_OFFLINE',
    });
    await expect(
      service.listMetadata({ profileId: PROFILE_ID }),
    ).resolves.toEqual({
      entries: [],
      unavailableProfiles: [
        { profileId: PROFILE_ID, code: 'VAULT_REMOTE_AUTHORITY_OFFLINE' },
      ],
    });
    await expect(
      service.upsert({
        profileId: PROFILE_ID,
        origin: 'https://example.test',
        username: 'alice',
        password: 'must-not-queue',
      }),
    ).rejects.toMatchObject({ code: 'VAULT_REMOTE_AUTHORITY_OFFLINE' });
    expect(local.calls).not.toContain(`upsert:${PROFILE_ID}`);
  });

  it('test_AC4_migration_locks_mutations_and_reads_only_from_source_until_verified_switch', async () => {
    const authorityCatalog = catalog([
      { id: PROFILE_ID, name: 'Work', createdAt: 1 },
    ]);
    authorityCatalog.beginMigration({
      operationId: '00000000-0000-4000-8000-000000000012',
      profileId: PROFILE_ID,
      source: { kind: 'local' },
      target: { kind: 'remote', hostId: REMOTE_HOST_ID },
      phase: 'copying',
      committed: false,
      targetGeneration: 'g1',
      updatedAt: 1,
    });
    expect(() =>
      authorityCatalog.setLifecycle(PROFILE_ID, 'deleting'),
    ).toThrowError(
      expect.objectContaining<Partial<ProfileCatalogError>>({
        code: 'PROFILE_CATALOG_INVALID_TRANSITION',
      }),
    );
    expect(authorityCatalog.getEntry(PROFILE_ID)?.lifecycle).toBe('active');
    const local = new MemoryProvider({ kind: 'local' });
    const remote = new MemoryProvider(
      { kind: 'remote', hostId: REMOTE_HOST_ID },
      'g1',
    );
    local.bundles.set(PROFILE_ID, {
      version: 1,
      profile: { id: PROFILE_ID, name: 'Source', createdAt: 1 },
      credentials: [],
    });
    const service = new ProfileAuthorityService({
      catalog: authorityCatalog,
      resolveProvider: (storage) => (storage.kind === 'local' ? local : remote),
    });
    expect(await service.lookup(PROFILE_ID, 'https://example.test')).toEqual(
      [],
    );
    await expect(
      service.upsert({
        profileId: PROFILE_ID,
        origin: 'https://example.test',
        username: 'alice',
        password: 'secret',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RoutedPasswordVaultError>>({
        code: 'VAULT_MIGRATION_IN_PROGRESS',
      }),
    );
    expect(remote.calls).toEqual([]);
  });
});

class MemoryCookieStore implements ContinuityCookieStorePort {
  readonly setCalls: Array<Record<string, unknown>> = [];
  readonly removeCalls: Array<{ url: string; name: string }> = [];
  failValue: string | null = null;
  private readonly listeners = new Set<
    Parameters<ContinuityCookieStorePort['on']>[1]
  >();

  constructor(readonly cookies: ContinuityElectronCookie[] = []) {}

  async get(): Promise<ContinuityElectronCookie[]> {
    return structuredClone(this.cookies);
  }

  async set(details: Record<string, unknown>): Promise<void> {
    if (details.value === this.failValue) throw new Error('fixed');
    this.setCalls.push(structuredClone(details));
    const url = new URL(String(details.url));
    this.emit(
      {
        name: String(details.name),
        value: String(details.value),
        domain:
          typeof details.domain === 'string' ? details.domain : url.hostname,
        hostOnly: details.domain === undefined,
        path: String(details.path ?? '/'),
        secure: details.secure === true,
        httpOnly: details.httpOnly === true,
        session: false,
        expirationDate: Number(details.expirationDate),
        sameSite: (details.sameSite ?? 'unspecified') as ContinuityElectronCookie['sameSite'],
      },
      'explicit',
      false,
    );
  }

  async remove(url: string, name: string): Promise<void> {
    this.removeCalls.push({ url, name });
  }

  on(
    _event: 'changed',
    listener: Parameters<ContinuityCookieStorePort['on']>[1],
  ): void {
    this.listeners.add(listener);
  }

  removeListener(
    _event: 'changed',
    listener: Parameters<ContinuityCookieStorePort['on']>[1],
  ): void {
    this.listeners.delete(listener);
  }

  emit(
    cookie: ContinuityElectronCookie,
    cause: ContinuityCookieChangedCause,
    removed: boolean,
  ): void {
    for (const listener of this.listeners) {
      listener({}, cookie, cause, removed);
    }
  }
}

class MemoryContinuityProvider implements ProfileContinuityRemotePort {
  generation: string | null = 'generation-1';
  lifecycle: ProfileContinuityLifecycleResult = {
    profileId: PROFILE_ID,
    epoch: 1,
    lifecycle: 'active',
  };
  records: ContinuityCookieRecord[] = [];
  readonly pushed: ContinuityOperation[] = [];
  private readonly operationResults = new Map<
    string,
    ContinuityOperationResult
  >();
  lifecycleBarrier: Promise<void> | null = null;
  migrationRecords: ContinuityCookieRecord[] = [];
  migrationRevision = 0;
  frozenNonce: string | null = null;
  frozenDigest: string | null = null;
  failMigrationPublishOnce = false;
  readonly verifiedNonces: string[] = [];

  currentGeneration(): string | null {
    return this.generation;
  }

  async describeContinuity(): Promise<unknown> {
    return { version: 1 };
  }

  async getContinuityLifecycle(): Promise<ProfileContinuityLifecycleResult> {
    await this.lifecycleBarrier;
    return structuredClone(this.lifecycle);
  }

  async pullContinuity(
    profileId: string,
    request: { fromRevision: number; pageBytes: number },
  ): Promise<ContinuityPage> {
    void request.pageBytes;
    const records = this.records.filter(
      (record) => record.revision > request.fromRevision,
    );
    return {
      profileId,
      epoch: this.lifecycle.epoch,
      fromRevision: request.fromRevision,
      records: structuredClone(records),
      nextRevision:
        records.at(-1)?.revision ??
        Math.max(request.fromRevision, this.records.at(-1)?.revision ?? 0),
      hasMore: false,
    };
  }

  async pushContinuity(
    _profileId: string,
    operation: ContinuityOperation,
  ): Promise<ContinuityOperationResult> {
    if (this.lifecycle.lifecycle !== 'active') {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_FORBIDDEN',
      });
    }
    const duplicate = this.operationResults.get(operation.operationId);
    if (duplicate) return { ...structuredClone(duplicate), outcome: 'duplicate' };
    this.pushed.push(structuredClone(operation));
    const revision = (this.records.at(-1)?.revision ?? 0) + 1;
    const current: ContinuityCookieRecord = {
      ...structuredClone(operation.change),
      revision,
    };
    const identityKey = continuityCookieIdentityKey(current.identity);
    const existingIndex = this.records.findIndex(
      (record) =>
        continuityCookieIdentityKey(record.identity) === identityKey,
    );
    if (existingIndex >= 0) this.records[existingIndex] = current;
    else this.records.push(current);
    const result: ContinuityOperationResult = {
      operationId: operation.operationId,
      revision,
      outcome: 'accepted',
      current,
    };
    this.operationResults.set(operation.operationId, result);
    return structuredClone(result);
  }

  async stageContinuityMigration(
    _profileId: string,
    request: ContinuityMigrationStageRequest,
  ): Promise<ContinuityMigrationStageResult> {
    const records = new Map(
      this.migrationRecords.map((record) => [
        continuityCookieIdentityKey(record.identity),
        record,
      ]),
    );
    for (const record of request.page.records) {
      records.set(continuityCookieIdentityKey(record.identity), record);
    }
    this.migrationRecords = [...records.values()];
    this.migrationRevision = request.page.nextRevision;
    return {
      operationId: request.operationId,
      confirmedRevision: this.migrationRevision,
      stagedCount: this.migrationRecords.length,
      duplicate: false,
    };
  }

  async verifyContinuityMigration(
    _profileId: string,
    request: ContinuityMigrationVerifyRequest,
  ): Promise<ContinuityMigrationVerifyResult> {
    if (this.migrationRevision === 0 && this.migrationRecords.length === 0) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_INVALID_INPUT',
      });
    }
    this.verifiedNonces.push(request.nonce);
    return {
      operationId: request.operationId,
      revision: this.migrationRevision,
      digest: this.migrationDigest(request.nonce, this.migrationRecords),
    };
  }

  async freezeContinuityMigration(
    profileId: string,
    request: ContinuityMigrationFreezeRequest,
  ): Promise<ContinuityMigrationFreezeResult> {
    if (!this.frozenNonce) {
      this.frozenNonce = request.nonce;
      this.frozenDigest = this.migrationDigest(request.nonce, this.records);
      this.lifecycle = {
        profileId,
        epoch: request.expectedEpoch,
        lifecycle: 'moving',
      };
    }
    if (!this.frozenDigest) throw new Error('missing frozen digest');
    return {
      operationId: request.operationId,
      profileId,
      epoch: this.lifecycle.epoch,
      lifecycle: 'moving',
      revision: this.records.at(-1)?.revision ?? 0,
      digest: this.frozenDigest,
    };
  }

  async publishContinuityMigration(
    profileId: string,
    request: ContinuityMigrationPublishRequest,
  ): Promise<ContinuityMigrationFreezeResult> {
    if (this.failMigrationPublishOnce) {
      this.failMigrationPublishOnce = false;
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_OFFLINE',
      });
    }
    this.lifecycle = {
      profileId,
      epoch: 1,
      lifecycle: 'moving',
    };
    return {
      operationId: request.operationId,
      profileId,
      epoch: 1,
      lifecycle: 'moving',
      revision: request.expectedRevision,
      digest: request.verifiedDigest,
    };
  }

  async activateContinuityMigration(
    profileId: string,
    request: ContinuityMigrationActivateRequest,
  ): Promise<ProfileContinuityLifecycleResult> {
    this.lifecycle = {
      profileId,
      epoch: request.epoch,
      lifecycle: 'active',
    };
    return structuredClone(this.lifecycle);
  }

  async discardContinuityMigration(): Promise<unknown> {
    return { discarded: true };
  }

  private migrationDigest(
    nonce: string,
    records: ContinuityCookieRecord[],
  ): string {
    return createHmac('sha256', Buffer.from(nonce, 'base64url'))
      .update(JSON.stringify(records))
      .digest('base64url');
  }
}

function persistentCookie(
  value: string,
  name = 'sid',
): ContinuityElectronCookie {
  return {
    name,
    value,
    domain: 'example.com',
    hostOnly: true,
    path: '/',
    secure: true,
    httpOnly: true,
    session: false,
    expirationDate: 2_000_000_000,
    sameSite: 'lax',
  };
}

function cookieRecord(
  revision: number,
  value: string,
  name = 'sid',
): ContinuityCookieRecord {
  return {
    identity: {
      domain: 'example.com',
      hostOnly: true,
      path: '/',
      name,
    },
    kind: 'upsert',
    value,
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: 2_000_000_000,
    revision,
  };
}

function continuityHarness(options: {
  provider?: MemoryContinuityProvider;
  targetProvider?: MemoryContinuityProvider;
  cookieStore?: MemoryCookieStore;
  operationIds?: string[];
  storage?: () => ProfileStorageRef;
  migrationPhase?: () => ProfileMigrationPhase | null;
  partitionsOfProfile?: () => string[];
  isKnownPartition?: (partition: string) => boolean;
  validatePartition?: (partition: string, profileId: string) => boolean;
  onRetired?: ProfileContinuityControllerDeps['onRetired'];
} = {}) {
  const provider = options.provider ?? new MemoryContinuityProvider();
  const cookieStore = options.cookieStore ?? new MemoryCookieStore();
  const partition = browserPartition(PROFILE_ID, 'local');
  const operationIds =
    options.operationIds ?? [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ];
  const journal = new ProfileContinuityJournal<
    ContinuityCookieIdentity,
    ContinuityCookieChange
  >({
    userDataDir: tmpDir,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plaintext) => Buffer.from(`sealed:${plaintext}`),
      decryptString: (encrypted) =>
        encrypted.toString('utf8').replace(/^sealed:/, ''),
    },
    validateIdentity: (value): value is ContinuityCookieIdentity => {
      try {
        normalizeContinuityCookieIdentity(value);
        return true;
      } catch {
        return false;
      }
    },
    identityKey: continuityCookieIdentityKey,
    validateChange: (value): value is ContinuityCookieChange => {
      try {
        parseContinuityCookieChange(value);
        return true;
      } catch {
        return false;
      }
    },
    validatePartition:
      options.validatePartition ?? ((candidate) => candidate === partition),
  });
  const controller = new ProfileContinuityController({
    clientId: 'd'.repeat(43),
    getCatalogEntry: (profileId) =>
      profileId === PROFILE_ID
        ? {
            profileId,
            storage:
              options.storage?.() ??
              ({ kind: 'remote', hostId: REMOTE_HOST_ID } as const),
            lifecycle: 'active',
          }
        : null,
    getMigrationPhase: options.migrationPhase,
    remoteProvider: (hostId) =>
      hostId === 'remote-host-target' && options.targetProvider
        ? options.targetProvider
        : provider,
    partitionsOfProfile: options.partitionsOfProfile ?? (() => [partition]),
    isKnownPartition:
      options.isKnownPartition ?? ((candidate) => candidate === partition),
    cookiesForPartition: () => cookieStore,
    journal,
    onRetired: options.onRetired,
    newOperationId: () => {
      const next = operationIds.shift();
      if (!next) throw new Error('operation id fixture exhausted');
      return next;
    },
    logger: { warn: vi.fn(), error: vi.fn() },
  });
  return { controller, provider, cookieStore, journal, partition };
}

async function drainContinuityQueue(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('Remote Profile Cookie continuity controller', () => {
  it('test_AC1_hydration_gate_blocks_navigation_until_current_generation_finishes', async () => {
    const provider = new MemoryContinuityProvider();
    let release!: () => void;
    provider.lifecycleBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { controller, cookieStore, partition } = continuityHarness({ provider });

    const preparation = controller.prepare(PROFILE_ID, 'local');
    await drainContinuityQueue();
    expect(cookieStore.setCalls).toHaveLength(0);
    expect(controller.isHydrated(PROFILE_ID, partition, 'generation-1')).toBe(false);

    release();
    await expect(preparation).resolves.toEqual(
      expect.objectContaining({ ready: true }),
    );
    expect(controller.isHydrated(PROFILE_ID, partition, 'generation-1')).toBe(true);
    controller.dispose();
  });

  it('test_AC2_applies_authoritative_persistent_cookie_once_and_skips_session_cookie', async () => {
    const provider = new MemoryContinuityProvider();
    provider.records = [cookieRecord(1, 'remote-value')];
    const cookieStore = new MemoryCookieStore([
      { ...persistentCookie('local-session'), session: true, expirationDate: undefined },
    ]);
    const { controller } = continuityHarness({ provider, cookieStore });

    await expect(controller.prepare(PROFILE_ID, 'local')).resolves.toEqual(
      expect.objectContaining({ ready: true, syncedCount: 1, skippedCount: 1 }),
    );
    expect(cookieStore.setCalls).toHaveLength(1);
    expect(provider.pushed).toHaveLength(0);
    cookieStore.emit(
      {
        ...persistentCookie('local-session'),
        session: true,
        expirationDate: undefined,
      },
      'explicit',
      true,
    );
    await drainContinuityQueue();
    expect(provider.pushed).toHaveLength(0);
    expect(controller.summary(PROFILE_ID)).toEqual(
      expect.objectContaining({
        pendingCount: 0,
        skippedCount: 1,
        reasons: ['COOKIE_SESSION_POLICY'],
      }),
    );
    controller.dispose();
  });

  it('test_AC6_offline_cookie_changes_survive_restart_and_commit_after_reconnect', async () => {
    const first = continuityHarness({
      cookieStore: new MemoryCookieStore(),
      operationIds: ['00000000-0000-4000-8000-000000000011'],
    });
    await first.controller.prepare(PROFILE_ID, 'local');
    first.provider.generation = null;
    first.cookieStore.emit(persistentCookie('offline-change'), 'explicit', false);
    await drainContinuityQueue();
    const persisted = first.journal.load(PROFILE_ID, {
      hostId: REMOTE_HOST_ID,
      epoch: 1,
    });
    expect(persisted.pending).toHaveLength(1);
    const stableOperationId = persisted.pending[0].operationId;
    first.controller.dispose();

    const recoveredProvider = new MemoryContinuityProvider();
    recoveredProvider.generation = 'generation-2';
    const recovered = continuityHarness({
      provider: recoveredProvider,
      cookieStore: first.cookieStore,
      operationIds: ['00000000-0000-4000-8000-000000000012'],
    });
    await recovered.controller.prepare(PROFILE_ID, 'local');
    expect(recoveredProvider.pushed.map((operation) => operation.operationId)).toEqual([
      stableOperationId,
    ]);
    expect(
      recovered.journal.load(PROFILE_ID, {
        hostId: REMOTE_HOST_ID,
        epoch: 1,
      }).pending,
    ).toHaveLength(0);
    recovered.controller.dispose();
  });

  it('test_AC6_late_generation_response_is_ignored_and_new_navigation_remains_gated', async () => {
    const provider = new MemoryContinuityProvider();
    let release!: () => void;
    provider.lifecycleBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { controller, partition } = continuityHarness({ provider });

    const oldPreparation = controller.prepare(PROFILE_ID, 'local');
    await drainContinuityQueue();
    provider.generation = 'generation-2';
    release();
    await expect(oldPreparation).resolves.toEqual(
      expect.objectContaining({ ready: false }),
    );
    expect(controller.isHydrated(PROFILE_ID, partition, 'generation-1')).toBe(false);
    expect(controller.isHydrated(PROFILE_ID, partition, 'generation-2')).toBe(false);

    provider.lifecycleBarrier = null;
    await expect(controller.prepare(PROFILE_ID, 'local')).resolves.toEqual(
      expect.objectContaining({ ready: true }),
    );
    expect(controller.isHydrated(PROFILE_ID, partition, 'generation-2')).toBe(true);
    controller.dispose();
  });

  it('test_AC8_invalid_or_oversize_cookie_is_skipped_without_rolling_back_confirmed_pages', async () => {
    const provider = new MemoryContinuityProvider();
    provider.records = [
      cookieRecord(1, 'cannot-apply', 'broken'),
      cookieRecord(2, 'valid', 'working'),
    ];
    const cookieStore = new MemoryCookieStore([
      persistentCookie('x'.repeat(70 * 1024), 'oversize'),
    ]);
    cookieStore.failValue = 'cannot-apply';
    const first = continuityHarness({ provider, cookieStore });

    await first.controller.prepare(PROFILE_ID, 'local');
    expect(first.controller.summary(PROFILE_ID)).toEqual(
      expect.objectContaining({ syncedCount: 1, skippedCount: 2, pendingCount: 0 }),
    );
    expect(first.controller.summary(PROFILE_ID).reasons).toEqual(
      expect.arrayContaining(['COOKIE_TOO_LARGE', 'COOKIE_APPLY_FAILED']),
    );
    expect(
      first.journal.load(PROFILE_ID, {
        hostId: REMOTE_HOST_ID,
        epoch: 1,
      }).confirmedRevision,
    ).toBe(2);

    provider.generation = 'generation-2';
    await first.controller.prepare(PROFILE_ID, 'local');
    expect(first.controller.summary(PROFILE_ID)).toEqual(
      expect.objectContaining({ syncedCount: 1, skippedCount: 2 }),
    );
    expect(cookieStore.setCalls.filter((call) => call.value === 'valid')).toHaveLength(1);
    first.controller.dispose();
  });

  for (const phase of ['copying', 'verifying'] as const) {
    it(`keeps source hydration available during ${phase}`, async () => {
      const source = new MemoryContinuityProvider();
      source.records = [cookieRecord(1, 'source-session')];
      const lifecycleRequest = vi.spyOn(source, 'getContinuityLifecycle');
      const pullRequest = vi.spyOn(source, 'pullContinuity');
      const h = continuityHarness({
        provider: source,
        storage: () => ({ kind: 'remote', hostId: REMOTE_HOST_ID }),
        migrationPhase: () => phase,
      });

      await expect(h.controller.prepare(PROFILE_ID, 'local')).resolves.toEqual(
        expect.objectContaining({ ready: true, syncedCount: 1 }),
      );
      expect(lifecycleRequest).toHaveBeenCalledTimes(1);
      expect(pullRequest).toHaveBeenCalledTimes(1);
      expect(h.cookieStore.setCalls).toEqual([
        expect.objectContaining({ value: 'source-session' }),
      ]);
      h.controller.dispose();
    });
  }

  it('sends no hydration request after migration enters switching', async () => {
    const source = new MemoryContinuityProvider();
    source.records = [cookieRecord(1, 'source-session')];
    const generationRequest = vi.spyOn(source, 'currentGeneration');
    const lifecycleRequest = vi.spyOn(source, 'getContinuityLifecycle');
    const pullRequest = vi.spyOn(source, 'pullContinuity');
    const h = continuityHarness({
      provider: source,
      storage: () => ({ kind: 'remote', hostId: REMOTE_HOST_ID }),
      migrationPhase: () => 'switching',
    });

    await expect(h.controller.prepare(PROFILE_ID, 'local')).resolves.toEqual({
      ready: false,
      reason: 'PROFILE_CONTINUITY_OFFLINE',
      canRetry: false,
    });
    expect(generationRequest).not.toHaveBeenCalled();
    expect(lifecycleRequest).not.toHaveBeenCalled();
    expect(pullRequest).not.toHaveBeenCalled();
    expect(h.cookieStore.setCalls).toEqual([]);
    h.controller.dispose();
  });

  it('retries retired-profile cleanup with current and historical partitions', async () => {
    const provider = new MemoryContinuityProvider();
    provider.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'moved',
      movedTo: 'local',
    };
    const currentPartition = browserPartition(PROFILE_ID, 'local');
    const historicalPartition = browserPartition(PROFILE_ID, 'removed-host');
    const cleanupCalls: string[][] = [];
    let failCleanup = true;
    const h = continuityHarness({
      provider,
      partitionsOfProfile: () => [currentPartition],
      isKnownPartition: (candidate) => candidate === currentPartition,
      validatePartition: (candidate, profileId) =>
        profileId === PROFILE_ID &&
        (candidate === currentPartition || candidate === historicalPartition),
      onRetired: async (_profileId, _lifecycle, partitions) => {
        cleanupCalls.push([...partitions]);
        expect(
          fs.existsSync(
            path.join(
              tmpDir,
              PROFILE_CONTINUITY_JOURNAL_DIRECTORY,
              `${PROFILE_ID}.journal`,
            ),
          ),
        ).toBe(true);
        if (failCleanup) {
          throw Object.assign(new Error('fixed'), {
            code: 'PROFILE_STORAGE_IO_FAILED',
          });
        }
      },
    });
    h.journal.save({
      ...h.journal.load(PROFILE_ID, {
        hostId: REMOTE_HOST_ID,
        epoch: 1,
      }),
      seededPartitions: [historicalPartition],
    });

    await expect(h.controller.prepare(PROFILE_ID, 'local')).resolves.toEqual(
      expect.objectContaining({ ready: false, canRetry: true }),
    );
    expect(cleanupCalls).toEqual([[currentPartition, historicalPartition]]);
    expect(h.journal.listSeededPartitions(PROFILE_ID)).toEqual([
      historicalPartition,
    ]);

    failCleanup = false;
    await expect(h.controller.prepare(PROFILE_ID, 'local')).resolves.toEqual({
      ready: false,
      reason: 'PROFILE_MOVED',
      canRetry: false,
    });
    expect(cleanupCalls).toEqual([
      [currentPartition, historicalPartition],
      [currentPartition, historicalPartition],
    ]);
    expect(h.journal.listSeededPartitions(PROFILE_ID)).toEqual([]);
    h.controller.dispose();
  });

  it('preserves Chromium partitions when the Remote-to-Local initiator observes retirement', async () => {
    const provider = new MemoryContinuityProvider();
    provider.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'moved',
      movedTo: 'local',
    };
    const currentPartition = browserPartition(PROFILE_ID, 'local');
    const historicalPartition = browserPartition(PROFILE_ID, 'removed-host');
    const onRetired = vi.fn();
    const h = continuityHarness({
      provider,
      migrationPhase: () => 'cleanup_pending',
      validatePartition: (candidate, profileId) =>
        profileId === PROFILE_ID &&
        (candidate === currentPartition || candidate === historicalPartition),
      onRetired,
    });
    h.journal.save({
      ...h.journal.load(PROFILE_ID, {
        hostId: REMOTE_HOST_ID,
        epoch: 1,
      }),
      seededPartitions: [historicalPartition],
    });

    await h.controller.probe(PROFILE_ID);
    expect(onRetired).not.toHaveBeenCalled();
    expect(h.journal.listSeededPartitions(PROFILE_ID)).toEqual([
      historicalPartition,
    ]);

    await h.controller.completeMigration({
      operationId: '90000000-0000-4000-8000-000000000002',
      profileId: PROFILE_ID,
      source: { kind: 'remote', hostId: REMOTE_HOST_ID },
      target: { kind: 'local' },
      phase: 'cleanup_pending',
      committed: true,
      sourceGeneration: 'generation-1',
      updatedAt: 1,
    });
    expect(onRetired).not.toHaveBeenCalled();
    expect(h.journal.listSeededPartitions(PROFILE_ID)).toEqual([]);
    h.controller.dispose();
  });

  it('rebinds a stable post-freeze Cookie deletion and replays it after target activation', async () => {
    const source = new MemoryContinuityProvider();
    source.records = [cookieRecord(1, 'signed-in')];
    const target = new MemoryContinuityProvider();
    target.generation = 'target-generation-1';
    target.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'active',
    };
    target.records = [cookieRecord(1, 'signed-in')];
    let storage: ProfileStorageRef = {
      kind: 'remote',
      hostId: REMOTE_HOST_ID,
    };
    let migrationPhase: ProfileMigrationPhase | null = null;
    const stableOperationId = '00000000-0000-4000-8000-000000000021';
    const h = continuityHarness({
      provider: source,
      targetProvider: target,
      operationIds: [stableOperationId],
      storage: () => storage,
      migrationPhase: () => migrationPhase,
    });

    await h.controller.prepare(PROFILE_ID, 'local');
    migrationPhase = 'switching';
    source.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 1,
      lifecycle: 'moving',
    };
    h.cookieStore.emit(persistentCookie('signed-in'), 'explicit', true);
    await drainContinuityQueue();
    expect(
      h.journal.load(PROFILE_ID, {
        hostId: REMOTE_HOST_ID,
        epoch: 1,
      }).pending,
    ).toEqual([
      expect.objectContaining({
        operationId: stableOperationId,
        profileEpoch: 1,
        change: expect.objectContaining({ kind: 'tombstone' }),
      }),
    ]);

    source.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'moved',
      movedTo: 'remote',
    };
    storage = { kind: 'remote', hostId: 'remote-host-target' };
    await h.controller.completeMigration({
      operationId: '90000000-0000-4000-8000-000000000001',
      profileId: PROFILE_ID,
      source: { kind: 'remote', hostId: REMOTE_HOST_ID },
      target: { kind: 'remote', hostId: 'remote-host-target' },
      phase: 'cleanup_pending',
      committed: true,
      sourceGeneration: 'generation-1',
      targetGeneration: 'target-generation-1',
      updatedAt: 1,
    });

    expect(target.pushed).toEqual([
      expect.objectContaining({
        operationId: stableOperationId,
        profileEpoch: 2,
        change: expect.objectContaining({ kind: 'tombstone' }),
      }),
    ]);
    expect(
      h.journal.load(PROFILE_ID, {
        hostId: 'remote-host-target',
        epoch: 2,
      }).pending,
    ).toEqual([]);
    expect(target.records.at(-1)).toEqual(
      expect.objectContaining({ kind: 'tombstone', revision: 2 }),
    );
    migrationPhase = null;
    h.controller.dispose();
  });

  it('reuses the operation-scoped digest nonce after a frozen-source retry', async () => {
    const source = new MemoryContinuityProvider();
    source.records = [cookieRecord(1, 'source-value')];
    const target = new MemoryContinuityProvider();
    target.generation = 'target-generation-1';
    target.failMigrationPublishOnce = true;
    const h = continuityHarness({
      provider: source,
      targetProvider: target,
      storage: () => ({ kind: 'remote', hostId: REMOTE_HOST_ID }),
      migrationPhase: () => 'switching',
    });
    const record = {
      operationId: '80000000-0000-4000-8000-000000000001',
      profileId: PROFILE_ID,
      source: { kind: 'remote' as const, hostId: REMOTE_HOST_ID },
      target: {
        kind: 'remote' as const,
        hostId: 'remote-host-target',
      },
      phase: 'switching' as const,
      committed: false,
      sourceGeneration: 'generation-1',
      targetGeneration: 'target-generation-1',
      updatedAt: 1,
    };

    await expect(h.controller.prepareMigration(record)).rejects.toMatchObject({
      code: 'PROFILE_STORAGE_OFFLINE',
    });
    expect(source.lifecycle.lifecycle).toBe('moving');
    expect(source.frozenNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (!source.frozenNonce) throw new Error('missing frozen nonce');

    await expect(h.controller.prepareMigration(record)).resolves.toBeUndefined();
    expect(target.verifiedNonces.length).toBeGreaterThanOrEqual(2);
    expect(new Set(target.verifiedNonces)).toEqual(
      new Set([source.frozenNonce]),
    );
    h.controller.dispose();
  });

  it('continues an activate-response-lost retry after target staging was consumed', async () => {
    const source = new MemoryContinuityProvider();
    source.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'moved',
      movedTo: 'remote',
    };
    const target = new MemoryContinuityProvider();
    target.generation = 'target-generation-1';
    target.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'active',
    };
    const h = continuityHarness({
      provider: source,
      targetProvider: target,
      storage: () => ({ kind: 'remote', hostId: REMOTE_HOST_ID }),
      migrationPhase: () => 'switching',
    });
    const record = {
      operationId: '80000000-0000-4000-8000-000000000002',
      profileId: PROFILE_ID,
      source: { kind: 'remote' as const, hostId: REMOTE_HOST_ID },
      target: {
        kind: 'remote' as const,
        hostId: 'remote-host-target',
      },
      phase: 'switching' as const,
      committed: false,
      sourceGeneration: 'generation-1',
      targetGeneration: 'target-generation-1',
      updatedAt: 1,
    };

    await expect(h.controller.prepareMigration(record)).resolves.toBeUndefined();
    expect(target.verifiedNonces).toEqual([]);
    await expect(
      h.controller.activateMigration(record, 2),
    ).resolves.toBeUndefined();
    expect(target.lifecycle).toEqual({
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'active',
    });
    h.controller.dispose();
  });

  it('gates target hydration while a committed catalog still has a source-bound journal', async () => {
    const source = new MemoryContinuityProvider();
    const target = new MemoryContinuityProvider();
    target.generation = 'target-generation-1';
    target.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'active',
    };
    const stableOperationId = '00000000-0000-4000-8000-000000000031';
    const h = continuityHarness({
      provider: source,
      targetProvider: target,
      storage: () => ({
        kind: 'remote',
        hostId: 'remote-host-target',
      }),
      migrationPhase: () => 'cleanup_pending',
    });
    const sourceDocument = h.journal.load(PROFILE_ID, {
      hostId: REMOTE_HOST_ID,
      epoch: 1,
    });
    h.journal.appendPending(sourceDocument, {
      deviceId: 'd'.repeat(43),
      operationId: stableOperationId,
      profileEpoch: 1,
      baseRevision: 0,
      change: {
        identity: cookieRecord(1, 'signed-in').identity,
        kind: 'tombstone',
      },
    });

    await expect(h.controller.prepare(PROFILE_ID, 'local')).resolves.toEqual({
      ready: false,
      reason: 'PROFILE_CONTINUITY_OFFLINE',
      canRetry: false,
    });
    expect(target.pushed).toEqual([]);
    expect(
      h.journal.load(PROFILE_ID, {
        hostId: REMOTE_HOST_ID,
        epoch: 1,
      }).pending,
    ).toEqual([
      expect.objectContaining({ operationId: stableOperationId }),
    ]);
    h.controller.dispose();
  });

  it('resumes target-bound pending replay after restart before catalog commit', async () => {
    const source = new MemoryContinuityProvider();
    source.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'moved',
      movedTo: 'remote',
    };
    const target = new MemoryContinuityProvider();
    target.generation = 'target-generation-1';
    target.lifecycle = {
      profileId: PROFILE_ID,
      epoch: 2,
      lifecycle: 'active',
    };
    target.records = [cookieRecord(1, 'signed-in')];
    const stableOperationId = '00000000-0000-4000-8000-000000000032';
    const first = continuityHarness({ provider: source });
    const sourceDocument = first.journal.appendPending(
      first.journal.load(PROFILE_ID, {
        hostId: REMOTE_HOST_ID,
        epoch: 1,
      }),
      {
        deviceId: 'd'.repeat(43),
        operationId: stableOperationId,
        profileEpoch: 1,
        baseRevision: 1,
        change: {
          identity: cookieRecord(1, 'signed-in').identity,
          kind: 'tombstone',
        },
      },
    );
    first.journal.save({
      ...sourceDocument,
      authority: { hostId: 'remote-host-target', epoch: 2 },
      confirmedRevision: 0,
      pending: sourceDocument.pending.map((operation) => ({
        ...operation,
        profileEpoch: 2,
      })),
    });
    first.controller.dispose();

    const restarted = continuityHarness({
      provider: source,
      targetProvider: target,
      cookieStore: first.cookieStore,
      storage: () => ({ kind: 'remote', hostId: REMOTE_HOST_ID }),
      migrationPhase: () => 'switching',
    });
    const record = {
      operationId: '80000000-0000-4000-8000-000000000003',
      profileId: PROFILE_ID,
      source: { kind: 'remote' as const, hostId: REMOTE_HOST_ID },
      target: {
        kind: 'remote' as const,
        hostId: 'remote-host-target',
      },
      phase: 'switching' as const,
      committed: false,
      sourceGeneration: 'generation-1',
      targetGeneration: 'target-generation-1',
      updatedAt: 1,
    };

    await restarted.controller.completeMigration(record);
    expect(target.pushed).toEqual([
      expect.objectContaining({
        operationId: stableOperationId,
        profileEpoch: 2,
        change: expect.objectContaining({ kind: 'tombstone' }),
      }),
    ]);
    expect(
      restarted.journal.load(PROFILE_ID, {
        hostId: 'remote-host-target',
        epoch: 2,
      }).pending,
    ).toEqual([]);
    restarted.controller.dispose();
  });
});
