---
reviewer: qa
verdict_recommendation: NEEDS_REVISION
findings:
  - {id: Q1, severity: MAJOR, title: "并发写 + 前序写失败 → 内存与盘面分歧,重启后被回滚的 workspace 复活(违反模块自述不变式 + AC-2 重启一致)", file: "src/host/workspaceRegistry.ts:180"}
  - {id: Q2, severity: MINOR, title: "AC-1「原存档已备份」的备份内容未被断言;appStore store:backup-v1 零测试覆盖", file: "src/main/appStore.ts:51"}
  - {id: Q3, severity: MINOR, title: "生产传输粘合层未覆盖:host.ts 的 workspace.* dispatch 与 hostClient 的 workspace:changed 路由未进任何测试", file: "src/host/host.ts:257"}
  - {id: Q4, severity: MINOR, title: "迁移输入健壮性:可解析但畸形的 v1 存档(workspaces 非数组)会在迁移循环抛错并在 hydrate 二次崩溃", file: "src/renderer/state/workspaceMigration.ts:88"}
  - {id: Q5, severity: NIT, title: "TDD 先后顺序不可从 git 验证(单 squash commit)", file: "-"}
  - {id: Q6, severity: NIT, title: "幂等 create(回声/迁移重试)仍广播全量快照,无变更也推送", file: "src/host/workspaceService.ts:57"}
---
# QA Review

## 结论摘要

变更集实现了全部 6 条 AC,338/338 vitest 绿、typecheck 0、SMOKE_OK(均已本地独立复跑确认)。测试写得扎实:测行为(reconcile 纯函数、迁移 outcome、RPC 等待确认)而非实现细节,边界(N=0/无存档/损坏文件/并发同 id/孤儿外键)大多有专测。

唯一挡在 APPROVE 前的是 **Q1(MAJOR)**:我用确定性复现证明,注册表在「两个并发 mutation + 前一个落盘失败」时,内存回滚了失败条目、但后一个并发写把**含该失败条目的陈旧快照**落了盘;广播出去的是内存快照(不含它),重启却读回它 —— 被回滚的 workspace「复活」。这既违反 `workspaceRegistry.ts` 顶部自述的不变式「广播出去的快照 = 已落盘状态」,也踩 AC-2「退出重启后列表与最后一次成功操作一致」。本 Feature 恰恰是 BL-004 多客户端(= 并发写者)的地基,故这条不是纯理论边角。

其余为 MINOR/NIT 覆盖缺口,不阻塞。verdict 建议 **NEEDS_REVISION**,仅因 Q1;修掉 Q1 即可 APPROVE。

## AC 对照表

