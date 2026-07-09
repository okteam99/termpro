---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "localconfig disable_external_review=true(单模型 · 异质评审降级为同模型 exec 自审 · 已 startup WARN)"
review_via: subagent
verify_fixes: true
target_commit: ea5ddf3ed406bea7142c01132b6eeb50338815fe
perspective: "external-claude (degraded · same-model subagent self-review · verify round)"
target: code
round: verify
prev_commit: c53ec30ffb2bece70e07af3ebf9e5f246c5bd57f
fix_commit: ea5ddf3ed406bea7142c01132b6eeb50338815fe
generated_at: "2026-07-10T04:42:00Z"
model: "claude-opus-4-8"
gate_independently_reverified:
  typecheck: "pass (tsc --noEmit, 0 err)"
  tests: "pass (persistence.test.ts + workspaceRegistry.test.ts · 17/17 绿)"
files_read:
  - "docs/features/.../external-cross-review/review-claude-subagent-degraded.md (上轮 6 findings)"
  - "git show ea5ddf3 (修复 diff 全量)"
  - "src/renderer/state/persistence.ts"
  - "src/renderer/state/workspaceMigration.ts"
  - "src/host/workspaceRegistry.ts"
  - "src/host/workspaceService.ts"
  - "src/renderer/state/__tests__/persistence.test.ts"
  - "src/host/__tests__/workspaceRegistry.test.ts"
verdicts:
  - id: CR-1
    prev_severity: high
    verdict: fixed
    evidence: "persistence.ts:44,57-66,81-104"
  - id: CR-2
    prev_severity: low
    verdict: fixed
    evidence: "workspaceRegistry.ts:124-159,163-178,181-202,217-224"
  - id: CR-3
    prev_severity: low
    verdict: fixed
    evidence: "workspaceRegistry.ts:129-147"
  - id: CR-4
    prev_severity: low
    verdict: not-fixed
    reason: "out-of-scope(仅修 F1/F2/F3);service 仍无条件广播"
    evidence: "workspaceService.ts:57-77"
  - id: CR-5
    prev_severity: low
    verdict: not-fixed
    reason: "out-of-scope;workspaceMigration.ts 未被本次 diff 触及"
    evidence: "workspaceMigration.ts:88-89,96-113"
  - id: CR-6
    prev_severity: info
    verdict: not-fixed
    reason: "out-of-scope;service 边界仍 params as 强转无运行时校验"
    evidence: "workspaceService.ts:58,64,70"
new_findings:
  - id: NV-1
    checklist: C6
    severity: low
    location: "src/renderer/state/persistence.ts:57-63,70-78"
    issue: "F1 有限重试耗尽(5 次)后 scheduleRegistryRetry 静默停止调度,但最后设置的 transientNotice 仍是「无法读取 Workspace 注册表,正在重试…」,提示与实际状态不符(已停止重试),此后恢复需用户手动 ⌘R。"
    rationale: "scheduleRegistryRetry(L71)`if(registryRetries>=MAX)return` 到顶即静默返回,不改提示、不给『已放弃/请重载』终态。用户界面永久停在『正在重试…』占位但后台并无重试。数据安全达成(不 hydrate 成空、不落盘空态),仅 UX 措辞不准 + 无自动兜底。"
    suggestion: "重试耗尽时把提示改为终态文案(如『无法连接 Host,请 ⌘R 重载窗口重试』),或提供一个可见的手动重试入口。"
findings_summary:
  verified_fixed: 3
  verified_not_fixed: 3
  not_fixed_all_out_of_scope: true
  new_blocker: 0
  new_high: 0
  new_low: 1
  new_info: 0
  regression_introduced_by_fix: false
---

# 验证轮 — 逐条裁决 + 修复 diff 回归

范围锁定:逐条裁决上轮 6 条 finding(fixed/not-fixed)+ 仅回归审查修复 diff(`ea5ddf3`,相对 `c53ec30`)自身引入的新问题。未做全量重扫。修复 commit 自述对应 F1=CR-1 / F2=CR-2 / F3=CR-3。独立复核门禁:`tsc` 0 err、受影响两测试文件 17/17 绿。

## 逐条裁决

### CR-1(high, C2)→ FIXED
hydrate 期 `workspace.list` 失败不再被当作注册表真空。`persistence.ts:44` 把 `registry` 从 `[]` 改为 `WorkspaceEntry[] | null`,`null` 显式表示「读失败」。`persistence.ts:57-63`:`outcome.mode==='v2' && registry===null` 时**不** `hydrate`、**不**订阅写回、给占位提示并 `scheduleRegistryRetry()` 后 `return`。写回订阅被下沉进 `finishHydrate()`(`persistence.ts:81-104`),只在成功路径启动 —— 这精确切断了上轮的破坏链(空 registry→v2 孤儿全丢→防抖 serialize 落盘空态)。v1 fallback 分支不进该条件,`list` 失败无害照常 hydrate(与既有语义一致)。3 条新回归测试(`persistence.test.ts:70/92/129`)覆盖:失败不丢存档且不落盘空态、重试恢复且存档引用不丢、v1 不受影响 —— 我已独立跑绿。裁决:**fixed**。

