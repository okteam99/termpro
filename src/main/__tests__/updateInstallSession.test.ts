import { describe, expect, it } from 'vitest';
import {
  clearReadyToInstall,
  createUpdateInstallSession,
  markUpdateDownloaded,
  requestUpdateInstall,
  resetUpdateInstallSession,
  setUpdateInstalling,
} from '../updateInstallSession';

describe('update install session state', () => {
  it('reuses_a_staged_update_after_cancel_and_reclick_same_version', () => {
    const session = createUpdateInstallSession();

    expect(requestUpdateInstall(session, '0.4.0')).toEqual({
      action: 'download',
      version: '0.4.0',
    });
    expect(markUpdateDownloaded(session, '0.4.0')).toBe('0.4.0');
    setUpdateInstalling(session, false);

    expect(requestUpdateInstall(session, '0.4.0')).toEqual({
      action: 'reuse-staged',
      version: '0.4.0',
    });
  });

  it('downloads_again_when_a_newer_version_replaces_the_staged_version', () => {
    const session = createUpdateInstallSession();

    expect(requestUpdateInstall(session, '0.4.0')).toEqual({
      action: 'download',
      version: '0.4.0',
    });
    expect(markUpdateDownloaded(session, '0.4.0')).toBe('0.4.0');
    setUpdateInstalling(session, false);

    expect(requestUpdateInstall(session, '0.5.0')).toEqual({
      action: 'download',
      version: '0.5.0',
    });
    expect(session.installingVersion).toBe('0.5.0');
  });

  it('uses_the_installing_version_snapshot_when_latest_drifts', () => {
    const session = createUpdateInstallSession();

    expect(requestUpdateInstall(session, '0.4.0')).toEqual({
      action: 'download',
      version: '0.4.0',
    });

    expect(markUpdateDownloaded(session, '0.5.0')).toBe('0.4.0');
    expect(session.readyToInstallVersion).toBe('0.4.0');
  });

  it('can_clear_ready_state_or_reset_all_install_state', () => {
    const session = createUpdateInstallSession();

    expect(requestUpdateInstall(session, '0.4.0')).toEqual({
      action: 'download',
      version: '0.4.0',
    });
    markUpdateDownloaded(session, '0.4.0');

    clearReadyToInstall(session);
    expect(session.readyToInstallVersion).toBeNull();

    resetUpdateInstallSession(session);
    expect(session).toEqual({
      installing: false,
      installingVersion: null,
      readyToInstallVersion: null,
    });
  });
});
