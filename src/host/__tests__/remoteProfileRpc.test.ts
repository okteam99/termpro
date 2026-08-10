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
    expect(description).toEqual({
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
});
