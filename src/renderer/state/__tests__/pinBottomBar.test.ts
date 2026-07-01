// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { type PersistedState, useAppStore } from '../store';

function persisted(ui: PersistedState['ui']): PersistedState {
  return { version: 1, activeWorkspaceId: null, workspaces: [], ui };
}

describe('pinBottomBar 设置', () => {
  it('默认关闭(store create 初值)', () => {
    // 本测试文件模块隔离,store 尚未被改动 → 读到 create() 默认值
    expect(useAppStore.getState().pinBottomBar).toBe(false);
  });

  it('setPinBottomBar 切换', () => {
    useAppStore.getState().setPinBottomBar(true);
    expect(useAppStore.getState().pinBottomBar).toBe(true);
    useAppStore.getState().setPinBottomBar(false);
    expect(useAppStore.getState().pinBottomBar).toBe(false);
  });

  it('hydrate 恢复 ui.pinBottomBar=true', () => {
    useAppStore.setState({ pinBottomBar: false });
    useAppStore.getState().hydrate(persisted({ pinBottomBar: true }));
    expect(useAppStore.getState().pinBottomBar).toBe(true);
  });

  it('hydrate 时 ui 无 pinBottomBar 字段 → 回退默认 false', () => {
    useAppStore.setState({ pinBottomBar: true }); // 先置脏
    useAppStore.getState().hydrate(persisted({ sidebarWidth: 200 }));
    expect(useAppStore.getState().pinBottomBar).toBe(false);
  });
});
