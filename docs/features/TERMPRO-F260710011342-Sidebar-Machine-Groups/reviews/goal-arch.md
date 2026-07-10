# BL-004 PRD · Architect 冷审（goal-arch）

- feature: TERMPRO-F260710011342-Sidebar-Machine-Groups
- reviewer: Architect（隔离冷审 · 同模型降级隔离，已知悉）
- date: 2026-07-10
- verdict: **changes_requested**（方向成立 · 地基自洽度高，但 AC-4/AC-5/AC-7 的若干断言与真实代码不成立，须在 blueprint 前收口 3 处 high）

## 结论摘要

方向、范围、Out-of-Scope 切分（BL-005 会话存活/重连不夹带）总体干净，「渐进迁移保本机零回归」是正确取向。protocol 层：远程目录浏览器复用既有 `fs.readdir`、落注册表复用 `workspace.create`，**无需新增 RPC**（正面）。

但 PRD 有三处 high 级技术一致性问题会直接影响 AC 可实现性，均为 blueprint 可解、但必须显式收口：
1. **per-host 身份双源**——`hostRegistry` 用 configId 键，`host.info.hostId` 是另一个 id，PRD 把两者当同一「per-host 键」（ARCH-1）。
2. **workspace 缺 hostId 维度**——`WorkspaceEntry`/`WorkspaceState`/v2 存档都无 hostId，AC-5「按 workspace.hostId 选 client」前提不存在（ARCH-2）。
3. **独立查看器窗口够不到远程 host**——隧道 token 按 E8 只发主窗口，AC-4/AC-5 的「查看器可见/看文件」对远程不成立（ARCH-3）。

## files_read

- docs/features/TERMPRO-F260710011342-Sidebar-Machine-Groups/PRD.md
- docs/features/TERMPRO-F260710011342-Sidebar-Machine-Groups/YOLO-PREFLIGHT.md
- project-specs/ARCHITECTURE.md
- src/shared/protocol.ts
- src/shared/remoteHost.ts
- src/renderer/services/hostClient.ts
- src/renderer/services/hostRegistry.ts
- src/renderer/state/store.ts
- src/renderer/state/persistence.ts
- src/renderer/state/remoteHostStore.ts
- src/renderer/components/Sidebar.tsx
- src/renderer/components/settings/RemoteHostsPage.tsx
- src/renderer/components/viewer/ViewerWindow.tsx
- src/renderer/App.tsx
- src/renderer/services/sessionEvents.ts
- src/main/remote/remoteHostIpc.ts
- src/host/hostCore.ts（host.info 构造）+ src/host/host.ts（--host-tag 解析）

## findings

### ARCH-1 · per-host 身份双源：configId 键 vs host.info.hostId（PRD 把两者混同）
- severity: high
- category: technical-consistency
- description: `hostRegistry.getOrCreateRemote(configId, wsUrl)` 已经用 **configId** 作 per-host 键，且远程 client 由 RemoteHostsPage 持配置 id 建立与选取。renderer 拿到目标 client **靠的是 configId，不需要 host.info.hostId**。而 D-2/AC-7 把 `host.info.hostId` 真实化后当作「per-host 键」，这是**第二个身份**。两者对远程恰好都=configId（因远程 host 以 `--host-tag=configId` 启动，可回显），但**对本机会发散**：hostRegistry 本机键是常量 `'local'`，而「本机稳定标识真实化」若取 hostname 则 ≠ `'local'`。谁是 workspace→client 路由的权威 id，PRD 未定。
- code_evidence:
  - src/renderer/services/hostRegistry.ts:9（`LOCAL_KEY = 'local'`）+ :24（`getOrCreateRemote(configId ...)` 键=configId）
  - src/renderer/components/settings/RemoteHostsPage.tsx:185（`hostRegistry.getOrCreateRemote(configId, wsUrl)` 客户端由 configId 取用，从不读 host.info.hostId）
  - src/host/hostCore.ts:157（`hostId: 'local'` 硬编码；同一 host 二进制跑在远程也返回 'local'，故不真实化时远程与本机撞 id）
  - src/shared/remoteHost.ts:66（注释明示 `id = per-host 键（≠ host.info.hostId 恒 'local'）`——即现设计的键就是 configId）
