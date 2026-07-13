// 更新检查与升级:轮询 GitHub latest release(公开仓库免认证),
// 有新版广播给渲染层(侧栏左下角胶囊);用户点击后升级。
// Squirrel.Mac 自身无下载进度事件,所以下载由我们自己做:
//   1. 从 update.electronjs.org feed 拿 zip 直链,流式下载到临时目录,
//      按 Content-Length 广播真实百分比;
//   2. 起一个 127.0.0.1 本地 HTTP feed 指向已下载的 zip,
//      再让 Squirrel.Mac 走本地 feed 完成校验与安装(签名校验不变)。
// 任何失败兜底打开 Release 页让用户手动下载。
// autoUpdater 是进程级单例:listener 只在 init 时配置一次,
// 避免重试后 once-listener 残留导致重复 quitAndInstall(评审 P0)。

import { app, autoUpdater, BrowserWindow, ipcMain, shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { ExitConfirmationResult } from './exitConfirmation';
import { handleDownloadedUpdateForInstall } from './updateInstallDecision';
import {
  clearReadyToInstall,
  createUpdateInstallSession,
  markUpdateDownloaded,
  requestUpdateInstall,
  resetUpdateInstallSession,
  setUpdateInstalling,
} from './updateInstallSession';

// 品牌改名(TermPro → OkWork)后仓库路径未动:GitHub 仓库仍叫 termpro。
// 若日后重命名仓库,GitHub 会 301 重定向旧路径,此常量可继续工作;
// 改成新路径前必须确认仓库已真实改名,否则升级检查全挂。
const REPO = 'okteam99/termpro';
// 每 10 分钟周期检测;窗口聚焦(用户行为)且距上次检查 >10 分钟时立即触发
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 10_000;

export interface UpdateEvent {
  state:
    | 'available'
    | 'checking'
    | 'downloading'
    | 'confirming'
    | 'restarting'
    | 'error';
  version?: string;
  /** downloading 阶段的真实进度(0-100);无 Content-Length 时缺省 */
  percent?: number;
}

let latest: { version: string; htmlUrl: string; zipUrl?: string } | null = null;
const installSession = createUpdateInstallSession();
let lastCheckTs = 0;
/** 看门狗兜底下载/安装真卡死的情况 */
let watchdog: NodeJS.Timeout | null = null;
const WATCHDOG_MS = 15 * 60 * 1000;

/** 安装期临时产物:本地 feed server + 已下载的 zip,结束/失败时清理 */
let localServer: Server | null = null;
let downloadedZip: string | null = null;

function cleanupInstallArtifacts(): void {
  localServer?.close();
  localServer = null;
  if (downloadedZip) {
    void rm(downloadedZip, { force: true }).catch(() => undefined);
    downloadedZip = null;
  }
}

function clearWatchdog(): void {
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

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

/** 从 release assets 挑出本平台/架构的 Squirrel zip 直链
 *  (maker-zip 命名:<App>-darwin-<arch>-<version>.zip)。拿到就不必再
 *  依赖 update.electronjs.org——那个第三方 feed 有索引延迟,新版发布后
 *  会短暂返回 204,正是「胶囊已显示却升级失败」的根因。 */
function pickDarwinZip(
  assets?: Array<{ name?: string; browser_download_url?: string }>,
): string | undefined {
  return (assets ?? []).find(
    (a) =>
      !!a.browser_download_url &&
      !!a.name &&
      a.name.endsWith('.zip') &&
      a.name.includes('darwin') &&
      a.name.includes(process.arch),
  )?.browser_download_url;
}

async function check(): Promise<void> {
  lastCheckTs = Date.now();
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      prerelease?: boolean;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    if (json.prerelease) return; // 预发布不推给用户
    const version = (json.tag_name ?? '').replace(/^v/, '');
    if (version && isNewer(version, app.getVersion())) {
      const isNewFinding = latest?.version !== version;
      latest = {
        version,
        htmlUrl: json.html_url ?? `https://github.com/${REPO}/releases`,
        zipUrl: pickDarwinZip(json.assets),
      };
      // 同一版本只广播一次,避免周期检测反复刷事件
      if (isNewFinding) broadcast({ state: 'available', version });
    }
  } catch {
    // 离线/限流:静默,等下个周期
  }
}

function fallbackToReleasePage(): void {
  const version = installSession.installingVersion ?? latest?.version;
  clearWatchdog();
  cleanupInstallArtifacts();
  resetUpdateInstallSession(installSession);
  broadcast({ state: 'error', version });
  if (latest) void shell.openExternal(latest.htmlUrl);
}

/** feed 请求超时;zip 下载用 stall 超时(有字节进来就续命,断流才算卡死) */
const FEED_TIMEOUT_MS = 15_000;
const STALL_TIMEOUT_MS = 60_000;

/** 本次下载是否拿到了 Content-Length(决定后续广播是否带 percent) */
let downloadHadLength = false;

/** 解析本版 zip 直链:首选 check() 从 GitHub release 拿到的 asset 直链
 *  (与胶囊同源,即时一致,无第三方索引延迟);缺失才回退
 *  update.electronjs.org feed。 */
async function resolveZipUrl(): Promise<string> {
  if (latest?.zipUrl) return latest.zipUrl;
  const feedRes = await fetch(
    `https://update.electronjs.org/${REPO}/darwin-${process.arch}/${app.getVersion()}`,
    {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    },
  );
  if (feedRes.status === 204) throw new Error('feed: no update available');
  if (!feedRes.ok) throw new Error(`feed: HTTP ${feedRes.status}`);
  const feed = (await feedRes.json()) as { url?: string };
  if (!feed.url) throw new Error('feed: missing url');
  return feed.url;
}

/** 解析 zip 直链,流式下载并广播百分比 */
async function downloadUpdate(version: string): Promise<string> {
  const zipUrl = await resolveZipUrl();

  // 弱网断流兜底:STALL_TIMEOUT_MS 内无新字节即中止,立刻走 fallback,
  // 不让用户干等 15 分钟看门狗
  const ctrl = new AbortController();
  let stallTimer = setTimeout(
    () => ctrl.abort(new Error('download stalled')),
    STALL_TIMEOUT_MS,
  );
  try {
    const res = await fetch(zipUrl, { signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`download: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') ?? 0);
    downloadHadLength = total > 0;
    const zipPath = path.join(app.getPath('temp'), `okwork-update-${version}.zip`);
    let received = 0;
    let lastTs = 0;
    const progress = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(
          () => ctrl.abort(new Error('download stalled')),
          STALL_TIMEOUT_MS,
        );
        received += chunk.length;
        const now = Date.now();
        // 节流 ~4 次/秒;完成时强制补发 100%
        if (total > 0 && (now - lastTs > 250 || received >= total)) {
          lastTs = now;
          broadcast({
            state: 'downloading',
            version,
            percent: Math.min(100, Math.round((received / total) * 100)),
          });
        }
        cb(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream),
      progress,
      createWriteStream(zipPath),
    );
    return zipPath;
  } finally {
    clearTimeout(stallTimer);
  }
}

/** 起本地 feed server:根路径返回 Squirrel JSON,/update.zip 回已下载的包 */
function serveForSquirrel(zipPath: string, version: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        if (req.url === '/update.zip') {
          const { size } = statSync(zipPath);
          res.writeHead(200, {
            'content-type': 'application/zip',
            'content-length': size,
          });
          createReadStream(zipPath).pipe(res);
        } else if (req.url === '/') {
          const { port } = server.address() as AddressInfo;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              url: `http://127.0.0.1:${port}/update.zip`,
              name: version,
            }),
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      } catch (err) {
        console.error('[updater] local feed request failed:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
    localServer = server;
    let listening = false;
    server.on('error', (err) => {
      if (!listening) {
        reject(err);
        return;
      }
      // listen 成功后的运行期错误:不能再 reject(Promise 已 resolve),
      // 直接走统一失败兜底,避免 Squirrel 拉包卡死等看门狗
      console.error('[updater] local feed server error:', err);
      fallbackToReleasePage();
    });
    server.listen(0, '127.0.0.1', () => {
      listening = true;
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}/`);
    });
  });
}

export interface InitUpdaterOptions {
  confirmInstallWhenIdle?: (version?: string) => Promise<ExitConfirmationResult>;
  prepareToQuitAndInstall?: () => void;
  rollbackQuitAndInstall?: () => void;
}

export function initUpdater(options: InitUpdaterOptions = {}): void {
  const confirmInstallWhenIdle =
    options.confirmInstallWhenIdle ??
    (async () => ({ status: 'confirmed' }) satisfies ExitConfirmationResult);
  const prepareToQuitAndInstall =
    options.prepareToQuitAndInstall ?? (() => undefined);
  const rollbackQuitAndInstall =
    options.rollbackQuitAndInstall ?? (() => undefined);

  const confirmReadyToInstall = (version: string | undefined): void => {
    console.log(
      version
        ? `[updater] v${version} ready, awaiting install confirmation`
        : '[updater] update ready, awaiting install confirmation',
    );
    broadcast({ state: 'confirming', version });
    void handleDownloadedUpdateForInstall({
      version,
      confirmInstallWhenIdle,
      clearWatchdog,
      cleanupInstallArtifacts,
      isStillInstalling() {
        return installSession.installing;
      },
      setInstalling(value) {
        setUpdateInstalling(installSession, value);
      },
      broadcast,
      prepareToQuitAndInstall,
      rollbackQuitAndInstall,
      quitAndInstall() {
        clearReadyToInstall(installSession);
        autoUpdater.quitAndInstall();
      },
      log(message) {
        console.log(message);
      },
    }).catch((err) => {
      console.error('[updater] install confirmation failed:', err);
      fallbackToReleasePage();
    });
  };

  ipcMain.on('update:install', () => {
    const decision = requestUpdateInstall(installSession, latest?.version);
    if (decision.action === 'ignore') return;
    const { version } = decision;
    console.log('[updater] install requested for v%s', version);
    if (decision.action === 'reuse-staged') {
      // Squirrel.Mac has already emitted update-downloaded for this version; the
      // staged copy is ready, so retry only needs user confirmation.
      console.log('[updater] reusing staged update for v%s', version);
      confirmReadyToInstall(version);
      return;
    }
    broadcast({ state: 'checking', version });
    watchdog = setTimeout(() => {
      console.error('[updater] watchdog timeout (15min), falling back');
      fallbackToReleasePage();
    }, WATCHDOG_MS);
    void (async () => {
      try {
        broadcast({ state: 'downloading', version, percent: 0 });
        const zipPath = await downloadUpdate(version);
        downloadedZip = zipPath;
        // 交给 Squirrel 走本地 feed:校验签名 + 落盘安装
        const feedUrl = await serveForSquirrel(zipPath, version);
        autoUpdater.setFeedURL({ url: feedUrl });
        autoUpdater.checkForUpdates();
      } catch (err) {
        console.error('[updater] self-download failed:', err);
        fallbackToReleasePage();
      }
    })();
  });

  // 新窗口打开时补发当前状态(查看器窗口/重载后也能看到胶囊)
  ipcMain.on('update:query', (event) => {
    if (latest && !installSession.installing) {
      event.sender.send('update:event', {
        state: 'available',
        version: latest.version,
      } satisfies UpdateEvent);
    }
  });

  if (!app.isPackaged) return; // dev 构建不查更新、不配 autoUpdater
  if (app.getName().includes('Dev')) return; // DEV 渠道包同样不查

  // listener 全局只配一次;installing 门控使其只在安装期生效。
  // feedURL 在安装时指向本地 server(下载已由 downloadUpdate 完成)。
  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking local feed…');
  });
  autoUpdater.on('update-available', () => {
    if (!installSession.installing) return;
    // 本地 feed:Squirrel 从 127.0.0.1 拉包,秒级完成。
    // 下载阶段没拿到 Content-Length(全程脉冲)就不突然跳 100%
    console.log('[updater] squirrel pulling local zip…');
    broadcast({
      state: 'downloading',
      version: latest?.version,
      percent: downloadHadLength ? 100 : undefined,
    });
  });
  autoUpdater.on('update-downloaded', () => {
    if (!installSession.installing) return;
    const version = markUpdateDownloaded(installSession, latest?.version);
    confirmReadyToInstall(version);
  });
  autoUpdater.on('update-not-available', () => {
    if (!installSession.installing) return;
    fallbackToReleasePage();
  });
  autoUpdater.on('error', (err) => {
    if (!installSession.installing) return;
    console.error('[updater] failed:', err);
    fallbackToReleasePage();
  });

  setTimeout(() => {
    if (!installSession.installing) void check();
  }, FIRST_CHECK_DELAY_MS);
  setInterval(() => {
    if (!installSession.installing) void check();
  }, CHECK_INTERVAL_MS);
  // 用户行为触发:窗口聚焦且距上次检查超过一个周期 → 立即检查
  app.on('browser-window-focus', () => {
    if (
      !installSession.installing &&
      Date.now() - lastCheckTs > CHECK_INTERVAL_MS
    ) {
      void check();
    }
  });
}
