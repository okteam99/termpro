# BL-004 Blueprint 评审 — Architect

- **对象**: `docs/features/TERMPRO-F260710011342-Sidebar-Machine-Groups/{TECH.md,TC.md}`
- **基准**: PRD v0.3（11 AC · D-1~D-9）+ PRD-REVIEW blueprint 强制事项 + 真实代码逐文件 grounded
- **评审人**: Architect（隔离评审 · 默认质疑姿态）
- **日期**: 2026-07-10

## Verdict: **NEEDS_REVISION**

一句话：blueprint 质量很高、grounding 扎实（53 消费点 A/B/C 分类经我逐行核对**精确正确**，App.tsx:76 折行漏网点被正确捕获，protocol 零改成立，AC-6 物理基础成立，复合键必要性成立）。但有 **1 个 MAJOR**：`reconcileWorkspaces` 在 per-host 作用域下**复用不动**会触发跨作用域 `activeWorkspaceId` 复位 + 远程 ws 被 `set({workspaces})` 整体替换丢弃两个具体隐患，而 TECH 只声明「按作用域调用」未钉合并回写与 active 守卫机制，且 TC 无对称非干扰断言。修掉 A1（+ 采纳几条 MINOR）即可 APPROVE。

## files_read（逐个真实文件，非仅 TECH 转述）

- `docs/features/.../TECH.md` · `docs/features/.../TC.md`
- `src/renderer/state/store.ts`（WorkspaceState L50-58 / buildDefaultWorkspace L213 / hydrate L270-334 / addWorkspace L336 / removeWorkspace L366 / renameWorkspace L404 / applyWorkspaceSnapshot L432-443）
- `src/renderer/state/persistence.ts`（serialize L106-142 / hydrate L32-104 / onWorkspaceChanged L93）
- `src/renderer/state/workspaceSync.ts`（reconcileWorkspaces L25-66）
- `src/renderer/services/hostRegistry.ts`（全文 · L12 seed / local L15 / getOrCreateRemote L24 / drop L35）
- `src/renderer/App.tsx`（connect L49 / onDown L50 / git.info 刷新循环 L72-89 · 折行 L76-77）
- `src/renderer/terminal/terminalRegistry.ts`（getOrCreateTerminal L50 / FsLinkProvider 构造 L107-112 / ensureSession L128 / findTabBySessionId L190）
- `src/renderer/services/sessionEvents.ts`（onSessionEvent 单订阅 L44 / homedir L59 / 模块级 waitingNotified·lastExit 键=tabId）
- `src/renderer/filepanel/deps.ts`（makeHostDeps 全文 · platform L10 值读取）+ `useFilePanel.ts`（controller 懒建 L28-46 · setInputs 不重建 L57-59）
- `src/renderer/components/FilePanel.tsx`（openViewerWindow 入口 L420/547/561 · hostClient 消费 L211/294）
- `src/shared/protocol.ts`（workspace.list/create/remove/update · SessionEvent per-client）
- `src/host/ptyPool.ts`（sessionId 生成 L39 `s${++seq}-${Date.now()}`）
- grep 全扫：`hostClient\.`=53 / `\bhostClient\b`=83 / 全 `.rpc(`+attachPty+onSessionEvent 消费点完备性核对

## 核心前提复核结论（逐项通过 ✅ / 关注 ⚠️）

