// @vitest-environment jsdom
// BL-005 · AC-3/4/5/11/12(T-032~036·QA-B-1 北极星级双写的渲染半侧):readoptHost 收养回放。
// test-double xterm 记录写入 + fake client 返回 attach 结果,断言 reset-vs-增量 / renderedBytes 按
// host bytes 记账(CJK bytes≠chars)/ nextOffset 权威 / found=false new spawn / 快照对账徽标 /
// 路径②重建 tab 全量回放。纯 mock·不碰真 pty/ws。
import { describe, expect, it, vi } from 'vitest';
import {
  ingestPtyData,
  readoptHost,
  type ReadoptHooks,
  type TermInstance,
} from '../terminalRegistry';
import type {
  HostClient,
} from '../../services/hostClient';
import type {
  SessionAttachResult,
  SessionSnapshot,
} from '../../../shared/protocol';

function snap(
  state: 'idle' | 'running',
  status: 'live' | 'exited' = 'live',
  exitCode: number | null = null,
  sessionId = 's1',
): SessionSnapshot {
  return { sessionId, cwd: '/repo', title: 'zsh', status, state, quiet: false, altscreen: false, exitCode };
}

function makeFakeInst(over: Partial<TermInstance>): {
  inst: TermInstance;
  writes: string[];
  resets: { n: number };
} {
  const writes: string[] = [];
  const resets = { n: 0 };
  const term = {
    cols: 80,
    rows: 24,
    write: (d: string, cb?: () => void) => {
      writes.push(d);
      cb?.();
    },
    reset: () => {
      resets.n += 1;
    },
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
    spawnCwd: '/repo',
    callbacks: {},
    client: null,
    hostId: null,
    renderedBytes: 0,
    replaying: false,
    replayQueue: [],
    exited: false,
    fit: {},
    search: {},
    webgl: null,
    barPin: {},
    ...over,
  } as unknown as TermInstance;
  return { inst, writes, resets };
}

interface FakeClient {
  reconnectable: boolean;
  supportsSessionResume(): boolean;
  rpc: ReturnType<typeof vi.fn>;
  attachPty: ReturnType<typeof vi.fn>;
  input: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  ack: ReturnType<typeof vi.fn>;
  attachCalls: Array<{ sessionId: string; resumeOffset: number; cols: number; rows: number }>;
}

function makeFakeClient(opts: {
  resume?: boolean;
  attach?: () => SessionAttachResult;
  sessions?: SessionSnapshot[];
}): FakeClient {
  const attachCalls: FakeClient['attachCalls'] = [];
  const defaultAttach: SessionAttachResult = {
    found: true,
    full: false,
    baseOffset: 0,
    data: '',
    nextOffset: 0,
    snapshot: snap('running'),
  };
  return {
    reconnectable: true,
    supportsSessionResume: () => opts.resume ?? true,
    rpc: vi.fn(async (method: string, params: unknown) => {
      if (method === 'session.attach') {
        attachCalls.push(params as FakeClient['attachCalls'][number]);
        return opts.attach ? opts.attach() : defaultAttach;
      }
      if (method === 'session.list') return { sessions: opts.sessions ?? [] };
      return {};
    }),
    attachPty: vi.fn(() => () => {}),
    input: vi.fn(),
    resize: vi.fn(),
    ack: vi.fn(),
    attachCalls,
  };
}

const asClient = (c: FakeClient) => c as unknown as HostClient;

describe('readopt_full_resets_incremental_no_reset_renderedbytes_by_host_bytes_no_double_write (T-032)', () => {
  it('full=true → 先 reset 再写 data;full=false → 不 reset 仅增量 write', async () => {
    const a = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1', renderedBytes: 10 });
    const fullClient = makeFakeClient({
      attach: () => ({ found: true, full: true, baseOffset: 0, data: 'FULL', nextOffset: 4, snapshot: snap('running') }),
    });
    await readoptHost('cfg-1', { getClient: () => asClient(fullClient), listInstances: () => [['t', a.inst]] });
    expect(a.resets.n).toBe(1);
    expect(a.writes).toContain('FULL');

    const b = makeFakeInst({ hostId: 'cfg-1', sessionId: 's2', renderedBytes: 10 });
    const incClient = makeFakeClient({
      attach: () => ({ found: true, full: false, baseOffset: 10, data: 'GAP', nextOffset: 13, snapshot: snap('running') }),
    });
    await readoptHost('cfg-1', { getClient: () => asClient(incClient), listInstances: () => [['t2', b.inst]] });
    expect(b.resets.n).toBe(0); // 增量不清屏
    expect(b.writes).toContain('GAP');
  });

  it('renderedBytes 按 host bytes 累加(CJK bytes≠length)+ resumeOffset = 收养前 renderedBytes(不重复渲染)', async () => {
    const { inst } = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1', renderedBytes: 0 });
    const client = makeFakeClient({
      attach: () => ({ found: true, full: false, baseOffset: 6, data: '', nextOffset: 6, snapshot: snap('running') }),
    });
    // live CJK chunk:'你好' = 2 字符 / 6 字节
    ingestPtyData(inst, 't', asClient(client), 's1', '你好', 6);
    expect(inst.renderedBytes).toBe(6); // 用 bytes(6)不用 length(2)

    await readoptHost('cfg-1', { getClient: () => asClient(client), listInstances: () => [['t', inst]] });
    expect(client.attachCalls[0].resumeOffset).toBe(6); // host 只回放 gap·已有字节不重放
  });

  it('renderedBytes 收养后 = result.nextOffset(权威·非自算 baseOffset+byteLength)', async () => {
    const { inst } = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1', renderedBytes: 100 });
    const client = makeFakeClient({
      attach: () => ({ found: true, full: false, baseOffset: 100, data: 'x', nextOffset: 250, snapshot: snap('running') }),
    });
    await readoptHost('cfg-1', { getClient: () => asClient(client), listInstances: () => [['t', inst]] });
    expect(inst.renderedBytes).toBe(250);
  });
});

