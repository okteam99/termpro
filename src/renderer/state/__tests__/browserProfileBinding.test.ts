// @vitest-environment jsdom
// 浏览器 Profile × 工作区绑定(阶段3):action 语义、快照对账剥离失效绑定、
// serialize/hydrate 往返(v2 + remoteTabs)、远程布局恢复带回绑定。

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
import type { PersistedStateV2, WorkspaceState } from '../store';
import { serialize } from '../persistence';
import type { BrowserProfile } from '../../../shared/browserProfile';

const PID = 'a'.repeat(32);
const PID2 = 'b'.repeat(32);

function profile(id: string, name = 'p'): BrowserProfile {
  return { id, name, createdAt: 1 };
}

function ws(
  id: string,
  hostId = 'local',
  browserProfileId?: string,
): WorkspaceState {
  return {
    id,
    name: id,
    root: `/${id}`,
    hostId,
    ...(browserProfileId ? { browserProfileId } : {}),
    tabs: [{ id: `${id}-t1`, title: 't', cwd: `/${id}` }],
    activeTabId: `${id}-t1`,
  };
}

beforeEach(() => {
  rpc.mockReset();
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    migrationFailureCount: 0,
    pendingWorkspaceIds: [],
    creatingWorkspace: false,
    transientNotice: null,
    remoteTabLayouts: {},
    browserProfiles: [],
    browserProfilesLoaded: false,
  });
});

describe('setWorkspaceBrowserProfile / setBrowserProfiles', () => {
  it('设置/清除绑定;"default" 与 undefined 都等于清除', () => {
    useAppStore.setState({ workspaces: [ws('w1')] });
    const s = () => useAppStore.getState();

    s().setWorkspaceBrowserProfile('w1', PID);
    expect(s().workspaces[0].browserProfileId).toBe(PID);

    s().setWorkspaceBrowserProfile('w1', 'default');
    expect(s().workspaces[0].browserProfileId).toBeUndefined();

    s().setWorkspaceBrowserProfile('w1', PID);
    s().setWorkspaceBrowserProfile('w1', undefined);
    expect(s().workspaces[0].browserProfileId).toBeUndefined();
  });

  it('快照落地:loaded 置位;失效绑定剥离,有效绑定保留', () => {
    useAppStore.setState({
      workspaces: [ws('w1', 'local', PID), ws('w2', 'local', PID2), ws('w3')],
    });
    useAppStore.getState().setBrowserProfiles([profile(PID)]);
    const s = useAppStore.getState();
    expect(s.browserProfilesLoaded).toBe(true);
    expect(s.workspaces[0].browserProfileId).toBe(PID); // 有效保留
    expect(s.workspaces[1].browserProfileId).toBeUndefined(); // 失效剥离(回默认)
    expect(s.workspaces[2].browserProfileId).toBeUndefined();
  });
});

describe('serialize / hydrate 往返', () => {
  it('v2 本机 ws + remoteTabs 都携带 browserProfileId(缺省不写盘)', () => {
    useAppStore.setState({
      workspaces: [ws('l1', 'local', PID), ws('l2'), ws('r1', 'cfg-1', PID2)],
      activeWorkspaceId: 'l1',
    });
    const archive = serialize(useAppStore.getState()) as PersistedStateV2;
    expect(archive.version).toBe(2);
    expect(archive.workspaces[0].browserProfileId).toBe(PID);
    expect('browserProfileId' in archive.workspaces[1]).toBe(false);
    expect(archive.remoteTabs?.[0].browserProfileId).toBe(PID2);
  });

  it('hydrate v2 带回绑定;"default"/非法值忽略', () => {
    const registry = [
      { id: 'l1', name: 'l1', root: '/l1' },
      { id: 'l2', name: 'l2', root: '/l2' },
    ];
    const archive: PersistedStateV2 = {
      version: 2,
      activeWorkspaceId: 'l1',
      workspaces: [
        {
          workspaceId: 'l1',
          browserProfileId: PID,
          activeTabId: 't1',
          tabs: [{ id: 't1', cwd: '/l1' }],
        },
        {
          workspaceId: 'l2',
          browserProfileId: 'default', // 显式 default = 缺省,不物化
          activeTabId: 't2',
          tabs: [{ id: 't2', cwd: '/l2' }],
        },
      ],
      migrationFailureCount: 0,
    };
    useAppStore.getState().hydrate(registry, archive);
    const s = useAppStore.getState();
    expect(s.workspaces[0].browserProfileId).toBe(PID);
    expect(s.workspaces[1].browserProfileId).toBeUndefined();
  });

  it('restoreWorkspaceTabs 一并恢复远程 ws 的 profile 绑定', () => {
    useAppStore.setState({
      workspaces: [{ ...ws('r1', 'cfg-1'), tabs: [], activeTabId: null }],
    });
    const ok = useAppStore
      .getState()
      .restoreWorkspaceTabs('r1', [{ id: 't1', cwd: '/r1' }], 't1', PID);
    expect(ok).toBe(true);
    expect(useAppStore.getState().workspaces[0].browserProfileId).toBe(PID);
  });
});
