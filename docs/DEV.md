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
| 重连全量回放的保真边界（2026-07） | gap 超 ring（256 KiB/会话）→ `full=true` 全量回放,客户端 `term.reset()` 后重写整缓冲。三处已封:① ring 驱逐点对齐**转义序列边界**(否则 `\x1b[0m` 被切成 `0m` 当正文打印);② 收养据快照恢复 `?1049h`/`?2004h`(备用屏 / 粘贴聚合,开机序列常被挤出切片);③ host 在 full 回放收尾**拨动 winsize**(缩一行、60ms 还原)逼前台程序整屏重绘——TUI 发的是差分重绘,其基准态已被挤出 ring,不逼重绘则屏幕停在碎片态。仍不保真的部分:滚动区(DECSTBM)、光标可见性等未进快照的模式,靠 ③ 的重绘覆盖 |
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
