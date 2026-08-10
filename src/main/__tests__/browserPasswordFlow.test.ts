// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  PasswordVaultController,
  canonicalPasswordOrigin,
  type DecryptedPasswordCredentialLike,
  type PasswordGuestSender,
  type PasswordVaultPort,
} from '../passwordVaultController';
import type { PasswordCredentialMetadata } from '../../shared/passwordVault';

const guestPreloadMock = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  invoke: vi.fn(),
  sendToHost: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: guestPreloadMock.invoke,
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) =>
      guestPreloadMock.listeners.set(channel, listener),
    ),
    sendToHost: guestPreloadMock.sendToHost,
  },
}));

const PROFILE_A = 'a'.repeat(32);
const PROFILE_B = 'b'.repeat(32);

class FakeGuest implements PasswordGuestSender {
  destroyed = false;
  readonly sent: Array<{ channel: string; args: unknown[] }> = [];
  private readonly destroyedListeners: Array<() => void> = [];

  constructor(readonly id: number, private url: string) {}

  getURL(): string { return this.url; }
  setURL(url: string): void { this.url = url; }
  isDestroyed(): boolean { return this.destroyed; }
  send(channel: string, ...args: unknown[]): void { this.sent.push({ channel, args }); }
  once(event: 'destroyed', listener: () => void): unknown {
    if (event === 'destroyed') this.destroyedListeners.push(listener);
    return undefined;
  }
}

class FakeVault implements PasswordVaultPort {
  readonly entries: DecryptedPasswordCredentialLike[] = [];
  available = true;

  isAvailable(): boolean { return this.available; }
  listMetadata(): PasswordCredentialMetadata[] {
    return this.entries.map(({ password: _password, ...metadata }) => metadata);
  }
  lookup(profileId: string, origin: string): DecryptedPasswordCredentialLike[] {
    return this.entries
      .filter((entry) => entry.profileId === profileId && entry.origin === origin)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }
  getDecrypted(id: string): DecryptedPasswordCredentialLike {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) throw Object.assign(new Error('not found'), { code: 'VAULT_ENTRY_NOT_FOUND' });
    return entry;
  }
  upsert(input: { profileId: string; origin: string; username: string; password: string; now?: number }) {
    const now = input.now ?? 0;
    const existing = this.entries.find(
      (entry) => entry.profileId === input.profileId && entry.origin === input.origin && entry.username === input.username,
    );
    if (existing) {
      existing.password = input.password;
      existing.updatedAt = now;
      existing.lastUsedAt = now;
      return { kind: 'updated' as const, metadata: this.listMetadata().find((entry) => entry.id === existing.id)! };
    }
    const entry: DecryptedPasswordCredentialLike = {
      id: `entry-${this.entries.length + 1}`,
      profileId: input.profileId,
      origin: input.origin,
      username: input.username,
      password: input.password,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
    };
    this.entries.push(entry);
    return { kind: 'saved' as const, metadata: this.listMetadata().find((item) => item.id === entry.id)! };
  }
  deleteEntry(id: string): boolean {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }
  deleteProfile(profileId: string): boolean {
    const before = this.entries.length;
    this.entries.splice(0, this.entries.length, ...this.entries.filter((entry) => entry.profileId !== profileId));
    return before !== this.entries.length;
  }
}

function setup() {
  const vault = new FakeVault();
  const controller = new PasswordVaultController({
    vault,
    isProfileActive: () => true,
    onMetadataChanged: vi.fn(),
    now: () => 100,
  });
  return { vault, controller };
}

