---
pages:
  - {id: sidebar-machine-groups, title: "Sidebar Machine Groups"}
panorama_medium: same-stack
panorama_path: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260805033051-Remote-Connection-Controls/docs/design
pages_changed:
  - page_id: sidebar-machine-groups
    route_path: /sidebar/machine-groups
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260805033051-Remote-Connection-Controls/docs/design/preview-project/src/main.jsx
    change_range: "组头右侧连接控件区:文字按钮(连接/重连/重试/连接中…)→ 纯图标钮;新增断开钮与取消钮;定义六个连接状态各自的控件;确立 + 恒最右的位置不变式"
    acceptance_criteria_refs: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-10, AC-11, AC-15]
---

# 远程机组头连接控件重构 - UI 设计意图 & 追溯

> 🔴 全景宿主:当前子项目(OKWORK · 单子项目 N=1)
> 🔴 panorama_path:`<worktree>/docs/design` · 全景权威根
> 🔴 panorama_medium:**same-stack**(`docs/design/preview-project` 同栈 React+Vite 工程 · 源即全景权威 · `bash preview.sh` 起 dev server 实时预览 · 不出静态 build)
> 🟢 **全景为唯一权威**:本 Feature **不存** `preview/*.html` 副本 · 直接编辑 `preview-project/src/main.jsx` 的 `MachineGroup` 组件(权威)。

## 状态

已确认(用户 2026-08-05 实机预览后确认)

## 为什么改的是全景而不是新画一页

`/sidebar/machine-groups` 路由**早已存在**(sitemap 登记,Owner = `OKWORK-F260710011342-Sidebar-Machine-Groups`),本 Feature 是**给已存在的真实页加东西**,按 ui-design-stage「复现门」必须在既有全景页上增量改,禁画孤立概念页。

而且方向是反的但闭合的:真实代码 `src/renderer/components/MachineGroup.tsx` 的头部注释写明「移植自设计预览 `docs/design/preview-project/src/main.jsx` L199-279(MachineGroup)」—— 全景是这个组件的设计源头,本次仍在源头上改。

## 设计决策(本文只记意图与取舍 · 视觉真相在全景源)

### 1. 图标语义:链条 / 断链 配对

选 feather 的 `link-2`(相连的链环)表示**连接**、断裂链条表示**断开**。理由:

- 与用户原话直接对应 —— 需求原文说的就是「**链接**断开的按钮」;
- 这一对是**互为反义的同一图形**,用户看一眼就知道两个钮是同一件事的两个方向,不需要文字;
- 备选的「电源图标」被否掉:`power` 在机器语境下会被读成「关掉那台远程机」,而实际只是断开本地隧道,语义危险。

取消用 `×`(通用、无歧义),立即重试用循环箭头 `rotate-cw`(与「复位退避重新连」的语义一致)。

### 2. 视觉权重:向 `+` 看齐的「安静图标钮」,而非描边胶囊

现有连接类按钮是 `.sidebar-machine-connect` 描边胶囊(带 accent 边框),而 `+` 是常态 `opacity: .35`、组头 hover 才浮现的安静图标钮。本次统一到**后者**:

- 用户要的就是「不需要文字」,描边胶囊在窄侧栏里视觉噪音过大;
- 组头右侧从此是一组同质的图标钮(连接类 + `+`),不再是「一个胶囊 + 一个图标」的拼接感。

**代价与补偿**:安静化会降低可发现性。补偿手段是 **hover 语义色** —— 连接钮 hover 转 `--accent`(暖橙,正向)、断开与取消 hover 转 `--red`(警示)、重试 hover 转 `--amber`。这样不加一个字,用户在悬停的瞬间就知道这个动作的性质。

### 3. 位置不变式:`+` 恒最右,控件向左生长

用户说「在 `+` 左边」,但 `+` 只在已连接时才渲染(`workspaces !== null`)—— 其余状态根本没有这个锚点。解法不是给每个状态都预留等宽槽位(那会在单图标状态留下空洞),而是:

**`+` 恒为组头 DOM 最后一个元素、贴最右;连接类控件紧挨其左侧;宽度变化一律发生在更左边的状态文案区。** 这样 `+` 在任何状态下都不移动,组头也不会横向抖动(AC-15)。

🔎 **实机走查后对 AC-15 的措辞收紧**(2026-08-05,浏览器逐态验证):`+` 只在已连接时渲染,所以未连接态下连接图标钮会**占据最右那格**;连接之后 `+` 出现、控件左移一格。曾考虑「任何状态都预留 `+` 空槽」来做到控件绝对不动,**否掉了** —— 那会在未连接态留一个可见的空洞,看起来像少了个按钮,比位移更糟。
因此 AC-15 的判据应理解为:**① `+` 出现时恒贴最右、自身不移动;② 控件之间不重叠、不错位;③ 同一状态内不抖动。** 而**不是**「控件绝对坐标恒定」。这条已同步给 test 阶段,避免按字面写出一条永远过不了的断言。

### 4. 状态 → 控件映射(六态)