| 前提 | 结论 | 证据 |
|------|------|------|
| 53 消费点 A/B/C 分类正确性 | ✅ **精确** | `hostClient\.`=53 = 31 A-code + 5 B + 16 C-viewer + 1 comment(migration L18)；A25(App.tsx:76 折行) 为第 32 个 A、正确认定为 `hostClient\.` 漏网 |
| 非豁免文件迁移面是否遗漏 | ✅ **无遗漏** | 完备性 grep：非豁免文件里唯一折行消费 = App.tsx:77 git.info（=A25，已捕获）；controller.ts:50 走注入 deps（=A13-A22）；其余折行消费全在 viewer/*（豁免） |
| protocol.ts 零改 | ✅ 成立 | workspace RPC 传输无关；SessionEvent per-client 订阅，hostId 由「订阅哪个 client」的闭包携带，签名无需加 hostId |
| AC-6 本机零回归物理基础 | ✅ 成立 | hostRegistry.ts:12 seed `[[LOCAL_KEY, hostClient]]`；forWorkspace('local')===hostClient 单例；B 类 local() 等价 |
| 复合键 (hostId,sessionId) 必要性 | ✅ 成立 | ptyPool.ts:39 sessionId=`s${++seq}-...`，seq 为**每 host 本地计数器**，`s1/s2` 每台机复现，路由正确性不应依赖 Date.now() 熵 |
| 远程 ws 不持久化回避孤儿 | ✅ 成立（v2）· ⚠️ v1 分支未覆盖 | serialize v2 过滤后 remote 不入盘；hydrate v2 以本机 registry 为准。但 serialize **v1 分支**(persistence.ts:118)未过滤 → 见 A2 |
| applyWorkspaceSnapshot 按 host 作用域自洽 | ⚠️ **不自洽（A1）** | reconcileWorkspaces 复用不动会跨作用域复位 active + 丢远程 ws |

---

## Findings

### A1 · MAJOR · open · reconcileWorkspaces 在 per-host 作用域下复用不动会误复位 active + 丢弃远程 ws（合并回写与 active 守卫未钉死）

**证据**：
- `src/renderer/state/store.ts:436-442` `applyWorkspaceSnapshot` 现将**全部** `s.workspaces` 传入 `reconcileWorkspaces`，并 `set({ workspaces, activeWorkspaceId })` **整体替换**数组。
- `src/renderer/state/workspaceSync.ts:60-63`：`if (activeWorkspaceId !== null && !snapById.has(activeWorkspaceId)) nextActive = workspaces[0]?.id ?? null;` —— active 若不在**本次快照**里就复位到该作用域首个。
- TECH L184 / L239 只声明「传入 `local.filter(hostId===X)` 子集 + 合成补 hostId」「不触碰他机/本机 ws」，**未**说明：(a) 子集 reconcile 后如何与作用域外 ws 合并回 store（保序）；(b) L60-63 的 active 复位在跨作用域下必然误触发。

**为什么是 bug（两条都真会触发）**：
1. **远程 ws 被整体替换丢弃**：本机 `workspace:changed` 广播（B5 后仍来自 local host）→ reconcile 只吐本机子集数组 → 若 dev 照 store 现状 `set({ workspaces })`，远程 ws **从 store 数组消失**（Sidebar 该机组清空、终端成孤儿）。必须显式 `[...reconciledLocal, ...untouchedRemote]` 保序合并，TECH 未写。
2. **active 跨作用域复位**：active=远程 ws 时，本机广播的 snapById 不含该远程 id → L61 判真 → `nextActive=本机 workspaces[0]`。即**每次本机注册表变更都会把焦点从远程 ws 抢回本机**。对称地，远程 host 广播（setHostWorkspaces 子集=远程）会把 active=本机 ws 抢到远程首个。

**TC 缺口**：TC 有 `setHostWorkspaces/dropHostWorkspaces 作用域`（§测试策略）但**无**「本机广播 leave 远程 ws + 远程-active 不变」「远程广播 leave 本机-active 不变」的对称非干扰断言 —— 恰是 R-3(high) 的落点无覆盖。

**建议**：blueprint 明确三件事（择一实现，推荐重构 reconcileWorkspaces 为作用域安全）：
- reconcileWorkspaces 加 `hostScope` 语义：只协调 `w.hostId===scope` 与 `snapshot`，**作用域外 ws 原样透传**返回；active 复位分支仅当「被删的 active 属于本作用域」才触发（`activeWorkspaceId` 属他作用域时保持不变）。
- 或 store 侧包装：filter-in → reconcile → merge-back（保序）+ active 守卫。
- TC 补两条对称非干扰用例（P0），与 AC-11 回落区分开。
- 附带：TECH「复用同一算法（不变）」措辞失实 —— reconcileWorkspaces 因 WorkspaceState 加**必填** hostId，合成分支(workspaceSync.ts:50-56)本就要改（TS 会强制），是签名+逻辑变更，非零改复用，blueprint 应如实标注。

### A2 · MINOR · open · serialize 过滤只覆盖 v2 分支；v1 fallback + activeWorkspaceId 未处理

**证据**：`src/renderer/state/persistence.ts:114-128` serialize **v1 分支** `s.workspaces.map(...)` 无 hostId 过滤；L133 `activeWorkspaceId: s.activeWorkspaceId` 两分支都未 coerce。
**风险**：(a) 迁移失败 fallback（persistMode='v1'）时若连了远程机，远程 ws（视图态注入不受 persistMode 门控，与 applyWorkspaceSnapshot 的 `!=='v2' return` 不同路径）会被 v1 serialize 落盘，重启经 v1 hydrate 复活成 hostId='local' 的孤儿指向远程路径。(b) 保存瞬间 active=远程 ws 时，v2 archive 的 activeWorkspaceId 存了远程 id（重启经 resolveActiveWs 兜底自愈，低危但不一致）。
**建议**：serialize **两分支**都 `filter(w => w.hostId === 'local')`；activeWorkspaceId 在被过滤时 coerce 到本机首个或 null。TECH §数据结构 D-6 强制项应显式含这两点。

### A3 · MINOR · open · TC grep 门禁 pattern 与 TECH 自相矛盾（TC 用 `\bhostClient\.`，TECH 钉 `\bhostClient\b`）

**证据**：TECH L201-206 门禁用 `\bhostClient\b`（并在 §补充洞察 明令「别自行简化回 `hostClient\.`」）；但 **TC.md:311** `BL004-U-grepgate` 场景写「匹配 `/\bhostClient\./` 与 `import { hostClient }`」。
**分析**：TC 靠 `import { hostClient }` 从句兜底（任何残留消费必先 import，故功能上仍能拦），但 dot-pattern 本身正是 TECH 警告的折行陷阱型；两文档对同一门禁给了不同 pattern，dev 可能实现 TC 版并丢掉 import 从句，重新引入陷阱。
**建议**：TC `BL004-U-grepgate` 统一为 `\bhostClient\b` + 目录豁免（与 TECH L201 单源），或至少显式保留 `import { hostClient }` 从句为**主**判据并注明 dot-pattern 仅辅助。

### A4 · MINOR · open · FilePanel deps `platform` 是构造期值读取，call-time 解析未覆盖它

**证据**：`src/renderer/filepanel/deps.ts:10` `platform: hostClient.info?.platform ?? null` 是**属性值**（构造 makeHostDeps 时一次性求值），非方法。A13-A22 把它列入「每方法 `resolveClient().rpc(...)` call-time 解析」，但 platform 不是方法调用。
**风险**：controller 懒建一次不重建（useFilePanel.ts:28-46 已证），若 platform 固化为构造时的 local 值，切到远程机（Linux vs 本机 mac）后**路径风格/大小写判定按本机**，远程文件树路径渲染出错。
**建议**：A13-A22 明确 platform 需从「值」改为 getter/accessor（`get platform(){ return resolveClient().info?.platform }`）或方法，FilePanelDeps 类型同步；TECH 迁移清单标注这是**唯一非方法**消费点、需特殊处理。

### A5 · MINOR · open · forWorkspace `?? this.local()` 对已知但已 drop 的非 local hostId 会静默误路由（AC-5 正防此）

**证据**：TECH L92 `return this.clients.get(ws.hostId) ?? this.local();`。对 `hostId=configId` 但 client 已被 drop 的竞态，兜底 local → 远程 RPC 打本机 host。
**分析**：我核了 drop 原子性——dropHostWorkspaces 在单个 zustand action 内同步「移除 ws + hostRegistry.drop」，JS 单线程无 action 内交错，故「ws 在 store 但 client 已 drop」窗口近不可达；展示型只读兜底仅致 tildify 轻微错（cosmetic）。风险实低，D-A/R-2 分析成立。
**建议**：接受「local 兜底 + 断线门控」，但把 E-6 的「WARN 若观测到」升为**无条件**：forWorkspace 兜底 local 且 `ws.hostId !== 'local'` 时**必发 WARN**（feature id + hostId），使竞态可观测不静默——契合「无静默吞异常」红线。不必改 32 调用点签名。

### A6 · MINOR · open · FsLinkProvider 的 client 绑定不能靠「构造注入」（构造早于 host 绑定）

**证据**：`src/renderer/terminal/terminalRegistry.ts:107-112` FsLinkProvider 在 `getOrCreateTerminal(tabId)` 内构造，此时 host 未知（TerminalView 挂载即建实例，ensureSession 才绑 host/client）。TECH A10-A12 写「FsLinkProvider 持 client（**构造注入**=该终端 host）」与时序冲突。
**建议**：沿用现有闭包模式——homedir 取值改 `() => (inst.client ?? hostClient).info?.homedir`（与 L111 `() => inst.spawnCwd || ...` 同型），client 存入 TermInstance（blueprint 已加 `inst.client` 字段），call-time 解析，勿构造注入。TECH A10-A12 措辞相应改「闭包解析 inst.client」。

### A7 · NIT · open · C 类行号枚举非真穷举（漏 3 处 viewer 折行消费），但目录豁免使其无害

**证据**：TECH C1-C16 由 `hostClient\.` grep 派生，只列 FileView L85/197、DiffPanel L86；实际 viewer 里还有折行消费 FileView.tsx:250-251(fs.writeFile)、DiffPanel.tsx:197-198(git.show)、202-203(fs.readFile) 未进枚举（正是 blueprint 自己发现的折行陷阱，此处复发 3 次却未修正枚举）。
**影响**：**无害** —— 门禁按**目录** `components/viewer/` 豁免（非按行号），三处仍被正确豁免。反证「`\bhostClient\b` + 目录豁免」优于任何按行台账，是 TECH 的正确设计选择。
**建议**：TECH 把「53 穷举」措辞降为「53 = `hostClient\.` grep 视图（含 1 注释；折行消费在 viewer 内另有 3 处、经目录豁免）」，避免「穷举」误导后续 dev 以为逐行完备。

### A8 · POSITIVE · 明确肯定项（防止 revision 误伤已正确部分）

- **A/B/C 分类精确**：31 A-code + 5 B + 16 C-viewer + 1 注释 = 53，与我逐行核对一致；A25 折行漏网点认定正确。
- **复合键 D-9 正确且非过度设计**：sessionId per-host seq（ptyPool.ts:39）证实碰撞前提；(hostId,sessionId) 是最小正确路由键；徽标用本地 tab 数避免新 RPC，是**有原则的欠工程**（主机侧枚举划 BL-005），非过度设计。
- **AC-6 零回归可执行**：forWorkspace('local')===hostClient 单例，BL004-U-local-baseline 差分基线可落地（先捕 golden 再迁）。
- **sessionEvents per-host 等价**：模块级 waitingNotified/lastExit 键=tabId（全局唯一 UUID），复合键路由不影响其正确性，AC-6 通知/角标序列等价成立。
- **红线守住**：protocol.ts 零改成立；viewer 远程访问出范围（不重开 BL-003 E8）守住；FilePanel 三入口(420/547/561)=openViewerWindow（window.termpro，非 hostClient），与迁移面正确切分。
- **FilePanel deps call-time 解析可行**（除 A4 platform 外）：controller 懒建不重建（useFilePanel.ts:57-59 仅 setInputs），makeHostDeps(resolveClient) 每方法 call-time 取当前 ws host 成立。

---

## 收敛建议

**放行条件**：修 A1（reconcileWorkspaces 作用域安全 + merge-back + active 守卫 + TC 对称非干扰两条 P0）。A2/A3/A4/A5/A6 建议同并入本轮 blueprint 修订（都是钉一句话/一个约束，成本低、都在「无静默 / 数据一致」红线上）。A7 措辞降级、A8 保持不动。改完即 APPROVE，无需重开架构。
