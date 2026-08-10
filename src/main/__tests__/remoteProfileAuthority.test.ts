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
