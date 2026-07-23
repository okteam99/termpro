import {
  app,
  BrowserWindow,
  Menu,
  MessageChannelMain,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
  session,
  utilityProcess,
  clipboard,
  shell,
} from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { readPersistedLocalePref, registerAppStore } from './appStore';
import { buildAdditionalArguments } from './buildAdditionalArguments';
import {
  ExitLifecycleController,
  createExitConfirmationCoordinator,
  shouldBypassExitConfirmation,
} from './exitConfirmation';
import {
  PANE_CLOSE_CONFIRM_INDEX,
  buildPaneCloseConfirmationOptions,
  decidePaneClose,
  paneClosedNotice,
  paneTabCount,
} from './browserPaneClose';
import { installExternalUrlPolicy } from './externalUrlPolicy';
import { createRendererRecovery } from './rendererRecovery';
import { startBrowserMcpServer, type BrowserMcpHandle } from './browserMcp';
import { initUpdater } from './updater';
import { registerRemoteHostIpc } from './remote/remoteHostIpc';
import { RemoteHostOrchestrator } from './remote/orchestrator';
import { CredentialStore, HostConfigStore } from './remote/credentialStore';
import { resolveBundleDir } from './remote/hostBundle';
import { SshConnection } from './remote/ssh';
import { BrowserNetworkController } from './browserNetwork';
import { BrowserProfileStore } from './browserProfileStore';
import { createBrowserPartitionPolicy } from './browserPartitionPolicy';
import { JsonFileSettingsStore } from './settingsStore';
import { BROWSER_NET_CHANNELS } from '../shared/remoteHost';
import {
  BROWSER_PROFILE_CHANNELS,
  DEFAULT_PROFILE_ID,
  parseBrowserPartition,
  type BrowserProfileInput,
} from '../shared/browserProfile';
import { getLocale, resolveLocalePref, setLocale, t } from '../shared/i18n';
import { encodeClipboardImage } from './clipboardImage';
import { migrateLegacyUserData } from './userDataMigration';

if (started) {
  app.quit();
}

// 🔴 stdout/stderr 写失败免疫(用户报告 2026-07-23「write EIO」弹窗):从终端启动
// (npm start/electron-forge)的实例,父 shell/管道先死后,任何 console.log/error 都会
// 对已关闭的 fd 写入 → EPIPE/EIO 以 stream 'error' 事件抛出 → main 进程 Uncaught
// Exception 模态弹窗,还会卡住 app.quit。挂空 error 监听把「日志写不出去」降级为
// 静默丢弃——日志通道的死活永远不该决定应用进程的死活。
process.stdout?.on?.('error', () => undefined);
process.stderr?.on?.('error', () => undefined);

// DEV 渠道:npm start(未打包)或 make:dev 出的 "OkWork Dev" 包。
// 独立 userData、不查更新、UI 显示红色 DEV 徽标,与正式版可同时安装。
const isDevChannel = !app.isPackaged || app.getName().includes('Dev');
if (!app.isPackaged && !process.env.OKWORK_SMOKE) {
  // 🔴 app name 必须与 userData 一同隔离:macOS safeStorage 的钥匙串条目名随
  // app name 走("<name> Safe Storage")。此前 npm start 的 electron 二进制与
  // 正式签名的 OkWork.app 共用 "OkWork Safe Storage" 条目,签名不同 → 后启动的
  // 一方每次触发钥匙串授权弹框;点「拒绝」/错过弹框的那个会话里密码存不进也
  // 读不出(0.3.59 实测:全部主机误报「认证失败」+ Save 静默失败)。
  // 注意:改名当天 dev 侧旧密文(曾用 OkWork 条目密钥加密)解不开一次,重输即可。
  app.setName('OkWork-Dev');
  app.setPath('userData', path.join(app.getPath('appData'), 'OkWork-Dev'));
}

// 冒烟模式用独立 userData:不污染真实布局存档,且结果可复现
if (process.env.OKWORK_SMOKE) {
  app.setPath('userData', path.join(os.tmpdir(), 'okwork-smoke'));
}

// 品牌改名(TermPro → OkWork)一次性迁移:旧 userData 整目录搬到新路径。
// 必须先于单实例锁与一切 userData 读写;冒烟模式用独立临时目录,无需迁移。
if (!process.env.OKWORK_SMOKE) {
  const legacyName = !app.isPackaged
    ? 'TermPro-Dev'
    : app.getName().includes('Dev')
      ? 'TermPro Dev'
      : 'TermPro';
  migrateLegacyUserData(
    path.join(app.getPath('appData'), legacyName),
    app.getPath('userData'),
  );
}

// 单实例锁(按 userData 区分:dev 与正式版可共存,各自只跑一个);
// 二次启动直接退出,已有实例把主窗口拉到前台
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    app.focus({ steal: true });
  });
}

let mainWin: BrowserWindow | null = null;
// 文件内容窗口:按 hostId 一窗('local' = 本机嵌入 host;远程 = configId)。
// 查看器渲染进程的 hostClient 单例只能连一台 host,跨 host 的 tab 混窗必然误路由,
// 故窗口键 = hostId,同 host 多文件仍复用同一窗多 tab。
const fileWins = new Map<string, BrowserWindow>();
let diffWin: BrowserWindow | null = null;

// 浏览器分区判定:profile × 出口 二维(阶段2)——白名单/本机直连集合/组合分区枚举
// 单源在 browserPartitionPolicy(下方 store 声明后创建;wireBrowserWebviewPolicies
// 等使用点都在 ready 之后,不存在 TDZ)。

// .md 文件关联:双击 md / 「打开方式」选 OkWork → 查看器窗口打开。
// macOS 冷启动时 open-file 可能早于 ready,先入队,ready 后统一打开(openFileWindow
// 为函数声明,已提升,此处引用安全)。
let appIsReady = false;
const pendingOpenPaths: string[] = [];
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (appIsReady) openFileWindow(filePath, 'file');
  else pendingOpenPaths.push(filePath);
});

