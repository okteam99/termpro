import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROFILE_CONTINUITY_JOURNAL_DIRECTORY,
  ProfileContinuityJournal,
  ProfileContinuityJournalError,
  type PendingContinuityOperation,
  type ProfileContinuityAuthority,
  type ProfileContinuityJournalSafeStorage,
} from '../profileContinuityJournal';

const PROFILE_ID = 'a'.repeat(32);
const DEVICE_ID = 'b'.repeat(43);
const AUTHORITY: ProfileContinuityAuthority = {
  hostId: 'remote-host-1',
  epoch: 7,
};
const OPERATION_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_OPERATION_ID = '10000000-0000-4000-8000-000000000002';
const SENTINEL_DOMAIN = 'private.accounts.example.test';
const SENTINEL_NAME = 'BL008-secret-cookie-name';
const SENTINEL_VALUE = 'BL008-secret-cookie-value';

interface TestIdentity {
  domain: string;
  path: string;
  name: string;
}

interface TestChange {
  identity: TestIdentity;
  value: string;
}

class TestSafeStorage implements ProfileContinuityJournalSafeStorage {
  available = true;
  failDecrypt = false;

  constructor(private readonly key = randomBytes(32)) {}

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(plaintext: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  }

  decryptString(encrypted: Buffer): string {
    if (this.failDecrypt) throw new Error('fixture decrypt failure');
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

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentity(value: unknown): value is TestIdentity {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['domain', 'path', 'name']) &&
    typeof value.domain === 'string' &&
    value.domain.length > 0 &&
    typeof value.path === 'string' &&
    value.path.startsWith('/') &&
    typeof value.name === 'string' &&
    value.name.length > 0
  );
}

function isChange(value: unknown): value is TestChange {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['identity', 'value']) &&
    isIdentity(value.identity) &&
    typeof value.value === 'string' &&
    value.value.length > 0
  );
}

function operation(
  operationId = OPERATION_ID,
  value = SENTINEL_VALUE,
): PendingContinuityOperation<TestChange> {
  return {
    deviceId: DEVICE_ID,
    operationId,
    profileEpoch: AUTHORITY.epoch,
    baseRevision: 0,
    change: {
      identity: {
        domain: SENTINEL_DOMAIN,
        path: '/login',
        name: SENTINEL_NAME,
      },
      value,
    },
  };
}

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof ProfileContinuityJournalError
      ? error.code
      : 'UNEXPECTED_ERROR';
  }
}

let tmpDir: string;
let safeStorage: TestSafeStorage;
let journal: ProfileContinuityJournal<TestIdentity, TestChange>;

function createJournal(
  storage: ProfileContinuityJournalSafeStorage = safeStorage,
): ProfileContinuityJournal<TestIdentity, TestChange> {
  return new ProfileContinuityJournal({
    userDataDir: () => tmpDir,
    safeStorage: storage,
    validateIdentity: isIdentity,
    identityKey: (identity) =>
      `${identity.domain}\0${identity.path}\0${identity.name}`,
    validateChange: isChange,
    validatePartition: (partition, profileId) =>
      new RegExp(
        `^persist:profile-${profileId}-(?:local|[A-Za-z0-9_-]+)$`,
      ).test(partition),
  });
}

