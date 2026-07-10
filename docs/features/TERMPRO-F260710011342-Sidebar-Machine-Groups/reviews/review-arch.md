# BL-004 实现代码 · Architect 隔离评审（review-arch）

- feature: TERMPRO-F260710011342-Sidebar-Machine-Groups
- reviewer: Architect（隔离冷审 · 同模型降级隔离，已知悉 · 默认姿态=质疑）
- date: 2026-07-10
- 评审范围: `git diff origin/yolo/m5-remote-host...HEAD -- src/`（44 文件 · 4483 insertions）
- 基准: TECH.md v0.2 + PRD v0.3（11 AC）+ TECH-REVIEW（blueprint 强制事项）+ goal-arch（ARCH-1~10）
- **verdict: approve_with_changes（无 BLOCKER · 1 MAJOR 建议修 · 4 MINOR/NIT）**

## 结论摘要

作用域隔离机制（blueprint E2/A1 最高风险项）**已正确闭环落地**：`reconcileWorkspaces(+scopeHostId)` 的
filter-in → 作用域三分支 → 原位 merge-back → active hostId 守卫四步逐条到位，本机快照不清远程 ws、远程
快照不清本机、active=远程时本机快照不抢焦点——逐场景推演成立，19 条单测（含 7 条专测作用域隔离）全绿。
`forWorkspace`（读·兜底 local + WARN）/ `forHostId`（写·null 不兜底）写读分流真实生效，create 拿 null 确
实拒绝不落本机。复合键 `findTab(hostId,sessionId)`、per-host session/workspace 订阅同生命周期（drop 前
teardown）、serialize v1+v2 双分支过滤 + active coerce、host params 校验先于 registry mutation——均按
TECH 落地。protocol.ts 零改、import 集门禁零残留、viewer/* 保留本地单例——三条架构红线守住。`tsc --noEmit`
零报错，64 条目标单测全绿。

唯一 MAJOR：**D-7 远程文件禁用面覆盖不全**——三个「文件内容」入口（顶部 Diff / 文件行 / 行内 diff）已确定性
禁用，但**同一远程文件树上的三个「本地 OS 动作」按钮（在浏览器打开 / Finder 中显示 / Finder 中打开）未加
远程守卫**，点击会拿远程路径去调本地 Electron shell，正是 D-7/ARCH-8 明令要杜绝的「静默拿远程路径走本地
窗口」同型行为。可达 + 静默 + 违背 Feature 自定不变量，建议本里程碑内补齐。其余 4 条为 MINOR/NIT（握手编排
双源、两处 active 回落策略分叉、空 wsUrl 隐式耦合、CRUD 缺失 ws 兜底路由）。

## files_read（真实 Read · 引真实行号）

- src/renderer/services/hostRegistry.ts · remoteWorkspaceSync.ts · sessionEvents.ts
- src/renderer/state/store.ts · workspaceSync.ts · persistence.ts
- src/renderer/terminal/terminalRegistry.ts · terminalLinks.ts · TerminalView.tsx
- src/renderer/filepanel/deps.ts · useFilePanel.ts
- src/renderer/components/Sidebar.tsx · FilePanel.tsx · AddWorkspaceModal.tsx
- src/renderer/App.tsx · src/host/workspaceService.ts
- src/renderer/components/__tests__/FilePanelRemoteDisabled.test.tsx · state/__tests__/workspaceSync.test.ts（覆盖核对）
- 门禁/基线核验: import 集 perl 正则脚本 · protocol.ts diff · `tsc --noEmit` · 目标 vitest 5 套件

---

## findings

### A1 · 远程文件树的「本地 OS 动作」按钮未加远程守卫（D-7 禁用面漏三处）
- severity: **MAJOR**
- status: open
- category: technical-consistency / 范围漏洞
- file:line 证据:
  - `src/renderer/components/FilePanel.tsx:650-661`（isHtml → `window.termpro.openInBrowser(node.absPath)`·无 isRemote 守卫）
  - `src/renderer/components/FilePanel.tsx:662-673`（isFile → `window.termpro.showItemInFolder(node.absPath)`·无守卫）
  - `src/renderer/components/FilePanel.tsx:674-685`（isDir → `window.termpro.openPath(node.absPath)`·无守卫）
  - 对照已守卫三入口: FilePanel.tsx:469-475（顶部 Diff）·561-563/613-618（文件行）·628-636（行内 diff）
  - 测试盲区: `__tests__/FilePanelRemoteDisabled.test.tsx:87-100` mock 了这三个 handler，但整个「远程禁用」
    describe（118-186）**只断言 Diff/文件行/行内 diff 三入口**，从未断言这三个 OS 动作按钮在远程下的行为。
- description: 远程 workspace 的文件树（`fs.readdir` over forWorkspace·**在范围**·树浏览 + git 着色照常渲染）
  逐行渲染这三个动作按钮。它们调用的是**本地** Electron shell（`openInBrowser`/`showItemInFolder`/`openPath`），
  参数却是**远程机的路径字符串**。远程激活时点击：`showItemInFolder('/home/pi/repo/README.md')` / `openPath('/home/pi/repo/src')`
  在本地 Mac 上揭示/打开一个不存在的本地路径 → 静默 no-op；`openInBrowser` 对远程 .html → 本地浏览器开本地文件路径
  → 打不开或（本地恰好存在同路径文件时）**开错文件**。这与 D-7 收窄措辞、ARCH-8 建议③「明确定义远程文件点击行为，
  杜绝静默拉起本地窗口读远程路径」**同型**——只是 blueprint 的 TECH §远程文件禁用 UX（TECH.md:326）当时只枚举了
  FilePanel.tsx:418/547/561 三入口，漏了 Finder/browser 三按钮，实现照该清单落地即继承了这个盲区。
- blast radius: 有限（多为静默 no-op 或开错本地内容·非远程读·非数据外泄），但**可达 + 静默 + 违背 Feature 自定
  不变量**，属 D-7 本该覆盖的同类。
- 建议: 三按钮加同一 `isRemote` 守卫——要么 `aria-disabled`+复用 `showRemoteFileHint()`（与其余三入口一致的
  确定性反馈），要么远程下直接不渲染这三个本地 OS 动作。补一条 `FilePanelRemoteDisabled.test.tsx` 断言远程下点
  这三个按钮不调用对应 `window.termpro.*`。若判定「远程 OS 动作」整体推迟到 BL-005/6，则在 TECH §远程文件禁用 UX
  补记这三按钮属禁用面（当前清单失实）。

### A2 · 连接握手编排双源（Sidebar 镜像 RemoteHostsPage）· E6「断开在途」竞态过滤未复制
- severity: MINOR
- status: open
- category: architecture / 竞态
- file:line 证据:
  - `src/renderer/components/Sidebar.tsx:204-237`（`beginHandshake`：connect(wsUrl)→冒烟→`applyRuntimeEvent({stage:'ready'})`）
  - `src/renderer/components/settings/RemoteHostsPage.tsx:180-229`（同一套 beginHandshake · 另一份实现）
  - Sidebar.tsx:198-201 自注: 「本效果不复制 RemoteHostsPage 的 E6『断开在途』过滤……建议把握手编排整体收敛进
    remoteWorkspaceSync.ts 单源」
- description: 两个组件各自订阅 `remoteHost.onEvent`、各自在 `verifying{tunnel}` 跑一份握手编排、各自持独立
  `handshakingRef`。常态无正确性 bug——`getOrCreateRemote` 返回同实例、`connect()` 靠 connectPromise 去重、
  `applyEvent(ready)` 幂等；至多 2× 冒烟 `fs.readdir`（无害）。**残留竞态**：用户在 RemoteHostsPage 手动「断开」
  且 Sidebar 握手仍在途时，Sidebar 的 `.then` 仍会 `applyRuntimeEvent({stage:'ready'})` **覆盖用户刚触发的
  disconnected**，进而触发 `startRemoteWorkspaceSync` 对一个正被拆除的 client 发 `workspace.list`。触发面窄
  （须同时开 RemoteHostsPage 且手动断开），且 disconnected 事件会再次到达最终收敛。d4-ui 已自报。
- 架构裁决: **v1 可接受**（触发窄 + 最终一致），但属真实架构债——同一协议握手两处实现会随时间发散。
- 建议: 复用面扩大前，把握手编排（connect→冒烟→ready + E6 断开在途过滤）收敛进单一模块（remoteWorkspaceSync 或
  新 connectOrchestrator），Sidebar/RemoteHostsPage 只委派。不阻断本里程碑。

### A3 · active 回落策略两处分叉：reconcile 三级 vs dropHostWorkspaces 两级（意图正确但无交叉注释）
- severity: NIT
- status: open
- category: consistency / 可维护性
- file:line 证据:
  - `src/renderer/state/workspaceSync.ts:112-117`（reconcile：`local ?? workspaces[0] ?? null` 三级·可落到另一远程机）
  - `src/renderer/state/store.ts:519-521`（dropHostWorkspaces：`local ?? null` 两级·**不**抢到另一远程机）
- description: 两条路径的 active 回落策略**故意不同且各自正确**——单个远程 ws 被删（该机仍连着）时落「本机首个 ??
  数组首个 ?? null」（还连着，跳到任意剩余 ws 合理）；整机断线时落「本机首个 ?? null」（AC-11 明确不抢到另一远程
  机·避免断线把用户甩到别的机器）。与 goal-arch NIT-N3 + brief AC-11 口径一致，已验证正确。问题仅在：两处策略靠
  workspaceSync.ts:19-21 的注释单向解释，store.ts 侧无反向交叉引用——未来维护者可能「顺手统一」两处而回归 AC-11。
- 建议: dropHostWorkspaces 的两级回落处加一行注释，点明「刻意不同于 reconcile 三级·AC-11 断线不抢另一远程机」。

### A4 · `startRemoteWorkspaceSync(configId, '')` 空 wsUrl · 隐式依赖 client 已存在且已连
- severity: NIT
- status: open
- category: robustness / 隐式耦合
- file:line 证据:
  - `src/renderer/components/Sidebar.tsx:247`（`void startRemoteWorkspaceSync(configId, '')` 传空串）
  - `src/renderer/services/remoteWorkspaceSync.ts:50`（`getOrCreateRemote(configId, wsUrl='')`）+ hostRegistry.ts:25（`void wsUrl` 忽略）
- description: sync 只在 runtime 落 `ready` 后触发，此刻 client 已由 beginHandshake 建好并连上，`getOrCreateRemote`
  忽略 wsUrl 返回既有实例——**当前安全**。但签名收 wsUrl 却传空串、真正连接靠调用序保证，是隐式耦合：若未来有人在
  connect 前调 sync，会创建一个未连 client，`workspace.list` 直接失败（走 E-1 WARN 分支，非崩溃，但语义误导）。
- 建议: 二选一——要么 sync 内断言/文档化「必须 ready 后调」，要么去掉 wsUrl 形参改由内部从既有 client 取（sync 本
  就不负责建连）。低优先。

### A5 · v2 remove/rename 对「已不在 store 的 ws」兜底 `{hostId:'local'}` · 远程删改可能误路由本机
- severity: NIT
- status: open
- category: edge-case
- file:line 证据:
  - `src/renderer/state/store.ts:435`（`hostRegistry.forWorkspace(ws ?? { hostId: LOCAL_HOST_ID }).rpc('workspace.remove', …)`）
  - `src/renderer/state/store.ts:466-468`（rename 同型兜底）
- description: 正常 UI 路径 ws 必在 store 才可删改；但竞态下（该 ws 已被 dropHostWorkspaces 移除、pending 回调仍在途）
  `ws` 为 undefined → 兜底 `{hostId:'local'}` → 把一个远程 id 的 `workspace.remove` 发到**本机** host（本机注册表无此
  id → throw → catch → transientNotice）。无数据损坏，但把远程操作误发本机语义不干净（与 forHostId 写不兜底的原则轻微
  抵触·此处是 forWorkspace 读式路由承担了写）。
- 建议: `ws` 缺失时直接 return（该 ws 已消失·无需 RPC），而非兜底 local。低优先。

---

## 逐条回应 brief 评审重点

1. **作用域隔离（最高风险·E2 BLOCKER）**: ✅ 闭环。`reconcileWorkspaces`（workspaceSync.ts:47-119）filter-in
   （54）→ 三分支（60-82）→ 原位 merge-back（86-103）→ active 守卫（109-117）齐全。本机快照到达
   （applyWorkspaceSnapshot scopeHostId='local'·store.ts:484-496）时远程 ws 走 outScope 原位透传不删；active=远程
   时 `activeWasInScope=false` → 不抢回本机（工作区快照不动焦点）；远程 `setHostWorkspaces`（498-509）scopeHostId=configId
   只协调该子集。N3 三级回落 vs AC-11 两级断线回落区分**正确且各自恰当**（见 A3·仅缺交叉注释）。19 单测含
   `reconcileWorkspaces 作用域隔离` 7 条专测全绿。
2. **forWorkspace/forHostId 写读分流**: ✅ forWorkspace（hostRegistry.ts:46-57）未命中兜底 local + 非 local 恒 WARN；
   forHostId（64-66）未命中 null 绝不兜底；create（store.ts:375-380）拿 null **真拒绝**（transientNotice「目标机器
   已断开」·不落本机）。AddWorkspaceModal.loadDir（AddWorkspaceModal.tsx:107-114）同款 null → 错误态不兜底。
3. **53 消费点迁移完整性**: ✅ import 集门禁脚本实跑**零残留**（importer ⊆ 豁免）；`tsc --noEmit` 零报错（背靠门禁）；
   App.tsx git.info 折行漏网点已迁（App.tsx:76-79 `forWorkspace(w).rpc('git.info')` per-workspace）；deps call-time
   `resolveClient()`（deps.ts）+ platform 改 getter（deps.ts:16-18）到位；useFilePanel resolveClient 闭包读 active ws
   （useFilePanel.ts:34-37）。本机路径（hostId='local' → 既有单例）零回归——FilePanelRemoteDisabled 本机 describe +
   forWorkspace 解析 localClient 断言（test:217-222）守住 AC-6。
4. **复合键 (hostId,sessionId)**: ✅ findTab（terminalRegistry.ts:221-226）双条件匹配；ensureSession 绑 inst.hostId/
   inst.client（148-159）；per-host 订阅在 remoteWorkspaceSync ready 编排（remoteWorkspaceSync.ts:62-68）与
   workspace.list/onWorkspaceChanged 同生命周期，drop 前 teardownListeners 退订全部（24-30, 79）——无泄漏，重入
   先清后建（49）。findTabBySessionId 无残留（仅测试注释历史提及）。
5. **架构红线**: ✅ protocol.ts diff 为空（零改）；远程文件用 `aria-disabled` 非原生 disabled（FilePanel.tsx:470,
   562,628·注释 472-474 明述原因）——**但仅三入口**（见 A1 漏三个 OS 动作按钮）；viewer/* 未迁（门禁豁免·保留
   本地）；serialize v1（persistence.ts:124-138）+ v2（141-151）双分支 `filter(hostId==='local')` + activeWorkspaceId
   coerce（117-121）。
6. **d4-ui 自报握手镜像**: 见 A2——架构上 **v1 可接受**（触发窄·最终一致），但需在复用面扩大前收敛单源；E6 竞态未
   复制的残留风险已如实记录，不阻断。

## 门禁/基线核验

- `tsc --noEmit`: 零报错 ✅
- import 集门禁（perl -0777 多行·大小写敏感·花括号作用域正则）: 非豁免文件零残留 importer ✅
- protocol.ts: `git diff` 空（零改）✅
- 目标 vitest（workspaceSync / store 协调 / remoteWorkspaceSync / workspaceService params / workspaceRegistry）:
  64 passed ✅（含作用域隔离 7 + params 校验 17）

## 建议动作（不阻断合并·按优先级）

1. **A1（MAJOR·建议本里程碑修）**: FilePanel 三个 OS 动作按钮加 isRemote 守卫 + 补远程禁用断言；或收窄 TECH 禁用面
   清单并注明推迟。
2. A2（MINOR）: 复用面扩大前收敛握手编排单源（携 E6 过滤）。
3. A3/A4/A5（NIT）: 交叉注释 active 回落分叉 / 去空 wsUrl 隐式耦合 / CRUD 缺失 ws 直接 return。

verdict: **approve_with_changes** —— 地基（作用域隔离 / 写读分流 / 复合键 / 持久化过滤 / 红线）稳固且验证充分，无
BLOCKER；1 MAJOR 为已交付守卫的覆盖漏洞（几行可补）、非架构返工，其余 MINOR/NIT 皆可择机。修 A1 后即达合并质量。
