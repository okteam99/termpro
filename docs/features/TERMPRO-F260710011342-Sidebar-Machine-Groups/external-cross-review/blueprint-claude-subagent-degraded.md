---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "worktree 无 localconfig · 异质降级为同模型隔离冷审"
review_via: subagent
verdict: NEEDS_REVISION
---

# BL-004 Blueprint 独立冷审（第三视角 · 隔离采样）

评审姿态：默认质疑。所有断言均对真实代码独立 grep/Read 复核（未参与起草、未读其他角色评审草稿）。
读过的文件：`external-review-prompts/blueprint-claude-subagent-20260710T024839Z.md`（inline TECH+TC+checklist）、
`src/renderer/services/hostRegistry.ts`、`src/renderer/services/sessionEvents.ts`、
`src/renderer/state/store.ts`、`src/renderer/state/persistence.ts`、`src/renderer/state/workspaceSync.ts`、
`src/renderer/terminal/terminalRegistry.ts`、`src/renderer/state/workspaceMigration.ts`、`src/renderer/App.tsx`，
以及全仓 `grep` 复核。

## 独立复核结论（先说 blueprint 做对的地方）

- **AC-5 迁移清单穷举正确**：`grep -rn 'hostClient\.' src/renderer`（除 __tests__）= 53，逐文件计数与 A/B/C 分类**逐条吻合**（deps.ts 10 = A13-A22 / terminalRegistry.ts 9 = A1-A9 / viewer/* 16 = C1-C16 / store.ts 3 = A26-A28(347,392,416) / persistence.ts 3 = B3-B5(37,46,93) / App.tsx 2 = B1-B2(49,50) …）。53 = 52 真实消费 + 1 注释（`workspaceMigration.ts:18`），核实无误。
- **App.tsx:76 折行消费真实存在**：`hostClient` 独占 L76、`.rpc('git.info',…)` 在 L77，`hostClient\.` 确实漏网；blueprint 用 `\bhostClient\b` 捕获它是对的诊断。
- **AC-6/AC-7 物理基础成立**：`hostRegistry.ts:12` 构造即 `Map([['local', hostClient]])`，`forWorkspace({hostId:'local'})` === 既有单例，零回归基础可靠。
- **复合键需求真实**：`terminalRegistry.ts:190 findTabBySessionId` 全局按 `sessionId===` 匹配、`sessionEvents.ts:44` 仅订阅本地单例，本机+远程同名 sessionId 串 tab 的隐患属实。
- **AC↔TC 映射完整**：AC-1~AC-11 全部被 `covers_ac` 引用，无悬空 AC。

但下面的问题足以判 **NEEDS_REVISION**：`\bhostClient\b` 门禁的切换引入了 blueprint 自己没枚举的注释假阳；而两条数据模型的"作用域"修复被点到目标却**没给出可落地机制**，dev 若照字面实现会静默丢远程 workspace。

---

## Findings

### E1 · grep 门禁 `\bhostClient\b` 会被注释假阳性打红，逼 dev 退回 `hostClient\.` 反而漏 App:76
- severity: **high**
- status: open
- title: 门禁 pattern 从 `hostClient\.` 切到 `\bhostClient\b` 后，4 处非豁免文件的**注释**触发假阳，豁免清单未覆盖
- location: TECH「grep 覆盖门禁」脚本（L652-658）+ TC `BL004-U-grepgate` 豁免清单（TC L338-342）；实测命中 `src/renderer/state/remoteHostStore.ts:7`、`src/renderer/filepanel/core.ts:1`、`src/renderer/filepanel/types.ts:5`、`src/renderer/filepanel/deps.ts:1`
- rationale: 门禁脚本仅 `grep -v` 掉 `hostClient.ts / hostRegistry.ts / viewer/ / workspaceMigration.ts / __tests__`。但 `\bhostClient\b` 会匹配上述 4 个文件里**纯注释**的 "hostClient" 词（`remoteHostStore.ts`、`core.ts`、`types.ts` 甚至不在迁移面内，无代码可迁）。正确迁移后门禁仍非空 → 假 RED。blueprint §补充洞察明确警告"别退回 `hostClient\.`"，可 dev 面对红门禁最顺手的动作恰恰是退回 `hostClient\.`（消除注释假阳），从而重新漏掉 A25（App.tsx:76 折行）——这正是 blueprint 想防的真缺口。blueprint 只枚举了 1 处注释假阳（migration:18），漏了另外 3~4 处。
- 建议: 门禁脚本剥离注释行（如追加 `| grep -vE '^\s*//|^\s*\*|\*/'` 或按 AST/tsc 而非纯文本），或把 `remoteHostStore.ts / filepanel/core.ts / filepanel/types.ts / filepanel/deps.ts` 的注释加入豁免常量并在 TC `BL004-U-grepgate` 的 allowlist 同步。TC 的"命中文件集 ⊆ 豁免清单"断言必须与脚本 pattern 一致，否则测绿脚本红/脚本绿测红。

