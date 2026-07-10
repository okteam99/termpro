// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../services/hostClient', async (importOriginal) => {
  // 保留真实 HostClient 类导出(hostRegistry.getOrCreateRemote 需要 new 它),
  // 只替换单例 hostClient 的行为供本地路径断言。
  const actual = await importOriginal<typeof import('../../services/hostClient')>();
  return {
    ...actual,
    hostClient: {
      rpc: (...args: unknown[]) => rpc(...args),
      onWorkspaceChanged: vi.fn(() => () => undefined),
    },
  };
});
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
}));

import { useAppStore } from '../store';
import type { WorkspaceState } from '../store';
import { disposeTerminal } from '../../terminal/terminalRegistry';
import { hostRegistry } from '../../services/hostRegistry';

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
    persistMode: 'v2',
    workspaces: [],
    activeWorkspaceId: null,
    creatingWorkspace: false,
    pendingWorkspaceIds: [],
    transientNotice: null,
  });
});

describe('workspace CRUD 等待确认 + 防重复提交(AC-2)', () => {
  it('test_create_workspace_updates_list_only_after_rpc_success (RPC-001)', async () => {
    rpc.mockResolvedValueOnce({ id: 'srv-1', name: 'proj', root: '/tmp/proj' });
    await useAppStore.getState().addWorkspace('/tmp/proj');
    const s = useAppStore.getState();
    expect(s.workspaces).toHaveLength(1);
    expect(s.workspaces[0]).toMatchObject({ id: 'srv-1', name: 'proj', root: '/tmp/proj' });
    expect(s.activeWorkspaceId).toBe('srv-1'); // 新建即选中
    expect(rpc).toHaveBeenCalledWith('workspace.create', {
      name: 'proj',
      root: '/tmp/proj',
    });
  });

  it('test_create_workspace_rpc_failure_leaves_list_unchanged_and_prompts (RPC-002)', async () => {
    rpc.mockRejectedValueOnce(new Error('registry write failed'));
    await useAppStore.getState().addWorkspace('/tmp/proj');
    const s = useAppStore.getState();
    expect(s.workspaces).toHaveLength(0); // 列表不变
    expect(s.transientNotice).toBeTruthy(); // 一次性轻量提示
    expect(s.creatingWorkspace).toBe(false); // 入口恢复
  });

  it('test_pending_rpc_disables_or_dedupes_repeat_submit (RPC-003)', async () => {
    let resolve!: (v: unknown) => void;
    rpc.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const first = useAppStore.getState().addWorkspace('/tmp/proj');
    // in-flight 期间再次触发 → 去重(不产生第二个并发 RPC)
    const second = useAppStore.getState().addWorkspace('/tmp/proj');
    expect(useAppStore.getState().creatingWorkspace).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);

    resolve({ id: 'srv-1', name: 'proj', root: '/tmp/proj' });
    await Promise.all([first, second]);
    // 结果返回后入口恢复可用
    expect(useAppStore.getState().creatingWorkspace).toBe(false);
    expect(useAppStore.getState().workspaces).toHaveLength(1);
  });

  it('test_rename_workspace_rpc_failure_leaves_name_unchanged (RPC-004)', async () => {
    useAppStore.setState({ workspaces: [ws('w1', 'old', '/a', ['t1'])] });
    rpc.mockRejectedValueOnce(new Error('update failed'));
    await useAppStore.getState().renameWorkspace('w1', 'new');
    const s = useAppStore.getState();
    expect(s.workspaces[0].name).toBe('old'); // 名称不变
    expect(s.transientNotice).toBeTruthy();
    expect(s.pendingWorkspaceIds).not.toContain('w1'); // 入口恢复
  });

  it('test_remove_workspace_rpc_failure_leaves_workspace_present (RPC-005)', async () => {
    useAppStore.setState({
      workspaces: [ws('w1', 'w1', '/a', ['pty-1'])],
      activeWorkspaceId: 'w1',
    });
    rpc.mockRejectedValueOnce(new Error('remove failed'));
    await useAppStore.getState().removeWorkspace('w1');
    const s = useAppStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1']); // 仍存在
    expect(disposeTerminal).not.toHaveBeenCalled(); // 终端实例未释放
    expect(s.transientNotice).toBeTruthy();
  });

  it('rename success syncs name from RPC result', async () => {
    useAppStore.setState({ workspaces: [ws('w1', 'old', '/a', ['t1'])] });
    rpc.mockResolvedValueOnce({ id: 'w1', name: 'new', root: '/a' });
    await useAppStore.getState().renameWorkspace('w1', 'new');
    expect(useAppStore.getState().workspaces[0].name).toBe('new');
  });

  it('remove success disposes tabs and removes workspace', async () => {
    useAppStore.setState({
      workspaces: [ws('w1', 'w1', '/a', ['pty-1']), ws('w2', 'w2', '/b', ['pty-2'])],
      activeWorkspaceId: 'w1',
    });
    rpc.mockResolvedValueOnce(undefined);
    await useAppStore.getState().removeWorkspace('w1');
    const s = useAppStore.getState();
    expect(disposeTerminal).toHaveBeenCalledWith('pty-1');
    expect(s.workspaces.map((w) => w.id)).toEqual(['w2']);
    expect(s.activeWorkspaceId).toBe('w2');
  });

  it('created workspace defaults to hostId=local (write path forHostId)', async () => {
    rpc.mockResolvedValueOnce({ id: 'srv-1', name: 'proj', root: '/tmp/proj' });
    await useAppStore.getState().addWorkspace('/tmp/proj');
    expect(useAppStore.getState().workspaces[0].hostId).toBe('local');
  });

  it('BL004-U-create-nohost-reject: unknown targetHostId (forHostId miss) rejects without RPC, no local write', async () => {
    await useAppStore.getState().addWorkspace('/tmp/proj', 'cfg-ghost');
    const s = useAppStore.getState();
    expect(s.workspaces).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(s.transientNotice).toBeTruthy();
    expect(s.creatingWorkspace).toBe(false);
  });

  it('remove/rename route through hostRegistry.forWorkspace(ws) keyed by ws.hostId', async () => {
    const forWorkspaceSpy = vi.spyOn(hostRegistry, 'forWorkspace');
    useAppStore.setState({ workspaces: [ws('w1', 'old', '/a', ['t1'])] });
    rpc.mockResolvedValueOnce({ id: 'w1', name: 'new', root: '/a' });
    await useAppStore.getState().renameWorkspace('w1', 'new');
    expect(forWorkspaceSpy).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'local' }));
    forWorkspaceSpy.mockRestore();
  });

  it('review E1: 远程已连(远程 ws 已在 store)时新建本机 ws → 本机 ws 仍是数组连续前缀', async () => {
    useAppStore.setState({
      workspaces: [
        ws('l0', 'l0', '/l0', ['t0']),
        ws('r0', 'r0', '/r0', [], 'cfg-1'), // 远程 ws 先于本机新建存在于数组中
      ],
      activeWorkspaceId: 'l0',
    });
    rpc.mockResolvedValueOnce({ id: 'l1', name: 'proj', root: '/tmp/proj' });
    await useAppStore.getState().addWorkspace('/tmp/proj'); // targetHostId 默认 'local'
    const s = useAppStore.getState();
    // 新本机 ws 插到首个远程 ws 之前,不是整体数组末尾([l0, l1, r0] 而非 [l0, r0, l1])
    expect(s.workspaces.map((w) => w.id)).toEqual(['l0', 'l1', 'r0']);
    const firstRemoteIdx = s.workspaces.findIndex((w) => w.hostId !== 'local');
    const localIds = s.workspaces.filter((w) => w.hostId === 'local').map((w) => w.id);
    // 本机 ws 集合恰好是数组前缀(下标 0..firstRemoteIdx-1)
    expect(s.workspaces.slice(0, firstRemoteIdx).map((w) => w.id)).toEqual(localIds);
  });

  it('review E1(对照): 无远程 ws 时新建本机 ws 仍 append 到末尾(零回归)', async () => {
    useAppStore.setState({ workspaces: [ws('l0', 'l0', '/l0', ['t0'])] });
    rpc.mockResolvedValueOnce({ id: 'l1', name: 'proj', root: '/tmp/proj' });
    await useAppStore.getState().addWorkspace('/tmp/proj');
    expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['l0', 'l1']);
  });

  it('review E1: 远程目标(targetHostId=configId)新建仍 append 到数组末尾', async () => {
    const remote = hostRegistry.getOrCreateRemote('cfg-2', 'ws://x');
    const remoteRpc = vi
      .spyOn(remote, 'rpc')
      .mockResolvedValue({ id: 'r1', name: 'rproj', root: '/home/r' });
    useAppStore.setState({ workspaces: [ws('l0', 'l0', '/l0', ['t0'])] });
    await useAppStore.getState().addWorkspace('/home/r', 'cfg-2');
    expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['l0', 'r1']);
    hostRegistry.drop('cfg-2');
    remoteRpc.mockRestore();
  });

  it('review A5: remove 目标 ws 已不在 store(竞态)→ 静默返回,不发 RPC(不兜底本机误发)', async () => {
    useAppStore.setState({ workspaces: [], pendingWorkspaceIds: [] });
    await useAppStore.getState().removeWorkspace('ghost-id');
    expect(rpc).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingWorkspaceIds).toEqual([]);
  });

  it('review A5: rename 目标 ws 已不在 store(竞态)→ 静默返回,不发 RPC(不兜底本机误发)', async () => {
    useAppStore.setState({ workspaces: [], pendingWorkspaceIds: [] });
    await useAppStore.getState().renameWorkspace('ghost-id', 'new-name');
    expect(rpc).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingWorkspaceIds).toEqual([]);
  });
});
