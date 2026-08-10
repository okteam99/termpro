import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BROWSER_PROFILE_DELETION_ERROR_CODES,
  DEFAULT_PROFILE_ID,
  PROFILE_ID_RE,
  isBrowserProfileDeletionErrorCode,
  type BrowserProfile,
  type BrowserProfileDeletionErrorCode,
  type ProfileMigrationPhase,
  type ProfileStorageErrorCode,
  type ProfileStorageRef,
} from '../shared/browserProfile';

export const PROFILE_CATALOG_VERSION = 1 as const;
export const PROFILE_CATALOG_FILE = 'browser-profile-authorities.json';

export type ProfileCatalogLifecycle = 'active' | 'deleting' | 'delete_failed';

export interface ProfileCatalogEntryV1 {
  profileId: string;
  nameHint: string;
  createdAtHint: number;
  storage: ProfileStorageRef;
  lifecycle: ProfileCatalogLifecycle;
  deletionErrorCode?: BrowserProfileDeletionErrorCode;
  deletionUpdatedAt?: number;
}

export interface ProfileMigrationRecordV1 {
  operationId: string;
  profileId: string;
  source: ProfileStorageRef;
  target: ProfileStorageRef;
  phase: ProfileMigrationPhase;
  committed: boolean;
  sourceGeneration?: string;
  targetGeneration?: string;
  errorCode?: ProfileStorageErrorCode;
  updatedAt: number;
}

export interface ProfileCatalogDocumentV1 {
  version: typeof PROFILE_CATALOG_VERSION;
  clientId: string;
  profiles: ProfileCatalogEntryV1[];
  migrations: ProfileMigrationRecordV1[];
}

export type ProfileCatalogErrorCode =
  | 'PROFILE_CATALOG_CORRUPT'
  | 'PROFILE_CATALOG_IO_FAILED'
  | 'PROFILE_CATALOG_INVALID_TRANSITION'
  | 'PROFILE_CATALOG_PROFILE_NOT_FOUND';

export class ProfileCatalogError extends Error {
  constructor(readonly code: ProfileCatalogErrorCode) {
    super(code);
    this.name = 'ProfileCatalogError';
  }
}

export interface ProfileCatalogStoreDeps {
  userDataDir: string | (() => string);
  /** The existing local store is consulted only when a catalog does not exist yet. */
  localProfiles: () => BrowserProfile[];
  defaultProfile?: BrowserProfile;
  now?: () => number;
  newClientId?: () => string;
}

const STORAGE_ERROR_CODES = new Set<ProfileStorageErrorCode>([
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

const MIGRATION_PHASES = new Set<ProfileMigrationPhase>([
  'copying',
  'verifying',
  'switching',
  'failed',
  'cleanup_pending',
]);

function isProfileId(value: unknown): value is string {
  return (
    value === DEFAULT_PROFILE_ID ||
    (typeof value === 'string' && PROFILE_ID_RE.test(value))
  );
}

function isStorageRef(value: unknown): value is ProfileStorageRef {
  if (!value || typeof value !== 'object') return false;
  const storage = value as { kind?: unknown; hostId?: unknown };
  if (storage.kind === 'local')
    return Object.keys(storage).every((key) => key === 'kind');
  return (
    storage.kind === 'remote' &&
    typeof storage.hostId === 'string' &&
    storage.hostId.length > 0 &&
    storage.hostId.length <= 256
  );
}

export function profileStorageRefEquals(
  a: ProfileStorageRef,
  b: ProfileStorageRef,
): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === 'local' || a.hostId === (b as { hostId: string }).hostId)
  );
}

function lifecycleOf(profile: BrowserProfile): ProfileCatalogLifecycle {
  return profile.deletionState ?? 'active';
}

