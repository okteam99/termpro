# OkWork — 开发者文档

> 面向新 agent / 开发者的工程速查手册。产品背景与里程碑见 [README.md](../README.md)。

---

## 1. 环境要求

| 项目 | 要求 |
|---|---|
| Node.js | ≥ 20 |
| 包管理器 | npm（lock 文件基于 npm） |
| 操作系统 | macOS（M1 阶段仅 macOS；Electron forge 含 maker-deb/rpm 但未验证） |
| 原生模块 | node-pty 需与 Electron 版本对齐编译，forge 在 `npm start` / `make` 时自动处理 |

---

## 2. 常用命令

```bash
npm install                  # 安装依赖（含 node-pty 原生编译）
npm start                    # electron-forge start：Vite HMR + Electron
npm run typecheck            # tsc --noEmit 全量类型检查（无构建产物）
npm run lint                 # eslint .ts/.tsx

# 无头冒烟（CI 可用）
OKWORK_SMOKE=1 npx electron-forge start
# 渲染层完成 Host 握手 + 首个 PTY 输出后打印 SMOKE_OK 自动退出，30s 超时打印 SMOKE_TIMEOUT 以 exit(1) 退出
# userData 隔离至 os.tmpdir()/okwork-smoke，不污染本地布局存档
```

---

## 3. 目录结构

```
src/
├── main/          Electron 主进程
│   ├── main.ts       窗口创建、菜单、utilityProcess 拉起 Host、布局存档 IPC、冒烟逻辑
│   ├── appStore.ts   布局持久化 IPC 实现（store:get / store:set）
│   └── updater.ts    更新检查 + Squirrel.Mac 一键升级
├── preload/       沙箱 preload（contextBridge）
│   └── preload.ts    暴露 window.okwork API；Host MessagePort 经 window.postMessage 转移
├── host/          纯 Node Host 进程（零 Electron import，远程就绪）
│   ├── host.ts             utilityProcess 入口；多客户端路由；RPC dispatch
│   ├── ptyPool.ts          PTY 会话池；流控（highWatermark/lowWatermark）；进程名轮询
│   ├── fsService.ts        readdir / home 工具函数
│   ├── gitService.ts       git.info / git.status / worktree list（shell out git/gh）
│   ├── outputScanner.ts    VT 字节流轻量扫描器（OSC 133 / BEL / 备用屏开关）
│   ├── proc.ts             前台进程名查询（pty.process / lsof）
│   ├── sessionTracker.ts   Tab 会话状态机（running/waiting/done/idle）
│   ├── shellIntegration.ts OSC 133/7 自动注入（zsh ZDOTDIR 包装）
│   ├── watchService.ts     fs watch 服务（chokidar；去抖合并；推送 watch 事件）
│   └── __tests__/          host 层单元测试
├── shared/        UI ↔ Host 协议契约
│   └── protocol.ts   消息类型、RpcMethods 注册表、FLOW 水位常量、PROTOCOL_VERSION
└── renderer/      React UI
    ├── App.tsx            根组件；连接 Host、初始化持久化、订阅菜单事件
    ├── index.tsx          React 入口
    ├── components/        Sidebar / TabBar / FilePanel 顶层编排
    ├── filepanel/         文件面板编排（单 reducer · 三道过期闸；Root/WorkTree 切换）
    ├── monaco/            Monaco 懒加载封装（文件查看/轻编辑/diff 视图）
    ├── services/
    │   └── hostClient.ts  HostClient 单例：RPC、PTY 流分发、流控回执
    ├── state/
    │   ├── store.ts       Zustand store（Workspace/Tab 状态机）
    │   └── persistence.ts 启动 hydrate + 防抖写回（300ms）
    └── terminal/
        ├── terminalRegistry.ts  Terminal 实例注册表（跨 React 挂载存活）
        └── TerminalView.tsx     xterm.js DOM 挂载 / WebGL 管理 / resize
```

| 目录 | 职责摘要 |
|---|---|
| `src/main` | Electron 壳：窗口/菜单/utilityProcess 拉起 host/布局存档 |
| `src/preload` | contextBridge 壳层 API + host port 转移 |
| `src/host` | 纯 Node Host 进程：PTY 池/流控/fs，零 Electron import，远程就绪 |
| `src/shared` | HostService 协议（消息类型 + 流控常量） |
| `src/renderer` | React UI：store / components / terminal |

---

## 4. 架构要点

### 4.1 UI 永不直接碰 fs / PTY

所有工程数据访问（PTY、fs、git）必须经 `hostClient`（`src/renderer/services/hostClient.ts`）以 HostService 协议发起。renderer 里没有任何 `node:fs`、`node-pty` 导入。这是使 Host 将来可整体迁移到远程机器的前提。

### 4.2 PTY 流控

```
PTY 输出 → host 累加 session.unacked
  unacked > 512 KB (highWatermark) → proc.pause()，停止读 PTY
  → pty:data 消息携带 bytes 字段送往 UI
  → term.write(data, callback) 回调触发 hostClient.ack(sessionId, bytes)
  → host 收到 pty:ack → session.unacked -= bytes
  → unacked < 128 KB (lowWatermark) → proc.resume()
```

常量定义在 `src/shared/protocol.ts` 的 `FLOW` 对象，本地/远程传输共用同一机制。

