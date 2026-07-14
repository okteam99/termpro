// @vitest-environment jsdom
// 在用出口集合上报(标签级出口):collectExits 计算 + initExitsSync 变化才上报。
// ① 面板关闭 → 空集(webview 全卸载,远程 SOCKS 全回收);
// ② 显式 netHostId 优先,缺省回落所属机器;'local' 不上报;去重排序;
// ③ 集合不变不重复调 syncExits。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/store';
import type { WorkspaceState } from '../../state/store';
import { collectExits, initExitsSync } from '../exitsSync';

function ws(id: string, hostId: string, browserNets: (string | undefined)[]): WorkspaceState {
  return {
    id,
    name: id,
    root: `/r/${id}`,
    hostId,
    tabs: [
      {
        id: `${id}-t`,
        title: 't',
        cwd: `/r/${id}`,
        browser: {
          tabs: browserNets.map((n, i) => ({
            id: `${id}-b${i}`,
            url: 'https://x.dev',
            ...(n ? { netHostId: n } : {}),
          })),
          activeTabId: `${id}-b0`,
        },
      },
    ],
    activeTabId: `${id}-t`,
  };
}

const syncExits = vi.fn(async () => ({ exits: [] }));

beforeEach(() => {
  syncExits.mockClear();
  (window as unknown as { okwork: unknown }).okwork = { browserNet: { syncExits } };
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    browserPanelOpen: false,
  });
});

describe('collectExits', () => {
  it('面板关 → 空集;开 → 全窗格出口去重排序,缺省回落所属机器,local 不上报', () => {
    const state = {
      browserPanelOpen: false,
      workspaces: [
        ws('w1', 'cfg-b', [undefined, 'local', 'cfg-a']), // 缺省 → cfg-b;local 忽略
        ws('w2', 'local', [undefined, 'cfg-a']), // 缺省 → local 忽略;cfg-a 去重
      ],
    };
    expect(collectExits(state)).toEqual([]);
    expect(collectExits({ ...state, browserPanelOpen: true })).toEqual(['cfg-a', 'cfg-b']);
  });
});

describe('initExitsSync', () => {
  it('变化才上报:开面板上报集合;无关变化不重报;关面板报空集', () => {
    initExitsSync(); // 幂等单例;初始 panel 关 → 上报 []
    expect(syncExits).toHaveBeenCalledWith([]);
    const n0 = syncExits.mock.calls.length;

    useAppStore.setState({
      workspaces: [ws('w1', 'cfg-b', [undefined])],
      browserPanelOpen: true,
    });
    expect(syncExits).toHaveBeenLastCalledWith(['cfg-b']);

    // 无关变化(集合相同)不重报
    useAppStore.setState({ browserPanelWidth: 512 });
    expect(syncExits.mock.calls.length).toBe(n0 + 1);

    useAppStore.setState({ browserPanelOpen: false });
    expect(syncExits).toHaveBeenLastCalledWith([]);
  });
});