### E2 · applyWorkspaceSnapshot「按 host 作用域」修复不完整：本机快照广播会静默删掉全部远程 workspace + 抢走远程 active
- severity: **blocker**
- status: open
- title: 仅"过滤输入到 local 子集"不足以保留远程 ws；reconcile 输出替换整个数组 + active 回落会误删/误切远程
- location: 现实 `src/renderer/state/store.ts:436-442 applyWorkspaceSnapshot` + `src/renderer/state/workspaceSync.ts:36-45,61-62`；blueprint B4/B5 note（TECH L633-635）+ R-3（TECH L827）
- rationale: 现 `applyWorkspaceSnapshot` 调 `reconcileWorkspaces(s.workspaces, active, snapshot)` 后 `set({ workspaces, activeWorkspaceId })` **整体替换** workspace 数组。`reconcileWorkspaces` 对"local 有、snapshot 无"的条目直接回收 tab 并**从输出数组剔除**（workspaceSync.ts:41-45），且"active 不在 snapshot"就 `nextActive = workspaces[0]`（L61-62）。blueprint 的修复只说"传入 `local.filter(hostId==='local')` 子集"——但这样 reconcile 的**输出也只含 local 子集**，`set({workspaces})` 依旧把远程 ws 从 store 抹掉；且若 active 是远程 ws，用本机 snapshot 走 reconcile 会把 active 切回本机首个。触发条件是**任一本机 workspace 增删改**（都会广播 `workspace:changed` 给本客户端）——即多机使用下"本机加一个项目"就清空所有远程机分组。blueprint 只写了目标"不误删远程 ws"，没写实现机制（过滤后如何**回并**远程子集、如何**守卫** active 不被本机快照重置）。28 条 TC 里**没有**一条覆盖"本机快照到达 → 远程 ws + 远程 active 保留"，是 R-3 的直接测漏。属"照字面实现即产红、测却全绿"。
- 建议: applyWorkspaceSnapshot 明确三步：① reconcile 只吃 `hostId==='local'` 子集；② 输出与 `s.workspaces.filter(hostId!=='local')` **按原位次回并**；③ 当 `activeWorkspaceId` 属远程 host 时**跳过** reconcile 的 active 回落（active 归属判断加 hostId 守卫）。补 TC：`applyWorkspaceSnapshot(本机快照) 后 store 仍含全部远程 ws 且远程 active 不变`（P0）。

