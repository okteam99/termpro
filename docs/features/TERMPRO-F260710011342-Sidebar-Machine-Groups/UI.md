---
pages:
  - {id: sidebar-machine-groups, title: "Sidebar Machine Groups"}
  - {id: add-workspace, title: "Add Workspace (Machine-scoped)"}
panorama_medium: same-stack
panorama_path: docs/design
pages_changed:
  - {page_id: sidebar-machine-groups, route_path: /sidebar/machine-groups, change_range: "新页(main.jsx L1992-2185):Sidebar 机器分组主视图 + 组头连接生命周期(连接中/部署中%/失败+重试) + 断线确定性回落(D-8 两段式) + 远程 workspace 文件区禁用提示。共享组件增量扩展(MachineGroup/MachineWorkspaceRow/FilePanel/TreeRow/PlainTerminal · 均向后兼容,add-workspace/remote-hosts 页零回归)。", acceptance_criteria_refs: [AC-1, AC-2, AC-8, AC-10, AC-11]}
  - {page_id: add-workspace, route_path: /workspace/add-workspace, change_range: "远程目录浏览器增量(main.jsx AddWorkspaceModal 目录步骤 + AddWorkspacePage.loadDir):fs.readdir 加载态(350ms 转圈) + 权限拒绝错误态(REMOTE_DIR_ERRORS mock · 命中 .config) + Create 按钮按加载/错误态禁用。其余步骤(选机器/本机对话框占位/创建落组)未动。", acceptance_criteria_refs: [AC-3, AC-4, AC-5]}
---

# UI.md — BL-004 机器分组 Sidebar + 添加项目流程

本 Feature 在既有全景 `/workspace/add-workspace`（模型 A · 已用户确认 2026-07-09）上做**增量细化**，未推倒重画。新增 `/sidebar/machine-groups` 承载 Sidebar 机器分组主视图本身（AC-1/2/8/10/11 的主要呈现面），`/workspace/add-workspace` 只补齐远程目录浏览器缺的加载/错误态。共享组件（`MachineGroup` / `MachineWorkspaceRow` / `FilePanel` / `TreeRow` / `PlainTerminal`）全部走**向后兼容的可选 prop 扩展**，未改变任何既有调用点的默认行为——`/workspace/add-workspace` 与 `/settings/remote-hosts` 两页逐条回归验证零变化（见 §验证）。

## 页面列表

| page_id | route_path | 定位 |
|---|---|---|
| `sidebar-machine-groups` | `/sidebar/machine-groups` | Sidebar 机器分组主视图：本机组 + 远程机组、连接生命周期、断线回落、远程文件禁用提示的唯一权威页面 |
| `add-workspace` | `/workspace/add-workspace` | 既有「添加项目」全景页（BL-003/规划轮已建），本次仅补远程目录浏览器 loading/error 态 |

## 交互流

### A. `/sidebar/machine-groups`

- **默认态（`idle`，可真实交互）**：本机组置顶（TermPro，2 个标签 · 1 running）+ mini-pc 组（已连接，展开 aon-edge / ml-lab 两个 workspace）+ dev-server 组（未连接，显「连接」入口）。默认激活 workspace = mini-pc/aon-edge，用来把 AC-5 的远程 FilePanel 行为直接摆在首屏，不需要额外点击才能看到。
  - 点任意 workspace 行 → 切换主区激活 workspace（TabBar 标题 + 远程机小标签、Terminal 提示符 `liam@{alias}`、FilePanel 树内容随之切换）。
  - 点 dev-server 组头「连接」→ 复用既有 `startMachineConnect`（600ms 连接中 → 已连接 + 发现该机 workspace），与 `/workspace/add-workspace` 页同一套模拟时序，行为一致。
