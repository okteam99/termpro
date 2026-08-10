import {
  DEFAULT_PROFILE_ID,
  type BrowserProfile,
  type BrowserProfileInput,
  type BrowserProfileSummary,
  type ProfileMigrationStatus,
  type ProfileStorageAvailability,
  type ProfileStorageErrorCode,
  type ProfileStorageRef,
} from '../shared/browserProfile';
import type {
  PasswordCredentialMetadata,
  PasswordMetadataQuery,
  PasswordMetadataSnapshot,
  PasswordVaultErrorCode,
} from '../shared/passwordVault';
import type {
  DecryptedProfileCredential,
  ProfileBundleV1,
} from '../shared/remoteProfileStore';
import {
  ProfileCatalogError,
  ProfileCatalogStore,
  profileStorageRefEquals,
  type ProfileCatalogEntryV1,
  type ProfileMigrationRecordV1,
} from './profileCatalogStore';

export interface PasswordUpsertInput {
  profileId: string;
  origin: string;
  username: string;
  password: string;
  now?: number;
}

export interface PasswordUpsertResult {
  kind: 'saved' | 'updated';
  metadata: PasswordCredentialMetadata;
}

/** A provider instance is bound to exactly one local or Remote Host storage location. */
export interface ProfileDataProvider {
  readonly storage: ProfileStorageRef;
  availability(): ProfileStorageAvailability;
  currentGeneration(): string | null;
  isVaultAvailable?(): boolean;
  createProfile(input: BrowserProfileInput): Promise<BrowserProfile>;
  getProfile(profileId: string): Promise<BrowserProfile>;
  writeProfile(profile: BrowserProfile): Promise<BrowserProfile>;
  readBundle(profileId: string): Promise<ProfileBundleV1>;
  listMetadata(
    profileId: string,
    query?: PasswordMetadataQuery,
  ): Promise<PasswordCredentialMetadata[]>;
  lookup(
    profileId: string,
    origin: string,
  ): Promise<DecryptedProfileCredential[]>;
  getDecrypted(
    profileId: string,
    entryId: string,
  ): Promise<DecryptedProfileCredential>;
  upsert(input: PasswordUpsertInput): Promise<PasswordUpsertResult>;
  deleteEntry(profileId: string, entryId: string): Promise<boolean>;
  deleteProfile(profileId: string): Promise<boolean>;
  /**
   * A Remote migration must retire its former authority as `moved`, not reuse
   * the destructive delete path. The migration operation id is the durable
   * idempotency key used again after a cleanup_pending restart.
   */
  retireAfterMigration?(
    profileId: string,
    operationId: string,
    movedTo: 'remote' | 'local',
  ): Promise<number>;
  stage(operationId: string, bundle: ProfileBundleV1): Promise<void>;
  verify(operationId: string, nonce: Buffer): Promise<Buffer>;
  publish(operationId: string, profileId: string): Promise<void>;
  discard(operationId: string): Promise<void>;
  invalidate?(generation?: string): void;
}

export type ProfileProviderResolver = (
  storage: ProfileStorageRef,
) => ProfileDataProvider;

export class ProfileAuthorityError extends Error {
  constructor(readonly code: ProfileStorageErrorCode) {
    super(code);
    this.name = 'ProfileAuthorityError';
  }
}

export class RoutedPasswordVaultError extends Error {
  constructor(readonly code: PasswordVaultErrorCode) {
    super(code);
    this.name = 'RoutedPasswordVaultError';
  }
}

export interface ProfileAuthorityServiceDeps {
  catalog: ProfileCatalogStore;
  resolveProvider: ProfileProviderResolver;
  storageLabel?: (storage: ProfileStorageRef) => string;
  onRemoteInvalidated?: (profileIds: string[]) => void;
  logger?: { warn(message: string): void; error(message: string): void };
}

interface CachedProfile {
  profile: BrowserProfile;
  storage: ProfileStorageRef;
  generation: string;
}

const PROFILE_STORAGE_CODES = new Set<ProfileStorageErrorCode>([
  'PROFILE_STORAGE_TARGET_UNAVAILABLE',
  'PROFILE_STORAGE_INCOMPATIBLE',
  'PROFILE_STORAGE_OFFLINE',
  'PROFILE_STORAGE_TIMEOUT',
  'PROFILE_STORAGE_ENCRYPTION_UNAVAILABLE',
  'PROFILE_STORAGE_CORRUPT',
  'PROFILE_STORAGE_PROFILE_MISMATCH',
  'PROFILE_STORAGE_FORBIDDEN',
  'PROFILE_STORAGE_INVALID_INPUT',
  'PROFILE_STORAGE_IO_FAILED',
  'PROFILE_MIGRATION_IN_PROGRESS',
]);