### E3 · v1 fallback 分支完全无视 hostId：远程 ws 会漏进 v1 存档并在重启时被本机 workspace.create 重建
- severity: **high**
- status: open
- title: serialize v1 分支 + addWorkspace/removeWorkspace/renameWorkspace 的 v1 分支不做 hostId 过滤/路由，D-6「远程不持久化」只在 v2 半边成立
- location: `src/renderer/state/persistence.ts:117-127`（serialize v1 分支，无 hostId 过滤）+ `src/renderer/state/store.ts:338-341,384-386,406-410`（CRUD v1 分支本地同步）+ `persistence.ts:37`（`createWorkspace: hostClient.rpc('workspace.create')` 本机重建）；blueprint 仅规定 v2 分支过滤（TECH L577）
- rationale: blueprint 的 serialize 过滤只落在 v2 分支（"`s.workspaces.filter(w => w.hostId === 'local')`"），但 serialize 有**两个**分支——`persistMode==='v1'`（迁移未完成 fallback）的分支同样 `s.workspaces.map(...)` 全量写 name/root。`persistMode` 是**全局单字段**（反映本机迁移态），远程 ws 也活在同一 store 里。若用户处于 v1 fallback 时连了远程机并加远程 workspace，该 ws（hostId=configId）会带 name/root 写进 v1 存档；下次 `hydrateFromHost` 走 `runMigration`，逐条 `createWorkspace → hostClient.rpc('workspace.create')` **在本机**重建这个远程路径 → 本机注册表污染 + 孤儿。同理 addWorkspace/removeWorkspace/renameWorkspace 的 v1 分支（store.ts:338/384/406）直接本地同步、无视 targetHostId/ws.hostId，远程 CRUD 会静默落本机。这正是 blueprint「远程不持久化即回避孤儿外键」不变式被绕过的口子，且 D-6 前提③的核验只看了 v2 hydrate 路径。
- 建议: serialize v1 分支同样 `filter(hostId==='local')`；CRUD 三个 v1 分支要么拒绝非 local targetHostId（远程操作在 v1 fallback 下不可用并提示），要么与 v2 一致按 host 路由。TC 补一条"v1 fallback 下 serialize 不含远程 ws"。或在 TECH 显式声明并断言"v1 fallback 与远程功能互斥"这一前提。

### E4 · `forHostId` 是未定义原语，且 create 走 `?? local()` 兜底 = 静默把远程建仓落到本机（写误路由，非只读）
- severity: **high**
- status: open
- title: TECH 多处用 `hostRegistry.forHostId(targetHostId)` 但只定义了 `forWorkspace`；create 兜底 local 会造成 wrong-host 写
- location: TECH A26（L621）+「远程 workspace 发现 + CRUD」`addWorkspace`（L696）；`hostRegistry.ts` 现无 `forHostId`（全仓 grep 无命中），只有 `local/getOrCreateRemote/drop` + 新增 `forWorkspace`
- rationale: 新建 workspace 时 ws 尚不存在，无法 `forWorkspace(ws)`，故 TECH 用 `forHostId(targetHostId)` 路由 create——但这个原语从未在「路由原语」或数据结构节定义，签名/兜底策略空白。若照抄 `forWorkspace` 的 `?? this.local()` 兜底，则 targetHostId 对应远程 client 若在"选中已连接远程机 → 点确认创建"之间掉线，`forHostId(configId) ?? local()` 会把 `workspace.create` **落到本机注册表**（写入，非展示型只读），产生持久化本机孤儿。blueprint R-2 的"兜底 local 无害"论证只覆盖"展示型只读"与"活跃 RPC 被断线门控前置拦截"，**没覆盖 create 这类写**——而 create 恰恰不经断线门控（用户主动流程）。
- 建议: 显式定义 `forHostId(hostId): HostClient | null`（或对 create 专用路径），**未命中 → 拒绝创建 + 提示"目标机器已断开"**，绝不兜底 local 写。TC 补"目标远程机不在 registry 时 create 不落本机"。

### E5 · sessionEvents per-host 订阅/退订缺明确挂载点与生命周期 TC
- severity: **low**
- status: open
- title: `initSessionEvents` 有 `inited` 单次闸 + 只订本地；"ready 追加/drop 退订"的调用方未指定，无泄漏/漏订 TC
- location: `src/renderer/services/sessionEvents.ts:40-44`（`inited` guard + 单订 hostClient）；TECH「会话路由复合键」L665-666、R-6（L830）
- rationale: `initSessionEvents()` 一次性订阅本地单例；远程 client 在其后由 `getOrCreateRemote` 动态创建。TECH 说"新远程 host ready 时追加订阅、drop 时退订（unsub 句柄 Map）"，但**没钉死是谁在 ready 时调用 `subscribeSessionEvents(hostId, client)`**（remoteWorkspaceSync 只接了 workspace.list + onWorkspaceChanged，未接 session 订阅）。漏挂载 → 远程会话事件永不路由（角标/通知全丢）；漏退订 → drop 后残留（虽 `waitingNotified` 按 tabId 去重 + client 已 dispose，实害有限，故 low）。R-6 标 low 但无自动化 TC，而本文件历史上因通知复位有过真 bug（`sessionEvents.ts:64-65` 注释所指），值得一条测。
- 建议: TECH 明确 ready 挂载点（建议并入 remoteWorkspaceSync 的 ready 编排，与 onWorkspaceChanged 同生命周期）；补 TC"远程 ready 后 session:event 路由到该机 tab；drop 后不再路由"。

