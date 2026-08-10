import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BROWSER_PROFILE_DELETION_ERROR_CODES,
  DEFAULT_PROFILE_ID,
  PROFILE_ID_RE,
  type BrowserProfile,
} from '../shared/browserProfile';
import {
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_USERNAME_LENGTH,
  type PasswordCredentialMetadata,
  type PasswordMetadataQuery,
} from '../shared/passwordVault';
import {
  PROFILE_CONTINUITY_ITEM_MAX_BYTES,
  PROFILE_CONTINUITY_PAGE_MAX_BYTES,
  PROFILE_CONTINUITY_VERSION,
  type ContinuityMigrationDiscardResult,
  type ContinuityMigrationFreezeResult,
  type ContinuityMigrationStageResult,
  type ContinuityMigrationVerifyResult,
  type ContinuityOperationResult,
  type ContinuityPage,
  type ProfileContinuityLifecycleResult,
  type ProfileRetireResult,
  type RemoteProfileDiscoverySummary,
} from '../shared/profileContinuity';
import {
  REMOTE_PROFILE_BUNDLE_VERSION,
  REMOTE_PROFILE_RPC_VERSION,
  type DecryptedProfileCredential,
  type ProfileBundleV1,
  type RemoteProfileDescription,
} from '../shared/remoteProfileStore';
import {
  ProfileContinuityStore,
  ProfileContinuityStoreError,
} from './profileContinuityStore';
import {
  RemoteProfileCrypto,
  RemoteProfileStoreError,
  atomicWritePrivateFile,
  deletePrivateFile,
  ensurePrivateDirectory,
  readPrivateFile,
} from './remoteProfileCrypto';

const GRANTS_VERSION = 1 as const;
const GRANT_TTL_MS = 10 * 60 * 1_000;
const MAX_QUERY_LENGTH = 4_096;
const MAX_PROFILE_NAME_LENGTH = 100;
const MAX_USER_AGENT_LENGTH = 1_024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_32_BYTES_RE = /^[A-Za-z0-9_-]{43}$/;

interface GrantV1 {
  clientId: string;
  profileId: string;
  generation: string;
  capabilityHash: string;
  expiresAt: number;
}

interface GrantsDocumentV1 {
  version: typeof GRANTS_VERSION;
  grants: GrantV1[];
}

export interface RemoteProfileGrant {
  capability: string;
  expiresAt: number;
}

export interface RemoteProfileAuthorization {
  clientId: string;
  profileId: string;
  generation: string;
  capability: string;
}

export interface RemoteProfileStoreDeps {
  /** Absolute ~/.termpro-host equivalent; the store appends profile-store/. */
  dataDir: string;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isRemoteProfileId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === DEFAULT_PROFILE_ID || PROFILE_ID_RE.test(value))
  );
}

export function isRemoteProfileOperationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isRemoteProfileClientId(value: unknown): value is string {
  if (typeof value !== 'string' || !BASE64URL_32_BYTES_RE.test(value))
    return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length === 32 && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
}

