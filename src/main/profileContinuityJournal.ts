import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_PROFILE_ID, PROFILE_ID_RE } from '../shared/browserProfile';

export const PROFILE_CONTINUITY_JOURNAL_VERSION = 1 as const;
export const PROFILE_CONTINUITY_JOURNAL_DIRECTORY =
  'browser-profile-continuity';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type ProfileContinuityJournalErrorCode =
  | 'CONTINUITY_JOURNAL_AUTHORITY_MISMATCH'
  | 'CONTINUITY_JOURNAL_CORRUPT'
  | 'CONTINUITY_JOURNAL_DECRYPT_FAILED'
  | 'CONTINUITY_JOURNAL_ENCRYPTION_UNAVAILABLE'
  | 'CONTINUITY_JOURNAL_INVALID_INPUT'
  | 'CONTINUITY_JOURNAL_IO_FAILED';

export class ProfileContinuityJournalError extends Error {
  constructor(readonly code: ProfileContinuityJournalErrorCode) {
    super(code);
    this.name = 'ProfileContinuityJournalError';
  }
}

export interface ProfileContinuityJournalSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface ProfileContinuityAuthority {
  hostId: string;
  epoch: number;
}

export interface ProfileContinuityIdentityRevision<TIdentity> {
  identity: TIdentity;
  revision: number;
}

export interface PendingContinuityOperation<TChange> {
  deviceId: string;
  operationId: string;
  profileEpoch: number;
  baseRevision: number;
  change: TChange;
}

export interface ProfileContinuityJournalV1<TIdentity, TChange> {
  version: typeof PROFILE_CONTINUITY_JOURNAL_VERSION;
  profileId: string;
  authority: ProfileContinuityAuthority;
  confirmedRevision: number;
  identityRevisions: Array<ProfileContinuityIdentityRevision<TIdentity>>;
  pending: Array<PendingContinuityOperation<TChange>>;
  seededPartitions: string[];
}

export interface ProfileContinuityConfirmation<TIdentity> {
  operationIds: string[];
  confirmedRevision: number;
  identityRevisionUpdates: Array<
    ProfileContinuityIdentityRevision<TIdentity>
  >;
}

export interface ProfileContinuityJournalDeps<TIdentity, TChange> {
  userDataDir: string | (() => string);
  safeStorage: ProfileContinuityJournalSafeStorage;
  validateIdentity(value: unknown): value is TIdentity;
  identityKey(identity: TIdentity): string;
  validateChange(value: unknown): value is TChange;
  validatePartition(partition: string, profileId: string): boolean;
}

interface EncryptedJournalEnvelopeV1 {
  version: typeof PROFILE_CONTINUITY_JOURNAL_VERSION;
  ciphertext: string;
}

type ValidationFailure =
  | 'CONTINUITY_JOURNAL_CORRUPT'
  | 'CONTINUITY_JOURNAL_INVALID_INPUT';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isProfileId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === DEFAULT_PROFILE_ID || PROFILE_ID_RE.test(value))
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isAuthority(value: unknown): value is ProfileContinuityAuthority {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['hostId', 'epoch']) ||
    typeof value.hostId !== 'string' ||
    value.hostId.length === 0 ||
    value.hostId.length > 256 ||
    value.hostId.trim() !== value.hostId ||
    !isNonNegativeSafeInteger(value.epoch)
  ) {
    return false;
  }
  return true;
}

function isStrictBase64(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_RE.test(value)
  ) {
    return false;
  }
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Per-profile encrypted pending-operation journal. It is deliberately main-only:
 * callers inject the shared Cookie validators while this module owns durable
 * encryption, validation and acknowledgement semantics.
 */
export class ProfileContinuityJournal<TIdentity, TChange> {
  constructor(private readonly deps: ProfileContinuityJournalDeps<TIdentity, TChange>) {}