const exitConfirmation = createExitConfirmationCoordinator({
  shouldBypass: () => shouldBypassExitConfirmation(),
  showMessageBox(parent, options) {
    const win = parent instanceof BrowserWindow ? parent : undefined;
    if (win && !win.isDestroyed()) return dialog.showMessageBox(win, options);
    return dialog.showMessageBox(options);
  },
});
const exitLifecycle = new ExitLifecycleController(
  (request, parent) => exitConfirmation.confirm(request, parent),
  () => shouldBypassExitConfirmation(),
  (message) => console.log(message),
);

function confirmationParentWindow(): BrowserWindow | undefined {
  return mainWin ?? BrowserWindow.getFocusedWindow() ?? undefined;
}

registerAppStore();
app.on('before-quit', () => {
  exitLifecycle.handleAppBeforeQuit();
});

// ---- 远程机 SSH 编排(BL-003)---------------------------------------------
// main 是 SSH 编排的唯一落点(renderer/host 零 SSH);orchestrator 持有全部
// 隧道/ssh 连接,before-quit 必须收尾关闭,否则残留本地转发 server 占端口。

// A6:远端 host 进程的 Origin 白名单(逗号分隔,host.ts 侧按此格式解析)——打包态
// 只有 file://+null;dev 态渲染层走 vite dev server,追加其 origin 一并放行。
function computeRemoteHostAllowedOrigins(): string {
  const origins = ['null', 'file://'];
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      origins.push(new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin);
    } catch {
      /* 解析失败(极端情形下 dev server URL 格式异常):保留基础白名单,不阻断启动 */
    }
  }
  return origins.join(',');
}

const remoteHostCredentials = new CredentialStore({
  userDataDir: () => app.getPath('userData'),
  safeStorage,
});
const remoteHostConfigStore = new HostConfigStore({
  userDataDir: () => app.getPath('userData'),
});
// 浏览器 Profile 台账(权威在 main;存储走 SettingsStore 抽象——未来账号绑定换实现)
const browserProfileStore = new BrowserProfileStore(
  new JsonFileSettingsStore({
    userDataDir: () => app.getPath('userData'),
    file: 'browser-profiles.json',
  }),
);
// 分区策略:白名单双确认(profile/config 存在性)+ 本机直连集合 + 组合分区枚举
const browserPartitionPolicy = createBrowserPartitionPolicy({
  hasProfile: (id) => browserProfileStore.get(id) !== null,
  hasRemoteConfig: (id) => remoteHostConfigStore.get(id) !== null,
  listProfileIds: () => browserProfileStore.list().map((p) => p.id),
});
const remoteHostOrchestrator = new RemoteHostOrchestrator({
  connectSsh: SshConnection.connect,
  credentials: remoteHostCredentials,
  configStore: remoteHostConfigStore,
  bundleDir: (arch) =>
    resolveBundleDir(arch, {
      resourcesPath: app.isPackaged ? process.resourcesPath : app.getAppPath(),
      isPackaged: app.isPackaged,
    }),
  appVersion: app.getVersion(),
  allowedOrigins: computeRemoteHostAllowedOrigins(),
});
// E8:事件(含 verifying 阶段的隧道 token)只推给主窗口——getter 而非固定引用,
// 因为此刻主窗口可能尚未创建(createWindow() 在 app.on('ready') 里才跑)。
registerRemoteHostIpc(
  remoteHostOrchestrator,
  remoteHostCredentials,
  remoteHostConfigStore,
  () => mainWin,
  // tunnel 请求方归属校验(P2-1 纵深防御):token 只发给主窗口(管理面)、该 hostId
  // 自己的文件查看器窗口、或正在展示该 host diff 的模态窗;其余一律 null。
  (sender, configId) => {
    const win = BrowserWindow.fromWebContents(sender);
    if (!win) return false;
    if (win === mainWin) return true;
    if (win === fileWins.get(configId)) return true;
    return win === diffWin && configId === diffWinHostId;
  },
  // 删除远程机(显式意图):若它是当前浏览器出口 → 回 local(断线本身不再自动回退)
  (configId) => browserNetwork.onHostRemoved(configId),
  // 新增远程机:黑洞预封其浏览器分区(评审 P1-1,消灭首个 guest fail-open 窗口)
  (configId) => browserNetwork.preseal([configId]),
);
// ---- 内置浏览器网络出口(browserNet · 标签级/多分区)-------------------------
// 出口→分区:local=persist:browser 直连;每台在用远程机=persist:browser-<configId>
// 独立分区,恒 socks5 + <-loopback>。renderer 声明式上报在用出口集合,控制器对账。
const browserNetwork = new BrowserNetworkController({
  setProxy: (partition, rules) =>
    session.fromPartition(partition).setProxy(
      rules === null
        ? { mode: 'direct' }
        : {
            proxyRules: rules,
            // 🔴 <-loopback>:撤销 Chromium 对 localhost/127.0.0.1/[::1] 的【隐式代理
            // 豁免】(用户报告 2026-07-14「访问 localhost 没反应也没报错」根因)。
            // 不撤销时 localhost 恒直连【本机】,而「走远程出口」的核心场景恰是访问
            // 远程机上的 dev server(remote localhost)——必须让 loopback 也进 SOCKS,
            // 由远端 sshd 解析 localhost(远程回环)。代理 server 自身连接不受此规则影响。
            proxyBypassRules: '<-loopback>',
          },
    ),
  browserProxyFor: (configId) => remoteHostOrchestrator.browserProxyFor(configId),
  releaseBrowserProxy: (configId) => remoteHostOrchestrator.releaseBrowserProxy(configId),
  // 组合分区集合(profile × 该出口;调用期取值,profile 增删后自动变新)
  partitionsOf: (configId) => browserPartitionPolicy.partitionsOfExit(configId),
  aliasOf: (configId) => remoteHostConfigStore.get(configId)?.alias,
  emitChanged: (snapshot) => {
    // 广播到所有窗口:主窗 + 弹出的窗格壳窗(各自的出口选择器都要收 down/恢复)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(BROWSER_NET_CHANNELS.changed, snapshot);
      }
    }
  },
});