- suggestion: blueprint 明确「workspace→client 路由的权威 per-host 键 = hostRegistry map 键（本机 `'local'` / 远程 configId）」，`host.info.hostId` 降为诊断信息或直接移出 BL-004 范围。若确要真实化，本机也必须以同一常量 `'local'` 回显（而非 hostname），保证 host.info.hostId 与 hostRegistry 键恒等，杜绝发散。

### ARCH-2 · workspace 无 hostId 维度：AC-5「按 workspace.hostId 选 client」前提不存在
- severity: high
- category: technical-consistency
- description: AC-5 要求「经 hostRegistry 按 workspace.hostId 选择」client，但 workspace 全链路目前**没有 hostId 字段**：协议 DTO、renderer 运行态、v2 存档三处皆无。PRD 隐藏前提①「Sidebar 分组时带上 hostId 即可」只说了分组展示，未点破两件必须做的事：(a) `WorkspaceState` 要新增运行时 hostId 并贯穿 40+ 消费点做路由；(b) v2 存档按 `workspaceId` **全局**键，hydrate 只 `workspace.list on local`，远程 workspace 的视图态会被当孤儿外键**每次重启静默丢弃**。
- code_evidence:
  - src/shared/protocol.ts:73-80（`WorkspaceEntry = {id,name,root}`，无 hostId）
  - src/renderer/state/store.ts:50-58（`WorkspaceState`，无 hostId）
  - src/renderer/state/persistence.ts:46-47（hydrate 只 `workspace.list on local`）
  - src/renderer/state/store.ts:310（`if (!entry) continue; // 孤儿外键 → 静默丢弃`——远程 workspace 视图态命中此路径）
- suggestion: blueprint 显式给 `WorkspaceState` 加运行时 `hostId`（路由单源），并裁定远程 workspace 视图态持久化策略——建议 v1 只让远程 workspace 在连接期存活于内存（不进 v2 存档 / 或存档按 hostId 作用域隔离），把「远程会话/视图态跨重启存活」明确划归 BL-005，避免 hydrate 孤儿丢弃变成隐性回归。

### ARCH-3 · 独立查看器窗口够不到远程 host（隧道 token 仅发主窗口）
- severity: high
- category: technical-consistency
- description: 文件/Diff 查看器是**独立 BrowserWindow**，各自 `import { hostClient }` 用本地单例、`hostClient.connect()` 走本机 MessagePort；其 `hostRegistry` 是该窗口 renderer 进程的**独立模块单例**，没有任何远程 client。而远程隧道 `{localPort, token}` 依 E8 安全修复**只推给主窗口**。因此对远程 workspace 打开文件/Diff 窗口时，查看器无路径连到远程 host。AC-4「任一客户端（主窗口 + 查看器）可见」与 AC-5「看文件面板」对远程**不成立**。
- code_evidence:
  - src/renderer/components/viewer/ViewerWindow.tsx:4-6,40（查看器 import 本地 `hostClient` 并 `hostClient.connect()`）
  - src/main/remote/remoteHostIpc.ts:27-38 + 33-38（`remoteHost:event` 仅 `getMainWindow()` 主窗口收 tunnel token —— E8 修复注释明示「只推给主窗口」）
  - src/renderer/services/hostRegistry.ts:11-12（模块级单例，每个 renderer 窗口各一份，查看器那份无远程键）
- suggestion: blueprint 二选一并写入 AC：(A) v1 把「远程 workspace 的独立查看器窗口」划出范围（远程只支持主窗口内文件面板 + 终端）；或 (B) 设计跨窗口远程访问（main 代理远程 fs/git，或按窗口作用域下发 scoped token——后者会重开 E8，需安全复审）。当前 AC-4/AC-5 措辞须据此收窄。

