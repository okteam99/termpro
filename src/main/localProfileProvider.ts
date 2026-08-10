import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_PROFILE_ID,
  PROFILE_ID_RE,
  type BrowserProfile,
  type BrowserProfileInput,
  type ProfileStorageErrorCode,
} from '../shared/browserProfile';
import type {
  PasswordCredentialMetadata,
  PasswordMetadataQuery,
} from '../shared/passwordVault';
import {
  REMOTE_PROFILE_BUNDLE_VERSION,
  type DecryptedProfileCredential,
  type ProfileBundleV1,
} from '../shared/remoteProfileStore';
import type { BrowserProfileStore } from './browserProfileStore';
import type { LocalPasswordVault } from './localPasswordVault';
import type {
  PasswordUpsertInput,
  PasswordUpsertResult,
  ProfileDataProvider,
} from './profileAuthorityService';
import {
  canonicalProfileBundleJson,
  profileBundleVerificationDigest,
} from './profileMigrationCoordinator';

const STAGING_DIRECTORY = 'browser-profile-migration-staging';
const DEFAULT_PROFILE_FILE = 'browser-default-profile.json';
const STAGING_VERSION = 1 as const;
const DEFAULT_PROFILE_DOCUMENT_VERSION = 1 as const;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface LocalStagingEnvelopeV1 {
  version: typeof STAGING_VERSION;
  algorithm: 'safe-storage';
  encryptedBundle: string;
}

interface DefaultProfileDocumentV1 {
  version: typeof DEFAULT_PROFILE_DOCUMENT_VERSION;
  profile: BrowserProfile;
}

export interface LocalProfileStagingCryptoPort {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface LocalProfileProviderDeps {
  userDataDir: string | (() => string);
  profiles: BrowserProfileStore;
  vault: LocalPasswordVault;
  stagingCrypto: LocalProfileStagingCryptoPort;
  defaultProfile?: BrowserProfile;
  logger?: { warn(message: string): void; error(message: string): void };
}

export class LocalProfileProviderError extends Error {
  constructor(readonly code: ProfileStorageErrorCode) {
    super(code);
    this.name = 'LocalProfileProviderError';
  }
}

function isProfileId(value: unknown): value is string {
  return (
    value === DEFAULT_PROFILE_ID ||
    (typeof value === 'string' && PROFILE_ID_RE.test(value))
  );
}

function validProfile(
  value: unknown,
  expectedId: string,
): value is BrowserProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<BrowserProfile>;
  return (
    profile.id === expectedId &&
    isProfileId(profile.id) &&
    typeof profile.name === 'string' &&
    profile.name.trim().length > 0 &&
    profile.name.length <= 100 &&
    (profile.userAgent === undefined ||
      (typeof profile.userAgent === 'string' &&
        profile.userAgent.length <= 1024)) &&
    typeof profile.createdAt === 'number' &&
    Number.isFinite(profile.createdAt) &&
    profile.createdAt >= 0
  );
}

function validBundle(
  value: unknown,
  expectedProfileId?: string,
): value is ProfileBundleV1 {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Partial<ProfileBundleV1>;
  const profileId = expectedProfileId ?? bundle.profile?.id;
  if (
    !profileId ||
    bundle.version !== REMOTE_PROFILE_BUNDLE_VERSION ||
    !validProfile(bundle.profile, profileId) ||
    !Array.isArray(bundle.credentials)
  ) {
    return false;
  }
  return bundle.credentials.every(
    (credential) =>
      credential &&
      credential.profileId === profileId &&
      typeof credential.id === 'string' &&
      typeof credential.origin === 'string' &&
      typeof credential.username === 'string' &&
      typeof credential.password === 'string' &&
      typeof credential.createdAt === 'number' &&
      typeof credential.updatedAt === 'number' &&
      typeof credential.lastUsedAt === 'number',
  );
}

function mappedStorageError(error: unknown): LocalProfileProviderError {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'VAULT_ENCRYPTION_UNAVAILABLE':
      return new LocalProfileProviderError(
        'PROFILE_STORAGE_ENCRYPTION_UNAVAILABLE',
      );
    case 'VAULT_CORRUPT':
    case 'VAULT_DECRYPT_FAILED':
      return new LocalProfileProviderError('PROFILE_STORAGE_CORRUPT');
    case 'VAULT_PROFILE_MISMATCH':
      return new LocalProfileProviderError('PROFILE_STORAGE_PROFILE_MISMATCH');
    case 'VAULT_INVALID_INPUT':
      return new LocalProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    default:
      return new LocalProfileProviderError('PROFILE_STORAGE_IO_FAILED');
  }
}

/** BrowserProfileStore + LocalPasswordVault adapter with encrypted, private migration staging. */
export class LocalProfileProvider implements ProfileDataProvider {
  readonly storage = { kind: 'local' } as const;
  private readonly logger: NonNullable<LocalProfileProviderDeps['logger']>;

