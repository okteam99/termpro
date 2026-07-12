// @vitest-environment jsdom
// 远程 tab 布局恢复的 registry 半侧(用户规则 2026-07):
// ① bindRestoredSessionTab 同步预绑定(inst 字段 + attachPty 接线 + 不覆盖已 spawn);
// ② wireInputOnce 幂等——恢复预绑定后 attach miss 原位重 spawn(ensureSession),
//    term.onData/onResize 不重复挂载(否则每次击键双发 input,幽灵 tab 同根因)。
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeClient = {
  reconnectable: true,
  supportsSessionResume: () => true,
  rpc: vi.fn(async (method: string) => {
    if (method === 'pty.spawn') return { sessionId: 'fresh-sid' };
    return {};
  }),
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
  ensureSession,
  __setInstForTest,
  __clearRegistryForTest,
  type TermInstance,
} from '../terminalRegistry';

function makeFakeInst(): { inst: TermInstance; counters: { onData: number; onResize: number } } {
  const counters = { onData: 0, onResize: 0 };
  const term = {
    cols: 80,
    rows: 24,
    write: (_d: string, cb?: () => void) => cb?.(),
    reset: () => {},
    onData: () => {
      counters.onData += 1;
      return { dispose() {} };
    },
    onResize: () => {
      counters.onResize += 1;
      return { dispose() {} };
    },
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
    renderedBytes: 5,
    replaying: false,
    replayQueue: [],
    exited: true,
    inputWired: false,
    fit: {},
    search: {},
    webgl: null,
    barPin: {},
  } as unknown as TermInstance;
  return { inst, counters };
}

afterEach(() => {
  __clearRegistryForTest();
  fakeClient.rpc.mockClear();
  fakeClient.attachPty.mockClear();
  fakeClient.input.mockClear();
});

describe('bindRestoredSessionTab(恢复 tab 会话预绑定)', () => {
  it('同步绑定 inst 全部会话字段 + attachPty 接线,输入只挂一次', () => {
    const { inst, counters } = makeFakeInst();
    __setInstForTest('tab-1', inst);

    bindRestoredSessionTab('tab-1', 'cfg-a', 'sid-old', '/repo');

    expect(inst.hostId).toBe('cfg-a');
    expect(inst.sessionId).toBe('sid-old');
    expect(inst.spawnCwd).toBe('/repo');
    expect(inst.renderedBytes).toBe(0);
    expect(inst.exited).toBe(false);
    expect(fakeClient.attachPty).toHaveBeenCalledTimes(1);
    expect(fakeClient.attachPty.mock.calls[0][0]).toBe('sid-old');
    expect(counters.onData).toBe(1);
    expect(counters.onResize).toBe(1);
  });

  it('inst 已有会话(挂载已抢先 spawn)→ 不覆盖不重绑', () => {
    const { inst } = makeFakeInst();
    inst.sessionId = 'already-spawned';
    __setInstForTest('tab-1', inst);

    bindRestoredSessionTab('tab-1', 'cfg-a', 'sid-old', '/repo');

    expect(inst.sessionId).toBe('already-spawned');
    expect(fakeClient.attachPty).not.toHaveBeenCalled();
  });

  it('🔴 双接线回归:预绑定 → attach miss 置空 → ensureSession 原位重 spawn,onData 仍只挂 1 次', async () => {
    const { inst, counters } = makeFakeInst();
    __setInstForTest('tab-1', inst);

    bindRestoredSessionTab('tab-1', 'cfg-a', 'sid-dead', '/repo');
    expect(counters.onData).toBe(1);

    // 模拟 readoptHost 路径① found=false 的收尾(sessionId 置空)后挂载重 spawn
    inst.sessionId = null;
    inst.renderedBytes = 0;
    await ensureSession('tab-1', '/repo', 'cfg-a');

    expect(inst.sessionId).toBe('fresh-sid');
    expect(counters.onData).toBe(1); // 输入接线未重复挂载
    expect(counters.onResize).toBe(1);
    // handler 读 inst 现值:respawn 后输入路由到新会话
    // (onData 桩不真派发,这里以 attachPty 双次调用证明 live 管线已重接)
    expect(fakeClient.attachPty).toHaveBeenCalledTimes(2);
    expect(fakeClient.attachPty.mock.calls[1][0]).toBe('fresh-sid');
  });
});