### ARCH-4 · AC-4 多客户端可见性对远程不成立（远程 host 只有主窗口一个 client）
- severity: medium
- category: technical-consistency
- description: `workspace:changed` 全量广播由**各 host 向其自身连着的客户端**发。远程 host 的隧道上只有主窗口一个 client（见 ARCH-3），查看器只连本机 host。故远程 `workspace.create` 的广播只到主窗口。BL-001 的「多客户端一致」保证是**每 host 作用域内**的；对远程实际只有单客户端。AC-4「任一客户端（主窗口 + 查看器）可见」按字面对远程为假。
- code_evidence:
  - src/renderer/services/hostClient.ts:341-343（`workspace:changed` 由该 client 的 transport 收，故只广播给连着此 host 的客户端）
  - src/renderer/state/persistence.ts:93-95（`onWorkspaceChanged` 订阅的是发起 hydrate 的那个 client）
- suggestion: AC-4 把「任一客户端可见」限定为「连接该机 host 的客户端」；或接受远程 workspace 广播为单客户端语义，并在 PRD 注明。与 ARCH-3 一并处理。

### ARCH-5 · 未列入清单的「隐形消费点」：App.tsx 分支刷新 + sessionEvents 均绑本地单例，会静默误路由远程 workspace
- severity: medium
- category: technical-consistency
- description: PRD 把「40+ 消费点迁移」标为最大改面并以 AC-6（本机零回归）守门，但漏点出两个会**主动误路由**的具体消费点：一旦远程 workspace 进入同一 `store.workspaces` 数组，(a) App.tsx 分支刷新循环对**所有** workspace 在**本地单例**上 `git.info({cwd: w.root})`——对远程路径查本机 host，结果错误/报错；(b) sessionEvents 只订阅本地单例的 `onSessionEvent`，远程 workspace 的活跃会话徽标（AC-2）永远收不到。AC-5 只覆盖「终端/fs/git 不误走本机」，未覆盖分支标签与会话徽标这两条链路。
- code_evidence:
  - src/renderer/App.tsx:71-89（`for (const w of ...workspaces) hostClient.rpc('git.info', {cwd: w.root})`——本地单例遍历全体）
  - src/renderer/services/sessionEvents.ts:11,32+（`import { hostClient }` 本地单例；`initSessionEvents()` 只订阅它）
- suggestion: blueprint 的迁移清单显式纳入 App.tsx `git.info` 分支循环、sessionEvents、terminalRegistry、filepanel/deps，逐一按 workspace.hostId 路由；补一条「远程路由正确性」AC（不仅「不误走本机」，还要「分支标签/会话徽标经该机 client」）。

### ARCH-6 · D-2 措辞失真：HostInfo.hostId 早已是必填字段，非「protocol.ts 向后兼容追加」
- severity: low
- category: simplicity
- description: `HostInfo.hostId: string` 本就是必填、恒有值（当前恒 `'local'`）。D-2/决策表称「protocol.ts 零破坏追加」「旧 host 缺省回退 'local'」——但 DTO 层没有「缺省缺字段」这一情形，「真实化」改的只是 host 实现返回的**值** + renderer 语义，protocol.ts 无需改。措辞会误导 blueprint 去追一个不存在的 schema 迁移。
- code_evidence:
  - src/shared/protocol.ts:29-37（`HostInfo.hostId: string` 必填）
  - src/host/hostCore.ts:157（值恒 `'local'`；「真实化」= 改值，不改契约）
- suggestion: 修正 D-2/AC-7 表述为「改 host 实现返回值 + renderer 语义，protocol 不变」；与 ARCH-1 合并裁决（大概率结论是 host.info.hostId 无需真实化，直接从范围移除）。

