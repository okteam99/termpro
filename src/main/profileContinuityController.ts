import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  continuityCookieIdentityKey,
  normalizeContinuityCookieIdentity,
  parseContinuityCookieChange,
  serializedContinuityItemBytes,
  PROFILE_CONTINUITY_ITEM_MAX_BYTES,
  type ContinuityCookieChange,
  type ContinuityCookieIdentity,
  type ContinuityCookieRecord,
  type ContinuityCookieSameSite,
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
} from '../shared/profileContinuity';
import {
  browserPartition,
  type BrowserContinuityPrepareResult,
  type LoginContinuityReasonCode,
  type LoginContinuitySummary,
  type ProfileMigrationPhase,
  type ProfileStorageRef,
} from '../shared/browserProfile';
import {
  ProfileContinuityJournal,
  ProfileContinuityJournalError,
  type ProfileContinuityJournalV1,
} from './profileContinuityJournal';
import type { ProfileMigrationRecordV1 } from './profileCatalogStore';
import type { ProfileContinuityMigrationPort } from './profileMigrationCoordinator';

export interface ContinuityElectronCookie {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: ContinuityCookieSameSite;
}

export type ContinuityCookieChangedCause =
  | 'explicit'
  | 'overwrite'
  | 'expired'
  | 'evicted'
  | 'expired-overwrite';

export interface ContinuityCookieStorePort {
  get(filter: Record<string, unknown>): Promise<ContinuityElectronCookie[]>;
  set(details: Record<string, unknown>): Promise<void>;
  remove(url: string, name: string): Promise<void>;
  on(
    event: 'changed',
    listener: (
      event: unknown,
      cookie: ContinuityElectronCookie,
      cause: ContinuityCookieChangedCause,
      removed: boolean,
    ) => void,
  ): void;
  removeListener(
    event: 'changed',
    listener: (
      event: unknown,
      cookie: ContinuityElectronCookie,
      cause: ContinuityCookieChangedCause,
      removed: boolean,
    ) => void,
  ): void;
}

export interface ProfileContinuityRemotePort {
  currentGeneration(): string | null;
  describeContinuity(): Promise<unknown>;
  getContinuityLifecycle(
    profileId: string,
  ): Promise<ProfileContinuityLifecycleResult>;
  pullContinuity(
    profileId: string,
    request: { fromRevision: number; pageBytes: number },
  ): Promise<ContinuityPage>;
  pushContinuity(
    profileId: string,
    operation: ContinuityOperation,
  ): Promise<ContinuityOperationResult>;
  stageContinuityMigration?(
    profileId: string,
    request: ContinuityMigrationStageRequest,
  ): Promise<ContinuityMigrationStageResult>;
  verifyContinuityMigration?(
    profileId: string,
    request: ContinuityMigrationVerifyRequest,
  ): Promise<ContinuityMigrationVerifyResult>;
  freezeContinuityMigration?(
    profileId: string,
    request: ContinuityMigrationFreezeRequest,
  ): Promise<ContinuityMigrationFreezeResult>;
  publishContinuityMigration?(
    profileId: string,
    request: ContinuityMigrationPublishRequest,
  ): Promise<ContinuityMigrationFreezeResult>;
  activateContinuityMigration?(
    profileId: string,
    request: ContinuityMigrationActivateRequest,
  ): Promise<ProfileContinuityLifecycleResult>;
  discardContinuityMigration?(
    profileId: string,
    operationId: string,
  ): Promise<unknown>;
}

type ProfileContinuityMigrationRemotePort = ProfileContinuityRemotePort &
  Required<
    Pick<
      ProfileContinuityRemotePort,
      | 'stageContinuityMigration'
      | 'verifyContinuityMigration'
      | 'freezeContinuityMigration'
      | 'publishContinuityMigration'
      | 'activateContinuityMigration'
      | 'discardContinuityMigration'
    >
  >;

export interface ProfileContinuityCatalogEntry {
  profileId: string;
  storage: ProfileStorageRef;
  lifecycle: 'active' | 'deleting' | 'delete_failed';
}

export interface ProfileContinuityControllerDeps {
  clientId: string;
  getCatalogEntry(profileId: string): ProfileContinuityCatalogEntry | null;
  getMigrationPhase?(profileId: string): ProfileMigrationPhase | null;
  remoteProvider(hostId: string): ProfileContinuityRemotePort;
  partitionsOfProfile(profileId: string): string[];
  isKnownPartition(partition: string): boolean;
  cookiesForPartition(partition: string): ContinuityCookieStorePort;
  journal: ProfileContinuityJournal<
    ContinuityCookieIdentity,
    ContinuityCookieChange
  >;
  onSummaryChanged?: () => void;
  onRetired?: (
    profileId: string,
    lifecycle: ProfileContinuityLifecycleResult,
    cleanupPartitions: string[],
  ) => void | Promise<void>;
  logger?: { warn(message: string): void; error(message: string): void };
  newOperationId?: () => string;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  newMigrationNonce?: (operationId: string) => Buffer;
}

type MutableSummary = LoginContinuitySummary;

interface LoadedProfileJournal {
  hostId: string;
  generation: string;
  document: ProfileContinuityJournalV1<
    ContinuityCookieIdentity,
    ContinuityCookieChange
  >;
}

interface SuppressedMutation {
  kind: 'upsert' | 'tombstone';
  value?: string;
  expiresAt: number;
}

const PAGE_BYTES = 512 * 1024;
const SUPPRESSION_TTL_MS = 5_000;
const OVERWRITE_PAIR_WINDOW_MS = 50;

function emptySummary(state: LoginContinuitySummary['state']): MutableSummary {
  return {
    state,
    syncedCount: 0,
    pendingCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    reasons: [],
    canRetry: false,
  };
}

function cloneSummary(summary: LoginContinuitySummary): LoginContinuitySummary {
  return { ...summary, reasons: [...summary.reasons] };
}

