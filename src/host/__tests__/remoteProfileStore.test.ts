import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContinuityOperation } from '../../shared/profileContinuity';
import type { ProfileBundleV1 } from '../../shared/remoteProfileStore';
import {
  canonicalRemoteProfileJson,
  RemoteProfileStore,
} from '../remoteProfileStore';

const PROFILE_ID = 'a'.repeat(32);
const OTHER_PROFILE_ID = 'b'.repeat(32);
const CLIENT_ID = randomBytes(32).toString('base64url');
const OTHER_CLIENT_ID = randomBytes(32).toString('base64url');
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

function cookieOperation(input: {
  deviceId: string;
  operationId?: string;
  baseRevision: number;
  name?: string;
  value?: string;
}): ContinuityOperation {
  return {
    deviceId: input.deviceId,
    operationId: input.operationId ?? randomUUID(),
    profileEpoch: 0,
    baseRevision: input.baseRevision,
    change: {
      kind: 'upsert',
      identity: {
        domain: 'example.test',
        hostOnly: true,
        path: '/',
        name: input.name ?? 'login',
      },
      value: input.value ?? 'secret-value',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 2_000_000_000,
    },
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

describe('RemoteProfileStore Cookie continuity', () => {
  it('test_AC3_cookie_operations_are_idempotent_and_converge_by_host_revision', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    store.saveProfile(PROFILE_ID, bundle().profile);
    const firstOperationId = randomUUID();
    const first = store.pushContinuity(
      PROFILE_ID,
      cookieOperation({
        deviceId: CLIENT_ID,
        operationId: firstOperationId,
        baseRevision: 0,
        value: 'device-a',
      }),
    );
    const second = store.pushContinuity(
      PROFILE_ID,
      cookieOperation({
        deviceId: OTHER_CLIENT_ID,
        baseRevision: 0,
        value: 'device-b',
      }),
    );
    const duplicate = store.pushContinuity(
      PROFILE_ID,
      cookieOperation({
        deviceId: CLIENT_ID,
        operationId: firstOperationId,
        baseRevision: 0,
        value: 'mutated-retry-must-not-apply',
      }),
    );
    const independent = store.pushContinuity(
      PROFILE_ID,
      cookieOperation({
        deviceId: CLIENT_ID,
        baseRevision: 0,
        name: 'other-login',
      }),
    );

    expect(first).toMatchObject({ revision: 1, outcome: 'accepted' });
    expect(second).toMatchObject({ revision: 2, outcome: 'conflict_won' });
    expect(duplicate).toMatchObject({
      operationId: firstOperationId,
      revision: 1,
      outcome: 'duplicate',
      current: { value: 'device-a' },
    });
    expect(independent).toMatchObject({ revision: 3, outcome: 'accepted' });

    const page = store.pullContinuity(PROFILE_ID, {
      fromRevision: 0,
      pageBytes: 512 * 1024,
    });
    expect(page).toMatchObject({ nextRevision: 3, hasMore: false });
    expect(page.records).toHaveLength(2);
    expect(page.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revision: 2, value: 'device-b' }),
        expect.objectContaining({ revision: 3, value: 'secret-value' }),
      ]),
    );
  });

  it('test_AC4_tombstone_rejects_stale_cookie_without_treating_eviction_as_delete', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    store.saveProfile(PROFILE_ID, bundle().profile);
    store.pushContinuity(
      PROFILE_ID,
      cookieOperation({ deviceId: CLIENT_ID, baseRevision: 0 }),
    );
    const tombstone = store.pushContinuity(PROFILE_ID, {
      deviceId: CLIENT_ID,
      operationId: randomUUID(),
      profileEpoch: 0,
      baseRevision: 1,
      change: {
        kind: 'tombstone',
        identity: {
          domain: 'example.test',
          hostOnly: true,
          path: '/',
          name: 'login',
        },
      },
    });
    const stale = store.pushContinuity(
      PROFILE_ID,
      cookieOperation({
        deviceId: OTHER_CLIENT_ID,
        baseRevision: 1,
        value: 'stale-offline-value',
      }),
    );
    const fresh = store.pushContinuity(
      PROFILE_ID,
      cookieOperation({
        deviceId: OTHER_CLIENT_ID,
        baseRevision: 2,
        value: 'new-login-after-hydration',
      }),
    );

    expect(tombstone).toMatchObject({ revision: 2, outcome: 'accepted' });
    expect(stale).toMatchObject({
      revision: 2,
      outcome: 'stale_rejected',
      current: { kind: 'tombstone' },
    });
    expect(fresh).toMatchObject({
      revision: 3,
      outcome: 'accepted',
      current: { value: 'new-login-after-hydration' },
    });
    expect(() =>
      store.pushContinuity(PROFILE_ID, {
        deviceId: CLIENT_ID,
        operationId: randomUUID(),
        profileEpoch: 0,
        baseRevision: 3,
        change: {
          kind: 'evicted',
          identity: {
            domain: 'example.test',
            hostOnly: true,
            path: '/',
            name: 'login',
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'PROFILE_RPC_INVALID_INPUT' }),
    );
    expect(
      store.pullContinuity(PROFILE_ID, {
        fromRevision: 2,
        pageBytes: 512 * 1024,
      }).records,
    ).toEqual([
      expect.objectContaining({
        revision: 3,
        kind: 'upsert',
        value: 'new-login-after-hydration',
      }),
    ]);
  });

  it('test_AC7_cookie_authority_and_pending_journal_are_encrypted_with_private_permissions', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    store.saveProfile(PROFILE_ID, bundle().profile);
    store.pushContinuity(
      PROFILE_ID,
      cookieOperation({
        deviceId: CLIENT_ID,
        baseRevision: 0,
        name: 'private-cookie-name',
        value: 'private-cookie-value',
      }),
    );

    const root = path.join(tmpDir, 'profile-store');
    const directory = path.join(root, 'continuity');
    const file = path.join(directory, `${PROFILE_ID}.json`);
    const ciphertext = fs.readFileSync(file, 'utf8');
    expect(ciphertext).not.toContain('private-cookie-name');
    expect(ciphertext).not.toContain('example.test');
    expect(ciphertext).not.toContain('private-cookie-value');
    expect(JSON.parse(ciphertext)).toMatchObject({
      version: 1,
      algorithm: 'aes-256-gcm',
    });
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(
      fs
        .readdirSync(root, { recursive: true })
        .map(String)
        .filter((name) => name.includes('.tmp-')),
    ).toEqual([]);

    const envelope = JSON.parse(ciphertext) as { ciphertext: string };
    const last = envelope.ciphertext.at(-1);
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    fs.writeFileSync(file, JSON.stringify(envelope), { mode: 0o600 });
    expect(() =>
      new RemoteProfileStore({ dataDir: tmpDir }).pullContinuity(PROFILE_ID, {
        fromRevision: 0,
        pageBytes: 512 * 1024,
      }),
    ).toThrowError(expect.objectContaining({ code: 'PROFILE_RPC_CORRUPT' }));
  });

  it('persists a monotonic retire epoch before leaving only the lifecycle fence', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    store.saveProfile(PROFILE_ID, bundle().profile);
    store.pushContinuity(
      PROFILE_ID,
      cookieOperation({ deviceId: CLIENT_ID, baseRevision: 0 }),
    );
    const operationId = randomUUID();
    const retired = store.retireProfile(PROFILE_ID, {
      operationId,
      expectedEpoch: 0,
      kind: 'moved',
      movedTo: 'local',
    });

    expect(retired).toEqual({
      operationId,
      profileId: PROFILE_ID,
      epoch: 1,
      lifecycle: 'moved',
      movedTo: 'local',
    });
    expect(store.getProfileLifecycle(PROFILE_ID)).toEqual({
      profileId: PROFILE_ID,
      epoch: 1,
      lifecycle: 'moved',
      movedTo: 'local',
    });
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          'profile-store',
          'profiles',
          `${PROFILE_ID}.json`,
        ),
      ),
    ).toBe(false);
    expect(
      store.retireProfile(PROFILE_ID, {
        operationId,
        expectedEpoch: 0,
        kind: 'moved',
        movedTo: 'local',
      }),
    ).toEqual(retired);
    expect(() =>
      store.pushContinuity(
        PROFILE_ID,
        cookieOperation({ deviceId: CLIENT_ID, baseRevision: 1 }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROFILE_MOVED' }));
    expect(() => store.saveProfile(PROFILE_ID, bundle().profile)).toThrowError(
      expect.objectContaining({ code: 'PROFILE_MOVED' }),
    );
  });

  it('bounds pull pages and rejects an oversized Cookie item with a fixed code', () => {
    const store = new RemoteProfileStore({ dataDir: tmpDir });
    store.saveProfile(PROFILE_ID, bundle().profile);
    for (let index = 0; index < 11; index += 1) {
      store.pushContinuity(
        PROFILE_ID,
        cookieOperation({
          deviceId: CLIENT_ID,
          baseRevision: 0,
          name: `login-${index}`,
          value: 'x'.repeat(50_000),
        }),
      );
    }
    const first = store.pullContinuity(PROFILE_ID, {
      fromRevision: 0,
      pageBytes: 512 * 1024,
    });
    expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThanOrEqual(
      512 * 1024,
    );
    expect(first.hasMore).toBe(true);
    const second = store.pullContinuity(PROFILE_ID, {
      fromRevision: first.nextRevision,
      pageBytes: 512 * 1024,
    });
    expect(second.hasMore).toBe(false);
    expect([...first.records, ...second.records]).toHaveLength(11);

    expect(() =>
      store.pushContinuity(
        PROFILE_ID,
        cookieOperation({
          deviceId: CLIENT_ID,
          baseRevision: 0,
          name: 'oversized',
          value: 'x'.repeat(64 * 1024),
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'PROFILE_CONTINUITY_ITEM_TOO_LARGE' }),
    );
  });

  it('test_AC5_AC10_continuity_migration_is_paged_verified_fenced_and_idempotent', () => {
    const sourceDir = path.join(tmpDir, 'source');
    const targetDir = path.join(tmpDir, 'target');
    const source = new RemoteProfileStore({ dataDir: sourceDir });
    const target = new RemoteProfileStore({ dataDir: targetDir });
    source.saveProfile(PROFILE_ID, bundle().profile);
    source.pushContinuity(
      PROFILE_ID,
      cookieOperation({ deviceId: CLIENT_ID, baseRevision: 0 }),
    );
    source.pushContinuity(
      PROFILE_ID,
      cookieOperation({
        deviceId: CLIENT_ID,
        baseRevision: 0,
        name: 'other-login',
      }),
    );

    const migrationId = randomUUID();
    target.stageMigration(migrationId, PROFILE_ID, source.exportBundle(PROFILE_ID));
    const initialPage = source.pullContinuity(PROFILE_ID, {
      fromRevision: 0,
      pageBytes: 512 * 1024,
    });
    const staged = target.stageContinuityMigration(PROFILE_ID, {
      operationId: migrationId,
      page: initialPage,
    });
    expect(staged).toMatchObject({
      operationId: migrationId,
      confirmedRevision: 2,
      stagedCount: 2,
      duplicate: false,
    });
    expect(
      target.stageContinuityMigration(PROFILE_ID, {
        operationId: migrationId,
        page: initialPage,
      }),
    ).toMatchObject({ confirmedRevision: 2, duplicate: true });
    expect(target.discoverProfiles(CLIENT_ID, 'g1')).toEqual([]);

    const nonce = randomBytes(32).toString('base64url');
    const frozen = source.freezeContinuityMigration(PROFILE_ID, {
      operationId: migrationId,
      expectedEpoch: 0,
      nonce,
    });
    expect(frozen).toMatchObject({
      lifecycle: 'moving',
      revision: 2,
      epoch: 0,
    });
    expect(
      source.freezeContinuityMigration(PROFILE_ID, {
        operationId: migrationId,
        expectedEpoch: 0,
        nonce: randomBytes(32).toString('base64url'),
      }),
    ).toEqual(frozen);
    expect(() =>
      source.pushContinuity(
        PROFILE_ID,
        cookieOperation({ deviceId: CLIENT_ID, baseRevision: 1 }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROFILE_MOVED' }));

    const finalPage = source.pullContinuity(PROFILE_ID, {
      fromRevision: initialPage.nextRevision,
      pageBytes: 512 * 1024,
    });
    target.stageContinuityMigration(PROFILE_ID, {
      operationId: migrationId,
      page: finalPage,
    });
    const verified = target.verifyContinuityMigration(PROFILE_ID, {
      operationId: migrationId,
      nonce,
    });
    expect(verified.digest).toBe(frozen.digest);
    const published = target.publishContinuityMigration(PROFILE_ID, {
      operationId: migrationId,
      expectedRevision: frozen.revision,
      verifiedDigest: verified.digest,
    });
    expect(published).toMatchObject({ lifecycle: 'moving', revision: 2 });
    expect(
      target.publishContinuityMigration(PROFILE_ID, {
        operationId: migrationId,
        expectedRevision: frozen.revision,
        verifiedDigest: verified.digest,
      }),
    ).toEqual(published);

    const retired = source.retireProfile(PROFILE_ID, {
      operationId: migrationId,
      expectedEpoch: 0,
      kind: 'moved',
      movedTo: 'remote',
    });
    expect(retired).toMatchObject({ lifecycle: 'moved', epoch: 1 });
    target.publishMigration(migrationId, PROFILE_ID);
    target.publishMigration(migrationId, PROFILE_ID);
    expect(target.discoverProfiles(CLIENT_ID, 'g1')).toEqual([]);
    expect(() =>
      target.pullContinuity(PROFILE_ID, {
        fromRevision: 0,
        pageBytes: 512 * 1024,
      }),
    ).toThrowError(expect.objectContaining({ code: 'PROFILE_MOVED' }));
    const activated = target.activateContinuityMigration(PROFILE_ID, {
      operationId: migrationId,
      epoch: retired.epoch,
    });
    expect(activated).toMatchObject({ lifecycle: 'active', epoch: 1 });
    expect(
      target.activateContinuityMigration(PROFILE_ID, {
        operationId: migrationId,
        epoch: retired.epoch,
      }),
    ).toEqual(activated);
    expect(target.discoverProfiles(CLIENT_ID, 'g1')).toHaveLength(1);
    expect(
      target.pullContinuity(PROFILE_ID, {
        fromRevision: 0,
        pageBytes: 512 * 1024,
      }).records,
    ).toHaveLength(2);
    expect(() =>
      source.pushContinuity(
        PROFILE_ID,
        cookieOperation({ deviceId: CLIENT_ID, baseRevision: 2 }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PROFILE_MOVED' }));
  });
});
