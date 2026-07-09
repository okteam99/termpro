---
reviewer: architect
verdict_recommendation: NEEDS_REVISION
findings:
  - {id: A1, severity: MAJOR, title: "workspace.list 失败被当作『注册表为空权威』→ v2 模式下全部 workspace 被当孤儿丢弃,并可能被后续写回永久落盘", file: "src/renderer/state/persistence.ts:34"}
  - {id: A2, severity: MINOR, title: "并发 mutation + 写失败回滚破坏内存/盘/广播一致性(失败 create 的数据在重启后复活)", file: "src/host/workspaceRegistry.ts:129"}
  - {id: A3, severity: MINOR, title: "幂等 create 返回既有不更新字段 → v1 fallback 期间的改名/改根在重试成功后丢失", file: "src/host/workspaceRegistry.ts:122"}
  - {id: A4, severity: MINOR, title: "部分迁移非原子 + fallback 期本地删除 + 重试成功 → 已删 workspace 复活为默认视图", file: "src/renderer/state/workspaceMigration.ts:86"}
  - {id: A5, severity: MINOR, title: "简洁性:细粒度『同步改内存 + 串行写队列 + 逐op回滚』比『整条 mutation 串行队列』更复杂,且正是 A2 破口", file: "src/host/workspaceRegistry.ts:180"}
  - {id: A6, severity: NIT, title: "viewer 窗口被注册进广播 senders 但从不消费 workspace:changed(无害冗余)", file: "src/host/host.ts:111"}
---
# Architect Review

## 结论摘要

verdict 建议:**NEEDS_REVISION**(仅因 A1 一条 MAJOR;若裁决认为 A1 在纯本地形态下不可达可降级,则可 APPROVE-with-nits)。

变更集架构方向正确、红线全绿:host 零 Electron(grep 确认),renderer 零 fs/pty(grep 确认),契约先改 `protocol.ts` 且 workspace.* 挂 `RpcMethods`、`workspace:changed` 挂 `HostMessage` union(与 BL-002 约定的唯一共享行一致)。三层职责边界清晰,数据目录经 env 注入保持零 Electron,迁移驱动归壳层(renderer)。`tsc --noEmit` 退出 0,`vitest` 338/338 绿。TECH 声称的核心不变式("name/root 单源=Host""v2 serialize 去 name/root""迁移标记单源=存档 version""先落盘再广播")在代码里都能对上。

问题集中在**失败/并发边界的一致性**,而非主干功能:主干 AC-1..6 的正常路径都实现且有测试覆盖。A1 是唯一有数据可见性/丢失后果的确定性缺陷,其余 MINOR 都需要"部分写失败 + 特定交错"这类窄触发窗口。

## Findings(逐条:实证 + 影响 + 修复建议)

### A1 · MAJOR · workspace.list 失败被当作"注册表权威为空",v2 模式下全量 workspace 被当孤儿丢弃

**实证**:`persistence.ts:34-42`
```ts
let registry: WorkspaceEntry[] = [];
try {
  const res = await hostClient.rpc('workspace.list', undefined);
  registry = res.workspaces;
} catch (err) {
  console.warn('[renderer] workspace.list failed during hydrate:', err);
}
useAppStore.getState().hydrate(registry, outcome.archive);  // registry 仍是 []
```
`hydrate` 的 v2 分支(`store.ts:302-321`)用 `regById = new Map(registry...)` 做外键连接,**注册表里没有的 workspaceId 一律当孤儿静默丢弃**(`if (!entry) continue`)。当 `workspace.list` reject 时 `registry=[]`,于是 v2 存档里**每一条** workspaceId 都匹配不到 → 全部丢弃 → hydrate 出空 workspace 列表。

**复现(确定性)**:注入 `hostClient.rpc('workspace.list')` reject(host 在 `host.info` 应答后、`list` 前退出即可自然触发),启动后 Sidebar 全空,尽管注册表文件在盘上完好、存档 v2 引用完好。

**为何这是 bug 而非 TECH 已接受的语义**:TECH §风险表把"注册表被外部删除/损坏但存档已 v2 → 列表清空"列为**可接受**语义(注册表=机器真相,数据真没了)。但 `list` **失败**与"注册表真为空"是两回事——数据仍在盘上,只是这一次没读到。代码把两者合流(都走 `registry=[]`),把"读失败"误当"权威为空"。

**放大后果(可永久化)**:hydrate 后 `workspaces=[]`,随后 `persistence.ts:55` 的防抖订阅一旦被任意状态变更触发(用户见列表空后最自然的反应就是重新 `addWorkspace` → create 成功 → `serialize` 写 v2),`serialize`(`persistence.ts:88-99`)会把当前空/单条 workspaces 落盘,**覆盖掉原 v2 存档里的全部外键引用**。下次重启:存档 v2 无引用,注册表恢复可读 → 每条走 `buildDefaultWorkspace`(`store.ts:322-326`)以**默认单 tab 视图**回来 → 用户丢失全部 tab/customName/filePanel/排序视图态,静默、已落盘、不可逆。

