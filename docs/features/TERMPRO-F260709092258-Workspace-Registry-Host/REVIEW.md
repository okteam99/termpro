---
reviewers: [architect, qa, external]
verdict: NEEDS_REVISION
findings:
  - {id: F1, severity: MAJOR, status: open, title: "hydrate 期 workspace.list 失败被当『注册表为空』→ v2 视图态全量孤儿丢弃,可被后续写回永久固化", source: arch}
  - {id: F2, severity: MAJOR, status: open, title: "并发 mutation + 前序写失败回滚 → 入队时快照把被回滚条目落盘,内存/盘/广播分叉,重启复活", source: qa}
  - {id: F3, severity: MINOR, status: open, title: "create 幂等为 insert-if-absent 非 upsert,partial 迁移 + v1 fallback 改名在重试后丢失", source: arch}
  - {id: F4, severity: MINOR, status: open, title: "部分迁移非原子 + fallback 期删除 + 重试成功 → 已删 workspace 复活为默认视图", source: arch}
  - {id: F5, severity: MINOR, status: open, title: "简洁性:整条 mutation 串行队列比『同步改内存+入队快照+逐 op 回滚』更简且天然规避 F2", source: arch}
  - {id: F6, severity: MINOR, status: deferred, title: "AC-1 备份内容未被测试断言;appStore store:backup-v1 零覆盖", source: qa}
  - {id: F7, severity: MINOR, status: rejected, title: "生产传输粘合层(host.ts dispatch/hostClient 路由)未进测试", source: qa}
  - {id: F8, severity: MINOR, status: deferred, title: "迁移输入健壮性:畸形 v1 存档(非数组/单条坏条目)→ hydrate 崩溃或永卡 v1 无诊断", source: external}
  - {id: F9, severity: MINOR, status: deferred, title: "remove no-op/update 同值仍广播+写盘,与 TECH no-op 语义偏差(多余 churn)", source: external}
  - {id: F10, severity: MINOR, status: deferred, title: "service 边界 params 无运行时形状校验,M5 远程不可信输入面偏弱", source: external}
  - {id: F11, severity: NIT, status: deferred, title: "viewer 窗口注册进广播 senders 但不消费 workspace:changed(无害冗余)", source: arch}
  - {id: F12, severity: NIT, status: rejected, title: "TDD 先后顺序不可从 git 验证(单 squash commit)", source: qa}
---
# REVIEW 汇总(Round 1 · 全量评审)

> 汇总层。三份独立产物:REVIEW-arch.md(A1-A6)/ REVIEW-qa.md(Q1-Q6)/ external-cross-review/review-claude-subagent-degraded.md(CR-1..6 · 降级同模型冷审 · 非异质)。
> 门禁独立复跑:tsc 0 err · vitest 338/338 绿 · SMOKE_OK(QA 复跑 + PMO 复核)。红线全绿:host 零 Electron / renderer 零 fs·pty / 契约先改 protocol.ts(arch grep 确认)。

## 源 finding 映射

| 统一 id | 来源 | 交叉印证 |
|---|---|---|
| F1 | A1 + CR-1(high) | 双视角独立命中 |
| F2 | Q1(MAJOR) + A2(MINOR) + CR-2(low) | 三视角独立命中,定级分歧见裁决 |
| F3 | A3 + CR-3 | 双视角 |
| F4 | A4 | — |
| F5 | A5 | 与 F2 修复方向耦合 |
| F6 | Q2 | — |
| F7 | Q3 | — |
| F8 | Q4 + CR-5(合并:同属迁移输入健壮性) | 双视角相邻 |
| F9 | CR-4 + Q6(NIT 面向同一广播冗余) | 双视角相邻 |
| F10 | CR-6(info) | — |
| F11 | A6 | — |
| F12 | Q5 | — |

## 逐条裁决(质疑 → 确认 → 裁决)

### F1 · MAJOR · open(confirmed · 本轮必修)
- **质疑**:list 失败窗口在嵌入式本地形态是否可达?是否 TECH 已接受语义?
- **确认**(PMO 回读代码):`persistence.ts:36-40` catch 后 `registry=[]` 无条件进 `hydrate`;`store.ts:305-311` v2 分支 `if (!entry) continue` 无条件孤儿丢弃;`persistence.ts:55-61` hydrate 后订阅防抖写回,任一状态变更即把空 workspaces 固化落盘。TECH 风险表接受的是「注册表真空」,代码把「读失败」合流进同一路径 —— 语义混淆实锤。本地窗口窄(host 崩溃/重启瞬间)但非零,且这是 BL-004 远程共享路径,远程抖动下高频。
- **裁决**:confirmed MAJOR。修法:区分「list 成功且空」与「list 失败」;失败时不进破坏性 v2 hydrate、不启动持久化订阅(防固化),保留重试/占位。补 list-reject 单测(断言不丢弃、不落盘空态)。