const VAULT_CODES = new Set<PasswordVaultErrorCode>([
  'VAULT_ENCRYPTION_UNAVAILABLE',
  'VAULT_CORRUPT',
  'VAULT_DECRYPT_FAILED',
  'VAULT_ENTRY_NOT_FOUND',
  'VAULT_FORBIDDEN',
  'VAULT_INVALID_INPUT',
  'VAULT_INSECURE_ORIGIN',
  'VAULT_IO_FAILED',
  'VAULT_PROFILE_INACTIVE',
  'VAULT_REMOTE_AUTHORITY_OFFLINE',
  'VAULT_REMOTE_TIMEOUT',
  'VAULT_MIGRATION_IN_PROGRESS',
  'VAULT_REMOTE_ENCRYPTION_UNAVAILABLE',
  'VAULT_REMOTE_CORRUPT',
  'VAULT_PROFILE_MISMATCH',
  'VAULT_REMOTE_INCOMPATIBLE',
]);

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'PROFILE_STORAGE_IO_FAILED';
}

function storageAvailabilityFor(error: unknown): ProfileStorageAvailability {
  switch (errorCode(error)) {
    case 'PROFILE_STORAGE_OFFLINE':
    case 'PROFILE_STORAGE_TARGET_UNAVAILABLE':
      return 'offline';
    case 'PROFILE_STORAGE_TIMEOUT':
      return 'timeout';
    case 'PROFILE_STORAGE_INCOMPATIBLE':
      return 'incompatible';
    case 'PROFILE_STORAGE_CORRUPT':
    case 'PROFILE_STORAGE_PROFILE_MISMATCH':
    case 'PROFILE_STORAGE_ENCRYPTION_UNAVAILABLE':
      return 'corrupt';
    default:
      return 'corrupt';
  }
}

function vaultCodeFor(error: unknown): PasswordVaultErrorCode {
  const code = errorCode(error);
  if (VAULT_CODES.has(code as PasswordVaultErrorCode))
    return code as PasswordVaultErrorCode;
  switch (code) {
    case 'PROFILE_STORAGE_OFFLINE':
    case 'PROFILE_STORAGE_TARGET_UNAVAILABLE':
      return 'VAULT_REMOTE_AUTHORITY_OFFLINE';
    case 'PROFILE_STORAGE_TIMEOUT':
      return 'VAULT_REMOTE_TIMEOUT';
    case 'PROFILE_STORAGE_ENCRYPTION_UNAVAILABLE':
      return 'VAULT_REMOTE_ENCRYPTION_UNAVAILABLE';
    case 'PROFILE_STORAGE_CORRUPT':
      return 'VAULT_REMOTE_CORRUPT';
    case 'PROFILE_STORAGE_PROFILE_MISMATCH':
      return 'VAULT_PROFILE_MISMATCH';
    case 'PROFILE_STORAGE_INCOMPATIBLE':
      return 'VAULT_REMOTE_INCOMPATIBLE';
    case 'PROFILE_STORAGE_FORBIDDEN':
      return 'VAULT_FORBIDDEN';
    case 'PROFILE_STORAGE_INVALID_INPUT':
      return 'VAULT_INVALID_INPUT';
    default:
      return 'VAULT_IO_FAILED';
  }
}

function profileFromHint(entry: ProfileCatalogEntryV1): BrowserProfile {
  return {
    id: entry.profileId,
    name: entry.nameHint,
    createdAt: entry.createdAtHint,
    ...(entry.lifecycle !== 'active' ? { deletionState: entry.lifecycle } : {}),
    ...(entry.deletionErrorCode
      ? { deletionErrorCode: entry.deletionErrorCode }
      : {}),
    ...(entry.deletionUpdatedAt !== undefined
      ? { deletionUpdatedAt: entry.deletionUpdatedAt }
      : {}),
  };
}