### E6 · reconcileWorkspaces 签名/hostId 注入未列入"被改内部接口"表
- severity: **low**
- status: open
- title: WorkspaceState.hostId 设为必填后 reconcile 合成分支必须注入 hostId，但影响面表未列 reconcile
- location: `src/renderer/state/workspaceSync.ts:50-56`（合成 workspace 无 hostId 字段）；TECH「依赖与影响面」被改内部接口表（L762-769）未含 reconcileWorkspaces
- rationale: hostId 定为必填（TECH 数据结构表），则 reconcile 合成默认视图处（workspaceSync.ts:50-56）不补 hostId 会 tsc 报错；且 reconcile 现在要按调用作用域注入不同 hostId（applyWorkspaceSnapshot='local' / 远程发现=configId），意味 reconcile 需加 hostId 形参。TECH 正文提了"合成处补 hostId"，但内部接口影响表漏列 reconcile 的签名变更（tsc 会强制暴露，故 low，但完整性上应列）。
- 建议: 把 `reconcileWorkspaces(local, active, snapshot, hostId)` 的签名变更补进影响面表与 §数据结构改动点。

---

## 摘要

- **1 blocker / 3 high / 2 low**（未达 blocker≥5 系统性阈值，正常输出）。
- **verdict: NEEDS_REVISION**。
- 迁移清单穷举、A/B/C 分类、AC↔TC 映射、复合键需求、AC-6/7 物理基础——独立复核**全部成立**，blueprint 的 grounding 扎实。
- 问题集中在"点到目标但没给可落地机制"的两处数据模型作用域修复 + 门禁 pattern 的自伤。

**dev 前最该解决的 1-2 点**：
1. **E2（blocker）**：applyWorkspaceSnapshot 必须补"远程子集回并 + 远程 active 守卫"，否则本机加一个项目就清空所有远程机分组——且当前 28 条 TC 测不出。
2. **E1（high）**：门禁脚本与 TC 豁免清单要处理注释假阳（remoteHostStore/core/types/deps 的注释），否则正确迁移也红门禁，诱导 dev 退回 `hostClient\.` 重新漏 App:76。

---

# Verify · TECH v0.2 / TC 35test（commit 365f4e8 · 只验消解 + 新问题）

**verify verdict: NEEDS_REVISION（窄口径）** —— BLOCKER 与 3 high 全部**真消解**（机制可落地、TC 断言到位），仅剩 E1 的**收尾未闭合**（1 high）+ 3 条 low。距 APPROVE 只差"把门禁口径在 TECH↔TC 之间收敛成一份"这一步。

## 原 findings 消解核验（逐条对真实 v0.2 文本复核）

