import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const windows: unknown[] = [];
  const byWebContents = new Map<unknown, unknown>();
  let nextWebContentsId = 100;
  class FakeBrowserWindow {
    readonly webContents: {
      id: number;
      send: ReturnType<typeof vi.fn>;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      executeJavaScript: ReturnType<typeof vi.fn>;
    };
    private readonly onceListeners = new Map<string, () => void>();
    constructor(_options: unknown) {
      this.webContents = {
        id: nextWebContentsId++, send: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn(),
        executeJavaScript: vi.fn().mockResolvedValue(true),
      };
      windows.push(this);
      byWebContents.set(this.webContents, this);
    }
    isDestroyed(): boolean { return false; }
    show = vi.fn();
    focus = vi.fn();
    close = vi.fn();
    loadURL = vi.fn();
    loadFile = vi.fn();
    once(event: string, listener: () => void): void { this.onceListeners.set(event, listener); }
    static fromWebContents(sender: unknown): unknown { return byWebContents.get(sender) ?? null; }
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
    ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)), __handlers: handlers },
    __electronTest: { windows, byWebContents, handlers },
  };
});

import { BrowserWindow, ipcMain } from 'electron';
import { registerPasswordVaultIpc } from '../passwordVaultIpc';
import { PasswordVaultController, type PasswordGuestSender, type PasswordVaultPort } from '../passwordVaultController';
import { ClipboardSecretLease, type SecretClipboard } from '../clipboardSecretLease';
import { PASSWORD_TRUSTED_CHANNELS, PASSWORD_VAULT_CHANNELS } from '../../shared/passwordVault';

interface FakeIpcMain { __handlers: Map<string, (...args: unknown[]) => unknown>; }
interface ElectronTest { windows: Array<{ webContents: { id: number } }>; byWebContents: Map<unknown, unknown>; handlers: Map<string, (...args: unknown[]) => unknown>; }
const electronTest = (await import('electron') as unknown as { __electronTest: ElectronTest }).__electronTest;

const PROFILE = 'a'.repeat(32);
const SECRET = 'BL006-ipc-secret-sentinel';
const entry = {
  id: 'entry-1', profileId: PROFILE, origin: 'https://accounts.example.test', username: 'alice',
  password: SECRET, createdAt: 1, updatedAt: 1, lastUsedAt: 1,
};

class Guest implements PasswordGuestSender {
  constructor(readonly id: number, readonly url = 'https://accounts.example.test/login') {}
  getURL(): string { return this.url; }
  isDestroyed(): boolean { return false; }
  send = vi.fn();
  once(): unknown { return undefined; }
}

function vault(): PasswordVaultPort {
  return {
    isAvailable: () => true,
    listMetadata: () => [{ ...entry, password: undefined } as unknown as Omit<typeof entry, 'password'>],
    lookup: () => [entry],
    getDecrypted: (id) => {
      if (id !== entry.id) throw Object.assign(new Error('not found'), { code: 'VAULT_ENTRY_NOT_FOUND' });
      return entry;
    },
    upsert: () => ({ kind: 'saved', metadata: { ...entry, password: undefined } as unknown as Omit<typeof entry, 'password'> }),
    deleteEntry: () => true,
    deleteProfile: () => true,
  };
}

function makeWindow(webContents: unknown): unknown {
  const win = { webContents, isDestroyed: () => false };
  electronTest.byWebContents.set(webContents, win);
  return win;
}

function grant(
  handlers: Map<string, (...args: unknown[]) => unknown>,
  sender: unknown,
  action: 'reveal' | 'copy',
): { proof: string } {
  return handlers.get(PASSWORD_TRUSTED_CHANNELS.actionGrant)!(
    { sender },
    { action },
  ) as { proof: string };
}

beforeEach(() => {
  (ipcMain as unknown as FakeIpcMain).__handlers.clear();
  electronTest.windows.splice(0);
  electronTest.byWebContents.clear();
});

