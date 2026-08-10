import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleRemoteProfileRpc } from '../../host/profileStoreRpc';
import { RemoteProfileStore } from '../../host/remoteProfileStore';
import type {
  RemoteProfileRpcRequest,
  RemoteProfileRpcResponse,
} from '../../shared/remoteProfileStore';
import {
  RemoteProfileProvider,
  RemoteProfileProviderError,
  type RemoteProfileTransportPort,
} from '../remoteProfileProvider';
import { profileBundleVerificationDigest } from '../profileMigrationCoordinator';

const PROFILE_ID = 'c'.repeat(32);
const OTHER_PROFILE_ID = 'd'.repeat(32);
const HOST_ID = 'secure-host';
const SENTINEL = 'BL007-never-log-this-password';

let tmpDir: string;
let store: RemoteProfileStore;
let generation: string;
let requests: RemoteProfileRpcRequest[];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'okwork-main-profile-provider-'),
  );
  store = new RemoteProfileStore({ dataDir: tmpDir });
  generation = 'generation-1';
  requests = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function transport(): RemoteProfileTransportPort {
  return {
    hostId: HOST_ID,
    generation,
    async invoke(request): Promise<RemoteProfileRpcResponse> {
      requests.push(structuredClone(request));
      return handleRemoteProfileRpc(JSON.stringify(request), store);
    },
  };
}