> 🔴 **不变式：解析/写入循环里的回调绝不许抛。** 上面这条链的 ack 是 xterm
> `WriteBuffer._innerWrite` 在 `_bufferOffset++` **之前**裸调的 write 回调；同样裸调的还有
> `_action(chunk)`（解析，含我们经 `parser.registerOscHandler/registerCsiHandler` 注册的
> handler）。任一处抛出，`_innerWrite` 既不推进偏移、也不再排下一拍 `setTimeout` ——
> 该 Terminal 的写入泵**永久停摆**：后续 write 只入队不消费（屏幕定格在半帧）、回调永不
> 触发 → 永不 ack → host 把这条 PTY 憋停。表征是「心跳/侧栏/其它 tab 全绿，单独一个终端
> 卡死、ctrl+c 也没反应」，且重连收养救不回来（回放只是往死队列里再塞一段）。
>
> 已两次栽在这里：2026-07-15 线上压缩包里 `requestMode` 的 ReferenceError；2026-07-29
> 死链路上 `hostClient.ack` 经 `WebSocketTransport.send` 抛 `host connection lost`。
> 2026-07-30 用户再报「最新版仍卡住」后，失败用例证明上一层 `guardParse` 只护住了
> 我们注册的 handler，xterm 内建/第三方 handler 抛错仍可原样冻死。现有防线因此是四层：
> 1. renderer 生产压缩固定用 Terser，不再让 Vite/esbuild 二次压缩破坏已压过的
>    xterm bundle 局部作用域；
> 2. `terminalRegistry.installParserBoundary` 包住 xterm 真正的 `WriteBuffer._action`，任意
>    同步 parser 异常都会 reset 当前控制序列状态并让写入泵继续推进；
> 3. `terminalRegistry.guardParse` 给我们自己注册的回调保留精确 fallback 与带上下文日志；
> 4. `hostClient.post`（ack/input/resize 三条数据报）一律吞不抛——注意 `rpc` 相反，
>    保持发送失败即拒。
>
> 经 xterm Emitter 派发的事件（onData/onResize/onScroll）另有豁免：xterm 6 的 Emitter 自己
> 逐 listener try/catch，泵不会停——但别依赖它，新增回调照样套护栏。
> 回归测试：`terminal/__tests__/parseLoopWedgeGuard.test.ts`、
> `services/__tests__/hostClientDatagramNoThrow.test.ts`。

### 4.3 WebGL Renderer 只挂可见 Tab

`TerminalView` 挂载时才为当前 tab 附加 `WebglAddon`；切走时卸载 WebGL context（保留 Terminal 实例与 buffer）。防止超出 GPU context 数量上限。

### 4.4 终端实例注册表跨 React 挂载存活

`terminalRegistry`（`Map<tabId, TermInstance>`）在模块级持有 Terminal 对象。React 组件卸载（切 tab、workspace 切换）不销毁实例，切回时复用同一 xterm.js Terminal，scrollback 和会话连接保持不中断。仅 `disposeTerminal(tabId)` 调用时才真正销毁。

### 4.5 持久化：先 hydrate 后订阅

`initPersistence()` 流程：
1. `storeGet()` 读取已存档的布局（`PersistedState` v1）
2. `store.hydrate(raw)` 填充初始状态，设置 `hydrated = true`
3. **之后**才启动 Zustand 订阅 + 防抖写回（300 ms）

订阅必须在 hydrate 完成后启动，否则初始空状态会覆盖存档。UI 渲染以 `hydrated` flag 为门控。

### 4.6 MessagePort 传递路径

```
renderer → ipcRenderer.send('host:request-port')
main     → MessageChannelMain() 新建双端 port
         → host.postMessage({t:'client'}, [port1])   # host 端
         → event.sender.postMessage('host:port', [port2])  # 经 ipcRenderer 到 preload
preload  → window.postMessage({t:'host:port'}, '*', ports)  # 转移到主世界
renderer → window 监听 'message' → HostClient.attach(port)
```

preload 是沙箱环境，无法直接通过 contextBridge 传递 MessagePort，必须经 `window.postMessage` 转移（Electron 官方模式）。

### 4.7 内置浏览器:分区模型(profile × 出口)与「走远程机网络」

session 分区是**二维**的(2026-07-21 起):`browserPartition(profileId, netHostId)`,单源
`src/shared/browserProfile.ts`。

- 第一维 **profile**(工作区级,`WorkspaceState.browserProfileId`):独立 cookie/存储/缓存 +
  可选自定义 UA。默认 profile(id=`default`,虚拟实体不落盘、不可删改)映射旧分区名
  `persist:browser` / `persist:browser-<configId>`——老登录态零迁移。自定义 profile
  (32 位 hex id,`userData/browser-profiles.json`,权威在 main,存储走 `SettingsStore`
  抽象以备未来账号绑定)→ `persist:browser-prof-<pid>[-<configId>]`。
- 第二维 **网络出口**(标签级,`BrowserTabState.netHostId`,缺省跟随所属机器):流量
  指向某台已连接远程机,经其 SSH 出网(远程 DNS + 远程出口 IP)。

```
浏览器标签 (browserPartition(ws.browserProfileId, tab.netHostId))
  → session.setProxy(socks5://127.0.0.1:<本地随机端口>, proxyBypassRules: '<-loopback>')
  → 本地 SOCKS5 代理 (src/main/remote/socksProxy.ts, 仅监听 127.0.0.1)
  → 每条 TCP 连接 = 一条 ssh direct-tcpip channel (ssh.openOutbound)
  → 远端 sshd 解析域名并出网(远程 DNS + 远程出口 IP)
```

SOCKS 端口按 configId 一份(同一出口各 profile 共享隧道;隔离的是存储不是链路);
`setProxy`/黑洞对【configId × 全部 profile】的每个组合分区各设一遍
(`BrowserNetworkController`,组合集合经 `browserPartitionPolicy.partitionsOfExit` 注入)。

硬语义(历史评审钉死,勿破):

- **fail-closed 黑洞预封(P1-1)**:任何远程组合分区在获得活代理【之前】必须已落黑洞代理
  (`socks5://127.0.0.1:1`)——启动时(`preseal`)、新增远程机、新增 profile
  (`onProfilesChanged`)三处都要封;断线只标 `down` 留死端口快速失败,**绝不静默回退
  本机直连**;重连 ready 自动重建恢复。回 local 仅两条路:用户手动切 / 删除该机。
- **loopback 也走远程**:`<-loopback>` 撤销 Chromium 对 localhost 的隐式代理豁免——
  「走远程出口」的核心场景恰是访问远程机上的 dev server(remote localhost)。
- **远程 DNS**:`socks5://` scheme 把域名原样交给代理(ATYP=domain),解析发生在远端 sshd。
- **will-attach 白名单**:只放行【已知 profile × 已知出口】的组合分区
  (`src/main/browserPartitionPolicy.ts`,profile/config 存在性双确认)。
- **WebRTC 防泄漏**:guest session 不在「已知本机直连分区全集」→ 恒
  `disable_non_proxied_udp`(未知即禁,fail-closed 方向;SOCKS5 只代理 TCP)。
- **每分区 UA**:profile 自定义 UA 双保险——renderer `<webview useragent>`(guest 首帧)
  + main 在 will-attach 前 `session.setUserAgent`(service worker 等 session 级请求)。
