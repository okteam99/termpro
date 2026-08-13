// Browser Profile login continuity wire contract. Cookie identities and values
// are bearer-secret material: keep this module out of renderer-facing DTOs and
// never include parsed values in errors or logs.

export const PROFILE_CONTINUITY_VERSION = 1 as const;
export const PROFILE_CONTINUITY_PAGE_MAX_BYTES = 512 * 1024;
export const PROFILE_CONTINUITY_ITEM_MAX_BYTES = 64 * 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_32_BYTES_RE = /^[A-Za-z0-9_-]{43}$/;
const ASCII_HOST_RE = /^[a-z0-9.-]+$/;
const COOKIE_SAME_SITE_VALUES = new Set<ContinuityCookieSameSite>([
  'unspecified',
  'no_restriction',
  'lax',
  'strict',
]);

export type ContinuityCookieSameSite =
  | 'unspecified'
  | 'no_restriction'
  | 'lax'
  | 'strict';

export interface ContinuityCookieIdentity {
  domain: string;
  hostOnly: boolean;
  path: string;
  name: string;
}

export interface ContinuityCookieUpsert {
  identity: ContinuityCookieIdentity;
  kind: 'upsert';
  value: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: ContinuityCookieSameSite;
  expirationDate: number;
}

export interface ContinuityCookieTombstone {
  identity: ContinuityCookieIdentity;
  kind: 'tombstone';
}

export type ContinuityCookieChange =
  | ContinuityCookieUpsert
  | ContinuityCookieTombstone;

export type ContinuityCookieRecord = ContinuityCookieChange & {
  revision: number;
};

export interface ContinuityOperation {
  deviceId: string;
  operationId: string;
  profileEpoch: number;
  baseRevision: number;
  change: ContinuityCookieChange;
}

export type ContinuityOperationOutcome =
  | 'accepted'
  | 'conflict_won'
  | 'stale_rejected'
  | 'duplicate';

export interface ContinuityOperationResult {
  operationId: string;
  revision: number;
  outcome: ContinuityOperationOutcome;
  current: ContinuityCookieRecord;
}

export interface ContinuityPullRequest {
  fromRevision: number;
  pageBytes: number;
}

export interface ContinuityPage {
  profileId: string;
  epoch: number;
  fromRevision: number;
  records: ContinuityCookieRecord[];
  nextRevision: number;
  hasMore: boolean;
}

export type ProfileContinuityLifecycle =
  | 'active'
  | 'moving'
  | 'moved'
  | 'deleted';

export interface ProfileContinuityLifecycleResult {
  profileId: string;
  epoch: number;
  lifecycle: ProfileContinuityLifecycle;
  movedTo?: 'remote' | 'local';
}

export interface RemoteProfileDiscoverySummary {
  profileId: string;
  name: string;
  createdAt: number;
  epoch: number;
}

export type ProfileRetireRequest =
  | {
      operationId: string;
      expectedEpoch: number;
      kind: 'deleted';
    }
  | {
      operationId: string;
      expectedEpoch: number;
      kind: 'moved';
      movedTo: 'remote' | 'local';
    };

export interface ProfileRetireResult
  extends ProfileContinuityLifecycleResult {
  operationId: string;
}

export interface ContinuityMigrationStageRequest {
  operationId: string;
  page: ContinuityPage;
}

export interface ContinuityMigrationStageResult {
  operationId: string;
  confirmedRevision: number;
  stagedCount: number;
  duplicate: boolean;
}

export interface ContinuityMigrationVerifyRequest {
  operationId: string;
  nonce: string;
}

export interface ContinuityMigrationVerifyResult {
  operationId: string;
  revision: number;
  digest: string;
}

export interface ContinuityMigrationFreezeRequest {
  operationId: string;
  expectedEpoch: number;
  nonce: string;
}

export interface ContinuityMigrationFreezeResult
  extends ProfileContinuityLifecycleResult {
  operationId: string;
  revision: number;
  digest: string;
}

export interface ContinuityMigrationPublishRequest {
  operationId: string;
  expectedRevision: number;
  verifiedDigest: string;
}

export interface ContinuityMigrationActivateRequest {
  operationId: string;
  epoch: number;
}

export interface ContinuityMigrationDiscardRequest {
  operationId: string;
}

export interface ContinuityMigrationDiscardResult {
  operationId: string;
  discarded: boolean;
  role?: 'source' | 'target';
}

export class ProfileContinuityValidationError extends Error {
  constructor() {
    super('Profile continuity input is invalid');
    this.name = 'ProfileContinuityValidationError';
  }
}

function invalid(): never {
  throw new ProfileContinuityValidationError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isSafeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && BASE64URL_32_BYTES_RE.test(value);
}

