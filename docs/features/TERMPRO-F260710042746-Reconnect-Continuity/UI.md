---
pages:
  - {id: reconnect-continuity, title: "断线重连与会话连续性"}
panorama_medium: same-stack
panorama_path: docs/design
pages_changed:
  - page_id: reconnect-continuity
    route_path: /session/reconnect-continuity
    panorama_file: docs/design/preview-project/src/main.jsx#ReconnectContinuityPage
    change_range: "新增 ReconnectContinuityPage 路由页(叠加于既有 app-shell)+ 扩展 MachineGroup/MachineWorkspaceRow 支持「重连中」保活态 + 新增 tab-dot--exited 已完成态"
    acceptance_criteria_refs: [AC-1, AC-3, AC-4, AC-5, AC-6, AC-10, AC-12, AC-13, AC-15]
---

# 断线重连与会话连续性 - UI 设计意图 & 追溯

> 🔴 全景宿主：TermPro(单子项目仓库 · 无跨子项目拆分)
> 🔴 panorama_path: `docs/design`(即 `{子项目}/docs/design` · 单项目仓库 · {子项目} = 仓库根)
> 🔴 panorama_medium: same-stack —— `docs/design/preview-project/` 同栈独立项目 · 源即全景权威 · `bash preview.sh` 起 dev server 实时预览
> 🟢 全景为唯一权威：本 Feature 不存 `preview/*.html` 副本 · 直接改 `preview-project/src/main.jsx` + `styles.css`(权威) · `pages_changed[]` 声明改了哪个 page + 链到权威文件。

## 状态
已确认

## 页面概览

新增路由 `/session/reconnect-continuity`(devbar 标签「Session · Reconnect」)。**复现真实主界面 app-shell**(直接复用既有 `Sidebar` / `TabBar` 组件族 / 终端区 / `FilePanel`,与 `SidebarMachineGroupsPage`/`ConfirmationPreview` 同构),叠加 BL-005 的断线重连增量态。场景:用户在 `mini-pc` 远程机上的 `aon-edge` workspace 跑一个 build(2 个远程会话 tab:`build` 活跃 · `agent` 次要),经历「在线 → 断线 → 重连 → 对账」全链路。

6 态经预览 devbar 顶栏 **state-preset chips** 切换(非页面内嵌控件,遵守 UI-RULES 禁用清单);页面内的横幅重试按钮、tab 关闭按钮均为真实可点交互(非预览专属控件)。

## 状态 × AC 对照

| devbar 态 | 对应 AC | Sidebar(mini-pc 组) | TabBar | 终端区 |
|---|---|---|---|---|
| `live` 在线基线 | AC-1 | 绿点 `connected` | `build` tab `.tab-dot--running` + 闪烁光标 | 无横幅 · 底部一行流式 build 输出 |
| `disconnected` 断线·T秒内 | AC-13 / AC-6 / AC-15 | 黄点脉冲 `reconnecting` + 组头「重连中…」+ `aon-edge` 行打「重连中」标签(**不折叠·不消失**) | dot 维持上次已知态(未对账·AC-5 尚未发生) | 横幅「已断开·正在重连(第 2 次·4s 后重试)」+ **真实**「立即重试」按钮;内容冻结在断开前快照 + 微暗覆盖 + 「远端进程仍在运行」提示行 |
| `reconnecting` 重连握手中 | AC-6 / AC-10 | 同上(黄点脉冲持续) | 同上 | 横幅变「正在重建隧道 → mini-pc…」+ spinner(复用 `add-ws__spinner`) |
| `reconnected-running` 重连成功·仍在跑 | AC-3 / AC-4 / AC-5 | 恢复绿点 `connected` · 会话徽标对账「2 个标签 · 1 running」 | dot 回 `.tab-dot--running` | 横幅消失;快照后接分隔行「— 补回断开期间 128 行 —」(AC-3 增量回放),续接新输出 |
| `reconnected-completed` 断开期已完成(北极星) | AC-12 | 绿点 · 会话徽标对账为「2 个标签」(无 running · 已空闲) | `build` tab **新增 `.tab-dot--exited`**(深绿)+ 标题后「✓ exit 0」标签 | 横幅消失;分隔行后接绿色 `✓ build succeeded in 3m12s` + `process exited (code 0)` |
| `retry-failed` 重连失败 | AC-6 失败分支 | 红点 `lost`(逼近 BL-004 full-drop 边界·组内条目整体变灰 · 仍展示为可重连) | dot 维持上次已知态(未对账) | 横幅转红边「重连失败·已重试 5 次」+ **真实**「重试」「查看远程机」两按钮;内容仍冻结 |