### CR-2(low, C3)→ FIXED
并发写 + 前序写失败回滚不再复活被回滚条目。改法采纳「整条 mutation 原子串行」方向:`create/remove/update` 全体包进 `enqueue(op)`(`workspaceRegistry.ts:124/164/182`),`op` 内才做 校验+改内存+`atomicWrite(this.snapshot())`+失败回滚;`snapshot()`(L205-210)在队列内、改内存之后取,恒与将广播的内存一致。`enqueue`(L217-224)以 `mutationQueue.then(op,op)` 串行、队尾吞错。旧「同步改内存 + 只串行化写盘 + 入队时捕获快照」的时点差破口(后序写落盘含被回滚条目的陈旧快照)已消除。新回归测试(`workspaceRegistry.test.ts` F2 用例:首写 ENOSPC 失败并发,断言 memory=盘=重启后均只含 b、被回滚的 a 不复活)在旧实现下必失败、现绿。裁决:**fixed**。

### CR-3(low, C1)→ FIXED
`create` 由 insert-if-absent 改为真 upsert:`workspaceRegistry.ts:129-147` 命中既有 id 时,字段一致→幂等 no-op 不写盘;字段不同→更新内存并 `atomicWrite`。partial 迁移 + fallback 期改名场景下次迁移重跑会真正落更新。头注释/JSDoc(L4-12、L117-121)已同步纠正措辞。新回归测试(`workspaceRegistry.test.ts` F3 用例:改字段落盘+重启保留、同字段不再写盘)绿。裁决:**fixed**。

### CR-4(low, C1)→ NOT-FIXED(超出本次修复范围)
`workspaceService.ts:57-77` 未改:`remove`/`update` 仍无条件 `broadcast()`,且 create 幂等 no-op 路径(字段一致返回既有、注册表内存未变)service 仍照样广播全量快照。registry 各 mutation 未返回「是否真变更」信号,service 无从条件化。终态仍正确,多余 cross-client churn 依旧。本次 commit 明示只修 F1/F2/F3,未认领 CR-4,属遗留而非回归。

### CR-5(low, C3)→ NOT-FIXED(超出本次修复范围)
`workspaceMigration.ts` 未被本次 diff 触及(`git show --stat` 无该文件)。`workspaceMigration.ts:88-89` 逐条 `await createWorkspace` 首个 throw 即 `catch`(L96-113)保持 v1;单条畸形 v1 条目(空 name / 非绝对 root)仍确定性抛校验错→整迁移永久卡 v1、每次启动同条再失败、无跳过/降级/坏条目上报。未认领,遗留。

### CR-6(info, C2)→ NOT-FIXED(超出本次修复范围)
`workspaceService.ts:58/64/70` 仍 `params as {...}` 强转,无运行时形状校验。附带说明:F2 重构后 `validName/validRoot` 移入队列内 `op`,畸形 create 现以 rejected promise 抛出(且队尾吞错不会 wedge 后续 mutation),但仍是非结构化原始错误,非 CR-6 期望的边界结构化校验。未认领,遗留。

## 修复 diff 引入的新问题(回归审查)

### NV-1(low, C6)— 重试耗尽后提示停在「正在重试…」终态不实
见 frontmatter。这是 F1 新增重试逻辑自身引入的 UX 瑕疵:`scheduleRegistryRetry`(`persistence.ts:70-78`)到 5 次上限即静默 `return`,末次提示(`persistence.ts:60`「…正在重试…」)不被更新,而后台已停重试,恢复须手动 ⌘R。数据安全目标达成(不丢存档、不落盘空态),仅提示措辞与「无自动兜底终态」偏弱。非阻断。

## 已考量并排除(非新问题)

- **内存改动由「调用时同步」变为「队列内延迟」**:并发的 `workspace.list` RPC 可能读不到尚未出队执行的 pending create(旧实现同步改内存则读得到)。但 `service.handle` 对每条 mutation 先 `await` 再 `broadcast`(`workspaceService.ts:59-60/65-66/71-75`),`list` 是时点快照,客户端随后必收广播 —— 属可接受的最终一致,无契约破坏。乐观可见窗口反而收窄(仅落盘期,不含入队等待期),严格更优。
- **重试路径重跑 `runMigration` 的幂等性**:重试仅在 `mode==='v2'` 触发,此时存档必已是 v2(`workspaceMigration.ts:73-80` 对 v2 立即 no-op 返回,无 create/backup/writeArchive 副作用),故多次重试不会重复触发迁移写。安全。
- **host 零 Electron 红线**:diff 未引入任何 Electron import(`workspaceRegistry.ts` 仍仅 `node:fs/path/crypto`)。合规。

## 结论

上轮认领的 3 条(CR-1 high、CR-2/CR-3 low)全部 **fixed** 且各配可回归的新测试(旧实现下会失败),门禁已独立复核三绿。其余 3 条(CR-4/CR-5/CR-6)**not-fixed 但均属本次未认领的遗留 low/info,非回归**。修复 diff 仅引入 1 条新 low(NV-1 提示终态),无 blocker/high、无破坏性回归。建议:CR-1 已闭环可放行;CR-4/CR-5/CR-6 + NV-1 作为后续低优先项跟踪。
