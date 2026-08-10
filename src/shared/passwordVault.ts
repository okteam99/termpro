// Browser password-vault contracts shared by main, the host renderer and the two
// fixed preloads. Plaintext-bearing types are used only by the trusted guest and
// trusted password window; the ordinary window bridge deliberately exposes only
// PasswordCredentialMetadata.

export const MAX_PASSWORD_USERNAME_LENGTH = 1024;
export const MAX_PASSWORD_LENGTH = 16_384;
export const PASSWORD_REVEAL_DURATION_MS = 10_000;
export const PASSWORD_CLIPBOARD_LEASE_MS = 60_000;
export const PASSWORD_TRUSTED_ACTION_PROOF_TTL_MS = 5_000;

export interface PasswordCredentialMetadata {
  id: string;
  profileId: string;
  origin: string;
  username: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

export interface PasswordVaultCapabilities {
  encryptionAvailable: boolean;
}

export interface PasswordMetadataQuery {
  profileId?: string;
  query?: string;
}

export interface PasswordVaultActionResult {
  ok: boolean;
  code?: PasswordVaultErrorCode;
}

export type PasswordVaultErrorCode =
  | 'VAULT_ENCRYPTION_UNAVAILABLE'
  | 'VAULT_CORRUPT'
  | 'VAULT_DECRYPT_FAILED'
  | 'VAULT_ENTRY_NOT_FOUND'
  | 'VAULT_FORBIDDEN'
  | 'VAULT_INVALID_INPUT'
  | 'VAULT_INSECURE_ORIGIN'
  | 'VAULT_IO_FAILED'
  | 'VAULT_PROFILE_INACTIVE';

export type PasswordGuestStatusKind =
  | 'idle'
  | 'filled'
  | 'multiple'
  | 'saved'
  | 'updated'
  | 'auth_failed'
  | 'uncertain'
  | 'unavailable'
  | 'insecure_origin';

export interface PasswordGuestStatus {
  kind: PasswordGuestStatusKind;
  usernames?: string[];
  selectedUsername?: string;
  messageCode?: string;
}

export interface PasswordGuestLookupRequest {
  pageUsername?: string;
}

export type PasswordGuestLookupResult =
  | { kind: 'none' }
  | { kind: 'multiple'; usernames: string[]; selectedUsername?: string }
  | { kind: 'unavailable' | 'insecure_origin' }
  | {
      kind: 'credential';
      username: string;
      password: string;
      entryId: string;
      /** Present when the current origin has alternative accounts. */
      usernames?: string[];
    };

export interface PasswordLoginCandidate {
  nonce: string;
  username: string;
  password: string;
}

export interface PasswordLoginResultEvidence {
  nonce: string;
  result: 'success' | 'failed' | 'uncertain';
  reason?: 'navigation' | 'form_disappeared' | 'authenticated_state' | 'message' | 'timeout';
}

export interface TrustedPasswordContext {
  metadata: PasswordCredentialMetadata;
  revealDurationMs: number;
  clipboardLeaseMs: number;
}

export interface TrustedPasswordRevealResult extends PasswordVaultActionResult {
  password?: string;
  hideAt?: number;
}

export interface TrustedPasswordCopyResult extends PasswordVaultActionResult {
  expiresAt?: number;
}

export type TrustedPasswordAction = 'reveal' | 'copy';

export interface TrustedPasswordActionGrant extends PasswordVaultActionResult {
  proof?: string;
  expiresAt?: number;
}

export const PASSWORD_VAULT_CHANNELS = {
  capabilities: 'passwordVault:capabilities',
  listMetadata: 'passwordVault:listMetadata',
  deleteEntry: 'passwordVault:deleteEntry',
  openTrusted: 'passwordVault:openTrusted',
  openAccountMenu: 'passwordVault:openAccountMenu',
  changed: 'passwordVault:changed',
} as const;

export const PASSWORD_GUEST_CHANNELS = {
  lookup: 'passwordVaultGuest:lookup',
  candidate: 'passwordVaultGuest:candidate',
  result: 'passwordVaultGuest:result',
  fill: 'passwordVaultGuest:fill',
  verify: 'passwordVaultGuest:verify',
  status: 'passwordVaultGuest:status',
  statusToHost: 'passwordVault:status',
} as const;

export const PASSWORD_TRUSTED_CHANNELS = {
  context: 'passwordVaultTrusted:context',
  actionGrant: 'passwordVaultTrusted:actionGrant',
  reveal: 'passwordVaultTrusted:reveal',
  copy: 'passwordVaultTrusted:copy',
} as const;

export function isPasswordGuestStatus(value: unknown): value is PasswordGuestStatus {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === 'idle' ||
    kind === 'filled' ||
    kind === 'multiple' ||
    kind === 'saved' ||
    kind === 'updated' ||
    kind === 'auth_failed' ||
    kind === 'uncertain' ||
    kind === 'unavailable' ||
    kind === 'insecure_origin'
  );
}