function entryOf(
  profile: BrowserProfile,
  storage: ProfileStorageRef,
): ProfileCatalogEntryV1 {
  const lifecycle =
    profile.id === DEFAULT_PROFILE_ID ? 'active' : lifecycleOf(profile);
  return {
    profileId: profile.id,
    nameHint:
      profile.name.trim().slice(0, 100) ||
      (profile.id === DEFAULT_PROFILE_ID ? 'Default' : 'Profile'),
    createdAtHint:
      Number.isFinite(profile.createdAt) && profile.createdAt >= 0
        ? profile.createdAt
        : 0,
    storage,
    lifecycle,
    ...(lifecycle === 'delete_failed' && profile.deletionErrorCode
      ? { deletionErrorCode: profile.deletionErrorCode }
      : {}),
    ...(lifecycle !== 'active' && Number.isFinite(profile.deletionUpdatedAt)
      ? { deletionUpdatedAt: profile.deletionUpdatedAt }
      : {}),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateEntry(value: unknown): ProfileCatalogEntryV1 | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ProfileCatalogEntryV1>;
  if (!isProfileId(raw.profileId)) return null;
  if (
    typeof raw.nameHint !== 'string' ||
    !raw.nameHint.trim() ||
    raw.nameHint.length > 100
  ) {
    return null;
  }
  if (
    typeof raw.createdAtHint !== 'number' ||
    !Number.isInteger(raw.createdAtHint) ||
    raw.createdAtHint < 0
  ) {
    return null;
  }
  if (!isStorageRef(raw.storage)) return null;
  if (
    raw.lifecycle !== 'active' &&
    raw.lifecycle !== 'deleting' &&
    raw.lifecycle !== 'delete_failed'
  ) {
    return null;
  }
  if (raw.profileId === DEFAULT_PROFILE_ID && raw.lifecycle !== 'active')
    return null;
  if (
    raw.deletionUpdatedAt !== undefined &&
    (typeof raw.deletionUpdatedAt !== 'number' ||
      !Number.isInteger(raw.deletionUpdatedAt) ||
      raw.deletionUpdatedAt < 0)
  ) {
    return null;
  }
  if (
    raw.deletionErrorCode !== undefined &&
    !isBrowserProfileDeletionErrorCode(raw.deletionErrorCode)
  ) {
    return null;
  }
  if (raw.lifecycle === 'delete_failed' && !raw.deletionErrorCode) return null;
  if (
    raw.lifecycle === 'active' &&
    (raw.deletionErrorCode || raw.deletionUpdatedAt !== undefined)
  ) {
    return null;
  }
  return clone(raw as ProfileCatalogEntryV1);
}

function validateMigration(value: unknown): ProfileMigrationRecordV1 | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ProfileMigrationRecordV1>;
  if (
    typeof raw.operationId !== 'string' ||
    !raw.operationId ||
    raw.operationId.length > 200
  ) {
    return null;
  }
  if (!isProfileId(raw.profileId)) return null;
  if (!isStorageRef(raw.source) || !isStorageRef(raw.target)) return null;
  if (profileStorageRefEquals(raw.source, raw.target)) return null;
  if (!MIGRATION_PHASES.has(raw.phase as ProfileMigrationPhase)) return null;
  if (typeof raw.committed !== 'boolean') return null;
  if (raw.committed !== (raw.phase === 'cleanup_pending')) return null;
  if (
    typeof raw.updatedAt !== 'number' ||
    !Number.isInteger(raw.updatedAt) ||
    raw.updatedAt < 0
  ) {
    return null;
  }
  if (
    raw.source.kind === 'remote' &&
    (typeof raw.sourceGeneration !== 'string' || !raw.sourceGeneration)
  ) {
    return null;
  }
  if (
    raw.target.kind === 'remote' &&
    (typeof raw.targetGeneration !== 'string' || !raw.targetGeneration)
  ) {
    return null;
  }
  if (raw.errorCode !== undefined && !STORAGE_ERROR_CODES.has(raw.errorCode))
    return null;
  return clone(raw as ProfileMigrationRecordV1);
}

