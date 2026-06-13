---
role: qa
review_scope: code-review
verdict: APPROVE
files_read:
  - docs/features/TERMPRO-F260613041948-quiet-notify/PRD.md
  - docs/features/TERMPRO-F260613041948-quiet-notify/TC.md
  - src/renderer/services/quietGate.ts
  - src/renderer/services/sessionEvents.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/renderer/services/__tests__/quietNotify.test.ts
---

# QA Code Review — TERMPRO-F260613041948-quiet-notify

commit: 21f6119

---

## § AC 对照表

### AC-1 — 后台 tab 去激活后无新输出(含从未激活)→ 不提示(P0)

| 维度 | 落地情况 |
|------|---------|
| 核心判据 | `hadOutputSinceLeave()` 在 `deactivatedAt === undefined` 时返回 `false`(quietGate.ts:38-43)。无 deactivatedAt = 从未激活,直接抑制。 |
| 有 deactivatedAt 但无新输出 | `lastOutputAt <= deactivatedAt` 时 `o > d` 不成立,返回 `false`(quietGate.ts:42)。 |
| sessionEvents 接线 | `decideQuietAction({ hadOutputSinceLeave: false })` → `{ setWaiting: false, pushNotification: false }`,两个副作用都不触发(sessionEvents.ts:134-150)。 |
| 测试覆盖 | T-001(hadOutputSinceLeave 纯函数:离开前输出 → false)、T-002(从未激活 → false)、decideQuietAction T-001(后台+无离开后输出 → 双 false)。 |

**✅ AC-1 落地完整。**

---

### AC-2 — 后台 tab 去激活后有新输出再停住 → 提示一次(P0)

| 维度 | 落地情况 |
|------|---------|
| 判据 | `lastOutputAt > deactivatedAt` → `hadOutputSinceLeave()` 返回 `true`(quietGate.ts:42)。 |
| setWaiting | `decideQuietAction` 后台路径返回 `setWaiting: true`,sessionEvents.ts:141 调用 `s.updateTab(tabId, { waiting: true })`。 |
| 进通知中心(不发系统通知) | `pushNotification: true` → `s.pushNotification(...)` 调用(sessionEvents.ts:142-149)。注意:整个 `quiet` case 中**不调用 `osNotify`**,系统通知天然不触发——与旧代码一致,AC-2 "不发系统通知"已满足。 |
| 一次性闩锁 | `waitingNotified.add(tabId)` 后 `alreadyNotified: true` → 下次 `decideQuietAction` 返回 `pushNotification: false`(quietGate.ts:73)。 |
| 测试覆盖 | T-003 hadOutputSinceLeave 纯函数(离开后有输出 → true)、decideQuietAction T-003(后台+有输出 → 双 true)、decideQuietAction 闩锁(已通知 → waiting true / notify false)。 |

**缺口(可接受,见 QA-C1):** 无 sessionEvents 级集成测试直接断言「`s.pushNotification` 被调用、`osNotify` 未被调用」。现有测试只验证纯函数返回值,接线正确性靠代码阅读确认。整体属 P2 测试债,不阻 approve。

**✅ AC-2 核心落地完整;测试覆盖至纯函数层,接线正确性已通过代码阅读验证。**

---

### AC-3 — 当前/聚焦 tab 行为不变(P1)

| 维度 | 落地情况 |
|------|---------|
| 聚焦 tab | `i.focusedTab || !i.running` 短路 → `{ false, false }`(quietGate.ts:68),不打扰。 |
| 失焦但仍当前 tab | `i.isCurrentTab` 分支 → `{ setWaiting: true, pushNotification: false }`(quietGate.ts:70);只亮状态点,不进通知,和旧逻辑等价。 |
| 新增 gating 不影响当前 tab | `isCurrentTab` 分支在 `hadOutputSinceLeave` 检查之前短路,不受影响(quietGate.ts:69-70)。 |
| 测试覆盖 | T-004(两个 it):聚焦+当前 → 双 false;失焦+当前 → waiting true / notify false。 |

**✅ AC-3 落地完整。**

---

### AC-4 — 重新激活/新输出 → 清除+重置基线,须再次「有新增→停住」才提示(P1)

| 维度 | 落地情况 |
|------|---------|
| 基线重置函数 | `resetTabActivity(tabId)` 删除 lastOutputAt + deactivatedAt(quietGate.ts:30-33)。 |
| 重新激活触发点 | `useAppStore.subscribe` 检测 `curActiveTabId !== prevActiveTabId` → `resetTabActivity(curActiveTabId)`(sessionEvents.ts:178)。 |
| waiting 态清除 | 旧逻辑 `quiet:false → s.updateTab({ waiting: false })`(sessionEvents.ts:151-153)保持不变。`waitingNotified` 在 `clearAttention()`(用户回看)时清除(sessionEvents.ts:31-38),激活 tab 切换后下一轮 subscribe 触发 `clearAttention`(sessionEvents.ts:173)会清对应 tab 的 waitingNotified —— 但这里有一个微妙点:clearAttention 清的是**当前激活 tab**,即 curActiveTabId,不是 prevActiveTabId。所以用户切回那个 tab(它成为新 curActiveTabId)后,clearAttention 会在下一个 subscribe 触发时清除该 tab 的 waitingNotified。顺序正确。 |
| 测试覆盖 | T-005 逐步验证:reset 后 false → 只有输出无去激活 → false → 再去激活后输出 → true。 |

