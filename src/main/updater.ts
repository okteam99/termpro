// 更新检查与升级:轮询 GitHub latest release(公开仓库免认证),
// 有新版广播给渲染层(侧栏左下角胶囊);用户点击后走 Squirrel.Mac
// (update.electronjs.org 免费 feed,要求:公开仓库 + Developer ID 签名)。
// 任何失败兜底打开 Release 页让用户手动下载。

import { app, autoUpdater, BrowserWindow, ipcMain, shell } from 'electron';

const REPO = 'okteam99/termpro';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 10_000;

export interface UpdateEvent {
  state: 'available' | 'downloading' | 'restarting' | 'error';
  version?: string;
}

let latest: { version: string; htmlUrl: string } | null = null;
let installing = false;

function broadcast(payload: UpdateEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('update:event', payload);
  }
}

function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const l = local.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) !== (l[i] ?? 0)) return (r[i] ?? 0) > (l[i] ?? 0);
  }
  return false;
}

async function check(): Promise<void> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return;
    const json = (await res.json()) as { tag_name?: string; html_url?: string };
    const version = (json.tag_name ?? '').replace(/^v/, '');
    if (version && isNewer(version, app.getVersion())) {
      latest = {
        version,
        htmlUrl: json.html_url ?? `https://github.com/${REPO}/releases`,
      };
      broadcast({ state: 'available', version });
    }
  } catch {
    // 离线/限流:静默,等下个周期
  }
}

function fallbackToReleasePage(): void {
  installing = false;
  broadcast({ state: 'error', version: latest?.version });
  if (latest) void shell.openExternal(latest.htmlUrl);
}

export function initUpdater(): void {
  ipcMain.on('update:install', () => {
    if (!latest || installing) return;
    installing = true;
    broadcast({ state: 'downloading', version: latest.version });
    try {
      autoUpdater.setFeedURL({
        url: `https://update.electronjs.org/${REPO}/darwin-${process.arch}/${app.getVersion()}`,
      });
      autoUpdater.once('update-downloaded', () => {
        broadcast({ state: 'restarting', version: latest?.version });
        autoUpdater.quitAndInstall();
      });
      autoUpdater.once('update-not-available', fallbackToReleasePage);
      autoUpdater.once('error', (err) => {
        console.error('[updater] failed:', err);
        fallbackToReleasePage();
      });
      autoUpdater.checkForUpdates();
    } catch (err) {
      console.error('[updater] failed:', err);
      fallbackToReleasePage();
    }
  });

  // 新窗口打开时补发当前状态(查看器窗口/重载后也能看到胶囊)
  ipcMain.on('update:query', (event) => {
    if (latest && !installing) {
      event.sender.send('update:event', {
        state: 'available',
        version: latest.version,
      } satisfies UpdateEvent);
    }
  });

  if (!app.isPackaged) return; // dev 构建不查更新
  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void check(), CHECK_INTERVAL_MS);
}
