import {
  app,
  BrowserWindow,
  Menu,
  MessageChannelMain,
  dialog,
  ipcMain,
  utilityProcess,
} from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerAppStore } from './appStore';
import { initUpdater } from './updater';

if (started) {
  app.quit();
}

// 冒烟模式用独立 userData:不污染真实布局存档,且结果可复现
if (process.env.TERMPRO_SMOKE) {
  app.setPath('userData', path.join(os.tmpdir(), 'termpro-smoke'));
}

registerAppStore();
initUpdater();

// ---- Host 进程(utilityProcess)----------------------------------------

let hostProc: Electron.UtilityProcess | null = null;

function ensureHost(): Electron.UtilityProcess {
  if (hostProc) return hostProc;
  hostProc = utilityProcess.fork(path.join(__dirname, 'host.js'), [], {
    serviceName: 'termpro-host',
  });
  hostProc.on('exit', (code) => {
    console.error(`[main] host exited with code ${code}`);
    hostProc = null;
    // 通知所有窗口:挂起的 RPC 立即失败、UI 展示错误(⌘R 重载即重建 host)
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('host:down'),
    );
  });
  return hostProc;
}

// 渲染层请求与 Host 直连:建 MessageChannel,两端分别交给 host 与 renderer,
// 此后 PTY 流量不经过 main 进程。
ipcMain.on('host:request-port', (event) => {
  const { port1, port2 } = new MessageChannelMain();
  ensureHost().postMessage({ t: 'client' }, [port1]);
  event.sender.postMessage('host:port', null, [port2]);
});

// ---- 壳层服务 -----------------------------------------------------------

ipcMain.on('dock:badge', (_event, count: number) => {
  if (process.platform === 'darwin') {
    app.dock?.setBadge(count > 0 ? String(count) : '');
  }
});

ipcMain.on('window:focus-self', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  app.focus({ steal: true });
});

// 外跳本地编辑器(壳层职责,macOS 用 open -a 不依赖 PATH)
const EDITOR_APPS: Record<string, string> = {
  vscode: 'Visual Studio Code',
  zed: 'Zed',
};
ipcMain.on('editor:open', (_event, editor: string, targetPath: string) => {
  const appName = EDITOR_APPS[editor];
  if (!appName || typeof targetPath !== 'string') return;
  const child = spawn('open', ['-a', appName, targetPath], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', (err) => console.error('[main] editor open failed:', err));
  child.unref();
});

ipcMain.handle('dialog:pick-directory', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

// ---- 冒烟模式:TERMPRO_SMOKE=1 时,渲染层完成 Host 握手即退出(CI 可用)----

if (process.env.TERMPRO_SMOKE) {
  const timer = setTimeout(() => {
    console.error('SMOKE_TIMEOUT');
    app.exit(1);
  }, 30_000);
  ipcMain.on('smoke:ok', () => {
    clearTimeout(timer);
    console.log('SMOKE_OK');
    setTimeout(() => app.quit(), 200);
  });
}

// ---- 三窗口模型 ----------------------------------------------------------
// 主窗口(终端工作台)/ 文件内容窗口(单例,多 tab,所有可编辑文件共用)/
// git diff 窗口(单例,模态挂主窗口;打开期间禁止再开任何查看窗口)。

let mainWin: BrowserWindow | null = null;
let fileWin: BrowserWindow | null = null;
let diffWin: BrowserWindow | null = null;

function loadViewer(win: BrowserWindow, payload: unknown): void {
  const json = JSON.stringify(payload);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?viewer=${encodeURIComponent(json)}`,
    );
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { viewer: json } },
    );
  }
}

function openFileWindow(filePath: string): void {
  if (fileWin && !fileWin.isDestroyed()) {
    fileWin.show();
    fileWin.focus();
    const wc = fileWin.webContents;
    if (wc.isLoading()) {
      // 窗口冷启动尚未完成:渲染层还没订阅 add-tab,延迟到加载完成
      wc.once('did-finish-load', () => {
        if (fileWin && !fileWin.isDestroyed()) {
          wc.send('viewer:add-tab', filePath);
        }
      });
    } else {
      wc.send('viewer:add-tab', filePath);
    }
    return;
  }
  fileWin = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1e2227',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  fileWin.on('closed', () => {
    fileWin = null;
  });
  loadViewer(fileWin, { mode: 'files', initialPath: filePath });
}

function openDiffWindow(payload: unknown): void {
  diffWin = new BrowserWindow({
    // 模态:macOS 下呈现为挂在主窗口的 sheet
    parent: mainWin ?? undefined,
    modal: !!mainWin,
    width: 1200,
    height: 800,
    backgroundColor: '#1e2227',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  diffWin.on('closed', () => {
    diffWin = null;
  });
  loadViewer(diffWin, payload);
}

ipcMain.on('viewer:open-window', (_event, payload: unknown) => {
  // diff 模态期间禁止再开任何查看窗口
  if (diffWin && !diffWin.isDestroyed()) {
    diffWin.focus();
    return;
  }
  const p = payload as { mode?: string; path?: string } | undefined;
  if (p?.mode === 'diff') {
    openDiffWindow(payload);
  } else if (p?.mode === 'file' && typeof p.path === 'string') {
    openFileWindow(p.path);
  }
});

// ---- 应用菜单:把 ⌘T/⌘W 从系统默认行为里解放出来交给渲染层 ----------------

function buildMenu(): void {
  const sendMenu = (action: string) => () =>
    BrowserWindow.getFocusedWindow()?.webContents.send('menu', action);

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: 'Shell',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: sendMenu('new-tab'),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: sendMenu('close-tab'),
        },
        { type: 'separator' },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          role: 'close',
        },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- 窗口 ---------------------------------------------------------------

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1e2227',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 沙箱 preload 没有 process.env,冒烟开关经 argv 传递
      additionalArguments: process.env.TERMPRO_SMOKE
        ? ['--termpro-smoke']
        : [],
    },
  });

  if (process.env.TERMPRO_SMOKE || process.env.TERMPRO_DEBUG) {
    // 冒烟/调试模式把渲染层 console 转发到 stdout;
    // TERMPRO_DEBUG=1 用真实 userData,从 CLI 启动即可排查线上问题
    mainWindow.webContents.on('console-message', (details) => {
      console.log(`[renderer:${details.level}] ${details.message}`);
    });
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWin = mainWindow;
  mainWindow.on('closed', () => {
    if (mainWin === mainWindow) mainWin = null;
  });
};

app.on('ready', () => {
  // dev 模式 Dock 图标(打包版由 packagerConfig.icon 提供)
  if (!app.isPackaged && process.platform === 'darwin') {
    const devIcon = path.join(__dirname, '../../assets/icon.png');
    if (fs.existsSync(devIcon)) app.dock?.setIcon(devIcon);
  }
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
