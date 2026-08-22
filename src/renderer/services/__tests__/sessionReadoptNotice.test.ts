// @vitest-environment jsdom
// 收养失败提示的去重(修用户实测「同一行连刷 5 遍,把 TUI 界面戳成筛子」)。
// 提示写进 xterm 缓冲,对满屏 TUI 每写一行就是一行错位;链路反复闪断时每轮重连都补一条。
// 语义:同一 tab 在收养成功前只说一次;成功后清位,再失败才是值得再说的新情况。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeTerminalNotice = vi.fn();
const findTab = vi.fn<(hostId: string, sessionId: string) => string | null>();

vi.mock('../../terminal/terminalRegistry', () => ({
  writeTerminalNotice,
  findTab: (h: string, s: string) => findTab(h, s),
  readoptHost: vi.fn(),
  bindRestoredSessionTab: vi.fn(),
}));

const { readoptHostSessions, reconcileBadge, __resetAdoptNoticeMemoForTests } =
  await import('../sessionReadopt');
const { useAppStore } = await import('../../state/store');

type Hooks = {
  onAdoptFailed?: (tabId: string, err: unknown) => void;
  reconcileBadge?: (
    hostId: string,
    sessionId: string,
    snapshot: Parameters<typeof reconcileBadge>[2],
  ) => void;
};

/** 每次收养都在末次尝试对 tabId 报失败(= 生产里 per-inst 容错的失败回调)。 */
function failingReadopt(tabId: string, message = 'rpc timeout: session.attach') {
  return vi.fn(async (_hostId: string, hooks: Hooks) => {
    hooks.onAdoptFailed?.(tabId, new Error(message));
    throw new Error('readopt incomplete');
  });
}

/** 一轮重连收养(零延迟重试,直达末次尝试)。 */
const runReconnect = (readopt: ReturnType<typeof failingReadopt>) =>
  readoptHostSessions('cfg-1', readopt as never, {
    retryDelaysMs: [0, 0],
    sleep: async () => undefined,
  });

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const snap = (sessionId = 's1') =>
  ({
    sessionId,
    cwd: '/repo',
    title: 'zsh',
    status: 'live' as const,
    state: 'idle' as const,
    quiet: false,
    altscreen: false,
    exitCode: null,
  });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  writeTerminalNotice.mockClear();
  findTab.mockReset();
  __resetAdoptNoticeMemoForTests();
  useAppStore.setState({ workspaces: [] });
});

describe('收养失败提示去重', () => {
  it('新一轮已排队并成功 → 旧一轮最终失败不写过期提示', async () => {
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const firstReadopt = vi.fn(async (_hostId: string, hooks: Hooks) => {
      firstStarted.resolve();
      await releaseFirst.promise;
      hooks.onAdoptFailed?.('t1', new Error('host connection lost'));
      throw new Error('readopt incomplete');
    });
    const secondReadopt = vi.fn(async (_hostId: string, hooks: Hooks) => {
      findTab.mockReturnValue('t1');
      hooks.reconcileBadge?.('cfg-1', 's1', snap());
    });

    const first = readoptHostSessions('cfg-1', firstReadopt as never, {
      retryDelaysMs: [],
      sleep: async () => undefined,
    });
    await firstStarted.promise;
    const second = readoptHostSessions('cfg-1', secondReadopt as never, {
      retryDelaysMs: [],
      sleep: async () => undefined,
    });

    releaseFirst.resolve();
    await Promise.all([first, second]);

    expect(secondReadopt).toHaveBeenCalledTimes(1);
    expect(writeTerminalNotice).not.toHaveBeenCalled();
  });

  it('反复闪断 → 同一 tab 只写一条提示(回归:连刷 5 遍)', async () => {
    for (let i = 0; i < 5; i++) await runReconnect(failingReadopt('t1'));
    expect(writeTerminalNotice).toHaveBeenCalledTimes(1);
    expect(writeTerminalNotice.mock.calls[0][0]).toBe('t1');
    expect(String(writeTerminalNotice.mock.calls[0][1])).toContain(
      'rpc timeout: session.attach',
    );
  });

  it('不同 tab 各说各的(去重按 tab,不是全局一条)', async () => {
    await runReconnect(failingReadopt('t1'));
    await runReconnect(failingReadopt('t2'));
    expect(writeTerminalNotice.mock.calls.map((c) => c[0])).toEqual(['t1', 't2']);
  });

  it('收养成功清位 → 此后再失败会再说一次(不是一次性闭嘴)', async () => {
    await runReconnect(failingReadopt('t1'));
    expect(writeTerminalNotice).toHaveBeenCalledTimes(1);

    findTab.mockReturnValue('t1');
    reconcileBadge('cfg-1', 's1', snap()); // 收养成功对账 → 清「已提示」位

    await runReconnect(failingReadopt('t1'));
    expect(writeTerminalNotice).toHaveBeenCalledTimes(2);
  });

  it('别的 tab 收养成功不替本 tab 清位', async () => {
    await runReconnect(failingReadopt('t1'));
    findTab.mockReturnValue('t2'); // 成功的是 t2
    reconcileBadge('cfg-1', 's2', snap('s2'));

    await runReconnect(failingReadopt('t1'));
    expect(writeTerminalNotice).toHaveBeenCalledTimes(1); // t1 仍闭嘴
  });

  it('中间尝试不提示的老语义不变(只有末次尝试带 onAdoptFailed)', async () => {
    const hooksSeen: Hooks[] = [];
    const readopt = vi.fn(async (_h: string, hooks: Hooks) => {
      hooksSeen.push(hooks);
      throw new Error('boom');
    });
    await runReconnect(readopt as never);
    expect(hooksSeen.map((h) => typeof h.onAdoptFailed)).toEqual([
      'undefined',
      'undefined',
      'function',
    ]);
  });
});
