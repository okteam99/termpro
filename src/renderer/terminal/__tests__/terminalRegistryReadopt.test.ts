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
  attach?: (params: { sessionId: string }) => SessionAttachResult;
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
        const p = params as FakeClient['attachCalls'][number];
        attachCalls.push(p);
        return opts.attach ? opts.attach(p) : defaultAttach;
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

describe('readopt_full_replay_restores_bracketed_paste_mode', () => {
  it('full=true 且快照 bracketedPaste → reset 后、切片前写 ?2004h(恢复粘贴聚合)', async () => {
    const { inst, writes, resets } = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1' });
    const client = makeFakeClient({
      attach: () => ({
        found: true, full: true, baseOffset: 0, data: 'FULL', nextOffset: 4,
        snapshot: { ...snap('running'), bracketedPaste: true },
      }),
    });
    await readoptHost('cfg-1', { getClient: () => asClient(client), listInstances: () => [['t', inst]] });
    expect(resets.n).toBe(1);
    expect(writes).toEqual(['\x1b[?2004h', 'FULL']); // 模式先于回放数据·切片内翻转仍以切片为准
  });

  it('增量回放不注入(xterm 状态连续);旧 host 快照缺字段不注入(向后兼容)', async () => {
    const a = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1', renderedBytes: 10 });
    const inc = makeFakeClient({
      attach: () => ({
        found: true, full: false, baseOffset: 10, data: 'GAP', nextOffset: 13,
        snapshot: { ...snap('running'), bracketedPaste: true },
      }),
    });
    await readoptHost('cfg-1', { getClient: () => asClient(inc), listInstances: () => [['t', a.inst]] });
    expect(a.writes).toEqual(['GAP']);

    const b = makeFakeInst({ hostId: 'cfg-1', sessionId: 's2' });
    const oldHost = makeFakeClient({
      attach: () => ({ found: true, full: true, baseOffset: 0, data: 'FULL', nextOffset: 4, snapshot: snap('running') }),
    });
    await readoptHost('cfg-1', { getClient: () => asClient(oldHost), listInstances: () => [['t2', b.inst]] });
    expect(b.writes).toEqual(['FULL']);
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

describe('readopt per-inst 容错(2026-07-23「远程机连着但无法输入」回归网)', () => {
  it('路径① 单 inst attach reject → 其余 inst 照常收养;失败 inst 保留 sessionId 供下轮;末尾聚合 reject;onAdoptFailed 逐失败回调', async () => {
    const bad = makeFakeInst({ hostId: 'cfg-1', sessionId: 's-bad', renderedBytes: 5 });
    const good = makeFakeInst({ hostId: 'cfg-1', sessionId: 's-good', renderedBytes: 7 });
    const client = makeFakeClient({
      attach: (p) => {
        if (p.sessionId === 's-bad') throw new Error('attach boom');
        return {
          found: true, full: false, baseOffset: 7, data: 'LIVE', nextOffset: 11,
          snapshot: snap('running', 'live', null, 's-good'),
        };
      },
    });
    const onAdoptFailed = vi.fn();
    await expect(
      readoptHost('cfg-1', {
        getClient: () => asClient(client),
        listInstances: () => [
          ['t-bad', bad.inst],
          ['t-good', good.inst],
        ],
        onAdoptFailed,
      }),
    ).rejects.toThrow(/1 session/);
    // 🔴 核心断言:s-bad 失败不得中止循环——否则 s-good 在新连接上永不 re-attach,
    // host 侧 client.sessions 缺位 → pty:input 被静默丢弃 = 「连着但无法输入」
    expect(client.attachCalls.map((c) => c.sessionId)).toEqual(['s-bad', 's-good']);
    expect(good.writes).toContain('LIVE');
    expect(good.inst.renderedBytes).toBe(11);
    expect(bad.inst.sessionId).toBe('s-bad'); // 保留,readoptHostSessions 重试可再收养
    expect(onAdoptFailed).toHaveBeenCalledTimes(1);
    expect(onAdoptFailed).toHaveBeenCalledWith('t-bad', expect.any(Error));
  });

  it('路径② 单快照收养失败 → 其余快照照常重建收养;整体 reject', async () => {
    const badSnap = snap('running', 'live', null, 's-bad');
    const goodSnap = snap('running', 'live', null, 's-good');
    const client = makeFakeClient({
      sessions: [badSnap, goodSnap],
      attach: (p) => {
        if (p.sessionId === 's-bad') throw new Error('attach boom');
        return { found: true, full: true, baseOffset: 0, data: 'REPLAY', nextOffset: 6, snapshot: goodSnap };
      },
    });
    const instBad = makeFakeInst({});
    const instGood = makeFakeInst({});
    const onAdoptFailed = vi.fn();
    await expect(
      readoptHost('cfg-1', {
        getClient: () => asClient(client),
        listInstances: () => [],
        rebuildTab: (_h, s) => (s.sessionId === 's-bad' ? 't-bad' : 't-good'),
        getOrCreateInst: (tabId) => (tabId === 't-bad' ? instBad.inst : instGood.inst),
        wireLiveSession: () => undefined,
        onAdoptFailed,
      }),
    ).rejects.toThrow(/1 session/);
    expect(instGood.writes).toContain('REPLAY');
    expect(instGood.inst.sessionId).toBe('s-good');
    expect(instBad.inst.sessionId).toBe('s-bad'); // 已绑定,下轮路径① 重试
    expect(onAdoptFailed).toHaveBeenCalledWith('t-bad', expect.any(Error));
  });

  it('全部成功 → 不 reject、不调 onAdoptFailed(容错不改变健康路径)', async () => {
    const { inst } = makeFakeInst({ hostId: 'cfg-1', sessionId: 's1' });
    const client = makeFakeClient({});
    const onAdoptFailed = vi.fn();
    await readoptHost('cfg-1', {
      getClient: () => asClient(client),
      listInstances: () => [['t', inst]],
      onAdoptFailed,
    });
    expect(onAdoptFailed).not.toHaveBeenCalled();
  });
});

describe('readopt path② onUnadopted 策略钩子(评审 P2-2 渲染半侧)', () => {
  it('rebuildTab 返 null(映射不到 workspace)→ 调 onUnadopted(hostId, snap, client);不建 inst', async () => {
    const orphan = snap('running', 'live', null, 's-orphan');
    const client = makeFakeClient({ sessions: [orphan] });
    const onUnadopted = vi.fn();
    const getOrCreateInst = vi.fn();
    await readoptHost('local', {
      getClient: () => asClient(client),
      listInstances: () => [],
      rebuildTab: () => null,
      onUnadopted,
      getOrCreateInst,
    } as ReadoptHooks);
    expect(onUnadopted).toHaveBeenCalledTimes(1);
    expect(onUnadopted).toHaveBeenCalledWith('local', orphan, asClient(client));
    expect(getOrCreateInst).not.toHaveBeenCalled();
  });

  it('rebuildTab 成功收养 → 不调 onUnadopted;缺省钩子(不传)→ 跳过不炸', async () => {
    const s = snap('running', 'live', null, 's-map');
    const client = makeFakeClient({ sessions: [s] });
    const { inst } = makeFakeInst({});
    const onUnadopted = vi.fn();
    await readoptHost('local', {
      getClient: () => asClient(client),
      listInstances: () => [],
      rebuildTab: () => 't-new',
      getOrCreateInst: () => inst,
      wireLiveSession: () => undefined,
      onUnadopted,
    } as ReadoptHooks);
    expect(onUnadopted).not.toHaveBeenCalled();

    // 缺省钩子:同场景不传 onUnadopted,安静跳过
    const client2 = makeFakeClient({ sessions: [snap('running', 'live', null, 's-skip')] });
    await readoptHost('local', {
      getClient: () => asClient(client2),
      listInstances: () => [],
      rebuildTab: () => null,
    });
  });
});
