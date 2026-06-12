// 壳层状态存储:workspace/tab 布局持久化到 userData/state.json。
// 这是「应用布局」数据(壳层职责),与工程数据(走 Host)区分。

import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const WRITE_DEBOUNCE_MS = 500;

let latest: unknown = null;
let pending: NodeJS.Timeout | null = null;

function stateFile(): string {
  return path.join(app.getPath('userData'), 'state.json');
}

function writeNow(): void {
  if (latest === null) return;
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(latest, null, 2));
  } catch (err) {
    console.error('[main] state write failed:', err);
  }
}

export function registerAppStore(): void {
  ipcMain.handle('store:get', () => {
    try {
      return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as unknown;
    } catch {
      return null;
    }
  });

  ipcMain.on('store:set', (_event, state: unknown) => {
    latest = state;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      writeNow();
    }, WRITE_DEBOUNCE_MS);
  });

  app.on('before-quit', () => {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    writeNow();
  });
}