**影响**:单次 `workspace.list` 瞬时失败 → 全部 workspace 从视图消失(无条件);叠加一次持久化写回 → 视图态永久丢失。本地嵌入式 host 下 `list` 紧跟 `host.info` 成功之后,失败窗口极窄(可达性低);但这段代码是**远程就绪的共享路径**(BL-004 目标),远程网络抖动下 `list` 失败是常态,届时此缺陷高频命中。

**修复建议**(任一):
- v2 模式下 `workspace.list` 失败视为**致命软失败**:不 hydrate 到空、不启动持久化订阅(避免覆盖存档),显示"连接注册表失败/重试"占位,或有限重试后再 hydrate。关键是**区分"list 成功且空"与"list 失败"**,只有前者才允许孤儿丢弃逻辑生效。
- 或:hydrate 增参 `registryFetched: boolean`,`false` 时保留存档引用(用存档自带信息降级渲染或阻塞),不套用 orphan-drop。

补一条测试:`test_hydrate_v2_with_list_failure_does_not_drop_workspaces_or_persist_empty`。

---

### A2 · MINOR · 并发 mutation + 写失败回滚 → 内存/盘/广播三方分叉

**实证**:`workspaceRegistry.ts:129-137`(create:先同步 push 内存,再 `await enqueueWrite`,catch 里 `filter` 回滚)、`:180-193`(`enqueueWrite` 在**入队时点**捕获 `snapshot`,写盘串行化)、`workspaceService.ts:57-62`(create 成功后 `broadcast()` 读**当前**内存)。

`host.ts:117` 的 `void handleRpc` 是 fire-and-forget 并发,`WorkspaceService.handle` 对每个 RPC `await registry.load()`(已解析,仍让出 microtask)。因此两个并发 create 会**都先同步 push 内存**,再各自 await 写盘。构造交错:
```
create A(id=1): 内存=[1], 入队捕获 snapshotA=[1]
create B(id=2): 内存=[1,2], 入队捕获 snapshotB=[1,2](链在 A 之后)
写A 执行 atomicWrite([1]) → 注入失败 → A catch 回滚内存=[2],A 抛错(client 收到 create 失败)
写B 执行 atomicWrite([1,2]) → 成功 → 盘=[1,2]
B handle broadcast → registry.list()=内存=[2] → 广播 [2]
```
终态:**盘=[1,2]、内存/广播=[2]**。A 的 create 明明返回了失败,其数据却在盘上;重启后 `doLoad` 读回 [1,2],id=1 **复活**。同时违反 TECH 明写的不变式"广播出去的快照=已落盘状态"。`remove` 的回滚(`:146-154`)更脆:回滚用**入队时捕获的 idx** 重新 `splice(idx,0,removed)`,若期间有并发 mutation 改了数组长度/位置,回滚位置就是错的。

**触发条件**:多客户端(或未来远程多端)近乎同时 mutate,且**其中较早一条写盘失败、较晚一条写盘成功**(差异化写失败)。磁盘满通常令所有写都失败(此时无分叉);差异化失败(EMFILE/瞬时错误命中某一次)才触发,故定 MINOR。现有 `test_concurrent_creates_serialize_no_lost_update` 只覆盖并发**全成功**,`INT-004` 只覆盖**单条**写失败,均未覆盖此交错。

**修复建议**:把**整条 mutation(改内存 → 写盘 → 成功后才 commit / 失败则不改内存)**串行化为单一 async 队列,而不是"同步改内存 + 只串行化写盘 + 逐 op 事后回滚"。整条串行天然消除交错,回滚也不再需要(失败就没改过内存),同时 A5(简洁性)一并解决。

---

### A3 · MINOR · 幂等 create 返回既有但不更新字段 → fallback 期改名在重试后丢失

**实证**:`workspaceRegistry.ts:122-125`
```ts
const existing = this.workspaces.find((w) => w.id === id);
if (existing) return { ...existing };   // 返回既有,忽略 input.name/root
```
配合迁移重试(`workspaceMigration.ts:88-90` 用**存档当前** name/root 调 create)。

**复现**:3 个 workspace,迁移时 ws1 create 成功、ws3 失败 → v1 fallback。用户在 fallback 模式把 ws1 改名为 "A2"(`store.ts:404-410` v1 分支本地改名 → serialize 写 v1 存档)。下次启动重试:`create({id:ws1, name:"A2"})` → 注册表已有 ws1(name 仍 "A")→ 返回既有、丢弃 "A2"。迁移完成翻 v2,hydrate 用注册表 name="A" → 用户的改名被静默回退。

**影响**:仅"部分迁移失败 + fallback 期改名/改根 + 重试成功"窄路径,后果是改名回退(无崩溃、无 tab 丢失),故 MINOR。

**修复建议**:迁移重试对已存在 id 走 update 语义(create-or-update),或迁移循环对每条 `create` 后紧跟一次 `update({name,root})` 以对齐存档最新值;或接受此边界并在 DEV.md 记一句。

---

### A4 · MINOR · 部分迁移非原子 + fallback 期本地删除 + 重试成功 → 已删 workspace 复活