export function isRemoteProfileGeneration(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

export function isRemoteProfileEntryId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isCanonicalHttpOrigin(value: unknown): value is string {
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

function parseProfile(raw: unknown, expectedProfileId: string): BrowserProfile {
  if (
    !isRecord(raw) ||
    !hasOnlyKeys(raw, [
      'id',
      'name',
      'userAgent',
      'createdAt',
      'deletionState',
      'deletionErrorCode',
      'deletionUpdatedAt',
    ])
  ) {
    throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
  }
  if (raw.id !== expectedProfileId) {
    throw new RemoteProfileStoreError('PROFILE_RPC_PROFILE_MISMATCH');
  }
  if (
    !isRemoteProfileId(raw.id) ||
    typeof raw.name !== 'string' ||
    raw.name.trim() !== raw.name ||
    raw.name.length === 0 ||
    raw.name.length > MAX_PROFILE_NAME_LENGTH ||
    !isTimestamp(raw.createdAt) ||
    (raw.userAgent !== undefined &&
      (typeof raw.userAgent !== 'string' ||
        raw.userAgent.length === 0 ||
        raw.userAgent.length > MAX_USER_AGENT_LENGTH)) ||
    (raw.deletionState !== undefined &&
      raw.deletionState !== 'deleting' &&
      raw.deletionState !== 'delete_failed') ||
    (raw.deletionUpdatedAt !== undefined &&
      !isTimestamp(raw.deletionUpdatedAt)) ||
    (raw.deletionErrorCode !== undefined &&
      !(
        Object.values(BROWSER_PROFILE_DELETION_ERROR_CODES) as string[]
      ).includes(raw.deletionErrorCode as string))
  ) {
    throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
  }
  return {
    id: raw.id,
    name: raw.name,
    ...(typeof raw.userAgent === 'string' ? { userAgent: raw.userAgent } : {}),
    createdAt: raw.createdAt,
    ...(raw.deletionState === 'deleting' ||
    raw.deletionState === 'delete_failed'
      ? { deletionState: raw.deletionState }
      : {}),
    ...(typeof raw.deletionErrorCode === 'string'
      ? {
          deletionErrorCode:
            raw.deletionErrorCode as BrowserProfile['deletionErrorCode'],
        }
      : {}),
    ...(typeof raw.deletionUpdatedAt === 'number'
      ? { deletionUpdatedAt: raw.deletionUpdatedAt }
      : {}),
  };
}

function parseCredential(
  raw: unknown,
  expectedProfileId: string,
): DecryptedProfileCredential {
  if (
    !isRecord(raw) ||
    !hasOnlyKeys(raw, [
      'id',
      'profileId',
      'origin',
      'username',
      'password',
      'createdAt',
      'updatedAt',
      'lastUsedAt',
    ])
  ) {
    throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
  }
  if (raw.profileId !== expectedProfileId) {
    throw new RemoteProfileStoreError('PROFILE_RPC_PROFILE_MISMATCH');
  }
  if (
    !isRemoteProfileEntryId(raw.id) ||
    !isCanonicalHttpOrigin(raw.origin) ||
    typeof raw.username !== 'string' ||
    raw.username.trim() !== raw.username ||
    raw.username.length === 0 ||
    raw.username.length > MAX_PASSWORD_USERNAME_LENGTH ||
    typeof raw.password !== 'string' ||
    raw.password.length === 0 ||
    raw.password.length > MAX_PASSWORD_LENGTH ||
    !isTimestamp(raw.createdAt) ||
    !isTimestamp(raw.updatedAt) ||
    !isTimestamp(raw.lastUsedAt) ||
    raw.updatedAt < raw.createdAt ||
    raw.lastUsedAt < raw.updatedAt
  ) {
    throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
  }
  return {
    id: raw.id,
    profileId: expectedProfileId,
    origin: raw.origin,
    username: raw.username,
    password: raw.password,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastUsedAt: raw.lastUsedAt,
  };
}

export function parseRemoteProfileBundle(
  raw: unknown,
  expectedProfileId: string,
): ProfileBundleV1 {
  if (
    !isRecord(raw) ||
    !hasOnlyKeys(raw, ['version', 'profile', 'credentials']) ||
    raw.version !== REMOTE_PROFILE_BUNDLE_VERSION ||
    !Array.isArray(raw.credentials)
  ) {
    throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
  }
  const profile = parseProfile(raw.profile, expectedProfileId);
  const credentials = raw.credentials.map((credential) =>
    parseCredential(credential, expectedProfileId),
  );
  const ids = new Set<string>();
  const accounts = new Set<string>();
  for (const credential of credentials) {
    const account = `${credential.origin}\0${credential.username}`;
    if (ids.has(credential.id) || accounts.has(account)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
    }
    ids.add(credential.id);
    accounts.add(account);
  }
  return { version: REMOTE_PROFILE_BUNDLE_VERSION, profile, credentials };
}

function metadataOf(
  credential: DecryptedProfileCredential,
): PasswordCredentialMetadata {
  return {
    id: credential.id,
    profileId: credential.profileId,
    origin: credential.origin,
    username: credential.username,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    lastUsedAt: credential.lastUsedAt,
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

function safeHash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Deterministic JSON for source/target migration verification across adapters. */
export function canonicalRemoteProfileJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalRemoteProfileJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalRemoteProfileJson(record[key])}`,
    )
    .join(',')}}`;
}

export class RemoteProfileStore {
  readonly rootDirectory: string;
  readonly profilesDirectory: string;
  readonly stagingDirectory: string;
  readonly continuityDirectory: string;
  readonly grantsPath: string;

  private readonly now: () => number;
  private readonly crypto: RemoteProfileCrypto;
  private readonly continuity: ProfileContinuityStore;

  constructor(deps: RemoteProfileStoreDeps) {
    if (!path.isAbsolute(deps.dataDir)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    this.rootDirectory = path.join(deps.dataDir, 'profile-store');
    this.profilesDirectory = path.join(this.rootDirectory, 'profiles');
    this.stagingDirectory = path.join(this.rootDirectory, 'staging');
    this.continuityDirectory = path.join(this.rootDirectory, 'continuity');
    this.grantsPath = path.join(this.rootDirectory, 'grants.json');
    this.now = deps.now ?? Date.now;
    ensurePrivateDirectory(this.rootDirectory);
    ensurePrivateDirectory(this.profilesDirectory);
    ensurePrivateDirectory(this.stagingDirectory);
    this.crypto = new RemoteProfileCrypto(this.rootDirectory, () =>
      this.hasCiphertext(),
    );
    this.continuity = new ProfileContinuityStore({
      rootDirectory: this.rootDirectory,
      now: this.now,
    });
  }

  describe(): RemoteProfileDescription {
    return {
      protocolVersion: REMOTE_PROFILE_RPC_VERSION,
      bundleVersion: REMOTE_PROFILE_BUNDLE_VERSION,
      encryption: 'aes-256-gcm',
      continuity: {
        version: PROFILE_CONTINUITY_VERSION,
        pageMaxBytes: PROFILE_CONTINUITY_PAGE_MAX_BYTES,
        itemMaxBytes: PROFILE_CONTINUITY_ITEM_MAX_BYTES,
      },
    };
  }

  discoverProfiles(
    clientId: string,
    generation: string,
  ): RemoteProfileDiscoverySummary[] {
    if (
      !isRemoteProfileClientId(clientId) ||
      !isRemoteProfileGeneration(generation)
    ) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.profilesDirectory, {
        withFileTypes: true,
      });
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
      }
      return [];
    }
    const summaries: RemoteProfileDiscoverySummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json'))
        continue;
      const profileId = entry.name.slice(0, -'.json'.length);
      if (!isRemoteProfileId(profileId)) continue;
      const lifecycle = this.continuity.lifecycle(profileId);
      if (lifecycle.lifecycle !== 'active') continue;
      const profile = this.readBundle(profileId).profile;
      summaries.push({
        profileId,
        name: profile.name,
        createdAt: profile.createdAt,
        epoch: lifecycle.epoch,
      });
    }
    return summaries.sort(
      (left, right) =>
        left.createdAt - right.createdAt ||
        left.profileId.localeCompare(right.profileId),
    );
  }

  issueGrant(
    clientId: string,
    profileId: string,
    generation: string,
  ): RemoteProfileGrant {
    if (
      !isRemoteProfileClientId(clientId) ||
      !isRemoteProfileId(profileId) ||
      !isRemoteProfileGeneration(generation)
    ) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const now = this.now();
    if (!isTimestamp(now))
      throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
    const capability = randomBytes(32).toString('base64url');
    const expiresAt = now + GRANT_TTL_MS;
    const document = this.readGrants();
    const grants = document.grants.filter(
      (grant) =>
        grant.expiresAt > now &&
        !(grant.clientId === clientId && grant.profileId === profileId),
    );
    grants.push({
      clientId,
      profileId,
      generation,
      capabilityHash: safeHash(capability).toString('base64url'),
      expiresAt,
    });
    this.writeGrants({ version: GRANTS_VERSION, grants });
    return { capability, expiresAt };
  }

  authorize(input: RemoteProfileAuthorization): boolean {
    if (
      !isRemoteProfileClientId(input.clientId) ||
      !isRemoteProfileId(input.profileId) ||
      !isRemoteProfileGeneration(input.generation) ||
      typeof input.capability !== 'string'
    ) {
      return false;
    }
    const now = this.now();
    const providedHash = safeHash(input.capability);
    const grant = this.readGrants().grants.find(
      (candidate) =>
        candidate.clientId === input.clientId &&
        candidate.profileId === input.profileId,
    );
    const expectedHash = grant
      ? Buffer.from(grant.capabilityHash, 'base64url')
      : Buffer.alloc(32);
    const hashMatches = timingSafeEqual(providedHash, expectedHash);
    return Boolean(
      grant &&
      grant.expiresAt > now &&
      grant.generation === input.generation &&
      hashMatches,
    );
  }

  revokeGrant(clientId: string, profileId: string): void {
    const document = this.readGrants();
    const grants = document.grants.filter(
      (grant) =>
        !(grant.clientId === clientId && grant.profileId === profileId),
    );
    if (grants.length !== document.grants.length) {
      this.writeGrants({ version: GRANTS_VERSION, grants });
    }
  }

  getProfile(profileId: string): BrowserProfile {
    this.continuity.assertActive(profileId);
    return this.readBundle(profileId).profile;
  }

  saveProfile(profileId: string, profile: unknown): BrowserProfile {
    this.continuity.assertActive(profileId);
    let parsedProfile: BrowserProfile;
    try {
      parsedProfile = parseProfile(profile, profileId);
    } catch (error) {
      if (
        error instanceof RemoteProfileStoreError &&
        error.code === 'PROFILE_RPC_CORRUPT'
      ) {
        throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      throw error;
    }
    let current: ProfileBundleV1;
    try {
      current = this.readBundle(profileId);
    } catch (error) {
      if (
        !(error instanceof RemoteProfileStoreError) ||
        error.code !== 'PROFILE_RPC_NOT_FOUND'
      ) {
        throw error;
      }
      current = {
        version: REMOTE_PROFILE_BUNDLE_VERSION,
        profile: parsedProfile,
        credentials: [],
      };
    }
    this.writeBundle(profileId, { ...current, profile: parsedProfile });
    return parsedProfile;
  }

  listVault(
    profileId: string,
    query: PasswordMetadataQuery = {},
  ): PasswordCredentialMetadata[] {
    this.continuity.assertActive(profileId);
    if (!isRecord(query) || !hasOnlyKeys(query, ['profileId', 'query'])) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    if (query.profileId !== undefined && query.profileId !== profileId) {
      throw new RemoteProfileStoreError('PROFILE_RPC_PROFILE_MISMATCH');
    }
    if (query.query !== undefined && typeof query.query !== 'string') {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const normalized = (query.query ?? '').trim().toLowerCase();
    if (normalized.length > MAX_QUERY_LENGTH) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const entries = this.readBundle(profileId).credentials.map(metadataOf);
    const filtered = normalized
      ? entries.filter((entry) =>
          `${entry.profileId}\n${entry.origin}\n${entry.username}`
            .toLowerCase()
            .includes(normalized),
        )
      : entries;
    return sortByRecent(filtered);
  }

  lookupVault(profileId: string, origin: string): DecryptedProfileCredential[] {
    this.continuity.assertActive(profileId);
    if (!isCanonicalHttpOrigin(origin)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    return sortByRecent(
      this.readBundle(profileId).credentials.filter(
        (entry) => entry.origin === origin,
      ),
    );
  }

  getVaultEntry(profileId: string, id: string): DecryptedProfileCredential {
    this.continuity.assertActive(profileId);
    if (!isRemoteProfileEntryId(id)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const entry = this.readBundle(profileId).credentials.find(
      (candidate) => candidate.id === id,
    );
    if (!entry) throw new RemoteProfileStoreError('PROFILE_RPC_NOT_FOUND');
    return entry;
  }

  upsertVault(
    profileId: string,
    input: {
      origin: unknown;
      username: unknown;
      password: unknown;
      now?: unknown;
    },
  ): { kind: 'saved' | 'updated'; metadata: PasswordCredentialMetadata } {
    this.continuity.assertActive(profileId);
    if (
      !isCanonicalHttpOrigin(input.origin) ||
      typeof input.username !== 'string' ||
      input.username.trim().length === 0 ||
      input.username.trim().length > MAX_PASSWORD_USERNAME_LENGTH ||
      typeof input.password !== 'string' ||
      input.password.length === 0 ||
      input.password.length > MAX_PASSWORD_LENGTH ||
      (input.now !== undefined && !isTimestamp(input.now))
    ) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const username = input.username.trim();
    const password = input.password;
    const now = input.now ?? this.now();
    const bundle = this.readBundle(profileId);
    const index = bundle.credentials.findIndex(
      (entry) => entry.origin === input.origin && entry.username === username,
    );
    let kind: 'saved' | 'updated';
    let credential: DecryptedProfileCredential;
    if (index >= 0) {
      const existing = bundle.credentials[index];
      const effectiveNow = Math.max(
        now,
        existing.updatedAt,
        existing.lastUsedAt,
      );
      credential = {
        ...existing,
        password,
        updatedAt:
          existing.password === password ? existing.updatedAt : effectiveNow,
        lastUsedAt: effectiveNow,
      };
      bundle.credentials[index] = credential;
      kind = 'updated';
    } else {
      credential = {
        id: randomUUID(),
        profileId,
        origin: input.origin,
        username,
        password,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
      };
      bundle.credentials.push(credential);
      kind = 'saved';
    }
    this.writeBundle(profileId, bundle);
    return { kind, metadata: metadataOf(credential) };
  }

  deleteVaultEntry(profileId: string, id: string): boolean {
    this.continuity.assertActive(profileId);
    if (!isRemoteProfileEntryId(id)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const bundle = this.readBundle(profileId);
    const credentials = bundle.credentials.filter((entry) => entry.id !== id);
    if (credentials.length === bundle.credentials.length) return false;
    this.writeBundle(profileId, { ...bundle, credentials });
    return true;
  }

  exportBundle(profileId: string): ProfileBundleV1 {
    this.continuity.assertActive(profileId);
    return this.readBundle(profileId);
  }

  stageMigration(
    operationId: string,
    profileId: string,
    bundle: unknown,
  ): void {
    this.continuity.assertActive(profileId);
    if (!isRemoteProfileOperationId(operationId)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    let parsed: ProfileBundleV1;
    try {
      parsed = parseRemoteProfileBundle(bundle, profileId);
    } catch (error) {
      if (
        error instanceof RemoteProfileStoreError &&
        error.code === 'PROFILE_RPC_CORRUPT'
      ) {
        throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
      }
      throw error;
    }
    ensurePrivateDirectory(this.stagingDirectory);
    atomicWritePrivateFile(
      this.stagingPath(operationId),
      this.crypto.encrypt(profileId, parsed),
    );
  }

  verifyMigration(
    operationId: string,
    profileId: string,
    nonce: string,
  ): string {
    this.continuity.assertActive(profileId);
    if (!isRemoteProfileOperationId(operationId)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    let nonceBytes: Buffer;
    try {
      nonceBytes = Buffer.from(nonce, 'base64url');
    } catch {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    if (
      !nonce ||
      nonceBytes.length < 16 ||
      nonceBytes.length > 64 ||
      nonceBytes.toString('base64url') !== nonce
    ) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const bundle = this.readStagedBundle(operationId, profileId);
    return createHmac('sha256', nonceBytes)
      .update(canonicalRemoteProfileJson(bundle), 'utf8')
      .digest('base64url');
  }

  publishMigration(operationId: string, profileId: string): void {
    if (!isRemoteProfileOperationId(operationId)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    this.continuity.assertBundlePublishAllowed(profileId, operationId);
    const stagedFile = this.stagingPath(operationId);
    const serialized = readPrivateFile(stagedFile);
    if (!serialized) {
      // Switching retries after the first atomic publish are idempotent while
      // the matching continuity target remains prepared.
      this.readBundle(profileId);
      return;
    }
    // Decrypt before publish so corrupt/mis-scoped staging can never become live.
    parseRemoteProfileBundle(
      this.crypto.decrypt(profileId, serialized.toString('utf8')),
      profileId,
    );
    ensurePrivateDirectory(this.profilesDirectory);
    atomicWritePrivateFile(this.profilePath(profileId), serialized);
    try {
      this.continuity.assertBundlePublishAllowed(profileId, operationId);
    } catch (error) {
      deletePrivateFile(this.profilePath(profileId));
      throw error;
    }
    deletePrivateFile(stagedFile);
  }

  discardMigration(operationId: string, profileId: string): boolean {
    if (!isRemoteProfileOperationId(operationId)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    // Authenticate the staged bundle's profile-bound AAD before deletion so a
    // capability for one profile cannot discard another profile's operation.
    this.readStagedBundle(operationId, profileId);
    return deletePrivateFile(this.stagingPath(operationId));
  }

  getProfileLifecycle(profileId: string): ProfileContinuityLifecycleResult {
    const lifecycle = this.continuity.lifecycle(profileId);
    if (lifecycle.lifecycle === 'active') this.readBundle(profileId);
    return lifecycle;
  }

  pullContinuity(profileId: string, input: unknown): ContinuityPage {
    // A grant for a not-yet-created migration target cannot manufacture a
    // Cookie authority without the strict v1 Profile bundle.
    this.readBundle(profileId);
    return this.continuity.pull(profileId, input);
  }

  pushContinuity(profileId: string, input: unknown): ContinuityOperationResult {
    this.continuity.assertActive(profileId);
    this.readBundle(profileId);
    return this.continuity.push(profileId, input);
  }

  stageContinuityMigration(
    profileId: string,
    input: unknown,
  ): ContinuityMigrationStageResult {
    if (
      !this.continuity.hasDocument(profileId) &&
      readPrivateFile(this.profilePath(profileId))
    ) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    return this.continuity.stageMigration(profileId, input);
  }

  verifyContinuityMigration(
    profileId: string,
    input: unknown,
  ): ContinuityMigrationVerifyResult {
    return this.continuity.verifyMigration(profileId, input);
  }

  freezeContinuityMigration(
    profileId: string,
    input: unknown,
  ): ContinuityMigrationFreezeResult {
    this.readBundle(profileId);
    return this.continuity.freezeMigration(profileId, input);
  }

  publishContinuityMigration(
    profileId: string,
    input: unknown,
  ): ContinuityMigrationFreezeResult {
    return this.continuity.publishMigration(profileId, input);
  }

  activateContinuityMigration(
    profileId: string,
    input: unknown,
  ): ProfileContinuityLifecycleResult {
    this.readBundle(profileId);
    return this.continuity.activateMigration(profileId, input);
  }

  discardContinuityMigration(
    profileId: string,
    input: unknown,
  ): ContinuityMigrationDiscardResult {
    const result = this.continuity.discardContinuityMigration(profileId, input);
    if (result.role === 'target') {
      deletePrivateFile(this.profilePath(profileId));
      this.continuity.finalizeTargetMigrationDiscard(
        profileId,
        result.operationId,
      );
    }
    return result;
  }

  retireProfile(profileId: string, input: unknown): ProfileRetireResult {
    const lifecycle = this.continuity.lifecycle(profileId);
    if (lifecycle.lifecycle === 'active') this.readBundle(profileId);
    const result = this.continuity.retire(profileId, input);
    // The epoch is durable before either physical plane is cleaned. A failure
    // here leaves a retryable retired document and never restores authority.
    deletePrivateFile(this.profilePath(profileId));
    this.continuity.finalizeRetire(profileId, result.operationId);
    return result;
  }

  deleteProfile(profileId: string): boolean {
    if (!isRemoteProfileId(profileId)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    if (this.continuity.hasDocument(profileId)) {
      throw new ProfileContinuityStoreError(
        'PROFILE_CONTINUITY_LEGACY_DELETE_FORBIDDEN',
      );
    }
    // Revoke first. If bundle cleanup subsequently fails, no previously
    // issued client can keep reading the profile during delete_failed recovery.
    const grants = this.readGrants();
    const retained = grants.grants.filter(
      (grant) => grant.profileId !== profileId,
    );
    if (retained.length !== grants.grants.length) {
      this.writeGrants({ version: GRANTS_VERSION, grants: retained });
    }
    return deletePrivateFile(this.profilePath(profileId));
  }

  private profilePath(profileId: string): string {
    return path.join(this.profilesDirectory, `${profileId}.json`);
  }

  private stagingPath(operationId: string): string {
    return path.join(this.stagingDirectory, `${operationId}.json`);
  }

  private readBundle(profileId: string): ProfileBundleV1 {
    if (!isRemoteProfileId(profileId)) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    const serialized = readPrivateFile(this.profilePath(profileId));
    if (!serialized) throw new RemoteProfileStoreError('PROFILE_RPC_NOT_FOUND');
    return parseRemoteProfileBundle(
      this.crypto.decrypt(profileId, serialized.toString('utf8')),
      profileId,
    );
  }

  private readStagedBundle(
    operationId: string,
    profileId: string,
  ): ProfileBundleV1 {
    const serialized = readPrivateFile(this.stagingPath(operationId));
    if (!serialized) throw new RemoteProfileStoreError('PROFILE_RPC_NOT_FOUND');
    return parseRemoteProfileBundle(
      this.crypto.decrypt(profileId, serialized.toString('utf8')),
      profileId,
    );
  }

  private writeBundle(profileId: string, bundle: ProfileBundleV1): void {
    const parsed = parseRemoteProfileBundle(bundle, profileId);
    this.continuity.assertActive(profileId);
    ensurePrivateDirectory(this.profilesDirectory);
    atomicWritePrivateFile(
      this.profilePath(profileId),
      this.crypto.encrypt(profileId, parsed),
    );
    try {
      this.continuity.assertActive(profileId);
    } catch (error) {
      deletePrivateFile(this.profilePath(profileId));
      throw error;
    }
  }

  private hasCiphertext(): boolean {
    for (const directory of [
      this.profilesDirectory,
      this.stagingDirectory,
      this.continuityDirectory,
      this.continuity.migrationDirectory,
    ]) {
      try {
        if (
          fs
            .readdirSync(directory, { withFileTypes: true })
            .some((entry) => entry.isFile())
        ) {
          return true;
        }
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
        }
      }
    }
    return false;
  }

  private readGrants(): GrantsDocumentV1 {
    const serialized = readPrivateFile(this.grantsPath);
    if (!serialized) return { version: GRANTS_VERSION, grants: [] };
    let raw: unknown;
    try {
      raw = JSON.parse(serialized.toString('utf8'));
    } catch {
      throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
    }
    if (
      !isRecord(raw) ||
      Object.keys(raw).sort().join(',') !== 'grants,version' ||
      raw.version !== GRANTS_VERSION ||
      !Array.isArray(raw.grants)
    ) {
      throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
    }
    const grants: GrantV1[] = [];
    const scopes = new Set<string>();
    for (const candidate of raw.grants) {
      if (
        !isRecord(candidate) ||
        Object.keys(candidate).sort().join(',') !==
          'capabilityHash,clientId,expiresAt,generation,profileId' ||
        !isRemoteProfileClientId(candidate.clientId) ||
        !isRemoteProfileId(candidate.profileId) ||
        !isRemoteProfileGeneration(candidate.generation) ||
        !isTimestamp(candidate.expiresAt) ||
        typeof candidate.capabilityHash !== 'string'
      ) {
        throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
      }
      const decodedHash = Buffer.from(candidate.capabilityHash, 'base64url');
      if (
        decodedHash.length !== 32 ||
        decodedHash.toString('base64url') !== candidate.capabilityHash
      ) {
        throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
      }
      const scope = `${candidate.clientId}\0${candidate.profileId}`;
      if (scopes.has(scope))
        throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
      scopes.add(scope);
      grants.push({
        clientId: candidate.clientId,
        profileId: candidate.profileId,
        generation: candidate.generation,
        capabilityHash: candidate.capabilityHash,
        expiresAt: candidate.expiresAt,
      });
    }
    return { version: GRANTS_VERSION, grants };
  }

  private writeGrants(document: GrantsDocumentV1): void {
    ensurePrivateDirectory(this.rootDirectory);
    atomicWritePrivateFile(this.grantsPath, JSON.stringify(document));
  }
}
