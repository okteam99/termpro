// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import React from 'react';

expect.extend(matchers);

import { SettingsEntry } from '../SettingsEntry';
import { useAppStore } from '../../state/store';

// hostClient touches IPC — mock it so the real Sidebar can mount in jsdom (T-009).
vi.mock('../../services/hostClient', () => ({
  hostClient: { info: { homedir: '/Users/test' } },
}));

import { Sidebar } from '../Sidebar';

const noop = () => undefined;

// Helper: set up window.okwork mock for the renderer bridge.
function mockOkwork(overrides: { version?: string; devChannel?: boolean } = {}) {
  Object.defineProperty(window, 'okwork', {
    value: {
      version: overrides.version ?? '0.3.12',
      devChannel: overrides.devChannel ?? false,
      platform: 'darwin',
      smoke: false,
      locale: '',
      setAppLocale: vi.fn(),
      requestHostPort: vi.fn(),
      pickDirectory: vi.fn(),
      onMenu: vi.fn(noop),
      smokeOk: vi.fn(),
      storeGet: vi.fn(),
      storeSet: vi.fn(),
      setDockBadge: vi.fn(),
      focusWindow: vi.fn(),
      onUpdateEvent: vi.fn(noop),
      installUpdate: vi.fn(),
      openViewerWindow: vi.fn(),
      showTerminalContextMenu: vi.fn(),
      showTabContextMenu: vi.fn(),
      clipboardWriteText: vi.fn(),
      clipboardReadText: vi.fn(),
      openExternal: vi.fn(),
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
      onViewerAddTab: vi.fn(noop),
      // BL-003:RemoteHostsPage 挂载时读取(list/onEvent),其余方法按需 mock
      remoteHost: {
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
        capabilities: vi.fn().mockResolvedValue({ encryptionAvailable: true }),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onEvent: vi.fn(() => noop),
      },
    },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).okwork;
});

function openAccountMenu() {
  fireEvent.click(screen.getByTitle('Login'));
}

function openSettingsFromMenu() {
  openAccountMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
}

// --- AC-1: Login label, no login form ---
describe('settingsEntry_renders_avatar_placeholder_and_login_label', () => {
  it('renders Login label and avatar container', () => {
    mockOkwork();
    render(<SettingsEntry />);

    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).toBeNull();
    const avatar = document.querySelector('.settings-avatar');
    expect(avatar).toBeInTheDocument();

    openAccountMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });
});

// --- AC-2: account menu has Settings / About / Log out only ---
describe('settingsEntry_logout_shows_not_signed_in', () => {
  it('keeps the menu open and shows Not signed in', () => {
    mockOkwork();
    render(<SettingsEntry />);
    openAccountMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });
});