function provider(logs: string[] = []): RemoteProfileProvider {
  return new RemoteProfileProvider({
    hostId: HOST_ID,
    clientId: randomBytes(32).toString('base64url'),
    getTransport: () => transport(),
    logger: {
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
  });
}

describe('main-only RemoteProfileProvider security', () => {
  it('test_AC3_wires the production provider through the dedicated Host RPC and handles result envelopes', async () => {
    const remote = provider();
    const profile = { id: PROFILE_ID, name: 'Remote Profile', createdAt: 10 };
    await expect(remote.writeProfile(profile)).resolves.toEqual(profile);
    const saved = await remote.upsert({
      profileId: PROFILE_ID,
      origin: 'https://accounts.example.test',
      username: 'alice',
      password: SENTINEL,
      now: 20,
    });
    await expect(remote.getProfile(PROFILE_ID)).resolves.toEqual(profile);
    await expect(
      remote.lookup(PROFILE_ID, 'https://accounts.example.test'),
    ).resolves.toEqual([
      expect.objectContaining({ id: saved.metadata.id, password: SENTINEL }),
    ]);
    await expect(
      remote.deleteEntry(PROFILE_ID, saved.metadata.id),
    ).resolves.toBe(true);
    await expect(
      remote.deleteEntry(PROFILE_ID, saved.metadata.id),
    ).resolves.toBe(false);
    await expect(remote.deleteProfile(PROFILE_ID)).resolves.toBe(true);

    expect(requests.map((request) => request.op)).toEqual(
      expect.arrayContaining([
        'describe',
        'grant',
        'profile.save',
        'vault.upsert',
        'vault.delete',
        'profile.delete',
      ]),
    );
    expect(fs.readFileSync(store.grantsPath, 'utf8')).not.toContain(SENTINEL);
    const profileFiles = fs.readdirSync(store.profilesDirectory);
    expect(profileFiles).toEqual([]);
  });

  it('test_AC3_rejects_renderer_and_invalid_main_only_capabilities_without_enumeration', async () => {
    const preloadSource = fs.readFileSync(
      path.resolve(__dirname, '../../preload/preload.ts'),
      'utf8',
    );
    expect(preloadSource).not.toContain('--profile-store-rpc');
    expect(preloadSource).not.toContain('RemoteProfileProvider');

    const remote = provider();
    const profile = { id: PROFILE_ID, name: 'Remote Profile', createdAt: 10 };
    await remote.writeProfile(profile);
    const firstAuthorized = requests.find(
      (request) => request.op === 'profile.save',
    );
    expect(firstAuthorized).toBeDefined();
    if (!firstAuthorized) throw new Error('missing authorized request');
    const attempts: Array<Partial<RemoteProfileRpcRequest>> = [
      { ...firstAuthorized, capability: 'wrong' },
      { ...firstAuthorized, profileId: OTHER_PROFILE_ID },
      { ...firstAuthorized, generation: 'wrong-generation' },
      { ...firstAuthorized, capability: undefined },
    ];
    for (const attempt of attempts) {
      const response = handleRemoteProfileRpc(
        JSON.stringify({
          ...attempt,
          requestId: randomUUID(),
          op: 'profile.get',
          payload: undefined,
        }),
        store,
      );
      expect(response).toMatchObject({
        ok: false,
        code: 'PROFILE_RPC_FORBIDDEN',
      });
    }

    generation = 'generation-2';
    await expect(remote.getProfile(PROFILE_ID)).resolves.toEqual(profile);
    const staleResponse = handleRemoteProfileRpc(
      JSON.stringify({
        ...firstAuthorized,
        requestId: randomUUID(),
        op: 'profile.get',
        payload: undefined,
      }),
      store,
    );
    expect(staleResponse).toMatchObject({
      ok: false,
      code: 'PROFILE_RPC_FORBIDDEN',
    });
    expect(requests.filter((request) => request.op === 'grant')).toHaveLength(
      2,
    );
  });

  it('uses the same canonical HMAC across main provider and the real Host staging store', async () => {
    const remote = provider();
    const operationId = '50000000-0000-4000-8000-000000000001';
    const staged = {
      version: 1 as const,
      profile: { id: PROFILE_ID, name: 'Canonical Profile', createdAt: 10 },
      credentials: [
        {
          id: '60000000-0000-4000-8000-000000000001',
          profileId: PROFILE_ID,
          origin: 'https://example.test',
          username: 'alice',
          password: SENTINEL,
          createdAt: 20,
          updatedAt: 20,
          lastUsedAt: 20,
        },
      ],
    };
    const nonce = Buffer.alloc(32, 11);
    await remote.stage(operationId, staged);
    await expect(remote.verify(operationId, nonce)).resolves.toEqual(
      profileBundleVerificationDigest(staged, nonce),
    );
    await remote.publish(operationId, PROFILE_ID);
    await expect(remote.readBundle(PROFILE_ID)).resolves.toEqual(staged);
  });

  it('test_AC9_redacts_secrets_and_reports_only_stable_non_sensitive_failures', async () => {
    const logs: string[] = [];
    const timeoutProvider = new RemoteProfileProvider({
      hostId: HOST_ID,
      clientId: randomBytes(32).toString('base64url'),
      getTransport: () => ({
        hostId: HOST_ID,
        generation: 'g-timeout',
        invoke: async () => {
          throw Object.assign(new Error(`timeout ${SENTINEL}`), {
            code: 'timeout',
          });
        },
      }),
      logger: {
        warn: (message) => logs.push(message),
        error: (message) => logs.push(message),
      },
    });
    await expect(timeoutProvider.getProfile(PROFILE_ID)).rejects.toEqual(
      expect.objectContaining<Partial<RemoteProfileProviderError>>({
        code: 'PROFILE_STORAGE_TIMEOUT',
      }),
    );
    expect(logs.join('\n')).not.toContain(SENTINEL);

    const wrongHostProvider = new RemoteProfileProvider({
      hostId: HOST_ID,
      clientId: randomBytes(32).toString('base64url'),
      getTransport: () => ({
        hostId: 'other-host',
        generation: 'g1',
        invoke: async () => ({ ok: true, requestId: 'never' }),
      }),
    });
    await expect(wrongHostProvider.getProfile(PROFILE_ID)).rejects.toEqual(
      expect.objectContaining<Partial<RemoteProfileProviderError>>({
        code: 'PROFILE_STORAGE_OFFLINE',
      }),
    );
  });
});