- **换出口/换 profile/改 UA = 重挂重载**:分区与 UA 掺进 webview 的 React key,变更即
  该标签 remount(webview partition 创建后不可变,Chromium 语义)。
- **删除 profile = 清盘**:其全部组合分区 `clearStorageData()+clearCache()`;引用它的
  工作区经 `setBrowserProfiles` 对账回落默认 profile。

权威态单源在 `main`(`BrowserNetworkController` / `browserProfileStore`):renderer 只镜像
快照(`browserNet.get/onChanged`、`browserProfile.list/onChanged`),不乐观臆测。profile
管理 UI 在 Browser Settings(`BrowserProfilesSection`),工作区绑定在 Sidebar 的工作区
编辑弹层(`WorkspaceEditModal`)。

**弹窗 = 子浏览器窗口**(用户指令 2026-08-12,判据/落位单源 `src/main/browserPopupPolicy.ts`):
`window.open` 带窗口特性 / `disposition=new-window`(Google 登录一类的 OAuth 流)恒开
**真 popup 窗口**——转面板标签会让 `window.open()` 返回 null,站点直接判「弹窗被拦截」,
`opener.postMessage` 回传与弹窗自 `close()` 也全断。子窗 session 跟开启方 guest 走
(登录态落对 profile),`outlivesOpener=false`(标签销毁即关,不留孤儿登录窗),同名
`frameName` 复用而非重开,限频 300ms + 单 guest 子窗上限 4。子窗**无地址栏**,故标题栏
恒以域名打头、页面自报 `document.title` 只能跟在后面(反钓鱼——那扇窗里要输密码)。
导航白名单 http(s)/about:,node 关死 + sandbox + 无 webviewTag;继承 guest preload 后
显式登记到同一 profile 的密码保险箱(不登记即 fail-closed,子窗里没有状态条 UI)。
普通 `target=_blank`(无特性)仍落面板新标签;查看器等无窗格宿主(`popup:'external'`)
仍送系统浏览器。

### 4.8 AI 操作内置浏览器（browser MCP）

session 内的 agent（Claude Code / Codex 等）可经内置 MCP server 驱动 OkWork 的内置浏览器：抓数据、截图、分析 DOM、执行 JS、点击/输入/滚动、管理标签。**AI 操作的就是用户真实登录会话（`persist:browser`，带 cookie）**——刻意为之（用户指令 2026-07-15，安全隔离暂不做;控制层只做能力,不做 consent/隔离）。

绑定模型 **A**：每个 MCP 连接绑一个**终端 tab**——URL 路径 `/mcp/<terminalTabId>` 携带,工具默认操作该 tab 的浏览器窗格（缺省活跃标签,或显式 `browserTabId`）。

```
终端内 agent → HTTP(streamable) → main: browserMcp server (127.0.0.1:<随机端口>)
  → invokeBrowserControl(method,args)  [ipcMain 'browserControl:invoke' → mainWin]
  → renderer: browserControlBridge(方法白名单)→ browserControl.*
  → browserViewRegistry.getBrowserView(browserTabId) → <webview>.executeJavaScript/capturePage/loadURL
```

- **server**：`src/main/browserMcp.ts`（MCP SDK `Server` + `StreamableHTTPServerTransport`,stateful,按 `mcp-session-id` 路由;每 URL 的 tabId 建一个绑定 server）。
- **桥**：`src/main/main.ts` 的 `invokeBrowserControl`（20s 超时;按 tab 是否弹出**路由到主窗或壳窗**,只认该窗回传防冒充）↔ `src/renderer/services/browserControlBridge.ts`(白名单防越权调用)。
- **弹出窗口也可驱动**：窗格弹出成独立窗口(`BrowserPaneShellWindow`)后 webview 活在壳窗,`invokeBrowserControl` 据 `paneWins` 把该 `terminalTabId` 的 invoke 改路由到壳窗(壳窗也挂 `browserControlBridge` + 注册自己的 webview);未弹出则走主窗。壳窗 store 的窗格不带 `poppedOut` 故不触发拒绝守卫。
- **控制原语**：`src/renderer/services/browserControl.ts`（读取 navigate/eval/screenshot/getHtml/getText;交互 click/typeText/scroll/waitForSelector,均经 `executeJavaScript`,选择器/文本 `JSON.stringify` 注入防转义;标签 list/open/close/activate 走 store action）。
- **webview 触达**：`src/renderer/services/browserViewRegistry.ts`——模块级 `Map<browserTabId, webview>`,让控制层在组件外拿到 webview（`registerBrowserView` 在 `BrowserPanel` 挂载时登记）。

**13 个工具**：`browser_navigate` `browser_eval` `browser_screenshot` `browser_get_html` `browser_get_text` `browser_click` `browser_type` `browser_scroll` `browser_wait_for` `browser_list_tabs` `browser_open_tab` `browser_close_tab` `browser_activate_tab`。

**端点发现（env 注入）**：OkWork spawn **本地**终端时,经 `SpawnOptions.env`（host 合并进 pty）注入两个环境变量:

- `OKWORK_TERMINAL_TAB` = 该终端 tabId
- `OKWORK_BROWSER_MCP_URL` = `http://127.0.0.1:<port>/mcp/<tabId>`

接线:`main` 的 `browserControl:mcp-base` IPC 暴露 base URL → renderer `browserMcpEnv`（惰性缓存,ensureSession spawn 前 await,规避 hydrate 首终端漏注入竞态）→ `pty.spawn` 带 env。

把该端点接上 agent（终端里跑一次,本地/远程同一条）:

```bash
claude mcp add --transport http okbrowser "$OKWORK_BROWSER_MCP_URL"
```

**远程 session（阶段3）**:URL 指容器回环固定端口 `http://127.0.0.1:39217/mcp/<tabId>`（`BROWSER_MCP_REMOTE_PORT`,`src/shared/browserMcp.ts`）。因 OkWork 直连 `okwork-node` 容器（sshd 在容器内,`EXPOSE 22`),转发端口与远端 pty 同 netns,pty 直接 127.0.0.1 可达,**无需 `host.docker.internal`**;每台远程机各自独立容器/netns,同端口互不冲突。