- **`m0`（M=0 纯本机，AC-10）**：`machines` 只含本机一组，无远程组、无空远程占位；组头渲染逻辑与多机场景完全同一套代码路径（非条件分支特判），保证组结构语义恒定。
- **`deploying`（部署中快照 · 47%，AC-8）**：dev-server 组头挂 `runtime={stage:'deploying', percent:47}`，渲染「部署中… 47%」+ spinner，复用 `/settings/remote-hosts` 的 `CONNECT_STAGE_LABEL` 口径（同一份文案常量，非另起一套）。
- **`failed`（连接失败，AC-8）**：dev-server 组头挂 `runtime={stage:'failed', reason:'unreachable'}`，渲染「✗ 不可达」+「重试」按钮；「重试」点击行为 = 退出 preset 快照、回到可真实交互的 `idle` 态（用户从这里可以点「连接」走完整成功编排）——这是刻意设计：devbar preset 是「页面到不了的态」的静态展示，不是要在 preset 内再模拟一整套失败→重试→成功的编排（那套编排已经在 `/settings/remote-hosts` 完整存在，不重复造）。
- **`disconnected`（断线回落，AC-11/D-8，两段式）**：
  1. **panel 阶段**（0–900ms）：mini-pc 组头转红点；其活跃 workspace `aon-edge` 行内打「已断开」标签；Terminal 区域整块替换为断线提示（「与 mini-pc 的连接已断开」+ 「即将回落到本机工作区…」）；FilePanel 整块替换为「连接已断开 · 文件树暂不可用」提示；此阶段内点击其它 workspace 行**不响应**（锁定，防止用户在确定性回落的瞬间半路打断，制造更混乱的中间态）。
  2. **folded 阶段**（900ms 后，自动触发）：`activeWorkspaceId` 回落到本机第一个 workspace（TermPro），Terminal/FilePanel 恢复正常内容且指向本机；mini-pc 组折叠为「已断开 · 点击重连」空态（视觉上退回未连接态，但保留「已断开」措辞与红点，与「从未连接过」的 `disconnected` 灰态区分）。
  - 断线后的重连横幅 / 自动重连 / 状态对账**不在这个页面范围**（D-8 明确划归 BL-005），本页只做「断线那一刻发生了什么」的确定性回落展示。

### B. `/sidebar/machine-groups` 内的远程文件禁用提示（AC-5/D-7）

- 远程 workspace 激活时，FilePanel 顶部 Diff 按钮、每行文件的行内 `diff` 按钮、文件行本身，三个点击入口全部触发同一条确定性提示「远程文件独立窗口暂不支持」（1.8s 后自动消失的行内提示条，非 modal），同时按钮呈半透明 + `cursor: not-allowed` + 原生 `title` 悬浮提示。**目录/git 着色树浏览完全不受影响**（点目录行正常展开/收起，`file-panel__row--git-*` 着色类照常生效）——这条边界是 D-7 的核心：远程「文件」=树浏览+git 着色在范围，内容/Diff 渲染出范围。
- 实现上刻意用 `aria-disabled`（视觉禁用）而非原生 HTML `disabled` 属性：原生 `disabled` 的按钮不会派发 click 事件，会让「点击后必须给确定性反馈」这条要求在真实浏览器里失效（点了没反应 = 静默失败，正是 D-7 明确禁止的行为）。设计走查中用 headless 浏览器实测验证过这个区别（原生 `disabled` 版本点击无响应；改 `aria-disabled` 后点击正确弹出提示）。

### C. `/workspace/add-workspace` 远程目录浏览器增量（AC-3）

- 选定远程机后，`loadDir()` 先进 350ms 加载态（转圈 +「正在读取目录…」），复用既有 `add-ws__spinner`；命中 `REMOTE_DIR_ERRORS`（mock 了 `~/.config` 权限拒绝）则不展示目录列表，改为红色错误块（`EACCES` 文案）+「重试」按钮；「创建项目」按钮在加载/错误两态下都禁用，防止对着一个还没读到 / 读失败的目录发起创建。空目录态（已有的 `(空目录)`）与新增的加载/错误态是三个互斥分支，视觉结构对齐（同一容器区域切换内容，不挪位置）。
- 面包屑导航沿用既有 `onCrumb`，改走 `loadDir` 触发同一套加载动画（跳到任一层级都会重新经历一次加载态，符合真实 `fs.readdir` 每次都是一次 IO 的心智模型）。

## 视觉规范

- 沿用既有深色工作台配色（`--bg` / `--bg-panel` / `--accent` / `--green` / `--amber` / `--red`，`project-specs/UI-RULES.md` 当前是未填的模板占位，故以 preview-project 既有 tokens 为唯一权威，未新增任何颜色变量）。
- 会话徽标（AC-2/D-9）：数值语义从「host 侧会话数」改为「本客户端活跃 tab 数」，新增 `ws.tabCount`/`ws.tabRunning` 结构化字段（数字，向后兼容旧的 `ws.sessions` 字符串字段，两套并存，旧调用点零改动）。`tabCount === 0` 时用 `.sidebar-machine-sessions--zero` 修饰符（灰色而非绿色）显式呈现「0 个标签」，不是隐藏——这是 D-9 决策「首连远程机徽标可为 0」的直接视觉体现，必须看得见，不能因为「0 是 falsy」就被旧的条件渲染吞掉（这也是本次唯一发现并修的组件逻辑坑：旧 `{ws.sessions && ...}` 对字符串没问题，但如果当初直接改成数字 `{ws.tabCount && ...}` 会把 0 吞掉，所以改用显式 `formatTabBadge()` 帮助函数统一处理两种输入源）。
- 组头连接生命周期状态文案/配色**直接复用** `/settings/remote-hosts` 的 `CONNECT_STAGE_LABEL` / `FAIL_REASONS` 常量与配色语义（琥珀=进行中、红=失败/断开、绿=已连接），不是照抄视觉、是真的引用同一份 JS 常量——保证 Sidebar 组头与 Remote Hosts 管理页对同一台机器的状态文案永远一致，不会出现两处措辞漂移。