## 交互说明

- **手动重试**(`disconnected`/`retry-failed` 横幅按钮):真实点击 → 本地转 900ms「重试中…」禁用态后复位,与 `AddWorkspacePage`/`AddWorkspaceModal` 既有 `handleRetry`/`handleReconnectNow` 的转瞬交互模式一致。
- **查看远程机**(`retry-failed` 横幅按钮):真实导航到 `/settings/remote-hosts`(复用既有路由,与 `handleEditConfig` 同构)。
- **关闭 tab**(`agent` 次要 tab 的 `×`):真实可点 · 从本地 `tabs` state 移除该 tab(已用 browse 验证:点击后仅剩 `build` tab)。
- devState 切换时局部交互态(`manualRetrying`/`tabs`)重置,与 `AddWorkspacePage` 的 `useEffect(..., [devState])` 复位模式一致。

## 复用的既有组件 / token

- 结构:`Sidebar` / `MachineGroup` / `MachineWorkspaceRow` / `FilePanel` / `PreviewPage`(devbar 机制)—— 零新建 app-shell。
- 视觉:`.add-ws__reconnect-banner`(+ 新增 `--failed` 变体)、`.add-ws__spinner`、`.sidebar-machine-dot--*`、`.sidebar-item--disconnected`、`.sidebar-machine-sessions`、`.tab-dot--running/--idle`、`.terminal-host/-screen/-line/-prefix`。
- 语义色沿用既有策略:running/success = 绿(`--green`)· 重连中/进行中 = 琥珀(`--amber`)· lost/失败 = 红(`--red`)。

## 新增(既有类目里补的缺口)

| 新增项 | 用途 | 位置 |
|---|---|---|
| `MachineGroup` 分支:`machine.status === 'reconnecting'` | 组头黄点脉冲 + 「重连中…」文案(区别于确定断线的 `lost`) | `main.jsx` `MachineGroup` |
| `MachineWorkspaceRow` 新 prop:`ws.reconnectingPanel` | 复用 `.sidebar-item--disconnected` 容器家族,标签文案「重连中」(琥珀)非「已断开」(红) | `main.jsx` `MachineWorkspaceRow` |
| `.sidebar-machine-dot--reconnecting` + `@keyframes sidebar-dot-pulse` | 组头脉冲黄点 | `styles.css` |
| `.sidebar-item-lost-tag--reconnecting` | 「重连中」标签配色(琥珀边框/文字) | `styles.css` |
| `.tab-dot--exited` + `.tab-exit-tag` | tab 徽标新增「已完成」态(深绿点 + 「✓ exit N」标签)—— AC-12 头号价值的可视化 | `styles.css` |
| `.add-ws__reconnect-banner--failed` + `.rc-banner-actions` | 横幅失败态(红边 + 双按钮并列) | `styles.css` |
| `.rc-frozen` / `.rc-frozen-note` | 终端冻结态(微暗 + 常流提示行「远端进程仍在运行」);**故意做成 in-flow 行而非绝对定位覆盖层**,踩坑记录见下 | `styles.css` |
| `.rc-gap-divider` | AC-3 增量回放的可视分隔行(「— 补回断开期间 N 行 —」) | `styles.css` |
| `.rc-cursor` + `@keyframes rc-cursor-blink` | 直播态末行闪烁光标(仅非冻结态渲染) | `styles.css` |
| `@media (prefers-reduced-motion: reduce)` | 关闭 spinner / 脉冲 / 光标闪烁三处动画 | `styles.css` |

`MachineGroup`/`MachineWorkspaceRow` 均为**加法扩展**(新 prop 默认 falsy · 未设置时既有页面零回归)。

## 踩坑记录(自查中发现并修正)

首版把 `.rc-frozen-note`(「远端进程仍在运行」提示)做成 `position: absolute; top/right` 覆盖在 `.add-ws__terminal-wrap` 右上角 —— 与横幅按钮的 `margin-left: auto` 右对齐位置重叠,导致「立即重试」/「重试」/「查看远程机」按钮被提示行遮住(screenshot 复核时才发现,DOM 里按钮仍在但视觉不可见)。改为**横幅与终端内容之间的常流(in-flow)行**,不再绝对定位,彻底消除重叠可能。

## 可访问性