// 启动黑洞预封(评审 P1-1):所有已存远程机的浏览器分区先落黑洞代理,消灭
// 「hydrate 回来的远程标签在 acquire 前 attach → 走本机直连」的 fail-open 窗口。
void browserNetwork.preseal(remoteHostConfigStore.list().map((c) => c.id));

// 在用出口的远程机断开 → 该分区标 down(fail-closed,不回退直连——用户指令 2026-07-14
// 「远程 tab 的浏览器不要自动切 local」:静默换出口=流量从本机 IP 泄漏 + localhost
// 语义突变);重连 ready → 自动重建 SOCKS 恢复。orchestrator.onEvent 多播,与
// registerRemoteHostIpc 的事件推送各自独立订阅,职责不同不合并。
remoteHostOrchestrator.onEvent((e) => {
  if (e.stage === 'disconnected' || e.stage === 'failed') {
    browserNetwork.onHostDown(e.configId);
  } else if (e.stage === 'ready') {
    browserNetwork.onHostUp(e.configId);
  }
});

// syncExits 仅主窗口可报(浏览器面板在主窗口;拒绝其它渲染进程改代理拓扑);
// get 无副作用任意窗口可读。
ipcMain.handle(BROWSER_NET_CHANNELS.syncExits, (event, payload: { hostIds: string[] }) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWin) {
    return browserNetwork.snapshot();
  }
  return browserNetwork.syncExits(Array.isArray(payload?.hostIds) ? payload.hostIds : []);
});
ipcMain.handle(BROWSER_NET_CHANNELS.get, () => browserNetwork.snapshot());

// ---- 浏览器 Profile IPC(权威在 main;增删改后广播全量列表)-------------------
// 变更只许主窗口发起(设置 UI 在主窗;拒绝其它渲染进程改 profile 台账);list 只读随意。
function broadcastBrowserProfiles(): void {
  const profiles = browserProfileStore.list();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(BROWSER_PROFILE_CHANNELS.changed, profiles);
    }
  }
}
ipcMain.handle(BROWSER_PROFILE_CHANNELS.list, () => browserProfileStore.list());
ipcMain.handle(BROWSER_PROFILE_CHANNELS.save, async (event, payload: BrowserProfileInput) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWin) {
    throw new Error('browserProfile.save: main window only');
  }
  const saved = browserProfileStore.save(payload);
  // 🔴 顺序即安全(评审 P1,与 P1-1 同源):新增 profile ⇒ 各远程出口的组合分区集合
  // 变大,必须【先 await 预封完成】(在用且 up 的重放活代理覆盖新分区,其余全量黑洞),
  // 再广播/返回——否则 renderer 拿到新 profile 即可把远程标签重挂到尚无代理的新组合
  // 分区,首个 attach 从本机直连泄漏(fail-open 窗口)。更新(改名/改 UA)不影响代理
  // 拓扑,重放幂等无害,不做区分。
  await browserNetwork.onProfilesChanged(remoteHostConfigStore.list().map((c) => c.id));
  broadcastBrowserProfiles();
  return saved;
});
ipcMain.handle(BROWSER_PROFILE_CHANNELS.delete, (event, payload: { id: string }) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWin) {
    throw new Error('browserProfile.delete: main window only');
  }
  const id = typeof payload?.id === 'string' ? payload.id : '';
  // partitionsOfProfile 只依赖给定 id 与 config 列表(不查 profile 存在性),故删除后
  // 仍可枚举清盘;白名单则从删除一刻起拒绝该 profile 的新 attach。
  const removed = browserProfileStore.delete(id);
  if (!removed) return;
  broadcastBrowserProfiles();
  // 删除语义 = 清盘(用户可见文案已明示):该 profile 全部组合分区的存储/缓存清空,
  // 防孤儿数据堆积。webview 若仍在挂(renderer 对账回落 default 前的窗口期),清的
  // 是活 session——无害,标签随对账重挂到 default 分区。
  for (const partition of browserPartitionPolicy.partitionsOfProfile(
    id,
    remoteHostConfigStore.list().map((c) => c.id),
  )) {
    const ses = session.fromPartition(partition);
    void ses
      .clearStorageData()
      .then(() => ses.clearCache())
      .catch((err) => console.error('[main] profile partition clear failed:', err));
  }
});

// ---- 浏览器窗格窗口化(弹出=整个窗格独立成窗 · OkBrowser · <终端tab名>)---------
// 壳窗复用 renderer bundle(?browserPane=<terminalTabId> 路由 BrowserPaneShellWindow):
// 头部条(标题/回落)+ 完整 BrowserPanel(标签条/地址栏/出口选择器/webview 按标签分区)。
// 状态所有权:弹出期间壳窗 store 独占,内容经 browserPane:sync 单向回流主窗镜像
// (主窗承担持久化与出口对账);主窗侧的新增(终端链接等)经 addTab relay 进壳窗。
// 关闭两路(用户指令 2026-07-23):回落按钮 → dock → closed → docked(保留镜像、
// 开面板);红灯钮/标签关光 → closed → browserPane:closed(清空镜像,不回落),
// 多标签先弹「关闭所有标签」确认(决策纯函数见 browserPaneClose.ts)。

interface BrowserPaneSeed {
  terminalTabId: string;
  tabName: string;
  ownerHostId: string;
  /** 所属 workspace 名(壳窗的工作区编辑弹层用) */
  workspaceName?: string;
  /** 所属 ws 的浏览器 profile 绑定(缺省 = 默认 profile;壳窗按此分区挂 webview) */
  browserProfileId?: string;
  pane: unknown;
}
const paneWins = new Map<string, BrowserWindow>();
const paneSeeds = new Map<string, BrowserPaneSeed>();
/** 回落发起的关闭(browserPane:dock)在 close/closed 里免确认、走 docked 通知 */
const paneDockRequests = new Set<string>();

