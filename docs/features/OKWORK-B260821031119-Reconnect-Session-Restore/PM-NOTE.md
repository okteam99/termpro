---
feature_id: "OKWORK-B260821031119-Reconnect-Session-Restore"
author: PM
status: confirmed
decision: approved_and_ship
decided_at: "2026-08-21T08:33:16Z"
prd_ref: N/A (Bug flow; specification is BUG report)
test_report_ref: TEST-REPORT.md
browser_test_report_ref: N/A
ac_total: 0
ac_passed: 0
revision_history:
  - version: v1.0
    date: "2026-08-21"
    author: PM
    summary: Bug 回归目标 4/4 通过；用户批准进入 ship
---

# 重连会话恢复过期提示 - PM 验收说明

## §1 验收概要

| 项 | 内容 |
|---|---|
| 决策 | `approved_and_ship` |
| Bug 回归目标 | 4 / 4 通过 |
| 评审依据 | BUG 报告 + REVIEW.md + TEST-REPORT.md + 状态机实跑证据 |
| 决策时间 | 2026-08-21T08:33:16Z |

## §2 Bug 回归目标逐条对照

| 目标 | 实测数据出处 | PM 判断 | 备注 |
|---|---|---|---|
| 新一轮恢复已排队并成功时，旧轮最终失败不得写过期提示 | TEST-REPORT §3 Python 驱动：1 test passed，JSON `PASS` | ✅ pass | 状态机从 repo root 再次实跑 exit 0 |
| 最新代次真实最终失败仍提示用户按键自愈 | TEST-REPORT §4 回归矩阵 + `sessionReadoptNotice.test.ts` | ✅ pass | 既有提示语义未被 generation 闸门吞掉 |
| 同 Host 串行、不同 Host 隔离以及 Host 会话连续性不回归 | TEST-REPORT §2：5 files / 48 tests passed | ✅ pass | 含真实 PTY/WS continuity 14 tests |
| 全局构建与应用启动不回归 | dev 证据：typecheck 0、全量 2128 passed、Electron `SMOKE_OK` | ✅ pass | touched lint 0 error / 0 warning |

Bug flow 无 PRD/TC/AC，因此 AC 覆盖机器门为 N/A；这里以 BUG 报告定义的回归目标为验收基准。

## §3 决策

**决策**：`approved_and_ship`

**理由**：根因修复集中在 renderer 会话收养生命周期；回归、全量门禁与独立 Code Review 全部通过，无协议、数据迁移或 release-gated 风险。

用户于 2026-08-21 在 PM 验收暂停点选择选项 1，批准进入 ship。Ship Phase 1 将推送 Feature 分支并创建 PR；平台合并仍由用户操作。

## §4 主对话试用

| 路径 | PM 实测 | 证据 |
|---|---|---|
| 旧 readopt 最终失败 + 新 readopt 已排队成功 | ✅ 旧代提示被抑制 | TEST-REPORT §3 Python→Vitest 驱动 |
| Electron Host 启动握手与首个 PTY 输出 | ✅ 正常 | dev 门禁 `SMOKE_OK` |

## §5 决策依据

| 来源 | 内容 |
|---|---|
| BUG 报告 | 稳定复现、per-host generation 根因与用户确认方案 |
| REVIEW.md | fast 独立评审 `APPROVE`，findings 为空 |
| TEST-REPORT.md | 邻近 48/48、关键路径 JSON PASS、回归目标 4/4 |
| dev 证据 | typecheck、全量 Vitest、touched lint、Electron smoke 全绿 |
| 已知基线 | 全仓 lint 历史债已记 WARN；本次触碰文件 lint 全绿 |