function normalizeDomain(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) invalid();
  const normalized = value.toLowerCase().replace(/^\.+/, '');
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.startsWith('.') ||
    normalized.endsWith('.') ||
    normalized.includes('..') ||
    !ASCII_HOST_RE.test(normalized)
  ) {
    invalid();
  }
  try {
    const url = new URL(`http://${normalized}`);
    if (url.hostname !== normalized) invalid();
  } catch {
    invalid();
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

/** Normalize the Profile-level identity; partition/network exit is excluded. */
export function normalizeContinuityCookieIdentity(
  input: unknown,
): ContinuityCookieIdentity {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['domain', 'hostOnly', 'path', 'name']) ||
    typeof input.hostOnly !== 'boolean' ||
    typeof input.path !== 'string' ||
    !input.path.startsWith('/') ||
    containsControlCharacter(input.path) ||
    typeof input.name !== 'string' ||
    input.name.length === 0 ||
    containsControlCharacter(input.name) ||
    input.name.includes(';') ||
    input.name.includes('=')
  ) {
    invalid();
  }
  return {
    domain: normalizeDomain(input.domain),
    hostOnly: input.hostOnly,
    path: input.path,
    name: input.name,
  };
}

/** Collision-free deterministic key. This value is secret and must not be logged. */
export function continuityCookieIdentityKey(
  identity: ContinuityCookieIdentity,
): string {
  const normalized = normalizeContinuityCookieIdentity(identity);
  return JSON.stringify([
    normalized.hostOnly,
    normalized.domain,
    normalized.path,
    normalized.name,
  ]);
}

export function serializedContinuityItemBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) invalid();
  return new TextEncoder().encode(serialized).byteLength;
}

export function parseContinuityCookieChange(
  input: unknown,
): ContinuityCookieChange {
  if (!isRecord(input) || typeof input.kind !== 'string') invalid();
  if (input.kind === 'tombstone') {
    if (!hasExactKeys(input, ['identity', 'kind'])) invalid();
    const change: ContinuityCookieTombstone = {
      identity: normalizeContinuityCookieIdentity(input.identity),
      kind: 'tombstone',
    };
    if (serializedContinuityItemBytes(change) > PROFILE_CONTINUITY_ITEM_MAX_BYTES)
      invalid();
    return change;
  }
  if (
    input.kind !== 'upsert' ||
    !hasExactKeys(input, [
      'identity',
      'kind',
      'value',
      'secure',
      'httpOnly',
      'sameSite',
      'expirationDate',
    ]) ||
    typeof input.value !== 'string' ||
    typeof input.secure !== 'boolean' ||
    typeof input.httpOnly !== 'boolean' ||
    typeof input.sameSite !== 'string' ||
    !COOKIE_SAME_SITE_VALUES.has(input.sameSite as ContinuityCookieSameSite) ||
    typeof input.expirationDate !== 'number' ||
    !Number.isFinite(input.expirationDate) ||
    input.expirationDate <= 0
  ) {
    invalid();
  }
  const change: ContinuityCookieUpsert = {
    identity: normalizeContinuityCookieIdentity(input.identity),
    kind: 'upsert',
    value: input.value,
    secure: input.secure,
    httpOnly: input.httpOnly,
    sameSite: input.sameSite as ContinuityCookieSameSite,
    expirationDate: input.expirationDate,
  };
  if (serializedContinuityItemBytes(change) > PROFILE_CONTINUITY_ITEM_MAX_BYTES)
    invalid();
  return change;
}

export function parseContinuityCookieRecord(
  input: unknown,
): ContinuityCookieRecord {
  if (!isRecord(input) || !isSafeRevision(input.revision)) invalid();
  const changeInput = { ...input };
  delete changeInput.revision;
  const change = parseContinuityCookieChange(changeInput);
  const record = { ...change, revision: input.revision } as ContinuityCookieRecord;
  if (serializedContinuityItemBytes(record) > PROFILE_CONTINUITY_ITEM_MAX_BYTES)
    invalid();
  return record;
}

export function parseContinuityOperation(input: unknown): ContinuityOperation {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'deviceId',
      'operationId',
      'profileEpoch',
      'baseRevision',
      'change',
    ]) ||
    !isDeviceId(input.deviceId) ||
    typeof input.operationId !== 'string' ||
    !UUID_RE.test(input.operationId) ||
    !isSafeRevision(input.profileEpoch) ||
    !isSafeRevision(input.baseRevision)
  ) {
    invalid();
  }
  return {
    deviceId: input.deviceId,
    operationId: input.operationId,
    profileEpoch: input.profileEpoch,
    baseRevision: input.baseRevision,
    change: parseContinuityCookieChange(input.change),
  };
}

export function parseContinuityPullRequest(
  input: unknown,
): ContinuityPullRequest {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['fromRevision', 'pageBytes']) ||
    !isSafeRevision(input.fromRevision) ||
    !Number.isSafeInteger(input.pageBytes) ||
    (input.pageBytes as number) <= 0 ||
    (input.pageBytes as number) > PROFILE_CONTINUITY_PAGE_MAX_BYTES
  ) {
    invalid();
  }
  return {
    fromRevision: input.fromRevision,
    pageBytes: input.pageBytes as number,
  };
}