**✅ AC-4 落地完整。**

---

### AC-5 — 多次切走取最近一次去激活时刻(P1)

| 维度 | 落地情况 |
|------|---------|
| 覆盖写 | `recordDeactivated` 直接 `deactivatedAt.set(tabId, now)` 覆盖写(quietGate.ts:24-26)。 |
| sessionEvents 触发点 | 每次 `curActiveTabId !== prevActiveTabId` 时对旧 tab 调用 `recordDeactivated`(sessionEvents.ts:177);多次切回切走会多次更新 deactivatedAt。 |
| 测试覆盖 | T-006:第一次离开后有输出 150 → 再次离开(deactivatedAt=200)→ 150<200 = false → 再次输出 250 > 200 = true。 |

**✅ AC-5 落地完整。**

---

## § 边界 findings

### QA-C1 — AC-2「不发系统通知 / 进通知中心」缺 sessionEvents 集成测试 [P2 · 可接受]

纯函数层验证了 `pushNotification: true` 的布尔返回值,但无测试直接 mock `s.pushNotification` / `osNotify` 来断言「调用了前者、未调用后者」。
当前正确性通过代码阅读确认:quiet case 中从未有 `osNotify` 调用(sessionEvents.ts:130-154)。
**风险**:若后续有人在 quiet 分支加 osNotify 调用,无测试会拦截。
**建议**:在后续 test stage 或技术债批次中补 sessionEvents 集成测试(mock store + hostClient event)。**不阻本次交付**。

---

### QA-C2 — `quiet:false` 清除后再收 `quiet:true` 的闩锁交互 [P2 · 可接受]

场景:tab 后台 running → quiet:true 触发提示(waitingNotified+)→ quiet:false 清 waiting → 再次 quiet:true(输出又停了)。
此时 waitingNotified 未被清除(clearAttention 要求用户回看 focusedTab);若 deactivatedAt 和 lastOutputAt 仍满足 hadOutputSinceLeave,decideQuietAction 会因 `alreadyNotified: true` 返回 `pushNotification: false`,只亮 waiting 不重复通知——行为符合「每注意力周期只通知一次」的设计原则(sessionEvents.ts 注释明确)。无测试覆盖该路径。
**建议**:可接受;若有 P2 时间补一条 decideQuietAction 单测:alreadyNotified=true + hadOutputSinceLeave=true → waiting:true, notify:false。**不阻本次交付**。

---

### QA-C3 — 窗口切换工作区时 prevActiveTabId 的跨工作区行为 [P3 · 可接受]

`prevActiveTabId` 只追踪 `activeWorkspace.activeTabId`(sessionEvents.ts:174-175)。用户切换工作区时,curActiveTabId 从旧工作区的 tab 变为新工作区的 tab,`recordDeactivated(prevActiveTabId)` 对旧工作区的 tab 记录。这是预期行为——旧工作区激活 tab 切到后台语义与切 tab 等价。不是 bug,PRD Out of Scope 也未要求跨工作区特殊处理。

---

### QA-C4 — `pruneClosedTabs` 调用时机:tab 关闭后 Map 清理延迟一个 store tick [P3 · 可接受]

tab 关闭 → store 更新 → subscribe 触发 → pruneClosedTabs(liveTabs) 清理。在这一 tick 之前若正好来一个 quiet:true,findTabBySessionId 已找不到 tabId(sessionId 已断),sessionEvents.ts:45-50 的 guard 会直接 return,不会误访问 Map。无实际影响。

---

### QA-C5 — `recordOutput` 前后台 tab 均触发;当前 tab 产出输出也会更新 lastOutputAt [信息,无问题]

当前 tab 的 lastOutputAt 也在被记录(terminalRegistry.ts:132)。当用户把当前 tab 切走后,其 lastOutputAt 是切走前最后一次输出时刻。此后若再切回,resetTabActivity 清空记录,下一轮需重新「去激活后有输出」。逻辑正确,与 AC-4 / AC-5 一致。

---

### QA-C6 — 验收口径:「等 ≤65s」与实现一致性 [✅ 通过]

PRD 说明 host tick 约 1.5s,实际提示窗口 60~61.5s,手动验收 ≤65s 视为通过。实现未改 QUIET_MS,host tick 策略不变,验收口径与实现一致。

---

## § Verdict

**APPROVE**

实现完整落地 AC-1..AC-5。核心判据(同源时钟 lastOutputAt>deactivatedAt)架构合理,规避了时间差推断的不健壮性(ARCH-1)。11 条单测覆盖所有 AC 的纯函数语义,接线正确性已代码阅读验证。

发现 2 条 P2 测试债(QA-C1 sessionEvents 集成测试缺口;QA-C2 quiet:false→quiet:true 闩锁场景未测),均不影响当前正确性,建议后续补测。无 P0/P1 缺口。
