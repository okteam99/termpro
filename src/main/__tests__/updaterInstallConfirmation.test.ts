import { describe, expect, it, vi } from 'vitest';
import { handleDownloadedUpdateForInstall } from '../updateInstallDecision';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setupDeps() {
  return {
    version: '0.4.0',
    confirmInstallWhenIdle: vi.fn(),
    clearWatchdog: vi.fn(),
    cleanupInstallArtifacts: vi.fn(),
    isStillInstalling: vi.fn(() => true),
    setInstalling: vi.fn(),
    broadcast: vi.fn(),
    prepareToQuitAndInstall: vi.fn(),
    quitAndInstall: vi.fn(),
    log: vi.fn(),
  };
}

describe('update install confirmation decision', () => {
  it('updater_downloaded_update_cancel_does_not_quit_or_restart', async () => {
    const deps = setupDeps();
    deps.confirmInstallWhenIdle.mockResolvedValue({ status: 'canceled' });

    await handleDownloadedUpdateForInstall(deps);

    expect(deps.clearWatchdog).toHaveBeenCalledTimes(1);
    expect(deps.cleanupInstallArtifacts).toHaveBeenCalledTimes(1);
    expect(deps.setInstalling).toHaveBeenCalledWith(false);
    expect(deps.broadcast).toHaveBeenCalledWith({
      state: 'available',
      version: '0.4.0',
    });
    expect(deps.broadcast).not.toHaveBeenCalledWith({
      state: 'restarting',
      version: '0.4.0',
    });
    expect(deps.quitAndInstall).not.toHaveBeenCalled();
  });

  it('updater_downloaded_update_confirm_broadcasts_restarting_and_bypasses_quit_dialog', async () => {
    const deps = setupDeps();
    deps.confirmInstallWhenIdle.mockResolvedValue({ status: 'confirmed' });

    await handleDownloadedUpdateForInstall(deps);

    expect(deps.clearWatchdog).toHaveBeenCalledTimes(1);
    expect(deps.cleanupInstallArtifacts).toHaveBeenCalledTimes(1);
    expect(deps.broadcast).toHaveBeenCalledWith({
      state: 'restarting',
      version: '0.4.0',
    });
    expect(deps.prepareToQuitAndInstall).toHaveBeenCalledTimes(1);
    expect(deps.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(deps.setInstalling).not.toHaveBeenCalledWith(false);
  });

  it('updater_install_confirm_waits_when_another_confirmation_is_active', async () => {
    const deps = setupDeps();
    const confirmation = deferred<{ status: 'canceled' }>();
    deps.confirmInstallWhenIdle.mockReturnValue(confirmation.promise);

    const pending = handleDownloadedUpdateForInstall(deps);

    expect(deps.clearWatchdog).toHaveBeenCalledTimes(1);
    expect(deps.cleanupInstallArtifacts).not.toHaveBeenCalled();
    expect(deps.setInstalling).not.toHaveBeenCalled();
    expect(deps.broadcast).not.toHaveBeenCalled();
    expect(deps.quitAndInstall).not.toHaveBeenCalled();

    confirmation.resolve({ status: 'canceled' });
    await pending;

    expect(deps.cleanupInstallArtifacts).toHaveBeenCalledTimes(1);
    expect(deps.setInstalling).toHaveBeenCalledWith(false);
    expect(deps.broadcast).toHaveBeenCalledWith({
      state: 'available',
      version: '0.4.0',
    });
  });

  it('retries a busy install confirmation result before deciding', async () => {
    const deps = setupDeps();
    deps.confirmInstallWhenIdle
      .mockResolvedValueOnce({ status: 'busy' })
      .mockResolvedValueOnce({ status: 'canceled' });

    await handleDownloadedUpdateForInstall(deps);

    expect(deps.confirmInstallWhenIdle).toHaveBeenCalledTimes(2);
    expect(deps.cleanupInstallArtifacts).toHaveBeenCalledTimes(1);
    expect(deps.setInstalling).toHaveBeenCalledWith(false);
    expect(deps.broadcast).toHaveBeenCalledWith({
      state: 'available',
      version: '0.4.0',
    });
    expect(deps.quitAndInstall).not.toHaveBeenCalled();
  });

  it('updater_confirmed_install_is_ignored_if_installing_was_cleared', async () => {
    const deps = setupDeps();
    deps.confirmInstallWhenIdle.mockResolvedValue({ status: 'confirmed' });
    deps.isStillInstalling.mockReturnValue(false);

    await handleDownloadedUpdateForInstall(deps);

    expect(deps.clearWatchdog).toHaveBeenCalledTimes(1);
    expect(deps.cleanupInstallArtifacts).not.toHaveBeenCalled();
    expect(deps.broadcast).not.toHaveBeenCalledWith({
      state: 'restarting',
      version: '0.4.0',
    });
    expect(deps.prepareToQuitAndInstall).not.toHaveBeenCalled();
    expect(deps.quitAndInstall).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      '[updater] install confirmation ignored; install is no longer active',
    );
  });
});