### F2 · MAJOR · open(confirmed · 本轮必修)
- **质疑**:arch 定 MINOR、external 定 low(触发窄:并发+写失败);QA 定 MAJOR。谁对?
- **确认**(PMO 回读代码):`enqueueWrite`(`workspaceRegistry.ts:181-184`)在**入队时**捕获快照;前序写失败的调用方回滚(L134)发生在后序快照捕获之后 → 后序写落盘含被回滚条目,盘≠内存≠广播。QA 有确定性 probe 复现(并发 create a 写失败 + b 成功 → 盘=[a,b] 内存=[b] 重启复活 a)。违反模块自述不变式「广播快照=已落盘」与 AC-2「重启后=最后一次成功操作」。
- **裁决**:confirmed MAJOR(确定性机制 + 实证复现 + 本 Feature 即 BL-004 并发多客户端地基,并发写是一等场景,不是理论边角)。⚠️ 修复注意:单纯把快照改为「写执行时读内存」仍有微任务序问题 —— 队列尾 `catch` 的注册先于调用方回滚 continuation,下一笔写仍可能读到回滚前内存。稳妥方向:(a)整条 mutation(含内存变更+落盘+回滚)进串行队列(即 F5 方向),或(b)写失败回滚后补一笔校正写使盘收敛到回滚后内存。补「并发 create + 首写失败」divergence 测试。

### F3 · MINOR · open(confirmed · 随 F2 顺手评估,允许 defer)
- **确认**:`workspaceRegistry.ts:122-126` 命中既有 id 直接返回,不应用入参字段 —— 与 TECH「upsert」措辞不符,实为 insert-if-absent。触发窄(partial 迁移+fallback 改名+重试)。
- **裁决**:confirmed MINOR。RD 本轮若低成本可顺手修(create 命中既有且字段不同则 update)或仅修 TECH 措辞;不强制。

### F4 · MINOR · open(confirmed-plausible · 允许 defer)
- **确认**:迁移逐条 create 非原子 + fallback 期删除后重试,已删条目以默认视图复活 —— 机制与 F3 同族(迁移重试 vs fallback 期变更的合流语义),未独立复现但推理链完整。
- **裁决**:MINOR。与 F3/F8 同属「迁移边界语义」一组,本轮不强制修;修 F3 时若同路径顺手可一并。

### F5 · MINOR · open(方向性建议 · 并入 F2 修复裁量)
- **裁决**:作为 F2 的修复候选方向(整条 mutation 串行队列 = 更简 + 天然一致)。RD 修 F2 时评估采纳;采纳则 F5 随之 fixed,不采纳需在修复说明中给出理由(如吞吐考量)。

### F6 · MINOR · deferred
- **裁决**:备份内容断言是测试增强,非缺陷(备份机制本身有 REGR 覆盖其存在性)。defer → 待规划池(测试补强组)。

### F7 · MINOR · rejected(带依据)
- **质疑→确认**:TC.md 分层 5 补充洞察**明确允许**等效 harness(WorkspaceService 真广播 + 真协调,内存端口),生产粘合层不进测试是 TC 阶段已拍板的取舍,非实现偏离;且 BL-002(并行 Feature)正以真实 WS 传输补全传输层 parity 测试。
- **裁决**:rejected —— 按已确认 TC 契约执行的实现不构成 finding。

### F8 · MINOR · deferred
- **确认**:Q4(workspaces 非数组 → 迁移抛错)与 CR-5(单条畸形 → 永卡 v1 无诊断)均机制成立;但畸形 v1 存档在真实用户路径(pickDirectory 产生合法数据)概率极低。
- **裁决**:defer → 待规划池「迁移输入健壮性」(数组守卫 + 单条容错跳过 + 坏条目上报一组做)。

### F9 · MINOR · deferred
- **裁决**:终态正确,仅多余 churn;涉及 registry 返回值语义变更,不宜在修复轮夹带。defer(同步修订 TECH 措辞可随 ship 文档轮)。

### F10 · MINOR · deferred
- **裁决**:本地形态类型安全兜底成立;远程不可信输入面属 M5 BL-003/BL-004 边界加固范围(BL-002 已在 WS 层做畸形帧防护)。defer 并在 BL-004 开工输入中注明。

### F11 · NIT · deferred / F12 · NIT · rejected
- F11 无害冗余,defer 顺手清理;F12 流程元观察(squash 是本项目提交纪律),rejected。

## 修复建议(本轮 fix 范围)
1. **F1**:persistence hydrate 区分 list 失败/真空;失败路径不丢弃、不订阅写回;+ 单测。
2. **F2**(评估采纳 F5 方向):registry 写一致性重构或校正写收敛;+ 并发写失败 divergence 单测(把 QA 的 probe 固化为回归测试)。
3. F3 低成本则顺手(upsert 或措辞对齐),不强制。
修复门禁:tsc + vitest 全绿 + SMOKE_OK;不夹带 deferred 项。

## verdict
**NEEDS_REVISION** —— open MAJOR ×2(F1/F2)。其余 advisory(deferred/rejected 已裁决留痕)。

## 修复说明(Round1 fix)

