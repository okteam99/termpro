import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_USERNAME_LENGTH,
  type PasswordCredentialMetadata,
  type PasswordMetadataQuery,
  type PasswordVaultErrorCode,
} from '../shared/passwordVault';
import { DEFAULT_PROFILE_ID, PROFILE_ID_RE } from '../shared/browserProfile';

const VAULT_DIRECTORY = 'browser-password-vault';
const VAULT_VERSION = 1 as const;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_QUERY_LENGTH = 4_096;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface PasswordVaultSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface PasswordVaultLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface LocalPasswordVaultDeps {
  userDataDir: string | (() => string);
  safeStorage: PasswordVaultSafeStorage;
  logger?: PasswordVaultLogger;
}

export interface DecryptedPasswordCredential extends PasswordCredentialMetadata {
  password: string;
}

export interface PasswordVaultUpsertInput {
  profileId: string;
  origin: string;
  username: string;
  password: string;
  now?: number;
}

export interface PasswordVaultUpsertResult {
  kind: 'saved' | 'updated';
  metadata: PasswordCredentialMetadata;
}

interface VaultEntryV1 {
  id: string;
  origin: string;
  username: string;
  encryptedPassword: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

interface VaultDocumentV1 {
  version: typeof VAULT_VERSION;
  profileId: string;
  entries: VaultEntryV1[];
}

const ERROR_MESSAGES: Record<PasswordVaultErrorCode, string> = {
  VAULT_ENCRYPTION_UNAVAILABLE: 'Password-vault encryption is unavailable',
  VAULT_CORRUPT: 'Password-vault data is invalid',
  VAULT_DECRYPT_FAILED: 'Password-vault entry could not be decrypted',
  VAULT_ENTRY_NOT_FOUND: 'Password-vault entry was not found',
  VAULT_FORBIDDEN: 'Password-vault operation is forbidden',
  VAULT_INVALID_INPUT: 'Password-vault input is invalid',
  VAULT_INSECURE_ORIGIN: 'Password-vault origin is not allowed',
  VAULT_IO_FAILED: 'Password-vault storage operation failed',
  VAULT_PROFILE_INACTIVE: 'Password-vault profile is inactive',
  VAULT_REMOTE_AUTHORITY_OFFLINE: 'Remote password-vault storage is offline',
  VAULT_REMOTE_TIMEOUT: 'Remote password-vault storage timed out',
  VAULT_MIGRATION_IN_PROGRESS: 'Password-vault migration is in progress',
  VAULT_REMOTE_ENCRYPTION_UNAVAILABLE:
    'Remote password-vault encryption is unavailable',
  VAULT_REMOTE_CORRUPT: 'Remote password-vault data is invalid',
  VAULT_PROFILE_MISMATCH: 'Password-vault profile does not match',
  VAULT_REMOTE_INCOMPATIBLE: 'Remote password-vault version is incompatible',
};

export class PasswordVaultError extends Error {
  readonly code: PasswordVaultErrorCode;

  constructor(code: PasswordVaultErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'PasswordVaultError';
    this.code = code;
  }
}

const DEFAULT_LOGGER: PasswordVaultLogger = {
  warn: (message, context) =>
    console.warn(`[passwordVault] ${message}`, context),
  error: (message, context) =>
    console.error(`[passwordVault] ${message}`, context),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isProfileId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === DEFAULT_PROFILE_ID || PROFILE_ID_RE.test(value))
  );
}

function isCanonicalHttpOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === value &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

function isStrictBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0)
    return false;
  if (!BASE64_RE.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function metadataOf(
  profileId: string,
  entry: VaultEntryV1,
): PasswordCredentialMetadata {
  return {
    id: entry.id,
    profileId,
    origin: entry.origin,
    username: entry.username,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastUsedAt: entry.lastUsedAt,
  };
}

function sortByRecent<
  T extends Pick<PasswordCredentialMetadata, 'lastUsedAt' | 'updatedAt' | 'id'>,
>(entries: T[]): T[] {
  return entries.sort(
    (left, right) =>
      right.lastUsedAt - left.lastUsedAt ||
      right.updatedAt - left.updatedAt ||
      left.id.localeCompare(right.id),
  );
}

/**
 * Per-profile, safeStorage-encrypted password documents. This concrete local
 * store intentionally does not introduce a provider abstraction before BL-007
 * adds the second (remote) adapter.
 */
export class LocalPasswordVault {
  private readonly logger: PasswordVaultLogger;

  constructor(private readonly deps: LocalPasswordVaultDeps) {
    this.logger = deps.logger ?? DEFAULT_LOGGER;
  }

  isAvailable(): boolean {
    try {
      return this.deps.safeStorage.isEncryptionAvailable() === true;
    } catch {
      this.logger.warn('encryption capability check failed', {
        code: 'VAULT_ENCRYPTION_UNAVAILABLE',
      });
      return false;
    }
  }

  listMetadata(
    query: PasswordMetadataQuery = {},
  ): PasswordCredentialMetadata[] {
    if (query === null || typeof query !== 'object' || Array.isArray(query)) {
      this.invalidInput('query');
    }
    const profileIds =
      query.profileId !== undefined
        ? [this.requireProfileId(query.profileId)]
        : this.listProfileIds();
    if (query.query !== undefined && typeof query.query !== 'string') {
      this.invalidInput('query');
    }
    const normalizedQuery = (query.query ?? '').trim().toLowerCase();
    if (normalizedQuery.length > MAX_QUERY_LENGTH) this.invalidInput('query');

    const metadata = profileIds.flatMap((profileId) => {
      const document = this.readDocument(profileId);
      return document.entries.map((entry) => metadataOf(profileId, entry));
    });
    const filtered = normalizedQuery
      ? metadata.filter((entry) =>
          `${entry.profileId}\n${entry.origin}\n${entry.username}`
            .toLowerCase()
            .includes(normalizedQuery),
        )
      : metadata;
    return sortByRecent(filtered);
  }

  lookup(profileId: string, origin: string): DecryptedPasswordCredential[] {
    const validProfileId = this.requireProfileId(profileId);
    const validOrigin = this.requireOrigin(origin);
    this.requireEncryption();
    const document = this.readDocument(validProfileId);
    const candidates = document.entries
      .filter((entry) => entry.origin === validOrigin)
      .map((entry) => this.decryptEntry(validProfileId, entry));
    return sortByRecent(candidates);
  }

  getDecrypted(profileId: string, id: string): DecryptedPasswordCredential {
    const validProfileId = this.requireProfileId(profileId);
    const validId = this.requireEntryId(id);
    this.requireEncryption();
    const document = this.readDocument(validProfileId);
    const entry = document.entries.find(
      (candidate) => candidate.id === validId,
    );
    if (entry) return this.decryptEntry(validProfileId, entry);
    this.logger.warn('entry lookup missed', {
      code: 'VAULT_ENTRY_NOT_FOUND',
      entryId: validId,
    });
    throw new PasswordVaultError('VAULT_ENTRY_NOT_FOUND');
  }

  upsert(input: PasswordVaultUpsertInput): PasswordVaultUpsertResult {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      this.invalidInput('input');
    }
    const profileId = this.requireProfileId(input.profileId);
    const origin = this.requireOrigin(input.origin);
    const username = this.requireUsername(input.username);
    const password = this.requirePassword(input.password);
    const now = input.now ?? Date.now();
    if (!isTimestamp(now)) this.invalidInput('now');
    this.requireEncryption();

    const document = this.readDocument(profileId);
    const existingIndex = document.entries.findIndex(
      (entry) => entry.origin === origin && entry.username === username,
    );
    let kind: PasswordVaultUpsertResult['kind'];
    let nextEntry: VaultEntryV1;

    if (existingIndex >= 0) {
      const existing = document.entries[existingIndex];
      const currentPassword = this.decryptPassword(profileId, existing);
      const changed = currentPassword !== password;
      const effectiveNow = Math.max(
        now,
        existing.updatedAt,
        existing.lastUsedAt,
      );
      nextEntry = {
        ...existing,
        encryptedPassword: changed
          ? this.encryptPassword(profileId, password)
          : existing.encryptedPassword,
        updatedAt: changed ? effectiveNow : existing.updatedAt,
        lastUsedAt: effectiveNow,
      };
      document.entries[existingIndex] = nextEntry;
      kind = 'updated';
    } else {
      nextEntry = {
        id: randomUUID(),
        origin,
        username,
        encryptedPassword: this.encryptPassword(profileId, password),
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
      };
      document.entries.push(nextEntry);
      kind = 'saved';
    }

    this.writeDocument(document);
    return { kind, metadata: metadataOf(profileId, nextEntry) };
  }

  deleteEntry(profileId: string, id: string): boolean {
    const validProfileId = this.requireProfileId(profileId);
    const validId = this.requireEntryId(id);
    const document = this.readDocument(validProfileId);
    const nextEntries = document.entries.filter(
      (entry) => entry.id !== validId,
    );
    if (nextEntries.length === document.entries.length) return false;
    this.writeDocument({ ...document, entries: nextEntries });
    return true;
  }

  exportProfile(profileId: string): DecryptedPasswordCredential[] {
    const validProfileId = this.requireProfileId(profileId);
    this.requireEncryption();
    return this.readDocument(validProfileId).entries.map((entry) =>
      this.decryptEntry(validProfileId, entry),
    );
  }

  replaceProfile(
    profileId: string,
    credentials: DecryptedPasswordCredential[],
  ): void {
    const validProfileId = this.requireProfileId(profileId);
    if (!Array.isArray(credentials)) this.invalidInput('credentials');
    this.requireEncryption();
    const seen = new Set<string>();
    const entries: VaultEntryV1[] = credentials.map((credential) => {
      if (!credential || credential.profileId !== validProfileId) {
        throw new PasswordVaultError('VAULT_PROFILE_MISMATCH');
      }
      const id = this.requireEntryId(credential.id);
      if (seen.has(id)) this.invalidInput('credential.id');
      seen.add(id);
      const origin = this.requireOrigin(credential.origin);
      const username = this.requireUsername(credential.username);
      const password = this.requirePassword(credential.password);
      if (
        !isTimestamp(credential.createdAt) ||
        !isTimestamp(credential.updatedAt) ||
        !isTimestamp(credential.lastUsedAt)
      ) {
        this.invalidInput('credential.timestamp');
      }
      return {
        id,
        origin,
        username,
        encryptedPassword: this.encryptPassword(validProfileId, password),
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
        lastUsedAt: credential.lastUsedAt,
      };
    });
    this.writeDocument({
      version: VAULT_VERSION,
      profileId: validProfileId,
      entries,
    });
  }

  deleteProfile(profileId: string): boolean {
    const validProfileId = this.requireProfileId(profileId);
    const directory = this.ensureStorageDirectory();
    const file = this.documentPath(validProfileId);
    try {
      fs.unlinkSync(file);
      this.fsyncDirectory(directory);
      return true;
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) return false;
      this.ioFailed('deleteProfile', validProfileId);
    }
  }

  private userDataDir(): string {
    let directory: string;
    try {
      directory =
        typeof this.deps.userDataDir === 'function'
          ? this.deps.userDataDir()
          : this.deps.userDataDir;
    } catch {
      this.ioFailed('resolveUserDataDirectory');
    }
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      this.invalidInput('userDataDir');
    }
    return directory;
  }

  private storageDirectory(): string {
    return path.join(this.userDataDir(), VAULT_DIRECTORY);
  }

  private documentPath(profileId: string): string {
    return path.join(this.storageDirectory(), `${profileId}.json`);
  }

  private ensureStorageDirectory(): string {
    const directory = this.storageDirectory();
    try {
      fs.mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        this.ioFailed('validateDirectory');
      fs.chmodSync(directory, DIRECTORY_MODE);
      return directory;
    } catch (error) {
      if (error instanceof PasswordVaultError) throw error;
      this.ioFailed('ensureDirectory');
    }
  }

  private listProfileIds(): string[] {
    const directory = this.ensureStorageDirectory();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      this.ioFailed('listDocuments');
    }

    const profileIds: string[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      const profileId = entry.name.slice(0, -'.json'.length);
      if (!entry.isFile() || !isProfileId(profileId)) {
        this.corrupt('listDocuments');
      }
      profileIds.push(profileId);
    }
    return profileIds.sort();
  }

  private readDocument(profileId: string): VaultDocumentV1 {
    this.ensureStorageDirectory();
    const file = this.documentPath(profileId);
    let serialized: string;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink())
        this.corrupt('validateDocumentFile', profileId);
      serialized = fs.readFileSync(file, 'utf8');
      fs.chmodSync(file, FILE_MODE);
    } catch (error) {
      if (error instanceof PasswordVaultError) throw error;
      if (isNodeErrorCode(error, 'ENOENT')) {
        return { version: VAULT_VERSION, profileId, entries: [] };
      }
      this.ioFailed('readDocument', profileId);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      this.corrupt('parseDocument', profileId);
    }
    return this.parseDocument(raw, profileId);
  }

  private parseDocument(
    raw: unknown,
    expectedProfileId: string,
  ): VaultDocumentV1 {
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, ['version', 'profileId', 'entries']) ||
      raw.version !== VAULT_VERSION ||
      raw.profileId !== expectedProfileId ||
      !Array.isArray(raw.entries)
    ) {
      this.corrupt('validateDocument', expectedProfileId);
    }

    const entries: VaultEntryV1[] = [];
    const ids = new Set<string>();
    const accountKeys = new Set<string>();
    for (const rawEntry of raw.entries) {
      if (
        !isRecord(rawEntry) ||
        !hasExactKeys(rawEntry, [
          'id',
          'origin',
          'username',
          'encryptedPassword',
          'createdAt',
          'updatedAt',
          'lastUsedAt',
        ]) ||
        typeof rawEntry.id !== 'string' ||
        !UUID_RE.test(rawEntry.id) ||
        !isCanonicalHttpOrigin(rawEntry.origin) ||
        typeof rawEntry.username !== 'string' ||
        rawEntry.username.length === 0 ||
        rawEntry.username.trim() !== rawEntry.username ||
        rawEntry.username.length > MAX_PASSWORD_USERNAME_LENGTH ||
        !isStrictBase64(rawEntry.encryptedPassword) ||
        !isTimestamp(rawEntry.createdAt) ||
        !isTimestamp(rawEntry.updatedAt) ||
        !isTimestamp(rawEntry.lastUsedAt) ||
        rawEntry.updatedAt < rawEntry.createdAt ||
        rawEntry.lastUsedAt < rawEntry.updatedAt ||
        ids.has(rawEntry.id)
      ) {
        this.corrupt('validateEntry', expectedProfileId);
      }
      const accountKey = `${rawEntry.origin}\0${rawEntry.username}`;
      if (accountKeys.has(accountKey))
        this.corrupt('validateAccountKey', expectedProfileId);
      ids.add(rawEntry.id);
      accountKeys.add(accountKey);
      entries.push({
        id: rawEntry.id,
        origin: rawEntry.origin,
        username: rawEntry.username,
        encryptedPassword: rawEntry.encryptedPassword,
        createdAt: rawEntry.createdAt,
        updatedAt: rawEntry.updatedAt,
        lastUsedAt: rawEntry.lastUsedAt,
      });
    }
    return { version: VAULT_VERSION, profileId: expectedProfileId, entries };
  }

  private writeDocument(document: VaultDocumentV1): void {
    const directory = this.ensureStorageDirectory();
    const file = this.documentPath(document.profileId);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    const serialized = JSON.stringify(document, null, 2);
    let descriptor: number | undefined;
    let renamed = false;

    try {
      descriptor = fs.openSync(tmp, 'wx', FILE_MODE);
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(tmp, file);
      renamed = true;
      fs.chmodSync(file, FILE_MODE);
      this.fsyncDirectory(directory);
    } catch {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          this.logger.warn('temporary document close failed', {
            code: 'VAULT_IO_FAILED',
            operation: 'closeTemporaryDocument',
            profileId: document.profileId,
          });
        }
      }
      if (!renamed) {
        try {
          fs.unlinkSync(tmp);
        } catch (cleanupError) {
          if (!isNodeErrorCode(cleanupError, 'ENOENT')) {
            this.logger.warn('temporary document cleanup failed', {
              code: 'VAULT_IO_FAILED',
              operation: 'cleanupTemporaryDocument',
              profileId: document.profileId,
            });
          }
        }
      }
      this.ioFailed('writeDocument', document.profileId);
    }
  }

  private fsyncDirectory(directory: string): void {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(directory, 'r');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
    } catch {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          this.logger.warn('directory descriptor close failed', {
            code: 'VAULT_IO_FAILED',
            operation: 'closeDirectory',
          });
        }
      }
      this.ioFailed('fsyncDirectory');
    }
  }

  private decryptEntry(
    profileId: string,
    entry: VaultEntryV1,
  ): DecryptedPasswordCredential {
    return {
      ...metadataOf(profileId, entry),
      password: this.decryptPassword(profileId, entry),
    };
  }

  private decryptPassword(profileId: string, entry: VaultEntryV1): string {
    try {
      const plaintext = this.deps.safeStorage.decryptString(
        Buffer.from(entry.encryptedPassword, 'base64'),
      );
      if (
        typeof plaintext !== 'string' ||
        plaintext.length === 0 ||
        plaintext.length > MAX_PASSWORD_LENGTH
      ) {
        this.decryptFailed(profileId, entry.id);
      }
      return plaintext;
    } catch (error) {
      if (error instanceof PasswordVaultError) throw error;
      this.decryptFailed(profileId, entry.id);
    }
  }

  private encryptPassword(profileId: string, password: string): string {
    try {
      const encrypted = this.deps.safeStorage.encryptString(password);
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
        this.encryptionUnavailable('encryptPassword', profileId);
      }
      return encrypted.toString('base64');
    } catch (error) {
      if (error instanceof PasswordVaultError) throw error;
      this.encryptionUnavailable('encryptPassword', profileId);
    }
  }

  private requireEncryption(): void {
    if (!this.isAvailable()) this.encryptionUnavailable('capabilityCheck');
  }

  private requireProfileId(profileId: string): string {
    if (!isProfileId(profileId)) this.invalidInput('profileId');
    return profileId;
  }

  private requireOrigin(origin: string): string {
    if (!isCanonicalHttpOrigin(origin)) this.invalidInput('origin');
    return origin;
  }

  private requireUsername(username: string): string {
    if (typeof username !== 'string') this.invalidInput('username');
    const normalized = username.trim();
    if (
      normalized.length === 0 ||
      normalized.length > MAX_PASSWORD_USERNAME_LENGTH
    ) {
      this.invalidInput('username');
    }
    return normalized;
  }

  private requirePassword(password: string): string {
    if (
      typeof password !== 'string' ||
      password.length === 0 ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      this.invalidInput('password');
    }
    return password;
  }

  private requireEntryId(id: string): string {
    if (typeof id !== 'string' || !UUID_RE.test(id))
      this.invalidInput('entryId');
    return id;
  }

  private invalidInput(field: string): never {
    this.logger.warn('invalid input rejected', {
      code: 'VAULT_INVALID_INPUT',
      field,
    });
    throw new PasswordVaultError('VAULT_INVALID_INPUT');
  }

  private corrupt(operation: string, profileId?: string): never {
    this.logger.error('vault document rejected', {
      code: 'VAULT_CORRUPT',
      operation,
      ...(profileId ? { profileId } : {}),
    });
    throw new PasswordVaultError('VAULT_CORRUPT');
  }

  private decryptFailed(profileId: string, entryId: string): never {
    this.logger.error('vault entry decryption failed', {
      code: 'VAULT_DECRYPT_FAILED',
      profileId,
      entryId,
    });
    throw new PasswordVaultError('VAULT_DECRYPT_FAILED');
  }

  private encryptionUnavailable(operation: string, profileId?: string): never {
    this.logger.warn('vault encryption unavailable', {
      code: 'VAULT_ENCRYPTION_UNAVAILABLE',
      operation,
      ...(profileId ? { profileId } : {}),
    });
    throw new PasswordVaultError('VAULT_ENCRYPTION_UNAVAILABLE');
  }

  private ioFailed(operation: string, profileId?: string): never {
    this.logger.error('vault storage operation failed', {
      code: 'VAULT_IO_FAILED',
      operation,
      ...(profileId ? { profileId } : {}),
    });
    throw new PasswordVaultError('VAULT_IO_FAILED');
  }
}