- **反向转发**:`ssh.ts` 的 `forwardInToLocal(localPort, 39217)`——远端绑 `127.0.0.1:39217`,每条打进来的连接回接本机 `127.0.0.1:<MCP port>`;按 destPort 路由防误接;`close` = `unforwardIn` + 摘 `tcp connection` 监听。
- **生命周期**:`orchestrator` 在 host `ready` 时自动建（`establishBrowserMcpForward`,不同于 SOCKS 懒建——agent 随时可能用,ready 即备好);`main` 起好 MCP server 后 `setBrowserMcpForward(port)` 声明本机端口并对已 ready 会话补建;断线/disconnect 随 `closeSessionTransport` 撤销。建转发期间断线有 stage/ssh 竞态守卫。
- **env 注入**:renderer `browserMcpEnvFor` 对远程 hostId 注入容器回环 URL（本机 MCP 未起则本地/远程都不注入,`getBase()` 即特性开关）。
- **镜像**:`okwork-node` 的 `sshd.conf` 显式 `AllowTcpForwarding yes`（仅 loopback 绑定,无需 GatewayPorts;OpenSSH 默认即 yes,显式声明防加固误关)。

### 4.9 okwork 技能 + 会话内安装横条

内置浏览器只是「能力」;要让 session 内的 agent（Claude Code / Codex）**知道并会用**它,OkWork 打包一个 **`okwork` 技能**(SKILL.md playbook),并在会话里主动探测、未装/可更新时弹**可关闭横条**一键安装。单个 `okwork` 技能(非 `okwork-browser`),当前封装浏览器控制,预留扩展未来 OkWork 会话内能力。

- **技能内容**:`src/shared/okworkSkill.ts` —— `OKWORK_SKILL_VERSION` 单一真源 + SKILL.md 全文(frontmatter version 由常量插值防漂移)。正文=连接引导(`claude mcp add … "$OKWORK_BROWSER_MCP_URL"`)+ 真登录会话安全提醒 + 13 工具速查 + 可靠性套路 + 4 个流程配方。以 shared TS 模块打包,跨 main/renderer/RPC 可用。
- **探测/安装(host · 纯 Node fs,本地远程统一)**:`src/host/skillService.ts` + 协议 `skill.status` / `skill.install`。
  - `skillStatus(name)`:报告 `claude` / `codex` / `shared` 各位置的 `present`(agent home 是否在)+ 已装 `version`(解析 SKILL.md frontmatter,只认开头 `---` 块内的 `version:`)。
  - `skillInstall(name, content)`(teamwork 约定):**真身**写共享 canonical `~/.agents/skills/<name>/SKILL.md`;`~/.claude/skills/<name>` 放**软链**指向 canonical(claude 只读自己的 skills 目录;软链失败退拷贝)。🔴 **codex 不放东西**:codex 直接扫 `~/.agents/skills`(teamwork 只在那儿也被 codex 看到为证),若再往 `~/.codex/skills` 放一份就与 canonical **双扫重复**(2026-07-15 事故)——故安装时反而**清掉** `~/.codex/skills` 里的同名残留;`skillStatus.duplicate` 探测该残留,横条以「更新」引导一次重装完成去重。
- **横条(renderer)**:`OkworkSkillBanner`(终端区顶部,`main-column` 内 TabBar 下)。`computeSkillPromptAction(status, 打包版本)`→ `install`(有 agent 但缺)/ `update`(装了但旧)/ `null`(最新或无 agent)。点一下调 `skill.install` 重探即隐,并弹 toast 提示「重启 agent 才生效」(已跑的 agent 不中途重扫 skills);`×` 关闭按机器 `localStorage` snooze **24h**;旧 host(无 `skill.*` RPC)探测失败 → 静默不打扰(该远程更新 host bundle 后自然出现)。

远程等价:`skill.*` 是 host RPC,远程容器同样探测/安装(装到容器的 `/root/.agents/skills`、`/root/.codex/skills` 等已装 agent 目录);容器无 Claude Code 则只装 codex + canonical。

### 4.10 项目内 HTML 预览

点开 workspace 内 `.html`/`.htm` 文件(FilePanel 或查看器)可直接看渲染效果,而非只看源码。host 侧 `src/host/previewServer.ts` 按 root 懒启动一个纯 Node 静态 server(零 Electron import、零第三方依赖,远程就绪);renderer 经 `preview.ensure`/`preview.stop` 两个 RPC 驱动。

```
FilePanel/查看器 → preview.ensure({root}) → host 懒启动/复用该 root 的 http.Server
  → 返回 {root, port, token} → buildPreviewUrl 拼 URL → <webview src> 直接指向
```

- **URL 形状**:`http://127.0.0.1:<port>/<token>/<相对 root 路径>`——token(128-bit,`token.ts`)编码进路径首段,`<webview src>` 可直接指向,无需额外请求头。
- **鉴权**:主路径首段比对 token;根绝对引用(页面里写死的 `/assets/x.css` 之类)靠**同源 Referer 回退**——取 Referer 路径首段当候选 token,且 Referer origin 必须与本 server 自身 origin 完全一致,跨源/无 Referer 一律鉴权失败(零信息 404,不区分「无 token」和「越权」)。每条响应恒带 `Referrer-Policy: same-origin`,防止预览页面里的外链把 token 泄给第三方 Referer。
- **安全铁律**(评审钉死,勿破):
  - 监听地址恒 loopback(127.0.0.1/::1/localhost),`createPreviewRegistry` 非 loopback host 直接抛错;
  - 无目录列表:目录请求只找 `index.html`,找不到就 404,响应体不含任何条目名;
  - **双层 containment**:词法层(`path.resolve` 后必须仍在 root 前缀内)+ 实体层(`realpath` 解出的真实路径二次校验,防软链逃逸)双重把关,任一层失手都当越权拒绝;
  - 所有响应 `Cache-Control: no-store`(预览恒读最新盘内容,不缓存旧版本);
  - 预览标签(浏览器面板里的预览 tab)在存档序列化时**恒被过滤**(`BrowserTabState.preview`),重启后不残留、也不落盘暴露 token;
  - **出口钉死**:预览标签的网络出口固定为文件所属机器(`preview: true` 时 store 层拒绝改 `netHostId`),UI 也禁用出口选择器,防止预览流量被手滑切去别的出口;
  - server 数上限 16(LRU,超限按 `lastUsedAt` 关最旧);workspace 删除时 renderer best-effort 调 `preview.stop` 回收对应 server(失败只 warn,不阻塞/回滚删除)。