| AC | 兑现实现(文件:行) | 覆盖测试 | 结论 |
|----|------------------|---------|------|
| AC-1 迁移 v1→Host 保留原 id / N=0 / 无存档 / 幂等 / 备份 | `workspaceMigration.ts:62` runMigration(逐条 create 保留 id、成功→backupV1→翻 v2);`persistence.ts:26` 驱动;`workspaceRegistry.ts:117` create 幂等 by-id;`appStore.ts:51` 备份 | MIG-001/002/003/004/005/010、REG-002/008、REGR-005、REGR-004(SMOKE) | ✅ 通过(备份内容未断言见 Q2) |
| AC-2 增删改经协议写 Host / 等待确认 / 防重复提交 / 重启一致 | `store.ts:336` addWorkspace、`:366` removeWorkspace、`:404` renameWorkspace(v2 走 RPC + creatingWorkspace/pendingWorkspaceIds 去重);`Sidebar.tsx` 按钮 disabled;`workspaceService.ts:52` handle;`workspaceRegistry.ts:117/142/158` | RPC-001..005、REG-001/004/005/006、INT-004 | ⚠️ 主路径通过;「重启一致」在并发+写失败下被 Q1 打破 |
| AC-3 workspace:changed 全量快照 / 收端按 id 协调(增删存三分支不抢激活) | `workspaceService.ts:40` broadcast(先落盘后广播);`workspaceSync.ts:25` reconcileWorkspaces;`store.ts:432` applyWorkspaceSnapshot;`hostClient.ts:79` onWorkspaceChanged | COORD-001..007/011、INT-001/002 | ✅ 通过(生产粘合层覆盖缺口见 Q3) |
| AC-4 迁移失败→v1 全功能 fallback / 自动重试 / 连续 3 次轻量提示 | `workspaceMigration.ts:96` catch(不翻 v2、计数+1、prompt===3);`store.ts:270` hydrate v1 分支保 name/root;`persistence.ts:64` serialize 双模式;`TransientToast.tsx` | MIG-006/007/008/009/010、REG-009 | ✅ 通过 |
| AC-5 视图态留 UI / v2 去 name/root / 孤儿引用丢弃 | `store.ts:88` PersistedWorkspaceV2(仅 workspaceId 外键);`persistence.ts:81` serialize v2 去 name/root;`store.ts:310` hydrate 孤儿 continue | REGR-001/002/003、COORD-006 | ✅ 通过 |
| AC-6 远端删除→本地释放 tab/PTY + 视图移除 / 活跃则切首个 | `workspaceSync.ts:41` 缺失 id 分支 push tab→disposedTabIds、`:61` 活跃被删切首个;`store.ts:432` applyWorkspaceSnapshot 执行 disposeTerminal | COORD-008/009/010、INT-003 | ✅ 通过 |

## TC 落地核对

TC.md 的 44 条用例(REG-001..009 + 2 附加、RPC-001..005、COORD-001..011、MIG-001..010、INT-001..004、REGR-001..005)**全部有对应实现测试且通过**。逐层核对:

- **分层 1(注册表)**:REG-001..009 全落地,另有 2 条超额附加测试(`test_concurrent_creates_serialize_no_lost_update` 20 并发无丢更新、`test_write_failure_rolls_back_memory` 顺序写失败回滚)。**但这两条附加测试只覆盖「顺序」写失败,未覆盖「并发写 + 前序失败」—— 正是 Q1 的盲区**。
- **分层 2(RPC 语义)**:RPC-001..005 全落地,另有 rename/remove 成功路径 2 条。
- **分层 3(协调算法)**:COORD-001..011 全落地(COORD-010 经 store.applyWorkspaceSnapshot 接线验证副作用)。
- **分层 4(迁移)**:MIG-001..010 全落地。
- **分层 5(集成 harness)**:INT-001..004 落地,采用 TC 分层 5 补充洞察允许的等效 harness(WorkspaceService 真广播 + reconcileWorkspaces 真协调,内存 send 收集器充当端口),**未跨真实 MessagePort、未经 host.ts/hostClient**(见 Q3)。
- **分层 6(回归/SMOKE)**:REGR-001..005 落地;REGR-004 SMOKE 已独立复跑 = SMOKE_OK。

未见遗漏的 TC 用例。TC 与实现一一对应。

## 边界场景清单(已覆盖 / 未覆盖)

**已覆盖**:
- N=0(空 workspaces 数组)迁移 · 无存档全新安装 · version==2 二次启动跳过(MIG-001/002/005)
- 注册表文件损坏(非法 JSON)→ 空表自愈 + 保全 .corrupt(REG-009)
- 并发 create 同一 id → 单条不抛(REG-008)· 20 路并发无丢更新(附加)
- 顺序写失败 → 内存回滚、内存=盘一致(附加 `test_write_failure_rolls_back_memory`)
- 孤儿外键 hydrate 静默丢弃(REGR-002)· 注册表有存档无 → 合成默认视图追加末尾
- 迁移部分失败保 v1 不打标记 + 自动重试 + 重试幂等不重复(MIG-006/008/010)
- RPC 各操作失败列表不变 + 提示 + 入口恢复(RPC-002/004/005)· in-flight 去重(RPC-003)
- 空/非绝对路径输入被注册表拒绝(`rejects invalid input`)
- 远端删除激活/非激活 workspace 的激活态处理(COORD-008/009)· 只剩空表切 null(reconcile 代码路径,无 crash)

