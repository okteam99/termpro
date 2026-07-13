// @vitest-environment jsdom
// 本地 tab 持久化 sessionId(本地 host standalone 化里程碑 · 阶段B):
// serializeTab 统一写入会话收养键——本地/远程同构。
// ① 本地 tab 有活会话 → 存档带 sessionId;
// ② 无会话(未 spawn/已 dispose)→ 不写键(存档整洁,缺省即无);
// ③ 远程 live 路径经同一 serializeTab,sessionId 行为不回归(对照)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionByTab = new Map<string, string>();
vi.mock('../../services/hostClient', () => ({
  hostClient: {
    rpc: vi.fn(),
    onWorkspaceChanged: vi.fn(() => () => undefined),
  },
}));
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn((tabId: string) => sessionByTab.get(tabId) ?? null),
}));

import { useAppStore } from '../store';
import type { WorkspaceState } from '../store';
import { serialize } from '../persistence';

function ws(
  id: string,
  root: string,
  tabIds: string[],
  hostId = 'local',
): WorkspaceState {
  return {
    id,
    name: id,
    root,
    hostId,
    tabs: tabIds.map((t) => ({ id: t, title: t, cwd: root })),
    activeTabId: tabIds[0] ?? null,
  };
}

beforeEach(() => {
  sessionByTab.clear();
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    migrationFailureCount: 0,
    remoteTabLayouts: {},
  });
});

describe('serializeTab 会话收养键(本地/远程同构)', () => {
  it('本地 tab 有活会话 → 存档 tabs[].sessionId 写入', () => {
    sessionByTab.set('t1', 's1-alive');
    useAppStore.setState({
      workspaces: [ws('l1', '/l1', ['t1', 't2'])],
      activeWorkspaceId: 'l1',
    });
    const archive = serialize(useAppStore.getState());
    expect(archive.version).toBe(2);
    if (archive.version !== 2) throw new Error('expected v2 archive');
    expect(archive.workspaces[0].tabs[0].sessionId).toBe('s1-alive');
    // t2 无会话 → 键不写盘(而非 undefined 占位)
    expect('sessionId' in archive.workspaces[0].tabs[1]).toBe(false);
  });

  it('v1 fallback 分支同样写入(serializeTab 单源,两分支同构)', () => {
    sessionByTab.set('t1', 's1-alive');
    useAppStore.setState({
      persistMode: 'v1',
      workspaces: [ws('l1', '/l1', ['t1'])],
      activeWorkspaceId: 'l1',
    });
    const archive = serialize(useAppStore.getState());
    expect(archive.version).toBe(1);
    if (archive.version !== 1) throw new Error('expected v1 archive');
    expect(archive.workspaces[0].tabs[0].sessionId).toBe('s1-alive');
  });

  it('远程 live 路径 sessionId 不回归(对照:同一 serializeTab)', () => {
    sessionByTab.set('rt1', 's-remote');
    useAppStore.setState({
      workspaces: [ws('l1', '/l1', ['t1']), ws('r1', '/r1', ['rt1'], 'cfg-1')],
      activeWorkspaceId: 'l1',
    });
    const archive = serialize(useAppStore.getState());
    if (archive.version !== 2) throw new Error('expected v2 archive');
    expect(archive.remoteTabs).toHaveLength(1);
    expect(archive.remoteTabs![0].tabs[0].sessionId).toBe('s-remote');
  });
});