- **已知边界**:
  - 未保存内容不进预览——server 直接读盘,查看器脏 tab 的编辑器内容在保存前不可见(`HtmlPreview` 顶部提示条 + 「Save & refresh」按钮引导先存后看);
  - host 重启后旧 URL(旧端口/旧 token)全部失效;自愈路径是**重新触发预览**(查看器里点 Retry,或从 FilePanel 重新点开该文件)——`preview.ensure` 会在新 host 进程里懒启动一个新 server 并返回新 URL,但已打开的旧标签/webview 不会自动跳转,需用户手动重开;
  - 不支持 `Range` 请求(`Accept-Ranges: none`),大文件/视频拖动播放不可用——预览面向静态站点/文档场景,非通用文件服务。

### 4.11 远程文件传输(分块协议 + 本机票据通道)

远程 workspace 的 FilePanel:文件行 hover「⤓ 下载到本机」、目录行 hover「⤒ 上传到此目录」。
两条通道拼成一次传输,字节路径恒为 `远程 host ⇄ renderer ⇄ main`:

- **远程侧(protocol.ts `TRANSFER` + 4 个 RPC)**:无状态 offset 分块,512 KiB/块
  (host 钳 1 MiB;块大小上界受共享 SSH 隧道队头阻塞约束,不是 WS_MAX_PAYLOAD)。
  下载走 `fs.readFileRange`(同 fd fstat+pread,防路径替换、尽力检测传输中改写);
  上传走 `fs.uploadBegin/Chunk/End`:host 在目标目录生成 `.okwork-upload-*.part`,
  **严格顺序 offset**(per-transfer 串行链,并发 chunk 排队)、commit 时校验
  `received === size`,落地用 `link+unlink`(重名加后缀,恒不覆盖,与 fs.copy 同口径);
  断连由 per-client `disposeAll` 删 `.part`,陈旧残留 24h 清扫兜底。
  能力位 `'fs.transfer'`,旧 host → 按钮禁用 + 升级提示(点击直达 §4.12 升级入口),
  不上调 HOST_MIN_APP_VERSION。
- **本机侧(main `localTransfer.ts` 票据通道)**:🔴 红线——本机盘读写的路径**永不来自
  renderer**:写落点只能由 `transfer:begin-save` 的保存对话框产生、读来源只能由
  `transfer:begin-open` 的打开对话框产生,renderer 只持不透明 ticket(sender 绑定、
  配额 8、30 min TTL、窗口 destroyed 即 abort)。绝不新增「renderer 传本机绝对路径 →
  main 读写」形态的 IPC。
- **renderer 编排**:`transferCore.ts` 纯分块循环(改写检测/对账/finally 清理/
  取消在块边界生效)+ `transferManager.ts` 模块级单例 FIFO 串行队列(并发 1,
  切 tab/折叠面板不中断);进度在 FilePanel 底部传输条,终态走 showHint。
- **查看器媒体加载**(用户指令 2026-08-14,`viewer/viewerMedia.ts`):内置视频播放
  (mp4/m4v/mov/webm/ogv —— 只列 Chromium 真能解的容器,其余直接给下载入口)与
  **100MB 媒体上限**都走这条分块通道:`fs.readFileRange`(512KiB/块)→ 渲染层拼 Blob →
  object URL 喂 `<video>`/`<img>`。为什么不是 `fs.readFileBinary`:那条 RPC 把整份
  base64 塞进**一条** WS 消息,host 侧 20MB、链路 `WS_MAX_PAYLOAD` 32MB,100MB 文件
  base64 后 ≈137MB 根本过不去。**不需要升级远程 host**:分块读是既有能力位
  (`fs.transfer`),老 host 自动回落 readFileBinary 的 20MB 老路径。TOCTOU 基线与
  transferCore 同款(首块 size/mtimeMs 记基线,变了即中止);卸载即取消;object URL
  在卸载/切文件时 revoke(否则 100MB 量级的 Blob 永久驻留内存)。
  边界:**文本仍是 2MB**(`fs.readFile` 同样是单条消息 + Monaco 大文件会卡死),
  超限走「预览不了 + 下载」那条路。
- **查看器兜底入口**(用户指令 2026-08-13,`viewer/DownloadAction.tsx`):远程文件
  预览不了(二进制 / 超预览上限,如 mp4)时,消息旁给「下载到本机」——那扇窗里本机
  文件另有 Finder/默认应用两个入口,远程文件此前只剩一句死文案。复用 `runDownload`
  但**不进 transferManager 队列**:查看器是独立渲染进程,队列与传输条 UI 都在主窗那份;
  这里只做按钮内进度 + 终态文案,卸载(关 tab/窗)即取消并释放写票。只挂在
  「预览不了」这一支(`LoadState.unpreviewable`),加载/保存出错不长下载按钮。
  已知边界:markdown **预览面板**的超限文案下没有按钮(切到 Edit 页即有)。
- **已知边界**:单文件 2 GiB 上限(确定性拒绝);不支持断点续传(offset 协议已预留,
  v2);目录整体上传/下载不支持(多选文件覆盖主场景);app 崩溃可能在本机留下
  `.{name}.okwork-part-*` 残件(点前缀不可见,不做本机全盘清扫)。

### 4.12 服务端(远程 host)升级入口(forceRedeploy)

背景:连接时收养门闸只比对 `HOST_MIN_APP_VERSION`(硬编码最低依赖,不为小版本差
杀 session),而 fs.transfer / fs.temp-png / preview 等新能力走能力位探测、有意不上调
门闸——于是「host ≥ 门闸但缺新能力位」的存量 host 会被无限收养,升级提示无路可走。

- **编排(main)**:`REMOTE_HOST_CHANNELS.upgrade` → `orchestrator.connect(id,
  { forceRedeploy: true })`。residency 侧 `forceRedeploy` 置位 = 认领候选资格整体作废
  (claim 与 abortLiveUnreachable 皆不可达,且跳过建隧道+probe 的候选探测段),活 host
  属本 tag 走既有 reapThenDeploy 重部署当前 app 版本 bundle。🔴 kill 守门②③
  (cmdline `--host-tag` 全等)不放宽:force 只放宽「要不要换」,从不放宽「能不能杀」。
  与 2026-07-15 保护规则不冲突——那条防自动重连路径的误杀,本通道仅由用户显式点击触达
  (用户规则 2026-07-13「升级服务端,在跑任务可以被关闭」的授权场景)。
