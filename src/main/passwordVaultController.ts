import {
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_USERNAME_LENGTH,
  PASSWORD_GUEST_CHANNELS,
  type PasswordCredentialMetadata,
  type PasswordGuestLookupRequest,
  type PasswordGuestLookupResult,
  type PasswordGuestStatus,
  type PasswordLoginCandidate,
  type PasswordLoginResultEvidence,
  type PasswordMetadataQuery,
} from '../shared/passwordVault';

const PENDING_LOGIN_TIMEOUT_MS = 15_000;

export interface DecryptedPasswordCredentialLike {
  id: string;
  profileId: string;
  origin: string;
  username: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  password: string;
}

export interface PasswordVaultPort {
  isAvailable(): boolean;
  listMetadata(query?: PasswordMetadataQuery): PasswordCredentialMetadata[];
  lookup(profileId: string, origin: string): DecryptedPasswordCredentialLike[];
  getDecrypted(id: string): DecryptedPasswordCredentialLike;
  upsert(input: {
    profileId: string;
    origin: string;
    username: string;
    password: string;
    now?: number;
  }): { kind: 'saved' | 'updated'; metadata: PasswordCredentialMetadata };
  deleteEntry(id: string): boolean;
  deleteProfile(profileId: string): boolean;
}

export interface PasswordGuestSender {
  readonly id: number;
  getURL(): string;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once(event: 'destroyed', listener: () => void): unknown;
  close?(options?: { waitForBeforeUnload?: boolean }): void;
}

export interface PasswordVaultControllerDeps {
  vault: PasswordVaultPort;
  isProfileActive(profileId: string): boolean;
  onMetadataChanged(): void;
  logger?: {
    warn(message: string): void;
    error(message: string): void;
  };
  now?: () => number;
}

interface RegisteredGuest {
  sender: PasswordGuestSender;
  ownerWebContentsId: number;
  profileId: string;
}

interface PendingLogin {
  nonce: string;
  profileId: string;
  origin: string;
  username: string;
  password: string;
  submittedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '::1') {
    return true;
  }
  const parts = host.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part));
}

export function canonicalPasswordOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

function fixedErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^VAULT_[A-Z_]+$/.test(code) ? code : 'VAULT_IO_FAILED';
}

export class PasswordVaultController {
  private readonly guests = new Map<number, RegisteredGuest>();
  private readonly pending = new Map<number, PendingLogin>();
  private readonly now: () => number;
  private readonly logger: NonNullable<PasswordVaultControllerDeps['logger']>;

  constructor(private readonly deps: PasswordVaultControllerDeps) {
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? console;
  }

  registerGuest(
    sender: PasswordGuestSender,
    profileId: string,
    ownerWebContentsId: number,
  ): void {
    this.unregisterGuest(sender.id);
    this.guests.set(sender.id, { sender, profileId, ownerWebContentsId });
    sender.once('destroyed', () => this.unregisterGuest(sender.id));
  }

  unregisterGuest(senderId: number): void {
    this.clearPending(senderId);
    this.guests.delete(senderId);
  }

  closeProfileGuests(profileId: string): void {
    for (const guest of this.guests.values()) {
      if (guest.profileId !== profileId) continue;
      if (!guest.sender.isDestroyed()) {
        guest.sender.send(PASSWORD_GUEST_CHANNELS.status, {
          kind: 'unavailable',
          messageCode: 'profile_inactive',
        } satisfies PasswordGuestStatus);
        guest.sender.close?.({ waitForBeforeUnload: false });
      }
      this.unregisterGuest(guest.sender.id);
    }
  }

  guestBelongsToOwner(guestWebContentsId: number, ownerWebContentsId: number): boolean {
    return this.guests.get(guestWebContentsId)?.ownerWebContentsId === ownerWebContentsId;
  }

  guestMetadata(guestWebContentsId: number): PasswordCredentialMetadata[] {
    const ctx = this.context(guestWebContentsId);
    if (!ctx) return [];
    return this.deps.vault.listMetadata({ profileId: ctx.guest.profileId }).filter(
      (entry) => entry.origin === ctx.origin,
    );
  }

  lookup(senderId: number, request: PasswordGuestLookupRequest): PasswordGuestLookupResult {
    const ctx = this.context(senderId);
    if (!ctx) return { kind: 'unavailable' };
    if (!ctx.origin) return { kind: 'insecure_origin' };
    try {
      const candidates = this.deps.vault.lookup(ctx.guest.profileId, ctx.origin);
      if (candidates.length === 0) return { kind: 'none' };
      const requestedUsername =
        typeof request?.pageUsername === 'string' ? request.pageUsername.trim() : '';
      const selected =
        candidates.find((entry) => entry.username === requestedUsername) ?? candidates[0];
      return {
        kind: 'credential',
        entryId: selected.id,
        username: selected.username,
        password: selected.password,
        ...(candidates.length > 1
          ? { usernames: candidates.map((entry) => entry.username) }
          : {}),
      };
    } catch (error) {
      this.logger.error(
        `[password-vault] lookup failed code=${fixedErrorCode(error)} senderId=${senderId}`,
      );
      return { kind: 'unavailable' };
    }
  }