ipcMain.on('browserPane:popout', (event, payload: BrowserPaneSeed) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWin) return; // 仅主窗口可弹
  const tabId = payload?.terminalTabId;
  if (typeof tabId !== 'string' || !tabId) return;
  paneSeeds.set(tabId, payload);
  const existing = paneWins.get(tabId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: '#1e2227',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // 壳窗渲染窗格 webview(分区跟标签走)
      additionalArguments: [
        ...buildAdditionalArguments({
          version: app.getVersion(),
          smoke: false,
          dev: isDevChannel,
          locale: getLocale(),
        }),
        `--okwork-browser-pane=${tabId}`,
      ],
    },
  });
  paneWins.set(tabId, win);
  installExternalUrlPolicy(win, { devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL });
  wireBrowserWebviewPolicies(win); // webview 硬化/WebRTC/弹窗策略与主窗同级
  // 红灯钮(非回落)关闭:多标签先确认「关闭所有标签」;app 退出/冒烟不拦
  // (退出时镜像要原样持久化)。确认后二次 close() 经 closeConfirmed 放行。
  let closeConfirming = false;
  let closeConfirmed = false;
  win.on('close', (e) => {
    const action = decidePaneClose({
      quitting: exitLifecycle.isQuitting(),
      bypass: shouldBypassExitConfirmation(),
      dockRequested: paneDockRequests.has(tabId),
      confirmed: closeConfirmed,
      confirming: closeConfirming,
      tabCount: paneTabCount(paneSeeds.get(tabId)?.pane),
    });
    if (action === 'proceed') return;
    e.preventDefault();
    if (action === 'ignore') return;
    closeConfirming = true;
    void dialog
      .showMessageBox(win, buildPaneCloseConfirmationOptions(paneTabCount(paneSeeds.get(tabId)?.pane)))
      .then(({ response }) => {
        if (response !== PANE_CLOSE_CONFIRM_INDEX || win.isDestroyed()) return;
        closeConfirmed = true;
        win.close();
      })
      .catch((err) => console.error('[main] pane close confirm failed:', err))
      .finally(() => {
        closeConfirming = false;
      });
  });
  win.on('closed', () => {
    const dockRequested = paneDockRequests.delete(tabId);
    if (paneWins.get(tabId) === win) paneWins.delete(tabId);
    paneSeeds.delete(tabId);
    // 回落 → docked(保留镜像、开面板);直接关 → closed(清空镜像);退出中不通知
    const notice = paneClosedNotice({ dockRequested, quitting: exitLifecycle.isQuitting() });
    if (notice && mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(notice, tabId);
    }
  });
  const query = { browserPane: tabId };
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?browserPane=${encodeURIComponent(tabId)}`,
    );
  } else {
    void win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query },
    );
  }
});

// 壳窗取种子:只允许「该 tabId 对应的壳窗」自己取(窗口身份即凭据)
ipcMain.handle('browserPane:state', (event, payload: { terminalTabId?: string }) => {
  const tabId = payload?.terminalTabId;
  if (!tabId || BrowserWindow.fromWebContents(event.sender) !== paneWins.get(tabId)) {
    return null;
  }
  return paneSeeds.get(tabId) ?? null;
});

// 壳窗内容回流 → 主窗镜像;种子同步更新(壳窗意外重载时可用最新内容重种)
ipcMain.on(
  'browserPane:sync',
  (event, payload: { terminalTabId?: string; pane?: unknown }) => {
    const tabId = payload?.terminalTabId;
    if (!tabId || BrowserWindow.fromWebContents(event.sender) !== paneWins.get(tabId)) {
      return;
    }
    const seed = paneSeeds.get(tabId);
    if (seed) paneSeeds.set(tabId, { ...seed, pane: payload.pane });
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('browserPane:sync', {
        terminalTabId: tabId,
        pane: payload.pane,
      });
    }
  },
);

// 主窗转投新标签(终端链接点到已弹出的窗格)→ 壳窗
ipcMain.on(
  'browserPane:addTab',
  (event, payload: { terminalTabId?: string; url?: string }) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWin) return;
    const tabId = payload?.terminalTabId;
    const url = payload?.url;
    if (!tabId || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const win = paneWins.get(tabId);
    if (win && !win.isDestroyed()) {
      win.show();
      win.webContents.send('browserPane:addTab', url);
    }
  },
);

// 开机对账(主窗重载/崩溃自愈后 poppedOut 视图态已丢):在开壳窗清单,主窗补标记
ipcMain.handle('browserPane:list', (event) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWin) return [];
  return [...paneWins.keys()];
});

// 激活(工具栏图标点击:弹出后图标=聚焦独立窗口)
ipcMain.on('browserPane:focus', (event, payload: { terminalTabId?: string }) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWin) return;
  const win = payload?.terminalTabId ? paneWins.get(payload.terminalTabId) : undefined;
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
});

// 回落:壳窗自己(回落按钮)或主窗都可发起;设回落标记走 close → closed → docked 通知
ipcMain.on('browserPane:dock', (event, payload: { terminalTabId?: string }) => {
  const tabId = payload?.terminalTabId;
  if (!tabId) return;
  const win = paneWins.get(tabId);
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender !== mainWin && sender !== win) return;
  if (win && !win.isDestroyed()) {
    paneDockRequests.add(tabId);
    win.close();
  }
});

// 种子的 profile 绑定跟随变更(壳窗意外重载时按新绑定重种,不回落旧分区)
function updateSeedProfile(tabId: string, profileId: string): void {
  const seed = paneSeeds.get(tabId);
  if (!seed) return;
  if (profileId && profileId !== DEFAULT_PROFILE_ID) {
    paneSeeds.set(tabId, { ...seed, browserProfileId: profileId });
  } else {
    const { browserProfileId: _dropped, ...rest } = seed;
    paneSeeds.set(tabId, rest);
  }
}

// 壳窗内工作区编辑保存(改名/换 profile)→ 转主窗权威 store 应用(改名走 host RPC,
// 绑定持久化);发起壳窗已本地生效,种子同步跟上
ipcMain.on(
  'browserPane:workspaceEdit',
  (event, payload: { terminalTabId?: string; name?: string; profileId?: string }) => {
    const tabId = payload?.terminalTabId;
    if (!tabId || BrowserWindow.fromWebContents(event.sender) !== paneWins.get(tabId)) {
      return;
    }
    if (typeof payload.profileId === 'string') updateSeedProfile(tabId, payload.profileId);
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('browserPane:workspaceEdit', {
        terminalTabId: tabId,
        ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
        ...(typeof payload.profileId === 'string' ? { profileId: payload.profileId } : {}),
      });
    }
  },
);

// 主窗改 profile 绑定 → 推给该终端 tab 的壳窗(壳窗换分区重挂 webview)
ipcMain.on(
  'browserPane:setProfile',
  (event, payload: { terminalTabId?: string; profileId?: string }) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWin) return;
    const tabId = payload?.terminalTabId;
    const profileId = payload?.profileId;
    if (!tabId || typeof profileId !== 'string') return;
    updateSeedProfile(tabId, profileId);
    const win = paneWins.get(tabId);
    if (win && !win.isDestroyed()) {
      win.webContents.send('browserPane:setProfile', profileId);
    }
  },
);

// 直接关闭:壳窗标签关光时自发(空窗格无形态)——不设回落标记,closed → browserPane:closed
ipcMain.on('browserPane:close', (event, payload: { terminalTabId?: string }) => {
  const tabId = payload?.terminalTabId;
  if (!tabId) return;
  const win = paneWins.get(tabId);
  if (!win || BrowserWindow.fromWebContents(event.sender) !== win) return;
  if (!win.isDestroyed()) win.close();
});

// ---- AI 浏览器控制桥(main 侧)----------------------------------------------
// main 的 MCP server(阶段2b)调 invokeBrowserControl(method,args)→ 发请求给主窗
// renderer(browserControl 在渲染层执行,它有 webview 元素 + store)→ 结果按 requestId
// 回收。渲染层白名单派发(browserControlBridge),此处只做请求路由 + 超时兜底。
const browserControlPending = new Map<
  string,
  {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    /** 该请求路由到的窗口(主窗 or 弹出壳窗)——只认它回传,防他窗/webview 冒充 */
    win: BrowserWindow;
  }
>();
const BROWSER_CONTROL_TIMEOUT_MS = 20_000;

ipcMain.on(
  'browserControl:result',
  (event, payload: { requestId?: string; ok?: boolean; value?: unknown; error?: string }) => {
    const id = payload?.requestId;
    const p = id ? browserControlPending.get(id) : undefined;
    if (!p || !id) return;
    // 只认当初路由到的那个窗口回传(主窗 or 该 tab 的壳窗),防他窗/guest 冒充
    if (BrowserWindow.fromWebContents(event.sender) !== p.win) return;
    browserControlPending.delete(id);
    clearTimeout(p.timer);
    if (payload.ok) p.resolve(payload.value);
    else p.reject(new Error(payload.error ?? 'browser control failed'));
  },
);

export function invokeBrowserControl(method: string, args: unknown[]): Promise<unknown> {
  // 目标窗口:该终端 tab 的窗格若已弹出到独立壳窗(webview 活在壳窗)→ 打到壳窗;
  // 否则主窗。args[0] 恒为 terminalTabId(MCP buildArgs 首参)。
  const tabId = typeof args[0] === 'string' ? args[0] : undefined;
  const paneWin = tabId ? paneWins.get(tabId) : undefined;
  const target = paneWin && !paneWin.isDestroyed() ? paneWin : mainWin;
  if (!target || target.isDestroyed()) {
    return Promise.reject(new Error('browser control window not available'));
  }
  const requestId = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      browserControlPending.delete(requestId);
      reject(new Error(`browser control timeout: ${method}`));
    }, BROWSER_CONTROL_TIMEOUT_MS);
    browserControlPending.set(requestId, { resolve, reject, timer, win: target });
    target.webContents.send('browserControl:invoke', { requestId, method, args });
  });
}

// AI 浏览器控制 MCP server:起在本机随机端口,session 内 agent 经 /mcp/<terminalTabId>
// 连上驱动浏览器。base URL 经 env 注入终端(接线见 host spawn);冒烟/无网也不影响启动。
let browserMcp: BrowserMcpHandle | null = null;
void startBrowserMcpServer((method, args) => invokeBrowserControl(method, args))
  .then((h) => {
    browserMcp = h;
    console.log(`[main] browser MCP server listening on 127.0.0.1:${h.port}`);
    // 远程 host ready 时自动把本机 MCP 反向转发进容器(阶段3),含已 ready 的会话补建
    remoteHostOrchestrator.setBrowserMcpForward(h.port);
  })
  .catch((err) => console.error('[main] browser MCP failed to start:', err));

// 渲染层取 MCP base URL(本地 session spawn 时注入终端 env,让 agent 发现);未就绪 → null
ipcMain.handle('browserControl:mcp-base', () =>
  browserMcp ? `http://127.0.0.1:${browserMcp.port}` : null,
);