## 字段映射（AC → UI）

| AC | UI 呈现 | 关键 DOM/组件 |
|---|---|---|
| AC-1 | 本机组置顶 + M 个远程机组（未连接=别名+连接入口，不展开） | `Sidebar` → `MachineGroup`（`machine.workspaces === null` 分支） |
| AC-2 | 已连接远程机组展开 workspace + 会话徽标（本客户端 tab 数，可为 0） | `MachineWorkspaceRow` + `formatTabBadge()` |
| AC-3 | 添加项目：选机器 → 本机对话框占位 / 远程目录浏览器（加载/空/错误态） | `AddWorkspaceModal` step=`local`/`dir` + `add-ws__dirlist--loading` / `add-ws__dir-error` |
| AC-4 | 远程目录浏览器确认创建 → 落对应机器组 | `AddWorkspacePage.handleCreate` |
| AC-5 | 远程 workspace 激活：FilePanel 树浏览+git 着色可用；文件内容/Diff 禁用+提示 | `FilePanel remote={true}` + `TreeRow` + `.file-panel__remote-hint` |
| AC-8 | 组头连接中/部署中%/失败原因+重试 | `MachineGroup.renderRuntimeStatus()`（`machine.runtime`） |
| AC-10 | M=0 → 单「本机」组头，组结构恒显 | `/sidebar/machine-groups` `m0` preset |
| AC-11 | 断线：workspace 面板断线态 → activeWorkspaceId 回落本机首个 → 组头折叠 | `/sidebar/machine-groups` `disconnected` preset（`lostPhase` 状态机） |

## Preset 清单（dev 顶栏）

| 页面 | preset key | 覆盖 | 说明 |
|---|---|---|---|
| `/sidebar/machine-groups` | `idle` | AC-1/2/5 | 默认可交互态，点「连接」走真实编排 |
| `/sidebar/machine-groups` | `m0` | AC-10 | 纯本机退化态 |
| `/sidebar/machine-groups` | `deploying` | AC-8 | 部署中 47% 冻结快照 |
| `/sidebar/machine-groups` | `failed` | AC-8 | 连接失败 + 重试入口 |
| `/sidebar/machine-groups` | `disconnected` | AC-11 | 两段式断线回落（900ms 自动过渡） |
| `/workspace/add-workspace` | `idle`/`connecting`/`deploying`/`error`/`disconnected` | AC-3/4 | 既有 preset 未改动；目录浏览器加载/错误态改为真实交互触达（选 mini-pc → 进 `~/.config` 即复现），不需要新增 preset |

按 UI-RULES 的「页面内容禁内嵌预览控件」硬约束，以上均只出现在全局 dev 顶栏，页面内不额外塞场景切换控件。

## 验证

- `cd docs/design/preview-project && npm ci && npx vite build` — 通过（`✓ 33 modules transformed`，无报错）。
- headless 浏览器逐页走查（6 条路由：新增 1 条 + 既有 5 条）：`console --errors` 全部 `(no console errors)`。
- `/sidebar/machine-groups` 5 个 preset + 默认交互路径（点 workspace 行切换、点「连接」触发编排、断线两阶段状态机的真实时序）均实测通过，包括修正后的远程文件禁用点击反馈（原生 `disabled` → `aria-disabled` 那处坑）。
- `/workspace/add-workspace` 远程目录浏览器新增的 loading/error 态实测：选 mini-pc → 350ms 加载 → 目录列表；进 `.config` → 350ms 加载 → 权限拒绝错误 + Create 禁用。
- `/workspace/add-workspace` 与 `/settings/remote-hosts` 两页回归走查：默认/断线/部署中/失败等既有 preset 视觉与交互均未变化。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-10 | 首版：新增 `/sidebar/machine-groups` 页 + `/workspace/add-workspace` 远程目录浏览器加载/错误态增量；共享组件向后兼容扩展；sitemap.md 登记新路由 |