- **UI(RemoteHostsPage)**:ready 徽标旁显示远端 host 版本(`forHostId` 只读路由),
  低于客户端版本亮「升级」+ 确认行(明示该机所有在跑会话含后台 agent 将被终止);
  确认后 cancel 重连编排 + drop 旧 client + 发 upgrade,进度复用连接生命周期呈现。
- **引导接线**:文件传输/图片粘贴/HTML 预览的「host 过旧」提示指向本入口
  (FilePanel 点击直达:store `openRemoteHostsPage()` nonce → SettingsEntry 打开远程机页)。
- **评审修复(2026-08)**:force 先传后杀(预部署 `.ready` 幂等,单调闸/SFTP 失败都在
  reap 前拦截);force 遇在途/排队 connect 一并作废会话;隧道句柄 try/catch 兜底
  (orchestrator claim/启动路径 + residency 候选段);upgrade 通道限主窗口 sender +
  payload 校验;closeSessionTransport 先摘引用再 close(消 watcher 同步再入递归)。
- **backlog**:① runConnect 十余处 failSession 依赖「非法转移抛出 + 外层 catch」兜僵尸,
  宜统一显式 isCurrent 门(转移表一旦扩边保护即失效);② reap 的 cmdline 读→kill 间
  TOCTOU(pid 复用窗口极窄但存在),宜 kill 前复验 cmdline。

### 4.13 云端浏览器(远端 headless Chromium)

远程 session 里的 agent 用浏览器时,浏览器本体跑在**那台机器上**,不再经 SSH 反向转发
打回用户本机(那条链路长且脆,"agent 调 okbrowser 经常挂死"有案可查)。默认无头 ——
平时零画面流量;只有本地按下浏览器面板地址栏的 ☁ 开关才推画面回来。

```
远端:  agent → 127.0.0.1 MCP(不出机器) ↘
                                        browserService → CDP(ws · 机器内部环回)→ headless Chromium
本机:  BrowserPanel ☁ → browser.* RPC  ↗        主连接(WS/JSON,与 pty 同一条 SSH channel)
       CloudBrowserPreview  ←──────────────  /frames 通道(WS/二进制,**独立** SSH channel)
```

**三段传输,分清楚**:
- renderer ↔ host 是 OkWork 自己的 HostService 协议(`src/shared/protocol.ts`),不是裸 SSH、
  也不暴露 CDP;renderer 只能发协议里定义好的 `browser.*`,发不了任意 CDP 命令。
- 承载是 **WebSocket over SSH**:`ssh.ts:forwardOut` 把每条 TCP 连接转成一个 direct-tcpip
  channel 接到远端 host 的 ws 端口。所以「新开一条 WS」= 「新开一个 SSH channel」。
- host ↔ Chromium 的 CDP **完全不出远端机器**(本地环回),这一段不加密也不需要。

**为什么画面单开一条通道**:主连接那条 WS 里跑着 pty 输出、RPC、事件,是**一条 FIFO**;
画面插进去就会把终端输入和心跳推到队尾(2026-08 那次「远端 CPU 打满、组头还挂 34ms」
就是同一条隧道的拥塞表现)。独立 WS = 独立 SSH channel,有自己的流控窗口,画面再忙也压
不到终端那条队列。底层 TCP 带宽仍然共享,所以 **ack 门控照旧保留**(见下)。
帧走二进制:省掉 base64 的 33% 和一次 JSON 解析,字节直接进 `createImageBitmap`。

- **host 侧**:`src/host/browserService.ts`(生命周期 + 13 个控制原语 + 预览推流)、
  `src/host/cdpClient.ts`(裸 ws + JSON 的 CDP 客户端,**零新依赖**——不引 puppeteer:
  host bundle 是经 SSH 部署的单文件,只需要 CDP 的薄切片)、`src/host/chromiumLocator.ts`
  (只**找**已装的浏览器,绝不自动下载:往用户服务器上拉 150MB+ 二进制是没被同意过的事)。
- **能力位两层**:`host.info.capabilities` 里的 `browser.headless` 只表示**协议面**存在
  这组 RPC;那台机器**装没装** Chromium 要问 `browser.status`(它只探测,不启动)。
- **渐进启用,零破坏**:`src/renderer/services/cloudBrowserRouting.ts` 三条同时成立才走
  云端 —— 远程 host + 有能力位 + 真装了 Chromium。差任何一条都维持现状(本机 webview +
  反向转发),远端没装浏览器的存量用户升级后行为一字不变。判定按 hostId 缓存(每次
  `browser_*` 都探一遍等于给每个 agent 动作加一个跨洋往返);重连/删机时失效。
- **MCP 契约未变**:13 个 `browser_*` 工具一字未改,agent 侧零改动;只是 renderer 的
  `browserControl` 按后端分流。云端的 click/type 走 `Input.dispatchMouseEvent` /
  `Input.insertText` 派发**真实**事件(`isTrusted=true`,真 Chromium 上有断言),
  比本机那套 `el.click()` + 手工 dispatch 更接近真人。
- **帧通道**(`src/host/frameChannel.ts` + `src/renderer/services/browserFrameChannel.ts`,
  线格式在 `src/shared/browserFrameCodec.ts` 两端共用):路径 `/frames?token=…&sid=<streamId>`,
  同端口同 token 闸同 origin 闸,**只是不挂 host.info-first 门控**(它不发 RPC,只收二进制帧、
  回文本 ack)。streamId 由 renderer 生成、两处出示(连通道 + `startPreview` 参数),host 只做
  关联不签发。顺序:先连通道 → 再 `startPreview({streamId})`;通道没接上就退回主连接的
  `browser:frame` JSON(旧客户端 / 本地嵌入式零破坏,`startPreview` 的 `binary` 字段如实回报)。
  帧格式 `[u32 headerLen][JSON 头][JPEG 原始字节]`,畸形一律丢弃不抛。
- **🔴 预览背压(必须守住的性质)**:独立 channel 解决的是队头阻塞,**带宽仍然共享**,
  所以 ack 门控一条都不能省。两级 ack:① 对 Chromium **立即** ack(它按自己的节奏产帧,
  页面不因链路慢而冻住)② 对通道**只在空闲时**发(上一帧没被客户端 ack 就丢掉当前帧,
  只送最新的)。于是通道上恒最多一帧在途。客户端侧的另一半:**画完才 ack**,不是收到就
  ack —— ack 的语义是「我消化完了」。帧走 JPEG q60 / 长边 1280。