app.on('before-quit', () => {
  remoteHostOrchestrator.dispose();
});
initUpdater({
  confirmInstallWhenIdle: async (version) => {
    if (exitLifecycle.isQuitting()) return { status: 'canceled' } as const;
    return exitConfirmation.confirmWhenIdle(
      { kind: 'install-update', version },
      confirmationParentWindow(),
      () => exitLifecycle.isQuitting(),
    );
  },
  prepareToQuitAndInstall: () => {
    exitLifecycle.markQuitting();
  },
  rollbackQuitAndInstall: () => {
    exitLifecycle.resetQuitting();
  },
});

// ---- Host 进程(utilityProcess)----------------------------------------

let hostProc: Electron.UtilityProcess | null = null;

function ensureHost(): Electron.UtilityProcess {
  if (hostProc) return hostProc;
  // --standalone:本地 host 走 standalone 会话语义(断开 detach 续跑 + ring 回放收养),
  // renderer 崩溃/⌘R 重载不再杀本地会话(黑屏事故 2026-07-14 的数据丢失根因)。
  // host 进程仍随 app 退出整体回收,「退出即清」预期不变;回退 = 去掉此 flag。
  hostProc = utilityProcess.fork(path.join(__dirname, 'host.js'), ['--standalone'], {
    serviceName: 'okwork-host',
    // Workspace 注册表数据目录:local 模式 = userData(host 视其为不透明「本机注册表目录」,
    // 不知晓 Electron 路径 API,保持零 Electron / 远程就绪)
    env: {
      ...process.env,
      OKWORK_HOST_DATA_DIR: app.getPath('userData'),
      // host.info.appVersion 数据源(本机嵌入式恒与应用同版,仅保持上报一致性)
      OKWORK_HOST_APP_VERSION: app.getVersion(),
    },
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

// 终端链接:网页走默认浏览器(仅 http/https),路径走系统打开
ipcMain.on('shell:open-external', (_event, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    void shell.openExternal(url);
  }
});
ipcMain.on('shell:open-path', (_event, p: string) => {
  if (typeof p === 'string' && path.isAbsolute(p)) {
    void shell.openPath(p);
  }
});
// 在 Finder 中显示文件(打开所在目录并高亮)
ipcMain.on('shell:show-item-in-folder', (_event, p: string) => {
  if (typeof p === 'string' && path.isAbsolute(p)) {
    shell.showItemInFolder(p);
  }
});
// 本地 HTML 用系统默认浏览器打开(仅 .html/.htm,经 file:// URL)
ipcMain.on('shell:open-in-browser', (_event, p: string) => {
  if (typeof p === 'string' && path.isAbsolute(p) && /\.html?$/i.test(p)) {
    void shell.openExternal(pathToFileURL(p).href);
  }
});

// 原生拖出:文件面板把本地文件/目录拖到 Finder 等(OS 默认=复制)。
// startDrag 要求非空 icon 且须在拖拽手势期间同步调用,故用缓存图标。
let cachedDragIcon: Electron.NativeImage | null = null;
function dragIcon(): Electron.NativeImage {
  if (cachedDragIcon) return cachedDragIcon;
  const img = nativeImage.createFromPath(
    path.join(__dirname, '../../assets/icon.png'),
  );
  cachedDragIcon = img.isEmpty()
    ? // 兜底 1x1 透明像素(打包后相对路径可能取不到 icon;startDrag 不接受空 icon)
      nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      )
    : img.resize({ width: 32, height: 32 });
  return cachedDragIcon;
}
ipcMain.on('file:start-drag', (event, p: string) => {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return;
  event.sender.startDrag({ file: p, icon: dragIcon() });
});

// 剪贴板:沙箱 preload 里 clipboard 模块不可用,必须经 main
ipcMain.on('clipboard:write-text', (_event, text: string) => {
  if (typeof text === 'string') clipboard.writeText(text);
});
ipcMain.handle('clipboard:read-text', () => clipboard.readText());
ipcMain.handle('clipboard:read-image', () => encodeClipboardImage(clipboard.readImage()));

// 语言偏好切换(renderer Settings 发起):main 即时换语言并重建原生菜单。
// 偏好本体由 renderer 随 ui 存档持久化(下次启动 ready 时从存档读回)。
ipcMain.on('locale:set', (_event, pref: unknown) => {
  setLocale(
    resolveLocalePref(typeof pref === 'string' ? pref : null, app.getLocale()),
  );
  buildMenu();
});

// Tab 右键菜单:重命名/关闭
ipcMain.handle('tab:context-menu', (event) => {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const menu = Menu.buildFromTemplate([
      { label: t('Rename…'), click: () => done('rename') },
      { type: 'separator' },
      { label: t('Close Tab'), click: () => done('close') },
    ]);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    menu.popup({
      window: win,
      callback: () => setTimeout(() => done(null), 60),
    });
  });
});

