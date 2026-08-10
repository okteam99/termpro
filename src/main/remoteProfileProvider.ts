import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PROFILE_ID,
  PROFILE_ID_RE,
  type BrowserProfile,
  type BrowserProfileInput,
  type ProfileStorageErrorCode,
  type ProfileStorageRef,
} from '../shared/browserProfile';
import type {
  PasswordCredentialMetadata,
  PasswordMetadataQuery,
} from '../shared/passwordVault';
import {
  REMOTE_PROFILE_BUNDLE_VERSION,
  REMOTE_PROFILE_RPC_VERSION,
  type DecryptedProfileCredential,
  type ProfileBundleV1,
  type RemoteProfileDescription,
  type RemoteProfileGrantResult,
  type RemoteProfileRpcOperation,
  type RemoteProfileRpcRequest,
  type RemoteProfileRpcResponse,
} from '../shared/remoteProfileStore';
import type {
  PasswordUpsertInput,
  PasswordUpsertResult,
  ProfileDataProvider,
} from './profileAuthorityService';

const GRANT_RENEWAL_WINDOW_MS = 2 * 60_000;

/** Structural twin of the main-only port exposed by RemoteOrchestrator. */
export interface RemoteProfileTransportPort {
  readonly hostId: string;
  readonly generation: string;
  invoke(request: RemoteProfileRpcRequest): Promise<RemoteProfileRpcResponse>;
}

export class RemoteProfileProviderError extends Error {
  constructor(readonly code: ProfileStorageErrorCode) {
    super(code);
    this.name = 'RemoteProfileProviderError';
  }
}

export interface RemoteProfileProviderDeps {
  hostId: string;
  clientId: string;
  getTransport: (hostId: string) => RemoteProfileTransportPort | null;
  now?: () => number;
  newRequestId?: () => string;
  logger?: { warn(message: string): void; error(message: string): void };
}

interface CapabilityLease {
  profileId: string;
  generation: string;
  capability: string;
  expiresAt: number;
}

interface OperationScope {
  profileId: string;
  generation: string;
}

function isProfileId(value: unknown): value is string {
  return (
    value === DEFAULT_PROFILE_ID ||
    (typeof value === 'string' && PROFILE_ID_RE.test(value))
  );
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validMetadata(
  value: unknown,
  profileId: string,
): value is PasswordCredentialMetadata {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<PasswordCredentialMetadata>;
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    entry.profileId === profileId &&
    typeof entry.origin === 'string' &&
    entry.origin.length > 0 &&
    typeof entry.username === 'string' &&
    isFiniteTimestamp(entry.createdAt) &&
    isFiniteTimestamp(entry.updatedAt) &&
    isFiniteTimestamp(entry.lastUsedAt)
  );
}

function validProfile(
  value: unknown,
  profileId: string,
): value is BrowserProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<BrowserProfile>;
  return (
    profile.id === profileId &&
    isProfileId(profile.id) &&
    typeof profile.name === 'string' &&
    profile.name.trim().length > 0 &&
    profile.name.length <= 100 &&
    (profile.userAgent === undefined ||
      (typeof profile.userAgent === 'string' &&
        profile.userAgent.length <= 1024)) &&
    isFiniteTimestamp(profile.createdAt)
  );
}

function validCredential(
  value: unknown,
  profileId: string,
): value is DecryptedProfileCredential {
  return (
    validMetadata(value, profileId) &&
    typeof (value as Partial<DecryptedProfileCredential>).password === 'string'
  );
}

function validBundle(
  value: unknown,
  profileId: string,
): value is ProfileBundleV1 {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Partial<ProfileBundleV1>;
  return (
    bundle.version === REMOTE_PROFILE_BUNDLE_VERSION &&
    validProfile(bundle.profile, profileId) &&
    Array.isArray(bundle.credentials) &&
    bundle.credentials.every((credential) =>
      validCredential(credential, profileId),
    )
  );
}

function transportFailureCode(error: unknown): ProfileStorageErrorCode {
  switch ((error as { code?: unknown } | null)?.code) {
    case 'timeout':
      return 'PROFILE_STORAGE_TIMEOUT';
    case 'offline':
    case 'stale':
      return 'PROFILE_STORAGE_OFFLINE';
    case 'invalid_response':
    default:
      return 'PROFILE_STORAGE_IO_FAILED';
  }
}

