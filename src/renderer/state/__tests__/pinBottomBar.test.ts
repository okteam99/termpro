// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { type PersistedState, useAppStore } from '../store';

function persisted(ui: PersistedState['ui']): PersistedState {
  return { version: 1, activeWorkspaceId: null, workspaces: [], ui };
}

describe('pinBottomBar 设置', () => {
  beforeEach(() => {
    useAppStore.setState({ pinBottomBar: true });
  });

  it('默认开启', () => {
    expect(useAppStore.getState().pinBottomBar).toBe(true);
  });

  it('setPinBottomBar 切换', () => {
    useAppStore.getState().setPinBottomBar(false);
    expect(useAppStore.getState().pinBottomBar).toBe(false);
    useAppStore.getState().setPinBottomBar(true);
    expect(useAppStore.getState().pinBottomBar).toBe(true);
  });

  it('hydrate 恢复 ui.pinBottomBar=false', () => {
    useAppStore.getState().hydrate(persisted({ pinBottomBar: false }));
    expect(useAppStore.getState().pinBottomBar).toBe(false);
  });

  it('hydrate 时 ui 无 pinBottomBar 字段 → 回退默认 true', () => {
    useAppStore.setState({ pinBottomBar: false }); // 先置脏
    useAppStore.getState().hydrate(persisted({ sidebarWidth: 200 }));
    expect(useAppStore.getState().pinBottomBar).toBe(true);
  });
});