> RD 修复轮。改动仅限 F1/F2/F3,未触 deferred/rejected 项。门禁三绿:`tsc --noEmit` 0 err · `vitest run` 343/343(新增 5)· `TERMPRO_SMOKE=1 electron-forge start` → SMOKE_OK。frontmatter status 未改(留验证轮裁决)。

### F1(MAJOR)· fixed
- **修法**:`persistence.ts` 把 `workspace.list` 结果用 `WorkspaceEntry[] | null` 表达 —— `null` = 读失败,`[]` = 读成功且真空。仅当 `outcome.mode === 'v2' && registry === null`(v2 hydrate 依赖注册表、且这次没读到)才走降级:**不 hydrate、不启动防抖写回订阅**,设占位提示(App 停在「连接 Host…」未 hydrate 态),并有限自动重试(`REGISTRY_RETRY_MS=800` × `REGISTRY_MAX_RETRIES=5`,耗尽停占位待 ⌘R)。把「hydrate + 接广播 + 启动写回订阅」抽成 `finishHydrate`,**写回订阅只在此启动**,从结构上保证降级路径不会固化空态。
- **为什么对**:区分了「读失败」与「注册表真空」两种语义 —— 前者数据仍在盘上(不丢弃存档外键、不落盘空态,可重试恢复),后者才允许孤儿丢弃(AC-5)。v1 fallback(`outcome.mode==='v1'`)不依赖注册表,list 失败无害,照常 hydrate,行为不变。
- **新增测试**(`src/renderer/state/__tests__/persistence.test.ts`):
  - `test_hydrate_v2_with_list_failure_does_not_drop_workspaces_or_persist_empty` —— list reject → 未 hydrate(hydrated=false)、`storeSet` 零调用(不落盘空态)、`onWorkspaceChanged` 未订阅、给占位提示。
  - `recovers workspaces from registry on a later successful retry` —— 首次失败降级、重试成功后按注册表 name/root + 存档视图态恢复两条 workspace(证明存档引用未丢弃)。
  - `v1 fallback is unaffected by list failure` —— v1 存档 + list 失败仍照常 hydrate、persistMode=v1、订阅正常。

### F2(MAJOR)· fixed · 采纳方向 (a)(= F5)
- **选型理由**:采纳 **(a) 整条 mutation 串行队列**(A5/F5 方向)而非 (b) 校正写。理由:(a) 从根上消除破口 —— 旧设计「同步改内存 + 只串行化写盘 + 入队时捕获快照」的时点差(后序写入队时快照含尚未回滚的前序条目)是 F2 唯一成因;把「校验 + 改内存 + 落盘 + 失败回滚」作为**一个原子单元**进单一串行队列(队列外绝不改内存)后,任意 mutation 运行时内存恒为同步一致的单源,后到 mutation 必等前一条整体完成(含回滚)才跑,不存在读到「回滚前内存」的窗口,`remove` 的 idx 回滚也因串行而位置稳定。(b) 需再引入一笔纠正写与其失败处理,复杂度更高且仍保留时点差结构。(a) 同时消解 F5(简洁性)与 A2 指出的 remove 脆弱回滚。吞吐:mutation 记录数个位~十位、写盘本就串行,整条串行无实际吞吐损失。
- **改动文件**:`src/host/workspaceRegistry.ts` —— `writeQueue`→`mutationQueue`;新增 `enqueue<T>(op)`(整条 mutation 入队,队尾吞错防连累)+ `snapshot()`(队列内取当前内存);`create/remove/update` 三个方法体整体包进 `this.enqueue(async () => {...})`;删除旧 `enqueueWrite`(入队时捕获快照)。文件头并发注释同步重写。
- **为什么对**:不变式「广播快照 = 已落盘状态」在任意交错下成立 —— 成功时内存(broadcast 源)与盘在同一单元内一致,失败时同单元内回滚后再抛(不广播)。「重启后列表 = 最后一次成功操作结果」成立 —— 被回滚条目从不进入任何后续写的快照。
- **新增测试**(`src/host/__tests__/workspaceRegistry.test.ts`):`test_concurrent_create_first_write_fails_no_stale_snapshot_no_revive` —— 并发 create a(注入 `writeFile` 首写 ENOSPC 失败)+ b(成功),断言 `[rejected, fulfilled]`、内存=盘=`['b']`、重启后 a 不复活。现有 `test_concurrent_creates_serialize_no_lost_update`、`test_write_failure_rolls_back_memory`、REG-002/008、INT-004 继续绿。

### F3(MINOR)· fixed(低成本顺手)
- **修法**:F2 已重写 `create`,同路径改为真 upsert —— 命中既有 id 时:字段一致→幂等 no-op 不写盘;字段不同→更新 name/root 并落盘(同一单元内失败回滚)。
- **为什么对**:与 TECH「upsert」措辞对齐,修 A3 场景(迁移重试用存档当前 name/root 调 create,fallback 期改名/改根不再被静默回退)。字段一致仍 no-op,不新增 churn,REG-002/008 不受影响。
- **新增测试**:`test_create_existing_id_with_changed_fields_updates_upsert` —— 同 id 不同字段→更新且重启保留;同 id 同字段→不再触发 `writeFile`。
