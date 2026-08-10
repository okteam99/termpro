import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProfileBundleV1 } from '../../shared/remoteProfileStore';
import {
  canonicalRemoteProfileJson,
  RemoteProfileStore,
} from '../remoteProfileStore';

const PROFILE_ID = 'a'.repeat(32);
const OTHER_PROFILE_ID = 'b'.repeat(32);
const CLIENT_ID = randomBytes(32).toString('base64url');
const ENTRY_ID = '123e4567-e89b-42d3-a456-426614174000';

let tmpDir: string;

function bundle(profileId = PROFILE_ID): ProfileBundleV1 {
  return {
    version: 1,
    profile: {
      id: profileId,
      name: 'Remote work',
      userAgent: 'OkWork/Test',
      createdAt: 100,
    },
    credentials: [
      {
        id: ENTRY_ID,
        profileId,
        origin: 'https://example.test',
        username: 'private-user',
        password: 'private-password',
        createdAt: 100,
        updatedAt: 100,
        lastUsedAt: 100,
      },
    ],
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-remote-profile-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('RemoteProfileStore encrypted persistence', () => {
  it('encrypts the whole bundle, uses private permissions, and leaves no temporary files', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    const operationId = randomUUID();
    store.stageMigration(operationId, PROFILE_ID, bundle());
    store.publishMigration(operationId, PROFILE_ID);

    expect(store.exportBundle(PROFILE_ID)).toEqual(bundle());

    const root = path.join(tmpDir, 'profile-store');
    const profileFile = path.join(root, 'profiles', `${PROFILE_ID}.json`);
    const ciphertext = fs.readFileSync(profileFile, 'utf8');
    expect(ciphertext).not.toContain('private-user');
    expect(ciphertext).not.toContain('private-password');
    expect(ciphertext).not.toContain('example.test');
    expect(JSON.parse(ciphertext)).toMatchObject({
      version: 1,
      algorithm: 'aes-256-gcm',
    });
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(root, 'profiles')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(root, 'staging')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(root, 'master.key')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(profileFile).mode & 0o777).toBe(0o600);
    expect(
      fs.existsSync(path.join(root, 'staging', `${operationId}.json`)),
    ).toBe(false);
    const leftovers = fs
      .readdirSync(root, { recursive: true })
      .map(String)
      .filter((name) => name.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('verifies the exact staged plaintext and atomically replaces staging on retry', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    const operationId = randomUUID();
    const original = bundle();
    store.stageMigration(operationId, PROFILE_ID, original);
    const replacement: ProfileBundleV1 = {
      ...original,
      profile: { ...original.profile, name: 'Replacement' },
    };
    store.stageMigration(operationId, PROFILE_ID, replacement);

    const nonce = randomBytes(32);
    const expected = createHmac('sha256', nonce)
      .update(canonicalRemoteProfileJson(replacement), 'utf8')
      .digest('base64url');
    expect(
      store.verifyMigration(
        operationId,
        PROFILE_ID,
        nonce.toString('base64url'),
      ),
    ).toBe(expected);

    store.publishMigration(operationId, PROFILE_ID);
    expect(store.getProfile(PROFILE_ID).name).toBe('Replacement');
  });

  it('fails closed without regenerating a missing or malformed key when ciphertext exists', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    const operationId = randomUUID();
    store.stageMigration(operationId, PROFILE_ID, bundle());
    const keyFile = path.join(tmpDir, 'profile-store', 'master.key');
    const stagingFile = path.join(tmpDir, 'profile-store', 'staging');
    const nonce = randomBytes(32).toString('base64url');

    fs.unlinkSync(keyFile);
    expect(() =>
      store.verifyMigration(operationId, PROFILE_ID, nonce),
    ).toThrowError(
      expect.objectContaining({ code: 'PROFILE_RPC_ENCRYPTION_UNAVAILABLE' }),
    );
    expect(() =>
      store.stageMigration(randomUUID(), PROFILE_ID, bundle()),
    ).toThrowError(
      expect.objectContaining({ code: 'PROFILE_RPC_ENCRYPTION_UNAVAILABLE' }),
    );
    expect(fs.existsSync(keyFile)).toBe(false);
    expect(fs.readdirSync(stagingFile).length).toBe(1);

    fs.writeFileSync(keyFile, Buffer.alloc(8), { mode: 0o600 });
    expect(() =>
      store.verifyMigration(operationId, PROFILE_ID, nonce),
    ).toThrowError(
      expect.objectContaining({ code: 'PROFILE_RPC_ENCRYPTION_UNAVAILABLE' }),
    );
    expect(() =>
      store.stageMigration(randomUUID(), PROFILE_ID, bundle()),
    ).toThrowError(
      expect.objectContaining({ code: 'PROFILE_RPC_ENCRYPTION_UNAVAILABLE' }),
    );
    expect(fs.readFileSync(keyFile)).toHaveLength(8);
  });

  it('rejects ciphertext tampering and AAD profile substitution without partial data', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    const operationId = randomUUID();
    store.stageMigration(operationId, PROFILE_ID, bundle());
    store.publishMigration(operationId, PROFILE_ID);
    const file = path.join(
      tmpDir,
      'profile-store',
      'profiles',
      `${PROFILE_ID}.json`,
    );
    fs.copyFileSync(
      file,
      path.join(
        tmpDir,
        'profile-store',
        'profiles',
        `${OTHER_PROFILE_ID}.json`,
      ),
    );
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      ciphertext: string;
    };
    const last = envelope.ciphertext.at(-1);
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    fs.writeFileSync(file, JSON.stringify(envelope), { mode: 0o600 });

    expect(() => store.exportBundle(PROFILE_ID)).toThrowError(
      expect.objectContaining({ code: 'PROFILE_RPC_CORRUPT' }),
    );
    expect(() => store.exportBundle(OTHER_PROFILE_ID)).toThrowError(
      expect.objectContaining({ code: 'PROFILE_RPC_CORRUPT' }),
    );
  });
});