- **人真的能操作**:鼠标(点击/移动/滚轮/右键)、键盘、输入法、粘贴都通,页面收到的
  `isTrusted=true`(真 Chromium 上有断言)。🔴 输入法是这里唯一的结构性坑:`<canvas>`
  不可编辑,浏览器**不会为它启动 IME**,中文一个字都进不来 —— 所以叠了一块透明的取词区
  (`pointer-events:none`,鼠标照旧归 canvas,焦点由 canvas 的 mousedown 交过去),
  合成期不转发按键,`compositionend` / `paste` 整段走 `Input.insertText`。
- **进程责任**(用户服务器不该被我们堆满 Chromium):懒启动(status 不拉起)、并发首调
  共享同一次启动、空闲 10 分钟回收(有人看着预览时不回收)、Chromium 崩了状态归零下次
  重拉、host SIGTERM 必 `dispose()`、客户端断开则它开的预览随之停。
- **踩过的坑**(都是假 CDP 替身测不出、真 Chromium 当场逮到的):
  - 多标签下 `Page.captureScreenshot` / `Page.startScreencast` 都要求目标页在**前台**,
    否则 CDP 回 `Not attached to an active page` —— 两处都先 `Page.bringToFront`。
  - **标签消失后不会自愈**:session 是按 tabId 缓存的,页面自己 `window.close()`
    (agent 驱动的弹窗流程很常见)之后死标签不触发重新 attach,后续命令会一直打向
    一个不存在的 session —— 这台机器的浏览器就此永久失灵。靠 `Target.targetDestroyed`
    清缓存(要先 `Target.setDiscoverTargets` 才有这个事件),外加 attach 失败时的兜底。
  - **profile 锁残留**:Chromium 被 SIGKILL / OOM killer 干掉时来不及清 `SingletonLock`,
    下次启动直接以退出码 21 死掉(`Failed to create ... SingletonLock: File exists`),
    起一次死一次。远端内存紧张时这是常态。清理分两层:① 启动前清「主人已经不在」的锁
    ② 撞锁失败后清「主人正是我们自己启动过的 pid」的锁 —— 后者是因为 SIGKILL 之后
    进程短时间内仍在进程表里,`kill(pid,0)` 照样成功,①的存活检查在那个时机会误判。
    **别人实例活着占着的锁绝不动**(删了会两个实例共写同一 profile)。
    启动失败的错误里带上 Chromium 自己的 stderr 尾部——远端起不来时那是唯一的线索
    (缺 so 依赖、sandbox 被拒、profile 被占,退出码全是一个 21)。
- **测试三层**:`fakeChromium`(真 `CdpConnection` + 假进程/假 ws)覆盖逻辑分支;
  `browserServiceRealChromium.test.ts` 证明 CDP 假设本身成立;
  `browserRpc.integration.test.ts` 走真 ws → hostCore → 真 Chromium 的整条链路。
  后两组默认 skip,本地用 `OKWORK_TEST_REAL_CHROMIUM=1 npx vitest run <file>` 跑。
- **待办**:① 云端浏览器的 Profile 隔离目前是单份 `user-data-dir`,尚未按 Profile 分
  BrowserContext / 接 `remoteProfileStore` 的登录连续性;② 密码保险箱**未**接云端 ——
  真接的话明文密码要送到远端 Chromium,是安全模型的实质变化,需用户显式授权
  (per-profile 开关),不该默认开;③ 文件上传按钮弹的是远端的原生文件框,本地看不见
  (要做得走 `DOM.setFileInputFiles` + 本地选文件后传过去);④ 输入法候选框位置固定在
  取词区,没跟随远端页面的光标(需要远端回报 caret 位置)。

---

## 4.5 CI 与发版

| 工作流 | 触发 | 内容 |
|---|---|---|
| `ci.yml` | push main / PR | typecheck + vitest(ubuntu,1× 计费) |
| `release.yml` | 打 `v*` tag / 手动触发 | macOS(arm64)构建:测试 + 冒烟 + `npm run make`,tag 时附 zip 发 GitHub Release;手动触发只传 artifact |

发版流程:

```bash
npm version patch        # 或 minor/major:改版本号 + commit + 打 tag
git push --follow-tags   # 推 tag 即触发出包
```

仓库已公开:GitHub-hosted runner 免费(含 macOS)。

### 签名与公证(复用 cmux-pro 的 secrets 体系)

forge 的 `osxSign`/`osxNotarize` 从环境变量读取;secrets 未配置时自动回退
ad-hoc 签名(下载后首次打开需右键 → 打开,或 `xattr -dr com.apple.quarantine`)。

okwork 仓库需要与 cmux-pro 同名的 6 个 secrets(值从你保存证书的地方取,
GitHub API 读不出已存 secret 的值):

```bash
gh secret set APPLE_CERTIFICATE_BASE64     -R okteam99/termpro < cert.p12.base64
gh secret set APPLE_CERTIFICATE_PASSWORD   -R okteam99/termpro
gh secret set APPLE_SIGNING_IDENTITY       -R okteam99/termpro   # "Developer ID Application: …(TEAMID)"
gh secret set APPLE_ID                     -R okteam99/termpro
gh secret set APPLE_APP_SPECIFIC_PASSWORD  -R okteam99/termpro
gh secret set APPLE_TEAM_ID                -R okteam99/termpro
```

更省事的做法:在 okteam99 组织设置里把这 6 个升级为 **org-level secrets**
(可见范围选 cmux-pro + okwork),两个仓库共用、以后新仓库也免配。
配好后 Actions 手动触发一次 Release 工作流即可验证签名+公证全链路
(流水线带 Gatekeeper 验收步骤:codesign --verify + stapler validate + spctl)。

## 5. 已知约束

