// @vitest-environment jsdom
// 浏览器出口跟随活跃终端 tab 所属机器(用户指令 2026-07-14):
// ① 面板打开时对齐当前 tab 的 ws.hostId;② 打开状态下切 tab 重新对齐;
// ③ 停留同一 tab 不重复下发(手动改出口在该 tab 内生效);
// ④ 面板关闭不跟随,重开后对当前 tab 重新对齐。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/store';
import type { WorkspaceState } from '../../state/store';
import { initBrowserNetFollow } from '../browserNetFollow';

function ws(id: string, hostId: string, tabIds: string[]): WorkspaceState {
  return {
    id,
    name: id,
    root: `/r/${id}`,
    hostId,
    tabs: tabIds.map((t) => ({ id: t, title: t, cwd: `/r/${id}` })),
    activeTabId: tabIds[0] ?? null,
  };
}

const netSet = vi.fn(async (hostId: string) => ({ hostId }));

beforeEach(() => {
  netSet.mockClear();
  (window as unknown as { okwork: unknown }).okwork = { browserNet: { set: netSet } };
  useAppStore.setState({
    workspaces: [ws('w-remote', 'cfg-1', ['t-r1', 't-r2']), ws('w-local', 'local', ['t-l1'])],
    activeWorkspaceId: 'w-remote',
    browserPanelOpen: false,
  });
});

describe('initBrowserNetFollow', () => {
  it('面板打开 → 对齐活跃 tab 所属机器;切 tab 重对齐;同 tab 不重复;关面板重开再对齐', () => {
    initBrowserNetFollow(); // 幂等,重复调用无害(模块单例;首个用例完成全部时序断言)

    // 初始面板关闭 → 不下发
    expect(netSet).not.toHaveBeenCalled();

    // 打开面板 → 对齐 cfg-1
    useAppStore.setState({ browserPanelOpen: true });
    expect(netSet).toHaveBeenLastCalledWith('cfg-1');
    const callsAfterOpen = netSet.mock.calls.length;

    // 同 tab 的无关 store 变化 → 不重复下发(手动改出口不被抢)
    useAppStore.setState({ browserPanelWidth: 500 });
    expect(netSet.mock.calls.length).toBe(callsAfterOpen);

    // 同 ws 内切到另一 tab → 重新对齐(仍 cfg-1,但按 tab 粒度重下发)
    useAppStore.setState({
      workspaces: useAppStore
        .getState()
        .workspaces.map((w) => (w.id === 'w-remote' ? { ...w, activeTabId: 't-r2' } : w)),
    });
    expect(netSet).toHaveBeenLastCalledWith('cfg-1');
    expect(netSet.mock.calls.length).toBe(callsAfterOpen + 1);

    // 切到本机 ws 的 tab → 对齐 local
    useAppStore.setState({ activeWorkspaceId: 'w-local' });
    expect(netSet).toHaveBeenLastCalledWith('local');

    // 关面板 → 不跟随;重开(同一 tab)→ 重新对齐
    const beforeClose = netSet.mock.calls.length;
    useAppStore.setState({ browserPanelOpen: false });
    useAppStore.setState({ activeWorkspaceId: 'w-remote' }); // 关着时切 tab 不下发
    expect(netSet.mock.calls.length).toBe(beforeClose);
    useAppStore.setState({ browserPanelOpen: true });
    expect(netSet).toHaveBeenLastCalledWith('cfg-1');
  });
});