function validateDocument(value: unknown): ProfileCatalogDocumentV1 | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ProfileCatalogDocumentV1>;
  if (raw.version !== PROFILE_CATALOG_VERSION) return null;
  if (
    typeof raw.clientId !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(raw.clientId)
  )
    return null;
  if (!Array.isArray(raw.profiles) || !Array.isArray(raw.migrations))
    return null;

  const profiles = raw.profiles.map(validateEntry);
  if (profiles.some((entry) => entry === null)) return null;
  const validProfiles = profiles as ProfileCatalogEntryV1[];
  const profileIds = new Set(validProfiles.map((entry) => entry.profileId));
  if (
    profileIds.size !== validProfiles.length ||
    !profileIds.has(DEFAULT_PROFILE_ID)
  )
    return null;

  const migrations = raw.migrations.map(validateMigration);
  if (migrations.some((record) => record === null)) return null;
  const validMigrations = migrations as ProfileMigrationRecordV1[];
  const migrationProfiles = new Set<string>();
  const operationIds = new Set<string>();
  for (const record of validMigrations) {
    if (!profileIds.has(record.profileId)) return null;
    if (
      migrationProfiles.has(record.profileId) ||
      operationIds.has(record.operationId)
    )
      return null;
    migrationProfiles.add(record.profileId);
    operationIds.add(record.operationId);
    const entry = validProfiles.find(
      (candidate) => candidate.profileId === record.profileId,
    );
    if (!entry) return null;
    // Profile deletion and storage migration are mutually exclusive durable state machines.
    if (entry.lifecycle !== 'active') return null;
    const expectedStorage = record.committed ? record.target : record.source;
    if (!profileStorageRefEquals(entry.storage, expectedStorage)) return null;
  }
  return {
    version: PROFILE_CATALOG_VERSION,
    clientId: raw.clientId,
    profiles: clone(validProfiles),
    migrations: clone(validMigrations),
  };
}

/**
 * Local routing catalog. A missing file is bootstrapped once; any existing malformed file is
 * preserved and rejected so authority can never silently fall back to local storage.
 */
export class ProfileCatalogStore {
  private readonly now: () => number;
  private document: ProfileCatalogDocumentV1;

  constructor(private readonly deps: ProfileCatalogStoreDeps) {
    this.now = deps.now ?? Date.now;
    this.document = this.loadOrBootstrap();
  }

  get clientId(): string {
    return this.document.clientId;
  }

  snapshot(): ProfileCatalogDocumentV1 {
    return clone(this.document);
  }

  listEntries(): ProfileCatalogEntryV1[] {
    return clone(this.document.profiles);
  }

  listMigrations(): ProfileMigrationRecordV1[] {
    return clone(this.document.migrations);
  }

  getEntry(profileId: string): ProfileCatalogEntryV1 | null {
    const entry = this.document.profiles.find(
      (candidate) => candidate.profileId === profileId,
    );
    return entry ? clone(entry) : null;
  }

  getMigration(profileOrOperationId: string): ProfileMigrationRecordV1 | null {
    const record = this.document.migrations.find(
      (candidate) =>
        candidate.profileId === profileOrOperationId ||
        candidate.operationId === profileOrOperationId,
    );
    return record ? clone(record) : null;
  }

