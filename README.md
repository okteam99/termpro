# TermPro

> AI IDE:以终端为主体的多工程、多并行会话工作台。
> 终端不关心里面跑的是什么 agent——工具无关是第一设计原则。

## 一、为什么做这个

日常开发的形态已经变成:**同时盯着多个 CLI agent(Claude Code / Codex / 任意工具)在多个项目、多条分支上并行干活**。

- 通用终端(iTerm / Ghostty)只有"窗口 + tab",没有"工程"和"并行会话"的概念;
- 现有 agent 管理器(Conductor / Crystal 等)反过来绑定了特定 agent,终端体验是从属的。

TermPro 取中间立场:**终端是主体,外围能力是产品**——工程与会话管理、等待输入通知、文件浏览、git 操作。

## 二、概念模型

| 概念 | 含义 | 对应 UI |
|---|---|---|
| **Workspace** | 一个项目工程(通常对应一个 repo) | 左侧栏一项 |
| **Tab** | Workspace 内的一个并行开发会话,持有一个 PTY;通常对应一个 git worktree,但**不强绑定** | 顶部 tab 条 |
| **Terminal** | 哑终端,跑任意 CLI | 中间区域 |
| **File Panel** | 当前会话的文件视图,可在 Root / WorkTree 两个根之间切换 | 右侧面板 |

> 核心原则:终端保持哑且工具无关。一切状态感知走终端层标准协议(进程名、OSC 序列、BEL),
> 不解析特定 agent 的输出、不依赖特定 agent 的钩子(将来可作为可选 adapter 插件,但核心永不依赖)。

## 三、UI 蓝图(对照设计截图)

```
┌────────────┬───────────────────────────────┬─────────────────┐
│ 🔔  ＋     │ Tab1 │ Tab2 ✕    [⌨][🌐][▥]   │ Root │ WorkTree │
│            ├───────────────────────────────┤ path…  [Choose] │
│ ▌AON       │                               │ 38 entries   ⟳  │
│  staging*  │                               │ ▸ .claude       │
│  ~/path    │      终端区 (xterm.js)        │ ▸ apps          │
│            │                               │ ▸ docs          │
│ VLite      │                               │   README.md     │
│  main      │                               │   …             │
│  ⎇ PR#289  │                               │                 │
└────────────┴───────────────────────────────┴─────────────────┘
```

- **左侧栏(Workspace 列表)**:每项显示 名称 / 当前分支(脏标记 `*`)/ 路径 / 徽标(PR 状态、运行中 / 等待输入)。当前项高亮。顶部 `＋` 新建 workspace。
- **顶部 Tab 条**:会话名 + 关闭按钮;右侧预留 内容类型 / 分栏布局 切换按钮。
- **右侧 File Panel**:`File Root / File WorkTree` 切换 = 换树根;路径栏可手动指定 + Apply;条目按 git 状态着色(untracked / modified / ignored);条目计数 + 手动刷新。
- **🔔 通知中心**:聚合所有 tab 的"等待输入 / 已完成"事件,点击跳转对应 tab。

## 四、功能范围与里程碑

### M1 — 可用壳(目标:日常能开始用)✅ 2026-06
- [x] 三栏布局;workspace 增删 + 切换;tab 增删 + 切换(⌘T/⌘W/⌘1-9)
- [x] 每 tab 一个 node-pty 会话(指定 cwd / shell / env)
- [x] xterm.js ≥ 6 + WebGL + unicode11(中文宽字符对齐)+ 搜索 addon
- [x] workspace / tab 结构与布局持久化,重启恢复(恢复到 cwd 级)

开发与冒烟见 [docs/DEV.md](docs/DEV.md)。

### M2 — 工程与 git
> 边界:worktree 的创建/删除是用户自己的事,TermPro 不代办。
> tab 只是会话,跑在主仓还是某个 worktree 由用户决定;关 tab 不碰 worktree。
> TermPro 只做「感知与展示」:识别会话所在的仓库/工作区并联动 UI。