  constructor(private readonly deps: LocalProfileProviderDeps) {
    this.logger = deps.logger ?? console;
  }

  availability(): 'ready' {
    return 'ready';
  }

  currentGeneration(): null {
    return null;
  }

  isVaultAvailable(): boolean {
    return this.deps.vault.isAvailable();
  }

  async createProfile(input: BrowserProfileInput): Promise<BrowserProfile> {
    try {
      return this.deps.profiles.save(input);
    } catch {
      throw new LocalProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
  }

  async getProfile(profileId: string): Promise<BrowserProfile> {
    if (profileId === DEFAULT_PROFILE_ID) return this.readDefaultProfile();
    const profile = this.deps.profiles.get(profileId);
    if (!profile)
      throw new LocalProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    return profile;
  }

  async writeProfile(profile: BrowserProfile): Promise<BrowserProfile> {
    if (profile.id === DEFAULT_PROFILE_ID) {
      throw new LocalProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
    try {
      return this.deps.profiles.replaceProfile(profile);
    } catch {
      throw new LocalProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
  }

  async readBundle(profileId: string): Promise<ProfileBundleV1> {
    try {
      const profile = await this.getProfile(profileId);
      const credentials = this.deps.vault.exportProfile(profileId);
      return { version: REMOTE_PROFILE_BUNDLE_VERSION, profile, credentials };
    } catch (error) {
      if (error instanceof LocalProfileProviderError) throw error;
      throw mappedStorageError(error);
    }
  }

  async listMetadata(
    profileId: string,
    query?: PasswordMetadataQuery,
  ): Promise<PasswordCredentialMetadata[]> {
    return this.deps.vault.listMetadata({ ...query, profileId });
  }

  async lookup(
    profileId: string,
    origin: string,
  ): Promise<DecryptedProfileCredential[]> {
    return this.deps.vault.lookup(profileId, origin);
  }

  async getDecrypted(
    profileId: string,
    entryId: string,
  ): Promise<DecryptedProfileCredential> {
    return this.deps.vault.getDecrypted(profileId, entryId);
  }

  async upsert(input: PasswordUpsertInput): Promise<PasswordUpsertResult> {
    return this.deps.vault.upsert(input);
  }

  async deleteEntry(profileId: string, entryId: string): Promise<boolean> {
    return this.deps.vault.deleteEntry(profileId, entryId);
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    try {
      const vaultDeleted = this.deps.vault.deleteProfile(profileId);
      const profileDeleted =
        profileId === DEFAULT_PROFILE_ID
          ? this.deleteDefaultProfileDocument()
          : this.deps.profiles.deleteForMigration(profileId);
      return vaultDeleted || profileDeleted;
    } catch (error) {
      throw mappedStorageError(error);
    }
  }

  async stage(operationId: string, bundle: ProfileBundleV1): Promise<void> {
    if (!UUID_RE.test(operationId) || !validBundle(bundle)) {
      throw new LocalProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
    if (!this.deps.stagingCrypto.isEncryptionAvailable()) {
      throw new LocalProfileProviderError(
        'PROFILE_STORAGE_ENCRYPTION_UNAVAILABLE',
      );
    }
    try {
      const encrypted = this.deps.stagingCrypto.encryptString(
        canonicalProfileBundleJson(bundle),
      );
      const envelope: LocalStagingEnvelopeV1 = {
        version: STAGING_VERSION,
        algorithm: 'safe-storage',
        encryptedBundle: encrypted.toString('base64'),
      };
      this.writePrivateFile(
        this.stagingPath(operationId),
        JSON.stringify(envelope),
      );
    } catch (error) {
      if (error instanceof LocalProfileProviderError) throw error;
      this.log('stage', operationId, 'PROFILE_STORAGE_IO_FAILED');
      throw mappedStorageError(error);
    }
  }

  async verify(operationId: string, nonce: Buffer): Promise<Buffer> {
    const bundle = this.readStagedBundle(operationId);
    return profileBundleVerificationDigest(bundle, nonce);
  }

  async publish(operationId: string, profileId: string): Promise<void> {
    const bundle = this.readStagedBundle(operationId);
    if (!validBundle(bundle, profileId)) {
      throw new LocalProfileProviderError('PROFILE_STORAGE_PROFILE_MISMATCH');
    }
    try {
      if (profileId === DEFAULT_PROFILE_ID)
        this.writeDefaultProfile(bundle.profile);
      else this.deps.profiles.replaceProfile(bundle.profile);
      this.deps.vault.replaceProfile(profileId, bundle.credentials);
      this.deletePrivateFile(this.stagingPath(operationId));
    } catch (error) {
      if (error instanceof LocalProfileProviderError) throw error;
      this.log('publish', operationId, 'PROFILE_STORAGE_IO_FAILED');
      throw mappedStorageError(error);
    }
  }

  async discard(operationId: string): Promise<void> {
    if (!UUID_RE.test(operationId)) {
      throw new LocalProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
    this.deletePrivateFile(this.stagingPath(operationId));
  }

  private readStagedBundle(operationId: string): ProfileBundleV1 {
    if (!UUID_RE.test(operationId)) {
      throw new LocalProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
    if (!this.deps.stagingCrypto.isEncryptionAvailable()) {
      throw new LocalProfileProviderError(
        'PROFILE_STORAGE_ENCRYPTION_UNAVAILABLE',
      );
    }
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.stagingPath(operationId), 'utf8'),
      ) as Partial<LocalStagingEnvelopeV1>;
      if (
        raw.version !== STAGING_VERSION ||
        raw.algorithm !== 'safe-storage' ||
        typeof raw.encryptedBundle !== 'string'
      ) {
        throw new LocalProfileProviderError('PROFILE_STORAGE_CORRUPT');
      }
      const plaintext = this.deps.stagingCrypto.decryptString(
        Buffer.from(raw.encryptedBundle, 'base64'),
      );
      const bundle: unknown = JSON.parse(plaintext);
      if (!validBundle(bundle))
        throw new LocalProfileProviderError('PROFILE_STORAGE_CORRUPT');
      return bundle;
    } catch (error) {
      if (error instanceof LocalProfileProviderError) throw error;
      this.log('read-stage', operationId, 'PROFILE_STORAGE_CORRUPT');
      throw new LocalProfileProviderError('PROFILE_STORAGE_CORRUPT');
    }
  }

  private readDefaultProfile(): BrowserProfile {
    const file = this.defaultProfilePath();
    try {
      const raw = JSON.parse(
        fs.readFileSync(file, 'utf8'),
      ) as Partial<DefaultProfileDocumentV1>;
      if (
        raw.version !== DEFAULT_PROFILE_DOCUMENT_VERSION ||
        !validProfile(raw.profile, DEFAULT_PROFILE_ID)
      ) {
        throw new LocalProfileProviderError('PROFILE_STORAGE_CORRUPT');
      }
      return raw.profile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return (
          this.deps.defaultProfile ?? {
            id: DEFAULT_PROFILE_ID,
            name: 'OkWork (built-in)',
            createdAt: 0,
          }
        );
      }
      if (error instanceof LocalProfileProviderError) throw error;
      throw new LocalProfileProviderError('PROFILE_STORAGE_CORRUPT');
    }
  }

  private writeDefaultProfile(profile: BrowserProfile): void {
    if (!validProfile(profile, DEFAULT_PROFILE_ID)) {
      throw new LocalProfileProviderError('PROFILE_STORAGE_PROFILE_MISMATCH');
    }
    const document: DefaultProfileDocumentV1 = {
      version: DEFAULT_PROFILE_DOCUMENT_VERSION,
      profile,
    };
    this.writePrivateFile(this.defaultProfilePath(), JSON.stringify(document));
  }

  private deleteDefaultProfileDocument(): boolean {
    return this.deletePrivateFile(this.defaultProfilePath());
  }

  private writePrivateFile(file: string, serialized: string): void {
    const directory = path.dirname(file);
    const temp = path.join(
      directory,
      `.${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`,
    );
    let fd: number | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, serialized, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, file);
      const directoryFd = fs.openSync(directory, 'r');
      try {
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
    } catch {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Stable failure below intentionally hides platform details.
        }
      }
      try {
        fs.unlinkSync(temp);
      } catch {
        // Temp files are never read as committed staging or default config.
      }
      throw new LocalProfileProviderError('PROFILE_STORAGE_IO_FAILED');
    }
  }

  private deletePrivateFile(file: string): boolean {
    try {
      fs.unlinkSync(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new LocalProfileProviderError('PROFILE_STORAGE_IO_FAILED');
    }
  }

  private root(): string {
    const directory =
      typeof this.deps.userDataDir === 'function'
        ? this.deps.userDataDir()
        : this.deps.userDataDir;
    if (!path.isAbsolute(directory))
      throw new LocalProfileProviderError('PROFILE_STORAGE_IO_FAILED');
    return directory;
  }

  private stagingPath(operationId: string): string {
    return path.join(this.root(), STAGING_DIRECTORY, `${operationId}.json`);
  }

  private defaultProfilePath(): string {
    return path.join(this.root(), DEFAULT_PROFILE_FILE);
  }

  private log(
    action: string,
    operationId: string,
    code: ProfileStorageErrorCode,
  ): void {
    this.logger.warn(
      `[local-profile] action=${action} operationId=${operationId} code=${code}`,
    );
  }
}
