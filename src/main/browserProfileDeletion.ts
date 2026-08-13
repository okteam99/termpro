import {
  BROWSER_PROFILE_DELETION_ERROR_CODES,
  BROWSER_PROFILE_DELETE_REJECTION_CODES,
  DEFAULT_PROFILE_ID,
  type BrowserProfile,
  type BrowserProfileDeletionErrorCode,
  type BrowserProfileDeletionResult,
} from '../shared/browserProfile';

const FEATURE_ID = 'OKWORK-F260807022801-Profile-Password-Vault';

export type BrowserProfileDeletionStep =
  | 'persist_deleting'
  | 'disable_access'
  | 'clear_vault'
  | 'list_partitions'
  | 'clear_storage'
  | 'clear_cache'
  | 'remove_metadata'
  | 'persist_delete_failed'
  | 'notify';

export interface BrowserProfileDeletionLogEvent {
  featureId: typeof FEATURE_ID;
  profileId: string;
  step: BrowserProfileDeletionStep;
  errorCode: string;
}

/** BrowserProfileStore 满足该窄接口；协调器不依赖 SettingsStore 或 Electron。 */
export interface BrowserProfileDeletionStore {
  get(id: string): BrowserProfile | null;
  list(): BrowserProfile[];
  markDeleting(id: string, updatedAt?: number): BrowserProfile;
  markDeleteFailed(
    id: string,
    errorCode: BrowserProfileDeletionErrorCode,
    updatedAt?: number,
  ): BrowserProfile;
  finalizeDeletion(id: string): boolean;
}

export interface BrowserProfileDeletionDeps {
  profiles: BrowserProfileDeletionStore;
  /** Storage migration and deletion are mutually exclusive durable workflows. */
  canBeginDeletion?(profileId: string): boolean;
  /** 状态已落盘后，立即关闭/注销该 Profile 的 guest 能力。 */
  disableProfileAccess(profileId: string): void | Promise<void>;
  clearVault(profileId: string): void | Promise<void>;
  partitionsForProfile(profileId: string): string[];
  clearPartitionStorage(partition: string): void | Promise<void>;
  clearPartitionCache(partition: string): void | Promise<void>;
  /** Remove durable cleanup history only after every partition was cleared. */
  finalizeProfileCleanup?(profileId: string): void | Promise<void>;
  /** 广播最新 Profile 快照；广播失败不放宽已经落盘的安全状态。 */
  notifyProfilesChanged(): void | Promise<void>;
  logger: {
    warn(event: BrowserProfileDeletionLogEvent): void;
    error(event: BrowserProfileDeletionLogEvent): void;
  };
  now?: () => number;
}

interface DeletionFailure {
  step: BrowserProfileDeletionStep;
  errorCode: BrowserProfileDeletionErrorCode;
}

/**
 * Profile 删除协调器：先持久化禁用，再幂等清理，最后才移除元数据。
 * 所有公开方法都返回脱敏结果，不把底层异常传播到 renderer。
 */
export class BrowserProfileDeletionCoordinator {
  private readonly inflight = new Map<
    string,
    Promise<BrowserProfileDeletionResult>
  >();

  constructor(private readonly deps: BrowserProfileDeletionDeps) {}

  deleteProfile(profileId: string): Promise<BrowserProfileDeletionResult> {
    return this.enqueue(profileId, false);
  }

  retryProfileDeletion(
    profileId: string,
  ): Promise<BrowserProfileDeletionResult> {
    return this.enqueue(profileId, false);
  }

  /** 仅续跑上次进程已持久化为 deleting 的条目；delete_failed 等用户显式重试。 */
  async resumeInterruptedDeletions(): Promise<BrowserProfileDeletionResult[]> {
    const interrupted = this.deps.profiles
      .list()
      .filter((profile) => profile.deletionState === 'deleting');
    return Promise.all(
      interrupted.map((profile) => this.enqueue(profile.id, true)),
    );
  }

  private enqueue(
    profileId: string,
    resume: boolean,
  ): Promise<BrowserProfileDeletionResult> {
    const existing = this.inflight.get(profileId);
    if (existing) return existing;
    const operation = this.run(profileId, resume).finally(() => {
      if (this.inflight.get(profileId) === operation)
        this.inflight.delete(profileId);
    });
    this.inflight.set(profileId, operation);
    return operation;
  }