function reasonOf(error: unknown): LoginContinuityReasonCode {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'PROFILE_STORAGE_INCOMPATIBLE':
      return 'HOST_UPGRADE_REQUIRED';
    case 'PROFILE_STORAGE_TIMEOUT':
      return 'PROFILE_CONTINUITY_TIMEOUT';
    case 'CONTINUITY_JOURNAL_CORRUPT':
    case 'CONTINUITY_JOURNAL_DECRYPT_FAILED':
      return 'CONTINUITY_JOURNAL_CORRUPT';
    case 'CONTINUITY_JOURNAL_ENCRYPTION_UNAVAILABLE':
    case 'CONTINUITY_JOURNAL_IO_FAILED':
      return 'CONTINUITY_JOURNAL_UNAVAILABLE';
    default:
      return 'PROFILE_CONTINUITY_OFFLINE';
  }
}

function continuityIdentityOf(
  cookie: ContinuityElectronCookie,
): ContinuityCookieIdentity | null {
  try {
    return normalizeContinuityCookieIdentity({
      domain: cookie.domain,
      hostOnly: cookie.hostOnly === true,
      path: cookie.path ?? '/',
      name: cookie.name,
    });
  } catch {
    return null;
  }
}

function changeOfCookie(
  cookie: ContinuityElectronCookie,
  removed: boolean,
):
  | { change: ContinuityCookieChange }
  | { skip: LoginContinuityReasonCode } {
  const identity = continuityIdentityOf(cookie);
  if (!identity) return { skip: 'COOKIE_UNSUPPORTED' };
  if (
    cookie.session === true ||
    (cookie.session !== false && cookie.expirationDate === undefined)
  ) {
    return { skip: 'COOKIE_SESSION_POLICY' };
  }
  if (removed) return { change: { identity, kind: 'tombstone' } };
  if (
    cookie.expirationDate === undefined ||
    !Number.isFinite(cookie.expirationDate)
  ) {
    return { skip: 'COOKIE_SESSION_POLICY' };
  }
  const candidate = {
    identity,
    kind: 'upsert' as const,
    value: cookie.value,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite ?? 'unspecified',
    expirationDate: cookie.expirationDate,
  };
  try {
    return { change: parseContinuityCookieChange(candidate) };
  } catch {
    try {
      return {
        skip:
          serializedContinuityItemBytes(candidate) >
          PROFILE_CONTINUITY_ITEM_MAX_BYTES
            ? 'COOKIE_TOO_LARGE'
            : 'COOKIE_UNSUPPORTED',
      };
    } catch {
      return { skip: 'COOKIE_UNSUPPORTED' };
    }
  }
}

function cookieUrl(record: ContinuityCookieRecord): string {
  const scheme = record.kind === 'upsert' && !record.secure ? 'http' : 'https';
  return `${scheme}://${record.identity.domain}${record.identity.path}`;
}