### ARCH-7 · 范围核验：AC-2 会话徽标 + AC-5 远程终端把 per-host pty + session-event 接线拉进 BL-004（确认非 BL-005）
- severity: low
- category: scope
- description: Out-of-Scope 把「会话存活/scrollback/重连」划归 BL-005，切分正确（运行 ≠ 断线存活）。但 AC-5 要远程终端真跑（`pty.spawn` over 远程 client）、AC-2 要活跃会话徽标（`session:event` over 远程 client），意味着 BL-004 必须新接 per-host 的 pty 流分发 + 会话事件订阅——这是「不止分组」的一块实打实工作量。非矛盾，仅需 blueprint 正确估量、别当纯 UI 分组。
- suggestion: blueprint 阶段拆分把「per-host 终端/会话事件接线」列为独立阶段，别与 Sidebar 视图混在一个 commit；沿用 CLAUDE.md 每阶段 tsc+vitest+冒烟三绿节奏。

## 对 PRD 问题清单的直接回答

- **技术一致性**：D-1 渐进迁移与代码现状自洽（本机 'local' 单例复用可行）；D-2 与代码现状**部分不自洽**（host.info.hostId 非真正的 per-host 键，ARCH-1/6）；AC-5 远程全链路的前提（workspace 带 hostId）**当前不成立**，需新增状态维度（ARCH-2）。protocol 向后兼容：加法确实成立（fs.readdir/workspace.create 复用，无破坏），但 host.info.hostId 那条不是「追加」。
- **简洁性/范围**：未夹带 BL-005 会话存活语义（切分干净）；AC-6 本机零回归守住了架构红线的**本机侧**，但对远程侧的多窗口/多客户端红线暴露了 ARCH-3/4 缺口。40+ 消费点迁移「可控」的前提是把 App.tsx/sessionEvents 等隐形点纳入清单（ARCH-5）。
- **隐藏前提核验**：「本机稳定 hostId」——可用常量 'local'，成立但据 ARCH-1 建议不要 hostname 化；「workspace 带 hostId 分组」——展示层成立，但**路由层与持久化层的 hostId 维度尚不存在**，是本 PRD 最实的隐藏前提缺口（ARCH-2）。
- **PRD 与实现现实矛盾处**：集中在 ARCH-3（查看器窗口够不到远程 host，与 AC-4/AC-5 字面矛盾）与 ARCH-1（两个 id 被当成一个键）。

## blueprint 前建议动作（不阻断方向，收口即可）

1. 裁决 per-host 权威键（ARCH-1）+ 据此移除或明确 host.info.hostId 真实化范围（ARCH-6）。
2. `WorkspaceState` 加运行时 hostId + 裁定远程 workspace 持久化边界（ARCH-2）。
3. AC-4/AC-5 就「远程 + 独立查看器窗口」二选一收窄措辞（ARCH-3/4）。
4. 迁移清单补齐 App.tsx 分支循环 / sessionEvents / terminalRegistry / filepanel（ARCH-5），并补一条远程路由正确性 AC。

---

## Round 2 · PRD v0.2 复核（2026-07-10）

- reviewer: Architect（同上）
- 复核对象: PRD v0.2（同路径）+ 收口动作落地核对 + v0.2 与代码现实自洽性
- verdict: **changes_requested（minor）** —— 4 个收口动作**实质落地且自洽**（ARCH-1/6/2/3/4/5 全消解），但 v0.2 在把 D-7「远程查看器出范围」传导进 AC-5/交付预期时**未传导干净**，暴露 1 high + 1 medium + 1 low 残留，均为 AC 文字/范围精度问题（非架构返工），PRD 文字收敛即可进 blueprint。

### 收口动作落地核对（Round 1 → v0.2）

