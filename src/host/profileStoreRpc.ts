import * as os from 'node:os';
import * as path from 'node:path';
import {
  REMOTE_PROFILE_RPC_MAX_BYTES,
  REMOTE_PROFILE_RPC_VERSION,
  type RemoteProfileRpcErrorCode,
  type RemoteProfileRpcOperation,
  type RemoteProfileRpcRequest,
  type RemoteProfileRpcResponse,
} from '../shared/remoteProfileStore';
import {
  RemoteProfileStore,
  isRemoteProfileOperationId,
} from './remoteProfileStore';
import { RemoteProfileStoreError } from './remoteProfileCrypto';

const RPC_OPERATIONS = new Set<RemoteProfileRpcOperation>([
  'describe',
  'grant',
  'profile.get',
  'profile.save',
  'vault.list',
  'vault.lookup',
  'vault.get',
  'vault.upsert',
  'vault.delete',
  'bundle.export',
  'migration.stage',
  'migration.verify',
  'migration.publish',
  'migration.discard',
  'profile.delete',
  'grant.revoke',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function fixedError(
  requestId: string,
  code: RemoteProfileRpcErrorCode,
): RemoteProfileRpcResponse {
  return { ok: false, requestId, code };
}

function invalidInput(requestId: string): never {
  throw Object.assign(
    new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT'),
    { requestId },
  );
}

function requireEmptyPayload(payload: unknown, requestId: string): void {
  if (payload !== undefined) invalidInput(requestId);
}

function requireObjectPayload(
  payload: unknown,
  requestId: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(payload) || !hasOnlyKeys(payload, allowedKeys))
    invalidInput(requestId);
  return payload;
}

function requireStringField(
  payload: Record<string, unknown>,
  key: string,
  requestId: string,
): string {
  const value = payload[key];
  if (typeof value !== 'string') invalidInput(requestId);
  return value;
}

function parseRequest(raw: string): RemoteProfileRpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
  }
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, [
      'version',
      'requestId',
      'op',
      'clientId',
      'profileId',
      'generation',
      'capability',
      'payload',
    ]) ||
    typeof parsed.requestId !== 'string' ||
    !UUID_RE.test(parsed.requestId) ||
    typeof parsed.op !== 'string' ||
    !RPC_OPERATIONS.has(parsed.op as RemoteProfileRpcOperation)
  ) {
    throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
  }
  if (parsed.version !== REMOTE_PROFILE_RPC_VERSION) {
    throw Object.assign(
      new RemoteProfileStoreError('PROFILE_RPC_INCOMPATIBLE'),
      {
        requestId: parsed.requestId,
      },
    );
  }
  return parsed as unknown as RemoteProfileRpcRequest;
}

function requestIdFrom(error: unknown): string {
  if (
    isRecord(error) &&
    typeof error.requestId === 'string' &&
    UUID_RE.test(error.requestId)
  ) {
    return error.requestId;
  }
  return 'invalid';
}

function response(requestId: string, data?: unknown): RemoteProfileRpcResponse {
  return data === undefined
    ? { ok: true, requestId }
    : { ok: true, requestId, data };
}

