---
feature_id: "TERMPRO-F260613152432-Terminal-File-Link-Open"
author: PM
status: pending_user_decision
prd_ref: PRD.md
test_report_ref: TEST-REPORT.md
ac_total: 5
ac_passed: 5
recommended_decision: approved_and_ship
---

# PM Acceptance Note — Terminal 文件链接点击直接打开(目录仍定位)

## §1 概要
| 项 | 值 |
|---|---|
| 推荐决策 | approved_and_ship |
| AC 通过 | 5 / 5 |
| 证据 | PRD.AC + TEST-REPORT(集成 exit 0 / e2e exit 0 / SMOKE_OK)+ 三审 APPROVE |

## §2 AC 逐条验收(用户视角)
| AC | 用户可感知行为 | 证据 | 判定 |
|----|----------------|------|------|
| AC-1 | 点目录链接 → 仍在 File Panel 定位展开(不变) | T-004/T-005 | ✅ |
| AC-2 | 点文件链接 → 直接打开(文本/图片进窗口 · 媒体走系统) | T-001/T-002 | ✅ |
| AC-3 | 点工程内文件 → 也直接打开,不再只定位(本次核心修正) | T-003 | ✅ |
| AC-4 | 点带 `:行:列` 的文件 → 用纯路径打开 | T-006(端到端) | ✅ |
| AC-5 | 点 http/https → 仍系统浏览器 | T-007 | ✅ |

## §3 PM 试用
未在真机 Electron 窗口逐一点击核对(归用户视角验收)。已有保障:① T-006 经 `FsLinkProvider` 端到端验证激活链路;② 无头冒烟 SMOKE_OK 证应用启动未坏;③ DEC-1=A(纯打开)已按你拍板落地。真机「点文件→出现窗口 / 点目录→树里定位」的肉眼核对建议你在升级后顺手验一下。

## §4 决策选项
- approved_and_ship(推荐):AC 5/5 + 三审 APPROVE + 双绿,进 ship(Phase 1 仍有「等你在 GitHub 合并 MR」暂停点,不会自动 push)。
- approved_no_ship:完成但不发,等其他 feature/时机。
- rejected_with_feedback:给具体反馈,回 dev/goal。
