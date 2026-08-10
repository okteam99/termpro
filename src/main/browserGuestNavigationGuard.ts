import type { BrowserContinuityPrepareResult } from '../shared/browserProfile';

export type BrowserGuestNavigationAuthority =
  | { kind: 'local' }
  | { kind: 'remote'; hostId: string; generation: string | null }
  | { kind: 'blocked' };

export interface BrowserGuestNavigationEvent {
  preventDefault(): void;
}

export interface BrowserGuestNavigationGuardDeps {
  resolveAuthority(): BrowserGuestNavigationAuthority;
  isHydrated(generation: string): boolean;
  prepare(): Promise<BrowserContinuityPrepareResult>;
  replay(url: string): Promise<unknown> | unknown;
  isDestroyed(): boolean;
  broadcastSummary(): Promise<unknown> | unknown;
}

interface PendingNavigation {
  token: number;
  url: string;
  authority: BrowserGuestNavigationAuthority | null;
}

function isAllowedNavigationUrl(url: string): boolean {
  return /^(https?:|about:)/i.test(url);
}

function sameAuthority(
  left: BrowserGuestNavigationAuthority | null,
  right: BrowserGuestNavigationAuthority | null,
): boolean {
  if (left?.kind !== right?.kind) return false;
  if (left?.kind !== 'remote' || right?.kind !== 'remote') return true;
  return (
    left.hostId === right.hostId && left.generation === right.generation
  );
}

/**
 * Synchronous main-frame navigation gate for an already attached browser guest.
 * The asynchronous preparation path owns only an opaque in-memory URL token;
 * callers must not log or broadcast it.
 */
export function createBrowserGuestNavigationGuard(
  deps: BrowserGuestNavigationGuardDeps,
): {
  handle(event: BrowserGuestNavigationEvent, url: string): void;
  dispose(): void;
} {
  let latestToken = 0;
  let pending: PendingNavigation | null = null;
  let disposed = false;

  const cancelPending = (): void => {
    if (!pending) return;
    pending = null;
    latestToken += 1;
  };

  const broadcastSummary = (): void => {
    try {
      void Promise.resolve(deps.broadcastSummary()).catch(() => undefined);
    } catch {
      // Summary refresh is best-effort and must not weaken the navigation gate.
    }
  };

  const resolveAuthority = (): BrowserGuestNavigationAuthority | null => {
    try {
      return deps.resolveAuthority();
    } catch {
      return null;
    }
  };

  const isHydrated = (generation: string): boolean => {
    try {
      return deps.isHydrated(generation);
    } catch {
      return false;
    }
  };

  const recover = async (attempt: PendingNavigation): Promise<void> => {
    let result: BrowserContinuityPrepareResult;
    try {
      result = await deps.prepare();
    } catch {
      if (attempt.token === latestToken) {
        pending = null;
        broadcastSummary();
      }
      return;
    }
    if (disposed || attempt.token !== latestToken) return;
    pending = null;
    if (!result.ready || deps.isDestroyed()) {
      if (!result.ready) broadcastSummary();
      return;
    }

    const current = resolveAuthority();
    if (
      attempt.authority?.kind !== 'remote' ||
      !attempt.authority.generation ||
      current?.kind !== 'remote' ||
      current.hostId !== attempt.authority.hostId ||
      current.generation !== attempt.authority.generation ||
      !isHydrated(current.generation)
    ) {
      broadcastSummary();
      return;
    }

    try {
      await deps.replay(attempt.url);
    } catch {
      broadcastSummary();
    }
  };

  return {
    handle(event, url) {
      if (!isAllowedNavigationUrl(url)) {
        event.preventDefault();
        cancelPending();
        return;
      }

      const authority = resolveAuthority();
      if (authority?.kind === 'local') {
        cancelPending();
        return;
      }
      if (
        authority?.kind === 'remote' &&
        authority.generation &&
        isHydrated(authority.generation)
      ) {
        cancelPending();
        return;
      }

      event.preventDefault();
      if (
        pending?.url === url &&
        sameAuthority(pending.authority, authority)
      ) {
        return;
      }
      const attempt: PendingNavigation = {
        token: ++latestToken,
        url,
        authority,
      };
      pending = attempt;
      void recover(attempt);
    },
    dispose() {
      disposed = true;
      cancelPending();
      latestToken += 1;
    },
  };
}