| id | 状态 | 证据 |
|----|------|------|
| **E2（blocker）** | ✅ **真消解** | TECH「🔴 作用域隔离机制」(TECH.md:263-284) 给出可落地四步：① filter-in inScope/outScope ② `reconcileWorkspaces(inScope, active, snapshot, scopeHostId)` ③ 按 prev 原位次 merge-back + outScope 原位透传 ④ active hostId 守卫（仅当原 active 属本作用域且被本作用域快照删除才复位）。补 `BL004-U-snapshot-scope-local`（active=R1 远程时本机快照到达 → R1/R2 不删、active 仍=R1）+ `-remote`（对称）两 P0，断言正是我 E2 要求的"远程 ws 保留 + 远程 active 不抢"。闭环成立。|
| **E3（high）** | ✅ **真消解** | serialize **v1+v2 双分支**都 `filter(hostId==='local')`（TECH.md:144-148）+ v1 CRUD `targetHostId!=='local'` 拒绝（TECH.md:300,303 · E-9）。补 `BL004-U-serialize-v1-noremote` + `-v1-remote-crud-reject`。v1 漏写口子已堵。|
| **E4（high）** | ✅ **真消解** | 写/读分流：`forHostId(hostId): HostClient\|null` 未命中返 null**绝不兜底**、create 拿 null 拒绝不落本机（TECH.md:108-118,301 · E-8）；`forWorkspace` 读兜底 local **恒 WARN**（E-6）。补 `BL004-U-create-nohost-reject`，断言 `localStub.rpc` **未**被 `workspace.create` 调用 + 本机注册表快照前后不变。|
| **E5（low）** | ✅ 消解 | session 远程订阅并入 `remoteWorkspaceSync` ready 编排、drop 一次性退订（unsub Map<hostId>）（TECH.md:242-244）；补 `BL004-U-session-lifecycle`（drop 后 (cfg-1,*) 不再路由、本机不受影响）。挂载点悬空已定。|
| **E6（low）** | ✅ 消解 | `reconcileWorkspaces(+scopeHostId)` 作用域安全已入影响面表（TECH.md:375）+ 步骤表阶段 1。|

## 残留 findings（verify 新增）

### V1 · E1 门禁未真收敛：TECH 改判 import 集，TC 仍写 use-point `\bhostClient\b`+剥注释——两份不同门禁，"严格对齐"是假的
- severity: **high**
- status: open
- title: 权威门禁口径 TECH↔TC 分叉，E1 想消灭的"TC/TECH pattern 矛盾"换形重现
- location: TECH.md:220-237（`import 集` importer⊆豁免 + tsc 背靠）vs TC.md:344-360 `BL004-U-grepgate`（`When 匹配词边界 /\bhostClient\b/` + 剥离注释 + allowlist）；TECH.md:237 自陈"TC.md 现写 `\bhostClient\.` 须与本门禁统一为 import 集"（= 未完成的 action item）
- rationale: RD 把 TECH 门禁改成 **import 集**（并明确 TECH.md:224 说 `\bhostClient\b` 会误红 4 处注释、types.ts:5 的 `/**` 连剥注释脚本都漏 → 故**放弃使用点 grep**）。但 QA 把 TC `BL004-U-grepgate` 改成了**另一套**——使用点 `\bhostClient\b` + 剥注释 + allowlist。两文件各自写着"与对方严格对齐"，实际是**两套不同判定**：① 权威性不清（dev 跑 import 集绿、QA 跑词边界可能红，或反之）；② TC 这套恰恰用了 TECH 亲手否掉的剥注释路径，而 TECH 已指出简单剥注释器漏 `types.ts:5` 的单行块注释 → TC 若照此实现就带着 TECH 已知的脆弱点。lead 本轮明确要"确认 import-set 门禁 + 与 TC 对齐"——**对齐这一条没达成**。TECH:237 自己都还挂着"须统一"。
- 建议: 二选一并落成一份：**(推荐)** 把 `BL004-U-grepgate` 断言改为 **import 集不变式**（`import { hostClient }` importer 集 ⊆ 豁免集）与 TECH 脚本同源，删掉 TC 里的 `\bhostClient\b`+剥注释表述；或明确写"import 集 = CI 硬门禁（权威）、词边界 = 辅助 advisory"并说明二者互补。无论哪种，TECH.md:508 补充洞察 + TC.md:536 变更记录里"钉成/改成 `\bhostClient\b`"的**陈述性残留**要一并订正（见 V4）。

