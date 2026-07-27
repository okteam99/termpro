// @vitest-environment jsdom
// 2026-07-27「远程机连接状态正常,但终端卡着不动、ctrl+c 不起作用」回归网。
// host 侧 pty:input 只认**当前连接**上的会话归属(hostCore 归属门),归属没重建 = 击键静默
// 丢弃 + 无输出订阅,而心跳/延迟/其它 RPC 一切正常 —— 症状就是「连着但冻住」。两道防线:
//  ① readopt 路径① 收养前把 inst 迁到该 host 的**当前 client 实例**:手动断开走
//     hostRegistry.drop(dispose 实例但不销毁 tab),重连后 getOrCreateRemote 造的是新实例;
//     旧代码用新实例 attach 却把 inst 留在旧实例上 → 收养「成功」而终端全冻。
//  ② 代次(HostClient.epoch)失配时键入不再直发:攒住击键 → 就地重收养 → 成功后原样补发,
//     用户砸一下 ctrl+c 就能自愈,不必「断开重连机器」。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../../services/hostClient';
import type { SessionAttachResult, SessionSnapshot } from '../../../shared/protocol';

const forHostId = vi.fn<(hostId: string) => HostClient | null>();
const forWorkspace = vi.fn<(ws: { hostId: string }) => HostClient>();
vi.mock('../../services/hostRegistry', () => ({
  hostRegistry: {
    forHostId: (id: string) => forHostId(id),
    forWorkspace: (ws: { hostId: string }) => forWorkspace(ws),
  },
}));

const {
  deliverInput,
  ensureAttached,
  readoptHost,
  __setInstForTest,
  __clearRegistryForTest,
} = await import('../terminalRegistry');
type TermInstance = import('../terminalRegistry').TermInstance;

function snap(sessionId = 's1', status: 'live' | 'exited' = 'live'): SessionSnapshot {
  return {
    sessionId,
    cwd: '/repo',
    title: 'zsh',
    status,
    state: 'idle',
    quiet: false,
    altscreen: false,
    exitCode: null,
  };
}

function makeFakeInst(over: Partial<TermInstance>): TermInstance {
  const term = {
    cols: 80,
    rows: 24,
    write: (_d: string, cb?: () => void) => cb?.(),
    reset: () => {},
    onData: () => ({ dispose() {} }),
    onResize: () => ({ dispose() {} }),
  };
  return {
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
    attachedEpoch: -1,
    renderedBytes: 0,
    replaying: false,
    replayQueue: [],
    exited: false,
    inputWired: false,
    takenover: false,
    remotePaste: null,
    remotePasteDispose: null,
    fit: {},
    search: {},
    webgl: null,
    barPin: {},
    ...over,
  } as unknown as TermInstance;
}

function makeFakeClient(opts: {
  epoch?: number;
  attach?: (p: { sessionId: string }) => SessionAttachResult;
  /** attach 前的闸门(测「自愈在途」的并发合并):resolve 前 attach 一直挂着。 */
  gate?: () => Promise<void>;
}) {
  const attachCalls: Array<{ sessionId: string; resumeOffset: number }> = [];
  const client = {
    epoch: opts.epoch ?? 1,
    reconnectable: true,
    supportsSessionResume: () => true,
    rpc: vi.fn(async (method: string, params: unknown) => {
      if (method === 'session.attach') {
        const p = params as { sessionId: string; resumeOffset: number };
        await opts.gate?.();
        attachCalls.push(p);
        return (
          opts.attach?.(p) ?? {
            found: true,
            full: false,
            baseOffset: 0,
            data: '',
            nextOffset: 0,
            snapshot: snap(p.sessionId),
          }
        );
      }
      if (method === 'session.list') return { sessions: [] };
      if (method === 'pty.spawn') return { sessionId: 's-new' };
      return {};
    }),
    attachPty: vi.fn(() => () => {}),
    detachPty: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    ack: vi.fn(),
    attachCalls,
  };
  return client;
}
type FakeClient = ReturnType<typeof makeFakeClient>;
const asClient = (c: FakeClient) => c as unknown as HostClient;