describe('RemoteProfileStore grants', () => {
  it('stores only capability hashes and rejects wrong scope, token, generation and expiry uniformly', () => {
    let now = 1_000;
    const store = new RemoteProfileStore({ dataDir: tmpDir, now: () => now });
    const first = store.issueGrant(CLIENT_ID, PROFILE_ID, 'generation-1');
    const grantsFile = path.join(tmpDir, 'profile-store', 'grants.json');
    const grantsText = fs.readFileSync(grantsFile, 'utf8');
    expect(grantsText).not.toContain(first.capability);
    expect(fs.statSync(grantsFile).mode & 0o777).toBe(0o600);

    const base = {
      clientId: CLIENT_ID,
      profileId: PROFILE_ID,
      generation: 'generation-1',
      capability: first.capability,
    };
    expect(store.authorize(base)).toBe(true);
    expect(store.authorize({ ...base, capability: 'wrong-token' })).toBe(false);
    expect(store.authorize({ ...base, profileId: OTHER_PROFILE_ID })).toBe(
      false,
    );
    expect(store.authorize({ ...base, generation: 'generation-2' })).toBe(
      false,
    );

    const second = store.issueGrant(CLIENT_ID, PROFILE_ID, 'generation-2');
    expect(store.authorize(base)).toBe(false);
    expect(
      store.authorize({
        ...base,
        generation: 'generation-2',
        capability: second.capability,
      }),
    ).toBe(true);

    now = second.expiresAt;
    expect(
      store.authorize({
        ...base,
        generation: 'generation-2',
        capability: second.capability,
      }),
    ).toBe(false);
  });

  it('profile deletion revokes every client grant for that profile', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    const first = store.issueGrant(CLIENT_ID, PROFILE_ID, 'g1');
    const otherClient = randomBytes(32).toString('base64url');
    const second = store.issueGrant(otherClient, PROFILE_ID, 'g1');
    store.saveProfile(PROFILE_ID, bundle().profile);

    expect(store.deleteProfile(PROFILE_ID)).toBe(true);
    expect(
      store.authorize({
        clientId: CLIENT_ID,
        profileId: PROFILE_ID,
        generation: 'g1',
        capability: first.capability,
      }),
    ).toBe(false);
    expect(
      store.authorize({
        clientId: otherClient,
        profileId: PROFILE_ID,
        generation: 'g1',
        capability: second.capability,
      }),
    ).toBe(false);
  });
});

describe('RemoteProfileStore vault operations', () => {
  it('preserves profile scope and never returns passwords from list', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    store.stageMigration(randomUUID(), PROFILE_ID, bundle());
    const staged = fs.readdirSync(
      path.join(tmpDir, 'profile-store', 'staging'),
    )[0];
    store.publishMigration(staged.replace(/\.json$/, ''), PROFILE_ID);

    const listed = store.listVault(PROFILE_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('password');
    expect(
      store.lookupVault(PROFILE_ID, 'https://example.test')[0].password,
    ).toBe('private-password');
    expect(() =>
      store.listVault(PROFILE_ID, { profileId: OTHER_PROFILE_ID }),
    ).toThrowError(
      expect.objectContaining({ code: 'PROFILE_RPC_PROFILE_MISMATCH' }),
    );
  });
});
