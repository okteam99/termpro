// @vitest-environment jsdom
// Sidebar 机器分组折叠(用户需求 2026-07-13):toggle 语义 + ui 存档往返。
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(() => null),
}));
vi.mock('../../services/hostRegistry', () => ({
  hostRegistry: {
    local: () => ({ rpc: vi.fn(), onWorkspaceChanged: vi.fn(() => () => undefined) }),
    forHostId: vi.fn(() => null),
  },
}));

import { useAppStore } from '../store';
import type { PersistedStateV1 } from '../store';
import { serialize } from '../persistence';

function persisted(ui: PersistedStateV1['ui']): PersistedStateV1 {
  return { version: 1, activeWorkspaceId: null, workspaces: [], ui };
}

describe('机器分组折叠状态', () => {
  it('toggle:折叠 ↔ 展开,多机互不影响', () => {
    useAppStore.setState({ collapsedMachines: [] });
    const s = useAppStore.getState();
    s.toggleMachineCollapsed('local');
    s.toggleMachineCollapsed('cfg-a');
    expect(useAppStore.getState().collapsedMachines).toEqual(['local', 'cfg-a']);
    useAppStore.getState().toggleMachineCollapsed('local');
    expect(useAppStore.getState().collapsedMachines).toEqual(['cfg-a']);
  });

  it('serialize:非空写入 ui.collapsedMachines;空集不写(存档整洁)', () => {
    useAppStore.setState({ workspaces: [], collapsedMachines: ['cfg-a'], persistMode: 'v2' });
    const a1 = serialize(useAppStore.getState());
    expect(a1.ui?.collapsedMachines).toEqual(['cfg-a']);

    useAppStore.setState({ collapsedMachines: [] });
    const a2 = serialize(useAppStore.getState());
    expect(a2.ui && 'collapsedMachines' in a2.ui).toBe(false);
  });

  it('hydrate 恢复 ui.collapsedMachines;缺省回退空集', () => {
    useAppStore.setState({ collapsedMachines: ['stale'] });
    useAppStore.getState().hydrate([], persisted({ collapsedMachines: ['local', 'cfg-b'] }));
    expect(useAppStore.getState().collapsedMachines).toEqual(['local', 'cfg-b']);

    useAppStore.getState().hydrate([], persisted({ sidebarWidth: 200 }));
    expect(useAppStore.getState().collapsedMachines).toEqual([]);
  });
});