✅ 2026-06 完成:
- [x] Workspace 可重命名(侧栏内联编辑,持久化)
- [x] 侧栏 workspace 项显示主工作区(main worktree)当前分支名
- [x] 新建 tab 可选择起始目录(默认 workspace root,也可指到任意目录,如已有 worktree)
- [x] 文件面板随会话联动:切换/点击 session 时——
      Root 视图 = 该会话所属仓库的主工作区根;
      WorkTree 视图 = 该会话所在工作区根(`git rev-parse --show-toplevel`,非 git 目录回退 cwd;
      实时 cwd 经 `pty.cwd`/lsof 按需查询,OSC 7 可用时即时跟随)
- [x] 右侧文件树:watch 自动刷新(保留展开态)、git 状态着色(含目录上卷)
- [x] Host git 服务:`git.info(cwd)` / `git.status(toplevel)` / `pty.cwd` / `fs.watch`

反馈打磨(2026-06):
- [x] 三栏宽度可拖拽调节(持久化)
- [x] Root / WorkTree 改为**与单个 tab 绑定**(持久化):
      Root 在 **tab 首次进入时锁定**为当时的主目录,不随终端 cd 漂移;
      仅显式修改(输入框 / Choose…)或 Apply(采用提示行的实时主目录)才变更;
      WorkTree 从 `git worktree list` 下拉选择绑定(`相对路径 · 分支`,信息行 `分支 · 短SHA`)

### M3 — 状态感知与通知(差异化核心)
- [ ] 信号①:轮询 `pty.process` 前台进程名(running / idle 的硬信号,零协议依赖)
- [ ] 信号②:OSC 133 shell integration 注入(命令开始 / 结束的精确事件)
- [ ] 信号③:BEL + OSC 9/777 → 系统通知
- [ ] 信号④:备用屏 + 输出静默计时 → "可能在等输入"软标记
- [ ] tab 状态机 `running / waiting / done / idle` → 侧栏徽标、Dock 角标、通知中心

### M4 — 文件查看与 diff
- [ ] Monaco(懒加载):文件只读 / 轻编辑
- [ ] worktree vs 基线分支的 diff 视图(Monaco diff editor)
- [ ] "Open in VS Code / Zed" 一键外跳

### M5 — 远程 Host(架构兑现)
- [ ] Host 打包为独立可执行(纯 node,单文件);`ssh` 隧道 + WebSocket 接入,不自研认证
- [ ] 协议版本握手与兼容性检查
- [ ] 断线重连:scrollback 环形缓冲回放 + 状态徽标对账
- [ ] 远程通知路径:v1 仅重连对账;推送通道(手机/菜单栏常驻薄连接)留到以后

### 非目标(明确不做)
- ❌ 完整编辑器 / LSP——重度编辑外跳到专业编辑器
- ❌ 内置或绑定任何 agent;不解析特定 agent 的输出格式
- ❌ 通用终端的极致性能竞赛(够流畅跑 agent CLI 即可)
- ❌ 暂不做 Windows / Linux(先 macOS)
- ⚠️ 远程会话:M1–M4 不交付,但**架构按远程就绪设计**(见「五、架构」),M5 兑现

## 五、架构:UI 与 Host 分离(远程就绪)

> 设计约束:**UI 层永远不直接访问文件系统 / PTY / git,只通过 `HostService` 协议通信。**
> 目的:终端核心逻辑未来可整体搬到远程机器,UI 不改一行。参照 VS Code Remote
> (workbench ↔ vscode-server)的成熟形状。

```
┌── UI 壳(Electron renderer + main)───────────────┐
│ xterm.js · Monaco · React · OS 通知 / Dock 角标    │
│           只依赖一个接口:HostService              │
└───────────────────┬───────────────────────────────┘
    统一协议:RPC + 事件推送 + PTY 二进制流(含流控)
    本地传输:MessagePort    远程传输:SSH 隧道 + WebSocket
┌───────────────────┴───────────────────────────────┐
│ Host 进程(纯 Node,零 Electron 依赖)             │
│ PTY 池 · fs 读写/watch · git/gh · 会话状态机       │
│ 输出环形缓冲(断线重连回放,tmux 式)              │
└───────────────────────────────────────────────────┘
```