**未覆盖(缺口)**:
- 🔴 **并发写 + 前序写失败**:两个并发 mutation,前一个落盘失败回滚内存、后一个成功但写陈旧快照 → 内存/盘分歧(**Q1,已实证**)。附加测试只测顺序写失败,遗漏此并发组合。
- **备份内容正确性**:MIG-004 只断言 backupV1 被调用一次,未断言「备份文件内容 == 迁移前原始 v1 存档」;appStore `store:backup-v1` 无任何测试(Q2)。
- **生产传输粘合层**:host.ts 的 `case 'workspace.*'` dispatch、hostClient `workspace:changed` → applyWorkspaceSnapshot 路由无测试(Q3)。
- **迁移输入畸形**:可解析但 `workspaces` 非数组的 v1 存档未测(Q4,现实不可达但无护栏)。
- **迁移写回竞态**:writeArchive(v2)(debounced storeSet)与 hydrate 后 subscribe 防抖写回的先后无显式测试(代码顺序看是安全的:迁移在 hydrate 前完成、persistMode 决定 serialize 模式一致,未见 bug,仅无专测)。

## Findings(逐条实证)

### Q1 [MAJOR] 并发写 + 前序写失败 → 内存/盘分歧,被回滚的 workspace 重启复活
**文件**:`src/host/workspaceRegistry.ts:180`(enqueueWrite 在入队时同步捕获快照)+ `:134`(create 写失败回滚内存)

**根因**:`enqueueWrite()` 在**入队瞬间**从 `this.workspaces` 捕获 `snapshot`(:181-184)。当两个 mutation 并发:create A 先 push(内存=[a])并入队(snapshot_A=[a]);create B 后 push(内存=[a,b])并入队(**snapshot_B=[a,b]**)。串行队列先跑 A 的写 → 失败 → A 的 catch 回滚内存为 [b] 并抛;队列继续跑 B 的写 → 用 **snapshot_B=[a,b]** 落盘。结果内存=[b] 而盘=[a,b]。`WorkspaceService.broadcast()` 用 `registry.list()`=内存=[b] 广播,但重启读盘=[a,b],被回滚的 a 复活。

**实证**(我加临时 probe 测试确定性复现,已删除):
```
并发 create a(写失败 ENOSPC)+ create b(写成功)
PROBE results:      [ 'rejected', 'fulfilled' ]   // a 抛错、b 成功(符合等待确认:只有 b 是"成功操作")
PROBE memory: [ 'b' ]  disk: [ 'a', 'b' ]         // 内存/盘分歧
PROBE after-restart: [ 'a', 'b' ]                 // 被回滚的 a 复活
```
**违反**:① 模块顶部自述不变式「写失败先回滚内存再抛(保证广播出去的快照 = 已落盘状态)」;② AC-2「退出重启后列表与最后一次成功操作一致」(唯一成功操作是 create b,重启却见 a+b)。

**前提与严重度定标**:需「两个并发 host 写者 + 前序写落盘失败(ENOSPC/EROFS/EACCES)」。本地单窗口下 renderer 串行 await 每个 RPC,host 侧无并发;但多窗口共用一个 host、且本 Feature 就是 BL-004 多客户端的地基,并发写是一等场景。无数据丢失(仅多出一条陈旧条目),故定 MAJOR 而非 BLOCKER。修法方向(供 RD/架构师,不代实现):把快照捕获移到队列续体内部读取当时的 `this.workspaces`(内存恒为同步一致的单源),或让回滚触发一次纠正写,或将「改内存+落盘」作为一个入队单元串行。

