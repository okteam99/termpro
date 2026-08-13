import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PROFILE_CONTINUITY_ITEM_MAX_BYTES,
  PROFILE_CONTINUITY_VERSION,
  ProfileContinuityValidationError,
  continuityCookieIdentityKey,
  parseContinuityCookieRecord,
  parseContinuityMigrationActivateRequest,
  parseContinuityMigrationDiscardRequest,
  parseContinuityMigrationFreezeRequest,
  parseContinuityMigrationPublishRequest,
  parseContinuityMigrationStageRequest,
  parseContinuityMigrationVerifyRequest,
  parseContinuityOperation,
  parseContinuityPullRequest,
  parseProfileRetireRequest,
  serializedContinuityItemBytes,
  type ContinuityCookieRecord,
  type ContinuityMigrationDiscardResult,
  type ContinuityMigrationFreezeResult,
  type ContinuityMigrationStageResult,
  type ContinuityMigrationVerifyResult,
  type ContinuityOperation,
  type ContinuityOperationResult,
  type ContinuityPage,
  type ContinuityPullRequest,
  type ProfileContinuityLifecycleResult,
  type ProfileRetireRequest,
  type ProfileRetireResult,
} from '../shared/profileContinuity';
import type { RemoteProfileRpcResponseErrorCode } from '../shared/remoteProfileStore';
import {
  REMOTE_PROFILE_DIRECTORY_MODE,
  atomicWritePrivateFile,
  deletePrivateFile,
  ensurePrivateDirectory,
  readPrivateFile,
} from './remoteProfileCrypto';

const ENVELOPE_VERSION = 1 as const;
const ALGORITHM = 'aes-256-gcm' as const;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PROFILE_ID_RE = /^(?:default|[0-9a-f]{32})$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{43}$/;

type ContinuityErrorCode = Extract<
  RemoteProfileRpcResponseErrorCode,
  | 'PROFILE_RPC_INVALID_INPUT'
  | 'PROFILE_RPC_ENCRYPTION_UNAVAILABLE'
  | 'PROFILE_RPC_CORRUPT'
  | 'PROFILE_RPC_NOT_FOUND'
  | 'PROFILE_RPC_IO_FAILED'
  | 'PROFILE_CONTINUITY_BUSY'
  | 'PROFILE_CONTINUITY_ITEM_TOO_LARGE'
  | 'PROFILE_CONTINUITY_STALE_EPOCH'
  | 'PROFILE_CONTINUITY_LEGACY_DELETE_FORBIDDEN'
  | 'PROFILE_MOVED'
  | 'PROFILE_DELETED'
>;

interface StoredOperationResult {
  deviceId: string;
  operationId: string;
  result: ContinuityOperationResult;
}

interface StoredRetireOperation {
  operationId: string;
  result: ProfileRetireResult;
}

interface ContinuityMigrationMarker {
  operationId: string;
  role: 'source' | 'target';
  state: 'frozen' | 'staged' | 'published' | 'activated';
  sourceEpoch: number;
  nonce?: string;
  digest?: string;
}

interface ContinuityHostDocumentV1 {
  version: typeof PROFILE_CONTINUITY_VERSION;
  profileId: string;
  epoch: number;
  lifecycle: 'active' | 'moving' | 'moved' | 'deleted';
  movedTo?: 'remote' | 'local';
  revision: number;
  records: ContinuityCookieRecord[];
  operations: StoredOperationResult[];
  retireOperation?: StoredRetireOperation;
  migration?: ContinuityMigrationMarker;
}

interface StagedMigrationPage {
  fromRevision: number;
  nextRevision: number;
  digest: string;
}

interface ContinuityMigrationStagingV1 {
  version: typeof PROFILE_CONTINUITY_VERSION;
  operationId: string;
  profileId: string;
  sourceEpoch: number;
  revision: number;
  records: ContinuityCookieRecord[];
  pages: StagedMigrationPage[];
  verified?: { nonce: string; digest: string; revision: number };
}

interface EncryptedContinuityEnvelopeV1 {
  version: typeof ENVELOPE_VERSION;
  algorithm: typeof ALGORITHM;
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

export class ProfileContinuityStoreError extends Error {
  readonly code: ContinuityErrorCode;

  constructor(code: ContinuityErrorCode) {
    super('Profile continuity operation failed');
    this.name = 'ProfileContinuityStoreError';
    this.code = code;
  }
}

export interface ProfileContinuityStoreDeps {
  /** Existing profile-store root containing master.key. */
  rootDirectory: string;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isSafeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function validateProfileId(profileId: unknown): asserts profileId is string {
  if (typeof profileId !== 'string' || !PROFILE_ID_RE.test(profileId)) {
    throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
  }
}

function decodeBase64Url(
  value: unknown,
  expectedBytes?: number,
): Buffer | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) return null;
    if (expectedBytes !== undefined && decoded.length !== expectedBytes)
      return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseResult(input: unknown): ContinuityOperationResult {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'operationId',
      'revision',
      'outcome',
      'current',
    ]) ||
    typeof input.operationId !== 'string' ||
    !UUID_RE.test(input.operationId) ||
    !isSafeRevision(input.revision) ||
    (input.outcome !== 'accepted' &&
      input.outcome !== 'conflict_won' &&
      input.outcome !== 'stale_rejected')
  ) {
    throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
  }
  let current: ContinuityCookieRecord;
  try {
    current = parseContinuityCookieRecord(input.current);
  } catch (error) {
    if (error instanceof ProfileContinuityValidationError) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    throw error;
  }
  if (current.revision !== input.revision) {
    throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
  }
  return {
    operationId: input.operationId,
    revision: input.revision,
    outcome: input.outcome,
    current,
  };
}