describe('browser password IPC sender allowlists', () => {
  it('test_AC8_rejects_untrusted_vault_access_while_preserving_entry-bound_trusted_access', async () => {
    const mainSender = { id: 10 };
    const mainWindow = makeWindow(mainSender);
    const controller = new PasswordVaultController({ vault: vault(), isProfileActive: () => true, onMetadataChanged: vi.fn() });
    const ownerGuest = new Guest(50);
    const otherOwnerGuest = new Guest(51);
    controller.registerGuest(ownerGuest, PROFILE, mainSender.id);
    controller.registerGuest(otherOwnerGuest, PROFILE, 77);
    const copy = vi.fn(() => ({ expiresAt: 999 }));
    registerPasswordVaultIpc({ vault: vault(), controller, clipboardLease: { copy }, getMainWindow: () => mainWindow as never, rendererName: 'main_window' });
    const handlers = (ipcMain as unknown as FakeIpcMain).__handlers;
    const untrusted = { id: 99 };

    expect(handlers.get(PASSWORD_VAULT_CHANNELS.capabilities)!({ sender: untrusted })).toEqual({ encryptionAvailable: false });
    expect(handlers.get(PASSWORD_VAULT_CHANNELS.listMetadata)!({ sender: untrusted })).toEqual([]);
    expect(handlers.get(PASSWORD_VAULT_CHANNELS.deleteEntry)!({ sender: untrusted }, { id: entry.id })).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(handlers.get(PASSWORD_VAULT_CHANNELS.openTrusted)!({ sender: untrusted }, { id: entry.id })).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.actionGrant)!({ sender: untrusted }, { action: 'reveal' })).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.reveal)!({ sender: untrusted }, { proof: 'forged' })).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.copy)!({ sender: untrusted }, { proof: 'forged' })).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(copy).not.toHaveBeenCalled();

    expect(handlers.get(PASSWORD_VAULT_CHANNELS.openAccountMenu)!({ sender: mainSender }, { guestWebContentsId: otherOwnerGuest.id })).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(handlers.get(PASSWORD_VAULT_CHANNELS.openAccountMenu)!({ sender: mainSender }, { guestWebContentsId: ownerGuest.id })).toEqual({ ok: true });

    expect(handlers.get(PASSWORD_VAULT_CHANNELS.openTrusted)!({ sender: mainSender }, { id: entry.id })).toEqual({ ok: true });
    const trustedSender = electronTest.windows.at(-1)!.webContents;
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.context)!({ sender: trustedSender })).toMatchObject({ metadata: { id: entry.id, username: 'alice' } });
    const revealGrant = grant(handlers, trustedSender, 'reveal');
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.reveal)!({ sender: trustedSender }, revealGrant)).toMatchObject({ ok: true, password: SECRET });
    // The proof is consumed even if replayed from the same trusted sender.
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.reveal)!({ sender: trustedSender }, revealGrant)).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    const copyGrant = grant(handlers, trustedSender, 'copy');
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.copy)!({ sender: trustedSender }, copyGrant)).toEqual({ ok: true, expiresAt: 999 });
    expect(copy).toHaveBeenCalledWith(SECRET);
  });

  it('does not grant a second trusted window access to the first window entry', async () => {
    const mainSender = { id: 10 };
    const mainWindow = makeWindow(mainSender);
    const secondEntry = { ...entry, id: 'entry-2', username: 'bob', password: 'second-secret' };
    const twoEntryVault = vault();
    twoEntryVault.listMetadata = () => [entry, secondEntry].map(({ password: _password, ...metadata }) => metadata);
    twoEntryVault.getDecrypted = (id) => id === entry.id ? entry : secondEntry;
    const controller = new PasswordVaultController({ vault: twoEntryVault, isProfileActive: () => true, onMetadataChanged: vi.fn() });
    registerPasswordVaultIpc({ vault: twoEntryVault, controller, clipboardLease: { copy: vi.fn(() => ({ expiresAt: 1 })) }, getMainWindow: () => mainWindow as never, rendererName: 'main_window' });
    const handlers = (ipcMain as unknown as FakeIpcMain).__handlers;
    handlers.get(PASSWORD_VAULT_CHANNELS.openTrusted)!({ sender: mainSender }, { id: entry.id });
    handlers.get(PASSWORD_VAULT_CHANNELS.openTrusted)!({ sender: mainSender }, { id: secondEntry.id });
    const firstTrustedSender = electronTest.windows[0].webContents;
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.context)!({ sender: firstTrustedSender })).toMatchObject({ metadata: { id: entry.id, username: 'alice' } });
    const revealGrant = grant(handlers, firstTrustedSender, 'reveal');
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.reveal)!({ sender: firstTrustedSender }, revealGrant)).toMatchObject({ password: SECRET });
  });

  it('test_AC6_copy_requires_isolated_user_action_and_conditionally_clears_clipboard', async () => {
    vi.useFakeTimers();
    try {
    const mainSender = { id: 10 };
    const mainWindow = makeWindow(mainSender);
    const clipboard: SecretClipboard & { value: string; clearCalls: number } = {
      value: '', clearCalls: 0,
      writeText(value: string) { this.value = value; },
      readText() { return this.value; },
      clear() { this.clearCalls += 1; this.value = ''; },
    };
    const lease = new ClipboardSecretLease({ clipboard, now: () => Date.now() });
    const controller = new PasswordVaultController({ vault: vault(), isProfileActive: () => true, onMetadataChanged: vi.fn() });
    registerPasswordVaultIpc({ vault: vault(), controller, clipboardLease: lease, getMainWindow: () => mainWindow as never, rendererName: 'main_window' });
    const handlers = (ipcMain as unknown as FakeIpcMain).__handlers;
    handlers.get(PASSWORD_VAULT_CHANNELS.openTrusted)!({ sender: mainSender }, { id: entry.id });
    const trustedSender = electronTest.windows.at(-1)!.webContents;

    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.reveal)!({ sender: trustedSender }, { proof: 'forged' })).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    const wrongActionGrant = grant(handlers, trustedSender, 'reveal');
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.copy)!({ sender: trustedSender }, wrongActionGrant)).toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(clipboard.value).toBe('');

    const copyGrant = grant(handlers, trustedSender, 'copy');
    expect(handlers.get(PASSWORD_TRUSTED_CHANNELS.copy)!({ sender: trustedSender }, copyGrant)).toMatchObject({ ok: true });
    expect(clipboard.value).toBe(SECRET);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clipboard.value).toBe('');

    const secondCopyGrant = grant(handlers, trustedSender, 'copy');
    handlers.get(PASSWORD_TRUSTED_CHANNELS.copy)!({ sender: trustedSender }, secondCopyGrant);
    clipboard.value = 'later user clipboard value';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clipboard.value).toBe('later user clipboard value');
    expect(clipboard.clearCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The ordinary preload has no API capable of returning a password. This is intentionally
// a contract assertion on public channel names, not an implementation-detail snapshot.
it('ordinary password-vault channels contain no reveal, copy, or decrypt operation', () => {
  expect(Object.keys(PASSWORD_VAULT_CHANNELS).join(',')).not.toMatch(/reveal|copy|decrypt/i);
});
