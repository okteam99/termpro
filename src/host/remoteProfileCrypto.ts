import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ProfileBundleV1,
  RemoteProfileRpcErrorCode,
} from '../shared/remoteProfileStore';

export const REMOTE_PROFILE_DIRECTORY_MODE = 0o700;
export const REMOTE_PROFILE_FILE_MODE = 0o600;

const ENVELOPE_VERSION = 1 as const;
const ALGORITHM = 'aes-256-gcm' as const;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

interface EncryptedProfileEnvelopeV1 {
  version: typeof ENVELOPE_VERSION;
  algorithm: typeof ALGORITHM;
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

const ERROR_MESSAGES: Record<RemoteProfileRpcErrorCode, string> = {
  PROFILE_RPC_FORBIDDEN: 'Remote profile operation is forbidden',
  PROFILE_RPC_INVALID_INPUT: 'Remote profile input is invalid',
  PROFILE_RPC_INCOMPATIBLE: 'Remote profile version is incompatible',
  PROFILE_RPC_ENCRYPTION_UNAVAILABLE:
    'Remote profile encryption is unavailable',
  PROFILE_RPC_CORRUPT: 'Remote profile data is corrupt',
  PROFILE_RPC_PROFILE_MISMATCH:
    'Remote profile scope does not match stored data',
  PROFILE_RPC_NOT_FOUND: 'Remote profile data was not found',
  PROFILE_RPC_IO_FAILED: 'Remote profile storage operation failed',
};

export class RemoteProfileStoreError extends Error {
  readonly code: RemoteProfileRpcErrorCode;

  constructor(code: RemoteProfileRpcErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'RemoteProfileStoreError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function decodeBase64Url(
  value: unknown,
  expectedBytes?: number,
): Buffer | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) return null;
    if (expectedBytes !== undefined && decoded.length !== expectedBytes)
      return null;
    return decoded;
  } catch {
    return null;
  }
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64url');
}

function aad(profileId: string): Buffer {
  return Buffer.from(`okwork-profile-store|v1|${profileId}|bundle`, 'utf8');
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
  } catch {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The caller receives the original fixed storage error below.
      }
    }
    throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
  }
}

/** Ensure a non-symlink private directory and re-tighten its final mode. */
export function ensurePrivateDirectory(directory: string): void {
  try {
    fs.mkdirSync(directory, {
      recursive: true,
      mode: REMOTE_PROFILE_DIRECTORY_MODE,
    });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
    }
    fs.chmodSync(directory, REMOTE_PROFILE_DIRECTORY_MODE);
  } catch (error) {
    if (error instanceof RemoteProfileStoreError) throw error;
    throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
  }
}

/**
 * Durable private-file replacement: same-directory temp, file fsync, rename,
 * final chmod, then directory fsync. Failed temps are never left behind.
 */
export function atomicWritePrivateFile(
  file: string,
  contents: string | Buffer,
): void {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let descriptor: number | undefined;
  let renamed = false;
  try {
    descriptor = fs.openSync(temporary, 'wx', REMOTE_PROFILE_FILE_MODE);
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    renamed = true;
    fs.chmodSync(file, REMOTE_PROFILE_FILE_MODE);
    fsyncDirectory(directory);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original failure.
      }
    }
    if (!renamed) {
      try {
        fs.unlinkSync(temporary);
      } catch (cleanupError) {
        if (!isNodeErrorCode(cleanupError, 'ENOENT')) {
          // Cleanup failure is deliberately not surfaced with a raw path/error.
        }
      }
    }
    if (error instanceof RemoteProfileStoreError) throw error;
    throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
  }
}

export function readPrivateFile(file: string): Buffer | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
    }
    fs.chmodSync(file, REMOTE_PROFILE_FILE_MODE);
    return fs.readFileSync(file);
  } catch (error) {
    if (error instanceof RemoteProfileStoreError) throw error;
    if (isNodeErrorCode(error, 'ENOENT')) return null;
    throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
  }
}

export function deletePrivateFile(file: string): boolean {
  const directory = path.dirname(file);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
    }
    fs.unlinkSync(file);
    fsyncDirectory(directory);
    return true;
  } catch (error) {
    if (error instanceof RemoteProfileStoreError) throw error;
    if (isNodeErrorCode(error, 'ENOENT')) return false;
    throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
  }
}

export class RemoteProfileCrypto {
  private readonly keyPath: string;

  constructor(
    private readonly rootDirectory: string,
    private readonly ciphertextExists: () => boolean,
  ) {
    this.keyPath = path.join(rootDirectory, 'master.key');
  }