  acceptCandidate(senderId: number, candidate: PasswordLoginCandidate): boolean {
    const ctx = this.context(senderId);
    if (!ctx?.origin || !this.deps.vault.isAvailable()) return false;
    const nonce = typeof candidate?.nonce === 'string' ? candidate.nonce : '';
    const username = typeof candidate?.username === 'string' ? candidate.username.trim() : '';
    const password = typeof candidate?.password === 'string' ? candidate.password : '';
    if (
      !nonce ||
      nonce.length > 200 ||
      !username ||
      username.length > MAX_PASSWORD_USERNAME_LENGTH ||
      !password ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return false;
    }
    this.clearPending(senderId);
    const timer = setTimeout(() => {
      const pending = this.pending.get(senderId);
      if (!pending || pending.nonce !== nonce) return;
      this.clearPending(senderId);
      this.sendStatus(senderId, { kind: 'uncertain', messageCode: 'login_timeout' });
    }, PENDING_LOGIN_TIMEOUT_MS);
    this.pending.set(senderId, {
      nonce,
      profileId: ctx.guest.profileId,
      origin: ctx.origin,
      username,
      password,
      submittedAt: this.now(),
      timer,
    });
    return true;
  }

  settleCandidate(senderId: number, evidence: PasswordLoginResultEvidence): PasswordGuestStatus {
    const pending = this.pending.get(senderId);
    const ctx = this.context(senderId);
    if (
      !pending ||
      !ctx?.origin ||
      evidence?.nonce !== pending.nonce ||
      ctx.origin !== pending.origin ||
      ctx.guest.profileId !== pending.profileId
    ) {
      this.clearPending(senderId);
      return { kind: 'uncertain', messageCode: 'stale_login_evidence' };
    }
    if (evidence.result !== 'success') {
      this.clearPending(senderId);
      const status: PasswordGuestStatus =
        evidence.result === 'failed'
          ? { kind: 'auth_failed' }
          : { kind: 'uncertain', messageCode: evidence.reason ?? 'uncertain' };
      this.sendStatus(senderId, status);
      return status;
    }
    try {
      const result = this.deps.vault.upsert({
        profileId: pending.profileId,
        origin: pending.origin,
        username: pending.username,
        password: pending.password,
        now: this.now(),
      });
      this.clearPending(senderId);
      this.deps.onMetadataChanged();
      const status: PasswordGuestStatus = {
        kind: result.kind,
        selectedUsername: result.metadata.username,
      };
      this.sendStatus(senderId, status);
      return status;
    } catch (error) {
      this.clearPending(senderId);
      this.logger.error(
        `[password-vault] save failed code=${fixedErrorCode(error)} senderId=${senderId}`,
      );
      const status: PasswordGuestStatus = { kind: 'unavailable', messageCode: fixedErrorCode(error) };
      this.sendStatus(senderId, status);
      return status;
    }
  }

  requestNavigationVerification(senderId: number): void {
    const pending = this.pending.get(senderId);
    const guest = this.guests.get(senderId);
    if (!pending || !guest || guest.sender.isDestroyed()) return;
    guest.sender.send(PASSWORD_GUEST_CHANNELS.verify, { nonce: pending.nonce });
  }

  fillEntry(senderId: number, entryId: string): boolean {
    const ctx = this.context(senderId);
    if (!ctx?.origin) return false;
    try {
      const entry = this.deps.vault.getDecrypted(entryId);
      if (
        entry.profileId !== ctx.guest.profileId ||
        entry.origin !== ctx.origin
      ) {
        this.logger.warn(`[password-vault] forbidden fill senderId=${senderId}`);
        return false;
      }
      const all = this.deps.vault.lookup(ctx.guest.profileId, ctx.origin);
      ctx.guest.sender.send(PASSWORD_GUEST_CHANNELS.fill, {
        kind: 'credential',
        entryId: entry.id,
        username: entry.username,
        password: entry.password,
        ...(all.length > 1 ? { usernames: all.map((item) => item.username) } : {}),
      } satisfies PasswordGuestLookupResult);
      return true;
    } catch (error) {
      this.logger.error(
        `[password-vault] fill failed code=${fixedErrorCode(error)} senderId=${senderId}`,
      );
      return false;
    }
  }

  private context(senderId: number): { guest: RegisteredGuest; origin: string | null } | null {
    const guest = this.guests.get(senderId);
    if (
      !guest ||
      guest.sender.isDestroyed() ||
      !this.deps.isProfileActive(guest.profileId)
    ) {
      return null;
    }
    return { guest, origin: canonicalPasswordOrigin(guest.sender.getURL()) };
  }

  private sendStatus(senderId: number, status: PasswordGuestStatus): void {
    const sender = this.guests.get(senderId)?.sender;
    if (sender && !sender.isDestroyed()) sender.send(PASSWORD_GUEST_CHANNELS.status, status);
  }

  private clearPending(senderId: number): void {
    const pending = this.pending.get(senderId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(senderId);
  }
}
