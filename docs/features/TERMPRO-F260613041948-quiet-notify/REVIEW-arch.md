---
role: architect
review_scope: code-review
verdict: APPROVE
files_read:
  - docs/features/TERMPRO-F260613041948-quiet-notify/PRD.md
  - docs/features/TERMPRO-F260613041948-quiet-notify/TC.md
  - docs/features/TERMPRO-F260613041948-quiet-notify/PRD-REVIEW.md
  - src/renderer/services/quietGate.ts
  - src/renderer/services/sessionEvents.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/renderer/services/__tests__/quietNotify.test.ts
  - src/renderer/state/store.ts
review_commit: 21f6119
verdict_decided_at: "2026-06-13T05:05:00Z"
gates: { typecheck: pass, vitest: "113 pass", smoke: "n/a (read-only review)" }
---

# REVIEW-arch — 离开后有新增再停住才提示「可能在等输入」(commit 21f6119)

> 独立架构评审 · 简洁性 counter-lens。整体结论:**实现忠实落地 PRD 判据,职责分层正确,无过度设计,无阻断性缺陷 → APPROVE**。下列 findings 均为 advisory(C3/C4/C5),提请记录、不阻断合入。

## §Findings

### ARCH-C1 — 判据正确性:忠实落地,且 strict `>` 选了安全方向 — INFO(no action)
`quietGate.ts:38-43` `hadOutputSinceLeave` = `deactivatedAt` 存在且 `lastOutputAt > deactivatedAt`。
- 完整复刻 ARCH-1 修订意图:两个时间戳同源 renderer 时钟(`recordOutput`/`recordDeactivated` 均 `Date.now()`,quietGate.ts:19,24),与 host tick 抖动/IPC 延迟/跨进程时钟解耦。✓
- `deactivatedAt === undefined → false`(从未激活)正确覆盖 AC-1 「含从未被激活过」。✓
- 输出与去激活同毫秒的并发竞态:strict `>` 使其判 false(抑制),偏向「不误报」的安全侧。✓ 这是正确取舍,值得点名。
- `decideQuietAction`(quietGate.ts:66-74)分支顺序 `focusedTab||!running` → `isCurrentTab` → 后台 gating,与原 `sessionEvents.ts` quiet 行为逐条等价:**唯一新增** = 后台 `!hadOutputSinceLeave` 时不标 waiting/不通知(AC-1 抑制)。current/focused 路径 0 变更(AC-3)。✓

### ARCH-C2 — 激活态追踪:5 个关键场景逐一成立 — INFO(no action)
`sessionEvents.ts:171-180` 用 `prevActiveTabId` 闭包追踪「激活工作区的激活 tab」变化。逐场景核对:
- ① 初始 `prevActiveTabId=null` → `if(prevActiveTabId)` 守卫使首帧不误记 deactivated,仅 `resetTabActivity(cur)`。✓(不误记)
- ② 切 workspace(W1/T1 → W2/T2):subscribe 重算 `cur=W2.activeTabId`,`T2!==T1` → `recordDeactivated(T1)`+`resetTabActivity(T2)`。离开的 T1 正确去激活、回看的 T2 正确重置基线。✓
- ③ subscribe 每次 store 变更都跑:`curActiveTabId !== prevActiveTabId` 守卫使「active tab 未变」时整块跳过 record,无重复写、无每帧抖动。✓
- ④ 同源时钟:record* 全 `Date.now()`。✓
- 关 active tab(`closeTab`):`recordDeactivated(已关 T1)` 会写一条死记录,但**同一 subscribe 回调内** `pruneClosedTabs(liveTabs)`(:195)随即删除(T1 不在 liveTabs)→ 当帧自愈、无泄漏。✓ prune 放在 prev/cur 块之后是对的。

### ARCH-C3(severity: low · category: correctness/spec-boundary)— 跨 session / 非激活工作区启动态 tab 视为「从未激活」
`sessionEvents.ts:172` 的 `cur` 只取**激活工作区**的激活 tab;`prevActiveTabId` 从不为「非激活工作区的激活 tab」写入 `deactivatedAt`。
- 后果:启动时位于后台工作区的 tab(上个 session 用户最后在看的)在本 session 被判 `deactivatedAt===undefined → hadOutputSinceLeave=false`,即使它去激活后产出新输出也会被抑制,直到用户首次切到它再切走才建立基线。
- 判定:**符合 PRD AC-1**(「含从未被激活过 → 不提示」)+ 内存 Map 每次启动清零的会话边界语义,属 by-design。仅作语义边界登记,不需修。建议:无(若未来想跨 session 记忆「上次在看的 tab」再议,超出本 feature 范围)。

