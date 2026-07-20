// @vitest-environment jsdom
// 设置项 linkBrowserMode 持久化:缺省 'builtin' 不写盘;非默认写盘;
// hydrate 只认合法枚举(防篡改/降级存档),非法回落 'builtin'。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/hostClient', () => ({
  hostClient: {
    rpc: vi.fn(),
    onWorkspaceChanged: vi.fn(() => () => undefined),
  },
}));
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(() => null),
  bindRestoredSessionTab: vi.fn(),
}));

import { useAppStore } from '../store';
import type { PersistedStateV2 } from '../store';
import { serialize } from '../persistence';

function v2Ui(ui: Record<string, unknown>): PersistedStateV2 {
  return {
    version: 2,
    activeWorkspaceId: null,
    workspaces: [],
    migrationFailureCount: 0,
    ui,
  } as unknown as PersistedStateV2;
}

beforeEach(() => {
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    linkBrowserMode: 'builtin',
    builtinBrowserSurface: 'window',
    remoteTabLayouts: {},
  });
});

describe('linkBrowserMode 持久化', () => {
  it("缺省 'builtin' 不写盘;非默认写盘", () => {
    const a1 = serialize(useAppStore.getState());
    expect('linkBrowserMode' in (a1.ui ?? {})).toBe(false);

    useAppStore.setState({ linkBrowserMode: 'builtinForRemote' });
    const a2 = serialize(useAppStore.getState());
    expect(a2.ui?.linkBrowserMode).toBe('builtinForRemote');
  });

  it('hydrate:合法值恢复;非法值/缺省回落 builtin', () => {
    useAppStore.getState().hydrate([], v2Ui({ linkBrowserMode: 'system' }));
    expect(useAppStore.getState().linkBrowserMode).toBe('system');

    useAppStore.getState().hydrate([], v2Ui({ linkBrowserMode: 'garbage' }));
    expect(useAppStore.getState().linkBrowserMode).toBe('builtin');

    useAppStore.setState({ linkBrowserMode: 'system' });
    useAppStore.getState().hydrate([], v2Ui({}));
    expect(useAppStore.getState().linkBrowserMode).toBe('builtin');
  });
});

// 同一套规则(默认不写盘 + hydrate 枚举收窄),默认值是 'window'(独立窗口)
describe('builtinBrowserSurface 持久化', () => {
  it("缺省 'window' 不写盘;非默认写盘", () => {
    const a1 = serialize(useAppStore.getState());
    expect('builtinBrowserSurface' in (a1.ui ?? {})).toBe(false);

    useAppStore.setState({ builtinBrowserSurface: 'pane' });
    const a2 = serialize(useAppStore.getState());
    expect(a2.ui?.builtinBrowserSurface).toBe('pane');
  });

  it('hydrate:合法值恢复;非法值/缺省回落 window', () => {
    useAppStore.getState().hydrate([], v2Ui({ builtinBrowserSurface: 'pane' }));
    expect(useAppStore.getState().builtinBrowserSurface).toBe('pane');

    useAppStore.getState().hydrate([], v2Ui({ builtinBrowserSurface: 'garbage' }));
    expect(useAppStore.getState().builtinBrowserSurface).toBe('window');

    useAppStore.setState({ builtinBrowserSurface: 'pane' });
    useAppStore.getState().hydrate([], v2Ui({}));
    expect(useAppStore.getState().builtinBrowserSurface).toBe('window');
  });
});
