import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type {
  ProfileStorageErrorCode,
  ProfileStorageRef,
} from '../shared/browserProfile';
import type { ProfileBundleV1 } from '../shared/remoteProfileStore';
import {
  ProfileCatalogStore,
  profileStorageRefEquals,
  type ProfileMigrationRecordV1,
} from './profileCatalogStore';
import type {
  ProfileDataProvider,
  ProfileProviderResolver,
} from './profileAuthorityService';

export class ProfileMigrationError extends Error {
  constructor(readonly code: ProfileStorageErrorCode) {
    super(code);
    this.name = 'ProfileMigrationError';
  }
}

class LateMigrationResponseError extends Error {
  constructor() {
    super('PROFILE_MIGRATION_LATE_RESPONSE');
    this.name = 'LateMigrationResponseError';
  }
}

export interface ProfileMigrationCoordinatorDeps {
  catalog: ProfileCatalogStore;
  resolveProvider: ProfileProviderResolver;
  /** Notify renderers after every durable migration transition. */
  onChanged?: () => void;
  now?: () => number;
  newOperationId?: () => string;
  randomNonce?: () => Buffer;
  logger?: { warn(message: string): void; error(message: string): void };
}

const STORAGE_CODES = new Set<ProfileStorageErrorCode>([
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

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested !== undefined) output[key] = stableValue(nested);
    }
    return output;
  }
  return value;
}

/** Must stay byte-for-byte equivalent to host/remoteProfileStore canonical JSON. */
export function canonicalProfileBundleJson(bundle: ProfileBundleV1): string {
  return JSON.stringify(stableValue(bundle));
}

export function profileBundleVerificationDigest(
  bundle: ProfileBundleV1,
  nonce: Buffer,
): Buffer {
  return createHmac('sha256', nonce)
    .update(canonicalProfileBundleJson(bundle), 'utf8')
    .digest();
}

function fixedStorageCode(error: unknown): ProfileStorageErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  if (STORAGE_CODES.has(code as ProfileStorageErrorCode)) {
    return code as ProfileStorageErrorCode;
  }
  return 'PROFILE_STORAGE_IO_FAILED';
}

/** Durable copy → verify → publish → catalog switch → source cleanup coordinator. */
export class ProfileMigrationCoordinator {
  private readonly now: () => number;
  private readonly newOperationId: () => string;
  private readonly randomNonce: () => Buffer;
  private readonly logger: NonNullable<
    ProfileMigrationCoordinatorDeps['logger']
  >;
  private readonly running = new Map<
    string,
    Promise<ProfileMigrationRecordV1 | null>
  >();

  constructor(private readonly deps: ProfileMigrationCoordinatorDeps) {
    this.now = deps.now ?? Date.now;
    this.newOperationId = deps.newOperationId ?? randomUUID;
    this.randomNonce = deps.randomNonce ?? (() => randomBytes(32));
    this.logger = deps.logger ?? console;
  }

  begin(
    profileId: string,
    target: ProfileStorageRef,
  ): ProfileMigrationRecordV1 {
    const entry = this.deps.catalog.getEntry(profileId);
    if (
      !entry ||
      entry.lifecycle !== 'active' ||
      profileStorageRefEquals(entry.storage, target)
    ) {
      throw new ProfileMigrationError('PROFILE_STORAGE_INVALID_INPUT');
    }
    if (this.deps.catalog.getMigration(profileId)) {
      throw new ProfileMigrationError('PROFILE_MIGRATION_IN_PROGRESS');
    }
    const source = this.provider(entry.storage);
    const destination = this.provider(target);
    if (
      source.availability() !== 'ready' ||
      destination.availability() !== 'ready'
    ) {
      throw new ProfileMigrationError('PROFILE_STORAGE_TARGET_UNAVAILABLE');
    }
    const record: ProfileMigrationRecordV1 = {
      operationId: this.newOperationId(),
      profileId,
      source: entry.storage,
      target,
      phase: 'copying',
      committed: false,
      ...(entry.storage.kind === 'remote'
        ? { sourceGeneration: this.requireGeneration(source) }
        : {}),
      ...(target.kind === 'remote'
        ? { targetGeneration: this.requireGeneration(destination) }
        : {}),
      updatedAt: this.now(),
    };
    const started = this.deps.catalog.beginMigration(record);
    this.changed();
    return started;
  }

  async migrate(
    profileId: string,
    target: ProfileStorageRef,
  ): Promise<ProfileMigrationRecordV1 | null> {
    const record = this.begin(profileId, target);
    return this.run(record.operationId);
  }

  run(operationId: string): Promise<ProfileMigrationRecordV1 | null> {
    const existing = this.running.get(operationId);
    if (existing) return existing;
    const task = this.execute(operationId).finally(() =>
      this.running.delete(operationId),
    );
    this.running.set(operationId, task);
    return task;
  }

  async retry(operationId: string): Promise<ProfileMigrationRecordV1 | null> {
    const record = this.deps.catalog.getMigration(operationId);
    if (!record) return null;
    if (record.committed) return this.run(operationId);
    const source = this.provider(record.source);
    const target = this.provider(record.target);
    if (
      source.availability() !== 'ready' ||
      target.availability() !== 'ready'
    ) {
      throw new ProfileMigrationError('PROFILE_STORAGE_TARGET_UNAVAILABLE');
    }
    this.deps.catalog.updateMigration(operationId, {
      phase: 'copying',
      ...(record.source.kind === 'remote'
        ? { sourceGeneration: this.requireGeneration(source) }
        : {}),
      ...(record.target.kind === 'remote'
        ? { targetGeneration: this.requireGeneration(target) }
        : {}),
      errorCode: undefined,
      updatedAt: this.now(),
    });
    this.changed();
    return this.run(operationId);
  }

