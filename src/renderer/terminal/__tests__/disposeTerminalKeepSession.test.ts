// @vitest-environment jsdom
// 2026-08-15「客户端升级重连后,正在查看的项目的服务端会话丢了」回归网(registry 半侧)。
// 根因:drop 链路(stopRemoteWorkspaceSync ② dropHostWorkspaces)对挂载过的 tab 调
// disposeTerminal,旧实现无条件发 pty.kill;而 ③ hostRegistry.drop 关连接在其后——
// kill 顺着仍可达的 transport 真送达 host,把断线本应续跑的会话彻底逐出(ptyPool
// 手动 kill 不留 exited)。只有正被查看的 tab 有 inst,于是恰好只杀用户开着的项目
// (codex/claude 在跑任务陪葬),后台项目幸免,看起来像「随机丢会话」。
// 修法:keepSession(detach-only)只拆本地视图;kill 仅保留缺省路径(用户明确意图)。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../../services/hostClient';

vi.mock('../../services/hostRegistry', () => ({
  hostRegistry: {
    forHostId: () => null,
    forWorkspace: () => null,
  },
}));

const { disposeTerminal, getSessionId, __setInstForTest, __clearRegistryForTest } =
  await import('../terminalRegistry');
type TermInstance = import('../terminalRegistry').TermInstance;

function makeInst(rpc: ReturnType<typeof vi.fn>): TermInstance {
  return {
    term: { dispose: vi.fn(), options: {} },
    sessionId: 'sid-1',
    spawning: false,
    opened: false,
    firstData: false,
    disposed: false,
    spawnCwd: '/repo',
    callbacks: {},
    client: { rpc } as unknown as HostClient,
    hostId: 'cfg-a',
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
    barPin: { dispose: vi.fn() },
  } as unknown as TermInstance;
}

beforeEach(() => {
  __clearRegistryForTest();
});

describe('disposeTerminal 的 kill / detach 两种语义', () => {
  it('缺省(用户关 tab 等明确意图)对绑定会话发 pty.kill', () => {
    const rpc = vi.fn(() => Promise.resolve({}));
    __setInstForTest('t1', makeInst(rpc));

    disposeTerminal('t1');

    expect(rpc).toHaveBeenCalledWith('pty.kill', { sessionId: 'sid-1' });
    expect(getSessionId('t1')).toBeNull(); // 视图已拆(registry 移除)
  });

  it('keepSession(drop 拆视图)绝不发任何 RPC——服务端会话续跑,重连后收养回来', () => {
    const rpc = vi.fn(() => Promise.resolve({}));
    const inst = makeInst(rpc);
    __setInstForTest('t1', inst);

    disposeTerminal('t1', { keepSession: true });

    expect(rpc).not.toHaveBeenCalled();
    expect(getSessionId('t1')).toBeNull(); // 本地视图照样拆干净
    expect((inst as unknown as { disposed: boolean }).disposed).toBe(true);
  });
});
