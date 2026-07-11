import { describe, expect, it, vi } from 'vitest';
import {
  ExitLifecycleController,
  buildExitConfirmationOptions,
  createExitConfirmationCoordinator,
} from '../exitConfirmation';

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('exit confirmation dialog options', () => {
  it('confirmExit_close_window_cancel_and_confirm_copy', async () => {
    const close = buildExitConfirmationOptions({ kind: 'close-window' });
    expect(close.title).toBe('Close the main window?');
    expect(close.message).toContain('Tab content may be lost after closing and reopening');
    expect(close.buttons).toEqual(['Cancel', 'Close Window']);
    expect(close.defaultId).toBe(0);
    expect(close.cancelId).toBe(0);

    const quit = buildExitConfirmationOptions({ kind: 'app-quit' });
    expect(quit.title).toBe('Quit TermPro?');
    expect(quit.message).toContain('Tab content may be lost after quitting and reopening');
    expect(quit.buttons).toEqual(['Cancel', 'Quit']);

    const confirmExit = vi
      .fn()
      .mockResolvedValueOnce({ status: 'canceled' })
      .mockResolvedValueOnce({ status: 'confirmed' });
    const controller = new ExitLifecycleController(confirmExit, () => false);
    const win = { isDestroyed: () => false, close: vi.fn() };

    const cancelEvent = { preventDefault: vi.fn() };
    controller.handleWindowClose(cancelEvent, win);
    expect(cancelEvent.preventDefault).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(win.close).not.toHaveBeenCalled();

    const confirmEvent = { preventDefault: vi.fn() };
    controller.handleWindowClose(confirmEvent, win);
    expect(confirmEvent.preventDefault).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(win.close).toHaveBeenCalledTimes(1);

    const allowedEvent = { preventDefault: vi.fn() };
    controller.handleWindowClose(allowedEvent, win);
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('confirmExit_smoke_bypasses_dialog', async () => {
    const showMessageBox = vi.fn();
    const coordinator = createExitConfirmationCoordinator({
      showMessageBox,
      shouldBypass: () => true,
    });

    await expect(coordinator.confirm({ kind: 'close-window' })).resolves.toEqual({
      status: 'confirmed',
    });
    expect(showMessageBox).not.toHaveBeenCalled();
  });
});

describe('exit confirmation coordinator lock', () => {
  it('confirmExit_lock_prevents_stacked_dialogs_and_second_action', async () => {
    const firstDialog = deferred<{ response: number }>();
    const showMessageBox = vi.fn(() => firstDialog.promise);
    const coordinator = createExitConfirmationCoordinator({
      showMessageBox,
      shouldBypass: () => false,
    });

    const first = coordinator.confirm({ kind: 'close-window' });
    await expect(coordinator.confirm({ kind: 'app-quit' })).resolves.toEqual({
      status: 'busy',
    });
    expect(showMessageBox).toHaveBeenCalledTimes(1);

    firstDialog.resolve({ response: 1 });
    await expect(first).resolves.toEqual({ status: 'confirmed' });

    await coordinator.confirm({ kind: 'app-quit' });
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('confirmWhenIdle_can_cancel_after_waiting_before_showing_dialog', async () => {
    const firstDialog = deferred<{ response: number }>();
    const showMessageBox = vi.fn(() => firstDialog.promise);
    const coordinator = createExitConfirmationCoordinator({
      showMessageBox,
      shouldBypass: () => false,
    });

    const first = coordinator.confirm({ kind: 'app-quit' });
    let quitting = false;
    const second = coordinator.confirmWhenIdle(
      { kind: 'install-update', version: '0.4.0' },
      undefined,
      () => quitting,
    );

    expect(showMessageBox).toHaveBeenCalledTimes(1);
    quitting = true;
    firstDialog.resolve({ response: 1 });

    await expect(first).resolves.toEqual({ status: 'confirmed' });
    await expect(second).resolves.toEqual({ status: 'canceled' });
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });
});

describe('exit lifecycle controller', () => {
  it('exitLifecycle_app_quit_cancel_and_confirm_flow', async () => {
    const confirmExit = vi
      .fn()
      .mockResolvedValueOnce({ status: 'canceled' })
      .mockResolvedValueOnce({ status: 'confirmed' });
    const controller = new ExitLifecycleController(confirmExit, () => false);
    const app = { quit: vi.fn() };

    controller.requestAppQuit(app, undefined);
    await flushMicrotasks();
    expect(app.quit).not.toHaveBeenCalled();

    controller.requestAppQuit(app, undefined);
    await flushMicrotasks();
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('exitLifecycle_quit_confirm_allows_window_close_without_second_prompt', async () => {
    const confirmExit = vi.fn().mockResolvedValue({ status: 'confirmed' });
    const controller = new ExitLifecycleController(confirmExit, () => false);
    const app = { quit: vi.fn() };
    const win = { isDestroyed: () => false, close: vi.fn() };

    controller.requestAppQuit(app, win);
    await flushMicrotasks();

    const closeEvent = { preventDefault: vi.fn() };
    controller.handleWindowClose(closeEvent, win);

    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(confirmExit).toHaveBeenCalledTimes(1);
  });

  it('exitLifecycle_window_all_closed_quit_bypasses_second_app_quit_confirm', () => {
    const confirmExit = vi.fn();
    const controller = new ExitLifecycleController(confirmExit, () => false);

    controller.markQuitting();
    controller.handleAppBeforeQuit();

    expect(controller.isQuitting()).toBe(true);
    expect(confirmExit).not.toHaveBeenCalled();
  });

  it('exitLifecycle_before_quit_marks_quitting_without_prompt', () => {
    const confirmExit = vi.fn();
    const controller = new ExitLifecycleController(confirmExit, () => false);

    controller.handleAppBeforeQuit();

    expect(controller.isQuitting()).toBe(true);
    expect(confirmExit).not.toHaveBeenCalled();
  });

  it('exitLifecycle_mark_quitting_bypasses_app_quit_confirmation', () => {
    const confirmExit = vi.fn();
    const controller = new ExitLifecycleController(confirmExit, () => false);
    const app = { quit: vi.fn() };

    controller.markQuitting();
    controller.requestAppQuit(app, undefined);

    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(confirmExit).not.toHaveBeenCalled();
  });

  it('exitLifecycle_logs_dialog_rejection_without_closing_or_quitting', async () => {
    const confirmExit = vi.fn().mockRejectedValue(new Error('dialog failed'));
    const log = vi.fn();
    const controller = new ExitLifecycleController(confirmExit, () => false, log);
    const app = { quit: vi.fn() };
    const win = { isDestroyed: () => false, close: vi.fn() };

    controller.requestAppQuit(app, undefined);
    controller.handleWindowClose({ preventDefault: vi.fn() }, win);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(app.quit).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('app-quit dialog failed'),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('close-window dialog failed'),
    );
  });
});
