// @vitest-environment jsdom
// 修 E4:workspace.create 写操作走 hostRegistry.forHostId(写原语),未命中(该机已 drop/断线)
// 必须拒绝创建 + 提示,绝不静默回落本机 hostClient 写入(防远程建仓落成假本机项目)。
// TC BL004-U-create-nohost-reject。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
}));

import { useAppStore } from '../store';
import { hostRegistry } from '../../services/hostRegistry';
import { hostClient } from '../../services/hostClient';

beforeEach(() => {
  useAppStore.setState({
    persistMode: 'v2',
    workspaces: [],
    activeWorkspaceId: null,
    creatingWorkspace: false,
    pendingWorkspaceIds: [],
    transientNotice: null,
  });
});

describe('BL004-U-create-nohost-reject', () => {
  it('目标机从未连接(hostRegistry 无该 configId)→ forHostId 未命中 → 拒绝 · 不落本机', async () => {
    const localRpc = vi.spyOn(hostClient, 'rpc');
    await useAppStore.getState().addWorkspace('/home/liam/proj', 'cfg-never-connected');

    const s = useAppStore.getState();
    expect(s.workspaces).toHaveLength(0); // 本机注册表快照前后不变(无孤儿本机 ws)
    expect(localRpc).not.toHaveBeenCalled(); // 未回落本机 hostClient
    expect(s.transientNotice).toBeTruthy(); // 用户提示
    expect(s.creatingWorkspace).toBe(false); // 入口不卡死
    localRpc.mockRestore();
  });

  it('目标机曾连接后被 drop(断线/删除)→ 之后 forHostId 未命中 → 拒绝 · 不落本机', async () => {
    hostRegistry.getOrCreateRemote('cfg-1', 'ws://127.0.0.1:1234');
    hostRegistry.drop('cfg-1'); // 模拟断线/删除

    const localRpc = vi.spyOn(hostClient, 'rpc');
    await useAppStore.getState().addWorkspace('/home/liam/proj', 'cfg-1');

    const s = useAppStore.getState();
    expect(s.workspaces).toHaveLength(0);
    expect(localRpc).not.toHaveBeenCalled();
    expect(s.transientNotice).toBeTruthy();
    localRpc.mockRestore();
  });

  it('目标机仍在线(已 getOrCreateRemote)→ forHostId 命中该远程 client,不经本地 hostClient', async () => {
    const remote = hostRegistry.getOrCreateRemote('cfg-2', 'ws://127.0.0.1:1234');
    const remoteRpc = vi
      .spyOn(remote, 'rpc')
      .mockResolvedValue({ id: 'srv-ae', name: 'proj', root: '/home/liam/proj' });
    const localRpc = vi.spyOn(hostClient, 'rpc');

    await useAppStore.getState().addWorkspace('/home/liam/proj', 'cfg-2');

    expect(remoteRpc).toHaveBeenCalledWith('workspace.create', {
      name: 'proj',
      root: '/home/liam/proj',
    });
    expect(localRpc).not.toHaveBeenCalled(); // 本地单例零调用
    const s = useAppStore.getState();
    expect(s.workspaces[0]).toMatchObject({ id: 'srv-ae', hostId: 'cfg-2' });

    hostRegistry.drop('cfg-2');
    remoteRpc.mockRestore();
    localRpc.mockRestore();
  });
});