| Round1 finding | v0.2 处置 | 是否消解 |
|---|---|---|
| ARCH-1 per-host 双源 | D-2 撤销 host.info.hostId 真实化·权威键=hostRegistry map 键·AC-7 重写「host.info.hostId 不参与路由」 | ✅ 消解（与 hostRegistry.ts 现实一致） |
| ARCH-6 D-2 措辞失真 | Out-of-Scope 明列「host.info.hostId 真实化 —— 撤销」·不再声称 protocol 追加 | ✅ 消解 |
| ARCH-2 workspace 无 hostId | D-6 WorkspaceState 加运行时 hostId·远程 workspace 不持久化（实时 workspace.list 发现）·远程持久化划归 BL-005 | ✅ 消解（孤儿外键丢弃路径被规避；见下 impl 注记） |
| ARCH-3 查看器够不到远程 | D-7 远程查看器 v1 出范围·AC-4/5 收窄主窗口·Out-of-Scope 明列 | ✅ 方向消解，但传导不干净 → 见 ARCH-8 |
| ARCH-4 多客户端可见性 | AC-4「主窗口经 workspace:changed（该 host 作用域）即时可见」 | ✅ 消解 |
| ARCH-5 隐形消费点 | AC-5 穷举 App.tsx/sessionEvents/terminalLinks/… + grep 门禁·D-9 会话徽标 per-host 聚合 | ✅ 消解（但见 ARCH-9/10） |
| ARCH-7 pty+session 接线量 | 「最不确定」注记 blueprint 估独立阶段 | ✅ 采纳 |

impl 注记（非缺陷）：D-6「远程不持久化」要成立，`serialize()`（persistence.ts:131-141 现把**全部** workspaces 写 v2 存档）须**过滤 hostId!=='local'**；hydrate 的孤儿丢弃（store.ts:310）是安全网而非依赖项。blueprint 记一笔即可。

### 残留 findings

#### ARCH-8 · D-7 未传导干净：文件/Diff **内容**查看恒走独立窗口（本地限定），与 AC-5「文件面板/git」+ 交付预期「看文件」矛盾
- severity: high（AC 文字/范围精度 · 非架构返工）
- category: technical-consistency
- description: 主窗口 FilePanel **不内联渲染文件内容**——点文件/点 Diff 一律 `window.termpro.openViewerWindow(...)` 拉起**独立 BrowserWindow**（FileView/MarkdownPreview/DiffPanel 只活在这些窗口里），而独立窗口按 D-7 出范围（只连本地 hostClient）。于是对远程 workspace：文件**树浏览**（fs.readdir/watch + git status 着色，走主窗口 filepanel/deps）在范围✅；但**看文件内容 / 看 Diff** 会拉起本地限定窗口，对远程路径读**本机 fs** → ENOENT 或读错文件。这直接冲突：(a) AC-5 把 `FileView/MarkdownPreview/DiffPanel（git.show/changedFiles）` 列为「迁移到 hostRegistry.forWorkspace」的消费点——但它们只在 D-7 已出范围的窗口里跑，该迁移项**不可满足亦自相矛盾**；(b) 交付预期表「主窗口内远程 workspace 的…文件面板…全链路走该机 host」「看文件」对远程**不成立**（内容查看已被 D-7 推迟）。且当前代码对远程 workspace 的文件点击会**静默拉起本地窗口读远程路径**（隐性坏行为），PRD 未定该场景行为。
- code_evidence:
  - src/renderer/components/FilePanel.tsx:547（点文件 → `openViewerWindow({mode:'file', path})`）
  - src/renderer/components/FilePanel.tsx:420,561（Diff 按钮/行级 diff → `openViewerWindow({mode:'diff',...})`）
  - src/renderer/components/viewer/ViewerWindow.tsx:40（查看器窗口只 `hostClient.connect()` 本地单例）
  - PRD v0.2 AC-5（消费点列 FileView/MarkdownPreview/DiffPanel）vs D-7/Out-of-Scope（查看器窗口出范围）
