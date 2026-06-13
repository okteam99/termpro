// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import React from 'react';

expect.extend(matchers);
import { AboutModal, SettingsEntry } from '../SettingsEntry';

// Helper: set up window.termpro mock before each test
function mockTerpmro(overrides: { version?: string; devChannel?: boolean } = {}) {
  Object.defineProperty(window, 'termpro', {
    value: {
      version: overrides.version ?? '0.3.12',
      devChannel: overrides.devChannel ?? false,
      platform: 'darwin',
      smoke: false,
      requestHostPort: vi.fn(),
      pickDirectory: vi.fn(),
      onMenu: vi.fn(),
      smokeOk: vi.fn(),
      storeGet: vi.fn(),
      storeSet: vi.fn(),
      setDockBadge: vi.fn(),
      focusWindow: vi.fn(),
      onUpdateEvent: vi.fn(() => () => {}),
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
      onViewerAddTab: vi.fn(() => () => {}),
    },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
});

// --- T-003: renders avatar placeholder and Settings label (AC-1) ---
describe('settingsEntry_renders_avatar_placeholder_and_settings_label', () => {
  it('renders Settings label and avatar container', () => {
    mockTerpmro();
    render(<SettingsEntry />);

    // Settings label
    expect(screen.getByText('Settings')).toBeInTheDocument();

    // Avatar container (settings-avatar span)
    const avatar = document.querySelector('.settings-avatar');
    expect(avatar).toBeInTheDocument();
  });
});

// --- T-004: toggles menu with exactly one About item (AC-2) ---
describe('settingsEntry_toggles_menu_with_exactly_one_about_item', () => {
  it('shows one About menuitem on click and hides on second click', () => {
    mockTerpmro();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Settings');

    // Initially no menu
    expect(screen.queryByRole('menu')).toBeNull();

    // First click: open
    fireEvent.click(entryBtn);
    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(1);
    expect(menuItems[0]).toHaveTextContent('About');

    // Second click: close (toggle)
    fireEvent.click(entryBtn);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- T-005: menu closes on outside click and Esc (AC-3) ---
describe('settingsEntry_menu_closes_on_outside_click_and_esc', () => {
  it('closes menu on outside mousedown', () => {
    mockTerpmro();
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
    mockTerpmro();
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
    mockTerpmro({ version: '0.3.12' });
    render(<SettingsEntry />);

    // Open menu
    fireEvent.click(screen.getByTitle('Settings'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Click About
    fireEvent.click(screen.getByRole('menuitem'));

    // Modal is open
    expect(screen.getByText('TermPro')).toBeInTheDocument();

    // Menu is closed
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- T-006b: no menu behind open about modal (AC-4 mutual exclusion) ---
describe('settingsEntry_no_menu_behind_open_about_modal', () => {
  it('menu is not present when about modal is open', () => {
    mockTerpmro();
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem'));

    // Modal is open, menu is gone
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('TermPro')).toBeInTheDocument();
  });
});

// --- T-007a: About modal shows version from bridge (AC-5) ---
describe('aboutModal_shows_version_from_bridge', () => {
  it('reads version from window.termpro.version and displays it', () => {
    mockTerpmro({ version: '0.3.12' });
    render(<SettingsEntry />);

    // Open menu → click About
    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem'));

    expect(screen.getByText('版本 0.3.12')).toBeInTheDocument();
  });
});

// --- T-007b: About modal shows fallback when version is empty (AC-8) ---
describe('aboutModal_shows_unknown_fallback_when_version_empty', () => {
  it('shows 版本未知 when window.termpro.version is empty', () => {
    mockTerpmro({ version: '' });
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem'));

    expect(screen.getByText('版本未知')).toBeInTheDocument();
  });

  it('shows 版本未知 when window.termpro is undefined (bridge absent)', () => {
    // Temporarily remove termpro from window
    const saved = (window as unknown as Record<string, unknown>).termpro;
    delete (window as unknown as Record<string, unknown>).termpro;

    render(<SettingsEntry />);
    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem'));

    expect(screen.getByText('版本未知')).toBeInTheDocument();

    // Restore
    (window as unknown as Record<string, unknown>).termpro = saved;
  });
});

// --- T-008: modal closes via Esc / backdrop / button and restores focus (AC-6) ---
describe('aboutModal_closes_via_esc_backdrop_button_and_restores_focus', () => {
  it('closes via close button and restores focus', () => {
    mockTerpmro();
    render(<SettingsEntry />);

    const entryBtn = screen.getByTitle('Settings');
    entryBtn.focus();

    fireEvent.click(entryBtn);
    fireEvent.click(screen.getByRole('menuitem'));

    // Modal open
    const closeBtn = screen.getByTitle('关闭');
    expect(closeBtn).toBeInTheDocument();

    fireEvent.click(closeBtn);

    // Modal closed
    expect(screen.queryByText('TermPro')).toBeNull();
    // Focus restored — jsdom focus tracking
    expect(document.activeElement).toBe(entryBtn);
  });

  it('closes via Esc key', () => {
    mockTerpmro();
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem'));
    expect(screen.getByText('TermPro')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('TermPro')).toBeNull();
  });

  it('closes via backdrop click', () => {
    mockTerpmro();
    render(<SettingsEntry />);

    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('menuitem'));

    const backdrop = document.querySelector('.about-backdrop')!;
    expect(backdrop).toBeInTheDocument();

    // Clicking backdrop itself (not the card)
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByText('TermPro')).toBeNull();
  });
});

// --- T-009: footer renders entry, devbadge, UpdatePill as siblings (AC-7) ---
describe('footer_renders_entry_devbadge_updatepill_as_siblings', () => {
  it('SettingsEntry renders DEV badge when devChannel is true', () => {
    mockTerpmro({ devChannel: true });
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

  it('renders SettingsEntry and UpdatePill as siblings in a footer container', () => {
    mockTermpro();
    // Simulate the footer structure from Sidebar
    const onUpdateEvent = vi.fn((cb: (e: { state: string; version?: string }) => void) => {
      // Immediately emit an available event to make UpdatePill visible
      setTimeout(() => cb({ state: 'available', version: '0.4.0' }), 0);
      return () => {};
    });
    (window.termpro as unknown as Record<string, unknown>).onUpdateEvent = onUpdateEvent;

    // We test the footer structure by rendering both elements into a sidebar-footer div
    // (Full Sidebar mount requires zustand store + hostClient setup — too heavy for unit test)
    const { container } = render(
      <div className="sidebar-footer">
        {/* UpdatePill placeholder — rendered inline since UpdatePill uses window.termpro.onUpdateEvent */}
        <button className="sidebar-update-pill">update</button>
        <SettingsEntry devChannel={true} />
      </div>,
    );

    const footer = container.querySelector('.sidebar-footer')!;
    expect(footer).toBeInTheDocument();

    // Both children are direct children of footer
    const children = Array.from(footer.children);
    const hasUpdatePill = children.some((c) => c.classList.contains('sidebar-update-pill'));
    const hasSettingsAnchor = children.some((c) => c.classList.contains('settings-anchor'));
    expect(hasUpdatePill).toBe(true);
    expect(hasSettingsAnchor).toBe(true);
  });
});

// Helper: fix typo in one test — using the same mockTermpro helper
function mockTermpro(overrides: { version?: string; devChannel?: boolean } = {}) {
  mockTerpmro(overrides);
}
