import { BrowserWindow, Menu, ipcMain } from 'electron';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {
  PASSWORD_CLIPBOARD_LEASE_MS,
  PASSWORD_REVEAL_DURATION_MS,
  PASSWORD_TRUSTED_ACTION_PROOF_TTL_MS,
  PASSWORD_TRUSTED_CHANNELS,
  PASSWORD_VAULT_CHANNELS,
  type PasswordMetadataQuery,
  type PasswordVaultActionResult,
  type TrustedPasswordAction,
  type TrustedPasswordActionGrant,
  type TrustedPasswordContext,
  type TrustedPasswordCopyResult,
  type TrustedPasswordRevealResult,
} from '../shared/passwordVault';
import { PasswordVaultController, type PasswordVaultPort } from './passwordVaultController';

interface ClipboardSecretLeasePort {
  copy(secret: string): { expiresAt: number };
}

export interface PasswordVaultIpcDeps {
  vault: PasswordVaultPort;
  controller: PasswordVaultController;
  clipboardLease: ClipboardSecretLeasePort;
  getMainWindow(): BrowserWindow | null;
  rendererDevServerUrl?: string;
  rendererName: string;
  preloadPath?: string;
}

function codeOf(error: unknown): PasswordVaultActionResult['code'] {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^VAULT_[A-Z_]+$/.test(code)) {
    return code as PasswordVaultActionResult['code'];
  }
  return 'VAULT_IO_FAILED';
}