  async resumeAll(): Promise<ProfileMigrationRecordV1[]> {
    const results: ProfileMigrationRecordV1[] = [];
    for (const record of this.deps.catalog.listMigrations()) {
      try {
        const next = record.committed
          ? await this.run(record.operationId)
          : await this.retry(record.operationId);
        if (next) results.push(next);
      } catch (error) {
        this.log(record, fixedStorageCode(error), 'resume');
        const current = this.deps.catalog.getMigration(record.operationId);
        if (current) results.push(current);
      }
    }
    return results;
  }

  private async execute(
    operationId: string,
  ): Promise<ProfileMigrationRecordV1 | null> {
    const initial = this.deps.catalog.getMigration(operationId);
    if (!initial) return null;
    if (initial.committed) return this.cleanup(initial);

    const source = this.provider(initial.source);
    const target = this.provider(initial.target);
    try {
      const bundle = await source.readBundle(initial.profileId);
      this.assertCurrent(initial, source, target);

      await target.stage(initial.operationId, bundle);
      this.assertCurrent(initial, source, target);

      this.deps.catalog.updateMigration(initial.operationId, {
        phase: 'verifying',
        errorCode: undefined,
        updatedAt: this.now(),
      });
      this.changed();
      const nonce = this.randomNonce();
      if (!Buffer.isBuffer(nonce) || nonce.length < 16) {
        throw new ProfileMigrationError('PROFILE_STORAGE_IO_FAILED');
      }
      const expected = profileBundleVerificationDigest(bundle, nonce);
      const actual = await target.verify(initial.operationId, nonce);
      this.assertCurrent(initial, source, target);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        throw new ProfileMigrationError('PROFILE_STORAGE_CORRUPT');
      }

      this.deps.catalog.updateMigration(initial.operationId, {
        phase: 'switching',
        errorCode: undefined,
        updatedAt: this.now(),
      });
      this.changed();
      await target.publish(initial.operationId, initial.profileId);
      this.assertCurrent(initial, source, target);

      const committed = this.deps.catalog.commitMigration(
        initial.operationId,
        this.now(),
      );
      this.changed();
      return this.cleanup(committed);
    } catch (error) {
      if (error instanceof LateMigrationResponseError) {
        this.log(initial, 'PROFILE_STORAGE_OFFLINE', 'late-response-ignored');
        return this.deps.catalog.getMigration(operationId);
      }
      const code = fixedStorageCode(error);
      const current = this.deps.catalog.getMigration(operationId);
      if (!current) return null;
      if (current.committed) {
        this.deps.catalog.updateMigration(operationId, {
          phase: 'cleanup_pending',
          errorCode: code,
          updatedAt: this.now(),
        });
      } else {
        this.deps.catalog.updateMigration(operationId, {
          phase: 'failed',
          errorCode: code,
          updatedAt: this.now(),
        });
      }
      this.changed();
      this.log(current, code, current.committed ? 'cleanup' : current.phase);
      return this.deps.catalog.getMigration(operationId);
    }
  }

  private async cleanup(
    record: ProfileMigrationRecordV1,
  ): Promise<ProfileMigrationRecordV1 | null> {
    if (!record.committed)
      throw new ProfileMigrationError('PROFILE_STORAGE_INVALID_INPUT');
    try {
      await this.provider(record.source).deleteProfile(record.profileId);
      this.deps.catalog.completeMigration(record.operationId);
      this.changed();
      return null;
    } catch (error) {
      const code = fixedStorageCode(error);
      this.deps.catalog.updateMigration(record.operationId, {
        phase: 'cleanup_pending',
        errorCode: code,
        updatedAt: this.now(),
      });
      this.changed();
      this.log(record, code, 'cleanup');
      return this.deps.catalog.getMigration(record.operationId);
    }
  }

  private assertCurrent(
    expected: ProfileMigrationRecordV1,
    source: ProfileDataProvider,
    target: ProfileDataProvider,
  ): void {
    const current = this.deps.catalog.getMigration(expected.operationId);
    if (
      !current ||
      current.profileId !== expected.profileId ||
      current.committed
    ) {
      throw new LateMigrationResponseError();
    }
    if (
      expected.source.kind === 'remote' &&
      source.currentGeneration() !== expected.sourceGeneration
    ) {
      throw new LateMigrationResponseError();
    }
    if (
      expected.target.kind === 'remote' &&
      target.currentGeneration() !== expected.targetGeneration
    ) {
      throw new LateMigrationResponseError();
    }
  }

  private provider(storage: ProfileStorageRef): ProfileDataProvider {
    try {
      return this.deps.resolveProvider(storage);
    } catch {
      throw new ProfileMigrationError('PROFILE_STORAGE_OFFLINE');
    }
  }

  private requireGeneration(provider: ProfileDataProvider): string {
    const generation = provider.currentGeneration();
    if (!generation)
      throw new ProfileMigrationError('PROFILE_STORAGE_TARGET_UNAVAILABLE');
    return generation;
  }

  private changed(): void {
    try {
      this.deps.onChanged?.();
    } catch {
      // A renderer notification must never change the durable migration outcome.
      this.logger.warn(
        '[profile-migration] phase=notify code=PROFILE_STORAGE_IO_FAILED',
      );
    }
  }

  private log(
    record: ProfileMigrationRecordV1,
    code: ProfileStorageErrorCode,
    phase: string,
  ): void {
    this.logger.warn(
      `[profile-migration] operationId=${record.operationId} profileId=${record.profileId} phase=${phase} code=${code}`,
    );
  }
}
