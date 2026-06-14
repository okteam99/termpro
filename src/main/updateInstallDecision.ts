import type { ExitConfirmationResult } from './exitConfirmation';

export interface UpdateInstallEvent {
  state: 'available' | 'restarting';
  version?: string;
}

export interface UpdateInstallDecisionDeps {
  version?: string;
  confirmInstallWhenIdle(version?: string): Promise<ExitConfirmationResult>;
  clearWatchdog(): void;
  cleanupInstallArtifacts(): void;
  isStillInstalling(): boolean;
  setInstalling(value: boolean): void;
  broadcast(payload: UpdateInstallEvent): void;
  prepareToQuitAndInstall(): void;
  rollbackQuitAndInstall?(): void;
  quitAndInstall(): void;
  log?(message: string): void;
}

export async function handleDownloadedUpdateForInstall(
  deps: UpdateInstallDecisionDeps,
): Promise<void> {
  deps.clearWatchdog();
  deps.log?.(`[updater] awaiting install confirmation for v${deps.version ?? 'unknown'}`);
  let result = await deps.confirmInstallWhenIdle(deps.version);
  while (result.status === 'busy') {
    // The injected confirmInstallWhenIdle waits for the active exit dialog to
    // finish; busy is a defensive retry if another caller grabbed the lock.
    deps.log?.('[updater] install confirmation busy, waiting for active confirmation');
    result = await deps.confirmInstallWhenIdle(deps.version);
  }

  if (!deps.isStillInstalling()) {
    deps.log?.('[updater] install confirmation ignored; install is no longer active');
    return;
  }

  deps.cleanupInstallArtifacts();
  if (result.status === 'canceled') {
    deps.log?.('[updater] install postponed, update is available to retry');
    deps.setInstalling(false);
    deps.broadcast({ state: 'available', version: deps.version });
    return;
  }

  deps.log?.('[updater] install confirmed, restarting to install');
  deps.broadcast({ state: 'restarting', version: deps.version });
  deps.prepareToQuitAndInstall();
  try {
    deps.quitAndInstall();
  } catch (err) {
    deps.rollbackQuitAndInstall?.();
    throw err;
  }
}
