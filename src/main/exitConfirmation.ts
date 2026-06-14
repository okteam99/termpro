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
      title: '关闭主窗口？',
      message:
        '关闭后再打开，Tab 内容可能丢失。取消后 Workspace、Tab 和 Terminal 视图保持可用。',
      buttons: ['取消', '关闭窗口'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
  }
  if (request.kind === 'app-quit') {
    return {
      type: 'warning',
      title: '退出 TermPro？',
      message:
        '退出后再打开，Tab 内容可能丢失。确认退出前会保留原有状态落盘机会。',
      buttons: ['取消', '退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
  }
  return {
    type: 'warning',
    title: request.version
      ? `安装 v${request.version} 并重启？`
      : '安装更新并重启？',
    message: '升级包已下载完成。确认后 TermPro 会重启并交给 Squirrel.Mac 完成安装。',
    buttons: ['稍后', '安装并重启'],
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
    });
  }

  handleAppBeforeQuit(): void {
    this.markQuitting();
  }
}
