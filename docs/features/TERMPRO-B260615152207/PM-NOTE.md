---
feature_id: "TERMPRO-B260615152207-Terminal-Garbled-Text"
author: PM
status: confirmed
decision: "approved_and_ship"
decided_at: "2026-06-15T17:50:00Z"
prd_ref: N/A (Bug · 规格依据 bugfix/BUG-TERMPRO-B260615152207-001.md)
test_report_ref: TEST-REPORT.md
ac_total: 3
ac_passed: 3
revision_history:
  - version: v0.1
    date: "2026-06-15"
    author: PM
    summary: 首版验收 · 验收标准 3/3 通过 · 待用户拍板 decision
---

# 终端 CJK 渲染乱码修复 - PM 验收说明(PM-NOTE)

## §1 验收概要

| 项 | 内容 |
|---|---|
| 决策 | ✅ approved_and_ship(用户拍板 2026-06-15) |
| 验收标准通过数 | 3 / 3 |
| 评审依据 | BUG 报告 §现象/§根因/§修复方案 + REVIEW(三视角 APPROVE)+ TEST-REPORT(单测 207 + 真实 WebGL e2e) |

## §2 验收标准逐条对照(Bug 无 PRD/TC · 标准取自 BUG 报告期望行为 · 对照实测)

| VC | 期望行为 | 实测数据出处 | PM 判断 |
|---|---|---|---|
| VC-1 | 终端 CJK 不再因图集分页重排出现错位/串字(根因被修) | TEST-REPORT §3:真实 WebGL e2e · 写满 13440+ 不同 CJK 触发真实 `onRemoveTextureAtlasCanvas`×4 + 修复响应 `term.refresh` · E2E_OK | ✅ pass |
| VC-2 | 修复为**根因修复**非治标 | REVIEW-arch:深核 addon 源确认 `term.refresh`→`_clearModel(true)`+`_updateModel` 按重排后图集重建 `a_texpage`;合并 fire onRemove 但不调度帧 → 本 fix 正补该缺口 | ✅ pass |
| VC-3 | 无回归(终端/会话/链接/正常 ASCII) | 全量 vitest 207 全过 + dev 冒烟 SMOKE_OK;仅订阅低频 remove/change 事件 · 正常输出零额外刷新(三视角一致) | ✅ pass |

## §3 决策选项(三选一 · 用户拍板)

### 3.1 approved_and_ship(💡 推荐)
**理由**:根因已修且多重验证(真实 WebGL e2e 实证根因触发+修复响应 · 207 单测 · 三视角 APPROVE)。像素级「肉眼无乱码」最适合在发布版里由报告者本人(中文密集使用场景)确认 —— ship 后用户应用内升级胶囊更新即可验。
**后续动作**:进 ship(push 分支 + 建 MR · Phase 1 仍有"等用户在平台合并 MR"暂停点 · 不会自动 push 进主分支)。

### 3.2 approved_no_ship(完成但暂不发)
**理由**:如想攒批与其它改动一起发,或想先本地构建肉眼确认再发。
**后续动作**:Feature 直接 completed · 不 ship。

### 3.3 rejected_with_feedback(需返工)
**理由**:若你认为还有未覆盖的乱码场景 / 方向不对。
**后续动作**:按 finding 类型回退(代码→dev / 方案→diagnose)。

## §4 残留(非阻断)
像素级肉眼确认无 pixel-diff 基建自动化,需真人在真实窗口看一眼(用户报告者本人最适合)。e2e 已证「真实图集在 CJK 下确会溢出 + 修复确会响应重绘」。

## §5 决策依据
| 来源 | 内容 |
|---|---|
| BUG 报告 | §根因(WebGL 图集分页重排)+ §修复方案(方案 A · 已确认) |
| REVIEW.md | 三视角 APPROVE(architect 深核机制 + qa + external codex findings:[]) |
| TEST-REPORT.md | integration 207 exit 0 · e2e E2E_OK exit 0 |
