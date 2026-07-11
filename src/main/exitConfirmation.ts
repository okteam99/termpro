import { t } from '../shared/i18n';

export type ExitConfirmationKind = 'close-window' | 'app-quit' | 'install-update';

export interface ExitConfirmationRequest {
  kind: ExitConfirmationKind;
  version?: string;
}

export interface ExitConfirmationOptions {
  type: 'warning';
  title: string;
  message: string;
  buttons: [string, string];
  defaultId: 0;
  cancelId: 0;
  noLink: true;
}

export interface ExitConfirmationResult {
  status: 'confirmed' | 'canceled' | 'busy';
}

export type ShowMessageBox = (
  parent: unknown | undefined,
  options: ExitConfirmationOptions,
) => Promise<{ response: number }>;

export interface WindowLike {
  isDestroyed(): boolean;
  close(): void;
}

export interface AppLike {
  quit(): void;
}

export interface PreventableEvent {
  preventDefault(): void;
}

const CONFIRM_BUTTON_INDEX = 1;

export function shouldBypassExitConfirmation(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.TERMPRO_SMOKE === '1';
}

export function buildExitConfirmationOptions(
  request: ExitConfirmationRequest,
): ExitConfirmationOptions {
  if (request.kind === 'close-window') {
    return {
      type: 'warning',
      title: t('Close the main window?'),
      message: t(
        'Tab content may be lost after closing and reopening. Cancel to keep Workspace, Tab, and Terminal views available.',
      ),
      buttons: [t('Cancel'), t('Close Window')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
  }
  if (request.kind === 'app-quit') {
    return {
      type: 'warning',
      title: t('Quit TermPro?'),
      message: t(
        'Tab content may be lost after quitting and reopening. State still gets a chance to persist before exit.',
      ),
      buttons: [t('Cancel'), t('Quit')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
  }
  return {
    type: 'warning',
    title: request.version
      ? t('Install v{version} and restart?', { version: request.version })
      : t('Install the update and restart?'),
    message: t(
      'The update has been downloaded. After confirming, TermPro restarts and hands off to Squirrel.Mac to finish installing.',
    ),
    buttons: [t('Later'), t('Install and Restart')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

export function createExitConfirmationCoordinator(opts: {
  showMessageBox: ShowMessageBox;
  shouldBypass?: () => boolean;
}) {
  let active: Promise<ExitConfirmationResult> | null = null;
  const idleWaiters = new Set<() => void>();
  const shouldBypass = opts.shouldBypass ?? shouldBypassExitConfirmation;

  const notifyIdle = () => {
    const waiters = Array.from(idleWaiters);
    idleWaiters.clear();
    for (const resolve of waiters) resolve();
  };

  const waitUntilIdle = async (): Promise<void> => {
    while (active) {
      await new Promise<void>((resolve) => {
        idleWaiters.add(resolve);
      });
    }
  };

  const runDialog = (
    request: ExitConfirmationRequest,
    parent?: unknown,
  ): Promise<ExitConfirmationResult> => {
    if (shouldBypass()) return Promise.resolve({ status: 'confirmed' });
    if (active) return Promise.resolve({ status: 'busy' });
    active = opts
      .showMessageBox(parent, buildExitConfirmationOptions(request))
      .then((res) => ({
        status:
          res.response === CONFIRM_BUTTON_INDEX ? 'confirmed' : 'canceled',
      }))
      .finally(() => {
        active = null;
        notifyIdle();
      }) as Promise<ExitConfirmationResult>;
    return active;
  };

  return {
    confirm(request: ExitConfirmationRequest, parent?: unknown) {
      return runDialog(request, parent);
    },
    async confirmWhenIdle(
      request: ExitConfirmationRequest,
      parent?: unknown,
      shouldCancel?: () => boolean,
    ) {
      await waitUntilIdle();
      if (shouldCancel?.()) return { status: 'canceled' } as const;
      return runDialog(request, parent);
    },
  };
}

export class ExitLifecycleController {
  private readonly allowedWindowCloses = new WeakSet<WindowLike>();
  private isQuittingConfirmed = false;

  constructor(
    private readonly confirmExit: (
      request: ExitConfirmationRequest,
      parent?: unknown,
    ) => Promise<ExitConfirmationResult>,
    private readonly shouldBypass: () => boolean,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  markQuitting(): void {
    this.isQuittingConfirmed = true;
  }

  isQuitting(): boolean {
    return this.isQuittingConfirmed;
  }

  resetQuitting(): void {
    this.isQuittingConfirmed = false;
  }

  requestAppQuit(app: AppLike, parent?: unknown): void {
    if (this.shouldBypass() || this.isQuittingConfirmed) {
      this.markQuitting();
      app.quit();
      return;
    }

    void this.confirmExit({ kind: 'app-quit' }, parent).then((result) => {
      if (result.status !== 'confirmed') {
        this.log(`[exit] app-quit ${result.status}`);
        return;
      }
      this.markQuitting();
      app.quit();
    }).catch((err: unknown) => {
      this.log(`[exit] app-quit dialog failed: ${String(err)}`);
    });
  }

  handleWindowClose(event: PreventableEvent, win: WindowLike): void {
    if (this.shouldBypass() || this.isQuittingConfirmed) return;
    if (this.allowedWindowCloses.has(win)) {
      this.allowedWindowCloses.delete(win);
      return;
    }

    event.preventDefault();
    void this.confirmExit({ kind: 'close-window' }, win).then((result) => {
      if (result.status !== 'confirmed') {
        this.log(`[exit] close-window ${result.status}`);
        return;
      }
      if (win.isDestroyed()) return;
      this.allowedWindowCloses.add(win);
      win.close();
    }).catch((err: unknown) => {
      this.log(`[exit] close-window dialog failed: ${String(err)}`);
    });
  }

  handleAppBeforeQuit(): void {
    this.markQuitting();
  }
}
