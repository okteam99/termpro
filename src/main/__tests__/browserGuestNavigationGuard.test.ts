import { describe, expect, it, vi } from 'vitest';
import { createBrowserGuestNavigationGuard } from '../browserGuestNavigationGuard';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function navigationEvent() {
  return { preventDefault: vi.fn() };
}

describe('browser guest navigation continuity guard', () => {
  it('blocks an unhydrated Remote generation, coalesces duplicate events, then replays once', async () => {
    const preparation = deferred<{
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }>();
    const hydrated = new Set(['g1']);
    const replay = vi.fn(async () => undefined);
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({
        kind: 'remote',
        hostId: 'host-a',
        generation: 'g2',
      }),
      isHydrated: (generation) => hydrated.has(generation),
      prepare: () => preparation.promise,
      replay,
      isDestroyed: () => false,
      broadcastSummary: vi.fn(),
    });
    const anchorEvent = navigationEvent();
    const duplicateEvent = navigationEvent();

    guard.handle(anchorEvent, 'https://example.test/next');
    guard.handle(duplicateEvent, 'https://example.test/next');

    expect(anchorEvent.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateEvent.preventDefault).toHaveBeenCalledOnce();
    expect(replay).not.toHaveBeenCalled();

    hydrated.add('g2');
    preparation.resolve({ ready: true, syncedCount: 1, skippedCount: 0 });
    await preparation.promise;
    await vi.waitFor(() => expect(replay).toHaveBeenCalledOnce());
    expect(replay).toHaveBeenCalledWith('https://example.test/next');
  });

  it('keeps an offline Remote navigation blocked and refreshes only the redacted summary', async () => {
    const replay = vi.fn();
    const prepare = vi.fn(async () => ({
      ready: false as const,
      reason: 'PROFILE_CONTINUITY_OFFLINE' as const,
      canRetry: true,
    }));
    const broadcastSummary = vi.fn();
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({
        kind: 'remote',
        hostId: 'host-a',
        generation: null,
      }),
      isHydrated: () => false,
      prepare,
      replay,
      isDestroyed: () => false,
      broadcastSummary,
    });
    const event = navigationEvent();

    guard.handle(event, 'https://example.test/offline');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(broadcastSummary).toHaveBeenCalledOnce());
    expect(prepare).toHaveBeenCalledOnce();
    expect(replay).not.toHaveBeenCalled();
  });

  it('does not replay an old result after the Remote provider generation changes', async () => {
    const preparation = deferred<{
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }>();
    let generation = 'g2';
    const hydrated = new Set<string>();
    const replay = vi.fn();
    const broadcastSummary = vi.fn();
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({
        kind: 'remote',
        hostId: 'host-a',
        generation,
      }),
      isHydrated: (candidate) => hydrated.has(candidate),
      prepare: () => preparation.promise,
      replay,
      isDestroyed: () => false,
      broadcastSummary,
    });
    const event = navigationEvent();

    guard.handle(event, 'https://example.test/stale');
    generation = 'g3';
    hydrated.add('g2');
    hydrated.add('g3');
    preparation.resolve({ ready: true, syncedCount: 1, skippedCount: 0 });

    await vi.waitFor(() => expect(broadcastSummary).toHaveBeenCalledOnce());
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(replay).not.toHaveBeenCalled();
  });

  it('does not replay an old result after Remote authority moves to another Host', async () => {
    const preparation = deferred<{
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }>();
    let hostId = 'host-a';
    const replay = vi.fn();
    const broadcastSummary = vi.fn();
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({
        kind: 'remote',
        hostId,
        generation: 'same-generation-label',
      }),
      isHydrated: () => hostId === 'host-b',
      prepare: () => preparation.promise,
      replay,
      isDestroyed: () => false,
      broadcastSummary,
    });

    guard.handle(navigationEvent(), 'https://example.test/moved');
    hostId = 'host-b';
    preparation.resolve({ ready: true, syncedCount: 1, skippedCount: 0 });

    await vi.waitFor(() => expect(broadcastSummary).toHaveBeenCalledOnce());
    expect(replay).not.toHaveBeenCalled();
  });

  it('replays only the newest blocked URL when an older preparation finishes later', async () => {
    const firstPreparation = deferred<{
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }>();
    const secondPreparation = deferred<{
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }>();
    const hydrated = new Set<string>();
    const replay = vi.fn();
    const prepare = vi
      .fn()
      .mockReturnValueOnce(firstPreparation.promise)
      .mockReturnValueOnce(secondPreparation.promise);
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({
        kind: 'remote',
        hostId: 'host-a',
        generation: 'g2',
      }),
      isHydrated: (generation) => hydrated.has(generation),
      prepare,
      replay,
      isDestroyed: () => false,
      broadcastSummary: vi.fn(),
    });

    guard.handle(navigationEvent(), 'https://example.test/old');
    guard.handle(navigationEvent(), 'https://example.test/new');
    hydrated.add('g2');
    firstPreparation.resolve({ ready: true, syncedCount: 1, skippedCount: 0 });
    await firstPreparation.promise;
    await Promise.resolve();
    expect(replay).not.toHaveBeenCalled();

    secondPreparation.resolve({ ready: true, syncedCount: 1, skippedCount: 0 });
    await vi.waitFor(() => expect(replay).toHaveBeenCalledOnce());
    expect(replay).toHaveBeenCalledWith('https://example.test/new');
  });

  it('cancels an old blocked replay when a newer navigation is already allowed', async () => {
    const preparation = deferred<{
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }>();
    let hydrated = false;
    const replay = vi.fn();
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({
        kind: 'remote',
        hostId: 'host-a',
        generation: 'g2',
      }),
      isHydrated: () => hydrated,
      prepare: () => preparation.promise,
      replay,
      isDestroyed: () => false,
      broadcastSummary: vi.fn(),
    });
    const newerEvent = navigationEvent();

    guard.handle(navigationEvent(), 'https://example.test/old');
    hydrated = true;
    guard.handle(newerEvent, 'https://example.test/new');
    preparation.resolve({ ready: true, syncedCount: 1, skippedCount: 0 });
    await preparation.promise;
    await Promise.resolve();

    expect(newerEvent.preventDefault).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it('resolves authority again for an existing guest after Local to Remote migration', async () => {
    let authority = { kind: 'local' } as
      | { kind: 'local' }
      | { kind: 'remote'; hostId: string; generation: string | null };
    let hydrated = false;
    const replay = vi.fn();
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => authority,
      isHydrated: () => hydrated,
      prepare: async () => {
        hydrated = true;
        return { ready: true, syncedCount: 1, skippedCount: 0 };
      },
      replay,
      isDestroyed: () => false,
      broadcastSummary: vi.fn(),
    });
    const localEvent = navigationEvent();
    const remoteEvent = navigationEvent();

    guard.handle(localEvent, 'https://example.test/local');
    authority = { kind: 'remote', hostId: 'host-b', generation: 'g8' };
    guard.handle(remoteEvent, 'https://example.test/remote');

    expect(localEvent.preventDefault).not.toHaveBeenCalled();
    expect(remoteEvent.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(replay).toHaveBeenCalledOnce());
  });

  it('uses the same fail-closed recovery path for a cancellable redirect', async () => {
    let hydrated = false;
    const replay = vi.fn();
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({
        kind: 'remote',
        hostId: 'host-a',
        generation: 'g2',
      }),
      isHydrated: () => hydrated,
      prepare: async () => {
        hydrated = true;
        return { ready: true, syncedCount: 1, skippedCount: 0 };
      },
      replay,
      isDestroyed: () => false,
      broadcastSummary: vi.fn(),
    });
    const redirectEvent = navigationEvent();

    guard.handle(redirectEvent, 'https://example.test/redirect-target');

    expect(redirectEvent.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(replay).toHaveBeenCalledOnce());
    expect(replay).toHaveBeenCalledWith(
      'https://example.test/redirect-target',
    );
  });

  it('does not replay after the guest is destroyed during preparation', async () => {
    const preparation = deferred<{
      ready: true;
      syncedCount: number;
      skippedCount: number;
    }>();
    let destroyed = false;
    let hydrated = false;
    const replay = vi.fn();
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({
        kind: 'remote',
        hostId: 'host-a',
        generation: 'g2',
      }),
      isHydrated: () => hydrated,
      prepare: () => preparation.promise,
      replay,
      isDestroyed: () => destroyed,
      broadcastSummary: vi.fn(),
    });

    guard.handle(navigationEvent(), 'https://example.test/gone');
    destroyed = true;
    hydrated = true;
    preparation.resolve({ ready: true, syncedCount: 1, skippedCount: 0 });
    await preparation.promise;
    await Promise.resolve();

    expect(replay).not.toHaveBeenCalled();
  });

  it('leaves Local http navigation unchanged while blocking disallowed schemes', () => {
    const prepare = vi.fn();
    const guard = createBrowserGuestNavigationGuard({
      resolveAuthority: () => ({ kind: 'local' }),
      isHydrated: () => false,
      prepare,
      replay: vi.fn(),
      isDestroyed: () => false,
      broadcastSummary: vi.fn(),
    });
    const httpEvent = navigationEvent();
    const customSchemeEvent = navigationEvent();

    guard.handle(httpEvent, 'https://example.test/local');
    guard.handle(customSchemeEvent, 'file:///etc/passwd');

    expect(httpEvent.preventDefault).not.toHaveBeenCalled();
    expect(customSchemeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });
});
