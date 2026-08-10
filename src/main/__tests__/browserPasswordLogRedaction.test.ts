import { describe, expect, it, vi } from 'vitest';
import {
  PasswordVaultController,
  type PasswordGuestSender,
  type PasswordVaultPort,
} from '../passwordVaultController';

const PROFILE = 'a'.repeat(32);
const SECRET = 'BL006-log-secret-sentinel-4f7a';

class Guest implements PasswordGuestSender {
  readonly sent: unknown[][] = [];
  constructor(readonly id: number) {}
  getURL(): string {
    return 'https://accounts.example.test/login';
  }
  isDestroyed(): boolean {
    return false;
  }
  send(_channel: string, ...args: unknown[]): void {
    this.sent.push(args);
  }
  once(): unknown {
    return undefined;
  }
}

function throwingVault(): PasswordVaultPort {
  const fail = async () => {
    throw new Error(`untrusted lower-layer diagnostic ${SECRET}`);
  };
  return {
    isAvailable: () => true,
    listMetadata: async () => ({ entries: [], unavailableProfiles: [] }),
    lookup: fail,
    getDecrypted: fail as PasswordVaultPort['getDecrypted'],
    upsert: fail as PasswordVaultPort['upsert'],
    deleteEntry: fail as PasswordVaultPort['deleteEntry'],
    deleteProfile: async () => false,
  };
}

describe('browser password diagnostic redaction', () => {
  it('test_AC9_redacts_password_material_from_diagnostics_and_events', async () => {
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

    await expect(controller.lookup(guest.id, {})).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'nonce',
        username: 'alice',
        password: SECRET,
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'nonce',
        result: 'success',
      }),
    ).resolves.toMatchObject({ kind: 'unavailable' });
    await expect(controller.fillEntry(guest.id, 'entry-1')).resolves.toBe(
      false,
    );

    const observable = JSON.stringify({
      diagnostics: [...warn.mock.calls, ...error.mock.calls],
      events: guest.sent,
    });
    expect(observable).not.toContain(SECRET);
    expect(observable).toContain('VAULT_IO_FAILED');
    expect(observable).not.toMatch(/encryptedPassword|ciphertext|base64/i);
  });
});