function parseLifecycleResult(
  input: unknown,
  expectedProfileId: string,
): ProfileRetireResult {
  if (
    !isRecord(input) ||
    !hasExactKeys(
      input,
      ['operationId', 'profileId', 'epoch', 'lifecycle'],
      ['movedTo'],
    ) ||
    typeof input.operationId !== 'string' ||
    !UUID_RE.test(input.operationId) ||
    input.profileId !== expectedProfileId ||
    !isSafeRevision(input.epoch) ||
    (input.lifecycle !== 'moved' && input.lifecycle !== 'deleted') ||
    (input.lifecycle === 'moved' &&
      input.movedTo !== 'remote' &&
      input.movedTo !== 'local') ||
    (input.lifecycle === 'deleted' && input.movedTo !== undefined)
  ) {
    throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
  }
  return {
    operationId: input.operationId,
    profileId: expectedProfileId,
    epoch: input.epoch,
    lifecycle: input.lifecycle,
    ...(input.lifecycle === 'moved'
      ? { movedTo: input.movedTo as 'remote' | 'local' }
      : {}),
  };
}

function defaultDocument(profileId: string): ContinuityHostDocumentV1 {
  return {
    version: PROFILE_CONTINUITY_VERSION,
    profileId,
    epoch: 0,
    lifecycle: 'active',
    revision: 0,
    records: [],
    operations: [],
  };
}

export class ProfileContinuityStore {
  readonly continuityDirectory: string;
  readonly migrationDirectory: string;
  readonly locksDirectory: string;

  private readonly keyPath: string;
  private readonly now: () => number;

  constructor(deps: ProfileContinuityStoreDeps) {
    if (!path.isAbsolute(deps.rootDirectory)) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    this.continuityDirectory = path.join(
      deps.rootDirectory,
      'continuity',
    );
    this.migrationDirectory = path.join(
      deps.rootDirectory,
      'continuity-staging',
    );
    this.locksDirectory = path.join(deps.rootDirectory, 'continuity-locks');
    this.keyPath = path.join(deps.rootDirectory, 'master.key');
    this.now = deps.now ?? Date.now;
    ensurePrivateDirectory(this.continuityDirectory);
    ensurePrivateDirectory(this.migrationDirectory);
    ensurePrivateDirectory(this.locksDirectory);
  }

