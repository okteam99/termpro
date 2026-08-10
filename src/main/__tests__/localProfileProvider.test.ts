import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserProfileStore } from '../browserProfileStore';
import {
  LocalPasswordVault,
  type PasswordVaultSafeStorage,
} from '../localPasswordVault';
import { LocalProfileProvider } from '../localProfileProvider';
import { profileBundleVerificationDigest } from '../profileMigrationCoordinator';
import { JsonFileSettingsStore } from '../settingsStore';
import type { ProfileBundleV1 } from '../../shared/remoteProfileStore';

const PROFILE_ID = 'e'.repeat(32);
const ENTRY_ID = '30000000-0000-4000-8000-000000000001';
const OPERATION_ID = '40000000-0000-4000-8000-000000000001';
const SENTINEL = 'local-staging-password-sentinel';

class TestSafeStorage implements PasswordVaultSafeStorage {
  readonly key = randomBytes(32);
  available = true;

  isEncryptionAvailable(): boolean {
    return this.available;
  }
  encryptString(plaintext: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  }
  decryptString(encrypted: Buffer): string {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      encrypted.subarray(0, 12),
    );
    decipher.setAuthTag(encrypted.subarray(12, 28));
    return Buffer.concat([
      decipher.update(encrypted.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
  }
}

let tmpDir: string;
let safeStorage: TestSafeStorage;
let profiles: BrowserProfileStore;
let vault: LocalPasswordVault;
let provider: LocalProfileProvider;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'okwork-local-profile-provider-'),
  );
  safeStorage = new TestSafeStorage();
  profiles = new BrowserProfileStore(
    new JsonFileSettingsStore({
      userDataDir: () => tmpDir,
      file: 'browser-profiles.json',
    }),
  );
  vault = new LocalPasswordVault({ userDataDir: tmpDir, safeStorage });
  provider = new LocalProfileProvider({
    userDataDir: tmpDir,
    profiles,
    vault,
    stagingCrypto: safeStorage,
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function migrationBundle(profileId = PROFILE_ID): ProfileBundleV1 {
  return {
    version: 1,
    profile: {
      id: profileId,
      name: profileId === 'default' ? 'Recovered built-in' : 'Recovered custom',
      userAgent: 'UA/remote-preserved',
      createdAt: profileId === 'default' ? 0 : 5,
    },
    credentials: [
      {
        id: ENTRY_ID,
        profileId,
        origin: 'https://example.test',
        username: 'alice',
        password: SENTINEL,
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: 1,
      },
    ],
  };
}

describe('LocalProfileProvider', () => {
  it('uses the real BrowserProfileStore and LocalPasswordVault as one bundle provider', async () => {
    const created = await provider.createProfile({ name: 'Local profile' });
    vault.upsert({
      profileId: created.id,
      origin: 'https://example.test',
      username: 'alice',
      password: SENTINEL,
      now: 10,
    });
    const exported = await provider.readBundle(created.id);
    expect(exported.profile).toMatchObject({
      id: created.id,
      name: 'Local profile',
    });
    expect(exported.credentials).toEqual([
      expect.objectContaining({ password: SENTINEL }),
    ]);
    expect(
      JSON.stringify(await provider.listMetadata(created.id)),
    ).not.toContain(SENTINEL);
  });

  it('encrypts 0600 staging, verifies canonical plaintext, and publishes into the real stores', async () => {
    const bundle = migrationBundle();
    await provider.stage(OPERATION_ID, bundle);
    const stagingDirectory = path.join(
      tmpDir,
      'browser-profile-migration-staging',
    );
    const stagingFile = path.join(stagingDirectory, `${OPERATION_ID}.json`);
    expect(fs.readFileSync(stagingFile, 'utf8')).not.toContain(SENTINEL);
    expect(fs.statSync(stagingDirectory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(stagingFile).mode & 0o777).toBe(0o600);
    const nonce = Buffer.alloc(32, 9);
    expect(await provider.verify(OPERATION_ID, nonce)).toEqual(
      profileBundleVerificationDigest(bundle, nonce),
    );

    await provider.publish(OPERATION_ID, PROFILE_ID);
    expect(fs.existsSync(stagingFile)).toBe(false);
    expect(profiles.get(PROFILE_ID)).toEqual(bundle.profile);
    expect(vault.getDecrypted(PROFILE_ID, ENTRY_ID).password).toBe(SENTINEL);
  });

  it('persists an imported Default Profile config without making normal Default edits mutable', async () => {
    const bundle = migrationBundle('default');
    await provider.stage(OPERATION_ID, bundle);
    await provider.publish(OPERATION_ID, 'default');
    expect(await provider.getProfile('default')).toEqual(bundle.profile);
    await expect(
      provider.writeProfile({ ...bundle.profile, name: 'User edit' }),
    ).rejects.toMatchObject({
      code: 'PROFILE_STORAGE_INVALID_INPUT',
    });
    const defaultFile = path.join(tmpDir, 'browser-default-profile.json');
    expect(fs.statSync(defaultFile).mode & 0o777).toBe(0o600);

    const restarted = new LocalProfileProvider({
      userDataDir: tmpDir,
      profiles,
      vault,
      stagingCrypto: safeStorage,
    });
    expect(await restarted.getProfile('default')).toEqual(bundle.profile);
    expect(
      (await restarted.readBundle('default')).credentials[0].password,
    ).toBe(SENTINEL);
  });

  it('fails closed when staging encryption is unavailable', async () => {
    safeStorage.available = false;
    await expect(
      provider.stage(OPERATION_ID, migrationBundle()),
    ).rejects.toMatchObject({
      code: 'PROFILE_STORAGE_ENCRYPTION_UNAVAILABLE',
    });
    expect(
      fs.existsSync(path.join(tmpDir, 'browser-profile-migration-staging')),
    ).toBe(false);
  });
});
