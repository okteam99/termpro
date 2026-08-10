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
import type {
  BrowserProfile,
  BrowserProfileDeletionResult,
  BrowserProfileInput,
} from '../shared/browserProfile';
import type {
  PasswordCredentialMetadata,
  PasswordMetadataQuery,
  PasswordVaultActionResult,
  PasswordVaultCapabilities,
  TrustedPasswordContext,
  TrustedPasswordCopyResult,
  TrustedPasswordRevealResult,
} from '../shared/passwordVault';

export {};

declare global {
  interface Window {
    okwork: {
      platform: string;
      smoke: boolean;
      devChannel: boolean;
      version: string;
      /** 窗口创建时 main 已解析的生效 locale('en' | 'zh-CN';缺失 → "") */
      locale: string;
      /** 语言偏好切换 → main 即时换语言并重建原生菜单 */
      setAppLocale(pref: 'system' | 'en' | 'zh-CN'): void;
      requestHostPort(): void;
      pickDirectory(): Promise<string | null>;
      onMenu(callback: (action: string) => void): () => void;
      smokeOk(): void;
      storeGet(): Promise<unknown>;
      storeSet(state: unknown): void;
      /** 迁移前把 v1 存档复制为备份(state.v1-backup.json);失败 reject */
      backupV1Archive(): Promise<void>;
      setDockBadge(count: number): void;
      focusWindow(): void;
      onUpdateEvent(
        callback: (e: {
          state:
            | 'available'
            | 'checking'
            | 'downloading'
            | 'confirming'
            | 'restarting'
            | 'error';
          version?: string;
          percent?: number;
        }) => void,
      ): () => void;
      installUpdate(): void;
      openViewerWindow(payload: unknown): void;
      showTerminalContextMenu(opts: {
        hasSelection: boolean;
      }): Promise<string | null>;
      showTabContextMenu(): Promise<string | null>;
      clipboardWriteText(text: string): void;
      nativeCopy(): void;
      clipboardReadText(): Promise<string>;
      clipboardReadImage(): Promise<{ base64: string; size: number } | null>;
      openExternal(url: string): void;
      /** AI 浏览器控制桥(main↔renderer):main MCP server ↔ 渲染层 browserControl */
      browserControl: {
        onInvoke(
          callback: (req: { requestId: string; method: string; args: unknown[] }) => void,
        ): () => void;
        sendResult(payload: {
          requestId: string;
          ok: boolean;
          value?: unknown;
          error?: string;
        }): void;
        mcpBase(): Promise<string | null>;
      };
      /** 壳窗身份:弹出的浏览器窗格窗口 = 其终端 tabId;主窗 undefined */
      browserPaneTabId?: string;
      /** 窗格窗口化(弹出=整个窗格独立成窗;壳窗内容 sync 单向回流主窗) */
      browserPane: {
        popout(payload: {
          terminalTabId: string;
          tabName: string;
          ownerHostId: string;
          /** 所属 workspace 名(壳窗工作区编辑弹层用) */
          workspaceName?: string;
          /** 所属 ws 的浏览器 profile 绑定(缺省 = 默认 profile) */
          browserProfileId?: string;
          pane: unknown;
        }): void;
        getState(terminalTabId: string): Promise<unknown>;
        sync(terminalTabId: string, pane: unknown): void;
        onSync(callback: (terminalTabId: string, pane: unknown) => void): () => void;
        addTab(
          terminalTabId: string,
          url: string,
          opts?: { netHostId?: string; preview?: true },
        ): void;
        onAddTab(
          callback: (url: string, opts?: { netHostId?: string; preview?: true }) => void,
        ): () => void;
        list(): Promise<string[]>;
        focus(terminalTabId: string): void;
        dock(terminalTabId: string): void;
        onDocked(callback: (terminalTabId: string) => void): () => void;
        /** 壳窗:直接关闭本窗(不回落);主窗经 onClosed 清空该窗格镜像 */
        close(terminalTabId: string): void;
        onClosed(callback: (terminalTabId: string) => void): () => void;
        /** 壳窗:工作区编辑保存 → 主窗权威 store 应用(改名走 host RPC,绑定持久化) */
        workspaceEdit(terminalTabId: string, patch: { name: string; profileId: string }): void;
        onWorkspaceEdit(
          callback: (terminalTabId: string, patch: { name?: string; profileId?: string }) => void,
        ): () => void;
        /** 主窗:profile 绑定变更推给已弹出壳窗(壳窗换分区重挂 webview) */
        setProfile(terminalTabId: string, profileId: string): void;
        onSetProfile(callback: (profileId: string) => void): () => void;
      };
      /** 主窗浏览器面板头部 ✕ 三态确认(Cancel/Close All/Hide),与壳窗红灯钮同款文案/阈值 */
      browserPanel: {
        confirmClose(tabCount: number): Promise<'cancel' | 'closeAll' | 'hide'>;
      };
      /** 订阅内置浏览器新开标签请求(webview 内 target=_blank/window.open),返回退订函数;
       *  sourceWebContentsId=来源 guest 的 webContents id(据此把新标签落回来源终端 tab 的窗格) */
      onBrowserOpenUrl(
        callback: (url: string, sourceWebContentsId: number) => void,
      ): () => void;
      openPath(path: string): void;
      showItemInFolder(path: string): void;
      onViewerAddTab(
        callback: (tab: { path: string; kind: 'file' | 'dir'; previewRoot?: string }) => void,
      ): () => void;
      /** 取拖入 File 的真实磁盘路径(Electron webUtils) */
      getPathForFile(file: File): string;
      /** 发起原生拖出(把本地文件/目录拖到 Finder 等) */
      startFileDrag(path: string): void;
      /** 远程机管理与连接编排(BL-003)· 无 get-secret 通道(AC-3) */
      remoteHost: {
        list(): Promise<RemoteHostConfig[]>;
        /** 凭据面能力(safeStorage 是否可用);false 时页面挂警示横幅 */
        capabilities(): Promise<RemoteHostCapabilities>;
        save(payload: {
          config: RemoteHostConfigInput;
          password?: string;
          passphrase?: string;
        }): Promise<RemoteHostConfig>;
        delete(payload: { id: string }): Promise<BrowserProfileDeletionResult>;
        retryDelete(payload: { id: string }): Promise<BrowserProfileDeletionResult>;
        test(payload: { id: string }): Promise<TestResult>;
        connect(payload: { id: string }): void;
        /** ⚠️ 即发即忘 · 渲染层现已**零调用点**(评审 P2-3):设置页/Sidebar 的断开走
         *  `disconnectAwait`(trackDisconnect 排队),`reconnectController` 的 disconnect-first
         *  也已改走 `disconnectAwait`(2026-08-10 事故:即发即忘与紧随的 connect 在 main 侧
         *  竞态,尝试蒸发/僵尸误杀;顺序 disconnect→connect 等到的只是上一代编排,有界 5s,
         *  不存在「等自己」)。通道保留待用,新代码一律用 `disconnectAwait`。 */
        disconnect(payload: { id: string }): void;
        /** 可等待的断开(需要排队/排序语义时用此)。现存调用点:`reconnectController` 的
         *  disconnect-first(`reconnectWiring.ts`)+ 设置页/Sidebar 的断开(trackDisconnect)。
         *  resolve ≠ "已断开"语义(TECH R4)——只用它做排队排序,真正的本地拆除须在
         *  调用方 await 之前已同步完成。 */
        disconnectAwait(payload: { id: string }): Promise<void>;
        /** 用户显式升级远端 host(强制 reap+重部署当前版本 bundle);进度经 onEvent 呈现 */
        upgrade(payload: { id: string }): void;
        /** 已就绪会话的本地转发隧道(查看器窗口直连远程 host 用);未连接 → null */
        getTunnel(payload: { id: string }): Promise<RemoteTunnelInfo | null>;
        /** 全部会话阶段快照(浏览器网络选择器列出可用出口;configId→RemoteStage) */
        stages(): Promise<Record<string, RemoteStage>>;
        onEvent(callback: (e: RemoteEvent) => void): () => void;
      };
      /** 内置浏览器网络出口(标签级:每标签 netHostId → 独立分区;main 按在用集合对账) */
      browserNet: {
        /** 声明式上报在用出口集合;main 对账 acquire/release,返回快照 */
        syncExits(hostIds: string[]): Promise<BrowserNetworkSnapshot>;
        /** 查询当前快照(选择器挂载时对齐权威态) */
        get(): Promise<BrowserNetworkSnapshot>;
        /** 订阅快照变更(断线标 down/重连恢复),返回退订函数 */
        onChanged(callback: (s: BrowserNetworkSnapshot) => void): () => void;
        /** 非主窗(查看器)持有出口存活(HTML 预览需远程 SOCKS 代理);main 校验窗口
         *  身份+host 存在性后落 hold,与主窗集合取并集,返回权威快照 */
        hold(hostIds: string[]): Promise<BrowserNetworkSnapshot>;
      };
      /** 浏览器 Profile(每工作区独立存储 + UA;权威在 main) */
      browserProfile: {
        /** 全部自定义 profile(默认 profile 是虚拟实体,UI 自行置顶展示) */
        list(): Promise<BrowserProfile[]>;
        /** 新建(省略 id)或更新(id 命中既有);默认 profile 恒拒绝 */
        save(input: BrowserProfileInput): Promise<BrowserProfile>;
        delete(payload: { id: string }): Promise<BrowserProfileDeletionResult>;
        retryDelete(payload: { id: string }): Promise<BrowserProfileDeletionResult>;
        /** 订阅列表变更(增/删/改),返回退订函数 */
        onChanged(callback: (profiles: BrowserProfile[]) => void): () => void;
      };
      /** Password Vault ordinary surface: deliberately metadata-only. */
      passwordVault: {
        capabilities(): Promise<PasswordVaultCapabilities>;
        listMetadata(query?: PasswordMetadataQuery): Promise<PasswordCredentialMetadata[]>;
        deleteEntry(payload: { id: string }): Promise<PasswordVaultActionResult>;
        openTrusted(payload: { id: string }): Promise<PasswordVaultActionResult>;
        openAccountMenu(payload: {
          guestWebContentsId: number;
        }): Promise<PasswordVaultActionResult>;
        onChanged(callback: () => void): () => void;
      };
      /**
       * 远程文件传输 阶段2:本机盘票据通道。
       * 🔴 安全红线(与 main/localTransfer.ts、preload.ts 同一条,三处一致维护):
       * 本机盘读写的路径永不来自 renderer —— 写落点只能由 beginSave 弹出的系统
       * 保存对话框产生,读来源只能由 beginOpen 弹出的系统打开对话框产生;
       * renderer 全程只持有不透明 ticket,无法用它换回或指定任意本机绝对路径。
       * 绝不新增「renderer 传本机绝对路径 → main 读写」形态的方法。
       */
      transfer: {
        /** 弹保存对话框;取消 → null,否则拿到写票 */
        beginSave(payload: {
          suggestedName?: string;
          size?: number;
        }): Promise<{ ticket: string; name: string } | null>;
        /** 弹打开对话框(可多选);取消/空选 → [],否则每个选中文件各一张读票 */
        beginOpen(): Promise<
          Array<{ ticket: string; name: string; size: number; path: string }>
        >;
        /** 写入一个分块(乱序按 offset 各自落位,不要求顺序到达) */
        write(payload: {
          ticket: string;
          offset: number;
          base64: string;
        }): Promise<{ written: number }>;
        /** 读取一个分块;size/mtimeMs 取自本次读取同一 fstat(TOCTOU 强一致) */
        read(payload: {
          ticket: string;
          offset: number;
          length: number;
        }): Promise<{
          base64: string;
          bytes: number;
          eof: boolean;
          size: number;
          mtimeMs: number;
        }>;
        /** 结束传输:写票 commit=true 落地(覆盖式)/false 放弃;读票忽略 commit,只释放 fd */
        finish(payload: { ticket: string; commit: boolean }): Promise<{ path: string | null }>;
      };
    };
    /** Exists only in the isolated trusted password BrowserWindow. */
    passwordTrusted?: {
      context(): Promise<TrustedPasswordContext>;
      reveal(): Promise<TrustedPasswordRevealResult>;
      copy(): Promise<TrustedPasswordCopyResult>;
    };
  }
}