  encrypt(profileId: string, bundle: ProfileBundleV1): string {
    const key = this.loadOrCreateKey();
    const nonce = randomBytes(NONCE_BYTES);
    try {
      const cipher = createCipheriv(ALGORITHM, key, nonce);
      cipher.setAAD(aad(profileId));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(bundle), 'utf8'),
        cipher.final(),
      ]);
      const envelope: EncryptedProfileEnvelopeV1 = {
        version: ENVELOPE_VERSION,
        algorithm: ALGORITHM,
        keyId: keyId(key),
        nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
      };
      return JSON.stringify(envelope);
    } catch (error) {
      if (error instanceof RemoteProfileStoreError) throw error;
      throw new RemoteProfileStoreError('PROFILE_RPC_ENCRYPTION_UNAVAILABLE');
    } finally {
      key.fill(0);
    }
  }

  decrypt(profileId: string, serialized: string): unknown {
    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
    }
    const envelope = this.parseEnvelope(raw);
    const key = this.loadExistingKey();
    try {
      if (keyId(key) !== envelope.keyId) {
        throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
      }
      const decipher = createDecipheriv(ALGORITHM, key, envelope.nonce);
      decipher.setAAD(aad(profileId));
      decipher.setAuthTag(envelope.tag);
      const plaintext = Buffer.concat([
        decipher.update(envelope.ciphertext),
        decipher.final(),
      ]).toString('utf8');
      try {
        return JSON.parse(plaintext) as unknown;
      } catch {
        throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
      }
    } catch (error) {
      if (error instanceof RemoteProfileStoreError) throw error;
      throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
    } finally {
      key.fill(0);
    }
  }

  private parseEnvelope(raw: unknown): {
    keyId: string;
    nonce: Buffer;
    ciphertext: Buffer;
    tag: Buffer;
  } {
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, [
        'version',
        'algorithm',
        'keyId',
        'nonce',
        'ciphertext',
        'tag',
      ]) ||
      raw.version !== ENVELOPE_VERSION ||
      raw.algorithm !== ALGORITHM
    ) {
      throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
    }
    const parsedKeyId = decodeBase64Url(raw.keyId, 32);
    const nonce = decodeBase64Url(raw.nonce, NONCE_BYTES);
    const ciphertext = decodeBase64Url(raw.ciphertext);
    const tag = decodeBase64Url(raw.tag, TAG_BYTES);
    if (!parsedKeyId || !nonce || !ciphertext || !tag) {
      throw new RemoteProfileStoreError('PROFILE_RPC_CORRUPT');
    }
    return { keyId: parsedKeyId.toString('base64url'), nonce, ciphertext, tag };
  }

  private loadExistingKey(): Buffer {
    const key = readPrivateFile(this.keyPath);
    if (!key || key.length !== KEY_BYTES) {
      throw new RemoteProfileStoreError('PROFILE_RPC_ENCRYPTION_UNAVAILABLE');
    }
    return Buffer.from(key);
  }

  private loadOrCreateKey(): Buffer {
    const existing = readPrivateFile(this.keyPath);
    if (existing) {
      if (existing.length !== KEY_BYTES) {
        throw new RemoteProfileStoreError('PROFILE_RPC_ENCRYPTION_UNAVAILABLE');
      }
      return Buffer.from(existing);
    }
    if (this.ciphertextExists()) {
      throw new RemoteProfileStoreError('PROFILE_RPC_ENCRYPTION_UNAVAILABLE');
    }

    ensurePrivateDirectory(this.rootDirectory);
    const candidate = randomBytes(KEY_BYTES);
    const temporary = path.join(
      this.rootDirectory,
      `.master.key.tmp-${process.pid}-${randomUUID()}`,
    );
    let linked = false;
    try {
      atomicWritePrivateFile(temporary, candidate);
      try {
        fs.linkSync(temporary, this.keyPath);
        linked = true;
        fs.chmodSync(this.keyPath, REMOTE_PROFILE_FILE_MODE);
        fsyncDirectory(this.rootDirectory);
      } catch (error) {
        if (!isNodeErrorCode(error, 'EEXIST')) throw error;
      }
      deletePrivateFile(temporary);
      if (linked) return candidate;
      candidate.fill(0);
      return this.loadExistingKey();
    } catch (error) {
      try {
        deletePrivateFile(temporary);
      } catch {
        // Keep the original fixed failure code.
      }
      candidate.fill(0);
      if (error instanceof RemoteProfileStoreError) throw error;
      throw new RemoteProfileStoreError('PROFILE_RPC_IO_FAILED');
    }
  }
}