beforeEach(() => {
  __clearRegistryForTest();
  forHostId.mockReset();
  forWorkspace.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('收养前把 inst 迁到该 host 的当前 client 实例(手动断开→重连造新实例)', () => {
  it('路径①:摘旧实例监听 + 在新实例上重挂 live 管线 + inst.client 换成新实例', async () => {
    const oldClient = makeFakeClient({ epoch: 1 });
    const newClient = makeFakeClient({ epoch: 1 });
    const inst = makeFakeInst({
      hostId: 'cfg-1',
      sessionId: 's1',
      client: asClient(oldClient),
      attachedEpoch: 1,
      renderedBytes: 3,
    });

    await readoptHost('cfg-1', {
      getClient: () => asClient(newClient),
      listInstances: () => [['t', inst]],
    });

    // 🔴 核心:输出订阅与输入指针都必须落到「发了 session.attach 的那个实例」上,
    // 否则 host 把 pty:data 推给新连接、renderer 却在旧实例上等 → 永远不上屏;
    // 输入 post 进旧实例的 null transport → 静默丢弃 = 终端全冻但连接正常。
    expect(oldClient.detachPty).toHaveBeenCalledWith('s1');
    expect(newClient.attachPty).toHaveBeenCalledWith('s1', expect.anything());
    expect(inst.client).toBe(asClient(newClient));
    expect(newClient.attachCalls[0]).toMatchObject({ sessionId: 's1', resumeOffset: 3 });
  });

  it('同实例(闪断重连复用)→ 不摘不重挂(廉价 no-op,不制造重复监听)', async () => {
    const client = makeFakeClient({ epoch: 2 });
    const inst = makeFakeInst({
      hostId: 'cfg-1',
      sessionId: 's1',
      client: asClient(client),
      attachedEpoch: 1,
    });
    await readoptHost('cfg-1', {
      getClient: () => asClient(client),
      listInstances: () => [['t', inst]],
    });
    expect(client.detachPty).not.toHaveBeenCalled();
    expect(client.attachPty).not.toHaveBeenCalled();
    expect(inst.attachedEpoch).toBe(2); // 收养成功 → 代次刷新
  });
});

describe('断链未收养的会话上键入 → 攒住 + 就地重收养 + 补发(ctrl+c 自愈)', () => {
  it('代次失配:不直发,attach 重建归属后原样补发', async () => {
    const client = makeFakeClient({
      epoch: 2,
      attach: () => ({
        found: true,
        full: true,
        baseOffset: 0,
        data: 'REPLAY',
        nextOffset: 6,
        snapshot: snap(),
      }),
    });
    const inst = makeFakeInst({
      hostId: 'cfg-1',
      sessionId: 's1',
      client: asClient(client),
      attachedEpoch: 1, // 旧连接上的归属,已随断链消失
    });
    __setInstForTest('t', inst);
    forHostId.mockReturnValue(asClient(client));

    deliverInput('t', '\x03');
    expect(client.input).not.toHaveBeenCalled(); // 绝不投进黑洞

    await vi.waitFor(() => expect(client.input).toHaveBeenCalledWith('s1', '\x03'));
    expect(client.attachCalls[0]).toMatchObject({ sessionId: 's1' });
    expect(inst.attachedEpoch).toBe(2); // 归属重建 → 后续击键直发
  });

  it('代次相符 → 直发(健康路径不绕道、不多发 attach)', () => {
    const client = makeFakeClient({ epoch: 3 });
    const inst = makeFakeInst({
      hostId: 'cfg-1',
      sessionId: 's1',
      client: asClient(client),
      attachedEpoch: 3,
    });
    __setInstForTest('t', inst);
    deliverInput('t', 'ls\r');
    expect(client.input).toHaveBeenCalledWith('s1', 'ls\r');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('自愈在途的连续击键合并为一轮收养,按序一次性补发', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const client = makeFakeClient({ epoch: 2, gate: () => gate });
    const inst = makeFakeInst({
      hostId: 'cfg-1',
      sessionId: 's1',
      client: asClient(client),
      attachedEpoch: 1,
    });
    __setInstForTest('t', inst);
    forHostId.mockReturnValue(asClient(client));

    deliverInput('t', 'a');
    deliverInput('t', 'b');
    deliverInput('t', 'c');
    release!();

    await vi.waitFor(() => expect(client.input).toHaveBeenCalledWith('s1', 'abc'));
    expect(client.attachCalls).toHaveLength(1); // 一串击键只触发一轮 attach
    expect(client.input).toHaveBeenCalledTimes(1);
  });

  it('会话已不在 host(found=false)→ 原位重 spawn,旧击键不灌进新 shell', async () => {
    const client = makeFakeClient({
      epoch: 2,
      attach: () => ({
        found: false,
        full: false,
        baseOffset: 0,
        data: '',
        nextOffset: 0,
        snapshot: snap(),
      }),
    });
    const inst = makeFakeInst({
      hostId: 'cfg-1',
      sessionId: 's-gone',
      client: asClient(client),
      attachedEpoch: 1,
    });
    __setInstForTest('t', inst);
    forHostId.mockReturnValue(asClient(client));
    forWorkspace.mockReturnValue(asClient(client));

    deliverInput('t', 'rm -rf /\r');

    await vi.waitFor(() => expect(inst.sessionId).toBe('s-new'));
    // 🔴 攒下的键属于已死会话,补发进新 shell 等于替用户执行一条他没在看的命令
    expect(client.input).not.toHaveBeenCalled();
  });

  it('回放在途(readopt 正在 attach)→ 等它落定,不并发再发 attach(防同段重放)', async () => {
    const client = makeFakeClient({ epoch: 2 });
    const inst = makeFakeInst({
      hostId: 'cfg-1',
      sessionId: 's1',
      client: asClient(client),
      attachedEpoch: 1,
      replaying: true, // 另一路(readopt)的回放正在写
    });
    __setInstForTest('t', inst);
    forHostId.mockReturnValue(asClient(client));

    deliverInput('t', '\x03');
    // 在途那轮收养落定:代次追平 + 解冻
    inst.attachedEpoch = 2;
    inst.replaying = false;

    await vi.waitFor(() => expect(client.input).toHaveBeenCalledWith('s1', '\x03'));
    expect(client.attachCalls).toHaveLength(0); // 没有第二条 attach
  });

  it('tab 激活时同样自愈(切回来即恢复,不必先盲敲一下)', async () => {
    const client = makeFakeClient({ epoch: 2 });
    const inst = makeFakeInst({
      hostId: 'cfg-1',
      sessionId: 's1',
      client: asClient(client),
      attachedEpoch: 1,
    });
    __setInstForTest('t', inst);
    forHostId.mockReturnValue(asClient(client));

    await ensureAttached('t');
    expect(client.attachCalls[0]).toMatchObject({ sessionId: 's1' });
    expect(inst.attachedEpoch).toBe(2);

    // 已收养的 tab 再激活 → 不重复 attach
    await ensureAttached('t');
    expect(client.attachCalls).toHaveLength(1);
  });
});