- 横幅 `role="status"`(3 态:disconnected/reconnecting/retry-failed 均有)· `.rc-frozen-note` 同样 `role="status"`,断线可感知靠 DOM 语义而非纯颜色。
- 所有真实交互(立即重试/重试/查看远程机/关闭 tab)均为原生 `<button>`,键盘可达(Tab + Enter/Space),沿用既有组件的焦点行为(未额外覆盖 `outline`)。
- 新增三处 CSS 动画(`sidebar-dot-pulse` / `add-ws__spinner` 转圈 / `rc-cursor-blink`)统一收在 `@media (prefers-reduced-motion: reduce)` 里关闭。
- 冻结态用「微暗 + 文字提示」双重编码(非纯靠 opacity),色盲/低视力用户仍可读「远端进程仍在运行」文案。

## UI-AC-COVERAGE

| AC.id | 描述摘要 | 对应页面 / 区块 | 覆盖状态 |
|-------|---------|---------------------|---------|
| AC-1 | 断开后远端会话不被 kill · 继续运行 | `reconnect-continuity` `.terminal-screen[data-ac="AC-1 AC-3"]`(冻结态旁提示「远端进程仍在运行」示意) | ✅ |
| AC-3 | 重连增量回放 gap · 不重写已有内容 | `reconnected-running`/`reconnected-completed` 态 `.rc-gap-divider` | ✅ |
| AC-4 | 重连按 (hostId,sessionId) 收养既有会话 · 非新 spawn | 页面语义(`build`/`agent` tab 断线前后为同一会话 · 非重建) | ✅(语义层) |
| AC-5 | 重连后按 session.list 状态快照对账徽标 | `reconnected-running`/`reconnected-completed` 态 Sidebar `.sidebar-machine-sessions` 徽标变化 | ✅ |
| AC-6 | 重连横幅 + 自动重连退避 + 手动重试;失败保持横幅 | `disconnected`/`reconnecting`/`retry-failed` 三态 `.add-ws__reconnect-banner` | ✅ |
| AC-10 | 显式 reconnect 路径(非 dispose) | `reconnecting` 态横幅「正在重建隧道 → mini-pc…」 | ✅(语义层) |
| AC-12 | 断线期会话退出留存 · 回放最终输出 + 「已完成」徽标(北极星) | `reconnected-completed` 态 `.tab-exit-tag` `data-ac="AC-12"` + 终端 `terminal-line--success/--exit` | ✅ |
| AC-13 | 断线检测有界时延 T 秒内呈现横幅 | `disconnected` 态横幅 `data-ac="AC-6 AC-13 AC-15"` | ✅ |
| AC-15 | 瞬时断线抑制 full drop · Sidebar 保「重连中」态非消失 | `disconnected`/`reconnecting` 态 Sidebar 包裹容器 `data-ac="AC-15"` + `MachineWorkspaceRow` 「重连中」标签 | ✅ |
| AC-2/AC-8/AC-9/AC-11/AC-14 | 本机零回归 / authz / 资源上限 / 幂等收养 / 多端 last-attach-wins | 无独立可视 UI(纯 host/协议层行为 · 无用户可见界面变化) | ⏭️ 不适用(非 UI 表征的 AC) |

## 变更记录
| 日期 | 变更 | 影响的文件 |
|------|------|----------------|
| 2026-07-10 | 首版:新增 `/session/reconnect-continuity` 路由页(6 态)+ Sidebar/TabBar 增量态扩展 | `docs/design/preview-project/src/main.jsx`(+281 行,新增 §G 段落 + `MachineGroup`/`MachineWorkspaceRow` 加法扩展)、`docs/design/preview-project/src/styles.css`(+109 行) |

---

## Designer 自查报告

### 检查结果汇总
| 维度 | 检查项 | 通过 | 备注 |
|------|------|----|----|
| 1. 全景对齐 | 4 | 4/4 | panorama_path = `docs/design` · 宿主 = TermPro(单项目仓库) |
| 2. 状态覆盖 | 6 态(单页) | 6/6 | 6 个 devbar state-preset chip,均已用 browse 逐一点击验证(无 JS 报错) |
| 3. PRD AC 覆盖 | 10 个 UI 相关 AC | 10/10 | 详 UI-AC-COVERAGE 表(另 5 个非 UI 表征的 AC 标 ⏭️ 不适用) |
| 4. 全景增量同步 | 4 | 4/4 | 类型：🟡 增量(新增 1 路由页 + 2 处既有共享组件加法扩展,零回归) |
| 5. 结构性变更红线 | 3 | 3/3 | 未破坏既有页面结构 / 未改共享组件既有调用点行为 / 未引入新依赖 |
| 6. 框架基线唯一性 | 1 | 1/1 | framework_source = `docs/design/preview-project/src/main.jsx`(same-stack 源) |

