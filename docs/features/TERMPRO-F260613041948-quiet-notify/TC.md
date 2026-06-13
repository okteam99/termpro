---
feature_id: "TERMPRO-F260613041948-quiet-notify"
status: draft
tests:
  - id: T-001
    file: src/renderer/services/__tests__/quietNotify.test.ts
    function: AC1_background_no_output_since_leave_does_not_notify
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-002
    file: src/renderer/services/__tests__/quietNotify.test.ts
    function: AC1_never_activated_tab_no_deactivatedAt_does_not_notify
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-003
    file: src/renderer/services/__tests__/quietNotify.test.ts
    function: AC2_output_after_leave_then_quiet_notifies_in_center_no_system
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-004
    file: src/renderer/services/__tests__/quietNotify.test.ts
    function: AC3_focused_and_current_tab_behavior_unchanged
    covers_ac: ["AC-3"]
    level: unit
    priority: P1
  - id: T-005
    file: src/renderer/services/__tests__/quietNotify.test.ts
    function: AC4_clear_and_reset_baseline_on_reactivate_or_new_output
    covers_ac: ["AC-4"]
    level: unit
    priority: P1
  - id: T-006
    file: src/renderer/services/__tests__/quietNotify.test.ts
    function: AC5_multiple_toggles_use_latest_deactivatedAt
    covers_ac: ["AC-5"]
    level: unit
    priority: P1
---

# 通知逻辑优化(离开后有新增再停住才提示)- 测试用例

## 状态
草稿

---

## Feature: 离开后有新增再停住才提示「可能在等输入」

作为同时盯多个并行会话的开发者
我希望「可能在等输入」提示只在离开后有活动再停住时出现
以便通知中心不被「离开后啥也没干」的后台 tab 噪音淹没

---

## 需求覆盖矩阵

> 反查 PRD.md `acceptance_criteria[]`,每条 AC ≥1 test。

| AC ID | 需求描述 | 优先级 | 覆盖测试 | 状态 |
|-------|---------|--------|---------|------|
| AC-1 | 离开后无新输出(含从未激活)静默>1min → 不提示 | P0 | T-001, T-002 | ✅ |
| AC-2 | 离开后有新输出再停住>1min → 提示一次(通知中心,无系统通知) | P0 | T-003 | ✅ |
| AC-3 | 当前(激活)tab 打扰行为不变 | P1 | T-004 | ✅ |
| AC-4 | 重新激活/新输出 → 清除+重置基线,须再次「有新增→停住」 | P1 | T-005 | ✅ |
| AC-5 | 多次切走取最近一次去激活时刻为基准 | P1 | T-006 | ✅ |

覆盖率: 5 / 5 (100%)

> 📎 测试层级说明:本次改动在渲染层(`sessionEvents` 对 `quiet:true` 的 gating + per-tab `lastOutputAt`/`deactivatedAt`),用 **renderer 单测**驱动(注入可控 `now()` / 模拟事件序列),不依赖真实 60s 等待。host 侧 `sessionTracker` quiet 触发逻辑不变,现有 host 单测保持。

---

## 测试场景

### Scenario: TC-001 离开后无新输出 → 不提示(AC-1)
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一个非当前(后台)tab 的会话处于 running
  And 该 tab 已被切走(deactivatedAt 已记录)
  And 自 deactivatedAt 之后没有任何新终端输出(lastOutputAt ≤ deactivatedAt)
When 收到该会话的 quiet:true 事件
Then 不调用通知(不进通知中心)
  And 不设置该 tab 的 waiting 注意力标记
```

---

### Scenario: TC-002 从未激活过的 tab → 不提示(AC-1)
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 一个后台 tab 的会话 running,但该 tab 从未被激活过(deactivatedAt 为 undefined/null)
When 收到 quiet:true 事件
Then 不提示(等价于「离开后无新输出」)
  And 不设置 waiting 标记
```

---

### Scenario: TC-003 离开后有新输出再停住 → 提示一次(AC-2)
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一个后台 tab 的会话 running 且已被切走(deactivatedAt 已记录)
  And 在 deactivatedAt 之后有过新终端输出(lastOutputAt > deactivatedAt)
When 收到 quiet:true 事件
Then 设置该 tab 的 waiting 标记并进入通知中心
  And 不触发系统通知(沿用 quiet 仅应用内策略)
  And 同一注意力周期内重复 quiet:true 不再重复通知(waitingNotified 闩锁)
```

---

### Scenario: TC-004 当前 tab 行为不变(AC-3)
**优先级**: P1 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 目标 tab 是当前激活 tab
When 收到 quiet:true 事件
Then 行为与改动前一致:
  And 窗口聚焦时(focusedTab)不打扰、不通知
  And 窗口失焦但仍是当前 tab(isCurrentTab)沿用现有豁免(不进通知中心、不发系统通知)
  And 新增的 lastOutputAt>deactivatedAt gating 不改变当前 tab 这条路径
```

---

### Scenario: TC-005 清除并重置基线(AC-4)
**优先级**: P1 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一个后台 tab 已因「离开后有输出→停住」触发过 waiting 提示
When 该 tab 又产生新输出(quiet:false)或被重新激活
Then 清除 waiting/waitingNotified(沿用现有 quiet:false / clearAttention)
  And 重置该 tab 的 deactivatedAt / lastOutputAt 基线
  And 此后仅当再次「去激活后有新增输出 → 停住」才会再次提示
  And 重新激活后仅凭旧 lastOutput 满足时间条件不触发提示
```

---

### Scenario: TC-006 多次切换取最近去激活时刻(AC-5)
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 一个 tab 在静默窗口期间被切回再切走多次
When 评估「离开后是否有新输出」
Then 以最近一次去激活时刻(deactivatedAt 取最新)为基准
  And 仅当最近一次去激活之后有新输出才在 quiet:true 时提示
```

---

## E2E 端到端验收

### API E2E 判断
| 项目 | 内容 |
|------|------|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | 纯渲染层通知 gating 改动 · 无对外 API、无后端业务链路 |

### Browser E2E 判断
| 项目 | 内容 |
|------|------|
| 是否需要 Browser E2E | ⏭️ 可跳过 |
| 原因 | 行为依赖真实 ≥60s 静默 + 系统通知/Dock,Electron 桌面通知非浏览器页面流程;用 renderer 单测(注入可控 now/事件序列)+ 里程碑无头冒烟覆盖更可靠。敏捷需求 stage 链本不含 browser_e2e |

---

## 变更记录
| 日期 | 变更 |
|------|------|
| 2026-06-13 | 初稿:6 条 renderer 单测覆盖 AC-1..AC-5 |