### Q2 [MINOR] AC-1 备份内容未被断言;store:backup-v1 零覆盖
**文件**:`src/main/appStore.ts:51`;测试 `src/main/__tests__/workspaceMigration.test.ts:73`(MIG-004)

MIG-004 仅 `expect(backupV1).toHaveBeenCalledTimes(1)`,未验证备份文件内容 == 迁移前 v1 存档(TC 场景原文要求「内容与迁移前的原始 v1 存档一致 且 原文件仍可读」)。真实备份逻辑 `fs.copyFileSync(state.json → state.v1-backup.json)` 在 appStore,该 handler 无任何测试。代码审读顺序正确(create 全成功 → backupV1 → writeArchive(v2),且 storeSet 防抖 500ms,备份时盘上仍是原 v1),未见 bug,但 AC-1「原存档已备份」的实证强度不足。建议补一条 appStore 备份 handler 的单测(含内容比对与原文件保留)。

### Q3 [MINOR] 生产传输粘合层未覆盖
**文件**:`src/host/host.ts:257`(`case 'workspace.*': result = await workspaces.handle(...)`)、`src/renderer/services/hostClient.ts:223`(`case 'workspace:changed'` → workspaceListeners)、`src/renderer/state/persistence.ts:52`(onWorkspaceChanged → applyWorkspaceSnapshot)

INT-001..004 直接实例化 `WorkspaceService` + `reconcileWorkspaces` 手工接线,绕过了 host.ts 的 handleRpc dispatch 与 hostClient 的 message 路由。即「RPC 名 → service.handle」与「workspace:changed → applyWorkspaceSnapshot」这两段生产胶水无自动化验证,仅靠 SMOKE 间接过一次启动(且 SMOKE 未断言 Sidebar 列表来源可追溯到注册表 —— REGR-004 场景的第二条 And 未落地)。TC 分层 5 补充洞察显式允许等效 harness,故记 MINOR 覆盖缺口,非缺陷。

### Q4 [MINOR] 迁移输入健壮性:畸形 v1 存档二次崩溃
**文件**:`src/renderer/state/workspaceMigration.ts:88`(`for (const w of v1.workspaces)`)

若 storeGet 返回可解析但畸形的对象(如 `{version:1}` 无 workspaces 数组),迁移循环 `for...of undefined` 抛 TypeError → 落 catch 计为迁移失败 → writeArchive(`{...v1, version:1}` 仍无 workspaces)→ hydrate v1 分支 `archive.workspaces.map`(store.ts:294)再次崩溃,形成启动崩溃循环(比「v1 全功能 fallback」更糟)。**现实不可达**:appStore.storeGet 对不可解析 JSON 返回 null(:36),且本应用从不写出无 workspaces 数组的存档;故低风险。建议 runMigration 入口对 `Array.isArray(v1.workspaces)` 做一次防御(非数组→按空迁移或按 fresh 处理),与 REG-009 注册表自愈同一护栏理念。

### Q5 [NIT] TDD 先后顺序不可验证
变更集为单个 squash commit(c53ec30),无法从 git 提交顺序确认「测试先于实现」(TC.md TDD 检查首项)。测试质量本身足以支撑该 checklist 的其余项(独立可跑、命名符合 Scenario、边界/异常覆盖),仅提交历史维度不可查证。

### Q6 [NIT] 幂等 create 仍广播
**文件**:`src/host/workspaceService.ts:57`

`workspace.create` 命中既有 id 时 registry 返回既有(不写盘),但 `handle` 仍无条件 `this.broadcast()`。迁移重试 / 回声场景下会产生 N 次无变更的全量快照广播(若有第二客户端连接则 O(N) 冗余推送)。本地单窗口无影响(迁移期 renderer 尚未 onWorkspaceChanged 订阅),收端协调对已存在 id 亦为幂等 no-op(COORD-011 已锁),故无正确性问题,纯效率 NIT。