  private async run(
    profileId: string,
    resume: boolean,
  ): Promise<BrowserProfileDeletionResult> {
    if (profileId === DEFAULT_PROFILE_ID) {
      return {
        status: 'rejected',
        profileId,
        errorCode: BROWSER_PROFILE_DELETE_REJECTION_CODES.defaultProfile,
      };
    }
    const current = this.deps.profiles.get(profileId);
    if (!current) {
      return {
        status: 'rejected',
        profileId,
        errorCode: BROWSER_PROFILE_DELETE_REJECTION_CODES.notFound,
      };
    }
    if (resume && current.deletionState !== 'deleting') {
      return {
        status: 'rejected',
        profileId,
        errorCode: BROWSER_PROFILE_DELETE_REJECTION_CODES.notFound,
      };
    }
    if (!resume && this.deps.canBeginDeletion?.(profileId) === false) {
      return {
        status: 'rejected',
        profileId,
        errorCode: BROWSER_PROFILE_DELETE_REJECTION_CODES.migrationInProgress,
      };
    }

    try {
      this.deps.profiles.markDeleting(profileId, this.now());
    } catch {
      this.logError(
        profileId,
        'persist_deleting',
        BROWSER_PROFILE_DELETION_ERROR_CODES.statePersistFailed,
      );
      return {
        status: 'delete_failed',
        profileId,
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.statePersistFailed,
        updatedAt: this.now(),
      };
    }

    try {
      await this.deps.disableProfileAccess(profileId);
    } catch {
      return this.persistFailure(profileId, {
        step: 'disable_access',
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.accessDisableFailed,
      });
    }
    await this.notify(profileId);

    const failure = await this.performCleanup(profileId);
    if (failure) return this.persistFailure(profileId, failure);

    try {
      if (!this.deps.profiles.finalizeDeletion(profileId)) {
        return this.persistFailure(profileId, {
          step: 'remove_metadata',
          errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.metadataRemoveFailed,
        });
      }
    } catch {
      return this.persistFailure(profileId, {
        step: 'remove_metadata',
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.metadataRemoveFailed,
      });
    }
    await this.notify(profileId);
    return { status: 'deleted', profileId };
  }

  private async performCleanup(
    profileId: string,
  ): Promise<DeletionFailure | null> {
    let partitions: string[];
    try {
      partitions = [...new Set(this.deps.partitionsForProfile(profileId))];
    } catch {
      return {
        step: 'list_partitions',
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.partitionListFailed,
      };
    }

    try {
      await this.deps.clearVault(profileId);
    } catch {
      return {
        step: 'clear_vault',
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.vaultClearFailed,
      };
    }
    for (const partition of partitions) {
      try {
        await this.deps.clearPartitionStorage(partition);
      } catch {
        return {
          step: 'clear_storage',
          errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.storageClearFailed,
        };
      }
      try {
        await this.deps.clearPartitionCache(partition);
      } catch {
        return {
          step: 'clear_cache',
          errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.cacheClearFailed,
        };
      }
    }
    try {
      await this.deps.finalizeProfileCleanup?.(profileId);
    } catch {
      return {
        step: 'clear_vault',
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.vaultClearFailed,
      };
    }
    return null;
  }

  private async persistFailure(
    profileId: string,
    failure: DeletionFailure,
  ): Promise<BrowserProfileDeletionResult> {
    this.logError(profileId, failure.step, failure.errorCode);
    const updatedAt = this.now();
    try {
      this.deps.profiles.markDeleteFailed(
        profileId,
        failure.errorCode,
        updatedAt,
      );
    } catch {
      this.logError(
        profileId,
        'persist_delete_failed',
        BROWSER_PROFILE_DELETION_ERROR_CODES.statePersistFailed,
      );
      return {
        status: 'delete_failed',
        profileId,
        errorCode: BROWSER_PROFILE_DELETION_ERROR_CODES.statePersistFailed,
        updatedAt,
      };
    }
    await this.notify(profileId);
    return {
      status: 'delete_failed',
      profileId,
      errorCode: failure.errorCode,
      updatedAt,
    };
  }

  private async notify(profileId: string): Promise<void> {
    try {
      await this.deps.notifyProfilesChanged();
    } catch {
      this.deps.logger.warn({
        featureId: FEATURE_ID,
        profileId,
        step: 'notify',
        errorCode: 'PROFILE_DELETE_NOTIFICATION_FAILED',
      });
    }
  }

  private logError(
    profileId: string,
    step: BrowserProfileDeletionStep,
    errorCode: BrowserProfileDeletionErrorCode,
  ): void {
    this.deps.logger.error({
      featureId: FEATURE_ID,
      profileId,
      step,
      errorCode,
    });
  }

  private now(): number {
    const value = this.deps.now?.() ?? Date.now();
    return Number.isFinite(value) ? value : Date.now();
  }
}
