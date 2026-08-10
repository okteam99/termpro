import { describe, expect, it, vi } from 'vitest';
import {
  PasswordVaultController,
  type DecryptedPasswordCredentialLike,
  type PasswordGuestSender,
  type PasswordVaultPort,
} from '../passwordVaultController';

const PROFILE = 'a'.repeat(32);
const SECRET = 'BL006-log-secret-sentinel-4f7a';

class Guest implements PasswordGuestSender {
  readonly sent: unknown[][] = [];
  constructor(readonly id: number) {}
  getURL(): string { return 'https://accounts.example.test/login'; }
  isDestroyed(): boolean { return false; }
  send(_channel: string, ...args: unknown[]): void { this.sent.push(args); }
  once(): unknown { return undefined; }
}

function throwingVault(): PasswordVaultPort {
  const fail = () => { throw new Error(`untrusted lower-layer diagnostic ${SECRET}`); };
  return {
    isAvailable: () => true,
    listMetadata: () => [],
    lookup: fail,
    getDecrypted: fail as (id: string) => DecryptedPasswordCredentialLike,
    upsert: fail as PasswordVaultPort['upsert'],
    deleteEntry: fail as (id: string) => boolean,
    deleteProfile: () => false,
  };
}

describe('browser password diagnostic redaction', () => {
  it('test_AC9_redacts_password_material_from_diagnostics_and_events', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const guest = new Guest(44);
    const controller = new PasswordVaultController({
      vault: throwingVault(),
      isProfileActive: () => true,
      onMetadataChanged: vi.fn(),
      logger: { warn, error },
    });
    controller.registerGuest(guest, PROFILE, 10);

    expect(controller.lookup(guest.id, {})).toEqual({ kind: 'unavailable' });
    expect(controller.acceptCandidate(guest.id, { nonce: 'nonce', username: 'alice', password: SECRET })).toBe(true);
    expect(controller.settleCandidate(guest.id, { nonce: 'nonce', result: 'success' })).toMatchObject({ kind: 'unavailable' });
    expect(controller.fillEntry(guest.id, 'entry-1')).toBe(false);

    const observable = JSON.stringify({ diagnostics: [...warn.mock.calls, ...error.mock.calls], events: guest.sent });
    expect(observable).not.toContain(SECRET);
    expect(observable).toContain('VAULT_IO_FAILED');
    expect(observable).not.toMatch(/encryptedPassword|ciphertext|base64/i);
  });
});
