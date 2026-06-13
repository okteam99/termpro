import type { BrowserWindow, Event } from 'electron';
import { shell } from 'electron';
import {
  isInternalDevServerNavigation,
  isSystemBrowserUrl,
} from './externalUrl';

interface ExternalUrlPolicyOptions {
  devServerUrl?: string;
}

function openInSystemBrowser(url: string): boolean {
  if (!isSystemBrowserUrl(url)) return false;
  void shell.openExternal(url);
  return true;
}

export function installExternalUrlPolicy(
  win: BrowserWindow,
  opts: ExternalUrlPolicyOptions = {},
): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInSystemBrowser(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event: Event, url) => {
    if (isInternalDevServerNavigation(url, opts.devServerUrl)) return;
    event.preventDefault();
    openInSystemBrowser(url);
  });
}