describe('readopt_found_false_falls_back_to_new_spawn (T-033)', () => {
  it('found=false → 走 new spawn(不增量 write·清 sessionId·不误把旧 scrollback 当 gap)', async () => {
    const { inst, writes } = makeFakeInst({ hostId: 'cfg-1', sessionId: 'gone', spawnCwd: '/repo', renderedBytes: 50 });
    const client = makeFakeClient({
      attach: () => ({ found: false, full: false, baseOffset: 0, data: '', nextOffset: 0, snapshot: snap('running') }),
    });
    const spawnNew = vi.fn(async () => {});
    await readoptHost('cfg-1', {
      getClient: () => asClient(client),
      listInstances: () => [['t', inst]],
      spawnNew,
    });
    expect(spawnNew).toHaveBeenCalledWith('t', '/repo', 'cfg-1');
    expect(inst.sessionId).toBeNull();
    expect(writes.length).toBe(0);
  });
});

describe('readopt_snapshot_reconciles_badge_running_to_idle (T-034)', () => {
  it('据快照 state=idle 对账徽标(消除过期 running 残留)', async () => {
    const { inst } = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1' });
    const client = makeFakeClient({
      attach: () => ({ found: true, full: false, baseOffset: 0, data: '', nextOffset: 0, snapshot: snap('idle') }),
    });
    const reconcileBadge = vi.fn();
    await readoptHost('cfg-1', {
      getClient: () => asClient(client),
      listInstances: () => [['t', inst]],
      reconcileBadge,
    });
    expect(reconcileBadge).toHaveBeenCalledWith(
      'cfg-1',
      's1',
      expect.objectContaining({ state: 'idle', status: 'live' }),
    );
  });
});

describe('readopt_exited_snapshot_renders_completed_badge_no_double_write (T-035)', () => {
  it('exited 快照 → inst.exited=true·不 dispose·回放最终 scrollback 无重复(renderedBytes=nextOffset)', async () => {
    const { inst, writes, resets } = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1', renderedBytes: 0 });
    const client = makeFakeClient({
      attach: () => ({
        found: true,
        full: true,
        baseOffset: 0,
        data: 'BUILD DONE',
        nextOffset: 10,
        snapshot: snap('idle', 'exited', 0),
      }),
    });
    const reconcileBadge = vi.fn();
    await readoptHost('cfg-1', {
      getClient: () => asClient(client),
      listInstances: () => [['t', inst]],
      reconcileBadge,
    });
    expect(inst.exited).toBe(true);
    expect(resets.n).toBe(1);
    expect(writes).toContain('BUILD DONE');
    expect(inst.renderedBytes).toBe(10); // 权威推进·无重复渲染
    expect(reconcileBadge).toHaveBeenCalledWith(
      'cfg-1',
      's1',
      expect.objectContaining({ status: 'exited', exitCode: 0 }),
    );
  });
});

describe('readopt_rebuilds_tab_from_session_list_when_local_instance_gone (T-036)', () => {
  it('session.list 有本地无 inst → 据快照重建 tab + attach(resumeOffset=0)全量回放', async () => {
    const remoteSnap = snap('running', 'live', null, 's-remote');
    const client = makeFakeClient({
      sessions: [remoteSnap],
      attach: () => ({ found: true, full: true, baseOffset: 0, data: 'REPLAY', nextOffset: 6, snapshot: remoteSnap }),
    });
    const { inst, writes, resets } = makeFakeInst({ hostId: null, sessionId: null });
    const rebuildTab = vi.fn(() => 'rebuilt-tab');
    const getOrCreateInst = vi.fn(() => inst);
    const wireLiveSession = vi.fn();
    const reconcileBadge = vi.fn();

    const hooks: ReadoptHooks = {
      getClient: () => asClient(client),
      listInstances: () => [], // 本地无 inst
      rebuildTab,
      getOrCreateInst,
      wireLiveSession,
      reconcileBadge,
    };
    await readoptHost('cfg-1', hooks);

    expect(rebuildTab).toHaveBeenCalledWith('cfg-1', remoteSnap);
    expect(getOrCreateInst).toHaveBeenCalledWith('rebuilt-tab');
    expect(wireLiveSession).toHaveBeenCalled();
    expect(resets.n).toBe(1); // full 回放先清屏
    expect(writes).toContain('REPLAY');
    expect(inst.sessionId).toBe('s-remote');
    expect(client.attachCalls[0].resumeOffset).toBe(0); // 全量回放
    expect(reconcileBadge).toHaveBeenCalledWith('cfg-1', 's-remote', remoteSnap);
  });
});

describe('readopt capability gate (T-038 renderer 半侧)', () => {
  it('supportsSessionResume=false → 不发 session.attach·每个 inst new spawn', async () => {
    const { inst, writes } = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1', spawnCwd: '/repo' });
    const client = makeFakeClient({ resume: false });
    const spawnNew = vi.fn(async () => {});
    await readoptHost('cfg-1', {
      getClient: () => asClient(client),
      listInstances: () => [['t', inst]],
      spawnNew,
    });
    // 未发 attach/list
    expect(client.rpc).not.toHaveBeenCalled();
    expect(spawnNew).toHaveBeenCalledWith('t', '/repo', 'cfg-1');
    expect(writes.length).toBe(0);
  });
});
