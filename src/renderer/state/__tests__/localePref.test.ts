// @vitest-environment jsdom
// 语言偏好(用户需求 2026-07-13):切换即时生效(i18n locale + main 通知)+ ui 存档往返。
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { getLocale, setLocale, t } from '../../../shared/i18n';

function persisted(ui: PersistedStateV1['ui']): PersistedStateV1 {
  return { version: 1, activeWorkspaceId: null, workspaces: [], ui };
}

afterEach(() => {
  // 复位:vitest 下 i18n 初值钉死 en(见 i18n.ts 顶注),避免污染其他用例
  setLocale('en');
  useAppStore.setState({ localePref: 'system' });
  delete (window as unknown as Record<string, unknown>).termpro;
});

describe('setLocalePref', () => {
  it('显式 zh-CN:i18n 立即切中文(t() 即时换词)+ 通知 main', () => {
    const setAppLocale = vi.fn();
    (window as unknown as Record<string, unknown>).termpro = { setAppLocale };

    useAppStore.getState().setLocalePref('zh-CN');

    expect(useAppStore.getState().localePref).toBe('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    expect(t('Settings')).toBe('设置');
    expect(setAppLocale).toHaveBeenCalledWith('zh-CN');
  });

  it("切回 'system':locale 随 navigator.language(jsdom 恒 en-US → en)", () => {
    useAppStore.getState().setLocalePref('zh-CN');
    useAppStore.getState().setLocalePref('system');
    expect(useAppStore.getState().localePref).toBe('system');
    expect(getLocale()).toBe('en');
  });

  it('bridge 缺失(window.termpro 无 setAppLocale)不抛错', () => {
    expect(() => useAppStore.getState().setLocalePref('en')).not.toThrow();
    expect(useAppStore.getState().localePref).toBe('en');
  });
});

describe('ui 存档往返', () => {
  it("serialize:显式偏好写入 ui.locale;'system' 不写盘(缺省即随系统)", () => {
    useAppStore.setState({ workspaces: [], localePref: 'zh-CN', persistMode: 'v2' });
    const a1 = serialize(useAppStore.getState());
    expect(a1.ui?.locale).toBe('zh-CN');

    useAppStore.setState({ localePref: 'system' });
    const a2 = serialize(useAppStore.getState());
    expect(a2.ui && 'locale' in a2.ui).toBe(false);
  });

  it('hydrate 恢复 ui.locale=zh-CN 并即时生效;缺省回退 system 且不动当前 locale', () => {
    useAppStore.getState().hydrate([], persisted({ locale: 'zh-CN' }));
    expect(useAppStore.getState().localePref).toBe('zh-CN');
    expect(getLocale()).toBe('zh-CN');

    // 缺省:偏好回 'system',但不重设 locale(启动值已按 argv/navigator 定好)
    setLocale('en');
    useAppStore.getState().hydrate([], persisted({ sidebarWidth: 200 }));
    expect(useAppStore.getState().localePref).toBe('system');
    expect(getLocale()).toBe('en');
  });
});