// 终端右键菜单:渲染层报选区状态,这里弹原生菜单并回传动作
ipcMain.handle(
  'terminal:context-menu',
  (event, opts: { hasSelection: boolean }) => {
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (v: string | null) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      const menu = Menu.buildFromTemplate([
        {
          label: t('Copy'),
          enabled: !!opts?.hasSelection,
          click: () => done('copy'),
        },
        { label: t('Paste'), click: () => done('paste') },
        { type: 'separator' },
        { label: t('Select All'), click: () => done('selectAll') },
        { label: t('Clear Screen'), click: () => done('clear') },
      ]);
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      // callback 在菜单关闭时触发;延后一拍让 click 先落
      menu.popup({
        window: win,
        callback: () => setTimeout(() => done(null), 60),
      });
    });
  },
);

ipcMain.handle('dialog:pick-directory', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

// ---- 冒烟模式:OKWORK_SMOKE=1 时,渲染层完成 Host 握手即退出(CI 可用)----

if (process.env.OKWORK_SMOKE) {
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
// 主窗口(终端工作台)/ 文件内容窗口(按 hostId 一窗,多 tab,同 host 可编辑文件共用)/
// git diff 窗口(单例,模态挂主窗口;打开期间禁止再开任何查看窗口)。

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

function openFileWindow(
  filePath: string,
  kind: 'file' | 'dir' = 'file',
  hostId = 'local',
): void {
  const existing = fileWins.get(hostId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    const wc = existing.webContents;
    const tab = { path: filePath, kind };
    if (wc.isLoading()) {
      // 窗口冷启动尚未完成:渲染层还没订阅 add-tab,延迟到加载完成
      wc.once('did-finish-load', () => {
        if (!existing.isDestroyed()) {
          wc.send('viewer:add-tab', tab);
        }
      });
    } else {
      wc.send('viewer:add-tab', tab);
    }
    return;
  }
  const fileWin = new BrowserWindow({
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
      // 查看窗口沿用当前生效 locale(argv 注入,renderer 首帧前应用)
      additionalArguments: buildAdditionalArguments({
        version: app.getVersion(),
        smoke: false,
        dev: isDevChannel,
        locale: getLocale(),
      }),
    },
  });
  fileWins.set(hostId, fileWin);
  installExternalUrlPolicy(fileWin, {
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
  });
  fileWin.on('closed', () => {
    if (fileWins.get(hostId) === fileWin) fileWins.delete(hostId);
  });
  loadViewer(fileWin, {
    mode: 'files',
    initialPath: filePath,
    initialKind: kind,
    ...(hostId !== 'local' ? { hostId } : {}),
  });
}

// diff 模态当前服务的 hostId(本机 diff = null):tunnel 请求方归属校验用——
// host A 的 diff 窗口不得拉取 host B 的 token(P2-1 纵深防御)。
let diffWinHostId: string | null = null;

function openDiffWindow(payload: unknown): void {
  const payloadHostId = (payload as { hostId?: string } | undefined)?.hostId;
  diffWinHostId =
    typeof payloadHostId === 'string' && payloadHostId ? payloadHostId : null;
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
      additionalArguments: buildAdditionalArguments({
        version: app.getVersion(),
        smoke: false,
        dev: isDevChannel,
        locale: getLocale(),
      }),
    },
  });
  installExternalUrlPolicy(diffWin, {
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
  });
  diffWin.on('closed', () => {
    diffWin = null;
    diffWinHostId = null;
  });
  loadViewer(diffWin, payload);
}