/** Main-only Cookie sync and hydration coordinator. */
export class ProfileContinuityController
  implements ProfileContinuityMigrationPort
{
  private readonly logger: NonNullable<ProfileContinuityControllerDeps['logger']>;
  private readonly newOperationId: () => string;
  private readonly setTimer: NonNullable<ProfileContinuityControllerDeps['setTimer']>;
  private readonly clearTimer: NonNullable<ProfileContinuityControllerDeps['clearTimer']>;
  private readonly newMigrationNonce: (operationId: string) => Buffer;
  private readonly summaries = new Map<string, MutableSummary>();
  private readonly syncedIdentities = new Map<string, Set<string>>();
  private readonly skippedItems = new Map<string, Set<string>>();
  private readonly journals = new Map<string, LoadedProfileJournal>();
  private readonly hydrated = new Set<string>();
  private readonly inFlight = new Map<string, Promise<BrowserContinuityPrepareResult>>();
  private readonly profileTails = new Map<string, Promise<void>>();
  private readonly listeners = new Map<
    string,
    Parameters<ContinuityCookieStorePort['on']>[1]
  >();
  private readonly suppression = new Map<
    string,
    Map<string, SuppressedMutation>
  >();
  private readonly overwriteTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(private readonly deps: ProfileContinuityControllerDeps) {
    this.logger = deps.logger ?? console;
    this.newOperationId = deps.newOperationId ?? randomUUID;
    this.setTimer = deps.setTimer ?? setTimeout;
    this.clearTimer = deps.clearTimer ?? clearTimeout;
    this.newMigrationNonce =
      deps.newMigrationNonce ??
      ((operationId) =>
        createHash('sha256')
          .update('termpro-continuity-migration-v1\0', 'utf8')
          .update(operationId, 'utf8')
          .digest());
  }

  summary(profileId: string): LoginContinuitySummary {
    const entry = this.deps.getCatalogEntry(profileId);
    if (!entry || entry.storage.kind === 'local') {
      return emptySummary('not_available');
    }
    return cloneSummary(this.summaries.get(profileId) ?? emptySummary('syncing'));
  }

  partitionsForCleanup(profileId: string): string[] {
    const partitions = new Set(this.deps.partitionsOfProfile(profileId));
    const loaded = this.journals.get(profileId);
    for (const partition of loaded?.document.seededPartitions ?? []) {
      partitions.add(partition);
    }
    for (const partition of this.deps.journal.listSeededPartitions(profileId)) {
      partitions.add(partition);
    }
    return [...partitions];
  }

  async probe(profileId: string): Promise<LoginContinuitySummary> {
    const existing = this.summaries.get(profileId);
    if (existing) return cloneSummary(existing);
    const entry = this.requireRemoteEntry(profileId);
    try {
      const provider = this.deps.remoteProvider(entry.storage.hostId);
      await provider.describeContinuity();
      const generation = provider.currentGeneration();
      if (!generation) {
        throw Object.assign(new Error('fixed'), {
          code: 'PROFILE_STORAGE_OFFLINE',
        });
      }
      const lifecycle = await provider.getContinuityLifecycle(profileId);
      this.assertGeneration(provider, generation);
      if (lifecycle.lifecycle === 'moved' || lifecycle.lifecycle === 'deleted') {
        await this.handleRetired(profileId, lifecycle);
        return this.summary(profileId);
      }
      if (!this.summaries.has(profileId)) this.setSummary(profileId, emptySummary('syncing'));
    } catch (error) {
      this.markFailure(profileId, error);
    }
    return this.summary(profileId);
  }

  prepare(
    profileId: string,
    netHostId: string,
  ): Promise<BrowserContinuityPrepareResult> {
    const partition = browserPartition(profileId, netHostId);
    if (!this.deps.isKnownPartition(partition)) {
      return Promise.resolve({
        ready: false,
        reason: 'PROFILE_CONTINUITY_OFFLINE',
        canRetry: false,
      });
    }
    const migrationPhase = this.deps.getMigrationPhase?.(profileId);
    if (
      migrationPhase === 'switching' ||
      migrationPhase === 'cleanup_pending'
    ) {
      // A committed catalog from an interrupted older run may already point
      // at the target while the encrypted journal is still source-bound. The
      // same handoff begins at switching, after source hydration is frozen.
      // Only completeMigration may cross that boundary; public navigation and
      // Host-ready retry stay gated and must never trigger mismatch recovery.
      this.clearHydratedProfile(profileId);
      this.setSummary(profileId, {
        ...this.summary(profileId),
        state: 'paused',
        reasons: ['PROFILE_CONTINUITY_OFFLINE'],
        canRetry: false,
      });
      return Promise.resolve({
        ready: false,
        reason: 'PROFILE_CONTINUITY_OFFLINE',
        canRetry: false,
      });
    }
    let hostId: string;
    try {
      hostId = this.requireRemoteEntry(profileId).storage.hostId;
    } catch {
      return Promise.resolve({
        ready: false,
        reason: 'PROFILE_CONTINUITY_OFFLINE',
        canRetry: false,
      });
    }
    const provider = this.deps.remoteProvider(hostId);
    const generation = provider.currentGeneration();
    if (!generation) {
      this.markFailure(profileId, { code: 'PROFILE_STORAGE_OFFLINE' });
      return Promise.resolve({
        ready: false,
        reason: 'PROFILE_CONTINUITY_OFFLINE',
        canRetry: true,
      });
    }
    const hydratedKey = this.hydratedKey(profileId, partition, generation);
    const inFlightKey = hydratedKey;
    const current = this.inFlight.get(inFlightKey);
    if (current) return current;
    const task = this.enqueueProfile(profileId, () =>
      this.hydrate(
        profileId,
        hostId,
        partition,
        generation,
      ),
    ).finally(() => {
      if (this.inFlight.get(inFlightKey) === task) this.inFlight.delete(inFlightKey);
    });
    this.inFlight.set(inFlightKey, task);
    return task;
  }

  isHydrated(
    profileId: string,
    partition: string,
    generation: string,
  ): boolean {
    return this.hydrated.has(this.hydratedKey(profileId, partition, generation));
  }

  async retry(profileId: string): Promise<void> {
    const entry = this.requireRemoteEntry(profileId);
    const generation = this.deps
      .remoteProvider(entry.storage.hostId)
      .currentGeneration();
    if (!generation) throw Object.assign(new Error('fixed'), { code: 'PROFILE_STORAGE_OFFLINE' });
    for (const partition of this.deps.partitionsOfProfile(profileId)) {
      const suffix = this.netHostId(profileId, partition);
      if (suffix !== null) await this.prepare(profileId, suffix);
    }
  }

  async prepareMigration(record: ProfileMigrationRecordV1): Promise<void> {
    if (record.source.kind !== 'remote') return;
    const sourceHostId = record.source.hostId;
    return this.enqueueProfile(record.profileId, () =>
      this.prepareMigrationPlanes(record, sourceHostId),
    );
  }

  async activateMigration(
    record: ProfileMigrationRecordV1,
    committedSourceEpoch: number,
  ): Promise<void> {
    if (record.target.kind !== 'remote') return;
    const target = this.requireMigrationProvider(
      this.deps.remoteProvider(record.target.hostId),
    );
    const generation = target.currentGeneration();
    if (!generation) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_OFFLINE',
      });
    }
    await target.activateContinuityMigration(record.profileId, {
      operationId: record.operationId,
      epoch: committedSourceEpoch,
    });
    this.assertGeneration(target, generation);
  }

  async completeMigration(record: ProfileMigrationRecordV1): Promise<void> {
    return this.enqueueProfile(record.profileId, async () => {
      if (record.target.kind === 'local') {
        // The Cookie mutation already changed Chromium before its old-source
        // journal entry was appended. Local is now authoritative, so remove
        // only that obsolete journal and preserve every local partition.
        this.forgetProfile(record.profileId);
        return;
      }

      const target = this.deps.remoteProvider(record.target.hostId);
      const generation = target.currentGeneration();
      if (!generation) {
        throw Object.assign(new Error('fixed'), {
          code: 'PROFILE_STORAGE_OFFLINE',
        });
      }
      const targetLifecycle = await target.getContinuityLifecycle(
        record.profileId,
      );
      this.assertGeneration(target, generation);
      if (targetLifecycle.lifecycle !== 'active') {
        throw Object.assign(new Error('fixed'), {
          code: 'PROFILE_STORAGE_FORBIDDEN',
        });
      }

      let loaded = this.journals.get(record.profileId);
      if (!loaded) {
        try {
          loaded = {
            hostId: record.target.hostId,
            generation,
            document: this.deps.journal.load(record.profileId, {
              hostId: record.target.hostId,
              epoch: targetLifecycle.epoch,
            }),
          };
          this.journals.set(record.profileId, loaded);
        } catch (error) {
          if (
            !(error instanceof ProfileContinuityJournalError) ||
            error.code !== 'CONTINUITY_JOURNAL_AUTHORITY_MISMATCH'
          ) {
            throw error;
          }
          // The durable document is still source-bound. Load it below using
          // the retired source epoch, then atomically replace it with target.
        }
      }
      if (
        !loaded ||
        loaded.hostId !== record.target.hostId ||
        loaded.document.authority.epoch !== targetLifecycle.epoch
      ) {
        let oldDocument = loaded?.document;
        if (!oldDocument && record.source.kind === 'remote') {
          const source = this.deps.remoteProvider(record.source.hostId);
          const sourceGeneration = source.currentGeneration();
          if (!sourceGeneration) {
            throw Object.assign(new Error('fixed'), {
              code: 'PROFILE_STORAGE_OFFLINE',
            });
          }
          const retired = await source.getContinuityLifecycle(record.profileId);
          this.assertGeneration(source, sourceGeneration);
          if (retired.lifecycle !== 'moved' || retired.epoch === 0) {
            throw Object.assign(new Error('fixed'), {
              code: 'PROFILE_STORAGE_FORBIDDEN',
            });
          }
          oldDocument = this.deps.journal.load(record.profileId, {
            hostId: record.source.hostId,
            epoch: retired.epoch - 1,
          });
        }
        if (!oldDocument) {
          throw Object.assign(new Error('fixed'), {
            code: 'CONTINUITY_JOURNAL_UNAVAILABLE',
          });
        }
        const rebound = this.deps.journal.save({
          ...oldDocument,
          authority: {
            hostId: record.target.hostId,
            epoch: targetLifecycle.epoch,
          },
          confirmedRevision: 0,
          pending: oldDocument.pending.map((operation) => ({
            ...operation,
            // Preserve the stable operationId/change across the authority
            // switch; update only the lifecycle fence accepted by target.
            profileEpoch: targetLifecycle.epoch,
          })),
        });
        loaded = {
          hostId: record.target.hostId,
          generation,
          document: rebound,
        };
        this.journals.set(record.profileId, loaded);
      }
      loaded.generation = generation;
      this.clearHydratedProfile(record.profileId);

      let hydratedAny = false;
      for (const partition of this.deps.partitionsOfProfile(record.profileId)) {
        if (!this.deps.isKnownPartition(partition)) continue;
        const result = await this.hydrate(
          record.profileId,
          record.target.hostId,
          partition,
          generation,
        );
        if (!result.ready) {
          throw Object.assign(new Error('fixed'), {
            code:
              result.reason === 'PROFILE_CONTINUITY_TIMEOUT'
                ? 'PROFILE_STORAGE_TIMEOUT'
                : 'PROFILE_STORAGE_OFFLINE',
          });
        }
        hydratedAny = true;
      }
      if (!hydratedAny) {
        await this.flushPending(record.profileId, target, generation, loaded);
        await this.pullAndApply(
          record.profileId,
          target,
          generation,
          loaded,
          loaded.document.confirmedRevision,
        );
      }
    });
  }

  invalidateHost(hostId: string): void {
    for (const entry of this.journals.values()) {
      if (entry.hostId !== hostId) continue;
      const profileId = entry.document.profileId;
      const summary = this.summary(profileId);
      this.setSummary(profileId, {
        ...summary,
        state: 'paused',
        pendingCount: entry.document.pending.length,
        reasons: ['PROFILE_CONTINUITY_OFFLINE'],
        canRetry: true,
      });
    }
  }

  forgetProfile(profileId: string): void {
    this.journals.delete(profileId);
    this.summaries.delete(profileId);
    this.syncedIdentities.delete(profileId);
    this.skippedItems.delete(profileId);
    this.deps.journal.delete(profileId);
    this.clearHydratedProfile(profileId);
  }

  dispose(): void {
    for (const [partition, listener] of this.listeners) {
      this.deps.cookiesForPartition(partition).removeListener('changed', listener);
    }
    this.listeners.clear();
    for (const timer of this.overwriteTimers.values()) this.clearTimer(timer);
    this.overwriteTimers.clear();
  }

  private async prepareMigrationPlanes(
    record: ProfileMigrationRecordV1,
    sourceHostId: string,
  ): Promise<void> {
    const profileId = record.profileId;
    const source = this.requireMigrationProvider(
      this.deps.remoteProvider(sourceHostId),
    );
    const sourceGeneration = source.currentGeneration();
    if (!sourceGeneration) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_OFFLINE',
      });
    }
    await source.describeContinuity();
    this.assertGeneration(source, sourceGeneration);
    let lifecycle = await source.getContinuityLifecycle(profileId);
    this.assertGeneration(source, sourceGeneration);
    if (lifecycle.lifecycle === 'deleted') {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_FORBIDDEN',
      });
    }

    const target =
      record.target.kind === 'remote'
        ? this.requireMigrationProvider(
            this.deps.remoteProvider(record.target.hostId),
          )
        : null;
    const targetGeneration = target?.currentGeneration() ?? null;
    if (target && !targetGeneration) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_OFFLINE',
      });
    }
    if (target) {
      await target.describeContinuity();
      this.assertGeneration(target, targetGeneration);
    }

    // The digest nonce is public but must be stable across switching-phase
    // process restarts so a frozen source and verified target recompute the
    // same snapshot digest for this durable operation.
    const nonceBytes = this.newMigrationNonce(record.operationId);
    if (
      !Buffer.isBuffer(nonceBytes) ||
      nonceBytes.length < 16 ||
      nonceBytes.length > 64
    ) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_IO_FAILED',
      });
    }
    const nonce = nonceBytes.toString('base64url');

    // If the global moved epoch is already durable, target preparation was
    // verified in the preceding switching attempt. Only re-establish the
    // target's idempotent prepared state; never read from the retired source.
    if (lifecycle.lifecycle === 'moved') {
      if (!target) return;
      const targetLifecycle = await target.getContinuityLifecycle(profileId);
      this.assertGeneration(target, targetGeneration);
      if (
        targetLifecycle.lifecycle === 'active' &&
        targetLifecycle.epoch === lifecycle.epoch
      ) {
        // activate may have committed while its response was lost and removed
        // target staging. Let the coordinator replay bundle publish + activate;
        // Host validates the same operationId at that idempotent boundary.
        return;
      }
      const verified = await target.verifyContinuityMigration(profileId, {
        operationId: record.operationId,
        nonce,
      });
      this.assertGeneration(target, targetGeneration);
      await target.publishContinuityMigration(profileId, {
        operationId: record.operationId,
        expectedRevision: verified.revision,
        verifiedDigest: verified.digest,
      });
      this.assertGeneration(target, targetGeneration);
      return;
    }

    if (lifecycle.lifecycle === 'active') {
      // Drain any locally journaled login/logout mutations before freezing.
      // Calling hydrate directly keeps this work on the same per-profile tail.
      for (const partition of this.deps.partitionsOfProfile(profileId)) {
        if (!this.deps.isKnownPartition(partition)) continue;
        await this.hydrate(
          profileId,
          sourceHostId,
          partition,
          sourceGeneration,
        );
      }
      lifecycle = await source.getContinuityLifecycle(profileId);
      this.assertGeneration(source, sourceGeneration);
    }
    if (lifecycle.lifecycle !== 'active' && lifecycle.lifecycle !== 'moving') {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_FORBIDDEN',
      });
    }

    let cursor = 0;
    if (target) {
      // A response may have been lost after a durable stage. Probe the target
      // cursor so retry continues from the last confirmed bounded page.
      try {
        const staged = await target.verifyContinuityMigration(profileId, {
          operationId: record.operationId,
          nonce,
        });
        this.assertGeneration(target, targetGeneration);
        cursor = staged.revision;
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (
          code !== 'PROFILE_STORAGE_IO_FAILED' &&
          code !== 'PROFILE_STORAGE_INVALID_INPUT'
        ) {
          throw error;
        }
      }
    }

    cursor = await this.transferMigrationPages(
      profileId,
      source,
      sourceGeneration,
      cursor,
      target,
      targetGeneration,
      record.operationId,
    );
    if (target) {
      await target.verifyContinuityMigration(profileId, {
        operationId: record.operationId,
        nonce,
      });
      this.assertGeneration(target, targetGeneration);
    }

    const frozen = await source.freezeContinuityMigration(profileId, {
      operationId: record.operationId,
      expectedEpoch: lifecycle.epoch,
      nonce,
    });
    this.assertGeneration(source, sourceGeneration);
    cursor = await this.transferMigrationPages(
      profileId,
      source,
      sourceGeneration,
      cursor,
      target,
      targetGeneration,
      record.operationId,
    );
    if (cursor !== frozen.revision) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_CORRUPT',
      });
    }
    if (!target) return;

    const verified = await target.verifyContinuityMigration(profileId, {
      operationId: record.operationId,
      nonce,
    });
    this.assertGeneration(target, targetGeneration);
    if (
      verified.revision !== frozen.revision ||
      !this.equalDigest(verified.digest, frozen.digest)
    ) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_CORRUPT',
      });
    }
    await target.publishContinuityMigration(profileId, {
      operationId: record.operationId,
      expectedRevision: verified.revision,
      verifiedDigest: verified.digest,
    });
    this.assertGeneration(target, targetGeneration);
  }

  private async transferMigrationPages(
    profileId: string,
    source: ProfileContinuityMigrationRemotePort,
    sourceGeneration: string,
    initialRevision: number,
    target: ProfileContinuityMigrationRemotePort | null,
    targetGeneration: string | null,
    operationId: string,
  ): Promise<number> {
    let cursor = initialRevision;
    let hasMore = true;
    while (hasMore) {
      const page = await source.pullContinuity(profileId, {
        fromRevision: cursor,
        pageBytes: PAGE_BYTES,
      });
      this.assertGeneration(source, sourceGeneration);
      if (target) {
        const staged = await target.stageContinuityMigration(profileId, {
          operationId,
          page,
        });
        this.assertGeneration(target, targetGeneration);
        if (staged.confirmedRevision !== page.nextRevision) {
          throw Object.assign(new Error('fixed'), {
            code: 'PROFILE_STORAGE_CORRUPT',
          });
        }
      } else {
        for (const record of page.records) {
          await this.applyRecordToKnownPartitions(profileId, record);
        }
      }
      cursor = page.nextRevision;
      hasMore = page.hasMore;
      if (!hasMore) return cursor;
      if (page.records.length === 0) {
        throw Object.assign(new Error('fixed'), {
          code: 'PROFILE_STORAGE_IO_FAILED',
        });
      }
    }
    return cursor;
  }

  private equalDigest(left: string, right: string): boolean {
    try {
      const leftBytes = Buffer.from(left, 'base64url');
      const rightBytes = Buffer.from(right, 'base64url');
      return (
        leftBytes.length === 32 &&
        rightBytes.length === 32 &&
        timingSafeEqual(leftBytes, rightBytes)
      );
    } catch {
      return false;
    }
  }

  private async hydrate(
    profileId: string,
    hostId: string,
    partition: string,
    generation: string,
  ): Promise<BrowserContinuityPrepareResult> {
    this.setSummary(profileId, {
      ...this.summary(profileId),
      state: 'hydrating',
      reasons: [],
      canRetry: false,
    });
    const provider = this.deps.remoteProvider(hostId);
    try {
      await provider.describeContinuity();
      this.assertGeneration(provider, generation);
      const lifecycle = await provider.getContinuityLifecycle(profileId);
      this.assertGeneration(provider, generation);
      if (lifecycle.lifecycle === 'moved' || lifecycle.lifecycle === 'deleted') {
        await this.handleRetired(profileId, lifecycle);
        return {
          ready: false,
          reason:
            lifecycle.lifecycle === 'moved' ? 'PROFILE_MOVED' : 'PROFILE_DELETED',
          canRetry: false,
        };
      }
      if (lifecycle.lifecycle !== 'active') {
        throw Object.assign(new Error('fixed'), { code: 'PROFILE_STORAGE_OFFLINE' });
      }
      let loaded = this.journals.get(profileId);
      if (
        !loaded ||
        loaded.hostId !== hostId ||
        loaded.document.authority.epoch !== lifecycle.epoch
      ) {
        try {
          loaded = {
            hostId,
            generation,
            document: this.deps.journal.load(profileId, {
              hostId,
              epoch: lifecycle.epoch,
            }),
          };
        } catch (error) {
          if (
            error instanceof ProfileContinuityJournalError &&
            error.code === 'CONTINUITY_JOURNAL_AUTHORITY_MISMATCH'
          ) {
            this.deps.journal.delete(profileId);
            loaded = {
              hostId,
              generation,
              document: this.deps.journal.load(profileId, {
                hostId,
                epoch: lifecycle.epoch,
              }),
            };
          } else {
            throw error;
          }
        }
        this.journals.set(profileId, loaded);
      }
      loaded.generation = generation;
      this.ensurePartitionListener(profileId, partition);
      const wasSeeded = loaded.document.seededPartitions.includes(partition);
      if (!wasSeeded) await this.seedPartition(profileId, partition, loaded);
      await this.flushPending(profileId, provider, generation, loaded);
      await this.pullAndApply(
        profileId,
        provider,
        generation,
        loaded,
        wasSeeded ? loaded.document.confirmedRevision : 0,
        wasSeeded ? undefined : partition,
      );
      this.assertGeneration(provider, generation);
      this.hydrated.add(this.hydratedKey(profileId, partition, generation));
      const summary = this.summary(profileId);
      this.setSummary(profileId, {
        ...summary,
        state: summary.skippedCount > 0 || summary.conflictCount > 0 ? 'attention' : 'synced',
        pendingCount: loaded.document.pending.length,
        canRetry: false,
      });
      const final = this.summary(profileId);
      return {
        ready: true,
        syncedCount: final.syncedCount,
        skippedCount: final.skippedCount,
      };
    } catch (error) {
      const reason = this.markFailure(profileId, error);
      return { ready: false, reason, canRetry: true };
    }
  }

  private async seedPartition(
    profileId: string,
    partition: string,
    loaded: LoadedProfileJournal,
  ): Promise<void> {
    const cookies = await this.deps.cookiesForPartition(partition).get({});
    let document = loaded.document;
    for (const cookie of cookies) {
      const converted = changeOfCookie(cookie, false);
      if ('skip' in converted) {
        const identity = continuityIdentityOf(cookie);
        this.incrementSkip(
          profileId,
          converted.skip,
          identity
            ? `${converted.skip}\0${continuityCookieIdentityKey(identity)}`
            : undefined,
        );
        continue;
      }
      document = this.appendChange(document, converted.change);
    }
    loaded.document = this.deps.journal.save({
      ...document,
      seededPartitions: [...document.seededPartitions, partition],
    });
  }

  private appendChange(
    document: LoadedProfileJournal['document'],
    change: ContinuityCookieChange,
  ): LoadedProfileJournal['document'] {
    const key = continuityCookieIdentityKey(change.identity);
    const baseRevision =
      document.identityRevisions.find(
        (entry) => continuityCookieIdentityKey(entry.identity) === key,
      )?.revision ?? 0;
    return this.deps.journal.appendPending(document, {
      deviceId: this.deps.clientId,
      operationId: this.newOperationId(),
      profileEpoch: document.authority.epoch,
      baseRevision,
      change,
    });
  }

  private async flushPending(
    profileId: string,
    provider: ProfileContinuityRemotePort,
    generation: string,
    loaded: LoadedProfileJournal,
  ): Promise<void> {
    this.setSummary(profileId, {
      ...this.summary(profileId),
      state: 'syncing',
      pendingCount: loaded.document.pending.length,
    });
    for (const pending of [...loaded.document.pending]) {
      const result = await provider.pushContinuity(profileId, pending);
      this.assertGeneration(provider, generation);
      loaded.document = this.deps.journal.confirmPending(loaded.document, {
        operationIds: [pending.operationId],
        confirmedRevision: loaded.document.confirmedRevision,
        identityRevisionUpdates: [
          { identity: result.current.identity, revision: result.revision },
        ],
      });
      if (result.outcome === 'conflict_won' || result.outcome === 'stale_rejected') {
        const summary = this.summary(profileId);
        this.setSummary(profileId, {
          ...summary,
          conflictCount: summary.conflictCount + 1,
          reasons: summary.reasons.includes('COOKIE_CONFLICT_RESOLVED')
            ? summary.reasons
            : [...summary.reasons, 'COOKIE_CONFLICT_RESOLVED'],
        });
      }
    }
  }

  private async pullAndApply(
    profileId: string,
    provider: ProfileContinuityRemotePort,
    generation: string,
    loaded: LoadedProfileJournal,
    initialRevision: number,
    targetPartition?: string,
  ): Promise<void> {
    let cursor = initialRevision;
    let hasMore = true;
    while (hasMore) {
      const page = await provider.pullContinuity(profileId, {
        fromRevision: cursor,
        pageBytes: PAGE_BYTES,
      });
      this.assertGeneration(provider, generation);
      if (page.epoch !== loaded.document.authority.epoch) {
        throw Object.assign(new Error('fixed'), { code: 'PROFILE_STORAGE_FORBIDDEN' });
      }
      for (const record of page.records) {
        await this.applyRecordToKnownPartitions(
          profileId,
          record,
          targetPartition,
        );
      }
      const updates = page.records.map((record) => ({
        identity: record.identity,
        revision: record.revision,
      }));
      loaded.document = this.deps.journal.confirmPending(loaded.document, {
        operationIds: [],
        confirmedRevision: Math.max(
          loaded.document.confirmedRevision,
          page.nextRevision,
        ),
        identityRevisionUpdates: updates,
      });
      cursor = page.nextRevision;
      hasMore = page.hasMore;
      if (!hasMore) break;
      if (page.records.length === 0) {
        throw Object.assign(new Error('fixed'), { code: 'PROFILE_STORAGE_IO_FAILED' });
      }
    }
  }

  private async applyRecordToKnownPartitions(
    profileId: string,
    record: ContinuityCookieRecord,
    targetPartition?: string,
  ): Promise<void> {
    let applied = false;
    let failed = false;
    const partitions = targetPartition
      ? [targetPartition]
      : this.deps.partitionsOfProfile(profileId);
    for (const partition of partitions) {
      if (!this.deps.isKnownPartition(partition)) continue;
      this.ensurePartitionListener(profileId, partition);
      try {
        await this.applyRecord(partition, record);
        applied = true;
      } catch {
        failed = true;
      }
    }
    if (applied) {
      let identities = this.syncedIdentities.get(profileId);
      if (!identities) {
        identities = new Set();
        this.syncedIdentities.set(profileId, identities);
      }
      const identityKey = continuityCookieIdentityKey(record.identity);
      if (!identities.has(identityKey)) {
        identities.add(identityKey);
        const summary = this.summary(profileId);
        this.setSummary(profileId, {
          ...summary,
          syncedCount: summary.syncedCount + 1,
        });
      }
    }
    if (failed) {
      this.incrementSkip(
        profileId,
        'COOKIE_APPLY_FAILED',
        `COOKIE_APPLY_FAILED\0${continuityCookieIdentityKey(record.identity)}`,
      );
    }
  }

  private async applyRecord(
    partition: string,
    record: ContinuityCookieRecord,
  ): Promise<void> {
    const store = this.deps.cookiesForPartition(partition);
    this.suppress(partition, record);
    try {
      const url = cookieUrl(record);
      if (record.kind === 'tombstone') {
        await store.remove(url, record.identity.name);
        return;
      }
      await store.set({
        url,
        name: record.identity.name,
        value: record.value,
        ...(record.identity.hostOnly ? {} : { domain: record.identity.domain }),
        path: record.identity.path,
        secure: record.secure,
        httpOnly: record.httpOnly,
        sameSite: record.sameSite,
        expirationDate: record.expirationDate,
      });
    } catch (error) {
      this.unsuppress(partition, record.identity);
      throw error;
    }
  }

  private ensurePartitionListener(profileId: string, partition: string): void {
    if (this.listeners.has(partition)) return;
    const listener: Parameters<ContinuityCookieStorePort['on']>[1] = (
      _event,
      cookie,
      cause,
      removed,
    ) => {
      void this.enqueueProfile(profileId, () =>
        this.handleCookieChanged(profileId, partition, cookie, cause, removed),
      ).catch((error) => {
        this.logger.warn(
          `[profile-continuity] profileId=${profileId} phase=cookie-changed code=${reasonOf(error)}`,
        );
      });
    };
    this.deps.cookiesForPartition(partition).on('changed', listener);
    this.listeners.set(partition, listener);
  }

  private async handleCookieChanged(
    profileId: string,
    partition: string,
    cookie: ContinuityElectronCookie,
    cause: ContinuityCookieChangedCause,
    removed: boolean,
  ): Promise<void> {
    const identity = continuityIdentityOf(cookie);
    if (identity && this.consumeSuppression(partition, identity, cookie, removed)) return;
    if (cause === 'evicted') return;
    const converted = changeOfCookie(cookie, removed);
    if ('skip' in converted) {
      this.incrementSkip(
        profileId,
        converted.skip,
        identity
          ? `${converted.skip}\0${continuityCookieIdentityKey(identity)}`
          : undefined,
      );
      return;
    }
    const key = identity ? `${partition}\0${continuityCookieIdentityKey(identity)}` : '';
    if (removed && (cause === 'overwrite' || cause === 'expired-overwrite')) {
      const existing = this.overwriteTimers.get(key);
      if (existing) this.clearTimer(existing);
      const timer = this.setTimer(() => {
        this.overwriteTimers.delete(key);
        void this.enqueueProfile(profileId, () =>
          this.queueLocalChange(profileId, converted.change),
        );
      }, OVERWRITE_PAIR_WINDOW_MS);
      this.overwriteTimers.set(key, timer);
      return;
    }
    const paired = this.overwriteTimers.get(key);
    if (paired) {
      this.clearTimer(paired);
      this.overwriteTimers.delete(key);
    }
    await this.queueLocalChange(profileId, converted.change);
  }

  private async queueLocalChange(
    profileId: string,
    change: ContinuityCookieChange,
  ): Promise<void> {
    const loaded = this.journals.get(profileId);
    if (!loaded) return;
    loaded.document = this.appendChange(loaded.document, change);
    const summary = this.summary(profileId);
    this.setSummary(profileId, {
      ...summary,
      state: 'paused',
      pendingCount: loaded.document.pending.length,
      reasons: ['PROFILE_CONTINUITY_OFFLINE'],
      canRetry: true,
    });
    const provider = this.deps.remoteProvider(loaded.hostId);
    const generation = provider.currentGeneration();
    if (!generation) return;
    try {
      await this.flushPending(profileId, provider, generation, loaded);
      await this.pullAndApply(
        profileId,
        provider,
        generation,
        loaded,
        loaded.document.confirmedRevision,
      );
      const next = this.summary(profileId);
      this.setSummary(profileId, {
        ...next,
        state: next.skippedCount > 0 || next.conflictCount > 0 ? 'attention' : 'synced',
        pendingCount: loaded.document.pending.length,
        reasons: next.reasons.filter(
          (reason) => reason !== 'PROFILE_CONTINUITY_OFFLINE',
        ),
        canRetry: false,
      });
    } catch (error) {
      if (
        (error as { code?: unknown } | null)?.code ===
        'PROFILE_STORAGE_FORBIDDEN'
      ) {
        try {
          const lifecycle = await provider.getContinuityLifecycle(profileId);
          this.assertGeneration(provider, generation);
          if (
            lifecycle.lifecycle === 'moved' ||
            lifecycle.lifecycle === 'deleted'
          ) {
            await this.handleRetired(profileId, lifecycle);
            return;
          }
        } catch {
          // Keep the original fixed failure when lifecycle probing is unavailable.
        }
      }
      this.markFailure(profileId, error);
    }
  }

  private suppress(partition: string, record: ContinuityCookieRecord): void {
    let entries = this.suppression.get(partition);
    if (!entries) {
      entries = new Map();
      this.suppression.set(partition, entries);
    }
    entries.set(continuityCookieIdentityKey(record.identity), {
      kind: record.kind,
      ...(record.kind === 'upsert' ? { value: record.value } : {}),
      expiresAt: Date.now() + SUPPRESSION_TTL_MS,
    });
  }

  private unsuppress(
    partition: string,
    identity: ContinuityCookieIdentity,
  ): void {
    this.suppression.get(partition)?.delete(continuityCookieIdentityKey(identity));
  }

  private consumeSuppression(
    partition: string,
    identity: ContinuityCookieIdentity,
    cookie: ContinuityElectronCookie,
    removed: boolean,
  ): boolean {
    const entries = this.suppression.get(partition);
    if (!entries) return false;
    const key = continuityCookieIdentityKey(identity);
    const candidate = entries.get(key);
    if (!candidate) return false;
    if (candidate.expiresAt < Date.now()) {
      entries.delete(key);
      return false;
    }
    const matches = removed
      ? candidate.kind === 'tombstone'
      : candidate.kind === 'upsert' && candidate.value === cookie.value;
    if (matches) entries.delete(key);
    return matches;
  }

  private incrementSkip(
    profileId: string,
    reason: LoginContinuityReasonCode,
    dedupeKey?: string,
  ): void {
    if (dedupeKey) {
      let items = this.skippedItems.get(profileId);
      if (!items) {
        items = new Set();
        this.skippedItems.set(profileId, items);
      }
      if (items.has(dedupeKey)) return;
      items.add(dedupeKey);
    }
    const summary = this.summary(profileId);
    this.setSummary(profileId, {
      ...summary,
      skippedCount: summary.skippedCount + 1,
      reasons: summary.reasons.includes(reason)
        ? summary.reasons
        : [...summary.reasons, reason],
    });
  }

  private markFailure(
    profileId: string,
    error: unknown,
  ): LoginContinuityReasonCode {
    const reason = reasonOf(error);
    const current = this.summary(profileId);
    this.setSummary(profileId, {
      ...current,
      state: reason === 'HOST_UPGRADE_REQUIRED' ? 'host_upgrade' : 'paused',
      reasons: [reason],
      canRetry: true,
      pendingCount: this.journals.get(profileId)?.document.pending.length ?? current.pendingCount,
    });
    const level =
      reason === 'CONTINUITY_JOURNAL_CORRUPT' ||
      reason === 'CONTINUITY_JOURNAL_UNAVAILABLE'
        ? 'error'
        : 'warn';
    this.logger[level](
      `[profile-continuity] profileId=${profileId} phase=sync code=${reason}`,
    );
    return reason;
  }

  private setSummary(profileId: string, summary: MutableSummary): void {
    this.summaries.set(profileId, cloneSummary(summary));
    try {
      this.deps.onSummaryChanged?.();
    } catch {
      this.logger.warn(
        `[profile-continuity] profileId=${profileId} phase=notify code=PROFILE_CONTINUITY_OFFLINE`,
      );
    }
  }

  private requireRemoteEntry(profileId: string): ProfileContinuityCatalogEntry & {
    storage: Extract<ProfileStorageRef, { kind: 'remote' }>;
  } {
    const entry = this.deps.getCatalogEntry(profileId);
    if (
      !entry ||
      entry.lifecycle !== 'active' ||
      entry.storage.kind !== 'remote'
    ) {
      throw Object.assign(new Error('fixed'), { code: 'PROFILE_STORAGE_INVALID_INPUT' });
    }
    return entry as ProfileContinuityCatalogEntry & {
      storage: Extract<ProfileStorageRef, { kind: 'remote' }>;
    };
  }

  private requireMigrationProvider(
    provider: ProfileContinuityRemotePort,
  ): ProfileContinuityMigrationRemotePort {
    if (
      typeof provider.stageContinuityMigration !== 'function' ||
      typeof provider.verifyContinuityMigration !== 'function' ||
      typeof provider.freezeContinuityMigration !== 'function' ||
      typeof provider.publishContinuityMigration !== 'function' ||
      typeof provider.activateContinuityMigration !== 'function' ||
      typeof provider.discardContinuityMigration !== 'function'
    ) {
      throw Object.assign(new Error('fixed'), {
        code: 'PROFILE_STORAGE_INCOMPATIBLE',
      });
    }
    return provider as ProfileContinuityMigrationRemotePort;
  }

  private assertGeneration(
    provider: ProfileContinuityRemotePort,
    expected: string | null,
  ): void {
    if (!expected || provider.currentGeneration() !== expected) {
      throw Object.assign(new Error('fixed'), { code: 'PROFILE_STORAGE_OFFLINE' });
    }
  }

  private async handleRetired(
    profileId: string,
    lifecycle: ProfileContinuityLifecycleResult,
  ): Promise<void> {
    if ((this.deps.getMigrationPhase?.(profileId) ?? null) !== null) {
      // Post-freeze Cookie mutations are queued behind migration preparation.
      // Keep their stable pending operations until completeMigration can
      // atomically rebind/replay them against the activated target authority.
      this.setSummary(profileId, {
        ...this.summary(profileId),
        state: 'moved',
        reasons: [
          lifecycle.lifecycle === 'moved' ? 'PROFILE_MOVED' : 'PROFILE_DELETED',
        ],
        canRetry: false,
      });
      return;
    }
    const cleanupPartitions = this.partitionsForCleanup(profileId);
    this.setSummary(profileId, {
      ...emptySummary('moved'),
      reasons: [
        lifecycle.lifecycle === 'moved' ? 'PROFILE_MOVED' : 'PROFILE_DELETED',
      ],
    });
    await this.deps.onRetired?.(profileId, lifecycle, cleanupPartitions);
    this.deps.journal.delete(profileId);
    this.journals.delete(profileId);
    this.syncedIdentities.delete(profileId);
    this.skippedItems.delete(profileId);
    this.clearHydratedProfile(profileId);
  }

  private hydratedKey(
    profileId: string,
    partition: string,
    generation: string,
  ): string {
    return `${profileId}\0${partition}\0${generation}`;
  }

  private clearHydratedProfile(profileId: string): void {
    for (const key of [...this.hydrated]) {
      if (key.startsWith(`${profileId}\0`)) this.hydrated.delete(key);
    }
  }

  private netHostId(profileId: string, partition: string): string | null {
    if (partition === browserPartition(profileId, 'local')) return 'local';
    const prefix = `${browserPartition(profileId, '')}`;
    if (!partition.startsWith(prefix)) return null;
    return partition.slice(prefix.length);
  }

  private enqueueProfile<T>(profileId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.profileTails.get(profileId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.profileTails.set(profileId, tail);
    void tail.finally(() => {
      if (this.profileTails.get(profileId) === tail) this.profileTails.delete(profileId);
    });
    return result;
  }
}