describe('browser password flow security boundaries', () => {
  it('test_AC1_auto_saves_only_confirmed_login', () => {
    const { vault, controller } = setup();
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);

    expect(controller.acceptCandidate(guest.id, { nonce: 'failed', username: 'alice', password: 'failed-password' })).toBe(true);
    expect(controller.settleCandidate(guest.id, { nonce: 'failed', result: 'failed' })).toEqual({ kind: 'auth_failed' });
    expect(vault.entries).toEqual([]);

    expect(controller.acceptCandidate(guest.id, { nonce: 'uncertain', username: 'alice', password: 'uncertain-password' })).toBe(true);
    expect(controller.settleCandidate(guest.id, { nonce: 'uncertain', result: 'uncertain', reason: 'timeout' })).toMatchObject({ kind: 'uncertain' });
    expect(vault.entries).toEqual([]);

    expect(controller.acceptCandidate(guest.id, { nonce: 'success', username: 'alice', password: 'confirmed-password' })).toBe(true);
    expect(controller.settleCandidate(guest.id, { nonce: 'success', result: 'success' })).toMatchObject({ kind: 'saved', selectedUsername: 'alice' });
    expect(vault.entries).toHaveLength(1);
    expect(vault.entries[0]).toMatchObject({ username: 'alice', password: 'confirmed-password' });
  });

  it('test_AC2_limits_candidates_to_profile_exact_origin_and_safe_origins', () => {
    expect(canonicalPasswordOrigin('https://accounts.example.test/path')).toBe('https://accounts.example.test');
    expect(canonicalPasswordOrigin('http://localhost:3000/login')).toBe('http://localhost:3000');
    expect(canonicalPasswordOrigin('http://127.0.0.1/login')).toBe('http://127.0.0.1');
    expect(canonicalPasswordOrigin('http://[::1]/login')).toBe('http://[::1]');
    expect(canonicalPasswordOrigin('http://accounts.example.test/login')).toBeNull();
    expect(canonicalPasswordOrigin('file:///tmp/login.html')).toBeNull();

    const { vault, controller } = setup();
    vault.upsert({ profileId: PROFILE_A, origin: 'https://accounts.example.test', username: 'alice', password: 'secret-a' });
    const sameProfile = new FakeGuest(1, 'https://accounts.example.test/login');
    const otherProfile = new FakeGuest(2, 'https://accounts.example.test/login');
    const otherOrigin = new FakeGuest(3, 'https://sub.accounts.example.test/login');
    const insecure = new FakeGuest(4, 'http://accounts.example.test/login');
    controller.registerGuest(sameProfile, PROFILE_A, 10);
    controller.registerGuest(otherProfile, PROFILE_B, 10);
    controller.registerGuest(otherOrigin, PROFILE_A, 10);
    controller.registerGuest(insecure, PROFILE_A, 10);

    expect(controller.lookup(sameProfile.id, {})).toMatchObject({ kind: 'credential', username: 'alice', password: 'secret-a' });
    expect(controller.lookup(otherProfile.id, {})).toEqual({ kind: 'none' });
    expect(controller.lookup(otherOrigin.id, {})).toEqual({ kind: 'none' });
    expect(controller.lookup(insecure.id, {})).toEqual({ kind: 'insecure_origin' });
  });

  it('test_AC4_updates_only_successful_matching_account', () => {
    const { vault, controller } = setup();
    vault.upsert({ profileId: PROFILE_A, origin: 'https://accounts.example.test', username: 'alice', password: 'old-alice', now: 1 });
    vault.upsert({ profileId: PROFILE_A, origin: 'https://accounts.example.test', username: 'bob', password: 'bob-password', now: 2 });
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);

    expect(controller.acceptCandidate(guest.id, { nonce: 'failed', username: 'alice', password: 'bad-attempt' })).toBe(true);
    expect(controller.settleCandidate(guest.id, { nonce: 'failed', result: 'failed' })).toEqual({ kind: 'auth_failed' });
    expect(vault.lookup(PROFILE_A, 'https://accounts.example.test').map((entry) => entry.password)).toEqual(['bob-password', 'old-alice']);

    expect(controller.acceptCandidate(guest.id, { nonce: 'uncertain', username: 'alice', password: 'uncertain-attempt' })).toBe(true);
    expect(controller.settleCandidate(guest.id, { nonce: 'uncertain', result: 'uncertain', reason: 'timeout' })).toMatchObject({ kind: 'uncertain' });
    expect(vault.lookup(PROFILE_A, 'https://accounts.example.test').find((entry) => entry.username === 'alice')?.password).toBe('old-alice');

    expect(controller.acceptCandidate(guest.id, { nonce: 'success', username: 'alice', password: 'new-alice' })).toBe(true);
    expect(controller.settleCandidate(guest.id, { nonce: 'success', result: 'success' })).toMatchObject({ kind: 'updated', selectedUsername: 'alice' });
    expect(vault.lookup(PROFILE_A, 'https://accounts.example.test').find((entry) => entry.username === 'alice')?.password).toBe('new-alice');
    expect(vault.lookup(PROFILE_A, 'https://accounts.example.test').find((entry) => entry.username === 'bob')?.password).toBe('bob-password');
  });

  it('test_AC3_fills_deterministically_without_replacing_non_empty_fields', async () => {
    const { vault, controller } = setup();
    vault.upsert({ profileId: PROFILE_A, origin: 'https://accounts.example.test', username: 'older', password: 'older-password', now: 1 });
    vault.upsert({ profileId: PROFILE_A, origin: 'https://accounts.example.test', username: 'newer', password: 'newer-password', now: 2 });
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);
    expect(controller.lookup(guest.id, { pageUsername: 'older' })).toMatchObject({ kind: 'credential', username: 'older', password: 'older-password' });
    expect(controller.lookup(guest.id, {})).toMatchObject({ kind: 'credential', username: 'newer', password: 'newer-password' });

    vi.useFakeTimers();
    try {
      guestPreloadMock.listeners.clear();
      guestPreloadMock.invoke.mockResolvedValue({ kind: 'credential', entryId: 'entry-2', username: 'newer', password: 'newer-password' });
      document.body.innerHTML = '<form><input autocomplete="username" value="user-entered"><input type="password" value="password-entered"></form>';
      for (const input of document.querySelectorAll('input')) {
        Object.defineProperty(input, 'getClientRects', { value: () => [{ width: 1 }] });
      }
      await import('../../preload/browserGuestPreload');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await vi.advanceTimersByTimeAsync(120);
      const [username, password] = [...document.querySelectorAll<HTMLInputElement>('input')];
      expect(username.value).toBe('user-entered');
      expect(password.value).toBe('password-entered');
    } finally {
      vi.useRealTimers();
      document.body.replaceChildren();
    }
  });

  it('test_AC7_deletes_only_selected_account_and_preserves_other_accounts', () => {
    const { vault, controller } = setup();
    const alice = vault.upsert({ profileId: PROFILE_A, origin: 'https://accounts.example.test', username: 'alice', password: 'alice-password' });
    vault.upsert({ profileId: PROFILE_A, origin: 'https://accounts.example.test', username: 'bob', password: 'bob-password' });
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);

    expect(vault.deleteEntry(alice.metadata.id)).toBe(true);
    expect(controller.lookup(guest.id, {})).toMatchObject({ kind: 'credential', username: 'bob', password: 'bob-password' });
    expect(vault.entries).toHaveLength(1);
    expect(vault.entries[0]).toMatchObject({ username: 'bob', password: 'bob-password' });
  });

  it('never saves a candidate when the guest, profile, or origin is no longer the verified owner', () => {
    const { vault, controller } = setup();
    const owner = new FakeGuest(1, 'https://accounts.example.test/login');
    const attacker = new FakeGuest(2, 'https://accounts.example.test/login');
    controller.registerGuest(owner, PROFILE_A, 10);
    controller.registerGuest(attacker, PROFILE_B, 11);

    expect(controller.acceptCandidate(owner.id, { nonce: 'nonce-1', username: 'alice', password: 'secret' })).toBe(true);
    expect(controller.settleCandidate(attacker.id, { nonce: 'nonce-1', result: 'success' })).toMatchObject({ kind: 'uncertain' });
    expect(vault.entries).toEqual([]);

    expect(controller.acceptCandidate(owner.id, { nonce: 'nonce-2', username: 'alice', password: 'secret' })).toBe(true);
    owner.setURL('https://different.example.test/after-login');
    expect(controller.settleCandidate(owner.id, { nonce: 'nonce-2', result: 'success' })).toMatchObject({ kind: 'uncertain' });
    expect(vault.entries).toEqual([]);
  });
});