ipcMain.on('viewer:open-window', (_event, payload: unknown) => {
  // diff 模态期间禁止再开任何查看窗口
  if (diffWin && !diffWin.isDestroyed()) {
    diffWin.focus();
    return;
  }
  const p = payload as
    | { mode?: string; path?: string; hostId?: string }
    | undefined;
  // hostId 缺省 = 本机(既有调用方零变化);远程 = workspace 的 configId
  const hostId = typeof p?.hostId === 'string' && p.hostId ? p.hostId : 'local';
  if (p?.mode === 'diff') {
    openDiffWindow(payload);
  } else if (p?.mode === 'file' && typeof p.path === 'string') {
    openFileWindow(p.path, 'file', hostId);
  } else if (p?.mode === 'dir' && typeof p.path === 'string') {
    openFileWindow(p.path, 'dir', hostId);
  }
});

// ---- 应用菜单:把 ⌘T/⌘W 从系统默认行为里解放出来交给渲染层 ----------------

function buildMenu(): void {
  const sendMenu = (action: string) => () =>
    BrowserWindow.getFocusedWindow()?.webContents.send('menu', action);
  const requestAppQuit = () => {
    exitLifecycle.requestAppQuit(app, confirmationParentWindow());
  };

  const appMenu = (): Electron.MenuItemConstructorOptions => ({
    label: app.getName(),
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      {
        label: t('Quit {name}', { name: app.getName() }),
        accelerator: 'Command+Q',
        click: requestAppQuit,
      },
    ],
  });

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [appMenu()] : []),
    {
      // 'Shell' 有意不译(终端术语,两端同文案)
      label: 'Shell',
      submenu: [
        {
          label: t('New Tab'),
          accelerator: 'CmdOrCtrl+T',
          click: sendMenu('new-tab'),
        },
        {
          label: t('Close Tab'),
          accelerator: 'CmdOrCtrl+W',
          click: sendMenu('close-tab'),
        },
        { type: 'separator' },
        {
          label: t('Close Window'),
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

/**
 * 内置浏览器 webview 的硬化与策略接线(主窗与浏览器窗格壳窗共用):
 * - 🔴 will-attach 硬化(opus 评审 P1):guest webPreferences 创建前锁定——即使 renderer
 *   被注入任意 HTML,也造不出带 node/自定义 preload 的 webview;初始 src 收口 http(s);
 *   分区白名单(profile × 出口 二维,单源 browserPartitionPolicy):只许【已知 profile
 *   × 已知出口】的组合分区,被注入的 renderer 不能借任意 partition 逃出浏览器分区体系。
 * - WebRTC 防泄漏静态化:远程分区恒代理 → attach 即 disable_non_proxied_udp
 *   (SOCKS5 只代理 TCP,UDP 会绕过代理暴露本机真实 IP);本机分区直连保持默认。
 * - 弹窗策略:target=_blank/window.open 恒不开原生新窗,http(s) 送回【本窗口】renderer
 *   在窗格里开新标签(附来源 guest id 定位归属);限频 300ms/guest 防灌爆(评审 P2-5)。
 * - 主框架导航只许 http(s)/about:(评审 P2-2)。
 */
function wireBrowserWebviewPolicies(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    delete (webPreferences as { preloadURL?: string }).preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (params.src && !/^https?:\/\//i.test(params.src)) event.preventDefault();
    if (!browserPartitionPolicy.isKnown(params.partition)) {
      event.preventDefault();
      return;
    }
    // 每分区 UA(profile 自定义;默认 profile 恒系统默认):attach 前设 session UA,
    // 覆盖 service worker 等 session 级请求;guest 首帧 UA 由 renderer 的 webview
    // useragent 属性另行兜底(双保险,见阶段3)。幂等,重复 attach 无副作用。
    // 🔴 清空 UA 必须【显式复位默认】(评审 P3-1):session.setUserAgent 会驻留旧值,
    // 只在有 UA 时 set 会让「把自定义 UA 清空」后 service worker 等 session 级请求仍用
    // 旧 UA 直到重启。用 app.userAgentFallback(Electron 的默认 UA)复位。
    const parsed = parseBrowserPartition(params.partition!);
    if (parsed && parsed.profileId !== DEFAULT_PROFILE_ID) {
      const ua = browserProfileStore.get(parsed.profileId)?.userAgent;
      session.fromPartition(params.partition!).setUserAgent(ua || app.userAgentFallback);
    }
  });
  win.webContents.on('did-attach-webview', (_event, guest) => {
    // WebRTC 防泄漏(fail-closed 方向):只有【已知本机直连分区】保持默认;
    // 其余(远程组合分区/一切未知)恒 disable_non_proxied_udp——SOCKS5 只代理 TCP,
    // UDP 会绕过代理暴露本机真实 IP。
    const isLocalDirect = browserPartitionPolicy
      .localDirectPartitions()
      .some((p) => guest.session === session.fromPartition(p));
    if (!isLocalDirect) {
      guest.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    }
    let lastOpenAt = 0;
    guest.setWindowOpenHandler(({ url }) => {
      const now = Date.now();
      if (/^https?:\/\//i.test(url) && !win.isDestroyed() && now - lastOpenAt > 300) {
        lastOpenAt = now;
        win.webContents.send('browser:open-url', url, guest.id);
      }
      return { action: 'deny' };
    });
    guest.on('will-navigate', (e, url) => {
      if (!/^(https?:|about:)/i.test(url)) e.preventDefault();
    });
  });
}

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
      // 内置浏览器面板用 <webview>(guest 独立进程,默认无 node)
      webviewTag: true,
      // 沙箱 preload 没有 process.env,冒烟开关经 argv 传递
      additionalArguments: buildAdditionalArguments({
        version: app.getVersion(),
        smoke: !!process.env.OKWORK_SMOKE,
        dev: isDevChannel,
        locale: getLocale(),
      }),
    },
  });
  installExternalUrlPolicy(mainWindow, {
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
  });
  wireBrowserWebviewPolicies(mainWindow);

  if (process.env.OKWORK_SMOKE || process.env.OKWORK_DEBUG) {
    // 冒烟/调试模式把渲染层 console 转发到 stdout;
    // OKWORK_DEBUG=1 用真实 userData,从 CLI 启动即可排查线上问题
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

  // 🔴 renderer 崩溃自愈(黑屏事故 2026-07-14):renderer 进程没了 Electron 不会重载窗口,
  // 不接这个事件就是永久黑屏。事故类退出自动 reload——本地会话由 standalone host detach
  // 续跑,reload 后 hydrate → readopt 回放,内容不丢;5 分钟超 3 次视为崩溃循环,停手
  // 留给用户 ⌘R(决策与限频逻辑在 rendererRecovery,per-window 计数)。
  const rendererRecovery = createRendererRecovery();
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    // 退出/安装重启进行中的进程消亡不当事故处理(评审 P3-3 纵深):此刻 reload 会与
    // 关停/Squirrel 安装竞争(还会重新 fork host)。正常退出路径本就是 clean-exit/killed,
    // 此闸只兜非常路径。
    if (exitLifecycle.isQuitting()) return;
    const decision = rendererRecovery.decide(details);
    console.error(
      `[main] renderer gone reason=${details.reason} exitCode=${details.exitCode} → ${decision}`,
    );
    if (mainWindow.isDestroyed()) return;
    if (decision === 'reload') {
      mainWindow.webContents.reload();
    } else if (decision === 'give-up') {
      // 🔴 give-up 不能静默(评审 P2-1):否则回到本里程碑要消灭的「黑屏 + 用户零反馈」
      // 终局。弹窗告知手动出路(⌘R 走 viewMenu role,不经本 handler,恒可用)。
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: t('OkWork keeps crashing'),
        message: t(
          'Automatic recovery was stopped after repeated crashes. Press ⌘R to retry manually; if it keeps failing, quit and relaunch OkWork.',
        ),
        buttons: [t('OK')],
        defaultId: 0,
        noLink: true,
      });
    }
  });
  // 成功加载即清零限频配额(评审 P3-2):限频只打「起即崩」风暴,
  // 不罚长会话里间隔发生、各自恢复成功的偶发崩溃。
  mainWindow.webContents.on('did-finish-load', () => rendererRecovery.reset());

  mainWin = mainWindow;
  mainWindow.on('close', (event) => {
    exitLifecycle.handleWindowClose(event, mainWindow);
  });
  mainWindow.on('closed', () => {
    if (mainWin === mainWindow) mainWin = null;
  });
};