function responseFailureCode(code: string): ProfileStorageErrorCode {
  switch (code) {
    case 'PROFILE_RPC_FORBIDDEN':
      return 'PROFILE_STORAGE_FORBIDDEN';
    case 'PROFILE_RPC_INVALID_INPUT':
      return 'PROFILE_STORAGE_INVALID_INPUT';
    case 'PROFILE_RPC_INCOMPATIBLE':
      return 'PROFILE_STORAGE_INCOMPATIBLE';
    case 'PROFILE_RPC_ENCRYPTION_UNAVAILABLE':
      return 'PROFILE_STORAGE_ENCRYPTION_UNAVAILABLE';
    case 'PROFILE_RPC_CORRUPT':
      return 'PROFILE_STORAGE_CORRUPT';
    case 'PROFILE_RPC_PROFILE_MISMATCH':
      return 'PROFILE_STORAGE_PROFILE_MISMATCH';
    default:
      return 'PROFILE_STORAGE_IO_FAILED';
  }
}

/**
 * Main-only Remote Host provider. Capability leases are held only in memory and every response is
 * bound to the same transport generation that issued its request.
 */
export class RemoteProfileProvider implements ProfileDataProvider {
  readonly storage: ProfileStorageRef;
  private readonly now: () => number;
  private readonly newRequestId: () => string;
  private readonly logger: NonNullable<RemoteProfileProviderDeps['logger']>;
  private readonly capabilities = new Map<string, CapabilityLease>();
  private readonly describedGenerations = new Set<string>();
  private readonly operationScopes = new Map<string, OperationScope>();

  constructor(private readonly deps: RemoteProfileProviderDeps) {
    this.storage = { kind: 'remote', hostId: deps.hostId };
    this.now = deps.now ?? Date.now;
    this.newRequestId = deps.newRequestId ?? randomUUID;
    this.logger = deps.logger ?? console;
  }

  availability(): 'ready' | 'offline' {
    return this.transport() ? 'ready' : 'offline';
  }

  currentGeneration(): string | null {
    return this.transport()?.generation ?? null;
  }

  isVaultAvailable(): boolean {
    return this.availability() === 'ready';
  }

  async describe(): Promise<RemoteProfileDescription> {
    const transport = this.requireTransport();
    const data = await this.bootstrapInvoke(transport, 'describe');
    if (
      !data ||
      typeof data !== 'object' ||
      (data as Partial<RemoteProfileDescription>).protocolVersion !==
        REMOTE_PROFILE_RPC_VERSION ||
      (data as Partial<RemoteProfileDescription>).bundleVersion !==
        REMOTE_PROFILE_BUNDLE_VERSION ||
      (data as Partial<RemoteProfileDescription>).encryption !== 'aes-256-gcm'
    ) {
      throw new RemoteProfileProviderError('PROFILE_STORAGE_INCOMPATIBLE');
    }
    this.describedGenerations.add(transport.generation);
    return data as RemoteProfileDescription;
  }

