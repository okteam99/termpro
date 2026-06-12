# TermPro — 开发者文档

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
TERMPRO_SMOKE=1 npx electron-forge start
# 渲染层完成 Host 握手 + 首个 PTY 输出后打印 SMOKE_OK 自动退出，30s 超时打印 SMOKE_TIMEOUT 以 exit(1) 退出
# userData 隔离至 os.tmpdir()/termpro-smoke，不污染本地布局存档
```

---

## 3. 目录结构

```
src/
├── main/          Electron 主进程
│   ├── main.ts       窗口创建、菜单、utilityProcess 拉起 Host、布局存档 IPC、冒烟逻辑
│   └── appStore.ts   布局持久化 IPC 实现（store:get / store:set）
├── preload/       沙箱 preload（contextBridge）
│   └── preload.ts    暴露 window.termpro API；Host MessagePort 经 window.postMessage 转移
├── host/          纯 Node Host 进程（零 Electron import，远程就绪）
│   ├── host.ts       utilityProcess 入口；单客户端路由；RPC dispatch
│   ├── ptyPool.ts    PTY 会话池；流控（highWatermark/lowWatermark）；进程名轮询
│   └── fsService.ts  readdir / home 工具函数
├── shared/        UI ↔ Host 协议契约
│   └── protocol.ts   消息类型、RpcMethods 注册表、FLOW 水位常量、PROTOCOL_VERSION
└── renderer/      React UI
    ├── App.tsx            根组件；连接 Host、初始化持久化、订阅菜单事件
    ├── index.tsx          React 入口
    ├── components/        Sidebar / TabBar / FilePanel
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

termpro 仓库需要与 cmux-pro 同名的 6 个 secrets(值从你保存证书的地方取,
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
(可见范围选 cmux-pro + termpro),两个仓库共用、以后新仓库也免配。
配好后 Actions 手动触发一次 Release 工作流即可验证签名+公证全链路
(流水线带 Gatekeeper 验收步骤:codesign --verify + stapler validate + spctl)。

## 5. 已知约束

| 约束 | 说明 |
|---|---|
| 单窗口单客户端 | Host 维护 `active` 单客户端；窗口重载时新客户端接入会回收旧客户端全部 PTY 会话（M3 会话保活前不改变） |
| Electron 升级需重编 node-pty | forge 的 `rebuild` 配置自动处理，直接 `npm start` / `make` 即可 |
| 沙箱 preload 无 process.env | 冒烟开关 `TERMPRO_SMOKE` 不能在 preload 读取；main 通过 `additionalArguments: ['--termpro-smoke']` 传入，preload 读 `process.argv` |
| 协议版本 | `PROTOCOL_VERSION = 1`；M5 远程接入时需做版本握手校验 |
| UI 关闭期间无系统通知 | M1-M4 靠重连对账兜底；推送通道留 M5 后 |
| shell integration 仅 zsh | spawn zsh 时经 ZDOTDIR 包装自动注入 OSC 133/7；`TERMPRO_NO_SHELL_INTEGRATION=1` 关闭；bash/fish 待后续 |
| 查看器保存无 mtime 守卫 | 轻编辑场景:文件被外部修改后保存会直接覆盖（跟进项：读时记 mtime，写时校验） |
| p10k instant prompt | 注入钩子在 .zshrc 末尾输出 OSC 序列，Powerlevel10k instant-prompt 可能提示"console output during init"（与 VS Code 同模式，无功能影响） |
| FilePanel 编排已知 P2 | 编排收敛在 `src/renderer/filepanel/`（单 reducer 三道过期闸：resolveDone 按 generation、树/着色按 root、top/status 按单调 seq）。遗留 P2（opus 评审 2026-06，均与重构前等价或更优）：① refresh / lockRoot 回写后 resolveDone 会冗余二拉 git.status（seq 闸丢弃旧值，自纠正）；② childDone 无 seq，同目录懒拉与 partial 重拉并发时 last-writer-wins（旧实现同病）；③ dispose 与 watchReady 同 tick 边界无专测 |

---

## 6. 下一步里程碑

| 里程碑 | 方向 |
|---|---|
| **M2** | worktree / git：新建 tab 可选 `git worktree add`；左侧栏显示分支/dirty/ahead-behind；右侧文件树 chokidar watch + git 状态着色 |
| **M3** | 状态感知通知：`pty.process` 轮询 + OSC 133 shell integration + BEL/OSC 9/777 → tab 状态机 `running/waiting/done/idle` → Dock 角标 / 通知中心 |
| **M4** | Monaco diff：文件只读/轻编辑；worktree vs 基线 diff 视图；"Open in VS Code/Zed" 一键外跳 |
| **M5** | 远程 Host：Host 打包独立可执行；SSH 隧道 + WebSocket 接入；断线重连回放 |

详细范围见 [README.md §四](../README.md)。
