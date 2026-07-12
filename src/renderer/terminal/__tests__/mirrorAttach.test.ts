// @vitest-environment jsdom
// M2 多端同屏 renderer 半侧(设计 B.7):
// ① attach 按能力位带 mode:'mirror'(旧 host 不带 → host 侧 exclusive 零破坏);
// ② session:takenover → 置标记 + 终端提示;③ tab 重新激活 remirrorIfTakenOver
//    自动 mirror re-attach 取回(found=false → 原位重 spawn)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionAttachResult, SessionSnapshot } from '../../../shared/protocol';

const fakeClient = {
  reconnectable: true,
  supportsSessionResume: () => true,
  supportsSessionMirror: vi.fn(() => true),
  rpc: vi.fn(),
  attachPty: vi.fn((_sessionId: string, _listener: unknown) => () => {}),
  input: vi.fn(),
  resize: vi.fn(),
  ack: vi.fn(),
};

vi.mock('../../services/hostRegistry', () => ({
  hostRegistry: {
    forHostId: vi.fn(() => fakeClient),
    forWorkspace: vi.fn(() => fakeClient),
    local: vi.fn(() => fakeClient),
  },
}));

import {
  bindRestoredSessionTab,
  readoptHost,
  remirrorIfTakenOver,
  __setInstForTest,
  __clearRegistryForTest,
  type TermInstance,
} from '../terminalRegistry';

function liveSnap(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    cwd: '/repo',
    title: 'zsh',
    status: 'live',
    state: 'idle',
    quiet: false,
    altscreen: false,
    exitCode: null,
  };
}

function attachOk(sessionId: string): SessionAttachResult {
  return {
    found: true,
    full: false,
    baseOffset: 0,
    data: '',
    nextOffset: 0,
    snapshot: liveSnap(sessionId),
  };
}

function makeFakeInst(): { inst: TermInstance; writes: string[] } {
  const writes: string[] = [];
  const term = {
    cols: 80,
    rows: 24,
    write: (d: string, cb?: () => void) => {
      writes.push(d);
      cb?.();
    },
    writeln: (d: string) => writes.push(`${d}\n`),
    reset: () => {},
    onData: () => ({ dispose() {} }),
    onResize: () => ({ dispose() {} }),
  };
  const inst = {
    term,
    sessionId: null,
    spawning: false,
    opened: false,
    firstData: false,
    disposed: false,
    spawnCwd: '',
    callbacks: {},
    client: null,
    hostId: null,
    renderedBytes: 0,
    replaying: false,
    replayQueue: [],
    exited: false,
    inputWired: false,
    takenover: false,
    fit: {},
    search: {},
    webgl: null,
    barPin: {},
  } as unknown as TermInstance;
  return { inst, writes };
}

afterEach(() => {
  __clearRegistryForTest();
  fakeClient.rpc.mockReset();
  fakeClient.attachPty.mockClear();
  fakeClient.supportsSessionMirror.mockReturnValue(true);
});

describe('attach mode 按能力位(B.3 兼容矩阵 renderer 半侧)', () => {
  it('host 支持 session.mirror → session.attach 带 mode:"mirror"', async () => {
    const { inst } = makeFakeInst();
    __setInstForTest('t1', inst);
    bindRestoredSessionTab('t1', 'cfg-a', 'sid-1', '/repo');
    fakeClient.rpc.mockImplementation(async (method: string) => {
      if (method === 'session.attach') return attachOk('sid-1');
      if (method === 'session.list') return { sessions: [] };
      return {};
    });

    await readoptHost('cfg-a', {});

    const attachCall = fakeClient.rpc.mock.calls.find((c) => c[0] === 'session.attach');
    expect(attachCall?.[1]).toMatchObject({ mode: 'mirror' });
  });

  it('旧 host(无能力位)→ attach 不带 mode(host 侧按 exclusive,零破坏)', async () => {
    fakeClient.supportsSessionMirror.mockReturnValue(false);
    const { inst } = makeFakeInst();
    __setInstForTest('t1', inst);
    bindRestoredSessionTab('t1', 'cfg-a', 'sid-1', '/repo');
    fakeClient.rpc.mockImplementation(async (method: string) => {
      if (method === 'session.attach') return attachOk('sid-1');
      if (method === 'session.list') return { sessions: [] };
      return {};
    });

    await readoptHost('cfg-a', {});

    const attachCall = fakeClient.rpc.mock.calls.find((c) => c[0] === 'session.attach');
    expect(attachCall?.[1]).not.toHaveProperty('mode');
  });
});