export function registerPasswordVaultIpc(deps: PasswordVaultIpcDeps): {
  broadcastChanged(): void;
  closeAllTrustedWindows(): void;
} {
  const trustedEntryBySender = new Map<number, string>();
  const trustedWindows = new Map<string, BrowserWindow>();
  const trustedActionBySender = new Map<number, {
    action: TrustedPasswordAction;
    entryId: string;
    expiresAt: number;
    proof: string;
  }>();

  const mainOnly = (sender: Electron.WebContents): boolean => {
    const main = deps.getMainWindow();
    return main !== null && BrowserWindow.fromWebContents(sender) === main;
  };

  const trustedEntry = (sender: Electron.WebContents): string | null =>
    trustedEntryBySender.get(sender.id) ?? null;

  const consumeTrustedAction = (
    sender: Electron.WebContents,
    action: TrustedPasswordAction,
    payload: { proof?: unknown },
  ): string | null => {
    const id = trustedEntry(sender);
    if (!id) return null;
    const grant = trustedActionBySender.get(sender.id);
    trustedActionBySender.delete(sender.id);
    if (
      !grant ||
      grant.entryId !== id ||
      grant.action !== action ||
      grant.expiresAt < Date.now() ||
      typeof payload?.proof !== 'string'
    ) return null;
    const expected = Buffer.from(grant.proof);
    const received = Buffer.from(payload.proof);
    return expected.length === received.length && timingSafeEqual(expected, received) ? id : null;
  };

  const broadcastChanged = () => {
    const main = deps.getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(PASSWORD_VAULT_CHANNELS.changed);
  };

  ipcMain.handle(PASSWORD_VAULT_CHANNELS.capabilities, (event) => ({
    encryptionAvailable: mainOnly(event.sender) && deps.vault.isAvailable(),
  }));

  ipcMain.handle(
    PASSWORD_VAULT_CHANNELS.listMetadata,
    (event, query: PasswordMetadataQuery = {}) => {
      if (!mainOnly(event.sender)) return [];
      const safeQuery: PasswordMetadataQuery = {
        ...(typeof query?.profileId === 'string' ? { profileId: query.profileId } : {}),
        ...(typeof query?.query === 'string' ? { query: query.query.slice(0, 1024) } : {}),
      };
      try {
        return deps.vault.listMetadata(safeQuery);
      } catch (error) {
        console.error(`[password-vault] list failed code=${codeOf(error)}`);
        throw new Error(codeOf(error));
      }
    },
  );

  ipcMain.handle(PASSWORD_VAULT_CHANNELS.deleteEntry, (event, payload: { id?: unknown }) => {
    if (!mainOnly(event.sender)) return { ok: false, code: 'VAULT_FORBIDDEN' };
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!id) return { ok: false, code: 'VAULT_INVALID_INPUT' };
    try {
      const deleted = deps.vault.deleteEntry(id);
      if (deleted) broadcastChanged();
      return deleted
        ? { ok: true }
        : { ok: false, code: 'VAULT_ENTRY_NOT_FOUND' };
    } catch (error) {
      console.error(`[password-vault] delete failed code=${codeOf(error)} entryId=${id}`);
      return { ok: false, code: codeOf(error) };
    }
  });

  const openTrustedWindow = (entryId: string): PasswordVaultActionResult => {
    try {
      if (!deps.vault.listMetadata().some((entry) => entry.id === entryId)) {
        return { ok: false, code: 'VAULT_ENTRY_NOT_FOUND' };
      }
    } catch (error) {
      return { ok: false, code: codeOf(error) };
    }
    const existing = trustedWindows.get(entryId);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { ok: true };
    }
    const win = new BrowserWindow({
      width: 520,
      height: 420,
      minWidth: 440,
      minHeight: 340,
      title: 'Saved password',
      backgroundColor: '#1b1b1b',
      show: false,
      webPreferences: {
        preload: deps.preloadPath ?? path.join(__dirname, 'passwordTrustedPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    trustedWindows.set(entryId, win);
    const trustedSenderId = win.webContents.id;
    trustedEntryBySender.set(trustedSenderId, entryId);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.once('closed', () => {
      trustedWindows.delete(entryId);
      trustedEntryBySender.delete(trustedSenderId);
      trustedActionBySender.delete(trustedSenderId);
    });
    if (deps.rendererDevServerUrl) {
      const url = new URL(deps.rendererDevServerUrl);
      url.searchParams.set('passwordTrusted', '1');
      void win.loadURL(url.toString());
    } else {
      void win.loadFile(
        path.join(__dirname, `../renderer/${deps.rendererName}/index.html`),
        { query: { passwordTrusted: '1' } },
      );
    }
    return { ok: true };
  };

  ipcMain.handle(PASSWORD_VAULT_CHANNELS.openTrusted, (event, payload: { id?: unknown }) => {
    if (!mainOnly(event.sender)) return { ok: false, code: 'VAULT_FORBIDDEN' };
    const id = typeof payload?.id === 'string' ? payload.id : '';
    return id ? openTrustedWindow(id) : { ok: false, code: 'VAULT_INVALID_INPUT' };
  });

  ipcMain.handle(
    PASSWORD_VAULT_CHANNELS.openAccountMenu,
    (event, payload: { guestWebContentsId?: unknown }) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const guestId =
        typeof payload?.guestWebContentsId === 'number' ? payload.guestWebContentsId : -1;
      if (!owner || !deps.controller.guestBelongsToOwner(guestId, event.sender.id)) {
        return { ok: false, code: 'VAULT_FORBIDDEN' };
      }
      const entries = deps.controller.guestMetadata(guestId);
      if (entries.length === 0) return { ok: false, code: 'VAULT_ENTRY_NOT_FOUND' };
      const menu = Menu.buildFromTemplate(
        entries.map((entry) => ({
          label: entry.username,
          click: () => deps.controller.fillEntry(guestId, entry.id),
        })),
      );
      menu.popup({ window: owner });
      return { ok: true };
    },
  );

  ipcMain.handle(PASSWORD_TRUSTED_CHANNELS.context, (event): TrustedPasswordContext => {
    const id = trustedEntry(event.sender);
    if (!id) throw Object.assign(new Error('forbidden'), { code: 'VAULT_FORBIDDEN' });
    const metadata = deps.vault.listMetadata().find((entry) => entry.id === id);
    if (!metadata) throw Object.assign(new Error('not found'), { code: 'VAULT_ENTRY_NOT_FOUND' });
    return {
      metadata,
      revealDurationMs: PASSWORD_REVEAL_DURATION_MS,
      clipboardLeaseMs: PASSWORD_CLIPBOARD_LEASE_MS,
    };
  });

  ipcMain.handle(
    PASSWORD_TRUSTED_CHANNELS.actionGrant,
    (event, payload: { action?: unknown }): TrustedPasswordActionGrant => {
      const entryId = trustedEntry(event.sender);
      const action = payload?.action;
      if (!entryId || (action !== 'reveal' && action !== 'copy')) {
        return { ok: false, code: 'VAULT_FORBIDDEN' };
      }
      const expiresAt = Date.now() + PASSWORD_TRUSTED_ACTION_PROOF_TTL_MS;
      const proof = randomBytes(32).toString('base64url');
      trustedActionBySender.set(event.sender.id, { action, entryId, expiresAt, proof });
      return { ok: true, expiresAt, proof };
    },
  );

  ipcMain.handle(PASSWORD_TRUSTED_CHANNELS.reveal, (event, payload: { proof?: unknown }): TrustedPasswordRevealResult => {
    const id = consumeTrustedAction(event.sender, 'reveal', payload);
    if (!id) return { ok: false, code: 'VAULT_FORBIDDEN' };
    try {
      return {
        ok: true,
        password: deps.vault.getDecrypted(id).password,
        hideAt: Date.now() + PASSWORD_REVEAL_DURATION_MS,
      };
    } catch (error) {
      console.error(`[password-vault] reveal failed code=${codeOf(error)} entryId=${id}`);
      return { ok: false, code: codeOf(error) };
    }
  });

  ipcMain.handle(PASSWORD_TRUSTED_CHANNELS.copy, (event, payload: { proof?: unknown }): TrustedPasswordCopyResult => {
    const id = consumeTrustedAction(event.sender, 'copy', payload);
    if (!id) return { ok: false, code: 'VAULT_FORBIDDEN' };
    try {
      const lease = deps.clipboardLease.copy(deps.vault.getDecrypted(id).password);
      return { ok: true, expiresAt: lease.expiresAt };
    } catch (error) {
      console.error(`[password-vault] copy failed code=${codeOf(error)} entryId=${id}`);
      return { ok: false, code: codeOf(error) };
    }
  });

  return {
    broadcastChanged,
    closeAllTrustedWindows() {
      for (const win of trustedWindows.values()) {
        if (!win.isDestroyed()) win.close();
      }
      trustedWindows.clear();
      trustedEntryBySender.clear();
      trustedActionBySender.clear();
    },
  };
}