  async createProfile(input: BrowserProfileInput): Promise<BrowserProfile> {
    const name = input.name?.trim().slice(0, 100);
    if (!name || input.id === DEFAULT_PROFILE_ID) {
      throw new RemoteProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
    const userAgent = input.userAgent?.trim().slice(0, 1024);
    const profile: BrowserProfile = {
      id:
        input.id && PROFILE_ID_RE.test(input.id)
          ? input.id
          : randomUUID().replace(/-/g, ''),
      name,
      ...(userAgent ? { userAgent } : {}),
      createdAt: this.now(),
    };
    return this.writeProfile(profile);
  }

  async getProfile(profileId: string): Promise<BrowserProfile> {
    const data = await this.authorizedInvoke(profileId, 'profile.get');
    if (!validProfile(data, profileId)) this.invalidResponse('profile.get');
    return data;
  }

  async writeProfile(profile: BrowserProfile): Promise<BrowserProfile> {
    if (!validProfile(profile, profile.id)) {
      throw new RemoteProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
    const data = await this.authorizedInvoke(profile.id, 'profile.save', {
      profile,
    });
    if (data !== undefined && !validProfile(data, profile.id))
      this.invalidResponse('profile.save');
    return data === undefined ? { ...profile } : data;
  }

  async readBundle(profileId: string): Promise<ProfileBundleV1> {
    const data = await this.authorizedInvoke(profileId, 'bundle.export');
    if (!validBundle(data, profileId)) this.invalidResponse('bundle.export');
    return data;
  }

  async listMetadata(
    profileId: string,
    query?: PasswordMetadataQuery,
  ): Promise<PasswordCredentialMetadata[]> {
    const data = await this.authorizedInvoke(profileId, 'vault.list', {
      query,
    });
    if (
      !Array.isArray(data) ||
      !data.every((entry) => validMetadata(entry, profileId))
    ) {
      this.invalidResponse('vault.list');
    }
    return data;
  }

  async lookup(
    profileId: string,
    origin: string,
  ): Promise<DecryptedProfileCredential[]> {
    const data = await this.authorizedInvoke(profileId, 'vault.lookup', {
      origin,
    });
    if (
      !Array.isArray(data) ||
      !data.every((entry) => validCredential(entry, profileId))
    ) {
      this.invalidResponse('vault.lookup');
    }
    return data;
  }

  async getDecrypted(
    profileId: string,
    entryId: string,
  ): Promise<DecryptedProfileCredential> {
    const data = await this.authorizedInvoke(profileId, 'vault.get', {
      id: entryId,
    });
    if (!validCredential(data, profileId)) this.invalidResponse('vault.get');
    return data;
  }

  async upsert(input: PasswordUpsertInput): Promise<PasswordUpsertResult> {
    const data = await this.authorizedInvoke(input.profileId, 'vault.upsert', {
      origin: input.origin,
      username: input.username,
      password: input.password,
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
    if (
      !data ||
      typeof data !== 'object' ||
      ((data as Partial<PasswordUpsertResult>).kind !== 'saved' &&
        (data as Partial<PasswordUpsertResult>).kind !== 'updated') ||
      !validMetadata(
        (data as Partial<PasswordUpsertResult>).metadata,
        input.profileId,
      )
    ) {
      this.invalidResponse('vault.upsert');
    }
    return data as PasswordUpsertResult;
  }

  async deleteEntry(profileId: string, entryId: string): Promise<boolean> {
    const data = await this.authorizedInvoke(profileId, 'vault.delete', {
      id: entryId,
    });
    const deleted = (data as { deleted?: unknown } | null)?.deleted;
    if (typeof deleted !== 'boolean') this.invalidResponse('vault.delete');
    return deleted;
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    try {
      const data = await this.authorizedInvoke(profileId, 'profile.delete');
      const deleted = (data as { deleted?: unknown } | null)?.deleted;
      if (typeof deleted !== 'boolean') this.invalidResponse('profile.delete');
      return deleted;
    } finally {
      // Host revokes grants before attempting bundle deletion, including its failure path.
      this.capabilities.delete(profileId);
      for (const [operationId, scope] of this.operationScopes) {
        if (scope.profileId === profileId)
          this.operationScopes.delete(operationId);
      }
    }
  }

  async stage(operationId: string, bundle: ProfileBundleV1): Promise<void> {
    if (!validBundle(bundle, bundle.profile.id)) {
      throw new RemoteProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
    const generation = this.requireTransport().generation;
    await this.authorizedInvoke(bundle.profile.id, 'migration.stage', {
      operationId,
      bundle,
    });
    this.operationScopes.set(operationId, {
      profileId: bundle.profile.id,
      generation,
    });
  }

  async verify(operationId: string, nonce: Buffer): Promise<Buffer> {
    const scope = this.requireOperationScope(operationId);
    const data = await this.authorizedInvoke(
      scope.profileId,
      'migration.verify',
      {
        operationId,
        nonce: nonce.toString('base64url'),
      },
    );
    const digest = (data as { digest?: unknown } | null)?.digest;
    if (typeof digest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(digest)) {
      this.invalidResponse('migration.verify');
    }
    return Buffer.from(digest, 'base64url');
  }

  async publish(operationId: string, profileId: string): Promise<void> {
    const scope = this.requireOperationScope(operationId);
    if (scope.profileId !== profileId) {
      throw new RemoteProfileProviderError('PROFILE_STORAGE_PROFILE_MISMATCH');
    }
    await this.authorizedInvoke(profileId, 'migration.publish', {
      operationId,
    });
    this.operationScopes.delete(operationId);
  }

  async discard(operationId: string): Promise<void> {
    const scope = this.requireOperationScope(operationId);
    await this.authorizedInvoke(scope.profileId, 'migration.discard', {
      operationId,
    });
    this.operationScopes.delete(operationId);
  }

  async revoke(profileId: string): Promise<void> {
    await this.authorizedInvoke(profileId, 'grant.revoke');
    this.capabilities.delete(profileId);
  }

  invalidate(generation?: string): void {
    for (const [profileId, lease] of this.capabilities) {
      if (!generation || lease.generation === generation)
        this.capabilities.delete(profileId);
    }
    for (const [operationId, scope] of this.operationScopes) {
      if (!generation || scope.generation === generation)
        this.operationScopes.delete(operationId);
    }
    if (generation) this.describedGenerations.delete(generation);
    else this.describedGenerations.clear();
  }

  private async authorizedInvoke(
    profileId: string,
    op: RemoteProfileRpcOperation,
    payload?: unknown,
  ): Promise<unknown> {
    if (!isProfileId(profileId)) {
      throw new RemoteProfileProviderError('PROFILE_STORAGE_INVALID_INPUT');
    }
    const transport = this.requireTransport();
    const lease = await this.ensureCapability(transport, profileId);
    const requestId = this.newRequestId();
    const response = await this.invokeTransport(transport, {
      version: REMOTE_PROFILE_RPC_VERSION,
      requestId,
      op,
      clientId: this.deps.clientId,
      profileId,
      generation: transport.generation,
      capability: lease.capability,
      ...(payload === undefined ? {} : { payload }),
    });
    if (!response.ok && response.code === 'PROFILE_RPC_FORBIDDEN') {
      this.capabilities.delete(profileId);
    }
    return this.unwrap(response, requestId, op);
  }

  private async ensureCapability(
    transport: RemoteProfileTransportPort,
    profileId: string,
  ): Promise<CapabilityLease> {
    const cached = this.capabilities.get(profileId);
    if (
      cached &&
      cached.generation === transport.generation &&
      cached.expiresAt - this.now() >= GRANT_RENEWAL_WINDOW_MS
    ) {
      return cached;
    }
    if (!this.describedGenerations.has(transport.generation))
      await this.describe();
    const data = await this.bootstrapInvoke(
      transport,
      'grant',
      undefined,
      profileId,
    );
    const grant = data as Partial<RemoteProfileGrantResult> & {
      capability?: unknown;
    };
    if (
      !grant ||
      typeof grant.capability !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(grant.capability) ||
      !isFiniteTimestamp(grant.expiresAt) ||
      grant.expiresAt <= this.now()
    ) {
      this.invalidResponse('grant');
    }
    const lease: CapabilityLease = {
      profileId,
      generation: transport.generation,
      capability: grant.capability,
      expiresAt: grant.expiresAt,
    };
    this.capabilities.set(profileId, lease);
    return lease;
  }

  private async bootstrapInvoke(
    transport: RemoteProfileTransportPort,
    op: 'describe' | 'grant',
    payload?: unknown,
    profileId?: string,
  ): Promise<unknown> {
    const requestId = this.newRequestId();
    const response = await this.invokeTransport(transport, {
      version: REMOTE_PROFILE_RPC_VERSION,
      requestId,
      op,
      ...(op === 'grant'
        ? {
            clientId: this.deps.clientId,
            profileId,
            generation: transport.generation,
          }
        : {}),
      ...(payload === undefined ? {} : { payload }),
    });
    return this.unwrap(response, requestId, op);
  }

  private async invokeTransport(
    transport: RemoteProfileTransportPort,
    request: RemoteProfileRpcRequest,
  ): Promise<RemoteProfileRpcResponse> {
    let response: RemoteProfileRpcResponse;
    try {
      response = await transport.invoke(request);
    } catch (error) {
      const code = transportFailureCode(error);
      this.log(request.op, request.profileId, code, transport.generation);
      throw new RemoteProfileProviderError(code);
    }
    const current = this.transport();
    if (!current || current.generation !== transport.generation) {
      const code: ProfileStorageErrorCode = 'PROFILE_STORAGE_OFFLINE';
      this.log(request.op, request.profileId, code, transport.generation);
      throw new RemoteProfileProviderError(code);
    }
    return response;
  }

  private unwrap(
    response: RemoteProfileRpcResponse,
    requestId: string,
    op: RemoteProfileRpcOperation,
  ): unknown {
    if (!response || response.requestId !== requestId) this.invalidResponse(op);
    if (response.ok) return response.data;
    const code = responseFailureCode(response.code);
    this.log(op, undefined, code, this.currentGeneration() ?? 'none');
    throw new RemoteProfileProviderError(code);
  }

  private requireOperationScope(operationId: string): OperationScope {
    const scope = this.operationScopes.get(operationId);
    if (!scope || this.currentGeneration() !== scope.generation) {
      throw new RemoteProfileProviderError('PROFILE_STORAGE_OFFLINE');
    }
    return scope;
  }

  private transport(): RemoteProfileTransportPort | null {
    const transport = this.deps.getTransport(this.deps.hostId);
    if (
      !transport ||
      transport.hostId !== this.deps.hostId ||
      !transport.generation
    )
      return null;
    return transport;
  }

  private requireTransport(): RemoteProfileTransportPort {
    const transport = this.transport();
    if (!transport)
      throw new RemoteProfileProviderError('PROFILE_STORAGE_OFFLINE');
    return transport;
  }

  private invalidResponse(op: RemoteProfileRpcOperation): never {
    this.log(
      op,
      undefined,
      'PROFILE_STORAGE_IO_FAILED',
      this.currentGeneration() ?? 'none',
    );
    throw new RemoteProfileProviderError('PROFILE_STORAGE_IO_FAILED');
  }

  private log(
    op: RemoteProfileRpcOperation,
    profileId: string | undefined,
    code: ProfileStorageErrorCode,
    generation: string,
  ): void {
    this.logger.warn(
      `[remote-profile] hostId=${this.deps.hostId} profileId=${profileId ?? 'unknown'} op=${op} code=${code} generation=${generation.slice(0, 12)}`,
    );
  }
}
