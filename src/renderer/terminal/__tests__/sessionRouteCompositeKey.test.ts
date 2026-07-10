// @vitest-environment jsdom
// BL-004:会话反查从旧的单键 findTabBySessionId(sessionId) 改成 (hostId, sessionId) 复合键
// findTab——sessionId 仅 per-host 唯一(各机 ptyPool 本地计数器),本机 + 远程可能撞同名 id
// (ARCH-9)。同时验证 ensureSession(tabId, cwd, hostId) 在 spawn 时正确绑定
// `inst.client = hostRegistry.forWorkspace({hostId})`,PTY 全链路(spawn/kill/attachPty/
// input/resize/ack)走该绑定的 client,而非裸单例(A1-A9 迁移清单)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hostRegistryMock } = vi.hoisted(() => ({
  hostRegistryMock: {
    local: vi.fn(),
    forWorkspace: vi.fn(),
  },
}));
vi.mock('../../services/hostRegistry', () => ({ hostRegistry: hostRegistryMock }));

import { disposeTerminal, ensureSession, findTab } from '../terminalRegistry';

function makeFakeClient(sessionId: string) {
  return {
    info: { homedir: '/home/u' },
    rpc: vi.fn(async (method: string) => {
      if (method === 'pty.spawn') return { sessionId };
      return {};
    }),
    attachPty: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    ack: vi.fn(),
  };
}

const createdTabs: string[] = [];

beforeEach(() => {
  hostRegistryMock.local.mockReset();
  hostRegistryMock.forWorkspace.mockReset();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    termpro: { openPath: vi.fn(), openViewerWindow: vi.fn() },
  });
});

afterEach(() => {
  while (createdTabs.length > 0) disposeTerminal(createdTabs.pop()!);
  vi.unstubAllGlobals();
});

describe('findTab (hostId, sessionId) 复合键', () => {
  it('本机 tab 与远程 tab 各自按 (hostId, sessionId) 精确命中', async () => {
    const localClient = makeFakeClient('s1');
    const remoteClient = makeFakeClient('s1'); // 撞同名 sessionId,不同 host
    hostRegistryMock.forWorkspace.mockImplementation(
      ({ hostId }: { hostId: string }) => (hostId === 'local' ? localClient : remoteClient),
    );

    createdTabs.push('tabLocal', 'tabRemote');
    await ensureSession('tabLocal', '/repo', 'local');
    await ensureSession('tabRemote', '/repo', 'cfg-1');

    expect(findTab('local', 's1')).toBe('tabLocal');
    expect(findTab('cfg-1', 's1')).toBe('tabRemote');
  });

  it('本机 + 远程同名 sessionId 不串 tab(ARCH-9)', async () => {
    const localClient = makeFakeClient('dup');
    const remoteClient = makeFakeClient('dup');
    hostRegistryMock.forWorkspace.mockImplementation(
      ({ hostId }: { hostId: string }) => (hostId === 'local' ? localClient : remoteClient),
    );

    createdTabs.push('tL', 'tR');
    await ensureSession('tL', '/repo', 'local');
    await ensureSession('tR', '/repo', 'cfg-2');

    // 远程事件(hostId='cfg-2', sessionId='dup')必须落到 tR,不能因单键匹配串到 tL
    expect(findTab('cfg-2', 'dup')).toBe('tR');
    expect(findTab('cfg-2', 'dup')).not.toBe('tL');
    // 反之亦然:本机事件不落到远程 tab
    expect(findTab('local', 'dup')).toBe('tL');
    expect(findTab('local', 'dup')).not.toBe('tR');
  });

  it('未知 hostId 或未知 sessionId → null(不误命中任何 tab)', async () => {
    const client = makeFakeClient('s9');
    hostRegistryMock.forWorkspace.mockReturnValue(client);
    createdTabs.push('tX');
    await ensureSession('tX', '/repo', 'local');

    expect(findTab('cfg-nope', 's9')).toBeNull();
    expect(findTab('local', 'session-nope')).toBeNull();
  });
});

describe('ensureSession 绑定路由 host client(A1-A9 迁移)', () => {
  it('spawn 经 hostRegistry.forWorkspace({hostId}) 取 client,PTY 全链路走该 client', async () => {
    const remoteClient = makeFakeClient('r-sess');
    hostRegistryMock.forWorkspace.mockReturnValue(remoteClient);

    createdTabs.push('tabR');
    await ensureSession('tabR', '/repo', 'cfg-9');

    expect(hostRegistryMock.forWorkspace).toHaveBeenCalledWith({ hostId: 'cfg-9' });
    expect(remoteClient.rpc).toHaveBeenCalledWith(
      'pty.spawn',
      expect.objectContaining({ cwd: '/repo' }),
    );
    expect(remoteClient.attachPty).toHaveBeenCalledWith('r-sess', expect.any(Object));
    expect(remoteClient.resize).toHaveBeenCalledWith('r-sess', expect.any(Number), expect.any(Number));
    // spawn 路径完全没碰过 hostRegistry.local()(不是意外走了本机兜底)
    expect(hostRegistryMock.local).not.toHaveBeenCalled();
  });

  it('disposeTerminal 用 spawn 时绑定的同一 client 发 pty.kill(而非本机单例)', async () => {
    const remoteClient = makeFakeClient('r-sess-2');
    hostRegistryMock.forWorkspace.mockReturnValue(remoteClient);

    await ensureSession('tabR2', '/repo', 'cfg-9');
    disposeTerminal('tabR2');

    expect(remoteClient.rpc).toHaveBeenCalledWith('pty.kill', { sessionId: 'r-sess-2' });
    expect(hostRegistryMock.local).not.toHaveBeenCalled();
  });

  it('重复调用 ensureSession(已 spawn)不重复 spawn', async () => {
    const client = makeFakeClient('once');
    hostRegistryMock.forWorkspace.mockReturnValue(client);
    createdTabs.push('tabOnce');

    await ensureSession('tabOnce', '/repo', 'local');
    await ensureSession('tabOnce', '/repo', 'local');

    expect(client.rpc).toHaveBeenCalledTimes(1); // 仅一次 pty.spawn(resize 走 client.resize 不占 rpc 计数)
  });
});