describe('settingsEntry_toggles_account_menu', () => {
  it('shows Settings, About, Log out and hides on second click', () => {
    mockOkwork();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Login');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(entryBtn);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(3);
    expect(menuItems[0]).toHaveTextContent('Settings');
    expect(menuItems[1]).toHaveTextContent('About');
    expect(menuItems[2]).toHaveTextContent('Log out');
    expect(screen.queryByRole('menuitem', { name: /Language/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Browser Settings' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Remote Hosts' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();

    fireEvent.click(entryBtn);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('settingsEntry_pin_bottom_bar_lives_in_general_panel', () => {
  it('toggles pin from General, not from the account menu', () => {
    mockOkwork();
    useAppStore.setState({ pinBottomBar: true });
    render(<SettingsEntry />);

    openSettingsFromMenu();
    expect(screen.queryByRole('menu')).toBeNull();
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveTextContent('Pin bottom bar');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    expect(useAppStore.getState().pinBottomBar).toBe(false);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(document.querySelector('.settings-panel')).toBeInTheDocument();

    useAppStore.setState({ pinBottomBar: true });
  });
});

// --- 语言切换:Language 项弹独立 modal 三选,选中即时换语言(弹层保持打开)---
describe('settingsEntry_language_switcher', () => {
  it('opens the Language modal and switches UI language + notifies main on pick', async () => {
    const { setLocale } = await import('../../../shared/i18n');
    mockOkwork();
    useAppStore.setState({ localePref: 'system' });
    render(<SettingsEntry />);

    openSettingsFromMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const options = screen.getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual([
      '✓SystemFollow the system language.',
      'English',
      '简体中文',
    ]);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: /简体中文/ }));

    // store + main 通知 + 弹层文案即时换中文(弹层保持打开,让用户当场看到变化)
    expect(useAppStore.getState().localePref).toBe('zh-CN');
    expect(window.okwork.setAppLocale).toHaveBeenCalledWith('zh-CN');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('界面语言')).toBeInTheDocument();
    expect(
      within(screen.getByRole('radio', { name: /简体中文/ })).getByText('✓'),
    ).toBeInTheDocument();

    // 复位共享单例:i18n 回 en,store 回 system
    setLocale('en');
    useAppStore.setState({ localePref: 'system' });
  });

  it('closes via close button / Esc / backdrop and restores focus (AC-6 parity)', () => {
    mockOkwork();
    useAppStore.setState({ localePref: 'system' });
    render(<SettingsEntry />);
    const entryBtn = screen.getByTitle('Login');

    for (const close of [
      () => fireEvent.click(screen.getByTitle('Close')),
      () => fireEvent.keyDown(document, { key: 'Escape' }),
      () => fireEvent.mouseDown(document.querySelector('.settings-panel__backdrop')!),
    ]) {
      entryBtn.focus();
      openSettingsFromMenu();
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

      close();
      expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
      expect(document.activeElement).toBe(entryBtn);
    }
  });
});

// --- 浏览器设置:Language 同款独立 modal,两组单选即时写 store ---
describe('settingsEntry_browser_settings_modal', () => {
  it('opens the Browser Settings modal and writes both settings to the store', () => {
    mockOkwork();
    useAppStore.setState({ linkBrowserMode: 'builtin', builtinBrowserSurface: 'window' });
    render(<SettingsEntry />);

    openSettingsFromMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Browser Settings' }));
    expect(screen.queryByRole('menu')).toBeNull();

    // 两组 radiogroup:链接打开方式(3 项)+ 内置浏览器默认打开方式(2 项)
    const groups = screen.getAllByRole('radiogroup');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getAllByRole('radio')).toHaveLength(3);
    expect(within(groups[1]).getAllByRole('radio')).toHaveLength(2);

    fireEvent.click(screen.getByRole('radio', { name: /System browser/ }));
    expect(useAppStore.getState().linkBrowserMode).toBe('system');

    fireEvent.click(screen.getByRole('radio', { name: /In the app panel/ }));
    expect(useAppStore.getState().builtinBrowserSurface).toBe('pane');

    // 复位共享单例
    useAppStore.setState({ linkBrowserMode: 'builtin', builtinBrowserSurface: 'window' });
  });
});

// --- T-005: menu closes on outside click and Esc (AC-3) ---
describe('settingsEntry_menu_closes_on_outside_click_and_esc', () => {
  it('closes menu on outside mousedown', () => {
    mockOkwork();
    render(
      <div>
        <SettingsEntry />
        <div data-testid="outside">outside</div>
      </div>,
    );

    fireEvent.click(screen.getByTitle('Login'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Outside mousedown
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes menu on Esc key', () => {
    mockOkwork();
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Login'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- T-006: About click opens modal and closes menu (AC-4) ---
describe('settingsEntry_about_click_opens_modal_and_closes_menu', () => {
  it('clicking About opens the About modal and closes the menu', () => {
    mockOkwork({ version: '0.3.12' });
    render(<SettingsEntry />);

    // Open menu
    fireEvent.click(screen.getByTitle('Login'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Click About
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    // Modal is open
    expect(screen.getByText('OkWork')).toBeInTheDocument();

    // Menu is closed
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- T-006b: no menu behind open about modal (AC-4 mutual exclusion) ---
describe('settingsEntry_no_menu_behind_open_about_modal', () => {
  it('menu is not present when about modal is open', () => {
    mockOkwork();
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Login'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    // Modal is open, menu is gone
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('OkWork')).toBeInTheDocument();
  });
});

// --- T-007a: About modal shows version from bridge (AC-5) ---
describe('aboutModal_shows_version_from_bridge', () => {
  it('reads version from window.okwork.version and displays it', () => {
    mockOkwork({ version: '0.3.12' });
    render(<SettingsEntry />);

    // Open menu → click About
    fireEvent.click(screen.getByTitle('Login'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('Version 0.3.12')).toBeInTheDocument();
  });
});

// --- T-007b: About modal shows fallback when version is empty (AC-8) ---
describe('aboutModal_shows_unknown_fallback_when_version_empty', () => {
  it('shows 版本未知 when window.okwork.version is empty', () => {
    mockOkwork({ version: '' });
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Login'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('Version unknown')).toBeInTheDocument();
  });

  it('shows 版本未知 when window.okwork is undefined (bridge absent)', () => {
    // No mockOkwork() — afterEach deletes window.okwork so it is absent here.
    render(<SettingsEntry />);
    fireEvent.click(screen.getByTitle('Login'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('Version unknown')).toBeInTheDocument();
  });
});

// --- T-008: modal closes via Esc / backdrop / button and restores focus (AC-6) ---
// AC-6 requires focus return for ALL three close mechanisms; all three route through
// handleCloseAbout, so each sub-test focuses the entry, opens, closes, and asserts return.
describe('aboutModal_closes_via_esc_backdrop_button_and_restores_focus', () => {
  it('closes via close button and restores focus', () => {
    mockOkwork();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Login');
    entryBtn.focus();

    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    // Modal open
    const closeBtn = screen.getByTitle('Close');
    expect(closeBtn).toBeInTheDocument();

    fireEvent.click(closeBtn);

    // Modal closed
    expect(screen.queryByText('OkWork')).toBeNull();
    // Focus restored to the Settings entry
    expect(document.activeElement).toBe(entryBtn);
  });

  it('closes via Esc key and restores focus', () => {
    mockOkwork();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Login');
    entryBtn.focus();

    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));
    expect(screen.getByText('OkWork')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('OkWork')).toBeNull();
    // Focus restored to the Settings entry
    expect(document.activeElement).toBe(entryBtn);
  });

  it('closes via backdrop click and restores focus', () => {
    mockOkwork();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Login');
    entryBtn.focus();

    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    const backdrop = document.querySelector('.about-backdrop')!;
    expect(backdrop).toBeInTheDocument();

    // Clicking backdrop itself (not the card)
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByText('OkWork')).toBeNull();
    // Focus restored to the Settings entry
    expect(document.activeElement).toBe(entryBtn);
  });
});

// --- BL-003: Remote Hosts menu item opens RemoteHostsPage, closes menu, restores focus ---
describe('settingsEntry_remote_hosts_click_opens_page_and_closes_menu', () => {
  it('clicking Remote Hosts opens the modal and closes the menu (mutually exclusive with About)', async () => {
    mockOkwork();
    render(<SettingsEntry />);

    openSettingsFromMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Remote Hosts' }));

    // Modal open, menu closed, About modal absent
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getAllByText('Remote Hosts').length).toBeGreaterThan(0);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByText('OkWork')).toBeNull();

    // list() called on mount (async effect)
    await Promise.resolve();
    expect(window.okwork.remoteHost.list).toHaveBeenCalled();
  });

  it('closes via close button, Esc, and backdrop, restoring focus each time (AC-6 parity)', () => {
    mockOkwork();
    const { unmount } = render(<SettingsEntry />);
    const entryBtn = screen.getByTitle('Login');

    // close button
    entryBtn.focus();
    openSettingsFromMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Remote Hosts' }));
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(document.activeElement).toBe(entryBtn);

    // Esc
    entryBtn.focus();
    openSettingsFromMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Remote Hosts' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(document.activeElement).toBe(entryBtn);

    // backdrop
    entryBtn.focus();
    openSettingsFromMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Remote Hosts' }));
    const backdrop = document.querySelector('.settings-panel__backdrop')!;
    expect(backdrop).toBeInTheDocument();
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(document.activeElement).toBe(entryBtn);

    unmount();
  });
});

// --- 远程机页深链:store.openRemoteHostsPage()(nonce 自增)由「host 过旧」死胡同提示等
// 入口触发,复用菜单项同一条 openPage 路径(焦点捕获 + 关菜单),连点两次也能重新打开 ---
describe('settingsEntry_panel_does_not_stack_settings_backdrops', () => {
  it('opens the global panel without a nested settings-modal or remote-hosts backdrop', () => {
    mockOkwork();
    render(<SettingsEntry />);
    openSettingsFromMenu();
    expect(document.querySelector('.settings-panel')).toBeInTheDocument();
    expect(document.querySelector('.settings-modal__backdrop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remote Hosts' }));
    expect(document.querySelector('.remote-hosts__backdrop')).toBeNull();
    expect(document.querySelector('.remote-hosts__embedded')).toBeInTheDocument();
  });
});

describe('settingsEntry_deep_link_replaces_open_about', () => {
  it('closes About when openRemoteHostsPage fires', () => {
    mockOkwork({ version: '0.3.12' });
    render(<SettingsEntry />);
    fireEvent.click(screen.getByTitle('Login'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));
    expect(screen.getByText('OkWork')).toBeInTheDocument();
    act(() => {
      useAppStore.getState().openRemoteHostsPage();
    });
    expect(screen.queryByText('OkWork')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('settingsEntry_remote_hosts_page_deep_link_via_store_nonce', () => {
  it('nonce 自增打开远程机页并关掉已开着的菜单;关闭后再次自增可重新打开', () => {
    mockOkwork();
    useAppStore.setState({ remoteHostsPageNonce: 0 });
    render(<SettingsEntry />);
    const entryBtn = screen.getByTitle('Login');

    // 菜单先开着,验证深链触发会顺手关掉它(而不是与页面共存)
    fireEvent.click(entryBtn);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    act(() => {
      useAppStore.getState().openRemoteHostsPage();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getAllByText('Remote Hosts').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByText('Remote Hosts')).toBeNull();

    // 连点两次场景:再次自增(即使菜单当前未开)必须重新触发打开
    act(() => {
      useAppStore.getState().openRemoteHostsPage();
    });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getAllByText('Remote Hosts').length).toBeGreaterThan(0);

    // 复位共享单例,避免污染其它用例
    useAppStore.setState({ remoteHostsPageNonce: 0 });
  });

  it('挂载时读到的初始 nonce 不触发打开(只有后续变化才算)', () => {
    mockOkwork();
    useAppStore.setState({ remoteHostsPageNonce: 3 }); // 非零初值,模拟已有历史触发次数
    render(<SettingsEntry />);
    expect(screen.queryByText('Remote Hosts')).toBeNull();

    useAppStore.setState({ remoteHostsPageNonce: 0 });
  });
});

// --- T-009: footer renders entry, devbadge, UpdatePill as siblings (AC-7) ---
describe('footer_renders_entry_devbadge_updatepill_as_siblings', () => {
  it('SettingsEntry renders DEV badge when devChannel is true', () => {
    mockOkwork({ devChannel: true });
    render(<SettingsEntry devChannel={true} />);

    // DEV badge inside the entry
    expect(screen.getByText('DEV')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('SettingsEntry does not render DEV badge when devChannel is false', () => {
    mockOkwork({ devChannel: false });
    render(<SettingsEntry devChannel={false} />);

    expect(screen.queryByText('DEV')).toBeNull();
  });

  it('real Sidebar footer renders UpdatePill and Settings entry as coexisting siblings', () => {
    // Real coexistence: mount the actual Sidebar (hostClient mocked above; the real
    // zustand store defaults to empty workspaces). The footer always renders.
    // window.okwork.onUpdateEvent immediately emits an "available" event so the
    // UpdatePill becomes visible without any timer.
    mockOkwork({ devChannel: true });
    (window.okwork as unknown as { onUpdateEvent: unknown }).onUpdateEvent = (
      cb: (e: { state: string; version?: string }) => void,
    ) => {
      cb({ state: 'available', version: '0.4.0' });
      return noop;
    };

    const { container } = render(<Sidebar />);

    const footer = container.querySelector<HTMLElement>('.sidebar-footer');
    expect(footer).toBeInTheDocument();
    const footerScope = within(footer as HTMLElement);

    // The update pill (top) and the Settings entry coexist inside the footer.
    const pill = footer?.querySelector('.sidebar-update-pill');
    const entry = footer?.querySelector('.settings-entry');
    expect(pill).toBeInTheDocument();
    expect(entry).toBeInTheDocument();

    // DEV badge lives inside the Settings entry (moved there from the old footer).
    expect(footerScope.getByText('DEV')).toBeInTheDocument();
  });
});
