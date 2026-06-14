// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import React from 'react';

expect.extend(matchers);

vi.mock('../../services/hostClient', () => ({
  hostClient: { info: { homedir: '/Users/test' } },
}));

import { Sidebar } from '../Sidebar';

const noop = () => undefined;

function mockTermproUpdateEvent(event: {
  state: 'available' | 'checking' | 'downloading' | 'restarting' | 'error';
  version?: string;
  percent?: number;
}) {
  Object.defineProperty(window, 'termpro', {
    value: {
      version: '0.3.13',
      devChannel: false,
      platform: 'darwin',
      smoke: false,
      requestHostPort: vi.fn(),
      pickDirectory: vi.fn(),
      onMenu: vi.fn(noop),
      smokeOk: vi.fn(),
      storeGet: vi.fn(),
      storeSet: vi.fn(),
      setDockBadge: vi.fn(),
      focusWindow: vi.fn(),
      onUpdateEvent: vi.fn((cb: (e: typeof event) => void) => {
        cb(event);
        return noop;
      }),
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
    },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).termpro;
});

describe('Sidebar UpdatePill copy', () => {
  it('updatePill_available_and_downloading_copy_requires_confirmation_not_auto_restart', () => {
    mockTermproUpdateEvent({ state: 'available', version: '0.4.0' });
    const available = render(<Sidebar />);

    const availablePill = screen.getByRole('button', {
      name: /新版本 v0\.4\.0/,
    });
    expect(availablePill).toHaveAttribute(
      'title',
      expect.stringContaining('确认'),
    );
    expect(availablePill.getAttribute('title')).not.toContain('自动重启');

    available.unmount();
    cleanup();

    mockTermproUpdateEvent({
      state: 'downloading',
      version: '0.4.0',
      percent: 42,
    });
    render(<Sidebar />);

    const downloadingPill = screen.getByRole('button', { name: /下载中 42%/ });
    expect(downloadingPill).toHaveTextContent('完成后确认安装');
    expect(downloadingPill).not.toHaveTextContent('完成后自动重启');
  });
});