  load(
    profileId: string,
    expectedAuthority: ProfileContinuityAuthority,
  ): ProfileContinuityJournalV1<TIdentity, TChange> {
    const validProfileId = this.requireProfileId(profileId);
    const validAuthority = this.requireAuthority(expectedAuthority);
    this.requireEncryption();
    const document = this.readDocument(validProfileId);
    if (!document) {
      return {
        version: PROFILE_CONTINUITY_JOURNAL_VERSION,
        profileId: validProfileId,
        authority: validAuthority,
        confirmedRevision: 0,
        identityRevisions: [],
        pending: [],
        seededPartitions: [],
      };
    }
    if (
      document.authority.hostId !== validAuthority.hostId ||
      document.authority.epoch !== validAuthority.epoch
    ) {
      throw new ProfileContinuityJournalError(
        'CONTINUITY_JOURNAL_AUTHORITY_MISMATCH',
      );
    }
    return document;
  }

  /**
   * Returns the validated historical Chromium partitions without requiring the
   * caller to know the journal's previous authority epoch. This deliberately
   * exposes no Cookie identity, operation, or value data.
   */
  listSeededPartitions(profileId: string): string[] {
    const validProfileId = this.requireProfileId(profileId);
    this.requireEncryption();
    return [...(this.readDocument(validProfileId)?.seededPartitions ?? [])];
  }

  save(
    document: ProfileContinuityJournalV1<TIdentity, TChange>,
  ): ProfileContinuityJournalV1<TIdentity, TChange> {
    this.requireEncryption();
    const valid = this.validateDocument(
      document,
      'CONTINUITY_JOURNAL_INVALID_INPUT',
    );
    const plaintext = JSON.stringify(valid);
    let encrypted: Buffer;
    try {
      encrypted = this.deps.safeStorage.encryptString(plaintext);
    } catch {
      throw new ProfileContinuityJournalError(
        'CONTINUITY_JOURNAL_ENCRYPTION_UNAVAILABLE',
      );
    }
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
      throw new ProfileContinuityJournalError(
        'CONTINUITY_JOURNAL_ENCRYPTION_UNAVAILABLE',
      );
    }

