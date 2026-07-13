// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { type PersistedStateV1, useAppStore } from '../store';
import { serialize } from '../persistence';

function persisted(ui: PersistedStateV1['ui']): PersistedStateV1 {
  return { version: 1, activeWorkspaceId: null, workspaces: [], ui };
}

describe('filePanelCollapsed 文件面板折叠', () => {
  it('默认展开(store create 初值)', () => {
    expect(useAppStore.getState().filePanelCollapsed).toBe(false);
  });

  it('toggleFilePanelCollapsed 往返切换', () => {
    useAppStore.getState().toggleFilePanelCollapsed();
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
    useAppStore.getState().toggleFilePanelCollapsed();
    expect(useAppStore.getState().filePanelCollapsed).toBe(false);
  });

  it('hydrate 恢复 ui.filePanelCollapsed=true', () => {
    useAppStore.setState({ filePanelCollapsed: false });
    useAppStore.getState().hydrate([], persisted({ filePanelCollapsed: true }));
    expect(useAppStore.getState().filePanelCollapsed).toBe(true);
  });

  it('hydrate 时 ui 无该字段 → 回退默认 false', () => {
    useAppStore.setState({ filePanelCollapsed: true }); // 先置脏
    useAppStore.getState().hydrate([], persisted({ sidebarWidth: 200 }));
    expect(useAppStore.getState().filePanelCollapsed).toBe(false);
  });

  it('serialize:折叠才写盘,展开不写字段', () => {
    useAppStore.setState({ filePanelCollapsed: false });
    expect(serialize(useAppStore.getState()).ui).not.toHaveProperty('filePanelCollapsed');
    useAppStore.setState({ filePanelCollapsed: true });
    expect(serialize(useAppStore.getState()).ui).toMatchObject({ filePanelCollapsed: true });
  });
});
