// @vitest-environment jsdom
// 修 E3:v1 fallback 下远程 ws「视图态存在但不落盘 · CRUD 拒绝」的同类隔离——
// v2 已要求 serialize 过滤远程 ws(D-6),v1 fallback 路径同样必须过滤,否则下次
// runMigration 会把远程 ws 逐条 workspace.create 在本机重建(远程项目变成假本机项目)。
// TC BL004-U-serialize-v1-noremote / BL004-U-v1-remote-crud-reject。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../services/hostClient', () => ({
  hostClient: {
    rpc: (...args: unknown[]) => rpc(...args),
    onWorkspaceChanged: vi.fn(() => () => undefined),
  },
}));
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(() => null),
}));

import { useAppStore } from '../store';
import type { WorkspaceState } from '../store';
import { serialize } from '../persistence';
import { disposeTerminal } from '../../terminal/terminalRegistry';

function ws(
  id: string,
  name: string,
  root: string,
  tabIds: string[],
  hostId = 'local',
): WorkspaceState {
  return {
    id,
    name,
    root,
    hostId,
    tabs: tabIds.map((t) => ({ id: t, title: t, cwd: root })),
    activeTabId: tabIds[0] ?? null,
  };
}

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(disposeTerminal).mockClear();
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    migrationFailureCount: 0,
    pendingWorkspaceIds: [],
    creatingWorkspace: false,
    transientNotice: null,
  });
});

describe('BL004-U-serialize-v1-noremote: serialize v1+v2 双分支都过滤远程 ws', () => {
  it('v1 fallback serialize 只含本机 ws,远程 ws 不写入存档', () => {
    useAppStore.setState({
      persistMode: 'v1',
      workspaces: [
        ws('l1', 'L1', '/l1', ['t1']),
        ws('l2', 'L2', '/l2', ['t2']),
        ws('r1', 'R1', '/r1', ['s1'], 'cfg-1'),
      ],
      activeWorkspaceId: 'l1',
    });
    const archive = serialize(useAppStore.getState());
    expect(archive.version).toBe(1);
    if (archive.version !== 1) throw new Error('expected v1 archive');
    expect(archive.workspaces.map((w) => w.id)).toEqual(['l1', 'l2']);
  });

  it('v2 分支同样过滤远程 ws(对照 · 防回归)', () => {
    useAppStore.setState({
      persistMode: 'v2',
      workspaces: [ws('l1', 'L1', '/l1', ['t1']), ws('r1', 'R1', '/r1', ['s1'], 'cfg-1')],
      activeWorkspaceId: 'l1',
    });
    const archive = serialize(useAppStore.getState());
    expect(archive.version).toBe(2);
    expect(archive.workspaces).toHaveLength(1);
    expect(
      (archive.workspaces[0] as { workspaceId: string }).workspaceId,
    ).toBe('l1');
  });

  it('activeWorkspaceId 指向被过滤的远程 ws → coerce 到首个本机 ws', () => {
    useAppStore.setState({
      persistMode: 'v2',
      workspaces: [ws('l1', 'L1', '/l1', ['t1']), ws('r1', 'R1', '/r1', ['s1'], 'cfg-1')],
      activeWorkspaceId: 'r1', // 远程 active
    });
    const archive = serialize(useAppStore.getState());
    expect(archive.activeWorkspaceId).toBe('l1'); // coerce 到首个本机
  });

  it('activeWorkspaceId 指向远程 ws 且无本机 ws → coerce 到 null', () => {
    useAppStore.setState({
      persistMode: 'v1',
      workspaces: [ws('r1', 'R1', '/r1', ['s1'], 'cfg-1')],
      activeWorkspaceId: 'r1',
    });
    const archive = serialize(useAppStore.getState());
    expect(archive.activeWorkspaceId).toBeNull();
    expect(archive.workspaces).toEqual([]);
  });
});

describe('BL004-U-v1-remote-crud-reject: v1 fallback 下远程 CRUD 拒绝 · 不落本机', () => {
  it('create: v1 + targetHostId 非 local → 拒绝,不发 RPC', async () => {
    useAppStore.setState({ persistMode: 'v1' });
    await useAppStore.getState().addWorkspace('/home/liam/proj', 'cfg-1');
    const s = useAppStore.getState();
    expect(s.workspaces).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(s.transientNotice).toBeTruthy();
  });

  it('remove: v1 模式下对(视图态中存在的)远程 ws 发起删除 → 拒绝,不本地回收', async () => {
    useAppStore.setState({
      persistMode: 'v1',
      workspaces: [ws('r1', 'R1', '/r1', ['s1'], 'cfg-1')],
      activeWorkspaceId: 'r1',
    });
    await useAppStore.getState().removeWorkspace('r1');
    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['r1']); // 未被回收
    expect(disposeTerminal).not.toHaveBeenCalled();
    expect(s.transientNotice).toBeTruthy();
  });

  it('rename: v1 模式下对远程 ws 发起改名 → 拒绝,name 不变', async () => {
    useAppStore.setState({
      persistMode: 'v1',
      workspaces: [ws('r1', 'R1', '/r1', ['s1'], 'cfg-1')],
      activeWorkspaceId: 'r1',
    });
    await useAppStore.getState().renameWorkspace('r1', 'renamed');
    const s = useAppStore.getState();
    expect(s.workspaces[0].name).toBe('R1'); // 未改名
    expect(s.transientNotice).toBeTruthy();
  });

  it('v1 模式下本机 ws 的 remove/rename 仍照常本地同步(不受远程拒绝逻辑影响)', async () => {
    useAppStore.setState({
      persistMode: 'v1',
      workspaces: [ws('l1', 'L1', '/l1', ['t1'])],
      activeWorkspaceId: 'l1',
    });
    await useAppStore.getState().renameWorkspace('l1', 'renamed');
    expect(useAppStore.getState().workspaces[0].name).toBe('renamed');
  });
});
