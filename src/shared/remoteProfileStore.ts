import type { BrowserProfile } from './browserProfile';
import type { PasswordCredentialMetadata } from './passwordVault';
import type {
  PROFILE_CONTINUITY_ITEM_MAX_BYTES,
  PROFILE_CONTINUITY_PAGE_MAX_BYTES,
  PROFILE_CONTINUITY_VERSION,
} from './profileContinuity';

export const REMOTE_PROFILE_RPC_VERSION = 1 as const;
export const REMOTE_PROFILE_BUNDLE_VERSION = 1 as const;
export const REMOTE_PROFILE_RPC_MAX_BYTES = 8 * 1024 * 1024;

export interface DecryptedProfileCredential extends PasswordCredentialMetadata {
  password: string;
}

export interface ProfileBundleV1 {
  version: typeof REMOTE_PROFILE_BUNDLE_VERSION;
  profile: BrowserProfile;
  credentials: DecryptedProfileCredential[];
}

export type RemoteProfileRpcOperation =
  | 'describe'
  | 'profile.discover'
  | 'grant'
  | 'profile.get'
  | 'profile.lifecycle'
  | 'profile.save'
  | 'vault.list'
  | 'vault.lookup'
  | 'vault.get'
  | 'vault.upsert'
  | 'vault.delete'
  | 'bundle.export'
  | 'migration.stage'
  | 'migration.verify'
  | 'migration.publish'
  | 'migration.discard'
  | 'continuity.pull'
  | 'continuity.push'
  | 'continuity.migration.stage'
  | 'continuity.migration.verify'
  | 'continuity.migration.freeze'
  | 'continuity.migration.publish'
  | 'continuity.migration.activate'
  | 'continuity.migration.discard'
  | 'profile.retire'
  | 'profile.delete'
  | 'grant.revoke';

export interface RemoteProfileRpcRequest {
  version: typeof REMOTE_PROFILE_RPC_VERSION;
  requestId: string;
  op: RemoteProfileRpcOperation;
  clientId?: string;
  profileId?: string;
  generation?: string;
  capability?: string;
  payload?: unknown;
}

export type RemoteProfileRpcErrorCode =
  | 'PROFILE_RPC_FORBIDDEN'
  | 'PROFILE_RPC_INVALID_INPUT'
  | 'PROFILE_RPC_INCOMPATIBLE'
  | 'PROFILE_RPC_ENCRYPTION_UNAVAILABLE'
  | 'PROFILE_RPC_CORRUPT'
  | 'PROFILE_RPC_PROFILE_MISMATCH'
  | 'PROFILE_RPC_NOT_FOUND'
  | 'PROFILE_RPC_IO_FAILED';

export type ProfileContinuityRpcErrorCode =
  | 'PROFILE_CONTINUITY_BUSY'
  | 'PROFILE_CONTINUITY_ITEM_TOO_LARGE'
  | 'PROFILE_CONTINUITY_STALE_EPOCH'
  | 'PROFILE_CONTINUITY_LEGACY_DELETE_FORBIDDEN'
  | 'PROFILE_MOVED'
  | 'PROFILE_DELETED';

export type RemoteProfileRpcResponseErrorCode =
  | RemoteProfileRpcErrorCode
  | ProfileContinuityRpcErrorCode;

export type RemoteProfileRpcResponse =
  | { ok: true; requestId: string; data?: unknown }
  | {
      ok: false;
      requestId: string;
      code: RemoteProfileRpcResponseErrorCode;
    };

export interface RemoteProfileDescription {
  protocolVersion: typeof REMOTE_PROFILE_RPC_VERSION;
  bundleVersion: typeof REMOTE_PROFILE_BUNDLE_VERSION;
  encryption: 'aes-256-gcm';
  continuity?: {
    version: typeof PROFILE_CONTINUITY_VERSION;
    pageMaxBytes: typeof PROFILE_CONTINUITY_PAGE_MAX_BYTES;
    itemMaxBytes: typeof PROFILE_CONTINUITY_ITEM_MAX_BYTES;
  };
}

export interface RemoteProfileGrantResult {
  /** Returned only over the main-only SSH stdio bootstrap path; never persisted raw. */
  capability: string;
  expiresAt: number;
}
