export interface UpdateInstallSession {
  installing: boolean;
  installingVersion: string | null;
  readyToInstallVersion: string | null;
}

export type UpdateInstallRequestDecision =
  | { action: 'ignore' }
  | { action: 'download'; version: string }
  | { action: 'reuse-staged'; version: string };

export function createUpdateInstallSession(): UpdateInstallSession {
  return {
    installing: false,
    installingVersion: null,
    readyToInstallVersion: null,
  };
}

export function requestUpdateInstall(
  session: UpdateInstallSession,
  latestVersion?: string,
): UpdateInstallRequestDecision {
  if (!latestVersion || session.installing) return { action: 'ignore' };

  session.installing = true;
  session.installingVersion = latestVersion;

  if (session.readyToInstallVersion === latestVersion) {
    return { action: 'reuse-staged', version: latestVersion };
  }
  return { action: 'download', version: latestVersion };
}

export function markUpdateDownloaded(
  session: UpdateInstallSession,
  fallbackVersion?: string,
): string | undefined {
  const version = session.installingVersion ?? fallbackVersion;
  session.readyToInstallVersion = version ?? null;
  return version;
}

export function setUpdateInstalling(
  session: UpdateInstallSession,
  value: boolean,
): void {
  session.installing = value;
  if (!value) session.installingVersion = null;
}

export function clearReadyToInstall(session: UpdateInstallSession): void {
  session.readyToInstallVersion = null;
}

export function resetUpdateInstallSession(session: UpdateInstallSession): void {
  session.installing = false;
  session.installingVersion = null;
  session.readyToInstallVersion = null;
}