### V2 · import 集门禁对"折行 import"仍有盲区，"import 单行·永不折行"是假设非保证
- severity: **low**
- status: open
- title: 行式 `grep -rlE "import[^;]*hostClient"` 漏多行 import 语句，且 tsc 背靠此时不触发
- location: TECH.md:225,229（`import[^;]*\bhostClient\b` + "单行·永不折行"论断）
- rationale: 回答 lead 直问"import-set 是否真拦得住残留裸消费"：**单行 import + tsc 背靠 = 完备**（未 import 就用 → tsc「cannot find name」拦；类型 `HostClient` 大写不被 `\bhostClient\b` 误伤，无假阳）。**但** grep 默认按行匹配，若某文件 import 名单超 80 列被 prettier 折成多行、`hostClient,` 独占一行，则 `import[^;]*hostClient` 这条行式正则**匹配不到**该行（行内无 `import`），而该文件确实 import 了 hostClient → tsc 也不报（import 在）→ **两道门禁双绿、裸消费溜过**。这正是 import 集声称免疫的"折行"陷阱换了个位置。当前 `./hostClient` import 很短（~48 列）不触发，故 low；但"永不折行"是假设不是保证。
- 建议: 门禁用多行感知扫描（`grep -rlzE` null 分隔 / 或 node AST / 或 eslint `no-restricted-imports` 规则）而非行式 grep；至少在 TECH 注明"依赖 import 单行"这一前提并在门禁里附一条"无折行 hostClient import 行"的兜底检查。

### V3 · TC `BL004-U-create-nohost-reject` gherkin 写的是 `forWorkspace`（读原语），而 create 应走 `forHostId`（写原语）——照字面实现即触发 E4 原 bug
- severity: **low**
- status: open
- title: create-reject 测试步骤误用读原语，与 TECH 写/读分流相悖
- location: TC.md「E4 · create 不落本机」gherkin：`When 路由 hostRegistry.forWorkspace({hostId:'cfg-1'}) 未命中`
- rationale: TECH 明确 create 走 `forHostId`（未命中→null→拒绝），`forWorkspace` 是读原语（未命中→**兜底 local**）。TC 的 create 场景却写 `forWorkspace`。断言（`localStub.rpc` 未被 create 调用）本身正确，但步骤命名把写路径挂到读原语上——dev 若照 TC 字面用 `forWorkspace` 路由 create，未命中会**兜底 local 写**，正是 E4 要防的 bug。语义漂移虽被断言兜住，但 TC 是 RD 对齐测试形状的单源，措辞要对。
- 建议: 把该 gherkin 的 `forWorkspace` 改为 `forHostId`，与 TECH 写/读分流一致。

### V4 · 两处陈述性残留仍指向已废弃的 `\bhostClient\b` 门禁
- severity: **low**
- status: open
- title: TECH 补充洞察 + TC 变更记录仍把 `\bhostClient\b` 当权威门禁描述
- location: TECH.md:508（"TECH 已把门禁 pattern 钉成 `\bhostClient\b` + 豁免清单，dev 直接照抄"）+ TC.md:536（"E1 grep 门禁 pattern 改 `\bhostClient\b` 词边界…与 TECH 脚本对齐"）
- rationale: 正文权威段（TECH §覆盖门禁）已改 import 集，但这两处叙述仍说门禁是 `\bhostClient\b`，且 508 还叫"dev 直接照抄"。dev/QA 读到会实现错门禁，与 V1 相互印证同一根因（口径未一次性收敛）。
- 建议: 随 V1 一并订正为 import 集口径。

## 实现精度提示（非 finding · 供 RD 落地）
- 作用域 active 守卫的正确判据是 **`active ∈ inScope 输入集 且 active ∉ snapshot`** 才复位——不能沿用现 `reconcileWorkspaces` 的裸 `active ∉ snapshot`（那样域外远程 active 会被本机快照误复位）。`BL004-U-snapshot-scope-local` 已把这条钉成断言，实现按它对即可。

## 摘要
- **消解**：E2 blocker + E3/E4 high + E5/E6 low **全部真闭环**，机制可落地、TC 断言到位，v0.2 质量高。
- **残留**：V1（high · E1 门禁 TECH↔TC 未收敛）+ V2/V3/V4（low）。
- **verdict: NEEDS_REVISION**，但**仅 E1 收尾**：把门禁口径在 TECH 与 TC 收敛成一份（推荐 TC `BL004-U-grepgate` 断言 import 集不变式）+ 订正两处陈述残留。做完即可 APPROVE。BLOCKER 已彻底清除，不必再回炉机制。