function applyCatalogLifecycle(
  profile: BrowserProfile,
  entry: ProfileCatalogEntryV1,
): BrowserProfile {
  const result: BrowserProfile = { ...profile };
  delete result.deletionState;
  delete result.deletionErrorCode;
  delete result.deletionUpdatedAt;
  if (entry.lifecycle !== 'active') result.deletionState = entry.lifecycle;
  if (entry.deletionErrorCode)
    result.deletionErrorCode = entry.deletionErrorCode;
  if (entry.deletionUpdatedAt !== undefined)
    result.deletionUpdatedAt = entry.deletionUpdatedAt;
  return result;
}

export class ProfileAuthorityService {
  private readonly cache = new Map<string, CachedProfile>();
  private readonly logger: NonNullable<ProfileAuthorityServiceDeps['logger']>;

  constructor(private readonly deps: ProfileAuthorityServiceDeps) {
    this.logger = deps.logger ?? console;
  }

  get clientId(): string {
    return this.deps.catalog.clientId;
  }

  listCatalogEntries(): ProfileCatalogEntryV1[] {
    return this.deps.catalog.listEntries();
  }

  async listSummaries(): Promise<BrowserProfileSummary[]> {
    const results: BrowserProfileSummary[] = [];
    for (const entry of this.deps.catalog.listEntries()) {
      const provider = this.provider(entry.storage);
      let profile = profileFromHint(entry);
      let availability = provider.availability();
      if (availability === 'ready') {
        try {
          profile = applyCatalogLifecycle(
            await provider.getProfile(entry.profileId),
            entry,
          );
          this.rememberRemoteProfile(entry.storage, provider, profile);
        } catch (error) {
          availability = storageAvailabilityFor(error);
          this.forgetProfile(entry.profileId);
          this.logFailure('list-profile', entry, error);
        }
      }
      results.push({
        ...profile,
        storage: entry.storage,
        storageLabel: this.label(entry.storage),
        availability,
        ...(this.migrationStatus(entry.profileId) ?? {}),
      });
    }
    return results;
  }

  async getProfile(profileId: string): Promise<BrowserProfile> {
    const entry = this.requireActiveEntry(profileId);
    const provider = this.provider(entry.storage);
    if (provider.availability() !== 'ready') {
      throw new ProfileAuthorityError('PROFILE_STORAGE_OFFLINE');
    }
    try {
      const profile = applyCatalogLifecycle(
        await provider.getProfile(profileId),
        entry,
      );
      this.rememberRemoteProfile(entry.storage, provider, profile);
      return profile;
    } catch (error) {
      throw this.profileError(error);
    }
  }

  /** A synchronous attach gate may use only a config validated in the current connection generation. */
  getCachedProfileForAttach(profileId: string): BrowserProfile | null {
    const entry = this.deps.catalog.getEntry(profileId);
    if (!entry || entry.lifecycle !== 'active') return null;
    if (entry.storage.kind === 'local') return null;
    const cached = this.cache.get(profileId);
    if (!cached || !profileStorageRefEquals(cached.storage, entry.storage))
      return null;
    const provider = this.provider(entry.storage);
    if (
      provider.availability() !== 'ready' ||
      provider.currentGeneration() !== cached.generation
    ) {
      this.cache.delete(profileId);
      return null;
    }
    return { ...cached.profile };
  }

  async saveProfile(input: BrowserProfileInput): Promise<BrowserProfile> {
    if (input.id === undefined) {
      const local: ProfileStorageRef = { kind: 'local' };
      const created = await this.provider(local).createProfile(input);
      this.deps.catalog.ensureProfile(created, local);
      return created;
    }
    if (input.id === DEFAULT_PROFILE_ID) {
      throw new ProfileAuthorityError('PROFILE_STORAGE_INVALID_INPUT');
    }
    this.assertMutationAllowed(input.id);
    const entry = this.requireActiveEntry(input.id);
    const existing = await this.getProfile(input.id);
    const name = input.name.trim().slice(0, 100);
    if (!name) throw new ProfileAuthorityError('PROFILE_STORAGE_INVALID_INPUT');
    const userAgent = input.userAgent?.trim().slice(0, 1024);
    const updated: BrowserProfile = { ...existing, name };
    if (userAgent) updated.userAgent = userAgent;
    else delete updated.userAgent;
    try {
      const saved = await this.provider(entry.storage).writeProfile(updated);
      this.deps.catalog.updateProfileHints(saved);
      this.rememberRemoteProfile(
        entry.storage,
        this.provider(entry.storage),
        saved,
      );
      return saved;
    } catch (error) {
      throw this.profileError(error);
    }
  }

