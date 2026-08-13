import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  RemoteProfileRpcRequest,
  RemoteProfileRpcResponse,
} from '../../shared/remoteProfileStore';
import { handleRemoteProfileRpc } from '../profileStoreRpc';
import { RemoteProfileStore } from '../remoteProfileStore';

const PROFILE_ID = 'c'.repeat(32);
const OTHER_PROFILE_ID = 'd'.repeat(32);
const DELETED_PROFILE_ID = 'e'.repeat(32);
const CLIENT_ID = randomBytes(32).toString('base64url');

let tmpDir: string;
let store: RemoteProfileStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-profile-rpc-'));
  store = new RemoteProfileStore({ dataDir: tmpDir });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function invoke(request: RemoteProfileRpcRequest): RemoteProfileRpcResponse {
  return handleRemoteProfileRpc(JSON.stringify(request), store);
}

function request(
  op: RemoteProfileRpcRequest['op'],
  extra: Partial<RemoteProfileRpcRequest> = {},
): RemoteProfileRpcRequest {
  return { version: 1, requestId: randomUUID(), op, ...extra };
}

describe('profile-store RPC handler', () => {
  it('allows only describe/grant bootstrap and uses the grant for a scoped round trip', () => {
    const description = invoke(request('describe'));
    expect(description).toMatchObject({
      ok: true,
      requestId: expect.any(String),
      data: { protocolVersion: 1, bundleVersion: 1, encryption: 'aes-256-gcm' },
    });

    const grantResponse = invoke(
      request('grant', {
        clientId: CLIENT_ID,
        profileId: PROFILE_ID,
        generation: 'generation-1',
      }),
    );
    expect(grantResponse.ok).toBe(true);
    if (!grantResponse.ok) throw new Error('grant unexpectedly failed');
    const grant = grantResponse.data as {
      capability: string;
      expiresAt: number;
    };
    expect(grant.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const auth = {
      clientId: CLIENT_ID,
      profileId: PROFILE_ID,
      generation: 'generation-1',
      capability: grant.capability,
    };
    const profile = {
      id: PROFILE_ID,
      name: 'RPC profile',
      createdAt: 10,
    };
    expect(
      invoke(request('profile.save', { ...auth, payload: { profile } })),
    ).toMatchObject({
      ok: true,
      data: profile,
    });
    expect(invoke(request('profile.get', auth))).toMatchObject({
      ok: true,
      data: profile,
    });
  });

  it('returns the same forbidden code for wrong token/profile/generation and expired grant', () => {
    let now = 50;
    store = new RemoteProfileStore({ dataDir: tmpDir, now: () => now });
    const issued = store.issueGrant(CLIENT_ID, PROFILE_ID, 'g1');
    const good = {
      clientId: CLIENT_ID,
      profileId: PROFILE_ID,
      generation: 'g1',
      capability: issued.capability,
    };
    const attempts: Array<Partial<RemoteProfileRpcRequest>> = [
      { ...good, capability: 'wrong' },
      { ...good, profileId: OTHER_PROFILE_ID },
      { ...good, generation: 'old-generation' },
      { clientId: CLIENT_ID, profileId: PROFILE_ID, generation: 'g1' },
    ];
    for (const attempt of attempts) {
      expect(invoke(request('profile.get', attempt))).toMatchObject({
        ok: false,
        code: 'PROFILE_RPC_FORBIDDEN',
      });
    }
    now = issued.expiresAt;
    expect(invoke(request('profile.get', good))).toMatchObject({
      ok: false,
      code: 'PROFILE_RPC_FORBIDDEN',
    });
  });

  it('rejects malformed and incompatible envelopes without echoing their payload', () => {
    const secret = 'must-not-appear';
    const malformed = handleRemoteProfileRpc(`{"password":"${secret}"}`, store);
    const incompatible = invoke({
      version: 99 as 1,
      requestId: randomUUID(),
      op: 'describe',
    });
    expect(malformed).toEqual({
      ok: false,
      requestId: 'invalid',
      code: 'PROFILE_RPC_INVALID_INPUT',
    });
    expect(JSON.stringify(malformed)).not.toContain(secret);
    expect(incompatible).toMatchObject({
      ok: false,
      code: 'PROFILE_RPC_INCOMPATIBLE',
    });
  });

  it('test_AC1_catalog_lists_joinable_profiles_and_rejects_fixed_join_outcomes', () => {
    store.saveProfile(PROFILE_ID, {
      id: PROFILE_ID,
      name: 'Same name',
      createdAt: 10,
    });
    store.saveProfile(OTHER_PROFILE_ID, {
      id: OTHER_PROFILE_ID,
      name: 'Same name',
      createdAt: 20,
    });
    store.saveProfile(DELETED_PROFILE_ID, {
      id: DELETED_PROFILE_ID,
      name: 'Deleted',
      createdAt: 30,
    });
    store.retireProfile(OTHER_PROFILE_ID, {
      operationId: randomUUID(),
      expectedEpoch: 0,
      kind: 'moved',
      movedTo: 'remote',
    });
    store.retireProfile(DELETED_PROFILE_ID, {
      operationId: randomUUID(),
      expectedEpoch: 0,
      kind: 'deleted',
    });

    const discovered = invoke(
      request('profile.discover', {
        clientId: CLIENT_ID,
        generation: 'generation-1',
      }),
    );
    expect(discovered).toMatchObject({
      ok: true,
      data: [
        {
          profileId: PROFILE_ID,
          name: 'Same name',
          createdAt: 10,
          epoch: 0,
        },
      ],
    });
    expect(
      invoke(
        request('profile.discover', {
          clientId: CLIENT_ID,
          generation: 'generation-1',
          profileId: PROFILE_ID,
        }),
      ),
    ).toMatchObject({ ok: false, code: 'PROFILE_RPC_INVALID_INPUT' });
    for (const [profileId, lifecycle] of [
      [OTHER_PROFILE_ID, 'moved'],
      [DELETED_PROFILE_ID, 'deleted'],
    ] as const) {
      const reissued = invoke(
        request('grant', {
          clientId: CLIENT_ID,
          profileId,
          generation: 'generation-1',
        }),
      );
      expect(reissued.ok).toBe(true);
      if (!reissued.ok) throw new Error('lifecycle grant unexpectedly failed');
      const capability = (reissued.data as { capability: string }).capability;
      expect(
        invoke(
          request('profile.lifecycle', {
            clientId: CLIENT_ID,
            profileId,
            generation: 'generation-1',
            capability,
          }),
        ),
      ).toMatchObject({ ok: true, data: { profileId, lifecycle, epoch: 1 } });
    }
  });

  it('test_AC5_v1_bundle_remains_usable_and_cookie_capability_is_explicit', () => {
    const description = invoke(request('describe'));
    expect(description).toMatchObject({
      ok: true,
      data: {
        protocolVersion: 1,
        bundleVersion: 1,
        encryption: 'aes-256-gcm',
        continuity: {
          version: 1,
          pageMaxBytes: 512 * 1024,
          itemMaxBytes: 64 * 1024,
        },
      },
    });
    const issued = store.issueGrant(CLIENT_ID, PROFILE_ID, 'generation-1');
    const auth = {
      clientId: CLIENT_ID,
      profileId: PROFILE_ID,
      generation: 'generation-1',
      capability: issued.capability,
    };
    const profile = { id: PROFILE_ID, name: 'Legacy v1', createdAt: 10 };
    expect(
      invoke(request('profile.save', { ...auth, payload: { profile } })),
    ).toMatchObject({ ok: true, data: profile });
    expect(
      invoke(
        request('continuity.push', {
          ...auth,
          payload: {
            deviceId: CLIENT_ID,
            operationId: randomUUID(),
            profileEpoch: 0,
            baseRevision: 0,
            change: {
              kind: 'upsert',
              identity: {
                domain: 'example.test',
                hostOnly: true,
                path: '/',
                name: 'login',
              },
              value: 'cookie-secret',
              secure: true,
              httpOnly: true,
              sameSite: 'lax',
              expirationDate: 2_000_000_000,
            },
          },
        }),
      ),
    ).toMatchObject({ ok: true, data: { revision: 1 } });

    const renamed = { ...profile, name: 'Still strict v1' };
    expect(
      invoke(
        request('profile.save', { ...auth, payload: { profile: renamed } }),
      ),
    ).toMatchObject({ ok: true, data: renamed });
    const exported = invoke(request('bundle.export', auth));
    expect(exported).toMatchObject({
      ok: true,
      data: { version: 1, profile: renamed, credentials: [] },
    });
    if (!exported.ok) throw new Error('bundle export unexpectedly failed');
    expect(Object.keys(exported.data as object).sort()).toEqual([
      'credentials',
      'profile',
      'version',
    ]);
    expect(
      invoke(
        request('continuity.pull', {
          ...auth,
          payload: { fromRevision: 0, pageBytes: 512 * 1024 },
        }),
      ),
    ).toMatchObject({
      ok: true,
      data: { nextRevision: 1, records: [expect.objectContaining({ revision: 1 })] },
    });
    expect(invoke(request('profile.delete', auth))).toMatchObject({
      ok: false,
      code: 'PROFILE_CONTINUITY_LEGACY_DELETE_FORBIDDEN',
    });
    expect(
      invoke(
        request('continuity.pull', {
          ...auth,
          payload: {
            fromRevision: 0,
            pageBytes: 512 * 1024,
            unknown: true,
          },
        }),
      ),
    ).toMatchObject({ ok: false, code: 'PROFILE_RPC_INVALID_INPUT' });
  });

  it('dispatches the verified continuity migration commit sequence through strict RPC payloads', () => {
    const target = new RemoteProfileStore({
      dataDir: path.join(tmpDir, 'migration-target'),
    });
    const invokeTarget = (rpcRequest: RemoteProfileRpcRequest) =>
      handleRemoteProfileRpc(JSON.stringify(rpcRequest), target);
    const profile = { id: PROFILE_ID, name: 'Migrating', createdAt: 10 };
    store.saveProfile(PROFILE_ID, profile);
    store.pushContinuity(PROFILE_ID, {
      deviceId: CLIENT_ID,
      operationId: randomUUID(),
      profileEpoch: 0,
      baseRevision: 0,
      change: {
        kind: 'upsert',
        identity: {
          domain: 'example.test',
          hostOnly: true,
          path: '/',
          name: 'login',
        },
        value: 'secret',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expirationDate: 2_000_000_000,
      },
    });
    const operationId = randomUUID();
    target.stageMigration(operationId, PROFILE_ID, store.exportBundle(PROFILE_ID));
    const sourceGrant = store.issueGrant(CLIENT_ID, PROFILE_ID, 'source-g');
    const targetGrant = target.issueGrant(CLIENT_ID, PROFILE_ID, 'target-g');
    const sourceAuth = {
      clientId: CLIENT_ID,
      profileId: PROFILE_ID,
      generation: 'source-g',
      capability: sourceGrant.capability,
    };
    const targetAuth = {
      clientId: CLIENT_ID,
      profileId: PROFILE_ID,
      generation: 'target-g',
      capability: targetGrant.capability,
    };
    const initialPage = store.pullContinuity(PROFILE_ID, {
      fromRevision: 0,
      pageBytes: 512 * 1024,
    });
    expect(
      invokeTarget(
        request('continuity.migration.stage', {
          ...targetAuth,
          payload: { operationId, page: initialPage },
        }),
      ),
    ).toMatchObject({ ok: true, data: { confirmedRevision: 1 } });

    const nonce = randomBytes(32).toString('base64url');
    const frozenResponse = invoke(
      request('continuity.migration.freeze', {
        ...sourceAuth,
        payload: { operationId, expectedEpoch: 0, nonce },
      }),
    );
    expect(frozenResponse).toMatchObject({
      ok: true,
      data: { lifecycle: 'moving', revision: 1 },
    });
    if (!frozenResponse.ok) throw new Error('freeze unexpectedly failed');
    const frozen = frozenResponse.data as { digest: string; revision: number };
    const finalPage = store.pullContinuity(PROFILE_ID, {
      fromRevision: initialPage.nextRevision,
      pageBytes: 512 * 1024,
    });
    invokeTarget(
      request('continuity.migration.stage', {
        ...targetAuth,
        payload: { operationId, page: finalPage },
      }),
    );
    const verifiedResponse = invokeTarget(
      request('continuity.migration.verify', {
        ...targetAuth,
        payload: { operationId, nonce },
      }),
    );
    expect(verifiedResponse).toMatchObject({
      ok: true,
      data: { digest: frozen.digest, revision: frozen.revision },
    });
    if (!verifiedResponse.ok) throw new Error('verify unexpectedly failed');
    const verified = verifiedResponse.data as { digest: string };
    expect(
      invokeTarget(
        request('continuity.migration.publish', {
          ...targetAuth,
          payload: {
            operationId,
            expectedRevision: frozen.revision,
            verifiedDigest: verified.digest,
          },
        }),
      ),
    ).toMatchObject({ ok: true, data: { lifecycle: 'moving' } });
    const retiredResponse = invoke(
      request('profile.retire', {
        ...sourceAuth,
        payload: {
          operationId,
          expectedEpoch: 0,
          kind: 'moved',
          movedTo: 'remote',
        },
      }),
    );
    expect(retiredResponse).toMatchObject({
      ok: true,
      data: { lifecycle: 'moved', epoch: 1 },
    });
    expect(
      invokeTarget(
        request('migration.publish', {
          ...targetAuth,
          payload: { operationId },
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      invokeTarget(
        request('continuity.migration.activate', {
          ...targetAuth,
          payload: { operationId, epoch: 1 },
        }),
      ),
    ).toMatchObject({ ok: true, data: { lifecycle: 'active', epoch: 1 } });
    expect(
      invokeTarget(
        request('continuity.migration.verify', {
          ...targetAuth,
          payload: { operationId, nonce, unknown: true },
        }),
      ),
    ).toMatchObject({ ok: false, code: 'PROFILE_RPC_INVALID_INPUT' });
  });
});
