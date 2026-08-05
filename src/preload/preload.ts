import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { parseLocaleArg, parseVersionArg } from './parseVersionArg';
import { REMOTE_HOST_CHANNELS, BROWSER_NET_CHANNELS } from '../shared/remoteHost';
import { BROWSER_PROFILE_CHANNELS } from '../shared/browserProfile';
import type { BrowserProfile, BrowserProfileInput } from '../shared/browserProfile';
import type {
  BrowserNetworkSnapshot,
  RemoteEvent,
  RemoteHostCapabilities,
  RemoteHostConfig,
  RemoteHostConfigInput,
  RemoteStage,
  RemoteTunnelInfo,
  TestResult,
} from '../shared/remoteHost';

// 壳层 API:仅暴露与「本地 OS / 窗口」相关的能力。
// 一切工程数据(fs/pty/git)走 HostService 协议,不经过这里。
contextBridge.exposeInMainWorld('okwork', {
  platform: process.platform,
  smoke: process.argv.includes('--okwork-smoke'),
  devChannel: process.argv.includes('--okwork-dev'),
  version: parseVersionArg(process.argv),
  /** 窗口创建时 main 已解析的生效 locale(renderer 首帧前应用) */
  locale: parseLocaleArg(process.argv),
  /** 语言偏好切换 → main 即时换语言并重建原生菜单(偏好本体随 ui 存档持久化) */
  setAppLocale(pref: 'system' | 'en' | 'zh-CN'): void {
    ipcRenderer.send('locale:set', pref);
  },
  /** 请求 main 建一条直连 Host 的 MessageChannel,port 经 window message 送达 */
  requestHostPort(): void {
    ipcRenderer.send('host:request-port');
  },
  pickDirectory(): Promise<string | null> {
    return ipcRenderer.invoke('dialog:pick-directory');
  },
  /** 订阅原生菜单动作(new-tab / close-tab),返回退订函数 */
  onMenu(callback: (action: string) => void): () => void {
    const listener = (_e: unknown, action: string) => callback(action);
    ipcRenderer.on('menu', listener);
    return () => {
      ipcRenderer.removeListener('menu', listener);
    };
  },
  smokeOk(): void {
    ipcRenderer.send('smoke:ok');
  },
  storeGet(): Promise<unknown> {
    return ipcRenderer.invoke('store:get');
  },
  storeSet(state: unknown): void {
    ipcRenderer.send('store:set', state);
  },
  /** 迁移前把 v1 存档(state.json)复制为备份;失败 reject → 计入迁移失败 */
  backupV1Archive(): Promise<void> {
    return ipcRenderer.invoke('store:backup-v1');
  },
  setDockBadge(count: number): void {
    ipcRenderer.send('dock:badge', count);
  },
  /** 订阅更新事件(available/downloading/confirming/restarting/error),返回退订函数 */
  onUpdateEvent(
    callback: (e: { state: string; version?: string; percent?: number }) => void,
  ): () => void {
    const listener = (
      _e: unknown,
      payload: { state: string; version?: string; percent?: number },
    ) => callback(payload);
    ipcRenderer.on('update:event', listener);
    ipcRenderer.send('update:query');
    return () => {
      ipcRenderer.removeListener('update:event', listener);
    };
  },
  installUpdate(): void {
    ipcRenderer.send('update:install');
  },
  /** 终端右键菜单:返回用户选择的动作(copy/paste/selectAll/clear/null) */
  showTerminalContextMenu(opts: {
    hasSelection: boolean;
  }): Promise<string | null> {
    return ipcRenderer.invoke('terminal:context-menu', opts);
  },
  /** Tab 右键菜单:返回动作(rename/close/null) */
  showTabContextMenu(): Promise<string | null> {
    return ipcRenderer.invoke('tab:context-menu');
  },
  clipboardWriteText(text: string): void {
    ipcRenderer.send('clipboard:write-text', text);
  },
  /** 交回 Chromium 原生 Copy 编辑命令(⌘C 不落在终端选区时的兜底 · 见 menuCopy.ts) */
  nativeCopy(): void {
    ipcRenderer.send('clipboard:native-copy');
  },
  clipboardReadText(): Promise<string> {
    return ipcRenderer.invoke('clipboard:read-text');
  },
  /** 本机系统剪贴板图片统一编码成 PNG;空剪贴板返回 null。 */
  clipboardReadImage(): Promise<{ base64: string; size: number } | null> {
    return ipcRenderer.invoke('clipboard:read-image');
  },
  openExternal(url: string): void {
    ipcRenderer.send('shell:open-external', url);
  },
  // AI 浏览器控制桥(main↔renderer):main 的 MCP server 收到工具调用 → 经此桥
  // 请求渲染层 browserControl 执行 → 结果回传。控制在渲染层(有 webview 元素 + store)。
  browserControl: {
    /** 渲染层订阅 main 的控制请求(initBrowserControlBridge 用),返回退订函数 */
    onInvoke(
      callback: (req: { requestId: string; method: string; args: unknown[] }) => void,
    ): () => void {
      const listener = (
        _e: unknown,
        req: { requestId: string; method: string; args: unknown[] },
      ) => callback(req);
      ipcRenderer.on('browserControl:invoke', listener);
      return () => ipcRenderer.removeListener('browserControl:invoke', listener);
    },
    /** 渲染层回传执行结果 */
    sendResult(payload: {
      requestId: string;
      ok: boolean;
      value?: unknown;
      error?: string;
    }): void {
      ipcRenderer.send('browserControl:result', payload);
    },
    /** MCP server base URL(本地 session spawn 注入终端 env 用);未就绪 → null */
    mcpBase(): Promise<string | null> {
      return ipcRenderer.invoke('browserControl:mcp-base');
    },
  },
  /** 壳窗身份:本窗口若是弹出的浏览器窗格窗口,值 = 其终端 tabId(argv 注入);主窗 undefined */
  browserPaneTabId: (() => {
    const arg = process.argv.find((a) => a.startsWith('--okwork-browser-pane='));
    return arg ? arg.slice('--okwork-browser-pane='.length) : undefined;
  })(),
  // 窗格窗口化(弹出=整个窗格独立成窗;壳窗内容经 sync 单向回流主窗 store)
  browserPane: {
    /** 主窗:弹出某终端 tab 的窗格为独立窗口(携带完整窗格快照种壳窗) */
    popout(payload: {
      terminalTabId: string;
      tabName: string;
      ownerHostId: string;
      workspaceName?: string;
      pane: unknown;
    }): void {
      ipcRenderer.send('browserPane:popout', payload);
    },
    /** 壳窗:取本窗的窗格种子(终端 tab 名/所属机器/窗格快照) */
    getState(terminalTabId: string): Promise<unknown> {
      return ipcRenderer.invoke('browserPane:state', { terminalTabId });
    },
    /** 壳窗:窗格内容变化回流(主窗镜像 → 持久化/出口对账) */
    sync(terminalTabId: string, pane: unknown): void {
      ipcRenderer.send('browserPane:sync', { terminalTabId, pane });
    },
    /** 主窗:订阅壳窗回流,返回退订函数 */
    onSync(callback: (terminalTabId: string, pane: unknown) => void): () => void {
      const listener = (_e: unknown, p: { terminalTabId: string; pane: unknown }) =>
        callback(p.terminalTabId, p.pane);
      ipcRenderer.on('browserPane:sync', listener);
      return () => ipcRenderer.removeListener('browserPane:sync', listener);
    },
    /** 主窗:把 url 转投给已弹出窗格(终端链接点击/文件面板预览等);opts 透传
     *  netHostId/preview(预览标签出口钉死语义需要跟着标签走到壳窗)。 */
    addTab(
      terminalTabId: string,
      url: string,
      opts?: { netHostId?: string; preview?: true },
    ): void {
      ipcRenderer.send('browserPane:addTab', { terminalTabId, url, ...opts });
    },
    /** 壳窗:订阅主窗转投的新标签请求,返回退订函数(旧形态只传 url 时 opts 为空对象,
     *  callback 收 undefined 字段,向后兼容——见 sanitizeSeed 同款防御性收窄惯例) */
    onAddTab(
      callback: (url: string, opts?: { netHostId?: string; preview?: true }) => void,
    ): () => void {
      const listener = (
        _e: unknown,
        p: { url: string; netHostId?: string; preview?: true },
      ) => callback(p.url, { netHostId: p.netHostId, preview: p.preview });
      ipcRenderer.on('browserPane:addTab', listener);
      return () => ipcRenderer.removeListener('browserPane:addTab', listener);
    },
    /** 主窗:在开壳窗清单(开机对账——主窗重载后补 poppedOut 标记,防同窗格双载) */
    list(): Promise<string[]> {
      return ipcRenderer.invoke('browserPane:list');
    },
    /** 主窗:激活(聚焦)某终端 tab 的窗格窗口 */
    focus(terminalTabId: string): void {
      ipcRenderer.send('browserPane:focus', { terminalTabId });
    },
    /** 壳窗/主窗:回落——关闭壳窗(走 closed → docked 通知,镜像保留) */
    dock(terminalTabId: string): void {
      ipcRenderer.send('browserPane:dock', { terminalTabId });
    },
    /** 主窗:订阅「窗格已回落」(回落按钮发起),返回退订函数 */
    onDocked(callback: (terminalTabId: string) => void): () => void {
      const listener = (_e: unknown, terminalTabId: string) => callback(terminalTabId);
      ipcRenderer.on('browserPane:docked', listener);
      return () => ipcRenderer.removeListener('browserPane:docked', listener);
    },
    /** 壳窗:直接关闭本窗(标签关光的自发关闭;不回落,走 closed → browserPane:closed) */
    close(terminalTabId: string): void {
      ipcRenderer.send('browserPane:close', { terminalTabId });
    },
    /** 主窗:订阅「窗格窗口被直接关闭」(红灯钮/标签关光)——据此清空该窗格镜像 */
    onClosed(callback: (terminalTabId: string) => void): () => void {
      const listener = (_e: unknown, terminalTabId: string) => callback(terminalTabId);
      ipcRenderer.on('browserPane:closed', listener);
      return () => ipcRenderer.removeListener('browserPane:closed', listener);
    },
    /** 壳窗:工作区编辑保存(改名/换 profile)→ 主窗权威 store 应用并持久化 */
    workspaceEdit(terminalTabId: string, patch: { name: string; profileId: string }): void {
      ipcRenderer.send('browserPane:workspaceEdit', { terminalTabId, ...patch });
    },
    /** 主窗:订阅壳窗发起的工作区编辑,返回退订函数 */
    onWorkspaceEdit(
      callback: (terminalTabId: string, patch: { name?: string; profileId?: string }) => void,
    ): () => void {
      const listener = (
        _e: unknown,
        p: { terminalTabId: string; name?: string; profileId?: string },
      ) => callback(p.terminalTabId, { name: p.name, profileId: p.profileId });
      ipcRenderer.on('browserPane:workspaceEdit', listener);
      return () => ipcRenderer.removeListener('browserPane:workspaceEdit', listener);
    },
    /** 主窗:把 profile 绑定变更推给某终端 tab 的壳窗(壳窗换分区重挂) */
    setProfile(terminalTabId: string, profileId: string): void {
      ipcRenderer.send('browserPane:setProfile', { terminalTabId, profileId });
    },
    /** 壳窗:订阅主窗推来的 profile 绑定变更,返回退订函数 */
    onSetProfile(callback: (profileId: string) => void): () => void {
      const listener = (_e: unknown, profileId: string) => callback(profileId);
      ipcRenderer.on('browserPane:setProfile', listener);
      return () => ipcRenderer.removeListener('browserPane:setProfile', listener);
    },
  },
  // 主窗浏览器面板头部 ✕ 三态确认(Cancel/Close All/Hide),与壳窗红灯钮同款文案/阈值
  browserPanel: {
    /** 多标签时弹三态确认框(main 侧按 tabCount 判定标题/文案),返回用户选择 */
    confirmClose(tabCount: number): Promise<'cancel' | 'closeAll' | 'hide'> {
      return ipcRenderer.invoke('browserPanel:confirmClose', { tabCount });
    },
  },
  /** 订阅内置浏览器新开标签请求(webview 内 target=_blank/window.open),返回退订函数;
   *  sourceWebContentsId 为来源 guest 的 webContents id(renderer 据此落位来源终端 tab) */
  onBrowserOpenUrl(callback: (url: string, sourceWebContentsId: number) => void): () => void {
    const listener = (_e: unknown, url: string, sourceWebContentsId: number) =>
      callback(url, sourceWebContentsId);
    ipcRenderer.on('browser:open-url', listener);
    return () => {
      ipcRenderer.removeListener('browser:open-url', listener);
    };
  },
  openPath(path: string): void {
    ipcRenderer.send('shell:open-path', path);
  },
  /** 在 Finder 中显示文件(打开所在目录并高亮) */
  showItemInFolder(path: string): void {
    ipcRenderer.send('shell:show-item-in-folder', path);
  },
  /** 在独立窗口打开查看器(file/diff),不占用主视图 */
  openViewerWindow(payload: unknown): void {
    ipcRenderer.send('viewer:open-window', payload);
  },
  /** 文件内容窗口:订阅"追加 tab"指令(窗口复用),返回退订函数 */
  onViewerAddTab(
    callback: (tab: { path: string; kind: 'file' | 'dir'; previewRoot?: string }) => void,
  ): () => void {
    const listener = (
      _e: unknown,
      tab: { path: string; kind: 'file' | 'dir'; previewRoot?: string },
    ) => callback(tab);
    ipcRenderer.on('viewer:add-tab', listener);
    return () => {
      ipcRenderer.removeListener('viewer:add-tab', listener);
    };
  },
  focusWindow(): void {
    ipcRenderer.send('window:focus-self');
  },
  /** 取拖入 File 的真实磁盘路径(Electron webUtils;file.path 已废弃) */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  /** 发起原生拖出:把本地文件/目录拖到 Finder 等(OS 默认=复制) */
  startFileDrag(path: string): void {
    ipcRenderer.send('file:start-drag', path);
  },
  // 远程机管理与连接编排(BL-003)· 通道名单源 = shared/remoteHost.ts REMOTE_HOST_CHANNELS。
  // 🔴 无 get-secret 通道:加密敏感值只经 save 单向进 main(AC-3)。
  remoteHost: {
    list(): Promise<RemoteHostConfig[]> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.list);
    },
    /** 凭据面能力(safeStorage 是否可用);false 时页面挂警示横幅 */
    capabilities(): Promise<RemoteHostCapabilities> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.capabilities);
    },
    save(payload: {
      config: RemoteHostConfigInput;
      password?: string;
      passphrase?: string;
    }): Promise<RemoteHostConfig> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.save, payload);
    },
    delete(payload: { id: string }): Promise<void> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.delete, payload);
    },
    test(payload: { id: string }): Promise<TestResult> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.test, payload);
    },
    connect(payload: { id: string }): void {
      ipcRenderer.send(REMOTE_HOST_CHANNELS.connect, payload);
    },
    disconnect(payload: { id: string }): void {
      ipcRenderer.send(REMOTE_HOST_CHANNELS.disconnect, payload);
    },
    /** 用户显式升级远端 host(强制 reap+重部署当前版本 bundle);进度经 onEvent 呈现。 */
    upgrade(payload: { id: string }): void {
      ipcRenderer.send(REMOTE_HOST_CHANNELS.upgrade, payload);
    },
    /** 已就绪会话的本地转发隧道(查看器窗口直连远程 host 用);未连接 → null */
    getTunnel(payload: { id: string }): Promise<RemoteTunnelInfo | null> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.tunnel, payload);
    },
    /** 全部会话阶段快照(浏览器网络选择器列出可用出口;configId→RemoteStage) */
    stages(): Promise<Record<string, RemoteStage>> {
      return ipcRenderer.invoke(REMOTE_HOST_CHANNELS.stages);
    },
    /** 订阅远程机连接生命周期事件,返回退订函数 */
    onEvent(callback: (e: RemoteEvent) => void): () => void {
      const listener = (_e: unknown, payload: RemoteEvent) => callback(payload);
      ipcRenderer.on(REMOTE_HOST_CHANNELS.event, listener);
      return () => {
        ipcRenderer.removeListener(REMOTE_HOST_CHANNELS.event, listener);
      };
    },
  },
  // 内置浏览器网络出口(面板级:'local' 直连 / 远程机 configId 走其 SOCKS5 代理)。
  browserNet: {
    /** 声明式上报在用出口集合(标签级出口);main 对账 acquire/release,返回快照 */
    syncExits(hostIds: string[]): Promise<BrowserNetworkSnapshot> {
      return ipcRenderer.invoke(BROWSER_NET_CHANNELS.syncExits, { hostIds });
    },
    /** 查询当前快照(选择器挂载时对齐权威态) */
    get(): Promise<BrowserNetworkSnapshot> {
      return ipcRenderer.invoke(BROWSER_NET_CHANNELS.get);
    },
    /** 订阅快照变更(断线标 down/重连恢复),返回退订函数 */
    onChanged(callback: (s: BrowserNetworkSnapshot) => void): () => void {
      const listener = (_e: unknown, s: BrowserNetworkSnapshot) => callback(s);
      ipcRenderer.on(BROWSER_NET_CHANNELS.changed, listener);
      return () => {
        ipcRenderer.removeListener(BROWSER_NET_CHANNELS.changed, listener);
      };
    },
    /** 非主窗(查看器)持有出口存活(HTML 预览需远程 SOCKS 代理);main 校验窗口
     *  身份+host 存在性后落 hold,与主窗集合取并集,返回权威快照 */
    hold(hostIds: string[]): Promise<BrowserNetworkSnapshot> {
      return ipcRenderer.invoke(BROWSER_NET_CHANNELS.hold, { hostIds });
    },
  },
  /** 浏览器 Profile(每工作区独立存储 + UA;权威在 main,增删改后推全量列表) */
  browserProfile: {
    /** 全部自定义 profile(默认 profile 是虚拟实体,UI 自行置顶展示) */
    list(): Promise<BrowserProfile[]> {
      return ipcRenderer.invoke(BROWSER_PROFILE_CHANNELS.list);
    },
    /** 新建(省略 id)或更新(id 命中既有);默认 profile 恒拒绝 */
    save(input: BrowserProfileInput): Promise<BrowserProfile> {
      return ipcRenderer.invoke(BROWSER_PROFILE_CHANNELS.save, input);
    },
    delete(payload: { id: string }): Promise<void> {
      return ipcRenderer.invoke(BROWSER_PROFILE_CHANNELS.delete, payload);
    },
    /** 订阅列表变更(增/删/改),返回退订函数 */
    onChanged(callback: (profiles: BrowserProfile[]) => void): () => void {
      const listener = (_e: unknown, profiles: BrowserProfile[]) => callback(profiles);
      ipcRenderer.on(BROWSER_PROFILE_CHANNELS.changed, listener);
      return () => {
        ipcRenderer.removeListener(BROWSER_PROFILE_CHANNELS.changed, listener);
      };
    },
  },
  // 远程文件传输 阶段2:本机盘票据通道。
  // 🔴 安全红线(与 main/localTransfer.ts 顶部注释同一条,三处一致维护):本机盘
  // 读写的路径永不来自 renderer —— 写落点只能由 beginSave 弹出的系统保存对话框
  // 产生,读来源只能由 beginOpen 弹出的系统打开对话框产生;renderer 全程只持有
  // 不透明的 ticket 字符串,write/read/finish 一律凭 ticket 操作,无法用它换回或
  // 指定任意本机绝对路径。绝不新增「renderer 传本机绝对路径 → main 读写」形态
  // 的方法。
  transfer: {
    /** 弹保存对话框(defaultPath = 净化后的建议文件名);取消 → null,否则拿到
     *  写票(ticket 不透明,后续 write/finish 都凭它)。 */
    beginSave(payload: {
      suggestedName?: string;
      size?: number;
    }): Promise<{ ticket: string; name: string } | null> {
      return ipcRenderer.invoke('transfer:begin-save', payload);
    },
    /** 弹打开对话框(可多选);取消/空选 → [],否则每个选中文件各一张读票。 */
    beginOpen(): Promise<Array<{ ticket: string; name: string; size: number; path: string }>> {
      return ipcRenderer.invoke('transfer:begin-open');
    },
    /** 写入一个分块(乱序按 offset 各自落位,不要求顺序到达)。 */
    write(payload: {
      ticket: string;
      offset: number;
      base64: string;
    }): Promise<{ written: number }> {
      return ipcRenderer.invoke('transfer:write', payload);
    },
    /** 读取一个分块;size/mtimeMs 取自本次读取同一 fstat(TOCTOU 强一致)。 */
    read(payload: {
      ticket: string;
      offset: number;
      length: number;
    }): Promise<{ base64: string; bytes: number; eof: boolean; size: number; mtimeMs: number }> {
      return ipcRenderer.invoke('transfer:read', payload);
    },
    /** 结束传输:写票 commit=true 落地(覆盖式,保存对话框已问过)/false 放弃;
     *  读票忽略 commit,只释放 fd。 */
    finish(payload: { ticket: string; commit: boolean }): Promise<{ path: string | null }> {
      return ipcRenderer.invoke('transfer:finish', payload);
    },
  },
});

// 把 main 转交的 MessagePort 透传给主世界(Electron 官方模式:
// preload 无法直接把 port 挂上 contextBridge,需经 window.postMessage 转移)
ipcRenderer.on('host:port', (event) => {
  window.postMessage({ t: 'host:port' }, '*', event.ports);
});

ipcRenderer.on('host:down', () => {
  window.postMessage({ t: 'host:down' }, '*');
});