### 全景对齐证据
- panorama_path: `docs/design`
- 全景宿主：TermPro(单子项目仓库,无 `apps/*` 拆分)
- 风格对照(读 `project-specs/UI-RULES.md` + 既有 `preview-project` 源摘录):
 1. 「页面内容禁内嵌预览专属控件」—— 本页 6 态全部经 devbar state-preset chips 切换,页面内仅保留真实交互(手动重试/关闭 tab),零场景 toggle 下拉。
 2. 语义色策略(running=绿/idle=灰/lost=红/进行中=琥珀)—— 新增 `reconnecting`/`exited` 态严格复用既有 `--green`/`--amber`/`--red` token,未引入新色值。
 3. BEM 命名延续既有前缀家族(`sidebar-*`/`tab-*`/`add-ws__*`)—— 新类 `rc-*` 仅用于本页专属的终端冻结/分隔行/光标等无既有前缀可挂靠的新概念,其余全部挂靠既有前缀扩展(如 `sidebar-machine-dot--reconnecting`)。
- 导航位置：`sitemap` 无独立文件(single-project 无全景导航树)· devbar `DEVBAR_ROUTES` 追加一项「Session · Reconnect」,与既有 6 个路由并列。
- 全景变更类型：🟡 增量(新增页面 + 加法扩展两个既有共享组件,不改变既有调用点渲染结果)

#### 全景对齐校验(same-stack 自动 skip HTML 检查)
- verdict: ☑ OK(same-stack 介质 · 未跑 `verify-panorama.py`,按规范该介质自动 skip)

### 全景增量 diff
```diff
main.jsx:
+ KNOWN_ROUTES / DEVBAR_ROUTES 追加 '/session/reconnect-continuity'
+ MachineGroup:新增 machine.status === 'reconnecting' 分支(黄点脉冲 + 「重连中…」)
+ MachineWorkspaceRow:新增 ws.reconnectingPanel prop(「重连中」标签)
+ 新增 §G 段落(RECONNECT_STATE_PRESETS / buildRcMachines / buildRcEntries / ReconnectTabBar /
  ReconnectBanner / ReconnectContinuityPage)
+ App():新增 '/session/reconnect-continuity' 路由分支

styles.css:
+ .tab-dot--exited / .tab-exit-tag(AC-12 已完成态)
+ .sidebar-machine-dot--reconnecting + @keyframes sidebar-dot-pulse
+ .sidebar-item-lost-tag--reconnecting
+ .add-ws__reconnect-banner--failed / .rc-banner-actions
+ .add-ws__terminal-wrap 追加 position: relative
+ .rc-frozen / .rc-frozen-note / .rc-gap-divider / .rc-cursor + @keyframes rc-cursor-blink
+ .terminal-line--success / .terminal-line--exit
+ @media (prefers-reduced-motion: reduce) 新块
```

### 自查结论
✅ 自查通过 · 可进入 ⏸️ 用户确认设计稿

## 🧩 补充洞察

- **AC-4/AC-10 等纯协议层 AC 无独立可视 UI**:这类 AC(会话收养/reconnect 路径/authz/资源上限/多端策略)本质是 host↔hostClient 的协议行为,页面只能**间接表征**(如「同一 tab 断线前后身份不变」示意收养非重建)。UI-AC-COVERAGE 表已如实标注,不强行造图凑覆盖率。
- **`reconnected-running` 与 `reconnected-completed` 的会话数徽标对账细节**:两态 `tabCount` 均为 2(build+agent 两个 tab),但 `tabRunning` 从 1(running)→0(completed 态·build 已完成只剩 agent 空闲),`formatTabBadge` 据此自动去掉「· running」后缀 —— 这是 AC-5「对账」在徽标文案上的具体落地,值得 dev 阶段留意别把 `tabRunning` 和「session 是否还存在」混为一谈(exited 会话按 AC-12 仍要在 `session.list` 里,只是 running 计数归零)。
- **retry-failed 态的 Sidebar 红点 lost 与真实 BL-004 full-drop 的边界**:本页 `retry-failed` 只是把 `machine.status` 设为 `'lost'` 复用既有 `.sidebar-machine-group--lost` 视觉(变灰),**没有**触发 `foldedLost`(workspace 列表仍展开可见)—— 这与 D-13/AC-15「仅确定断线才走 full drop」的语义一致:红点 lost 只是「重试预算耗尽的视觉信号」,不等于 Sidebar 条目消失。dev 阶段需注意这个视觉态和真正触发 `dropHostWorkspaces` 的判据是两回事,不要把「红点」误读为「该走 full drop 了」。
