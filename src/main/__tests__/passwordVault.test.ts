import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalPasswordVault,
  PasswordVaultError,
  type PasswordVaultLogger,
  type PasswordVaultSafeStorage,
} from '../localPasswordVault';

const PROFILE_A = 'a'.repeat(32);
const PROFILE_B = 'b'.repeat(32);
const ORIGIN = 'https://accounts.example.test';
const SENTINEL_PASSWORD = 'BL006-password-sentinel-!42';

class TestSafeStorage implements PasswordVaultSafeStorage {
  available = true;
  failDecrypt = false;
  private readonly key = randomBytes(32);

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
    if (this.failDecrypt)
      throw new Error('test decrypt failure with no secret material');
    const nonce = encrypted.subarray(0, 12);
    const tag = encrypted.subarray(12, 28);
    const ciphertext = encrypted.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof PasswordVaultError
      ? error.code
      : 'UNEXPECTED_ERROR';
  }
}

let tmpDir: string;
let safeStorage: TestSafeStorage;
let logger: PasswordVaultLogger;
let warn: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.fn>;
let vault: LocalPasswordVault;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-password-vault-'));
  safeStorage = new TestSafeStorage();
  warn = vi.fn();
  error = vi.fn();
  logger = { warn, error };
  vault = new LocalPasswordVault({ userDataDir: tmpDir, safeStorage, logger });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('LocalPasswordVault', () => {
  it('test_AC5_persists_encrypted_credentials_and_fails_closed', () => {
    const saved = vault.upsert({
      profileId: PROFILE_A,
      origin: ORIGIN,
      username: '  alice@example.test  ',
      password: SENTINEL_PASSWORD,
      now: 100,
    });
    expect(saved.kind).toBe('saved');
    expect(saved.metadata).toMatchObject({
      profileId: PROFILE_A,
      origin: ORIGIN,
      username: 'alice@example.test',
      createdAt: 100,
      updatedAt: 100,
      lastUsedAt: 100,
    });

    const directory = path.join(tmpDir, 'browser-password-vault');
    const file = path.join(directory, `${PROFILE_A}.json`);
    const serialized = fs.readFileSync(file, 'utf8');
    expect(serialized).not.toContain(SENTINEL_PASSWORD);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(
      fs.readdirSync(directory).filter((name) => name.includes('.tmp-')),
    ).toEqual([]);

    const restarted = new LocalPasswordVault({
      userDataDir: () => tmpDir,
      safeStorage,
      logger,
    });
    expect(restarted.lookup(PROFILE_A, ORIGIN)).toEqual([
      { ...saved.metadata, password: SENTINEL_PASSWORD },
    ]);
    expect(restarted.getDecrypted(PROFILE_A, saved.metadata.id).password).toBe(
      SENTINEL_PASSWORD,
    );

    safeStorage.failDecrypt = true;
    expect(errorCode(() => restarted.lookup(PROFILE_A, ORIGIN))).toBe(
      'VAULT_DECRYPT_FAILED',
    );
    expect(
      errorCode(() => restarted.getDecrypted(PROFILE_A, saved.metadata.id)),
    ).toBe('VAULT_DECRYPT_FAILED');
    expect(restarted.listMetadata({ profileId: PROFILE_A })).toEqual([
      saved.metadata,
    ]);
    expect(
      JSON.stringify([...warn.mock.calls, ...error.mock.calls]),
    ).not.toContain(SENTINEL_PASSWORD);
  });

  it('upsert keeps account identity stable, only changes updatedAt for a changed password', () => {
    const first = vault.upsert({
      profileId: PROFILE_A,
      origin: ORIGIN,
      username: 'alice',
      password: 'old-password',
      now: 10,
    });
    const file = path.join(
      tmpDir,
      'browser-password-vault',
      `${PROFILE_A}.json`,
    );
    const cipherBefore = (
      JSON.parse(fs.readFileSync(file, 'utf8')) as {
        entries: Array<{ encryptedPassword: string }>;
      }
    ).entries[0].encryptedPassword;

    const same = vault.upsert({
      profileId: PROFILE_A,
      origin: ORIGIN,
      username: 'alice',
      password: 'old-password',
      now: 20,
    });
    const cipherAfterSame = (
      JSON.parse(fs.readFileSync(file, 'utf8')) as {
        entries: Array<{ encryptedPassword: string }>;
      }
    ).entries[0].encryptedPassword;
    expect(same).toMatchObject({
      kind: 'updated',
      metadata: {
        id: first.metadata.id,
        createdAt: 10,
        updatedAt: 10,
        lastUsedAt: 20,
      },
    });
    expect(cipherAfterSame).toBe(cipherBefore);

    const changed = vault.upsert({
      profileId: PROFILE_A,
      origin: ORIGIN,
      username: 'alice',
      password: 'new-password',
      now: 30,
    });
    expect(changed).toMatchObject({
      kind: 'updated',
      metadata: {
        id: first.metadata.id,
        createdAt: 10,
        updatedAt: 30,
        lastUsedAt: 30,
      },
    });
    expect(vault.getDecrypted(PROFILE_A, first.metadata.id).password).toBe(
      'new-password',
    );
  });

  it('lists and searches metadata across profiles without exposing passwords', () => {
    const older = vault.upsert({
      profileId: PROFILE_A,
      origin: ORIGIN,
      username: 'alice',
      password: 'password-a',
      now: 10,
    });
    const newer = vault.upsert({
      profileId: PROFILE_B,
      origin: 'https://work.example.test:8443',
      username: 'bob',
      password: 'password-b',
      now: 20,
    });

    expect(vault.listMetadata().map((entry) => entry.id)).toEqual([
      newer.metadata.id,
      older.metadata.id,
    ]);
    expect(vault.listMetadata({ profileId: PROFILE_A })).toEqual([
      older.metadata,
    ]);
    expect(vault.listMetadata({ query: 'WORK.EXAMPLE' })).toEqual([
      newer.metadata,
    ]);
    expect(vault.lookup(PROFILE_A, 'https://different.example.test')).toEqual(
      [],
    );
  });

  it('rejects unavailable encryption before saving or decrypting and never writes plaintext', () => {
    safeStorage.available = false;
    expect(vault.isAvailable()).toBe(false);
    expect(
      errorCode(() =>
        vault.upsert({
          profileId: PROFILE_A,
          origin: ORIGIN,
          username: 'alice',
          password: SENTINEL_PASSWORD,
        }),
      ),
    ).toBe('VAULT_ENCRYPTION_UNAVAILABLE');
    expect(errorCode(() => vault.lookup(PROFILE_A, ORIGIN))).toBe(
      'VAULT_ENCRYPTION_UNAVAILABLE',
    );
    expect(errorCode(() => vault.getDecrypted(PROFILE_A, randomUUID()))).toBe(
      'VAULT_ENCRYPTION_UNAVAILABLE',
    );
    expect(fs.existsSync(path.join(tmpDir, 'browser-password-vault'))).toBe(
      false,
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SENTINEL_PASSWORD);
  });

  it('treats malformed or unknown-version documents as corrupt and never overwrites them', () => {
    const directory = path.join(tmpDir, 'browser-password-vault');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${PROFILE_A}.json`);

    // Deliberately bypass the real writer to model a hand-edited/damaged disk document.
    const corrupt =
      '{"version":2,"profileId":"' + PROFILE_A + '","entries":[]}';
    fs.writeFileSync(file, corrupt, { mode: 0o600 });
    expect(errorCode(() => vault.listMetadata({ profileId: PROFILE_A }))).toBe(
      'VAULT_CORRUPT',
    );
    expect(
      errorCode(() =>
        vault.upsert({
          profileId: PROFILE_A,
          origin: ORIGIN,
          username: 'alice',
          password: SENTINEL_PASSWORD,
        }),
      ),
    ).toBe('VAULT_CORRUPT');
    expect(fs.readFileSync(file, 'utf8')).toBe(corrupt);

    fs.writeFileSync(file, '{not-json', 'utf8');
    expect(errorCode(() => vault.lookup(PROFILE_A, ORIGIN))).toBe(
      'VAULT_CORRUPT',
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('{not-json');
  });

  it('deletes one entry or an entire profile idempotently without touching peers', () => {
    const alice = vault.upsert({
      profileId: PROFILE_A,
      origin: ORIGIN,
      username: 'alice',
      password: 'password-a',
      now: 10,
    });
    const bob = vault.upsert({
      profileId: PROFILE_A,
      origin: ORIGIN,
      username: 'bob',
      password: 'password-b',
      now: 20,
    });
    const otherProfile = vault.upsert({
      profileId: PROFILE_B,
      origin: ORIGIN,
      username: 'alice',
      password: 'password-c',
      now: 30,
    });

    expect(vault.deleteEntry(PROFILE_A, alice.metadata.id)).toBe(true);
    expect(vault.deleteEntry(PROFILE_A, alice.metadata.id)).toBe(false);
    expect(vault.lookup(PROFILE_A, ORIGIN).map((entry) => entry.id)).toEqual([
      bob.metadata.id,
    ]);
    expect(
      vault.getDecrypted(PROFILE_B, otherProfile.metadata.id).profileId,
    ).toBe(PROFILE_B);

    expect(vault.deleteProfile(PROFILE_A)).toBe(true);
    expect(vault.deleteProfile(PROFILE_A)).toBe(false);
    expect(vault.listMetadata({ profileId: PROFILE_A })).toEqual([]);
    expect(
      vault.getDecrypted(PROFILE_B, otherProfile.metadata.id).password,
    ).toBe('password-c');
  });

  it('rejects non-canonical identities and unknown entry ids with fixed safe codes', () => {
    expect(
      errorCode(() =>
        vault.upsert({
          profileId: '../escape',
          origin: ORIGIN,
          username: 'alice',
          password: 'password',
        }),
      ),
    ).toBe('VAULT_INVALID_INPUT');
    expect(
      errorCode(() =>
        vault.upsert({
          profileId: PROFILE_A,
          origin: `${ORIGIN}/login`,
          username: 'alice',
          password: 'password',
        }),
      ),
    ).toBe('VAULT_INVALID_INPUT');
    expect(errorCode(() => vault.getDecrypted(PROFILE_A, randomUUID()))).toBe(
      'VAULT_ENTRY_NOT_FOUND',
    );
  });
});
