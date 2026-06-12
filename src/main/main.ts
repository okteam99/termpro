import {
  app,
  BrowserWindow,
  MessageChannelMain,
  dialog,
  ipcMain,
  utilityProcess,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

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
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('ready', createWindow);

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
