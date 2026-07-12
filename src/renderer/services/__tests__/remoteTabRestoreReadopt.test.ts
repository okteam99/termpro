// @vitest-environment jsdom
// 远程 tab 布局恢复 × 收养全链路(用户规则 2026-07 端到端):
// hydrate 装载布局 → restoreRemoteTabLayouts(真 bind,经 mock hostRegistry)→
// readoptHost(真编排 + 真 store hooks):
//   收局 A:服务端已升级/重启(attach found=false)→ 原 tab 原位重 spawn,
//           名称/数量/顺序分毫不动,session.list 空 → 无额外 tab;
//   收局 B:服务端存活(attach found)→ 内容全量回放,session.list 同 sid
//           → 不重复重建 tab(adoptedSids 去重)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeClient = {
  reconnectable: true,
  supportsSessionResume: () => true,
  rpc: vi.fn(),
  attachPty: vi.fn((_sessionId: string, _listener: unknown) => () => {}),
  input: vi.fn(),
  resize: vi.fn(),
  ack: vi.fn(),
};

vi.mock('../hostRegistry', () => ({
  hostRegistry: {
    forHostId: vi.fn(() => fakeClient),
    forWorkspace: vi.fn(() => fakeClient),
    local: vi.fn(() => fakeClient),
  },
}));

import {
  readoptHost,
  __setInstForTest,
  __clearRegistryForTest,
  type TermInstance,
} from '../../terminal/terminalRegistry';
import {
  reconcileBadge,
  rebuildTabForSnapshot,
  restoreRemoteTabLayouts,
} from '../sessionReadopt';
import { useAppStore } from '../../state/store';
import type { SessionSnapshot, SessionAttachResult } from '../../../shared/protocol';

function makeFakeInst(): { inst: TermInstance; writes: string[] } {
  const writes: string[] = [];
  const term = {
    cols: 80,
    rows: 24,
    write: (d: string, cb?: () => void) => {
      writes.push(d);
      cb?.();
    },
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
    fit: {},
    search: {},
    webgl: null,
    barPin: {},
  } as unknown as TermInstance;
  return { inst, writes };
}

function liveSnap(sessionId: string, cwd: string): SessionSnapshot {
  return {
    sessionId,
    cwd,
    title: 'zsh',
    status: 'live',
    state: 'idle',
    quiet: false,
    altscreen: false,
    exitCode: null,
  };
}

/** 装置:远程 ws(0 tab)+ 双 tab 布局存档(均带 sessionId)+ 预注入 fake inst。 */
function setupRestoredHost(): { instA: TermInstance; instB: TermInstance; writesA: string[]; writesB: string[] } {
  useAppStore.setState({
    workspaces: [
      { id: 'rw1', name: 'rw1', root: '/proj', hostId: 'cfg-a', tabs: [], activeTabId: null },
    ],
    activeWorkspaceId: null,
    remoteTabLayouts: {
      rw1: {
        hostId: 'cfg-a',
        workspaceId: 'rw1',
        activeTabId: 'tb',
        tabs: [
          { id: 'ta', cwd: '/proj/api', customName: '后端', sessionId: 'sid-a' },
          { id: 'tb', cwd: '/proj/web', sessionId: 'sid-b' },
        ],
      },
    },
  });
  const { inst: instA, writes: writesA } = makeFakeInst();
  const { inst: instB, writes: writesB } = makeFakeInst();
  __setInstForTest('ta', instA);
  __setInstForTest('tb', instB);
  restoreRemoteTabLayouts('cfg-a'); // 真 bind(经 mock hostRegistry 命中 fakeClient)
  return { instA, instB, writesA, writesB };
}

beforeEach(() => {
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null, remoteTabLayouts: {} });
});

afterEach(() => {
  __clearRegistryForTest();
  fakeClient.rpc.mockReset();
  fakeClient.attachPty.mockClear();
});

describe('收局 A:服务端已升级/重启(session 全没了)', () => {
  it('原 tab 原位重 spawn:名称/数量/顺序不丢,不重建额外 tab', async () => {
    const { instA, instB } = setupRestoredHost();
    // 预绑定已生效
    expect(instA.sessionId).toBe('sid-a');
    expect(instB.sessionId).toBe('sid-b');

    fakeClient.rpc.mockImplementation(async (method: string) => {
      if (method === 'session.attach') {
        return { found: false } as SessionAttachResult;
      }
      if (method === 'session.list') return { sessions: [] };
      throw new Error(`unexpected rpc ${method}`);
    });
    const spawnNew = vi.fn(async (tabId: string, _cwd: string, _hostId: string) => {
      // 模拟 ensureSession 成功重 spawn
      const inst = tabId === 'ta' ? instA : instB;
      inst.sessionId = `fresh-${tabId}`;
    });

    await readoptHost('cfg-a', {
      reconcileBadge,
      rebuildTab: rebuildTabForSnapshot,
      spawnNew,
    });

    // 原位重 spawn:同 tabId + 存档 cwd
    expect(spawnNew.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['ta', '/proj/api'],
      ['tb', '/proj/web'],
    ]);
    // tab 名称/数量/顺序分毫不动
    const ws = useAppStore.getState().workspaces[0];
    expect(ws.tabs.map((t) => t.id)).toEqual(['ta', 'tb']);
    expect(ws.tabs[0].customName).toBe('后端');
    expect(ws.activeTabId).toBe('tb');
  });
});

describe('收局 B:服务端存活(收养回放)', () => {
  it('attach 全量回放内容;session.list 同 sid 不重复重建 tab', async () => {
    const { writesA, writesB } = setupRestoredHost();

    fakeClient.rpc.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'session.attach') {
        const sid = (params as { sessionId: string }).sessionId;
        return {
          found: true,
          full: true,
          baseOffset: 0,
          data: `replay-${sid}`,
          nextOffset: 100,
          snapshot: liveSnap(sid, sid === 'sid-a' ? '/proj/api' : '/proj/web'),
        } as SessionAttachResult;
      }
      if (method === 'session.list') {
        return { sessions: [liveSnap('sid-a', '/proj/api'), liveSnap('sid-b', '/proj/web')] };
      }
      throw new Error(`unexpected rpc ${method}`);
    });
    const spawnNew = vi.fn();

    await readoptHost('cfg-a', {
      reconcileBadge,
      rebuildTab: rebuildTabForSnapshot,
      spawnNew,
    });

    // 内容白赚回来(服务端没升级就不该丢)
    expect(writesA).toContain('replay-sid-a');
    expect(writesB).toContain('replay-sid-b');
    expect(spawnNew).not.toHaveBeenCalled();
    // 去重:session.list 的 sid 已被路径① 收养 → 不追加重复 tab
    const ws = useAppStore.getState().workspaces[0];
    expect(ws.tabs.map((t) => t.id)).toEqual(['ta', 'tb']);
  });
});