| 状态 | `+` 左侧控件 | 备注 |
|---|---|---|
| 未连接(从未连接) | 连接图标钮 | 无 `+`(未连接不显示添加项目) |
| 连接中(connecting/deploying/starting/claiming/verifying) | spinner + 阶段文案 + **取消图标钮** | 取消是本 Feature 给侧栏补的入口,设置页早已有 |
| 已连接 | RTT 毫秒数 + **断开图标钮** + `+` | 断开钮为本 Feature 新增 |
| 断线过渡(0–900ms · 行仍保活) | 连接图标钮 + `+` | 补齐此前未定义的态(AC-15) |
| 自动重连中 | 琥珀脉冲 + 「重连中…」+ 立即重试图标钮 + **断开图标钮** | 断开钮在此态可用 = 终止自动重连(D-4) |
| 已断开折叠 | 连接图标钮 | 原「重连」文字钮 |
| **本机组** | **无任何连接类控件** | 本机无连接概念(AC-11 后半) |

### 5. 可访问性

- 每个图标钮 `title` + `aria-label` 双写(沿用 `+` 钮的既有惯例)。
- **新增 `:focus-visible`**:`outline: 1px solid var(--accent)` + `outline-offset: 1px`。
  ⚠️ 现状交代:全项目仅 1 条 `:focus-visible` 规则(在 `SettingsModal.css`),`Sidebar.css` 里一条都没有,即侧栏当前整体不满足 `UI-RULES.md` 的「键盘可达 + focus-visible 必有」。本 Feature **只补本次新增/改造的这几个钮**,整个侧栏补齐属既有欠债、单独立项(PRD §Out of Scope 已记)。
- 🔴 dev 实现约束(来自 KNOWLEDGE GO-030):若 AC-13 采用禁用态,必须用 `aria-disabled` **而非原生 `disabled`** —— 原生 disabled 按钮不派发 click,提示弹不出来,正好是 AC-13 要防的静默失败。

### 6. 预览态的可达性(遵 UI-RULES 禁令)

🔴 页面内容**不内嵌任何状态切换器**。默认态**真的可点**:点连接图标走该页已有的 mock 连接时序(连接中 → 已连接),点断开回未连接。页面自然到不了的态(断线过渡、自动重连中)通过该页**已有的 dev 顶栏 preset 机制**注入,沿用既有模式、不另造。

### 7. ⚠️ 已知保真度偏差:全景色板 token 落后真实 app 一个主题改动

实机走查时发现的既有 drift(**不是本 Feature 引入,也不在本 Feature 范围**):

| token | 全景 `preview-project/src/styles.css` | 真实 app `src/renderer/index.css` |
|---|---|---|
| `--accent` | `#4a8df8`(蓝) | `#d08770`(暖橙 · commit `6b351b5` 降饱和改的) |
| `--bg` | `#1e2227` | `#1b1b1b` |
| `--bg-panel` | `#23272e` | `#141414` |
| `--fg` | `#d7dae0` | `#e8e6e3` |
| `--border` | `#181b1f` | `#262626` |

`--green` / `--amber` / `--red` 两边一致。

**对本 Feature 的影响**:连接钮的 hover 语义色与 focus ring 走 `var(--accent)`,所以**预览里显示为蓝色,真实 app 里会是暖橙**。断开/取消的红、重试的琥珀、RTT 三色分级两边一致,不受影响。设计决策本身是「hover 用强调色」这个**语义映射**,不是具体色值,所以该决策可以照常确认。

**为什么不顺手同步**:全景的 `:root` 是 7 条预览路由共用的,改它会一次性改掉所有历史设计页的外观 —— 影响面远超本 Feature 的 change_range。建议单独立项做一次「全景色板对齐真实 app」的同步(与「侧栏 focus-visible 补齐」是同类的既有欠债)。

## UI-AC-COVERAGE(PRD AC 覆盖声明)

