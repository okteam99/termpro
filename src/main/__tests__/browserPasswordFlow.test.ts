// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  PasswordVaultController,
  canonicalPasswordOrigin,
  type DecryptedPasswordCredentialLike,
  type PasswordGuestSender,
  type PasswordVaultPort,
} from '../passwordVaultController';
import { PASSWORD_GUEST_CHANNELS } from '../../shared/passwordVault';

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

  constructor(
    readonly id: number,
    private url: string,
  ) {}

  getURL(): string {
    return this.url;
  }
  setURL(url: string): void {
    this.url = url;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ channel, args });
  }
  once(event: 'destroyed', listener: () => void): unknown {
    if (event === 'destroyed') this.destroyedListeners.push(listener);
    return undefined;
  }
}

class FakeVault implements PasswordVaultPort {
  readonly entries: DecryptedPasswordCredentialLike[] = [];
  available = true;

  isAvailable(): boolean {
    return this.available;
  }
  async listMetadata() {
    return {
      entries: this.entries.map(
        ({ password: _password, ...metadata }) => metadata,
      ),
      unavailableProfiles: [],
    };
  }
  async lookup(
    profileId: string,
    origin: string,
  ): Promise<DecryptedPasswordCredentialLike[]> {
    return this.entries
      .filter(
        (entry) => entry.profileId === profileId && entry.origin === origin,
      )
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }
  async getDecrypted(
    profileId: string,
    id: string,
  ): Promise<DecryptedPasswordCredentialLike> {
    const entry = this.entries.find(
      (candidate) => candidate.profileId === profileId && candidate.id === id,
    );
    if (!entry)
      throw Object.assign(new Error('not found'), {
        code: 'VAULT_ENTRY_NOT_FOUND',
      });
    return entry;
  }
  async upsert(input: {
    profileId: string;
    origin: string;
    username: string;
    password: string;
    now?: number;
  }) {
    const now = input.now ?? 0;
    const existing = this.entries.find(
      (entry) =>
        entry.profileId === input.profileId &&
        entry.origin === input.origin &&
        entry.username === input.username,
    );
    if (existing) {
      existing.password = input.password;
      existing.updatedAt = now;
      existing.lastUsedAt = now;
      const { password: _password, ...metadata } = existing;
      return { kind: 'updated' as const, metadata };
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
    const { password: _password, ...metadata } = entry;
    return { kind: 'saved' as const, metadata };
  }
  async deleteEntry(profileId: string, id: string): Promise<boolean> {
    const index = this.entries.findIndex(
      (entry) => entry.profileId === profileId && entry.id === id,
    );
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }
  async deleteProfile(profileId: string): Promise<boolean> {
    const before = this.entries.length;
    this.entries.splice(
      0,
      this.entries.length,
      ...this.entries.filter((entry) => entry.profileId !== profileId),
    );
    return before !== this.entries.length;
  }
}

/** jsdom 不做布局,getClientRects 恒空;preload 的可见性闸门需要它有值 */
function makeVisible(root: ParentNode): void {
  for (const node of root.querySelectorAll('*')) {
    Object.defineProperty(node, 'getClientRects', {
      value: () => [{ width: 1 }],
      configurable: true,
    });
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
  it('test_AC1_auto_saves_only_confirmed_login', async () => {
    const { vault, controller } = setup();
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);

    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'failed',
        username: 'alice',
        password: 'failed-password',
      }),
    ).toBe(true);
    // 没存过这个站点 → 不写库,也不该说「已保存密码未更改」(用户报告 2026-08-16)
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'failed',
        result: 'failed',
      }),
    ).resolves.toEqual({ kind: 'idle' });
    expect(vault.entries).toEqual([]);

    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'uncertain',
        username: 'alice',
        password: 'uncertain-password',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'uncertain',
        result: 'uncertain',
        reason: 'timeout',
      }),
    ).resolves.toMatchObject({ kind: 'uncertain' });
    expect(vault.entries).toEqual([]);

    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'success',
        username: 'alice',
        password: 'confirmed-password',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'success',
        result: 'success',
      }),
    ).resolves.toMatchObject({ kind: 'saved', selectedUsername: 'alice' });
    expect(vault.entries).toHaveLength(1);
    expect(vault.entries[0]).toMatchObject({
      username: 'alice',
      password: 'confirmed-password',
    });
  });

  it('test_AC2_limits_candidates_to_profile_exact_origin_and_safe_origins', async () => {
    expect(canonicalPasswordOrigin('https://accounts.example.test/path')).toBe(
      'https://accounts.example.test',
    );
    expect(canonicalPasswordOrigin('http://localhost:3000/login')).toBe(
      'http://localhost:3000',
    );
    expect(canonicalPasswordOrigin('http://127.0.0.1/login')).toBe(
      'http://127.0.0.1',
    );
    expect(canonicalPasswordOrigin('http://[::1]/login')).toBe('http://[::1]');
    expect(
      canonicalPasswordOrigin('http://accounts.example.test/login'),
    ).toBeNull();
    expect(canonicalPasswordOrigin('file:///tmp/login.html')).toBeNull();

    const { vault, controller } = setup();
    vault.upsert({
      profileId: PROFILE_A,
      origin: 'https://accounts.example.test',
      username: 'alice',
      password: 'secret-a',
    });
    const sameProfile = new FakeGuest(1, 'https://accounts.example.test/login');
    const otherProfile = new FakeGuest(
      2,
      'https://accounts.example.test/login',
    );
    const otherOrigin = new FakeGuest(
      3,
      'https://sub.accounts.example.test/login',
    );
    const insecure = new FakeGuest(4, 'http://accounts.example.test/login');
    controller.registerGuest(sameProfile, PROFILE_A, 10);
    controller.registerGuest(otherProfile, PROFILE_B, 10);
    controller.registerGuest(otherOrigin, PROFILE_A, 10);
    controller.registerGuest(insecure, PROFILE_A, 10);

    await expect(controller.lookup(sameProfile.id, {})).resolves.toMatchObject({
      kind: 'credential',
      username: 'alice',
      password: 'secret-a',
    });
    await expect(controller.lookup(otherProfile.id, {})).resolves.toEqual({
      kind: 'none',
    });
    await expect(controller.lookup(otherOrigin.id, {})).resolves.toEqual({
      kind: 'none',
    });
    await expect(controller.lookup(insecure.id, {})).resolves.toEqual({
      kind: 'insecure_origin',
    });
  });

  it('test_AC4_updates_only_successful_matching_account', async () => {
    const { vault, controller } = setup();
    vault.upsert({
      profileId: PROFILE_A,
      origin: 'https://accounts.example.test',
      username: 'alice',
      password: 'old-alice',
      now: 1,
    });
    vault.upsert({
      profileId: PROFILE_A,
      origin: 'https://accounts.example.test',
      username: 'bob',
      password: 'bob-password',
      now: 2,
    });
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);

    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'failed',
        username: 'alice',
        password: 'bad-attempt',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'failed',
        result: 'failed',
      }),
    ).resolves.toEqual({ kind: 'auth_failed' });
    expect(
      (await vault.lookup(PROFILE_A, 'https://accounts.example.test')).map(
        (entry) => entry.password,
      ),
    ).toEqual(['bob-password', 'old-alice']);

    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'uncertain',
        username: 'alice',
        password: 'uncertain-attempt',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'uncertain',
        result: 'uncertain',
        reason: 'timeout',
      }),
    ).resolves.toMatchObject({ kind: 'uncertain' });
    expect(
      (await vault.lookup(PROFILE_A, 'https://accounts.example.test')).find(
        (entry) => entry.username === 'alice',
      )?.password,
    ).toBe('old-alice');

    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'success',
        username: 'alice',
        password: 'new-alice',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'success',
        result: 'success',
      }),
    ).resolves.toMatchObject({ kind: 'updated', selectedUsername: 'alice' });
    expect(
      (await vault.lookup(PROFILE_A, 'https://accounts.example.test')).find(
        (entry) => entry.username === 'alice',
      )?.password,
    ).toBe('new-alice');
    expect(
      (await vault.lookup(PROFILE_A, 'https://accounts.example.test')).find(
        (entry) => entry.username === 'bob',
      )?.password,
    ).toBe('bob-password');
  });

  it('test_AC3_fills_deterministically_without_replacing_non_empty_fields', async () => {
    const { vault, controller } = setup();
    vault.upsert({
      profileId: PROFILE_A,
      origin: 'https://accounts.example.test',
      username: 'older',
      password: 'older-password',
      now: 1,
    });
    vault.upsert({
      profileId: PROFILE_A,
      origin: 'https://accounts.example.test',
      username: 'newer',
      password: 'newer-password',
      now: 2,
    });
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);
    await expect(
      controller.lookup(guest.id, { pageUsername: 'older' }),
    ).resolves.toMatchObject({
      kind: 'credential',
      username: 'older',
      password: 'older-password',
    });
    await expect(controller.lookup(guest.id, {})).resolves.toMatchObject({
      kind: 'credential',
      username: 'newer',
      password: 'newer-password',
    });

    vi.useFakeTimers();
    try {
      guestPreloadMock.listeners.clear();
      guestPreloadMock.invoke.mockResolvedValue({
        kind: 'credential',
        entryId: 'entry-2',
        username: 'newer',
        password: 'newer-password',
      });
      document.body.innerHTML =
        '<form><input autocomplete="username" value="user-entered"><input type="password" value="password-entered"></form>';
      for (const input of document.querySelectorAll('input')) {
        Object.defineProperty(input, 'getClientRects', {
          value: () => [{ width: 1 }],
        });
      }
      await import('../../preload/browserGuestPreload');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await vi.advanceTimersByTimeAsync(120);
      const [username, password] = [
        ...document.querySelectorAll<HTMLInputElement>('input'),
      ];
      expect(username.value).toBe('user-entered');
      expect(password.value).toBe('password-entered');
    } finally {
      vi.useRealTimers();
      document.body.replaceChildren();
    }
  });

  it('test_AC7_deletes_only_selected_account_and_preserves_other_accounts', async () => {
    const { vault, controller } = setup();
    const alice = await vault.upsert({
      profileId: PROFILE_A,
      origin: 'https://accounts.example.test',
      username: 'alice',
      password: 'alice-password',
    });
    vault.upsert({
      profileId: PROFILE_A,
      origin: 'https://accounts.example.test',
      username: 'bob',
      password: 'bob-password',
    });
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);

    await expect(vault.deleteEntry(PROFILE_A, alice.metadata.id)).resolves.toBe(
      true,
    );
    await expect(controller.lookup(guest.id, {})).resolves.toMatchObject({
      kind: 'credential',
      username: 'bob',
      password: 'bob-password',
    });
    expect(vault.entries).toHaveLength(1);
    expect(vault.entries[0]).toMatchObject({
      username: 'bob',
      password: 'bob-password',
    });
  });

  // 用户报告 2026-08-16:登录成功却弹「登录失败 · 已保存密码未更改」,而这个站点从没存过密码。
  it('only reports an unchanged saved password when one actually exists and differs', async () => {
    const { vault, controller } = setup();
    await vault.upsert({
      profileId: PROFILE_A,
      origin: 'https://accounts.example.test',
      username: 'alice',
      password: 'same-password',
      now: 1,
    });
    const guest = new FakeGuest(1, 'https://accounts.example.test/login');
    controller.registerGuest(guest, PROFILE_A, 10);

    // 存过的就是这一条,失败也好没确认也好,保险箱什么都没变 → 不打扰
    for (const result of ['failed', 'uncertain'] as const) {
      expect(
        controller.acceptCandidate(guest.id, {
          nonce: `same-${result}`,
          username: 'alice',
          password: 'same-password',
        }),
      ).toBe(true);
      await expect(
        controller.settleCandidate(guest.id, {
          nonce: `same-${result}`,
          result,
          reason: 'timeout',
        }),
      ).resolves.toEqual({ kind: 'idle' });
    }

    // 这个账号没存过 → 「已保存密码未更改」是假话,静默;没确认才说「没给你存」
    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'new-account',
        username: 'bob',
        password: 'bob-attempt',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'new-account',
        result: 'failed',
      }),
    ).resolves.toEqual({ kind: 'idle' });
    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'new-account-uncertain',
        username: 'bob',
        password: 'bob-attempt',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'new-account-uncertain',
        result: 'uncertain',
        reason: 'timeout',
      }),
    ).resolves.toMatchObject({ kind: 'uncertain' });

    // 真有一份没被覆盖的旧密码时,提示照旧
    expect(
      controller.acceptCandidate(guest.id, {
        nonce: 'changed',
        username: 'alice',
        password: 'wrong-password',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(guest.id, {
        nonce: 'changed',
        result: 'failed',
      }),
    ).resolves.toEqual({ kind: 'auth_failed' });
    expect(vault.entries).toHaveLength(1);
    expect(vault.entries[0]).toMatchObject({ password: 'same-password' });
  });

  // 登录成功后落地的业务页几乎都带 role="alert"/.error 容器(GitLab 的 flash 条),
  // 旧实现全文档一扫有文字就判失败 → 成功被播报成失败。
  it('treats alerts on the landed page as noise, not a failed sign-in', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      guestPreloadMock.listeners.clear();
      guestPreloadMock.invoke.mockReset();
      guestPreloadMock.invoke.mockResolvedValue({ kind: 'none' });
      document.body.innerHTML =
        '<div role="alert">Merge request !1135 was created</div>' +
        '<div class="error">unrelated banner</div>';
      makeVisible(document.body);
      await import('../../preload/browserGuestPreload');
      const verify = guestPreloadMock.listeners.get(
        PASSWORD_GUEST_CHANNELS.verify,
      );
      expect(verify).toBeTypeOf('function');

      // 登录表单没了 = 已经走掉了,页面上的告警条与这次登录无关
      verify?.({}, { nonce: 'landed' });
      expect(guestPreloadMock.invoke).toHaveBeenLastCalledWith(
        PASSWORD_GUEST_CHANNELS.result,
        { nonce: 'landed', result: 'success', reason: 'navigation' },
      );

      // 还留在登录页 + 新冒出来的可见告警 = 真失败
      document.body.innerHTML =
        '<div role="alert">Invalid login or password</div>' +
        '<form><input autocomplete="username"><input type="password"></form>';
      makeVisible(document.body);
      verify?.({}, { nonce: 'rejected' });
      expect(guestPreloadMock.invoke).toHaveBeenLastCalledWith(
        PASSWORD_GUEST_CHANNELS.result,
        { nonce: 'rejected', result: 'failed', reason: 'message' },
      );

      // 登录页上本来就挂着(不可见的)空告警壳子 → 不算证据,只能是「没确认」
      document.body.innerHTML =
        '<div role="alert"></div><div class="error">hidden</div>' +
        '<form><input autocomplete="username"><input type="password"></form>';
      makeVisible(document.body);
      for (const node of document.querySelectorAll('[role="alert"], .error')) {
        Object.defineProperty(node, 'getClientRects', {
          value: () => [],
          configurable: true,
        });
      }
      verify?.({}, { nonce: 'still-here' });
      expect(guestPreloadMock.invoke).toHaveBeenLastCalledWith(
        PASSWORD_GUEST_CHANNELS.result,
        { nonce: 'still-here', result: 'uncertain', reason: 'navigation' },
      );
    } finally {
      vi.useRealTimers();
      document.body.replaceChildren();
    }
  });

  it('never saves a candidate when the guest, profile, or origin is no longer the verified owner', async () => {
    const { vault, controller } = setup();
    const owner = new FakeGuest(1, 'https://accounts.example.test/login');
    const attacker = new FakeGuest(2, 'https://accounts.example.test/login');
    controller.registerGuest(owner, PROFILE_A, 10);
    controller.registerGuest(attacker, PROFILE_B, 11);

    expect(
      controller.acceptCandidate(owner.id, {
        nonce: 'nonce-1',
        username: 'alice',
        password: 'secret',
      }),
    ).toBe(true);
    await expect(
      controller.settleCandidate(attacker.id, {
        nonce: 'nonce-1',
        result: 'success',
      }),
    ).resolves.toMatchObject({ kind: 'uncertain' });
    expect(vault.entries).toEqual([]);

    expect(
      controller.acceptCandidate(owner.id, {
        nonce: 'nonce-2',
        username: 'alice',
        password: 'secret',
      }),
    ).toBe(true);
    owner.setURL('https://different.example.test/after-login');
    await expect(
      controller.settleCandidate(owner.id, {
        nonce: 'nonce-2',
        result: 'success',
      }),
    ).resolves.toMatchObject({ kind: 'uncertain' });
    expect(vault.entries).toEqual([]);
  });
});