- suggestion: 三选一并落 AC 文字：① 把远程 workspace v1 的「文件」范围**收窄为文件树浏览 + git status 着色**（fs.readdir/watch/git.status，主窗口面板内），文件/Diff **内容**查看随查看器窗口一并推迟到 BL-006/后续；② 从 AC-5 消费点清单**移除** FileView/MarkdownPreview/DiffPanel（标注为「随查看器窗口出范围·保持本地单例」）；③ 明确定义**远程 workspace 文件点击/Diff 点击的行为**（禁用点击 or 提示「远程文件查看 v1 暂不支持」），杜绝静默拉起本地窗口读远程路径。交付预期表「看文件」改为「浏览文件树」。

#### ARCH-9 · sessionId 仅 per-host 唯一，跨 host 全局 findTabBySessionId 会碰撞（AC-5 远程终端 + D-9 会话聚合的隐性前提）
- severity: medium
- category: technical-consistency
- description: sessionId 由各 host 的 PtyPool **本地 seq 计数器**生成（`s${++seq}-${ms}`），仅 host 内唯一；本机与远程各跑独立 PtyPool，理论可产同名 id（同 ms + 同 seq）。而 renderer 的 `findTabBySessionId` 是**全局**遍历（会话事件路由 + D-9 徽标聚合都经它），跨 host 同名 sessionId 会把远程 session:event 路由到本机 tab（或反之）。D-9「按 host 分聚」隐含要按 host 作用域，但未点破**pty/session 路由键须为 (hostId, sessionId) 复合键**；attachPty/ptyListeners 亦按裸 sessionId。
- code_evidence:
  - src/host/ptyPool.ts:39（`const id = \`s${++this.seq}-${Date.now().toString(36)}\``·per-host seq）
  - src/renderer/terminal/terminalRegistry.ts:190（`findTabBySessionId` 全局遍历裸 sessionId）
  - src/renderer/services/hostClient.ts:82,270-282（ptyListeners 按裸 sessionId·每 client 独立 map——client 内无碰撞，但 renderer 全局反查有）
- suggestion: blueprint 明确 pty/session 路由键 = (hostId, sessionId) 复合；`findTabBySessionId`、sessionEvents 聚合、terminalRegistry 均按 host 作用域，勿依赖 sessionId 全局唯一。可在 D-9 补一句前提。

#### ARCH-10 · AC-5 grep 门禁「无残留裸 hostClient.」与 D-7 保留查看器本地单例冲突（须显式 allowlist）
- severity: low
- category: simplicity/consistency
- description: AC-5 门禁「无残留裸 `hostClient.` 直接消费（除 hostRegistry 内部 'local' 单例）」的豁免只点了 hostRegistry.ts。但 D-7 让查看器窗口（ViewerWindow/FilesWindow/DiffWindow/FileView/DiffPanel/MarkdownPreview/DirListing）**有意保留**本地 hostClient 单例，且 FilePanel.tsx:211 亦有裸 `hostClient.info`。门禁按现措辞会误报这些出范围代码，逼迫迁移 D-7 已推迟的窗口。
- code_evidence:
  - src/renderer/components/FilePanel.tsx:211（`hostClient.info?.homedir` 裸用）
  - src/renderer/components/viewer/*（多处裸 hostClient·D-7 有意保留本地）
- suggestion: grep 门禁豁免清单显式含「查看器窗口入口（viewer/*）+ hostRegistry.ts」；或门禁只扫「主窗口在范围消费点」白名单集合，避免与 D-7 冲突。

### Round 2 结论

方向与地基已稳，4 收口动作全部落地。剩 ARCH-8（high·AC 文字/范围）+ ARCH-9（medium·复合键前提）+ ARCH-10（low·门禁豁免）三条，均为 **D-7 查看器边界未完全传导进 AC-5/交付预期** 的连带精度问题，PRD 文字层收敛（收窄远程「文件」= 树浏览、移除查看器专属消费点、定文件点击行为、补复合键前提、门禁 allowlist）即可进 blueprint，无需架构返工。