  hasDocument(profileId: string): boolean {
    validateProfileId(profileId);
    try {
      const stat = fs.lstatSync(this.documentPath(profileId));
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_IO_FAILED');
      }
      return true;
    } catch (error) {
      if (error instanceof ProfileContinuityStoreError) throw error;
      if (isNodeErrorCode(error, 'ENOENT')) return false;
      throw new ProfileContinuityStoreError('PROFILE_RPC_IO_FAILED');
    }
  }

  lifecycle(profileId: string): ProfileContinuityLifecycleResult {
    validateProfileId(profileId);
    const document = this.readDocument(profileId) ?? defaultDocument(profileId);
    return this.lifecycleOf(document);
  }

  assertActive(profileId: string): void {
    const lifecycle = this.lifecycle(profileId);
    if (lifecycle.lifecycle === 'deleted') {
      throw new ProfileContinuityStoreError('PROFILE_DELETED');
    }
    if (lifecycle.lifecycle !== 'active') {
      throw new ProfileContinuityStoreError('PROFILE_MOVED');
    }
  }

  pull(profileId: string, raw: unknown): ContinuityPage {
    validateProfileId(profileId);
    let request: ContinuityPullRequest;
    try {
      request = parseContinuityPullRequest(raw);
    } catch (error) {
      if (error instanceof ProfileContinuityValidationError) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      throw error;
    }
    const document = this.readDocument(profileId) ?? defaultDocument(profileId);
    this.assertPullAllowed(document);
    if (request.fromRevision > document.revision) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
    }

    const eligible = document.records
      .filter((record) => record.revision > request.fromRevision)
      .sort((left, right) => left.revision - right.revision);
    const records: ContinuityCookieRecord[] = [];
    for (const record of eligible) {
      const candidate = this.pageOf(
        profileId,
        document,
        request,
        [...records, record],
        false,
      );
      if (serializedContinuityItemBytes(candidate) > request.pageBytes) break;
      records.push(record);
    }
    if (eligible.length > 0 && records.length === 0) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    return this.pageOf(
      profileId,
      document,
      request,
      records,
      records.length < eligible.length,
    );
  }

  push(profileId: string, raw: unknown): ContinuityOperationResult {
    validateProfileId(profileId);
    if (isRecord(raw) && 'change' in raw) {
      try {
        if (
          serializedContinuityItemBytes(raw.change) >
          PROFILE_CONTINUITY_ITEM_MAX_BYTES
        ) {
          throw new ProfileContinuityStoreError(
            'PROFILE_CONTINUITY_ITEM_TOO_LARGE',
          );
        }
      } catch (error) {
        if (error instanceof ProfileContinuityStoreError) throw error;
        if (error instanceof ProfileContinuityValidationError) {
          throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
        }
        throw error;
      }
    }
    let operation: ContinuityOperation;
    try {
      operation = parseContinuityOperation(raw);
    } catch (error) {
      if (error instanceof ProfileContinuityValidationError) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      throw error;
    }
    if (
      operation.change.kind === 'upsert' &&
      operation.change.expirationDate <= this.now() / 1_000
    ) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    return this.withProfileLock(profileId, () => {
      const document =
        this.readDocument(profileId) ?? defaultDocument(profileId);
      this.assertDocumentActive(document);
      if (operation.profileEpoch !== document.epoch) {
        throw new ProfileContinuityStoreError(
          'PROFILE_CONTINUITY_STALE_EPOCH',
        );
      }
      const duplicate = document.operations.find(
        (candidate) =>
          candidate.deviceId === operation.deviceId &&
          candidate.operationId === operation.operationId,
      );
      if (duplicate) {
        return { ...duplicate.result, outcome: 'duplicate' };
      }

      const identityKey = continuityCookieIdentityKey(
        operation.change.identity,
      );
      const recordIndex = document.records.findIndex(
        (candidate) =>
          continuityCookieIdentityKey(candidate.identity) === identityKey,
      );
      const previous =
        recordIndex >= 0 ? document.records[recordIndex] : undefined;
      if (
        operation.baseRevision > document.revision ||
        (!previous && operation.baseRevision !== 0)
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }

      let result: ContinuityOperationResult;
      if (
        previous?.kind === 'tombstone' &&
        operation.change.kind === 'upsert' &&
        operation.baseRevision < previous.revision
      ) {
        result = {
          operationId: operation.operationId,
          revision: previous.revision,
          outcome: 'stale_rejected',
          current: previous,
        };
      } else {
        if (document.revision >= Number.MAX_SAFE_INTEGER) {
          throw new ProfileContinuityStoreError('PROFILE_RPC_IO_FAILED');
        }
        const revision = document.revision + 1;
        const current = {
          ...operation.change,
          revision,
        } as ContinuityCookieRecord;
        if (
          serializedContinuityItemBytes(current) >
          PROFILE_CONTINUITY_ITEM_MAX_BYTES
        ) {
          throw new ProfileContinuityStoreError(
            'PROFILE_CONTINUITY_ITEM_TOO_LARGE',
          );
        }
        result = {
          operationId: operation.operationId,
          revision,
          outcome:
            operation.baseRevision === (previous?.revision ?? 0)
              ? 'accepted'
              : 'conflict_won',
          current,
        };
        document.revision = revision;
        if (recordIndex >= 0) document.records[recordIndex] = current;
        else document.records.push(current);
      }
      document.operations.push({
        deviceId: operation.deviceId,
        operationId: operation.operationId,
        result,
      });
      this.writeDocument(document);
      return result;
    });
  }

  stageMigration(profileId: string, raw: unknown): ContinuityMigrationStageResult {
    validateProfileId(profileId);
    const request = this.parseMigrationInput(
      raw,
      parseContinuityMigrationStageRequest,
    );
    if (request.page.profileId !== profileId) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    return this.withProfileLock(profileId, () => {
      const live = this.readDocument(profileId);
      if (live) {
        if (
          live.lifecycle !== 'moving' ||
          live.migration?.role !== 'target' ||
          live.migration.operationId !== request.operationId ||
          live.migration.state === 'activated'
        ) {
          throw new ProfileContinuityStoreError(
            live.lifecycle === 'deleted' ? 'PROFILE_DELETED' : 'PROFILE_MOVED',
          );
        }
      } else {
        const marker = defaultDocument(profileId);
        marker.epoch = request.page.epoch;
        marker.lifecycle = 'moving';
        marker.migration = {
          operationId: request.operationId,
          role: 'target',
          state: 'staged',
          sourceEpoch: request.page.epoch,
        };
        this.writeDocument(marker);
      }

      const pageDigest = this.sha256(request.page);
      let staging = this.readMigrationStaging(profileId, request.operationId);
      if (!staging) {
        if (request.page.fromRevision !== 0) {
          throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
        }
        staging = {
          version: PROFILE_CONTINUITY_VERSION,
          operationId: request.operationId,
          profileId,
          sourceEpoch: request.page.epoch,
          revision: 0,
          records: [],
          pages: [],
        };
      }
      if (staging.sourceEpoch !== request.page.epoch) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      const duplicate = staging.pages.find(
        (page) => page.fromRevision === request.page.fromRevision,
      );
      if (duplicate) {
        if (
          duplicate.nextRevision !== request.page.nextRevision ||
          duplicate.digest !== pageDigest
        ) {
          throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
        }
        return {
          operationId: request.operationId,
          confirmedRevision: staging.revision,
          stagedCount: staging.records.length,
          duplicate: true,
        };
      }
      if (request.page.fromRevision !== staging.revision) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      const records = new Map(
        staging.records.map((record) => [
          continuityCookieIdentityKey(record.identity),
          record,
        ]),
      );
      for (const record of request.page.records) {
        const key = continuityCookieIdentityKey(record.identity);
        const current = records.get(key);
        if (current && record.revision <= current.revision) {
          throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
        }
        records.set(key, record);
      }
      staging.records = [...records.values()];
      staging.revision = request.page.nextRevision;
      staging.pages.push({
        fromRevision: request.page.fromRevision,
        nextRevision: request.page.nextRevision,
        digest: pageDigest,
      });
      delete staging.verified;
      this.writeMigrationStaging(staging);
      return {
        operationId: request.operationId,
        confirmedRevision: staging.revision,
        stagedCount: staging.records.length,
        duplicate: false,
      };
    });
  }

  verifyMigration(
    profileId: string,
    raw: unknown,
  ): ContinuityMigrationVerifyResult {
    validateProfileId(profileId);
    const request = this.parseMigrationInput(
      raw,
      parseContinuityMigrationVerifyRequest,
    );
    return this.withProfileLock(profileId, () => {
      const staging = this.requireMigrationStaging(
        profileId,
        request.operationId,
      );
      const digest = this.snapshotDigest(staging, request.nonce);
      staging.verified = {
        nonce: request.nonce,
        digest,
        revision: staging.revision,
      };
      this.writeMigrationStaging(staging);
      return {
        operationId: request.operationId,
        revision: staging.revision,
        digest,
      };
    });
  }

  freezeMigration(
    profileId: string,
    raw: unknown,
  ): ContinuityMigrationFreezeResult {
    validateProfileId(profileId);
    const request = this.parseMigrationInput(
      raw,
      parseContinuityMigrationFreezeRequest,
    );
    return this.withProfileLock(profileId, () => {
      const document =
        this.readDocument(profileId) ?? defaultDocument(profileId);
      if (
        document.lifecycle === 'moving' &&
        document.migration?.role === 'source' &&
        document.migration.operationId === request.operationId &&
        document.migration.state === 'frozen' &&
        document.migration.digest &&
        document.migration.nonce
      ) {
        return this.freezeResult(document);
      }
      this.assertDocumentActive(document);
      if (document.epoch !== request.expectedEpoch) {
        throw new ProfileContinuityStoreError(
          'PROFILE_CONTINUITY_STALE_EPOCH',
        );
      }
      const digest = this.snapshotDigest(document, request.nonce);
      document.lifecycle = 'moving';
      document.migration = {
        operationId: request.operationId,
        role: 'source',
        state: 'frozen',
        sourceEpoch: document.epoch,
        nonce: request.nonce,
        digest,
      };
      this.writeDocument(document);
      return this.freezeResult(document);
    });
  }

  publishMigration(
    profileId: string,
    raw: unknown,
  ): ContinuityMigrationFreezeResult {
    validateProfileId(profileId);
    const request = this.parseMigrationInput(
      raw,
      parseContinuityMigrationPublishRequest,
    );
    return this.withProfileLock(profileId, () => {
      const live = this.readDocument(profileId);
      if (
        live?.lifecycle === 'moving' &&
        live.migration?.role === 'target' &&
        live.migration.operationId === request.operationId &&
        live.migration.state === 'published'
      ) {
        return this.freezeResult(live);
      }
      const staging = this.requireMigrationStaging(
        profileId,
        request.operationId,
      );
      if (
        staging.revision !== request.expectedRevision ||
        staging.verified?.revision !== request.expectedRevision ||
        staging.verified.digest !== request.verifiedDigest
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      const document = defaultDocument(profileId);
      document.epoch = staging.sourceEpoch;
      document.lifecycle = 'moving';
      document.revision = staging.revision;
      document.records = staging.records;
      document.migration = {
        operationId: request.operationId,
        role: 'target',
        state: 'published',
        sourceEpoch: staging.sourceEpoch,
        nonce: staging.verified.nonce,
        digest: staging.verified.digest,
      };
      this.writeDocument(document);
      return this.freezeResult(document);
    });
  }

  activateMigration(
    profileId: string,
    raw: unknown,
  ): ProfileContinuityLifecycleResult {
    validateProfileId(profileId);
    const request = this.parseMigrationInput(
      raw,
      parseContinuityMigrationActivateRequest,
    );
    return this.withProfileLock(profileId, () => {
      const document = this.readDocument(profileId);
      if (!document) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      if (
        document.lifecycle === 'active' &&
        document.migration?.role === 'target' &&
        document.migration.operationId === request.operationId &&
        document.migration.state === 'activated'
      ) {
        if (document.epoch !== request.epoch) {
          throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
        }
        deletePrivateFile(this.migrationPath(request.operationId));
        return this.lifecycleOf(document);
      }
      if (
        document.lifecycle !== 'moving' ||
        document.migration?.role !== 'target' ||
        document.migration.operationId !== request.operationId ||
        document.migration.state !== 'published' ||
        request.epoch !== document.migration.sourceEpoch + 1
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      document.epoch = request.epoch;
      document.lifecycle = 'active';
      document.migration.state = 'activated';
      this.writeDocument(document);
      deletePrivateFile(this.migrationPath(request.operationId));
      return this.lifecycleOf(document);
    });
  }

  discardContinuityMigration(
    profileId: string,
    raw: unknown,
  ): ContinuityMigrationDiscardResult {
    validateProfileId(profileId);
    const request = this.parseMigrationInput(
      raw,
      parseContinuityMigrationDiscardRequest,
    );
    return this.withProfileLock(profileId, () => {
      const document = this.readDocument(profileId);
      let role: 'source' | 'target' | undefined;
      let discarded = false;
      if (document?.migration?.operationId === request.operationId) {
        role = document.migration.role;
        if (document.migration.state === 'activated') {
          throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
        }
        if (role === 'source') {
          document.lifecycle = 'active';
          delete document.migration;
          this.writeDocument(document);
        }
        discarded = true;
      }
      if (deletePrivateFile(this.migrationPath(request.operationId))) {
        discarded = true;
        role ??= 'target';
      }
      return {
        operationId: request.operationId,
        discarded,
        ...(role ? { role } : {}),
      };
    });
  }

  finalizeTargetMigrationDiscard(
    profileId: string,
    operationId: string,
  ): void {
    validateProfileId(profileId);
    if (!UUID_RE.test(operationId)) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    this.withProfileLock(profileId, () => {
      const document = this.readDocument(profileId);
      if (
        document?.migration?.role === 'target' &&
        document.migration.operationId === operationId &&
        document.migration.state !== 'activated'
      ) {
        deletePrivateFile(this.documentPath(profileId));
      }
    });
  }

  /** Persist the epoch fence. Call finalizeRetire only after external cleanup. */
  retire(profileId: string, raw: unknown): ProfileRetireResult {
    validateProfileId(profileId);
    let request: ProfileRetireRequest;
    try {
      request = parseProfileRetireRequest(raw);
    } catch (error) {
      if (error instanceof ProfileContinuityValidationError) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      throw error;
    }
    return this.withProfileLock(profileId, () => {
      const document =
        this.readDocument(profileId) ?? defaultDocument(profileId);
      if (document.retireOperation?.operationId === request.operationId) {
        return document.retireOperation.result;
      }
      const commitsFrozenMove =
        request.kind === 'moved' &&
        document.lifecycle === 'moving' &&
        document.migration?.role === 'source' &&
        document.migration.operationId === request.operationId &&
        document.migration.state === 'frozen';
      if (!commitsFrozenMove) this.assertDocumentActive(document);
      if (request.expectedEpoch !== document.epoch) {
        throw new ProfileContinuityStoreError(
          'PROFILE_CONTINUITY_STALE_EPOCH',
        );
      }
      if (document.epoch >= Number.MAX_SAFE_INTEGER) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_IO_FAILED');
      }
      document.epoch += 1;
      document.lifecycle = request.kind === 'deleted' ? 'deleted' : 'moved';
      delete document.migration;
      if (request.kind === 'moved') document.movedTo = request.movedTo;
      else delete document.movedTo;
      const result: ProfileRetireResult = {
        operationId: request.operationId,
        profileId,
        epoch: document.epoch,
        lifecycle: document.lifecycle,
        ...(document.lifecycle === 'moved'
          ? { movedTo: document.movedTo as 'remote' | 'local' }
          : {}),
      };
      document.retireOperation = {
        operationId: request.operationId,
        result,
      };
      // This durable write is the global commit point. The Cookie ledger is
      // deliberately retained until bundle cleanup has completed.
      this.writeDocument(document);
      return result;
    });
  }

  finalizeRetire(profileId: string, operationId: string): void {
    validateProfileId(profileId);
    if (!UUID_RE.test(operationId)) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    this.withProfileLock(profileId, () => {
      const document = this.readDocument(profileId);
      if (
        !document ||
        document.retireOperation?.operationId !== operationId ||
        (document.lifecycle !== 'deleted' && document.lifecycle !== 'moved')
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      if (document.records.length > 0 || document.operations.length > 0) {
        document.records = [];
        document.operations = [];
        this.writeDocument(document);
      }
    });
  }

  private pageOf(
    profileId: string,
    document: ContinuityHostDocumentV1,
    request: ContinuityPullRequest,
    records: ContinuityCookieRecord[],
    hasMore: boolean,
  ): ContinuityPage {
    return {
      profileId,
      epoch: document.epoch,
      fromRevision: request.fromRevision,
      records,
      nextRevision:
        records.length > 0
          ? records[records.length - 1].revision
          : document.revision,
      hasMore,
    };
  }

  private lifecycleOf(
    document: ContinuityHostDocumentV1,
  ): ProfileContinuityLifecycleResult {
    return {
      profileId: document.profileId,
      epoch: document.epoch,
      lifecycle: document.lifecycle,
      ...(document.movedTo !== undefined
        ? { movedTo: document.movedTo }
        : {}),
    };
  }

  assertBundlePublishAllowed(profileId: string, operationId: string): void {
    const document = this.readDocument(profileId);
    if (
      document?.lifecycle === 'moving' &&
      document.migration?.role === 'target' &&
      document.migration.operationId === operationId &&
      document.migration.state === 'published'
    ) {
      return;
    }
    this.assertActive(profileId);
  }

  private assertPullAllowed(document: ContinuityHostDocumentV1): void {
    if (
      document.lifecycle === 'moving' &&
      document.migration?.role === 'source' &&
      document.migration.state === 'frozen'
    ) {
      return;
    }
    this.assertDocumentActive(document);
  }

  private assertDocumentActive(document: ContinuityHostDocumentV1): void {
    if (document.lifecycle === 'deleted') {
      throw new ProfileContinuityStoreError('PROFILE_DELETED');
    }
    if (document.lifecycle !== 'active') {
      throw new ProfileContinuityStoreError('PROFILE_MOVED');
    }
  }

  private parseMigrationInput<T>(
    raw: unknown,
    parser: (input: unknown) => T,
  ): T {
    try {
      return parser(raw);
    } catch (error) {
      if (error instanceof ProfileContinuityValidationError) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      throw error;
    }
  }

  private freezeResult(
    document: ContinuityHostDocumentV1,
  ): ContinuityMigrationFreezeResult {
    if (!document.migration?.digest) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    return {
      operationId: document.migration.operationId,
      profileId: document.profileId,
      epoch: document.epoch,
      lifecycle: document.lifecycle,
      revision: document.revision,
      digest: document.migration.digest,
    };
  }

  private snapshotDigest(
    document: Pick<
      ContinuityHostDocumentV1,
      'profileId' | 'epoch' | 'revision' | 'records'
    > | ContinuityMigrationStagingV1,
    nonce: string,
  ): string {
    const nonceBytes = decodeBase64Url(nonce);
    if (!nonceBytes || nonceBytes.length < 16 || nonceBytes.length > 64) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const epoch =
      'sourceEpoch' in document ? document.sourceEpoch : document.epoch;
    const records = [...document.records].sort((left, right) =>
      continuityCookieIdentityKey(left.identity).localeCompare(
        continuityCookieIdentityKey(right.identity),
      ),
    );
    return createHmac('sha256', nonceBytes)
      .update(
        this.canonicalJson({
          version: PROFILE_CONTINUITY_VERSION,
          profileId: document.profileId,
          epoch,
          revision: document.revision,
          records,
        }),
        'utf8',
      )
      .digest('base64url');
  }

  private sha256(value: unknown): string {
    return createHash('sha256')
      .update(this.canonicalJson(value), 'utf8')
      .digest('base64url');
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      return serialized;
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${this.canonicalJson(record[key])}`,
      )
      .join(',')}}`;
  }

  private documentPath(profileId: string): string {
    return path.join(this.continuityDirectory, `${profileId}.json`);
  }

  private migrationPath(operationId: string): string {
    return path.join(this.migrationDirectory, `${operationId}.json`);
  }

  private readDocument(profileId: string): ContinuityHostDocumentV1 | null {
    const serialized = readPrivateFile(this.documentPath(profileId));
    if (!serialized) return null;
    return this.parseDocument(
      profileId,
      this.decrypt(profileId, serialized.toString('utf8')),
    );
  }

  private readMigrationStaging(
    profileId: string,
    operationId: string,
  ): ContinuityMigrationStagingV1 | null {
    const serialized = readPrivateFile(this.migrationPath(operationId));
    if (!serialized) return null;
    return this.parseMigrationStaging(
      profileId,
      operationId,
      this.decrypt(
        profileId,
        serialized.toString('utf8'),
        `continuity-migration|${operationId}`,
      ),
    );
  }

  private requireMigrationStaging(
    profileId: string,
    operationId: string,
  ): ContinuityMigrationStagingV1 {
    const staging = this.readMigrationStaging(profileId, operationId);
    if (!staging) throw new ProfileContinuityStoreError('PROFILE_RPC_NOT_FOUND');
    return staging;
  }

  private writeMigrationStaging(staging: ContinuityMigrationStagingV1): void {
    const parsed = this.parseMigrationStaging(
      staging.profileId,
      staging.operationId,
      staging,
    );
    atomicWritePrivateFile(
      this.migrationPath(staging.operationId),
      this.encrypt(
        staging.profileId,
        parsed,
        `continuity-migration|${staging.operationId}`,
      ),
    );
  }

  private parseMigrationStaging(
    profileId: string,
    operationId: string,
    input: unknown,
  ): ContinuityMigrationStagingV1 {
    if (
      !isRecord(input) ||
      !hasExactKeys(
        input,
        [
          'version',
          'operationId',
          'profileId',
          'sourceEpoch',
          'revision',
          'records',
          'pages',
        ],
        ['verified'],
      ) ||
      input.version !== PROFILE_CONTINUITY_VERSION ||
      input.operationId !== operationId ||
      input.profileId !== profileId ||
      !isSafeRevision(input.sourceEpoch) ||
      !isSafeRevision(input.revision) ||
      !Array.isArray(input.records) ||
      !Array.isArray(input.pages)
    ) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    const records = input.records.map((record) => {
      try {
        return parseContinuityCookieRecord(record);
      } catch {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
    });
    const identities = new Set<string>();
    for (const record of records) {
      const identity = continuityCookieIdentityKey(record.identity);
      if (
        identities.has(identity) ||
        record.revision > input.revision ||
        record.revision === 0
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      identities.add(identity);
    }
    const pages: StagedMigrationPage[] = [];
    let cursor = 0;
    for (const page of input.pages) {
      if (
        !isRecord(page) ||
        !hasExactKeys(page, ['fromRevision', 'nextRevision', 'digest']) ||
        page.fromRevision !== cursor ||
        !isSafeRevision(page.nextRevision) ||
        page.nextRevision < page.fromRevision ||
        typeof page.digest !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(page.digest)
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      pages.push({
        fromRevision: page.fromRevision,
        nextRevision: page.nextRevision,
        digest: page.digest,
      });
      cursor = page.nextRevision;
    }
    if (cursor !== input.revision) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    let verified: ContinuityMigrationStagingV1['verified'];
    if (input.verified !== undefined) {
      if (
        !isRecord(input.verified) ||
        !hasExactKeys(input.verified, ['nonce', 'digest', 'revision']) ||
        typeof input.verified.nonce !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(input.verified.nonce) ||
        typeof input.verified.digest !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(input.verified.digest) ||
        input.verified.revision !== input.revision
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      verified = {
        nonce: input.verified.nonce,
        digest: input.verified.digest,
        revision: input.verified.revision,
      };
    }
    return {
      version: PROFILE_CONTINUITY_VERSION,
      operationId,
      profileId,
      sourceEpoch: input.sourceEpoch,
      revision: input.revision,
      records,
      pages,
      ...(verified ? { verified } : {}),
    };
  }

  private parseDocument(
    profileId: string,
    input: unknown,
  ): ContinuityHostDocumentV1 {
    if (
      !isRecord(input) ||
      !hasExactKeys(
        input,
        [
          'version',
          'profileId',
          'epoch',
          'lifecycle',
          'revision',
          'records',
          'operations',
        ],
        ['movedTo', 'retireOperation', 'migration'],
      ) ||
      input.version !== PROFILE_CONTINUITY_VERSION ||
      input.profileId !== profileId ||
      !isSafeRevision(input.epoch) ||
      !isSafeRevision(input.revision) ||
      (input.lifecycle !== 'active' &&
        input.lifecycle !== 'moving' &&
        input.lifecycle !== 'moved' &&
        input.lifecycle !== 'deleted') ||
      !Array.isArray(input.records) ||
      !Array.isArray(input.operations) ||
      (input.lifecycle === 'moved' &&
        input.movedTo !== 'remote' &&
        input.movedTo !== 'local') ||
      (input.lifecycle !== 'moved' && input.movedTo !== undefined)
    ) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    const records: ContinuityCookieRecord[] = [];
    const identities = new Set<string>();
    for (const rawRecord of input.records) {
      let record: ContinuityCookieRecord;
      try {
        record = parseContinuityCookieRecord(rawRecord);
      } catch (error) {
        if (error instanceof ProfileContinuityValidationError) {
          throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
        }
        throw error;
      }
      const identity = continuityCookieIdentityKey(record.identity);
      if (
        record.revision === 0 ||
        record.revision > input.revision ||
        identities.has(identity)
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      identities.add(identity);
      records.push(record);
    }
    const operations: StoredOperationResult[] = [];
    const operationKeys = new Set<string>();
    for (const rawOperation of input.operations) {
      if (
        !isRecord(rawOperation) ||
        !hasExactKeys(rawOperation, ['deviceId', 'operationId', 'result']) ||
        typeof rawOperation.deviceId !== 'string' ||
        !DEVICE_ID_RE.test(rawOperation.deviceId) ||
        typeof rawOperation.operationId !== 'string' ||
        !UUID_RE.test(rawOperation.operationId)
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      const result = parseResult(rawOperation.result);
      const key = `${rawOperation.deviceId}\0${rawOperation.operationId}`;
      if (
        result.operationId !== rawOperation.operationId ||
        result.revision > input.revision ||
        operationKeys.has(key)
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      operationKeys.add(key);
      operations.push({
        deviceId: rawOperation.deviceId,
        operationId: rawOperation.operationId,
        result,
      });
    }
    let migration: ContinuityMigrationMarker | undefined;
    if (input.migration !== undefined) {
      if (
        !isRecord(input.migration) ||
        !hasExactKeys(
          input.migration,
          ['operationId', 'role', 'state', 'sourceEpoch'],
          ['nonce', 'digest'],
        ) ||
        typeof input.migration.operationId !== 'string' ||
        !UUID_RE.test(input.migration.operationId) ||
        (input.migration.role !== 'source' &&
          input.migration.role !== 'target') ||
        (input.migration.state !== 'frozen' &&
          input.migration.state !== 'staged' &&
          input.migration.state !== 'published' &&
          input.migration.state !== 'activated') ||
        !isSafeRevision(input.migration.sourceEpoch) ||
        (input.migration.nonce !== undefined &&
          (typeof input.migration.nonce !== 'string' ||
            !/^[A-Za-z0-9_-]+$/.test(input.migration.nonce))) ||
        (input.migration.digest !== undefined &&
          (typeof input.migration.digest !== 'string' ||
            !/^[A-Za-z0-9_-]{43}$/.test(input.migration.digest)))
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      const hasProof =
        typeof input.migration.nonce === 'string' &&
        typeof input.migration.digest === 'string';
      if (
        (input.migration.role === 'source' &&
          input.migration.state !== 'frozen') ||
        (input.migration.role === 'target' &&
          input.migration.state === 'frozen') ||
        ((input.migration.state === 'frozen' ||
          input.migration.state === 'published' ||
          input.migration.state === 'activated') &&
          !hasProof) ||
        (input.migration.state === 'staged' && hasProof) ||
        (input.migration.state === 'activated'
          ? input.lifecycle !== 'active'
          : input.lifecycle !== 'moving')
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      migration = {
        operationId: input.migration.operationId,
        role: input.migration.role,
        state: input.migration.state,
        sourceEpoch: input.migration.sourceEpoch,
        ...(typeof input.migration.nonce === 'string'
          ? { nonce: input.migration.nonce }
          : {}),
        ...(typeof input.migration.digest === 'string'
          ? { digest: input.migration.digest }
          : {}),
      };
    }
    let retireOperation: StoredRetireOperation | undefined;
    if (input.retireOperation !== undefined) {
      if (
        !isRecord(input.retireOperation) ||
        !hasExactKeys(input.retireOperation, ['operationId', 'result']) ||
        typeof input.retireOperation.operationId !== 'string' ||
        !UUID_RE.test(input.retireOperation.operationId)
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      const result = parseLifecycleResult(
        input.retireOperation.result,
        profileId,
      );
      if (
        result.operationId !== input.retireOperation.operationId ||
        result.epoch !== input.epoch ||
        result.lifecycle !== input.lifecycle ||
        result.movedTo !== input.movedTo
      ) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      retireOperation = {
        operationId: input.retireOperation.operationId,
        result,
      };
    }
    if (
      (input.lifecycle === 'active' && retireOperation !== undefined) ||
      ((input.lifecycle === 'moved' || input.lifecycle === 'deleted') &&
        retireOperation === undefined) ||
      (input.lifecycle === 'moving' && migration === undefined) ||
      ((input.lifecycle === 'moved' || input.lifecycle === 'deleted') &&
        migration !== undefined)
    ) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    return {
      version: PROFILE_CONTINUITY_VERSION,
      profileId,
      epoch: input.epoch,
      lifecycle: input.lifecycle,
      ...(input.movedTo !== undefined
        ? { movedTo: input.movedTo as 'remote' | 'local' }
        : {}),
      revision: input.revision,
      records,
      operations,
      ...(retireOperation ? { retireOperation } : {}),
      ...(migration ? { migration } : {}),
    };
  }

  private writeDocument(document: ContinuityHostDocumentV1): void {
    // Parse the plaintext model before encryption so malformed state is never
    // committed even when constructed by a future caller.
    const parsed = this.parseDocument(document.profileId, document);
    atomicWritePrivateFile(
      this.documentPath(document.profileId),
      this.encrypt(document.profileId, parsed),
    );
  }

  private encrypt(
    profileId: string,
    document: unknown,
    scope = 'continuity',
  ): string {
    const key = this.loadKey();
    const nonce = randomBytes(NONCE_BYTES);
    try {
      const cipher = createCipheriv(ALGORITHM, key, nonce);
      cipher.setAAD(this.aad(profileId, scope));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(document), 'utf8'),
        cipher.final(),
      ]);
      const envelope: EncryptedContinuityEnvelopeV1 = {
        version: ENVELOPE_VERSION,
        algorithm: ALGORITHM,
        keyId: createHash('sha256').update(key).digest('base64url'),
        nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
      };
      return JSON.stringify(envelope);
    } catch (error) {
      if (error instanceof ProfileContinuityStoreError) throw error;
      throw new ProfileContinuityStoreError(
        'PROFILE_RPC_ENCRYPTION_UNAVAILABLE',
      );
    } finally {
      key.fill(0);
    }
  }

  private decrypt(
    profileId: string,
    serialized: string,
    scope = 'continuity',
  ): unknown {
    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, [
        'version',
        'algorithm',
        'keyId',
        'nonce',
        'ciphertext',
        'tag',
      ]) ||
      raw.version !== ENVELOPE_VERSION ||
      raw.algorithm !== ALGORITHM
    ) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    const expectedKeyId = decodeBase64Url(raw.keyId, 32);
    const nonce = decodeBase64Url(raw.nonce, NONCE_BYTES);
    const ciphertext = decodeBase64Url(raw.ciphertext);
    const tag = decodeBase64Url(raw.tag, TAG_BYTES);
    if (!expectedKeyId || !nonce || !ciphertext || !tag) {
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    }
    const key = this.loadKey();
    try {
      const actualKeyId = createHash('sha256').update(key).digest();
      if (!actualKeyId.equals(expectedKeyId)) {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
      const decipher = createDecipheriv(ALGORITHM, key, nonce);
      decipher.setAAD(this.aad(profileId, scope));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
      try {
        return JSON.parse(plaintext) as unknown;
      } catch {
        throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
      }
    } catch (error) {
      if (error instanceof ProfileContinuityStoreError) throw error;
      throw new ProfileContinuityStoreError('PROFILE_RPC_CORRUPT');
    } finally {
      key.fill(0);
    }
  }

  private loadKey(): Buffer {
    const key = readPrivateFile(this.keyPath);
    if (!key || key.length !== 32) {
      throw new ProfileContinuityStoreError(
        'PROFILE_RPC_ENCRYPTION_UNAVAILABLE',
      );
    }
    return Buffer.from(key);
  }

  private aad(profileId: string, scope: string): Buffer {
    return Buffer.from(
      `okwork-profile-store|v1|${profileId}|${scope}`,
      'utf8',
    );
  }

  private withProfileLock<T>(profileId: string, work: () => T): T {
    const release = this.acquireLock(profileId);
    try {
      return work();
    } finally {
      release();
    }
  }

  private acquireLock(profileId: string): () => void {
    ensurePrivateDirectory(this.locksDirectory);
    const lock = path.join(this.locksDirectory, `${profileId}.lock`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const candidate = path.join(
        this.locksDirectory,
        `.${profileId}.candidate-${process.pid}-${randomUUID()}`,
      );
      try {
        fs.mkdirSync(candidate, { mode: REMOTE_PROFILE_DIRECTORY_MODE });
        fs.chmodSync(candidate, REMOTE_PROFILE_DIRECTORY_MODE);
        atomicWritePrivateFile(
          path.join(candidate, 'owner.json'),
          JSON.stringify({ pid: process.pid }),
        );
        fs.renameSync(candidate, lock);
        return () => this.releaseLock(lock);
      } catch (error) {
        this.removeCandidate(candidate);
        if (!isNodeErrorCode(error, 'EEXIST') &&
            !isNodeErrorCode(error, 'ENOTEMPTY')) {
          throw new ProfileContinuityStoreError('PROFILE_RPC_IO_FAILED');
        }
        if (attempt === 0 && this.recoverStaleLock(lock)) continue;
        throw new ProfileContinuityStoreError('PROFILE_CONTINUITY_BUSY');
      }
    }
    throw new ProfileContinuityStoreError('PROFILE_CONTINUITY_BUSY');
  }

  private recoverStaleLock(lock: string): boolean {
    let owner: unknown;
    try {
      const serialized = readPrivateFile(path.join(lock, 'owner.json'));
      if (!serialized) return false;
      owner = JSON.parse(serialized.toString('utf8')) as unknown;
    } catch {
      return false;
    }
    if (
      !isRecord(owner) ||
      !hasExactKeys(owner, ['pid']) ||
      !Number.isSafeInteger(owner.pid) ||
      (owner.pid as number) <= 0
    ) {
      return false;
    }
    try {
      process.kill(owner.pid as number, 0);
      return false;
    } catch (error) {
      if (!isNodeErrorCode(error, 'ESRCH')) return false;
    }
    try {
      fs.unlinkSync(path.join(lock, 'owner.json'));
      fs.rmdirSync(lock);
      return true;
    } catch {
      return false;
    }
  }

  private releaseLock(lock: string): void {
    try {
      fs.unlinkSync(path.join(lock, 'owner.json'));
      fs.rmdirSync(lock);
    } catch {
      // The mutation may already be durable; the fixed error makes the caller
      // retry with the same operationId instead of silently reporting success.
      throw new ProfileContinuityStoreError('PROFILE_RPC_IO_FAILED');
    }
  }

  private removeCandidate(candidate: string): void {
    try {
      fs.unlinkSync(path.join(candidate, 'owner.json'));
    } catch {
      // Candidate cleanup is best-effort and never removes the fixed lock.
    }
    try {
      fs.rmdirSync(candidate);
    } catch {
      // Candidate names do not block the profile-scoped lock.
    }
  }
}
