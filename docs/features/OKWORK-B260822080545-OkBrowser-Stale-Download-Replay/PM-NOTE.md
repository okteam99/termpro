---
feature_id: "OKWORK-B260822080545-OkBrowser-Stale-Download-Replay"
author: PM
status: confirmed
decision: approved_and_ship
decided_at: "2026-08-23T00:25:53Z"
prd_ref: N/A (Bug flow; bugfix report is authoritative)
test_report_ref: TEST-REPORT.md
browser_test_report_ref: N/A
ac_total: 5
ac_passed: 5
revision_history:
  - version: v1.0
    date: "2026-08-23"
    author: PM
    summary: 用户确认全部 Bug 回归证据后批准进入 Ship
---

# OkBrowser 历史下载标签重放 - PM 验收说明

> Bug 流没有 PRD AC；本说明以 `BUG-OKWORK-B260822080545-001.md` 的回归计划和
> `TEST-REPORT.md` 的真实测试证据为验收依据。状态字段权威在 `state.json`。

## §1 验收概要

| 项 | 内容 |
|---|---|
| 决策 | `approved_and_ship` |
| Bug 回归通过数 | 5 / 5 |
| 评审依据 | Bug 报告 + REVIEW + TEST-REPORT |
| 决策时间 | 2026-08-23T00:25:53Z |

## §2 回归项逐条对照

| 回归项 | 描述 | 实测数据出处 | PM 判断 |
|---|---|---|---|
| R-001 | 后台历史 ZIP 首次不挂载，明确激活后才挂载并保活 | TEST-REPORT §5 · BrowserPanel 25/25 | ✅ pass |
| R-002 | 程序化 mount request 不抢焦点，等待真实 ref | TEST-REPORT §5 · BrowserPanel 25/25 | ✅ pass |
| R-003 | 后台 navigate 等待挂载，不返回假成功、不重复 loadURL | TEST-REPORT §5 · browserControl 14/14 | ✅ pass |
| R-004 | BrowserPanel 邻近生命周期行为不回归 | TEST-REPORT §5 · 25/25 | ✅ pass |
| R-005 | browserControl 邻近操作不回归 | TEST-REPORT §5 · 14/14 | ✅ pass |

定向 integration 共 `2 files / 39 tests`，状态机复跑 exit code `0`；dev 阶段完整套件
`2048 passed / 114 skipped`，Electron smoke 输出 `SMOKE_OK`。

## §3 决策

**决策**：`approved_and_ship`

**理由**：用户确认推荐项；5/5 回归项、Review F1 修复和机器采集测试证据均通过，无阻塞问题。

## §4 主对话试用

| 路径 | PM 实测 | 证据 |
|---|---|---|
| 历史 ZIP 恢复 → 打开安全链接 → 明确访问后台标签 → 程序化后台导航 | 由组件集成测试覆盖；未冒名 live Electron 人工试用 | TEST-REPORT §2、§3、§5 |

## §5 决策依据

| 来源 | 内容 |
|---|---|
| Bug 报告 | 根因、修复方案、5 项回归计划 |
| REVIEW | F1 后台程序化导航假成功已修复并验证 |
| TEST-REPORT | integration 39/39；Python→Vitest driver exit 0；API-E2E 按边界 N/A |