export function handleRemoteProfileRpc(
  raw: string,
  store: RemoteProfileStore,
): RemoteProfileRpcResponse {
  let request: RemoteProfileRpcRequest;
  let activeRequestId = 'invalid';
  try {
    if (Buffer.byteLength(raw, 'utf8') > REMOTE_PROFILE_RPC_MAX_BYTES) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    request = parseRequest(raw);
    const { requestId } = request;
    activeRequestId = requestId;

    if (request.op === 'describe') {
      if (
        request.clientId !== undefined ||
        request.profileId !== undefined ||
        request.generation !== undefined ||
        request.capability !== undefined
      ) {
        invalidInput(requestId);
      }
      requireEmptyPayload(request.payload, requestId);
      return response(requestId, store.describe());
    }

    if (request.op === 'grant') {
      if (
        typeof request.clientId !== 'string' ||
        typeof request.profileId !== 'string' ||
        typeof request.generation !== 'string' ||
        request.capability !== undefined
      ) {
        invalidInput(requestId);
      }
      requireEmptyPayload(request.payload, requestId);
      return response(
        requestId,
        store.issueGrant(
          request.clientId,
          request.profileId,
          request.generation,
        ),
      );
    }

    // Every non-bootstrap operation crosses the same capability gate first.
    // Missing, malformed, wrong-scope, expired and wrong-generation requests
    // deliberately share one response and do not reveal profile existence.
    if (
      typeof request.clientId !== 'string' ||
      typeof request.profileId !== 'string' ||
      typeof request.generation !== 'string' ||
      typeof request.capability !== 'string' ||
      !store.authorize({
        clientId: request.clientId,
        profileId: request.profileId,
        generation: request.generation,
        capability: request.capability,
      })
    ) {
      return fixedError(requestId, 'PROFILE_RPC_FORBIDDEN');
    }

    const profileId = request.profileId;
    switch (request.op) {
      case 'profile.get':
        requireEmptyPayload(request.payload, requestId);
        return response(requestId, store.getProfile(profileId));
      case 'profile.save': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'profile',
        ]);
        if (!('profile' in payload)) invalidInput(requestId);
        return response(
          requestId,
          store.saveProfile(profileId, payload.profile),
        );
      }
      case 'vault.list': {
        const payload =
          request.payload === undefined
            ? {}
            : requireObjectPayload(request.payload, requestId, ['query']);
        if (
          payload.query !== undefined &&
          (!isRecord(payload.query) ||
            !hasOnlyKeys(payload.query, ['profileId', 'query']))
        ) {
          invalidInput(requestId);
        }
        return response(
          requestId,
          store.listVault(profileId, payload.query ?? {}),
        );
      }
      case 'vault.lookup': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'origin',
        ]);
        return response(
          requestId,
          store.lookupVault(
            profileId,
            requireStringField(payload, 'origin', requestId),
          ),
        );
      }
      case 'vault.get': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'id',
        ]);
        return response(
          requestId,
          store.getVaultEntry(
            profileId,
            requireStringField(payload, 'id', requestId),
          ),
        );
      }
      case 'vault.upsert': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'origin',
          'username',
          'password',
          'now',
        ]);
        return response(
          requestId,
          store.upsertVault(profileId, {
            origin: payload.origin,
            username: payload.username,
            password: payload.password,
            ...(payload.now !== undefined ? { now: payload.now } : {}),
          }),
        );
      }
      case 'vault.delete': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'id',
        ]);
        return response(requestId, {
          deleted: store.deleteVaultEntry(
            profileId,
            requireStringField(payload, 'id', requestId),
          ),
        });
      }
      case 'bundle.export':
        requireEmptyPayload(request.payload, requestId);
        return response(requestId, store.exportBundle(profileId));
      case 'migration.stage': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'operationId',
          'bundle',
        ]);
        const operationId = requireStringField(
          payload,
          'operationId',
          requestId,
        );
        if (
          !isRemoteProfileOperationId(operationId) ||
          !('bundle' in payload)
        ) {
          invalidInput(requestId);
        }
        store.stageMigration(operationId, profileId, payload.bundle);
        return response(requestId);
      }
      case 'migration.verify': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'operationId',
          'nonce',
        ]);
        const operationId = requireStringField(
          payload,
          'operationId',
          requestId,
        );
        const nonce = requireStringField(payload, 'nonce', requestId);
        return response(requestId, {
          digest: store.verifyMigration(operationId, profileId, nonce),
        });
      }
      case 'migration.publish': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'operationId',
        ]);
        store.publishMigration(
          requireStringField(payload, 'operationId', requestId),
          profileId,
        );
        return response(requestId);
      }
      case 'migration.discard': {
        const payload = requireObjectPayload(request.payload, requestId, [
          'operationId',
        ]);
        return response(requestId, {
          discarded: store.discardMigration(
            requireStringField(payload, 'operationId', requestId),
            profileId,
          ),
        });
      }
      case 'profile.delete':
        requireEmptyPayload(request.payload, requestId);
        return response(requestId, { deleted: store.deleteProfile(profileId) });
      case 'grant.revoke':
        requireEmptyPayload(request.payload, requestId);
        store.revokeGrant(request.clientId, profileId);
        return response(requestId);
      default:
        return fixedError(requestId, 'PROFILE_RPC_INVALID_INPUT');
    }
  } catch (error) {
    const requestId =
      activeRequestId === 'invalid' ? requestIdFrom(error) : activeRequestId;
    if (error instanceof RemoteProfileStoreError) {
      return fixedError(requestId, error.code);
    }
    return fixedError(requestId, 'PROFILE_RPC_IO_FAILED');
  }
}

async function readBoundedStdin(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of input as AsyncIterable<Buffer | string>) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    total += bytes.length;
    if (total > REMOTE_PROFILE_RPC_MAX_BYTES) {
      throw new RemoteProfileStoreError('PROFILE_RPC_INVALID_INPUT');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export interface RunRemoteProfileRpcDeps {
  dataDir?: string;
  input?: NodeJS.ReadableStream;
  write?: (serialized: string) => void;
  writeError?: (serialized: string) => void;
}

/** One bounded stdin request, one bounded stdout response, then process exit. */
export async function runRemoteProfileRpc(
  deps: RunRemoteProfileRpcDeps = {},
): Promise<void> {
  let result: RemoteProfileRpcResponse;
  try {
    const dataDir =
      deps.dataDir ??
      process.env.OKWORK_HOST_DATA_DIR ??
      path.join(os.homedir(), '.termpro-host');
    const store = new RemoteProfileStore({ dataDir });
    result = handleRemoteProfileRpc(
      await readBoundedStdin(deps.input ?? process.stdin),
      store,
    );
  } catch (error) {
    result = fixedError(
      requestIdFrom(error),
      error instanceof RemoteProfileStoreError
        ? error.code
        : 'PROFILE_RPC_IO_FAILED',
    );
  }
  let serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, 'utf8') > REMOTE_PROFILE_RPC_MAX_BYTES) {
    serialized = JSON.stringify(
      fixedError(result.requestId, 'PROFILE_RPC_IO_FAILED'),
    );
  }
  if (!result.ok) {
    (deps.writeError ?? ((value) => process.stderr.write(value)))(
      `[profile-store-rpc] ${result.code}\n`,
    );
  }
  (deps.write ?? ((value) => process.stdout.write(value)))(serialized);
}
