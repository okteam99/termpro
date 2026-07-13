// @vitest-environment jsdom
// PENDING-006 落地测试:服务端会话收养三件套——
// ① mapSessionCwdToWorkspace:cwd→workspace 最长 root 前缀匹配(纯函数);
// ② rebuildTabForSnapshot + store.adoptSessionTab:真 store 建 tab 回传 tabId、
//    不抢已有 activeTabId、无归属 workspace 时跳过;
// ③ readoptHostSessions:同 configId 并发调用串行化(防双重建)+ 失败不断链。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mapSessionCwdToWorkspace,
  readoptHostSessions,
  rebuildTabForSnapshot,
} from '../sessionReadopt';
import { useAppStore, type WorkspaceState } from '../../state/store';
import type { SessionSnapshot } from '../../../shared/protocol';

function ws(over: Partial<WorkspaceState> & Pick<WorkspaceState, 'id' | 'root'>): WorkspaceState {
  return {
    name: over.id,
    hostId: 'cfg-1',
    tabs: [],
    activeTabId: null,
    ...over,
  };
}

function snap(over: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    sessionId: 's1',
    cwd: '/home/liam/proj',
    title: 'zsh',
    status: 'live',
    state: 'idle',
    quiet: false,
    altscreen: false,
    exitCode: null,
    ...over,
  };
}

beforeEach(() => {
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null });
});

afterEach(() => {
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null });
});

describe('mapSessionCwdToWorkspace:cwd→workspace 归属(最长 root 前缀)', () => {
  const workspaces = [
    ws({ id: 'w1', root: '/home/liam/proj' }),
    ws({ id: 'w2', root: '/home/liam/proj/sub' }),
    ws({ id: 'w3', root: '/home/liam/other', hostId: 'cfg-2' }),
  ];

  it('cwd === root 精确命中', () => {
    expect(
      mapSessionCwdToWorkspace(workspaces, 'cfg-1', '/home/liam/proj')?.id,
    ).toBe('w1');
  });

  it('cwd 在 root 子目录内命中;嵌套 root 取最长(worktree 场景不误归父仓)', () => {
    expect(
      mapSessionCwdToWorkspace(workspaces, 'cfg-1', '/home/liam/proj/sub/dir')?.id,
    ).toBe('w2');
  });

  it('前缀必须落在路径边界:/home/liam/proj2 不归 /home/liam/proj', () => {
    expect(
      mapSessionCwdToWorkspace(workspaces, 'cfg-1', '/home/liam/proj2'),
    ).toBeNull();
  });

  it('只匹配同 hostId 的 workspace(不跨机误归)', () => {
    expect(
      mapSessionCwdToWorkspace(workspaces, 'cfg-1', '/home/liam/other/x'),
    ).toBeNull();
    expect(
      mapSessionCwdToWorkspace(workspaces, 'cfg-2', '/home/liam/other/x')?.id,
    ).toBe('w3');
  });

  it('root 带尾斜杠时仍正确匹配', () => {
    const withSlash = [ws({ id: 'w4', root: '/srv/app/' })];
    expect(mapSessionCwdToWorkspace(withSlash, 'cfg-1', '/srv/app')?.id).toBe('w4');
    expect(mapSessionCwdToWorkspace(withSlash, 'cfg-1', '/srv/app/x')?.id).toBe('w4');
  });

  it('无归属(cwd 曾回退家目录/项目已删)→ null', () => {
    expect(mapSessionCwdToWorkspace(workspaces, 'cfg-1', '/root')).toBeNull();
  });
});