五条规则:
1. **Host 进程零 Electron 依赖**——本地跑在 utilityProcess,远程跑在 ssh 拉起的独立 node 进程,同一份代码。OS 通知 / Dock 角标留在壳层,由 host 事件驱动;
2. **一套协议三类消息**:RPC(请求/响应)、事件推送、PTY 二进制流;流控(credit / pause-resume)是协议的一部分,本地与远程共用同一机制;
3. **UI 中一切路径都是 `(hostId, path)`**,不存在裸本地路径;文件树 / 读写 / watch 全走 host。API 设计粗粒度(readdir 一次返回带 git 状态的完整条目;watcher 事件 host 侧去抖合并),避免 WAN 上的 chatty 调用;
4. **git / gh 在 host 侧执行**,UI 只收结构化结果;Monaco 的读写与 diff 内容同样经 fs 服务获取,远程自动可用;
5. **会话状态机驻留 host**:host 对 PTY 字节流做轻量扫描(OSC 133 / BEL / 备用屏开关)+ `pty.process` 轮询——**UI 断开时会话与状态照常运行**,host 维护输出环形缓冲,重连回放屏幕。

红利:这套分离顺手解锁「合盖离开,服务器上的 agent 继续跑,回来重连看徽标」的 tmux 式体验——与产品定位天然契合。
代价:M1 约 +10–15%(独立 PTY 进程与流控本来就要做);不做的代价是日后每个功能重写数据访问层。
已知限制:UI 完全关闭期间收不到系统通知,靠重连对账兜底;推送通道是后话。

## 六、技术栈与已定决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 壳 | **Electron**(utilityProcess 跑 PTY,MessagePort 流给渲染层) | node-pty / xterm / Monaco 均为一等公民;Crystal(MIT)可作参考实现 |
| 终端 | **`@xterm/xterm` ≥ 6.0** + addon-webgl / fit / unicode11 / serialize / search | 6.0 起支持同步输出(DEC mode 2026),Ink 类 TUI(Claude Code)不闪烁 |
| PTY | **node-pty** | `process` 属性直接给出前台进程名 = 状态信号① |
| 编辑 / diff | **monaco-editor**(懒加载) | diff 视图零成本 |
| git | shell out **`git` / `gh`** | 不引 libgit2,降低维护面 |
| 架构 | UI ↔ Host 进程分离,单一 RPC 协议 | 远程就绪(详见五);本地 MessagePort,远程 SSH 隧道 + WebSocket |
| 放弃项 | Ghostty fork(原生 Swift 路线) | 评估结论见附录:终端不是本产品差异化点,UI 生态差距大 |

### 工程红线(写给未来的自己)
1. **流控**:PTY → UI 必须做 watermark + pause/resume,否则 agent 倾倒 build 日志时内存与帧率一起崩;流控属于 Host 协议的一部分,本地 / 远程共用;
2. **渲染器生命周期**:WebGL context 每页有上限,只给可见 tab 挂 WebGL renderer;后台 tab 照常 `write()` 进 buffer;
3. **Monaco 懒加载**:首屏只有终端;
4. **node-pty 原生模块**:Electron 升级即重编,走 forge/builder 标准流程。

## 七、附录:选型调研结论(2026-06)

1. **Ghostty fork 可行但不划算**:其 macOS tab = 独立 NSWindow(原生 window tabbing),做"单窗口 + 侧栏 + 自绘 tab"需重写整个窗口层;文件树 / diff / 通知全要 Swift 手搓;且只覆盖 macOS。对"会话编排器"的定位,投入收益错配。终端品质本身(Metal 渲染、输入延迟)不是本产品的卖点。
2. **xterm.js 跑 agentic CLI 已被海量验证**:VS Code / Cursor 集成终端即 xterm.js;6.0(2025-12)合入同步输出后,TUI 高频重绘的闪烁问题在协议层解决。
3. **同形态先例**:[Crystal](https://github.com/stravu/crystal)(Electron + xterm.js + git worktree 多会话,MIT,已停更转向闭源 Nimbalyst)——PTY 管理、会话持久化等实现可直接参考。