**实证**:`workspaceMigration.ts:86-95`(逐条 create,任一失败即 return,**不回滚已成功的 create**)+ `store.ts:322-326`(hydrate v2:"注册表有、存档未引用"→ `buildDefaultWorkspace` 追加)。

**复现**:3 个 ws,ws1/ws2 create 成功、ws3 失败 → v1 fallback,注册表残留 [ws1,ws2]。用户在 fallback 模式删除 ws1(`store.ts:384-386` v1 分支纯本地删,不发 RPC)→ v1 存档=[ws2,ws3]。下次重试:create ws2(幂等)、ws3(新)→ 成功翻 v2,`toV2Archive` 只映射存档里的 [ws2,ws3]。注册表现为 [ws1,ws2,ws3]。hydrate v2:ws2/ws3 来自存档;**ws1"注册表有、存档无"→ 合成默认视图追加** → 已删的 ws1 复活。

**影响**:窄路径(部分失败 + fallback 期删除 + 重试成功),后果是幽灵 workspace 复活(默认视图),非崩溃。MINOR。

**修复建议**:与 A2/A3 同源——迁移的"部分成功"在注册表侧不是原子。可选:迁移失败时 best-effort 清理本次已 create 的 id(记录成功 id 列表,失败则逐条 remove);或接受"注册表=机器真相、fallback 期本地删不权威"的语义并文档化(与 model A 一致,但需明确写下)。

---

### A5 · MINOR(简洁性 counter-lens)· 并发方案可更简且更正确

`workspaceRegistry` 当前把并发正确性拆成三件事:①同步改内存(唯一真相)②只把写盘串行化③失败逐 op 回滚。这比"整条 mutation 串行队列"更复杂(多出回滚分支 + 入队快照 vs 当前内存的时点差),而 A2 恰恰从这个时点差破口进来。用单一 async 串行队列包住"读改内存→写盘→commit",复杂度更低、A2 自动消失、回滚代码可删。这是把本可以更简单的并发模型做重了——不是过度设计整个 Feature,而是这一处实现选了偏复杂的路径。建议收敛。

---

### A6 · NIT · viewer 窗口被注册进广播 senders 却不消费

`host.ts:111` 每个 attach 的 client(含 viewer 文件/diff 窗口)都 `workspaces.addClient`,但 viewer 不跑 `initPersistence`、不订阅 `onWorkspaceChanged`,收到的 `workspace:changed` 落进空 listener set(`hostClient.ts:223-225`)。无害,轻微冗余。可不处理。

## 架构一致性核对(红线逐条)

| 红线 | 结论 | 实证 |
|---|---|---|
| UI 永不直接碰 fs/PTY/git,只走 HostService 协议 | ✅ | `grep node:fs\|node-pty src/renderer` 空;workspace CRUD 全走 `hostClient.rpc` |
| Host 进程零 Electron import | ✅ | `grep "from 'electron'" src/host` 空;`workspaceRegistry`/`workspaceService` 仅 `node:fs/path/crypto`;数据目录经 `TERMPRO_HOST_DATA_DIR` env 注入(`main.ts:123`),host 用 `process.env` 读(`host.ts:75`) |
| 改契约先改 protocol.ts | ✅ | 4 个 workspace RPC 挂 `RpcMethods`(`protocol.ts:131-145`)、`workspace:changed` 挂 `HostMessage` union(`:176`)、`WorkspaceEntry` DTO 导出 |
| PROTOCOL_VERSION 策略 | ✅(符合 TECH) | 不 bump(新增向后兼容 RPC),版本策略归 BL-002;`HostMessage` 唯一共享行与 BL-002 约定一致 |
| 迁移驱动归壳层(renderer 读 v1) | ✅ | `initPersistence` 读 `storeGet` → 逐条 `workspace.create`;host 只收定义字段,不知 UI 存储位置 |
| 先落盘再广播 | ✅ | `workspaceService.handle` 在 `await registry.create/remove/update`(含写盘)成功后才 `broadcast`;失败 reject 不广播(`INT-004` 验证) |

红线**全部符合**。远程就绪约束(host 零 Electron、契约传输无关)保持得很干净。

## 简洁性评估

整体**未过度设计**:双模式 persistence、迁移状态机、reconcile 纯函数、串行写队列都是"远程 model A 地基"这一目标的必要复杂度,且 TECH 的 YAGNI 自查(拒绝 delta 协议 / 乐观回滚 / SQLite / 双标记文件)判断合理。全量快照 + 收端 id 协调是对的取舍(记录数个位~十位,diff/patch 是纯负担)。迁移标记单源=存档 version 的论证(为何不用注册表内容当标记)扎实。

唯一"复杂度焊错地方"是 A5 指出的注册表并发实现——本可用整条 mutation 串行队列做得更简单且正确,却选了"同步内存+串行写+逐op回滚",既多写了回滚分支又埋了 A2。职责归层没有错(name/root 单源在 Host、视图态在 UI、迁移在壳层都对),是**这一处实现路径**偏重。建议随 A2 一并收敛。