// 子进程(GPU/network/utility)异常退出留现场:此类事故(尤其睡眠/唤醒期间)在系统
// unified log 常是空窗,事后无从取证——黑屏事故 2026-07-14 只能靠进程树反推。只记日志
// 不干预:GPU/网络服务 Chromium 会自行重启,host(utility)已有 exit 处理(host:down)。
app.on('child-process-gone', (_event, details) => {
  console.error(
    `[main] child process gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name ?? ''}`,
  );
});

app.on('ready', () => {
  // locale = 存档偏好(ui.locale)优先,缺省随系统(en 为源文案,zh 查字典)——
  // 须在 buildMenu/首窗创建/任何 dialog 之前定死(renderer 经 argv 拿同一值,无闪换)
  setLocale(resolveLocalePref(readPersistedLocalePref(), app.getLocale()));
  // dev 模式 Dock 图标(打包版由 packagerConfig.icon 提供)
  if (!app.isPackaged && process.platform === 'darwin') {
    const devIcon = path.join(__dirname, '../../assets/icon.png');
    if (fs.existsSync(devIcon)) app.dock?.setIcon(devIcon);
  }
  buildMenu();
  createWindow();
  // 冲刷启动前(open-file 早于 ready)入队的待打开文件
  appIsReady = true;
  for (const p of pendingOpenPaths.splice(0)) openFileWindow(p, 'file');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    exitLifecycle.markQuitting();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