describe('session:takenover → 标记 + 提示 + 激活取回', () => {
  it('onTakenover 置 inst.takenover 并写一行提示(幂等,不重复刷屏)', () => {
    const { inst, writes } = makeFakeInst();
    __setInstForTest('t1', inst);
    bindRestoredSessionTab('t1', 'cfg-a', 'sid-1', '/repo');

    const listener = fakeClient.attachPty.mock.calls[0][1] as { onTakenover?: () => void };
    listener.onTakenover?.();
    listener.onTakenover?.(); // 幂等

    expect(inst.takenover).toBe(true);
    const hints = writes.filter((w) => w.includes('exclusive control') || w.includes('独占接管'));
    expect(hints).toHaveLength(1);
  });

  it('remirrorIfTakenOver:重新 mirror attach(resumeOffset=renderedBytes)并清标记', async () => {
    const { inst } = makeFakeInst();
    __setInstForTest('t1', inst);
    bindRestoredSessionTab('t1', 'cfg-a', 'sid-1', '/repo');
    inst.takenover = true;
    inst.renderedBytes = 4242;
    fakeClient.rpc.mockImplementation(async (method: string) => {
      if (method === 'session.attach') return attachOk('sid-1');
      return {};
    });

    await remirrorIfTakenOver('t1');

    expect(inst.takenover).toBe(false);
    const attachCall = fakeClient.rpc.mock.calls.find((c) => c[0] === 'session.attach');
    expect(attachCall?.[1]).toMatchObject({
      sessionId: 'sid-1',
      resumeOffset: 4242,
      mode: 'mirror',
    });
  });

  it('remirror 撞 found=false(会话已被对端 kill)→ 原位重 spawn', async () => {
    const { inst } = makeFakeInst();
    __setInstForTest('t1', inst);
    bindRestoredSessionTab('t1', 'cfg-a', 'sid-1', '/repo');
    inst.takenover = true;
    fakeClient.rpc.mockImplementation(async (method: string) => {
      if (method === 'session.attach') return { found: false } as SessionAttachResult;
      if (method === 'pty.spawn') return { sessionId: 'fresh-sid' };
      return {};
    });

    await remirrorIfTakenOver('t1');

    expect(inst.sessionId).toBe('fresh-sid');
    expect(inst.takenover).toBe(false);
  });

  it('session:desynced → 立即 mirror re-attach 全量重同步(收尾评审 P2-1,不静默冻屏)', async () => {
    const { inst, writes } = makeFakeInst();
    __setInstForTest('t1', inst);
    bindRestoredSessionTab('t1', 'cfg-a', 'sid-1', '/repo');
    inst.renderedBytes = 1000;
    fakeClient.rpc.mockImplementation(async (method: string) => {
      if (method === 'session.attach') {
        return {
          found: true,
          full: true,
          baseOffset: 0,
          data: 'FULL_RESYNC',
          nextOffset: 5000,
          snapshot: liveSnap('sid-1'),
        } as SessionAttachResult;
      }
      return {};
    });

    const listener = fakeClient.attachPty.mock.calls[0][1] as { onDesynced?: () => void };
    listener.onDesynced?.();
    await vi.waitFor(() => expect(inst.renderedBytes).toBe(5000)); // nextOffset 权威推进

    const attachCall = fakeClient.rpc.mock.calls.find((c) => c[0] === 'session.attach');
    expect(attachCall?.[1]).toMatchObject({ resumeOffset: 1000, mode: 'mirror' });
    expect(writes).toContain('FULL_RESYNC');
  });

  it('未被接管 / host 不支持镜像 → no-op(不发 attach)', async () => {
    const { inst } = makeFakeInst();
    __setInstForTest('t1', inst);
    bindRestoredSessionTab('t1', 'cfg-a', 'sid-1', '/repo');

    await remirrorIfTakenOver('t1'); // takenover=false
    inst.takenover = true;
    fakeClient.supportsSessionMirror.mockReturnValue(false);
    await remirrorIfTakenOver('t1'); // 能力缺失:不 exclusive 抢回(防乒乓)

    expect(fakeClient.rpc.mock.calls.filter((c) => c[0] === 'session.attach')).toHaveLength(0);
  });
});
