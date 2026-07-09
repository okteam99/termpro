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

function v1BackupFile(): string {
  return path.join(app.getPath('userData'), 'state.v1-backup.json');
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

  // 迁移(v1→v2)提交前把原 state.json 复制为备份(AC-1「原存档已备份」)。
  // 失败抛错 → renderer 迁移器视同迁移失败,不翻 v2、下次重试。
  ipcMain.handle('store:backup-v1', () => {
    try {
      fs.copyFileSync(stateFile(), v1BackupFile());
    } catch (err) {
      console.error('[main] v1 backup failed:', err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

  app.on('before-quit', () => {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    writeNow();
  });
}