### ARCH-C4(severity: low · category: simplicity)— `resetTabActivity` 与 `pruneClosedTabs` 是否过度?— 结论:都必要,保留
counter-lens 自检两处「能否更简」:
- `resetTabActivity`(回看时 `delete` 双键):**必要**。AC-4 要求重新激活后「仅旧 lastOutput 满足时间条件不触发」。若只靠 `recordDeactivated` 覆盖写、不清 `lastOutputAt`,则重新激活→再切走时,旧的 `lastOutputAt`(> 新 deactivatedAt 之前的)虽不会误判(strict `>` 比新 deactivatedAt),但用户「回看」语义上 lastOutputAt 应清零作基线。单测 T-005 正是锁这条(reset 后 `recordOutput(200)` 不触发,须 `recordDeactivated(250)` 后 `recordOutput(300)` 才 true)。删了它 T-005 的「resetTabActivity → false」断言即破。保留。
- `pruneClosedTabs`:**必要且廉价**。两个 Map 与 `lastExit`/`waitingNotified` 同级,均靠 subscribe 末尾按 liveTabs 清理。不清则关 tab 后 Map 条目永驻(慢泄漏,且 tabId 不复用)。与既有清理范式一致,职责对齐。保留。
- 二者均无更简且不易错的替代;实现已是最小集。

### ARCH-C5(severity: low · category: simplicity/style · advisory)— `decideQuietAction` 已是纯函数,`recordDeactivated` 死记录可省一次写但不值得
`sessionEvents.ts:177` 在 active tab 变化时无条件 `recordDeactivated(prevActiveTabId)`,包含「prev 刚被 close」的情形(见 C2 末)。理论上可加 `liveTabs.has(prev)` 守卫省掉这次写,但:liveTabs 在该行尚未构建(在 :182 之后),且 prune 当帧兜底已使其无害 → 加守卫反而要前移 liveTabs 计算、增复杂度。**保持现状更简单**。advisory only。

## §简洁性评估(counter-lens 主结论)

- **职责分层正确**:纯逻辑(时间戳记账 + `decideQuietAction` 策略)落 `quietGate.ts`,无 DOM/store 依赖、可单测;接线(从 store 取 focused/current/running/激活变化、调 store.updateTab/pushNotification)留 `sessionEvents.ts`;输出打点落 `terminalRegistry.ts` onData。三层边界干净,与文件头既有注释「在不在看/要不要打扰是 UI 决策」一致。
- **未越界**:协议/host 零改动,未让 host 感知 tab 激活态(PRD Out-of-Scope + ARCH-4 红线)。✓
- **无过度设计**:新增 4 个导出函数 + 2 个 Map + 1 个纯决策函数,全部被实际接线消费(grep 确认无 dead export,`__resetAllForTest` 仅测试用)。`QuietDecisionInput`/`QuietDecision` 两个小接口提升了可测性与可读性,不算膨胀。
- **未漏接线**:`recordOutput` 落在 `attachPty.onData`(terminalRegistry.ts:132)。架构上 terminal 实例以 tabId 为键跨 React 挂载存活(registry.ts 文件头)、ptyListener 在 spawn 时常驻,后台 tab 的 onData 不随挂载卸载而停 → 后台输出不会漏记。✓(review 重点 3 确认)

## §回归风险评估

- **done / bell / notify 三分支**:未触碰(diff 仅改 `case 'quiet'` 与 subscribe 尾部),语义不变。✓
- **`waitingNotified` 闩锁**:语义保持 —— 后台首次有效 quiet `add(tabId)`,重复 quiet 走 `alreadyNotified` 不重复推;回看经 `clearAttention` 复位。新代码 `if(action.pushNotification){ waitingNotified.add(...) }` 与原 `if(!waitingNotified.has){ add; push }` 等价(decideQuietAction 已把 `!alreadyNotified` 编入 pushNotification)。✓
- **Map 泄漏 / 竞态**:`lastOutputAt`/`deactivatedAt` 经 `pruneClosedTabs` 按 liveTabs 清理,无泄漏;close-active-tab 死记录当帧自愈(C2)。output(IPC 异步)vs deactivate(subscribe 同步)跨源,靠同源 `Date.now()` + strict `>` 安全收敛(C1)。无发现竞态缺陷。✓
- **门禁**:`tsc --noEmit` 通过;`vitest run` 113 passed(含本 feature 11 单测,覆盖 AC-1..AC-5 + 闩锁 + 非 running)。✓

## §Verdict 理由

判据(`lastOutputAt > deactivatedAt`、同源时钟、弃时间差推断)忠实落地 ARCH-1 修订;激活态追踪在初始/切 workspace/切 tab/关 tab 四类转移上均正确,close-active-tab 死记录有同帧 prune 兜底;onData 打点位置在架构上保证后台输出不漏记;done/bell/notify 与闩锁语义零回归;无过度设计、分层职责正确、无 Map 泄漏。所有 findings 为 low/advisory(C3 跨 session 语义边界 by-design,C4/C5 简洁性自检结论均「保留现状」)。无 P1/P2 阻断项 → **APPROVE**。