function journalFile(): string {
  return path.join(
    tmpDir,
    PROFILE_CONTINUITY_JOURNAL_DIRECTORY,
    `${PROFILE_ID}.journal`,
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'okwork-profile-continuity-journal-'),
  );
  safeStorage = new TestSafeStorage();
  journal = createJournal();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ProfileContinuityJournal', () => {
  it('test_AC6_keeps_pending_operation_ids_stable_across_process_restarts', () => {
    const empty = journal.load(PROFILE_ID, AUTHORITY);
    const saved = journal.appendPending(empty, operation());

    expect(saved.pending).toEqual([operation()]);
    const restarted = createJournal();
    expect(restarted.load(PROFILE_ID, AUTHORITY)).toEqual(saved);
    expect(restarted.load(PROFILE_ID, AUTHORITY).pending[0].operationId).toBe(
      OPERATION_ID,
    );
  });

  it('test_AC7_encrypts_the_entire_journal_with_private_atomic_storage', () => {
    const empty = journal.load(PROFILE_ID, AUTHORITY);
    const first = journal.appendPending(empty, operation());
    const file = journalFile();
    const directory = path.dirname(file);
    const firstInode = fs.statSync(file).ino;

    const serialized = fs.readFileSync(file, 'utf8');
    expect(serialized).not.toContain(SENTINEL_DOMAIN);
    expect(serialized).not.toContain(SENTINEL_NAME);
    expect(serialized).not.toContain(SENTINEL_VALUE);
    expect(serialized).not.toContain(OPERATION_ID);
    expect(Object.keys(JSON.parse(serialized) as object).sort()).toEqual([
      'ciphertext',
      'version',
    ]);
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const replaced = journal.save({
      ...first,
      seededPartitions: [`persist:profile-${PROFILE_ID}-local`],
    });
    expect(fs.statSync(file).ino).not.toBe(firstInode);
    expect(
      fs
        .readdirSync(directory)
        .filter((name) => name.includes('.tmp-')),
    ).toEqual([]);
    expect(createJournal().load(PROFILE_ID, AUTHORITY)).toEqual(replaced);
  });

  it('enumerates validated historical partitions without knowing the old authority', () => {
    const historicalPartition =
      `persist:profile-${PROFILE_ID}-removed-remote-host`;
    expect(journal.listSeededPartitions(PROFILE_ID)).toEqual([]);

    journal.save({
      ...journal.load(PROFILE_ID, AUTHORITY),
      seededPartitions: [historicalPartition],
    });

    expect(createJournal().listSeededPartitions(PROFILE_ID)).toEqual([
      historicalPartition,
    ]);
    expect(
      errorCode(() =>
        journal.load(PROFILE_ID, { ...AUTHORITY, epoch: AUTHORITY.epoch + 1 }),
      ),
    ).toBe('CONTINUITY_JOURNAL_AUTHORITY_MISMATCH');
    expect(journal.listSeededPartitions('c'.repeat(32))).toEqual([]);
  });

  it('fails closed for unavailable encryption, decryption failure, and corruption without overwriting disk', () => {
    const saved = journal.appendPending(
      journal.load(PROFILE_ID, AUTHORITY),
      operation(),
    );
    const encrypted = fs.readFileSync(journalFile(), 'utf8');

    safeStorage.available = false;
    expect(errorCode(() => journal.load(PROFILE_ID, AUTHORITY))).toBe(
      'CONTINUITY_JOURNAL_ENCRYPTION_UNAVAILABLE',
    );
    expect(errorCode(() => journal.save(saved))).toBe(
      'CONTINUITY_JOURNAL_ENCRYPTION_UNAVAILABLE',
    );
    expect(fs.readFileSync(journalFile(), 'utf8')).toBe(encrypted);

    safeStorage.available = true;
    safeStorage.failDecrypt = true;
    expect(errorCode(() => journal.load(PROFILE_ID, AUTHORITY))).toBe(
      'CONTINUITY_JOURNAL_DECRYPT_FAILED',
    );
    expect(errorCode(() => journal.listSeededPartitions(PROFILE_ID))).toBe(
      'CONTINUITY_JOURNAL_DECRYPT_FAILED',
    );
    expect(fs.readFileSync(journalFile(), 'utf8')).toBe(encrypted);

    safeStorage.failDecrypt = false;
    fs.writeFileSync(journalFile(), '{"version":1,"ciphertext":"bad"}', {
      mode: 0o600,
    });
    const corrupt = fs.readFileSync(journalFile(), 'utf8');
    expect(errorCode(() => journal.load(PROFILE_ID, AUTHORITY))).toBe(
      'CONTINUITY_JOURNAL_CORRUPT',
    );
    expect(errorCode(() => journal.listSeededPartitions(PROFILE_ID))).toBe(
      'CONTINUITY_JOURNAL_CORRUPT',
    );
    expect(fs.readFileSync(journalFile(), 'utf8')).toBe(corrupt);
  });

  it('strictly validates scope and never accepts a journal from another authority', () => {
    const saved = journal.appendPending(
      journal.load(PROFILE_ID, AUTHORITY),
      operation(),
    );
    expect(
      errorCode(() =>
        journal.load(PROFILE_ID, { ...AUTHORITY, epoch: AUTHORITY.epoch + 1 }),
      ),
    ).toBe('CONTINUITY_JOURNAL_AUTHORITY_MISMATCH');
    expect(
      errorCode(() =>
        journal.save({
          ...saved,
          seededPartitions: ['not-a-browser-partition'],
        }),
      ),
    ).toBe('CONTINUITY_JOURNAL_INVALID_INPUT');
    expect(createJournal().load(PROFILE_ID, AUTHORITY)).toEqual(saved);
  });

  it('deduplicates stable operations and removes them only after matching confirmation', () => {
    const first = journal.appendPending(
      journal.load(PROFILE_ID, AUTHORITY),
      operation(),
    );
    const duplicate = journal.appendPending(first, operation());
    expect(duplicate.pending).toHaveLength(1);
    expect(
      errorCode(() =>
        journal.appendPending(duplicate, operation(OPERATION_ID, 'changed')),
      ),
    ).toBe('CONTINUITY_JOURNAL_INVALID_INPUT');

    const unrelatedConfirmation = journal.confirmPending(duplicate, {
      operationIds: [OTHER_OPERATION_ID],
      confirmedRevision: 0,
      identityRevisionUpdates: [],
    });
    expect(unrelatedConfirmation.pending).toEqual([operation()]);
    expect(createJournal().load(PROFILE_ID, AUTHORITY).pending).toEqual([
      operation(),
    ]);

    const confirmed = journal.confirmPending(unrelatedConfirmation, {
      operationIds: [OPERATION_ID],
      confirmedRevision: 0,
      identityRevisionUpdates: [
        {
          identity: operation().change.identity,
          revision: 9,
        },
      ],
    });
    expect(confirmed).toMatchObject({
      confirmedRevision: 0,
      pending: [],
      identityRevisions: [{ revision: 9 }],
    });
    expect(createJournal().load(PROFILE_ID, AUTHORITY)).toEqual(confirmed);
  });

  it('deletes a profile journal durably and idempotently', () => {
    journal.appendPending(
      journal.load(PROFILE_ID, AUTHORITY),
      operation(),
    );
    expect(journal.delete(PROFILE_ID)).toBe(true);
    expect(fs.existsSync(journalFile())).toBe(false);
    expect(journal.delete(PROFILE_ID)).toBe(false);
    expect(journal.load(PROFILE_ID, AUTHORITY).pending).toEqual([]);
  });
});