  ensureProfile(
    profile: BrowserProfile,
    storage: ProfileStorageRef = { kind: 'local' },
  ): void {
    if (!isProfileId(profile.id) || !isStorageRef(storage)) {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    const existing = this.document.profiles.find(
      (entry) => entry.profileId === profile.id,
    );
    if (existing) {
      this.updateProfileHints(profile);
      return;
    }
    this.commit({
      ...this.document,
      profiles: [...this.document.profiles, entryOf(profile, storage)],
    });
  }

  updateProfileHints(profile: BrowserProfile): void {
    const index = this.document.profiles.findIndex(
      (entry) => entry.profileId === profile.id,
    );
    if (index < 0)
      throw new ProfileCatalogError('PROFILE_CATALOG_PROFILE_NOT_FOUND');
    const existing = this.document.profiles[index];
    const nextEntry = entryOf(profile, existing.storage);
    const next = [...this.document.profiles];
    next[index] = nextEntry;
    this.commit({ ...this.document, profiles: next });
  }

  setLifecycle(
    profileId: string,
    lifecycle: ProfileCatalogLifecycle,
    options: {
      errorCode?: BrowserProfileDeletionErrorCode;
      updatedAt?: number;
    } = {},
  ): void {
    if (profileId === DEFAULT_PROFILE_ID && lifecycle !== 'active') {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    const index = this.document.profiles.findIndex(
      (entry) => entry.profileId === profileId,
    );
    if (index < 0)
      throw new ProfileCatalogError('PROFILE_CATALOG_PROFILE_NOT_FOUND');
    if (lifecycle === 'delete_failed' && !options.errorCode) {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    const nextEntry: ProfileCatalogEntryV1 = {
      ...this.document.profiles[index],
      lifecycle,
      ...(lifecycle === 'delete_failed'
        ? { deletionErrorCode: options.errorCode }
        : {}),
      ...(lifecycle !== 'active'
        ? { deletionUpdatedAt: options.updatedAt ?? this.now() }
        : {}),
    };
    if (lifecycle !== 'delete_failed') delete nextEntry.deletionErrorCode;
    if (lifecycle === 'active') delete nextEntry.deletionUpdatedAt;
    const profiles = [...this.document.profiles];
    profiles[index] = nextEntry;
    this.commit({ ...this.document, profiles });
  }

  removeProfile(profileId: string): boolean {
    if (profileId === DEFAULT_PROFILE_ID || this.getMigration(profileId))
      return false;
    const profiles = this.document.profiles.filter(
      (entry) => entry.profileId !== profileId,
    );
    if (profiles.length === this.document.profiles.length) return false;
    this.commit({ ...this.document, profiles });
    return true;
  }

  beginMigration(record: ProfileMigrationRecordV1): ProfileMigrationRecordV1 {
    if (record.committed || record.phase !== 'copying') {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    const entry = this.getEntry(record.profileId);
    if (
      !entry ||
      entry.lifecycle !== 'active' ||
      !profileStorageRefEquals(entry.storage, record.source)
    ) {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    if (
      this.getMigration(record.profileId) ||
      this.getMigration(record.operationId)
    ) {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    this.commit({
      ...this.document,
      migrations: [...this.document.migrations, clone(record)],
    });
    return clone(record);
  }

  updateMigration(
    operationId: string,
    patch: Partial<
      Pick<
        ProfileMigrationRecordV1,
        | 'phase'
        | 'committed'
        | 'sourceGeneration'
        | 'targetGeneration'
        | 'errorCode'
        | 'updatedAt'
      >
    >,
  ): ProfileMigrationRecordV1 {
    const index = this.document.migrations.findIndex(
      (record) => record.operationId === operationId,
    );
    if (index < 0)
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    const current = this.document.migrations[index];
    if (current.committed) {
      if (
        patch.committed === false ||
        (patch.phase && patch.phase !== 'cleanup_pending')
      ) {
        throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
      }
    } else if (patch.committed === true) {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    const updated: ProfileMigrationRecordV1 = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? this.now(),
    };
    const migrations = [...this.document.migrations];
    migrations[index] = updated;
    this.commit({ ...this.document, migrations });
    return clone(updated);
  }

  /** Storage and the committed migration marker cross the authority boundary in one write. */
  commitMigration(
    operationId: string,
    updatedAt = this.now(),
  ): ProfileMigrationRecordV1 {
    const migrationIndex = this.document.migrations.findIndex(
      (record) => record.operationId === operationId,
    );
    if (migrationIndex < 0)
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    const record = this.document.migrations[migrationIndex];
    if (record.committed || record.phase !== 'switching') {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    const profileIndex = this.document.profiles.findIndex(
      (entry) => entry.profileId === record.profileId,
    );
    if (
      profileIndex < 0 ||
      !profileStorageRefEquals(
        this.document.profiles[profileIndex].storage,
        record.source,
      )
    ) {
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    }
    const committedRecord: ProfileMigrationRecordV1 = {
      ...record,
      phase: 'cleanup_pending',
      committed: true,
      updatedAt,
    };
    const profiles = [...this.document.profiles];
    profiles[profileIndex] = {
      ...profiles[profileIndex],
      storage: clone(record.target),
    };
    const migrations = [...this.document.migrations];
    migrations[migrationIndex] = committedRecord;
    this.commit({ ...this.document, profiles, migrations });
    return clone(committedRecord);
  }

  completeMigration(operationId: string): boolean {
    const record = this.document.migrations.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (!record || !record.committed) return false;
    this.commit({
      ...this.document,
      migrations: this.document.migrations.filter(
        (candidate) => candidate.operationId !== operationId,
      ),
    });
    return true;
  }

  private loadOrBootstrap(): ProfileCatalogDocumentV1 {
    const file = this.filePath();
    let serialized: string;
    try {
      serialized = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ProfileCatalogError('PROFILE_CATALOG_IO_FAILED');
      }
      const defaultProfile = this.deps.defaultProfile ?? {
        id: DEFAULT_PROFILE_ID,
        name: 'Default',
        createdAt: 0,
      };
      const localProfiles = this.deps.localProfiles();
      const unique = new Map<string, BrowserProfile>();
      unique.set(DEFAULT_PROFILE_ID, defaultProfile);
      for (const profile of localProfiles) {
        if (
          profile.id !== DEFAULT_PROFILE_ID &&
          PROFILE_ID_RE.test(profile.id)
        ) {
          unique.set(profile.id, profile);
        }
      }
      const document: ProfileCatalogDocumentV1 = {
        version: PROFILE_CATALOG_VERSION,
        clientId:
          this.deps.newClientId?.() ?? randomBytes(32).toString('base64url'),
        profiles: [...unique.values()].map((profile) =>
          entryOf(profile, { kind: 'local' }),
        ),
        migrations: [],
      };
      const validated = validateDocument(document);
      if (!validated) throw new ProfileCatalogError('PROFILE_CATALOG_CORRUPT');
      this.write(validated);
      return validated;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new ProfileCatalogError('PROFILE_CATALOG_CORRUPT');
    }
    const document = validateDocument(parsed);
    if (!document) throw new ProfileCatalogError('PROFILE_CATALOG_CORRUPT');
    return document;
  }

  private commit(document: ProfileCatalogDocumentV1): void {
    const validated = validateDocument(document);
    if (!validated)
      throw new ProfileCatalogError('PROFILE_CATALOG_INVALID_TRANSITION');
    this.write(validated);
    this.document = validated;
  }

  private write(document: ProfileCatalogDocumentV1): void {
    const file = this.filePath();
    const directory = path.dirname(file);
    const temp = path.join(
      directory,
      `.${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`,
    );
    let fd: number | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(document, null, 2), 'utf8');
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
          // The stable catalog error below is the only outward detail.
        }
      }
      try {
        fs.unlinkSync(temp);
      } catch {
        // A temp file is never a readable authority and is safe to leave for later cleanup.
      }
      throw new ProfileCatalogError('PROFILE_CATALOG_IO_FAILED');
    }
  }

  private filePath(): string {
    let directory: string;
    try {
      directory =
        typeof this.deps.userDataDir === 'function'
          ? this.deps.userDataDir()
          : this.deps.userDataDir;
    } catch {
      throw new ProfileCatalogError('PROFILE_CATALOG_IO_FAILED');
    }
    if (!path.isAbsolute(directory))
      throw new ProfileCatalogError('PROFILE_CATALOG_IO_FAILED');
    return path.join(directory, PROFILE_CATALOG_FILE);
  }
}

export const DEFAULT_PROFILE_DELETE_ERROR =
  BROWSER_PROFILE_DELETION_ERROR_CODES.failed;