| 约束 | 说明 |
|---|---|
| ~~单窗口单客户端~~（v0.2 已解） | Host 现支持多客户端：共享 PTY 池、会话按归属路由、窗口关闭只回收自己的资源（v0.2 2026-06 交付） |
| 本地会话生命周期（2026-07 standalone 化） | 本地 host 以 `--standalone` 跑远程同款会话语义：客户端断开（renderer 崩溃/⌘R/关窗）转 detach 续跑 + ring（256 KiB/会话，回放非全保真）回放收养；renderer 事故退出由 main 自动 reload（5 分钟 3 次限频，成功加载清零，give-up 弹窗告知 ⌘R）；映射不到 workspace 的本地孤儿会话在收养时 kill 回收（仅本地，远程只做加法）；会话仍随 app 退出整体回收。遗留 P3（opus 评审 2026-07，均可辩护）：① launch-failed 仍走限频 reload 而非直接 give-up；② 本地 host.info 多暴露 fs.temp-png 能力位（本地不消费，cosmetic） |
| 重连全量回放的保真边界（2026-07） | gap 超 ring（256 KiB/会话）→ `full=true` 全量回放,客户端 `term.reset()` 后重写整缓冲。三处已封:① ring 驱逐点对齐**转义序列边界**(否则 `\x1b[0m` 被切成 `0m` 当正文打印);② 收养据快照恢复 `?1049h`/`?2004h`(备用屏 / 粘贴聚合,开机序列常被挤出切片)与**鼠标/焦点上报模式**(`?1000`/`?1002`/`?1006` 等,白名单 `RESTORABLE_DEC_MODES`——不补就是「opencode 一类可鼠标交互的 TUI 重连后鼠标点不动」:远端仍开着跟踪,reset 后的 xterm 却不再编码鼠标事件,用户报障 2026-08-14。**远程机需重新部署服务端**才会上报该字段,老 host 缺省即不恢复);③ host 在 full 回放收尾**拨动 winsize**(缩一行、60ms 还原)逼前台程序整屏重绘——TUI 发的是差分重绘,其基准态已被挤出 ring,不逼重绘则屏幕停在碎片态。仍不保真的部分:滚动区(DECSTBM)、光标可见性等未进快照的模式,靠 ③ 的重绘覆盖 |
| 会话归属绑在**连接**上(2026-07-27) | host 的 `pty:input` 只认「当前连接的 `client.sessions`」(hostCore 归属门),连接一换、没重发 `session.attach` 就是**输入黑洞 + 无输出订阅**,而心跳/延迟/其它 RPC 一切正常——症状是「侧栏显示连接正常、终端卡死、ctrl+c 无效、Ctrl+V 报 host not connected」。两道防线:① `HostClient.epoch`(每挂一条 transport +1)与 `TermInstance.attachedEpoch` 比对,代次失配 = 当前连接上无归属;② 收养/自愈前先 `rebindInstClient` 把 inst 迁到 `hostRegistry.forHostId()` 的**当前实例**——手动断开走 `hostRegistry.drop()`(dispose 实例但**不销毁 tab**),重连时 `getOrCreateRemote` 造的是新实例,旧代码用新实例 attach 却把 inst 留在旧实例上,于是收养「成功」而终端全冻。代次失配时键入不再直发:攒住击键 → 就地重收养 → 成功后原样补发(回放在途则等它落定,不并发第二条 attach——两条各按调用时的 renderedBytes 报 resumeOffset,后发的会让 host 重放同一段) |
| 终端复制两条路(2026-07) | **用户选区 → 剪贴板**:应用菜单的 `role:'copy'` 走 `webContents.copy()`,只认 DOM 选区,而 xterm 选区画在 canvas 上 → 终端 ⌘C 恒空。darwin 上改由渲染层接管(`menuCopy.ts`,DOM 选区 > 终端选区 > 原生兜底);非 darwin 不换,因为那边 `role:'copy'` 的加速键 Ctrl+C 同时是终端 SIGINT。**程序 → 剪贴板**:OSC 52(`osc52.ts`),xterm.js 不内建、须自注册。安全边界:🔴 读请求(`Pd=='?'`)一律拒绝(那是把本机剪贴板外泄给远端进程),载荷上限 1 MiB,base64 严格校验 |
| Electron 升级需重编 node-pty | forge 的 `rebuild` 配置自动处理，直接 `npm start` / `make` 即可 |
| 沙箱 preload 无 process.env | 冒烟开关 `OKWORK_SMOKE` 不能在 preload 读取；main 通过 `additionalArguments: ['--okwork-smoke']` 传入，preload 读 `process.argv` |
| 协议版本 | `PROTOCOL_VERSION = 1`；M5 远程接入时需做版本握手校验 |
| UI 关闭期间无系统通知 | M1-M4 靠重连对账兜底；推送通道留 M5 后 |
| shell integration 仅 zsh | spawn zsh 时经 ZDOTDIR 包装自动注入 OSC 133/7；`OKWORK_NO_SHELL_INTEGRATION=1` 关闭；bash/fish 待后续 |
| 查看器保存无 mtime 守卫 | 轻编辑场景:文件被外部修改后保存会直接覆盖（跟进项：读时记 mtime，写时校验） |
| p10k instant prompt | 注入钩子在 .zshrc 末尾输出 OSC 序列，Powerlevel10k instant-prompt 可能提示"console output during init"（与 VS Code 同模式，无功能影响） |
| FilePanel 编排已知 P2 | 编排收敛在 `src/renderer/filepanel/`（单 reducer 三道过期闸：resolveDone 按 generation、树/着色按 root、top/status 按单调 seq）。遗留 P2（opus 评审 2026-06，均与重构前等价或更优）：① refresh / lockRoot 回写后 resolveDone 会冗余二拉 git.status（seq 闸丢弃旧值，自纠正）；② childDone 无 seq，同目录懒拉与 partial 重拉并发时 last-writer-wins（旧实现同病）；③ dispose 与 watchReady 同 tick 边界无专测 |

---

## 6. 里程碑状态

M1–M4 及 v0.2/v0.3 增量均已 ✅ 2026-06 交付，详见 [README.md §四](../README.md)。

已交付增量摘要：
- **v0.2**：更新检查与一键升级；文件预览/diff 独立窗口；Host 多客户端支持
- **v0.3**：三窗口模型（主窗口/文件内容窗口/git diff 窗口）；Markdown 预览/编辑双模式；脏 tab 关窗确认

剩余待做：

| 里程碑 | 方向 |
|---|---|
| **M5** | 远程 Host：Host 打包独立可执行（纯 node 单文件）；SSH 隧道 + WebSocket 接入；协议版本握手；断线重连回放；远程通知路由（v1 重连对账） |

详细范围见 [README.md §四](../README.md)。
