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
  type PasswordMetadataSnapshot,
  type PasswordVaultActionResult,
  type TrustedPasswordAction,
  type TrustedPasswordActionGrant,
  type TrustedPasswordContext,
  type TrustedPasswordCopyResult,
  type TrustedPasswordRevealResult,
} from '../shared/passwordVault';
import {
  PasswordVaultController,
  type PasswordVaultPort,
} from './passwordVaultController';

interface ClipboardSecretLeasePort {
  copy(secret: string): { expiresAt: number };
}

export interface PasswordVaultIpcDeps {
  vault: PasswordVaultPort;
  controller: PasswordVaultController;
  clipboardLease: ClipboardSecretLeasePort;
  isProfileActive(profileId: string): boolean;
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
  closeProfileTrustedWindows(profileId: string): void;
  closeAllTrustedWindows(): void;
} {
  const trustedEntryBySender = new Map<number, string>();
  const trustedProfileBySender = new Map<number, string>();
  const trustedWindows = new Map<string, BrowserWindow>();
  const trustedActionBySender = new Map<
    number,
    {
      action: TrustedPasswordAction;
      entryId: string;
      expiresAt: number;
      proof: string;
    }
  >();

  const mainOnly = (sender: Electron.WebContents): boolean => {
    const main = deps.getMainWindow();
    return main !== null && BrowserWindow.fromWebContents(sender) === main;
  };

  const profileIsActive = (profileId: string): boolean => {
    try {
      return deps.isProfileActive(profileId);
    } catch {
      return false;
    }
  };

  const trustedEntry = (
    sender: Electron.WebContents,
  ): { entryId: string; profileId: string } | null => {
    const entryId = trustedEntryBySender.get(sender.id);
    const profileId = trustedProfileBySender.get(sender.id);
    return entryId && profileId && profileIsActive(profileId)
      ? { entryId, profileId }
      : null;
  };

  const consumeTrustedAction = (
    sender: Electron.WebContents,
    action: TrustedPasswordAction,
    payload: { proof?: unknown },
  ): { entryId: string; profileId: string } | null => {
    const scoped = trustedEntry(sender);
    if (!scoped) return null;
    const grant = trustedActionBySender.get(sender.id);
    trustedActionBySender.delete(sender.id);
    if (
      !grant ||
      grant.entryId !== scoped.entryId ||
      grant.action !== action ||
      grant.expiresAt < Date.now() ||
      typeof payload?.proof !== 'string'
    )
      return null;
    const expected = Buffer.from(grant.proof);
    const received = Buffer.from(payload.proof);
    return expected.length === received.length &&
      timingSafeEqual(expected, received)
      ? scoped
      : null;
  };

  const broadcastChanged = () => {
    const main = deps.getMainWindow();
    if (main && !main.isDestroyed())
      main.webContents.send(PASSWORD_VAULT_CHANNELS.changed);
  };

  ipcMain.handle(PASSWORD_VAULT_CHANNELS.capabilities, (event) => ({
    encryptionAvailable:
      mainOnly(event.sender) &&
      (deps.vault.localEncryptionAvailable?.() ??
        deps.vault.isAvailable('default')),
  }));

  ipcMain.handle(
    PASSWORD_VAULT_CHANNELS.listMetadata,
    async (
      event,
      query: PasswordMetadataQuery = {},
    ): Promise<PasswordMetadataSnapshot> => {
      if (!mainOnly(event.sender))
        return { entries: [], unavailableProfiles: [] };
      const safeQuery: PasswordMetadataQuery = {
        ...(typeof query?.profileId === 'string'
          ? { profileId: query.profileId }
          : {}),
        ...(typeof query?.query === 'string'
          ? { query: query.query.slice(0, 1024) }
          : {}),
      };
      try {
        const snapshot = await deps.vault.listMetadata(safeQuery);
        return {
          entries: snapshot.entries.filter((entry) =>
            profileIsActive(entry.profileId),
          ),
          unavailableProfiles: snapshot.unavailableProfiles.filter((item) =>
            profileIsActive(item.profileId),
          ),
        };
      } catch (error) {
        console.error(`[password-vault] list failed code=${codeOf(error)}`);
        throw new Error(codeOf(error));
      }
    },
  );

  ipcMain.handle(
    PASSWORD_VAULT_CHANNELS.deleteEntry,
    async (event, payload: { profileId?: unknown; id?: unknown }) => {
      if (!mainOnly(event.sender))
        return { ok: false, code: 'VAULT_FORBIDDEN' };
      const profileId =
        typeof payload?.profileId === 'string' ? payload.profileId : '';
      const id = typeof payload?.id === 'string' ? payload.id : '';
      if (!profileId || !id) return { ok: false, code: 'VAULT_INVALID_INPUT' };
      try {
        const deleted = await deps.vault.deleteEntry(profileId, id);
        if (deleted) broadcastChanged();
        return deleted
          ? { ok: true }
          : { ok: false, code: 'VAULT_ENTRY_NOT_FOUND' };
      } catch (error) {
        console.error(
          `[password-vault] delete failed code=${codeOf(error)} entryId=${id}`,
        );
        return { ok: false, code: codeOf(error) };
      }
    },
  );

  const openTrustedWindow = async (
    profileId: string,
    entryId: string,
  ): Promise<PasswordVaultActionResult> => {
    try {
      const snapshot = await deps.vault.listMetadata({ profileId });
      const metadata = snapshot.entries.find((entry) => entry.id === entryId);
      if (!metadata) {
        return { ok: false, code: 'VAULT_ENTRY_NOT_FOUND' };
      }
      if (metadata.profileId !== profileId)
        return { ok: false, code: 'VAULT_FORBIDDEN' };
      if (!profileIsActive(profileId)) {
        return { ok: false, code: 'VAULT_PROFILE_INACTIVE' };
      }
    } catch (error) {
      return { ok: false, code: codeOf(error) };
    }
    const windowKey = `${profileId}:${entryId}`;
    const existing = trustedWindows.get(windowKey);
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
        preload:
          deps.preloadPath ?? path.join(__dirname, 'passwordTrustedPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    trustedWindows.set(windowKey, win);
    const trustedSenderId = win.webContents.id;
    trustedEntryBySender.set(trustedSenderId, entryId);
    trustedProfileBySender.set(trustedSenderId, profileId);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.once('closed', () => {
      trustedWindows.delete(windowKey);
      trustedEntryBySender.delete(trustedSenderId);
      trustedProfileBySender.delete(trustedSenderId);
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

  ipcMain.handle(
    PASSWORD_VAULT_CHANNELS.openTrusted,
    async (event, payload: { profileId?: unknown; id?: unknown }) => {
      if (!mainOnly(event.sender))
        return { ok: false, code: 'VAULT_FORBIDDEN' };
      const profileId =
        typeof payload?.profileId === 'string' ? payload.profileId : '';
      const id = typeof payload?.id === 'string' ? payload.id : '';
      return profileId && id
        ? openTrustedWindow(profileId, id)
        : { ok: false, code: 'VAULT_INVALID_INPUT' };
    },
  );

  ipcMain.handle(
    PASSWORD_VAULT_CHANNELS.openAccountMenu,
    async (event, payload: { guestWebContentsId?: unknown }) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const guestId =
        typeof payload?.guestWebContentsId === 'number'
          ? payload.guestWebContentsId
          : -1;
      if (
        !owner ||
        !deps.controller.guestBelongsToOwner(guestId, event.sender.id)
      ) {
        return { ok: false, code: 'VAULT_FORBIDDEN' };
      }
      const entries = await deps.controller.guestMetadata(guestId);
      if (entries.length === 0)
        return { ok: false, code: 'VAULT_ENTRY_NOT_FOUND' };
      const menu = Menu.buildFromTemplate(
        entries.map((entry) => ({
          label: entry.username,
          click: () => void deps.controller.fillEntry(guestId, entry.id),
        })),
      );
      menu.popup({ window: owner });
      return { ok: true };
    },
  );

  ipcMain.handle(
    PASSWORD_TRUSTED_CHANNELS.context,
    async (event): Promise<TrustedPasswordContext> => {
      const scoped = trustedEntry(event.sender);
      if (!scoped)
        throw Object.assign(new Error('forbidden'), {
          code: 'VAULT_FORBIDDEN',
        });
      const snapshot = await deps.vault.listMetadata({
        profileId: scoped.profileId,
      });
      const metadata = snapshot.entries.find(
        (entry) => entry.id === scoped.entryId,
      );
      if (!metadata)
        throw Object.assign(new Error('not found'), {
          code: 'VAULT_ENTRY_NOT_FOUND',
        });
      return {
        metadata,
        revealDurationMs: PASSWORD_REVEAL_DURATION_MS,
        clipboardLeaseMs: PASSWORD_CLIPBOARD_LEASE_MS,
      };
    },
  );

  ipcMain.handle(
    PASSWORD_TRUSTED_CHANNELS.actionGrant,
    (event, payload: { action?: unknown }): TrustedPasswordActionGrant => {
      const scoped = trustedEntry(event.sender);
      const action = payload?.action;
      if (!scoped || (action !== 'reveal' && action !== 'copy')) {
        return { ok: false, code: 'VAULT_FORBIDDEN' };
      }
      const expiresAt = Date.now() + PASSWORD_TRUSTED_ACTION_PROOF_TTL_MS;
      const proof = randomBytes(32).toString('base64url');
      trustedActionBySender.set(event.sender.id, {
        action,
        entryId: scoped.entryId,
        expiresAt,
        proof,
      });
      return { ok: true, expiresAt, proof };
    },
  );

  ipcMain.handle(
    PASSWORD_TRUSTED_CHANNELS.reveal,
    async (
      event,
      payload: { proof?: unknown },
    ): Promise<TrustedPasswordRevealResult> => {
      const scoped = consumeTrustedAction(event.sender, 'reveal', payload);
      if (!scoped) return { ok: false, code: 'VAULT_FORBIDDEN' };
      try {
        return {
          ok: true,
          password: (
            await deps.vault.getDecrypted(scoped.profileId, scoped.entryId)
          ).password,
          hideAt: Date.now() + PASSWORD_REVEAL_DURATION_MS,
        };
      } catch (error) {
        console.error(
          `[password-vault] reveal failed code=${codeOf(error)} entryId=${scoped.entryId}`,
        );
        return { ok: false, code: codeOf(error) };
      }
    },
  );

  ipcMain.handle(
    PASSWORD_TRUSTED_CHANNELS.copy,
    async (
      event,
      payload: { proof?: unknown },
    ): Promise<TrustedPasswordCopyResult> => {
      const scoped = consumeTrustedAction(event.sender, 'copy', payload);
      if (!scoped) return { ok: false, code: 'VAULT_FORBIDDEN' };
      try {
        const credential = await deps.vault.getDecrypted(
          scoped.profileId,
          scoped.entryId,
        );
        const lease = deps.clipboardLease.copy(credential.password);
        return { ok: true, expiresAt: lease.expiresAt };
      } catch (error) {
        console.error(
          `[password-vault] copy failed code=${codeOf(error)} entryId=${scoped.entryId}`,
        );
        return { ok: false, code: codeOf(error) };
      }
    },
  );

  return {
    broadcastChanged,
    closeProfileTrustedWindows(profileId: string) {
      for (const [entryId, win] of trustedWindows) {
        const senderId = win.webContents.id;
        if (trustedProfileBySender.get(senderId) !== profileId) continue;
        trustedWindows.delete(entryId);
        trustedEntryBySender.delete(senderId);
        trustedProfileBySender.delete(senderId);
        trustedActionBySender.delete(senderId);
        if (!win.isDestroyed()) win.close();
      }
    },
    closeAllTrustedWindows() {
      for (const win of trustedWindows.values()) {
        if (!win.isDestroyed()) win.close();
      }
      trustedWindows.clear();
      trustedEntryBySender.clear();
      trustedProfileBySender.clear();
      trustedActionBySender.clear();
    },
  };
}
