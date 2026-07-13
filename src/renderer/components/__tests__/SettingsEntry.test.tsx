// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

// Helper: set up window.termpro mock for the renderer bridge.
function mockTermpro(overrides: { version?: string; devChannel?: boolean } = {}) {
  Object.defineProperty(window, 'termpro', {
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
      openInBrowser: vi.fn(),
      onViewerAddTab: vi.fn(noop),
      // BL-003:RemoteHostsPage 挂载时读取(list/onEvent),其余方法按需 mock
      remoteHost: {
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
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
  delete (window as unknown as Record<string, unknown>).termpro;
});

// --- T-003: renders avatar placeholder and Settings label (AC-1) ---
describe('settingsEntry_renders_avatar_placeholder_and_settings_label', () => {
  it('renders Settings label and avatar container', () => {
    mockTermpro();
    render(<SettingsEntry />);

    // Settings label
    expect(screen.getByText('Settings')).toBeInTheDocument();

    // Avatar container (settings-avatar span)
    const avatar = document.querySelector('.settings-avatar');
    expect(avatar).toBeInTheDocument();
  });
});

// --- T-004: toggles menu with Remote Hosts + About items (AC-2 · BL-003 adds Remote Hosts) ---
describe('settingsEntry_toggles_menu_with_remote_hosts_and_about_items', () => {
  it('shows Remote Hosts + About menuitems on click and hides on second click', () => {
    mockTermpro();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Settings');

    // Initially no menu
    expect(screen.queryByRole('menu')).toBeNull();

    // First click: open
    fireEvent.click(entryBtn);
    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(3);
    expect(menuItems[0]).toHaveTextContent('Language');
    expect(menuItems[1]).toHaveTextContent('Remote Hosts');
    expect(menuItems[2]).toHaveTextContent('About');

    // Second click: close (toggle)
    fireEvent.click(entryBtn);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- 底部输入栏固定:开关项渲染 + 点击切换 store(默认开)---
describe('settingsEntry_pin_bottom_bar_toggle', () => {
  it('shows checked toggle by default and flips store on click', () => {
    mockTermpro();
    useAppStore.setState({ pinBottomBar: true });
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    const toggle = screen.getByRole('menuitemcheckbox');
    expect(toggle).toHaveTextContent('Pin bottom bar');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    expect(useAppStore.getState().pinBottomBar).toBe(false);
    // 菜单保持打开,勾随状态消失
    expect(screen.getByRole('menuitemcheckbox')).toHaveAttribute(
      'aria-checked',
      'false',
    );

    // 复位,避免污染其它用例共享的 store 单例
    useAppStore.setState({ pinBottomBar: true });
  });
});

// --- 语言切换:Language 项展开三选,选中即时换语言(菜单保持打开)---
describe('settingsEntry_language_switcher', () => {
  it('expands locale options and switches UI language + notifies main on pick', async () => {
    const { setLocale } = await import('../../../shared/i18n');
    mockTermpro();
    useAppStore.setState({ localePref: 'system' });
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    // 展开前无单选项;当前值显示在 Language 行右侧
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
    const langItem = screen.getByRole('menuitem', { name: /Language/ });
    expect(langItem).toHaveTextContent('System');

    fireEvent.click(langItem);
    const options = screen.getAllByRole('menuitemradio');
    expect(options.map((o) => o.textContent)).toEqual([
      '✓System',
      'English',
      '简体中文',
    ]);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('menuitemradio', { name: '简体中文' }));

    // store + main 通知 + 本组件文案即时换中文(菜单保持打开)
    expect(useAppStore.getState().localePref).toBe('zh-CN');
    expect(window.termpro.setAppLocale).toHaveBeenCalledWith('zh-CN');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('语言')).toBeInTheDocument();
    expect(
      within(screen.getByRole('menuitemradio', { name: /简体中文/ })).getByText('✓'),
    ).toBeInTheDocument();

    // 复位共享单例:i18n 回 en,store 回 system
    setLocale('en');
    useAppStore.setState({ localePref: 'system' });
  });
});

// --- T-005: menu closes on outside click and Esc (AC-3) ---
describe('settingsEntry_menu_closes_on_outside_click_and_esc', () => {
  it('closes menu on outside mousedown', () => {
    mockTermpro();
    render(
      <div>
        <SettingsEntry />
        <div data-testid="outside">outside</div>
      </div>,
    );

    fireEvent.click(screen.getByTitle('Settings'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Outside mousedown
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes menu on Esc key', () => {
    mockTermpro();
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- T-006: About click opens modal and closes menu (AC-4) ---
describe('settingsEntry_about_click_opens_modal_and_closes_menu', () => {
  it('clicking About opens the About modal and closes the menu', () => {
    mockTermpro({ version: '0.3.12' });
    render(<SettingsEntry />);

    // Open menu
    fireEvent.click(screen.getByTitle('Settings'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Click About
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    // Modal is open
    expect(screen.getByText('TermPro')).toBeInTheDocument();

    // Menu is closed
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- T-006b: no menu behind open about modal (AC-4 mutual exclusion) ---
describe('settingsEntry_no_menu_behind_open_about_modal', () => {
  it('menu is not present when about modal is open', () => {
    mockTermpro();
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    // Modal is open, menu is gone
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('TermPro')).toBeInTheDocument();
  });
});

// --- T-007a: About modal shows version from bridge (AC-5) ---
describe('aboutModal_shows_version_from_bridge', () => {
  it('reads version from window.termpro.version and displays it', () => {
    mockTermpro({ version: '0.3.12' });
    render(<SettingsEntry />);

    // Open menu → click About
    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('Version 0.3.12')).toBeInTheDocument();
  });
});

// --- T-007b: About modal shows fallback when version is empty (AC-8) ---
describe('aboutModal_shows_unknown_fallback_when_version_empty', () => {
  it('shows 版本未知 when window.termpro.version is empty', () => {
    mockTermpro({ version: '' });
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('Version unknown')).toBeInTheDocument();
  });

  it('shows 版本未知 when window.termpro is undefined (bridge absent)', () => {
    // No mockTermpro() — afterEach deletes window.termpro so it is absent here.
    render(<SettingsEntry />);
    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('Version unknown')).toBeInTheDocument();
  });
});

// --- T-008: modal closes via Esc / backdrop / button and restores focus (AC-6) ---
// AC-6 requires focus return for ALL three close mechanisms; all three route through
// handleCloseAbout, so each sub-test focuses the entry, opens, closes, and asserts return.
describe('aboutModal_closes_via_esc_backdrop_button_and_restores_focus', () => {
  it('closes via close button and restores focus', () => {
    mockTermpro();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Settings');
    entryBtn.focus();

    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    // Modal open
    const closeBtn = screen.getByTitle('Close');
    expect(closeBtn).toBeInTheDocument();

    fireEvent.click(closeBtn);

    // Modal closed
    expect(screen.queryByText('TermPro')).toBeNull();
    // Focus restored to the Settings entry
    expect(document.activeElement).toBe(entryBtn);
  });

  it('closes via Esc key and restores focus', () => {
    mockTermpro();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Settings');
    entryBtn.focus();

    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));
    expect(screen.getByText('TermPro')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('TermPro')).toBeNull();
    // Focus restored to the Settings entry
    expect(document.activeElement).toBe(entryBtn);
  });

  it('closes via backdrop click and restores focus', () => {
    mockTermpro();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Settings');
    entryBtn.focus();

    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    const backdrop = document.querySelector('.about-backdrop')!;
    expect(backdrop).toBeInTheDocument();

    // Clicking backdrop itself (not the card)
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByText('TermPro')).toBeNull();
    // Focus restored to the Settings entry
    expect(document.activeElement).toBe(entryBtn);
  });
});

// --- BL-003: Remote Hosts menu item opens RemoteHostsPage, closes menu, restores focus ---
describe('settingsEntry_remote_hosts_click_opens_page_and_closes_menu', () => {
  it('clicking Remote Hosts opens the modal and closes the menu (mutually exclusive with About)', async () => {
    mockTermpro();
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Remote Hosts' }));

    // Modal open, menu closed, About modal absent
    expect(screen.getByText('Remote Hosts')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByText('TermPro')).toBeNull();

    // list() called on mount (async effect)
    await Promise.resolve();
    expect(window.termpro.remoteHost.list).toHaveBeenCalled();
  });

  it('closes via close button, Esc, and backdrop, restoring focus each time (AC-6 parity)', () => {
    mockTermpro();
    const { unmount } = render(<SettingsEntry />);
    const entryBtn = screen.getByTitle('Settings');

    // close button
    entryBtn.focus();
    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remote Hosts' }));
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByText('Remote Hosts')).toBeNull();
    expect(document.activeElement).toBe(entryBtn);

    // Esc
    entryBtn.focus();
    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remote Hosts' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Remote Hosts')).toBeNull();
    expect(document.activeElement).toBe(entryBtn);

    // backdrop
    entryBtn.focus();
    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remote Hosts' }));
    const backdrop = document.querySelector('.remote-hosts__backdrop')!;
    expect(backdrop).toBeInTheDocument();
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByText('Remote Hosts')).toBeNull();
    expect(document.activeElement).toBe(entryBtn);

    unmount();
  });
});

// --- T-009: footer renders entry, devbadge, UpdatePill as siblings (AC-7) ---
describe('footer_renders_entry_devbadge_updatepill_as_siblings', () => {
  it('SettingsEntry renders DEV badge when devChannel is true', () => {
    mockTermpro({ devChannel: true });
    render(<SettingsEntry devChannel={true} />);

    // DEV badge inside the entry
    expect(screen.getByText('DEV')).toBeInTheDocument();
    // Settings label also present
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('SettingsEntry does not render DEV badge when devChannel is false', () => {
    mockTermpro({ devChannel: false });
    render(<SettingsEntry devChannel={false} />);

    expect(screen.queryByText('DEV')).toBeNull();
  });

  it('real Sidebar footer renders UpdatePill and Settings entry as coexisting siblings', () => {
    // Real coexistence: mount the actual Sidebar (hostClient mocked above; the real
    // zustand store defaults to empty workspaces). The footer always renders.
    // window.termpro.onUpdateEvent immediately emits an "available" event so the
    // UpdatePill becomes visible without any timer.
    mockTermpro({ devChannel: true });
    (window.termpro as unknown as { onUpdateEvent: unknown }).onUpdateEvent = (
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