    const envelope: EncryptedJournalEnvelopeV1 = {
      version: PROFILE_CONTINUITY_JOURNAL_VERSION,
      ciphertext: encrypted.toString('base64'),
    };
    this.writeAtomic(valid.profileId, JSON.stringify(envelope));
    return clone(valid);
  }

  appendPending(
    document: ProfileContinuityJournalV1<TIdentity, TChange>,
    operation: PendingContinuityOperation<TChange>,
  ): ProfileContinuityJournalV1<TIdentity, TChange> {
    const valid = this.validateDocument(
      document,
      'CONTINUITY_JOURNAL_INVALID_INPUT',
    );
    const validOperation = this.validateOperation(
      operation,
      'CONTINUITY_JOURNAL_INVALID_INPUT',
    );
    if (validOperation.profileEpoch !== valid.authority.epoch) {
      throw new ProfileContinuityJournalError(
        'CONTINUITY_JOURNAL_AUTHORITY_MISMATCH',
      );
    }
    const existing = valid.pending.find(
      (candidate) => candidate.operationId === validOperation.operationId,
    );
    if (existing) {
      if (!isDeepStrictEqual(existing, validOperation)) this.invalidInput();
      return this.save(valid);
    }
    return this.save({
      ...valid,
      pending: [...valid.pending, validOperation],
    });
  }

  confirmPending(
    document: ProfileContinuityJournalV1<TIdentity, TChange>,
    confirmation: ProfileContinuityConfirmation<TIdentity>,
  ): ProfileContinuityJournalV1<TIdentity, TChange> {
    const valid = this.validateDocument(
      document,
      'CONTINUITY_JOURNAL_INVALID_INPUT',
    );
    const validConfirmation = this.validateConfirmation(confirmation);
    if (validConfirmation.confirmedRevision < valid.confirmedRevision) {
      this.invalidInput();
    }

    const revisions = new Map<string, ProfileContinuityIdentityRevision<TIdentity>>();
    for (const entry of valid.identityRevisions) {
      revisions.set(this.identityKey(entry.identity, 'CONTINUITY_JOURNAL_INVALID_INPUT'), entry);
    }
    for (const update of validConfirmation.identityRevisionUpdates) {
      const key = this.identityKey(
        update.identity,
        'CONTINUITY_JOURNAL_INVALID_INPUT',
      );
      const current = revisions.get(key);
      if (current && update.revision < current.revision) this.invalidInput();
      revisions.set(key, update);
    }

    const confirmedIds = new Set(validConfirmation.operationIds);
    return this.save({
      ...valid,
      confirmedRevision: validConfirmation.confirmedRevision,
      identityRevisions: [...revisions.values()],
      pending: valid.pending.filter(
        (operation) => !confirmedIds.has(operation.operationId),
      ),
    });
  }

  delete(profileId: string): boolean {
    const validProfileId = this.requireProfileId(profileId);
    const directory = this.storageDirectory();
    const file = this.journalPath(validProfileId);
    try {
      const directoryStat = fs.lstatSync(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        this.ioFailed();
      }
      fs.chmodSync(directory, DIRECTORY_MODE);
      fs.unlinkSync(file);
      this.fsyncDirectory(directory);
      return true;
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) return false;
      this.ioFailed();
    }
  }

  private readDocument(
    profileId: string,
  ): ProfileContinuityJournalV1<TIdentity, TChange> | null {
    this.ensureStorageDirectory();
    const file = this.journalPath(profileId);
    let serialized: string;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) this.corrupt();
      serialized = fs.readFileSync(file, 'utf8');
      fs.chmodSync(file, FILE_MODE);
    } catch (error) {
      if (error instanceof ProfileContinuityJournalError) throw error;
      if (isNodeErrorCode(error, 'ENOENT')) return null;
      this.ioFailed();
    }

    const envelope = this.parseEnvelope(serialized);
    const plaintext = this.decrypt(envelope.ciphertext);
    let raw: unknown;
    try {
      raw = JSON.parse(plaintext);
    } catch {
      this.corrupt();
    }
    const document = this.validateDocument(raw, 'CONTINUITY_JOURNAL_CORRUPT');
    if (document.profileId !== profileId) this.corrupt();
    return document;
  }

  private validateDocument(
    value: unknown,
    failure: ValidationFailure,
  ): ProfileContinuityJournalV1<TIdentity, TChange> {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'version',
        'profileId',
        'authority',
        'confirmedRevision',
        'identityRevisions',
        'pending',
        'seededPartitions',
      ]) ||
      value.version !== PROFILE_CONTINUITY_JOURNAL_VERSION ||
      !isProfileId(value.profileId) ||
      !isAuthority(value.authority) ||
      !isNonNegativeSafeInteger(value.confirmedRevision) ||
      !Array.isArray(value.identityRevisions) ||
      !Array.isArray(value.pending) ||
      !Array.isArray(value.seededPartitions)
    ) {
      this.validationFailed(failure);
    }

    const identityRevisions: Array<
      ProfileContinuityIdentityRevision<TIdentity>
    > = [];
    const identities = new Set<string>();
    for (const candidate of value.identityRevisions) {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, ['identity', 'revision']) ||
        !this.safeValidateIdentity(candidate.identity) ||
        !isNonNegativeSafeInteger(candidate.revision)
      ) {
        this.validationFailed(failure);
      }
      const key = this.identityKey(candidate.identity, failure);
      if (identities.has(key)) this.validationFailed(failure);
      identities.add(key);
      identityRevisions.push({
        identity: clone(candidate.identity),
        revision: candidate.revision,
      });
    }

    const pending: Array<PendingContinuityOperation<TChange>> = [];
    const operationIds = new Set<string>();
    for (const candidate of value.pending) {
      const operation = this.validateOperation(candidate, failure);
      if (
        operation.profileEpoch !== value.authority.epoch ||
        operationIds.has(operation.operationId)
      ) {
        this.validationFailed(failure);
      }
      operationIds.add(operation.operationId);
      pending.push(operation);
    }

    const seededPartitions: string[] = [];
    const partitions = new Set<string>();
    for (const partition of value.seededPartitions) {
      if (
        typeof partition !== 'string' ||
        !this.safeValidatePartition(partition, value.profileId) ||
        partitions.has(partition)
      ) {
        this.validationFailed(failure);
      }
      partitions.add(partition);
      seededPartitions.push(partition);
    }

    return {
      version: PROFILE_CONTINUITY_JOURNAL_VERSION,
      profileId: value.profileId,
      authority: clone(value.authority),
      confirmedRevision: value.confirmedRevision,
      identityRevisions,
      pending,
      seededPartitions,
    };
  }

  private validateOperation(
    value: unknown,
    failure: ValidationFailure,
  ): PendingContinuityOperation<TChange> {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'deviceId',
        'operationId',
        'profileEpoch',
        'baseRevision',
        'change',
      ]) ||
      typeof value.deviceId !== 'string' ||
      !DEVICE_ID_RE.test(value.deviceId) ||
      typeof value.operationId !== 'string' ||
      !UUID_RE.test(value.operationId) ||
      !isNonNegativeSafeInteger(value.profileEpoch) ||
      !isNonNegativeSafeInteger(value.baseRevision) ||
      !this.safeValidateChange(value.change)
    ) {
      this.validationFailed(failure);
    }
    return {
      deviceId: value.deviceId,
      operationId: value.operationId,
      profileEpoch: value.profileEpoch,
      baseRevision: value.baseRevision,
      change: clone(value.change),
    };
  }

  private validateConfirmation(
    value: ProfileContinuityConfirmation<TIdentity>,
  ): ProfileContinuityConfirmation<TIdentity> {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'operationIds',
        'confirmedRevision',
        'identityRevisionUpdates',
      ]) ||
      !Array.isArray(value.operationIds) ||
      !isNonNegativeSafeInteger(value.confirmedRevision) ||
      !Array.isArray(value.identityRevisionUpdates)
    ) {
      this.invalidInput();
    }
    const operationIds: string[] = [];
    const seenOperations = new Set<string>();
    for (const operationId of value.operationIds) {
      if (
        typeof operationId !== 'string' ||
        !UUID_RE.test(operationId) ||
        seenOperations.has(operationId)
      ) {
        this.invalidInput();
      }
      seenOperations.add(operationId);
      operationIds.push(operationId);
    }
    const identityRevisionUpdates: Array<
      ProfileContinuityIdentityRevision<TIdentity>
    > = [];
    const identities = new Set<string>();
    for (const candidate of value.identityRevisionUpdates) {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, ['identity', 'revision']) ||
        !this.safeValidateIdentity(candidate.identity) ||
        !isNonNegativeSafeInteger(candidate.revision)
      ) {
        this.invalidInput();
      }
      const key = this.identityKey(
        candidate.identity,
        'CONTINUITY_JOURNAL_INVALID_INPUT',
      );
      if (identities.has(key)) this.invalidInput();
      identities.add(key);
      identityRevisionUpdates.push({
        identity: clone(candidate.identity),
        revision: candidate.revision,
      });
    }
    return {
      operationIds,
      confirmedRevision: value.confirmedRevision,
      identityRevisionUpdates,
    };
  }

  private parseEnvelope(serialized: string): EncryptedJournalEnvelopeV1 {
    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      this.corrupt();
    }
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, ['version', 'ciphertext']) ||
      raw.version !== PROFILE_CONTINUITY_JOURNAL_VERSION ||
      !isStrictBase64(raw.ciphertext)
    ) {
      this.corrupt();
    }
    return {
      version: PROFILE_CONTINUITY_JOURNAL_VERSION,
      ciphertext: raw.ciphertext,
    };
  }

  private decrypt(ciphertext: string): string {
    let plaintext: string;
    try {
      plaintext = this.deps.safeStorage.decryptString(
        Buffer.from(ciphertext, 'base64'),
      );
    } catch {
      throw new ProfileContinuityJournalError(
        'CONTINUITY_JOURNAL_DECRYPT_FAILED',
      );
    }
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new ProfileContinuityJournalError(
        'CONTINUITY_JOURNAL_DECRYPT_FAILED',
      );
    }
    return plaintext;
  }

  private writeAtomic(profileId: string, serialized: string): void {
    const directory = this.ensureStorageDirectory();
    const file = this.journalPath(profileId);
    const temporary = path.join(
      directory,
      `.${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`,
    );
    let descriptor: number | undefined;
    let renamed = false;
    try {
      descriptor = fs.openSync(temporary, 'wx', FILE_MODE);
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.chmodSync(temporary, FILE_MODE);
      fs.renameSync(temporary, file);
      renamed = true;
      fs.chmodSync(file, FILE_MODE);
      this.fsyncDirectory(directory);
    } catch {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // The stable error below is the only outward detail.
        }
      }
      if (!renamed) {
        try {
          fs.unlinkSync(temporary);
        } catch {
          // A temporary file is never treated as a readable journal.
        }
      }
      this.ioFailed();
    }
  }

  private ensureStorageDirectory(): string {
    const directory = this.storageDirectory();
    try {
      fs.mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) this.ioFailed();
      fs.chmodSync(directory, DIRECTORY_MODE);
      return directory;
    } catch (error) {
      if (error instanceof ProfileContinuityJournalError) throw error;
      this.ioFailed();
    }
  }

  private storageDirectory(): string {
    return path.join(
      this.userDataDirectory(),
      PROFILE_CONTINUITY_JOURNAL_DIRECTORY,
    );
  }

  private journalPath(profileId: string): string {
    return path.join(this.storageDirectory(), `${profileId}.journal`);
  }

  private userDataDirectory(): string {
    let directory: string;
    try {
      directory =
        typeof this.deps.userDataDir === 'function'
          ? this.deps.userDataDir()
          : this.deps.userDataDir;
    } catch {
      this.ioFailed();
    }
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      this.invalidInput();
    }
    return directory;
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
          // The stable error below is the only outward detail.
        }
      }
      this.ioFailed();
    }
  }

  private requireEncryption(): void {
    let available = false;
    try {
      available = this.deps.safeStorage.isEncryptionAvailable() === true;
    } catch {
      // Stable unavailable result below.
    }
    if (!available) {
      throw new ProfileContinuityJournalError(
        'CONTINUITY_JOURNAL_ENCRYPTION_UNAVAILABLE',
      );
    }
  }

  private requireProfileId(profileId: string): string {
    if (!isProfileId(profileId)) this.invalidInput();
    return profileId;
  }

  private requireAuthority(
    authority: ProfileContinuityAuthority,
  ): ProfileContinuityAuthority {
    if (!isAuthority(authority)) this.invalidInput();
    return clone(authority);
  }

  private safeValidateIdentity(value: unknown): value is TIdentity {
    try {
      return this.deps.validateIdentity(value) === true;
    } catch {
      return false;
    }
  }

  private safeValidateChange(value: unknown): value is TChange {
    try {
      return this.deps.validateChange(value) === true;
    } catch {
      return false;
    }
  }

  private safeValidatePartition(partition: string, profileId: string): boolean {
    try {
      return this.deps.validatePartition(partition, profileId) === true;
    } catch {
      return false;
    }
  }

  private identityKey(identity: TIdentity, failure: ValidationFailure): string {
    let key: string;
    try {
      key = this.deps.identityKey(identity);
    } catch {
      this.validationFailed(failure);
    }
    if (typeof key !== 'string' || key.length === 0) {
      this.validationFailed(failure);
    }
    return key;
  }

  private validationFailed(failure: ValidationFailure): never {
    throw new ProfileContinuityJournalError(failure);
  }

  private invalidInput(): never {
    throw new ProfileContinuityJournalError(
      'CONTINUITY_JOURNAL_INVALID_INPUT',
    );
  }

  private corrupt(): never {
    throw new ProfileContinuityJournalError('CONTINUITY_JOURNAL_CORRUPT');
  }

  private ioFailed(): never {
    throw new ProfileContinuityJournalError('CONTINUITY_JOURNAL_IO_FAILED');
  }
}