  isAvailable(profileId: string): boolean {
    const entry = this.deps.catalog.getEntry(profileId);
    if (!entry || entry.lifecycle !== 'active') return false;
    const provider = this.provider(entry.storage);
    return (
      provider.availability() === 'ready' &&
      (provider.isVaultAvailable?.() ?? true)
    );
  }

  async listMetadata(
    query?: PasswordMetadataQuery,
  ): Promise<PasswordMetadataSnapshot> {
    const entries: PasswordCredentialMetadata[] = [];
    const unavailableProfiles: PasswordMetadataSnapshot['unavailableProfiles'] =
      [];
    const selected = this.deps.catalog
      .listEntries()
      .filter((entry) => entry.lifecycle === 'active')
      .filter(
        (entry) => !query?.profileId || entry.profileId === query.profileId,
      );
    for (const entry of selected) {
      const provider = this.provider(entry.storage);
      if (
        provider.availability() !== 'ready' ||
        !(provider.isVaultAvailable?.() ?? true)
      ) {
        unavailableProfiles.push({
          profileId: entry.profileId,
          code:
            entry.storage.kind === 'remote'
              ? 'VAULT_REMOTE_AUTHORITY_OFFLINE'
              : 'VAULT_ENCRYPTION_UNAVAILABLE',
        });
        continue;
      }
      try {
        entries.push(
          ...(await provider.listMetadata(entry.profileId, {
            ...query,
            profileId: entry.profileId,
          })),
        );
      } catch (error) {
        unavailableProfiles.push({
          profileId: entry.profileId,
          code: vaultCodeFor(error),
        });
        this.logVaultFailure('list-metadata', entry, error);
      }
    }
    entries.sort(
      (a, b) => b.lastUsedAt - a.lastUsedAt || a.id.localeCompare(b.id),
    );
    return { entries, unavailableProfiles };
  }

  async lookup(
    profileId: string,
    origin: string,
  ): Promise<DecryptedProfileCredential[]> {
    return this.vaultRead(profileId, 'lookup', (provider) =>
      provider.lookup(profileId, origin),
    );
  }

  async getDecrypted(
    profileId: string,
    entryId: string,
  ): Promise<DecryptedProfileCredential> {
    return this.vaultRead(profileId, 'get', (provider) =>
      provider.getDecrypted(profileId, entryId),
    );
  }

  async upsert(input: PasswordUpsertInput): Promise<PasswordUpsertResult> {
    this.assertMutationAllowed(input.profileId, true);
    return this.vaultWrite(input.profileId, 'upsert', (provider) =>
      provider.upsert(input),
    );
  }

  async deleteEntry(profileId: string, entryId: string): Promise<boolean> {
    this.assertMutationAllowed(profileId, true);
    return this.vaultWrite(profileId, 'delete-entry', (provider) =>
      provider.deleteEntry(profileId, entryId),
    );
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    this.assertMutationAllowed(profileId, true);
    const entry = this.requireEntry(profileId);
    try {
      const deleted = await this.provider(entry.storage).deleteProfile(
        profileId,
      );
      this.forgetProfile(profileId);
      return deleted;
    } catch (error) {
      throw new RoutedPasswordVaultError(vaultCodeFor(error));
    }
  }

  readBundle(profileId: string): Promise<ProfileBundleV1> {
    const entry = this.requireActiveEntry(profileId);
    return this.provider(entry.storage).readBundle(profileId);
  }

  /** Called synchronously for disconnected/failed/recovery reset events. */
  invalidateRemoteHost(hostId: string, generation?: string): string[] {
    const affected = this.deps.catalog
      .listEntries()
      .filter(
        (entry) =>
          entry.storage.kind === 'remote' && entry.storage.hostId === hostId,
      )
      .map((entry) => entry.profileId);
    for (const profileId of affected) this.cache.delete(profileId);
    try {
      this.provider({ kind: 'remote', hostId }).invalidate?.(generation);
    } catch {
      // The provider can already be absent after Host deletion; cache invalidation still succeeds.
      this.logger.warn(
        `[profile-authority] action=invalidate-remote hostId=${hostId} code=PROFILE_STORAGE_OFFLINE`,
      );
    }
    if (affected.length > 0) this.deps.onRemoteInvalidated?.(affected);
    return affected;
  }

