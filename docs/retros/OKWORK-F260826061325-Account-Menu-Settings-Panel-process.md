---
feature_id: OKWORK-F260826061325-Account-Menu-Settings-Panel
flow: Feature (lite 装配 · PRD + UI · 无 TECH)
total_wall: ~3.0h
ai_autonomous_min: ~55
await_user_min: ~113
host: unknown
---

# 流程复盘 · OKWORK-F260826061325-Account-Menu-Settings-Panel

## 一、各阶段耗时(机器数据 · 照抄 stage_contracts / stage_cost)

| stage | 耗时 | 其中等用户 | 总轮次 | 其中协调开销 |
|---|---:|---:|---:|---:|
| goal | 25m | 10m | 3 | 1 |
| ui_design | 76m | 69m | 1 | 0 |
| dev | 13m | 0m | 2 | 0 |
| review | ~23m 墙钟（合同记 0m · 只含 round 2） | 0m | 2 | 1 |
| test | 8m | 0m | 1 | 0 |
| pm_acceptance | 34m | 34m | 1 | 0 |

机器口径以 archive emit `ledger_timing` 为准；上表来自 complete 当时的 `duration_minutes` / `await_minutes` / `stage_cost`。review 合同 `duration_minutes=0` 是因为 round 2 的 start/complete 挤在同一分钟，墙钟应从 round 1 `08:31` 算到 `08:54`。

## 二、耗时归因

### goal

- **协调开销 1/3 轮**,类型:门禁重试
- **最大的一笔**:`revise-plan` 拧 `spec_depth` 时把 fast roster 打回 `pl+external`，`goal-complete` 撞 `reviewers_match`，再拧回 fast
- **可避免吗**:能 → revise-plan 改 spec 深度时不要重置已选定的 fast roster

### review

- **协调开销 1/2 轮**,类型:评审子代理卡住重派
- **最大的一笔**:两轮隔离评审进程写出 REVIEW.md 前无产物，被杀重派
- **可避免吗**:部分能 → 评审 prompt 要求先落盘再长推理；杀进程成本已计入

### 其余

ui_design / dev / test / pm_acceptance 协调开销 0。ui_design 与 pm_acceptance 的墙钟主要是等用户确认预览和拍板。

## 三、流程反思(固定四问)

- **拦住真问题**:review F1 MAJOR — Profile 存储 dialog 的 Esc 关掉整块 Settings 面板（与 Remote Hosts 同族，首轮只拦了一处）。F2/F3 补了深链↔About 互斥与无套娃 backdrop 的显式断言。
- **纯过场候选**:无。fast 单路仍产出 NEEDS_REVISION → 验证轮 APPROVE。
- **流程新判例**:无。
- **成本异常**:goal 一次 `reviewers_match` 重试；review 子代理卡住重派。无 bypass。

## 四、起草可预防性(照抄 authoring_preventability)

- goal `4/4` · 缺:面板嵌入可判定口径；面板内跳转=切分类；深链与 About 互斥 BDD；Logout 反馈单一形态
- review `1/1` · 缺:全局 overlay 内所有二级 dialog 的 Esc 截停

## 五、给下一个 feature 的一句话

全局 overlay 每加一层二级 dialog，Esc 必须 capture；不要只在先碰到的那一处拦。
