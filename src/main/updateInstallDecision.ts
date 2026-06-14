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
  setInstalling(value: boolean): void;
  broadcast(payload: UpdateInstallEvent): void;
  prepareToQuitAndInstall(): void;
  quitAndInstall(): void;
  log?(message: string): void;
}

export async function handleDownloadedUpdateForInstall(
  deps: UpdateInstallDecisionDeps,
): Promise<void> {
  deps.clearWatchdog();
  let result = await deps.confirmInstallWhenIdle(deps.version);
  while (result.status === 'busy') {
    result = await deps.confirmInstallWhenIdle(deps.version);
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
  deps.quitAndInstall();
}