export function parseProfileRetireRequest(input: unknown): ProfileRetireRequest {
  if (
    !isRecord(input) ||
    typeof input.operationId !== 'string' ||
    !UUID_RE.test(input.operationId) ||
    !isSafeRevision(input.expectedEpoch)
  ) {
    invalid();
  }
  if (
    input.kind === 'deleted' &&
    hasExactKeys(input, ['operationId', 'expectedEpoch', 'kind'])
  ) {
    return {
      operationId: input.operationId,
      expectedEpoch: input.expectedEpoch,
      kind: 'deleted',
    };
  }
  if (
    input.kind === 'moved' &&
    (input.movedTo === 'remote' || input.movedTo === 'local') &&
    hasExactKeys(input, [
      'operationId',
      'expectedEpoch',
      'kind',
      'movedTo',
    ])
  ) {
    return {
      operationId: input.operationId,
      expectedEpoch: input.expectedEpoch,
      kind: 'moved',
      movedTo: input.movedTo,
    };
  }
  return invalid();
}

function parseOperationId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) invalid();
  return value;
}

function parseNonce(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 22 ||
    value.length > 86 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    invalid();
  }
  return value;
}

export function parseContinuityPage(input: unknown): ContinuityPage {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'profileId',
      'epoch',
      'fromRevision',
      'records',
      'nextRevision',
      'hasMore',
    ]) ||
    typeof input.profileId !== 'string' ||
    !/^(?:default|[0-9a-f]{32})$/.test(input.profileId) ||
    !isSafeRevision(input.epoch) ||
    !isSafeRevision(input.fromRevision) ||
    !Array.isArray(input.records) ||
    !isSafeRevision(input.nextRevision) ||
    input.nextRevision < input.fromRevision ||
    typeof input.hasMore !== 'boolean'
  ) {
    invalid();
  }
  const records = input.records.map(parseContinuityCookieRecord);
  let revision = input.fromRevision;
  for (const record of records) {
    if (record.revision <= revision || record.revision > input.nextRevision)
      invalid();
    revision = record.revision;
  }
  const page: ContinuityPage = {
    profileId: input.profileId,
    epoch: input.epoch,
    fromRevision: input.fromRevision,
    records,
    nextRevision: input.nextRevision,
    hasMore: input.hasMore,
  };
  if (serializedContinuityItemBytes(page) > PROFILE_CONTINUITY_PAGE_MAX_BYTES)
    invalid();
  return page;
}

export function parseContinuityMigrationStageRequest(
  input: unknown,
): ContinuityMigrationStageRequest {
  if (!isRecord(input) || !hasExactKeys(input, ['operationId', 'page']))
    invalid();
  return {
    operationId: parseOperationId(input.operationId),
    page: parseContinuityPage(input.page),
  };
}

export function parseContinuityMigrationVerifyRequest(
  input: unknown,
): ContinuityMigrationVerifyRequest {
  if (!isRecord(input) || !hasExactKeys(input, ['operationId', 'nonce']))
    invalid();
  return {
    operationId: parseOperationId(input.operationId),
    nonce: parseNonce(input.nonce),
  };
}

export function parseContinuityMigrationFreezeRequest(
  input: unknown,
): ContinuityMigrationFreezeRequest {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['operationId', 'expectedEpoch', 'nonce']) ||
    !isSafeRevision(input.expectedEpoch)
  ) {
    invalid();
  }
  return {
    operationId: parseOperationId(input.operationId),
    expectedEpoch: input.expectedEpoch,
    nonce: parseNonce(input.nonce),
  };
}

export function parseContinuityMigrationPublishRequest(
  input: unknown,
): ContinuityMigrationPublishRequest {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'operationId',
      'expectedRevision',
      'verifiedDigest',
    ]) ||
    !isSafeRevision(input.expectedRevision) ||
    typeof input.verifiedDigest !== 'string' ||
    !BASE64URL_32_BYTES_RE.test(input.verifiedDigest)
  ) {
    invalid();
  }
  return {
    operationId: parseOperationId(input.operationId),
    expectedRevision: input.expectedRevision,
    verifiedDigest: input.verifiedDigest,
  };
}

export function parseContinuityMigrationActivateRequest(
  input: unknown,
): ContinuityMigrationActivateRequest {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['operationId', 'epoch']) ||
    !isSafeRevision(input.epoch) ||
    input.epoch === 0
  ) {
    invalid();
  }
  return {
    operationId: parseOperationId(input.operationId),
    epoch: input.epoch,
  };
}

export function parseContinuityMigrationDiscardRequest(
  input: unknown,
): ContinuityMigrationDiscardRequest {
  if (!isRecord(input) || !hasExactKeys(input, ['operationId'])) invalid();
  return { operationId: parseOperationId(input.operationId) };
}