describe('rebuildTabForSnapshot → store.adoptSessionTab(真 store)', () => {
  it('重建 tab 落到归属 workspace,回传 tabId;cwd/processName 来自快照', () => {
    useAppStore.setState({
      workspaces: [ws({ id: 'w1', root: '/home/liam/proj' })],
    });

    const tabId = rebuildTabForSnapshot(
      'cfg-1',
      snap({ cwd: '/home/liam/proj/api', title: 'vitest' }),
    );

    expect(tabId).toBeTruthy();
    const w = useAppStore.getState().workspaces[0];
    expect(w.tabs).toHaveLength(1);
    expect(w.tabs[0].id).toBe(tabId);
    expect(w.tabs[0].cwd).toBe('/home/liam/proj/api');
    expect(w.tabs[0].processName).toBe('vitest');
    // 重启后 0-tab workspace:首个收养 tab 落焦
    expect(w.activeTabId).toBe(tabId);
  });

  it('不抢焦点:workspace 已有 activeTabId 时收养 tab 只追加不夺焦', () => {
    const existing = { id: 't0', title: 'zsh', cwd: '/home/liam/proj' };
    useAppStore.setState({
      workspaces: [
        ws({
          id: 'w1',
          root: '/home/liam/proj',
          tabs: [existing],
          activeTabId: 't0',
        }),
      ],
    });

    const tabId = rebuildTabForSnapshot('cfg-1', snap({}));

    const w = useAppStore.getState().workspaces[0];
    expect(w.tabs.map((t) => t.id)).toEqual(['t0', tabId]);
    expect(w.activeTabId).toBe('t0');
  });

  it('cwd 无归属 workspace → null(跳过,不建 tab、不动 store)', () => {
    useAppStore.setState({
      workspaces: [ws({ id: 'w1', root: '/home/liam/proj' })],
    });

    expect(rebuildTabForSnapshot('cfg-1', snap({ cwd: '/tmp/x' }))).toBeNull();
    expect(useAppStore.getState().workspaces[0].tabs).toHaveLength(0);
  });

  it('adoptSessionTab 对不存在的 workspaceId 返 null(不抛)', () => {
    expect(
      useAppStore.getState().adoptSessionTab('w-missing', '/x'),
    ).toBeNull();
  });
});

describe('readoptHostSessions:同 configId 串行化', () => {
  it('并发两次调用串行执行(第二轮等第一轮完成,防双重建)', async () => {
    const order: string[] = [];
    let release1!: () => void;
    const gate1 = new Promise<void>((r) => (release1 = r));
    const fake = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push('start-1');
        await gate1;
        order.push('end-1');
      })
      .mockImplementationOnce(async () => {
        order.push('start-2');
      });

    const p1 = readoptHostSessions('cfg-1', fake);
    const p2 = readoptHostSessions('cfg-1', fake);
    await Promise.resolve(); // 让第一轮启动
    expect(order).toEqual(['start-1']); // 第二轮尚未进入
    release1();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['start-1', 'end-1', 'start-2']);
  });

  it('第一轮失败只 WARN,不断链:第二轮照常执行', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await readoptHostSessions('cfg-1', fake);
    await readoptHostSessions('cfg-1', fake);

    expect(fake).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('drop 竞态回归网(review P2-1):收养在途时该 host 全部 ws 被 drop → rebuild 现读 store 落空,不重建 tab', async () => {
    useAppStore.setState({
      workspaces: [ws({ id: 'w1', root: '/home/liam/proj' })],
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const results: Array<string | null> = [];
    // fake 模拟 readoptHost 在途(session.list 已发未回),放行后走真 rebuildTab hook——
    // 若有人把 rebuildTabForSnapshot 改成缓存 workspaces 快照而非现读 getState(),本测即红。
    const fake = vi.fn(
      async (
        _configId: string,
        hooks?: { rebuildTab?: (h: string, s: SessionSnapshot) => string | null },
      ) => {
        await gate;
        results.push(hooks?.rebuildTab?.('cfg-1', snap({})) ?? null);
      },
    );

    const p = readoptHostSessions('cfg-1', fake as never);
    // 在途期间 drop:stopRemoteWorkspaceSync 的 ② dropHostWorkspaces 效果(该 host ws 全移除)
    useAppStore.setState({ workspaces: [] });
    release();
    await p;

    expect(results).toEqual([null]); // ws 已不在 → 跳过,不把 tab 重建回已 drop 的 host 视图
    expect(useAppStore.getState().workspaces).toHaveLength(0);
  });

  it('不同 configId 互不阻塞', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = vi.fn(async () => {
      order.push('slow-start');
      await gate;
    });
    const fast = vi.fn(async () => {
      order.push('fast');
    });

    const p1 = readoptHostSessions('cfg-1', slow);
    const p2 = readoptHostSessions('cfg-2', fast);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toContain('fast'); // cfg-2 不等 cfg-1
    release();
    await Promise.all([p1, p2]);
  });
});