| AC.id | 描述摘要 | 对应页面 / 区块 | 覆盖状态 |
|-------|---------|---------------------|---------|
| AC-1 | 已连接组头 `+` 左显示断开图标钮 | `/sidebar/machine-groups` 已连接态组头 | ✅ 预览可见 |
| AC-2 | 点断开即回未连接态 · 不经 900ms 过渡 | 同上(默认态可真实点) | ⚠️ 视觉部分 ✅;「不经过渡态」属运行时行为,需 RD 实现 + 测试保证 |
| AC-3 | Connect / Reconnect 改纯图标 | 未连接态 / 已断开折叠态组头 | ✅ 预览可见 |
| AC-4 | 连接中显示取消图标钮 | 连接中态组头 | ✅ 预览可见 |
| AC-5 | 点取消立即回未连接态 | 连接中态(默认可点) | ⚠️ 视觉 ✅;「不等主进程事件」属运行时行为,需 RD 实现 |
| AC-6 | 取消后残余写入不得复活 / 不得弹 toast | — | ❌ 纯运行时逻辑,UI 层无对应物(归 blueprint/dev) |
| AC-7 | 失败弹全局 toast + 组头回落待连接 | 连接失败 preset | ⚠️ toast 视觉可预览;两条 failed 通道的收口归 dev |
| AC-8 | 断开重连后终端内容仍在 | — | ❌ 纯运行时(归 dev) |
| AC-9 | 手动断开后不自动重连 | — | ❌ 纯运行时(归 dev) |
| AC-10 | 重连中「立即重试」图标化 + 断开钮可用 | 自动重连中态组头 | ✅ 预览可见 |
| AC-11 | 图标钮可 Tab 聚焦 + focus-visible;本机组无连接控件 | 全部组头 + 本机组头 | ✅ 预览可 Tab 验证 |
| AC-12 | 断开时激活项目回落本机 | — | ❌ 纯运行时(归 dev) |
| AC-13 | 取消后 5 秒内重连不得静默无响应 | — | ⚠️ 若采用禁用态则 UI 有对应物(`aria-disabled` 见 §5);落法待 blueprint 定 |
| AC-14 | 弃用标记随连接意图解除 | — | ❌ 纯运行时(归 dev) |
| AC-15 | 控件槽位无空洞 + `+` 不移动 + 无横向跳变 | 六态组头纵向对齐 | ✅ 预览可肉眼验证 |

> 覆盖口径:15 条 AC 中 6 条有 UI 对应物并已在全景体现;4 条部分体现(视觉可预览、行为归 dev);5 条是纯运行时逻辑,UI 层无对应物 —— 这不是遗漏,是本 Feature「一半在交互形态、一半在异步正确性」的固有分布。

## 变更记录

| 日期 | 变更 | 影响文件 |
|------|------|----------------|
| 2026-08-05 | 首版:组头连接控件图标化 + 新增断开/取消 + 六态定义 + 位置不变式 | `docs/design/preview-project/src/main.jsx`(`MachineGroup`)、`src/styles.css`、`docs/design/sitemap.md`(Sync Log) |
| 2026-08-05 | 复现门补齐:折叠三角 / 机器图标 / RTT / 组头 `+`(全景此前停在 BL-004 形态,不补则 AC-15 无法演示) | 同上 |
| 2026-08-05 | AC-7 落地:失败不再常驻组头,改全局 toast + 组头回落待连接;新增 `PreviewTransientToast` | 同上 |
| 2026-08-05 | 修正:`.transient-toast` 视觉逐值对齐真实 `TransientToast.css` —— 首版是照措辞 approximate 的,**位置写反了**(真实为 `top:16px` 顶部居中,非底部),另有 z-index / max-width / border-radius / font-size / box-shadow / pointer-events / border 兜底色共 7 处偏差 | `docs/design/preview-project/src/styles.css` |
| 2026-08-05 | ✅ 用户确认预览(六态实机走查通过) | — |

---

## Designer 自查报告

| 维度 | 检查项 | 通过 | 备注 |
|------|------|----|----|
| 1. 全景对齐 | 4 | 4/4 | panorama_path = `<worktree>/docs/design` · 宿主 = OKWORK 单子项目 · 改的是既有路由 `/sidebar/machine-groups`,非新画页 |
| 2. 状态覆盖 | 6 态 | 6/6 | 未连接 / 连接中 / 已连接 / 断线过渡 / 自动重连中 / 已断开折叠 —— 默认态真实可点,难触达态走该页既有 dev 顶栏 preset(页面内零内嵌 switcher) |
| 3. PRD AC 覆盖 | 15 | 6 全覆盖 + 4 部分 + 5 无 UI 对应物 | 详 UI-AC-COVERAGE 表 · 归属已逐条说明 |
| 4. 全景增量同步 | — | ⏭️/🟡 | 🟡 **增量**:在既有页的组头控件区做局部替换与新增,未推倒重画;sitemap 仅追加 Sync Log 一行,**不新增 route**(路由早已存在) |
| 5. 结构性变更红线 | 3 | 3/3 | 未新增/删除路由 · 未改 IA 层级 · 未改跨页导航模型 → **非结构性变更**,不触发 panorama_sync 的 L2 跨团队确认 |
| 6. 框架基线唯一性 | 1 | 1/1 | framework_source = `docs/design/preview-project`(同栈全景工程本体),非历史 Feature 的 preview 副本 |

### 全景对齐证据

- panorama_path:`/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260805033051-Remote-Connection-Controls/docs/design`
- 改动的权威文件:`preview-project/src/main.jsx` 的 `MachineGroup`(原实现在 L219 起,文字按钮在 L233/256/260/267)+ `preview-project/src/styles.css`
- 路由既存证据:`docs/design/sitemap.md` Routes 表已登记 `/sidebar/machine-groups`(Owner `OKWORK-F260710011342-Sidebar-Machine-Groups`),本 Feature 为其增量
- 真实代码与全景的血缘:`src/renderer/components/MachineGroup.tsx:1-3` 注释「移植自设计预览 `docs/design/preview-project/src/main.jsx` L199-279」
