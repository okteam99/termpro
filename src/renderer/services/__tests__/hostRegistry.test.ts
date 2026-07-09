// @vitest-environment jsdom
// SSH-6 per-host HostClient 结构:'local' 复用既有单例(本地路径零变化) + 远程键按需建。
import { describe, expect, it, vi } from 'vitest';
import { HostRegistry } from '../hostRegistry';
import { HostClient, hostClient } from '../hostClient';

describe('hostRegistry_local_reuses_singleton', () => {
  it('local() returns the shared hostClient instance', () => {
    const registry = new HostRegistry();
    expect(registry.local()).toBe(hostClient);
  });
});

describe('hostRegistry_get_or_create_remote', () => {
  it('creates a HostClient (not the local singleton) keyed by configId and reuses it on repeat calls', () => {
    const registry = new HostRegistry();
    const a = registry.getOrCreateRemote('cfg-1', 'ws://127.0.0.1:1234?token=t');
    const b = registry.getOrCreateRemote('cfg-1', 'ws://127.0.0.1:1234?token=t');
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(HostClient);
    expect(a).not.toBe(hostClient);
  });

  it('creates independent clients for different configIds', () => {
    const registry = new HostRegistry();
    const a = registry.getOrCreateRemote('cfg-1', 'ws://x');
    const b = registry.getOrCreateRemote('cfg-2', 'ws://y');
    expect(a).not.toBe(b);
  });

  it('does not auto-connect on creation (caller triggers handshake explicitly)', () => {
    const registry = new HostRegistry();
    const client = registry.getOrCreateRemote('cfg-1', 'ws://127.0.0.1:1234?token=t');
    expect(client.info).toBeNull();
  });
});

describe('hostRegistry_drop', () => {
  it('disposes and removes the client; a later getOrCreateRemote creates a fresh instance', () => {
    const registry = new HostRegistry();
    const a = registry.getOrCreateRemote('cfg-1', 'ws://x');
    const disposeSpy = vi.spyOn(a, 'dispose');

    registry.drop('cfg-1');

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    const b = registry.getOrCreateRemote('cfg-1', 'ws://x');
    expect(b).not.toBe(a);
  });

  it('dropping an id that was never created is a no-op (no throw)', () => {
    const registry = new HostRegistry();
    expect(() => registry.drop('never-existed')).not.toThrow();
  });
});
