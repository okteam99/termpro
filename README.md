# TermPro

> 个人 AI IDE:以终端为主体的多工程、多并行会话工作台。
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

### M1 — 可用壳(目标:日常能开始用)
- [ ] 三栏布局;workspace 增删 + 切换;tab 增删 + 切换
- [ ] 每 tab 一个 node-pty 会话(指定 cwd / shell / env)
- [ ] xterm.js ≥ 6 + WebGL + unicode11(中文宽字符对齐)+ 搜索
- [ ] workspace / tab 结构与布局持久化,重启恢复(恢复到 cwd 级)

### M2 — 工程与 git
- [ ] 新建 tab 可选"顺手 `git worktree add`";关 tab 可选清理 worktree
- [ ] 左侧栏 / tab 显示分支、dirty、ahead/behind;PR 状态(shell out `gh`)
- [ ] 右侧文件树:chokidar watch、git 状态着色、Root / WorkTree 切换

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

### 非目标(明确不做)
- ❌ 完整编辑器 / LSP——重度编辑外跳到专业编辑器
- ❌ 内置或绑定任何 agent;不解析特定 agent 的输出格式
- ❌ 通用终端的极致性能竞赛(够流畅跑 agent CLI 即可)
- ❌ 暂不做 SSH 远程会话;暂不做 Windows / Linux(先 macOS)

## 五、技术栈与已定决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 壳 | **Electron**(utilityProcess 跑 PTY,MessagePort 流给渲染层) | node-pty / xterm / Monaco 均为一等公民;Crystal(MIT)可作参考实现 |
| 终端 | **`@xterm/xterm` ≥ 6.0** + addon-webgl / fit / unicode11 / serialize / search | 6.0 起支持同步输出(DEC mode 2026),Ink 类 TUI(Claude Code)不闪烁 |
| PTY | **node-pty** | `process` 属性直接给出前台进程名 = 状态信号① |
| 编辑 / diff | **monaco-editor**(懒加载) | diff 视图零成本 |
| git | shell out **`git` / `gh`** | 不引 libgit2,降低维护面 |
| 放弃项 | Ghostty fork(原生 Swift 路线) | 评估结论见附录:终端不是本产品差异化点,UI 生态差距大 |

### 工程红线(写给未来的自己)
1. **流控**:PTY → 渲染进程必须做 watermark + pause/resume,否则 agent 倾倒 build 日志时内存与帧率一起崩;
2. **渲染器生命周期**:WebGL context 每页有上限,只给可见 tab 挂 WebGL renderer;后台 tab 照常 `write()` 进 buffer;
3. **Monaco 懒加载**:首屏只有终端;
4. **node-pty 原生模块**:Electron 升级即重编,走 forge/builder 标准流程。

## 六、附录:选型调研结论(2026-06)

1. **Ghostty fork 可行但不划算**:其 macOS tab = 独立 NSWindow(原生 window tabbing),做"单窗口 + 侧栏 + 自绘 tab"需重写整个窗口层;文件树 / diff / 通知全要 Swift 手搓;且只覆盖 macOS。对"会话编排器"的定位,投入收益错配。终端品质本身(Metal 渲染、输入延迟)不是本产品的卖点。
2. **xterm.js 跑 agentic CLI 已被海量验证**:VS Code / Cursor 集成终端即 xterm.js;6.0(2025-12)合入同步输出后,TUI 高频重绘的闪烁问题在协议层解决。
3. **同形态先例**:[Crystal](https://github.com/stravu/crystal)(Electron + xterm.js + git worktree 多会话,MIT,已停更转向闭源 Nimbalyst)——PTY 管理、会话持久化等实现可直接参考。
