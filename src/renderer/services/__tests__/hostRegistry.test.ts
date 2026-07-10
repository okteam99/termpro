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

// BL-004 路由原语:forWorkspace(读·兜底 local+WARN) / forHostId(写·未命中 null 不兜底)
describe('hostRegistry_forWorkspace', () => {
  it('BL004-U-hr-local: hostId=local returns the shared hostClient singleton (AC-7)', () => {
    const registry = new HostRegistry();
    expect(registry.forWorkspace({ hostId: 'local' })).toBe(hostClient);
  });

  it('BL004-U-hr-remote: hostId=configId returns that remote client, not the local singleton (AC-5/AC-7)', () => {
    const registry = new HostRegistry();
    const remote = registry.getOrCreateRemote('cfg-1', 'ws://x');
    const result = registry.forWorkspace({ hostId: 'cfg-1' });
    expect(result).toBe(remote);
    expect(result).not.toBe(hostClient);
  });

  it('BL004-U-hr-nomisroute: unknown non-local hostId falls back to local singleton + WARN, never silent (AC-5)', () => {
    const registry = new HostRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = registry.forWorkspace({ hostId: 'cfg-ghost' });
      expect(result).toBe(hostClient);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('cfg-ghost');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('BL004-U-hr-key-authority: routing authority = registry map key, host.info.hostId does not participate (AC-7)', () => {
    const registry = new HostRegistry();
    // 制造双源诱因:local 单例的 info.hostId 被设成别的值
    const prevInfo = hostClient.info;
    (hostClient as unknown as { info: { hostId: string } | null }).info = {
      hostId: 'cfg-9',
    } as never;
    try {
      // hostId='local' 仍按 map 键 'local' 解析到本地单例(host.info.hostId 不参与 · 消除双源)
      expect(registry.forWorkspace({ hostId: 'local' })).toBe(hostClient);
    } finally {
      (hostClient as unknown as { info: unknown }).info = prevInfo;
    }
  });
});

describe('hostRegistry_forHostId', () => {
  it("resolves 'local' and a known configId to their clients", () => {
    const registry = new HostRegistry();
    expect(registry.forHostId('local')).toBe(hostClient);
    const remote = registry.getOrCreateRemote('cfg-1', 'ws://x');
    expect(registry.forHostId('cfg-1')).toBe(remote);
  });

  it('BL004-U-create-nohost-reject helper: unknown hostId returns null, never falls back to local (write path)', () => {
    const registry = new HostRegistry();
    expect(registry.forHostId('cfg-ghost')).toBeNull();
  });

  it('a dropped host resolves to null via forHostId (no silent local fallback for writes)', () => {
    const registry = new HostRegistry();
    registry.getOrCreateRemote('cfg-1', 'ws://x');
    registry.drop('cfg-1');
    expect(registry.forHostId('cfg-1')).toBeNull();
  });
});