  private migrationStatus(
    profileId: string,
  ): { migration: ProfileMigrationStatus } | null {
    const migration = this.deps.catalog.getMigration(profileId);
    if (!migration) return null;
    return {
      migration: {
        operationId: migration.operationId,
        phase: migration.phase,
        sourceLabel: this.label(migration.source),
        targetLabel: this.label(migration.target),
        ...(migration.errorCode ? { errorCode: migration.errorCode } : {}),
      },
    };
  }

  private async vaultRead<T>(
    profileId: string,
    action: string,
    operation: (provider: ProfileDataProvider) => Promise<T>,
  ): Promise<T> {
    const entry = this.requireActiveEntry(profileId, true);
    try {
      return await operation(this.provider(entry.storage));
    } catch (error) {
      this.logVaultFailure(action, entry, error);
      throw new RoutedPasswordVaultError(vaultCodeFor(error));
    }
  }

  private async vaultWrite<T>(
    profileId: string,
    action: string,
    operation: (provider: ProfileDataProvider) => Promise<T>,
  ): Promise<T> {
    return this.vaultRead(profileId, action, operation);
  }

  private assertMutationAllowed(profileId: string, vault = false): void {
    const migration = this.deps.catalog.getMigration(profileId);
    if (migration && !migration.committed) {
      if (vault)
        throw new RoutedPasswordVaultError('VAULT_MIGRATION_IN_PROGRESS');
      throw new ProfileAuthorityError('PROFILE_MIGRATION_IN_PROGRESS');
    }
  }

  private requireActiveEntry(
    profileId: string,
    vault = false,
  ): ProfileCatalogEntryV1 {
    const entry = this.requireEntry(profileId, vault);
    if (entry.lifecycle !== 'active') {
      if (vault) throw new RoutedPasswordVaultError('VAULT_PROFILE_INACTIVE');
      throw new ProfileAuthorityError('PROFILE_STORAGE_INVALID_INPUT');
    }
    return entry;
  }

  private requireEntry(
    profileId: string,
    vault = false,
  ): ProfileCatalogEntryV1 {
    const entry = this.deps.catalog.getEntry(profileId);
    if (entry) return entry;
    if (vault) throw new RoutedPasswordVaultError('VAULT_PROFILE_INACTIVE');
    throw new ProfileAuthorityError('PROFILE_STORAGE_INVALID_INPUT');
  }

  private provider(storage: ProfileStorageRef): ProfileDataProvider {
    try {
      return this.deps.resolveProvider(storage);
    } catch (error) {
      if (error instanceof ProfileCatalogError) throw error;
      throw new ProfileAuthorityError('PROFILE_STORAGE_OFFLINE');
    }
  }

  private profileError(error: unknown): ProfileAuthorityError {
    const code = errorCode(error);
    if (PROFILE_STORAGE_CODES.has(code as ProfileStorageErrorCode)) {
      return new ProfileAuthorityError(code as ProfileStorageErrorCode);
    }
    return new ProfileAuthorityError('PROFILE_STORAGE_IO_FAILED');
  }

  private rememberRemoteProfile(
    storage: ProfileStorageRef,
    provider: ProfileDataProvider,
    profile: BrowserProfile,
  ): void {
    if (storage.kind !== 'remote') return;
    const generation = provider.currentGeneration();
    if (!generation) return;
    this.cache.set(profile.id, {
      profile: { ...profile },
      storage,
      generation,
    });
  }

  private forgetProfile(profileId: string): void {
    this.cache.delete(profileId);
  }

  private label(storage: ProfileStorageRef): string {
    return (
      this.deps.storageLabel?.(storage) ??
      (storage.kind === 'local' ? 'This device' : storage.hostId)
    );
  }

  private logFailure(
    action: string,
    entry: ProfileCatalogEntryV1,
    error: unknown,
  ): void {
    this.logger.warn(
      `[profile-authority] action=${action} profileId=${entry.profileId} code=${errorCode(error)}`,
    );
  }

  private logVaultFailure(
    action: string,
    entry: ProfileCatalogEntryV1,
    error: unknown,
  ): void {
    this.logger.warn(
      `[profile-authority] vaultAction=${action} profileId=${entry.profileId} code=${vaultCodeFor(error)}`,
    );
  }
}

export function migrationReadsFrom(
  record: ProfileMigrationRecordV1,
): ProfileStorageRef {
  return record.committed ? record.target : record.source;
}
