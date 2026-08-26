---
feature_id: "OKWORK-F260826061325-Account-Menu-Settings-Panel"
author: PM
status: confirmed
decision: approved_and_ship
decided_at: "2026-08-26T09:10:00Z"
prd_ref: PRD.md (v1.0)
test_report_ref: TEST-REPORT.md
browser_test_report_ref: n/a
ac_total: 9
ac_passed: 9
revision_history:
  - version: v0.1
    date: "2026-08-26"
    author: PM
    summary: 对照 TEST-REPORT 9/9；等待用户拍板 decision
---

# 账号菜单 + 全局 Settings 面板 - PM 验收说明(PM-NOTE)

> 位置：`docs/features/OKWORK-F260826061325-Account-Menu-Settings-Panel/PM-NOTE.md`
> 🟢 **本文是 teamwork pm_acceptance-stage 可选产物** · 起草模板 = `{SKILL_ROOT}/templates/pm-note.md`
> 🔴 **状态字段权威在 state.json** · 本文是人读说明。决策未拍板前 `decision` 留空。

---

## §1 验收概要

| 项 | 内容 |
|---|---|
| 决策 | approved_and_ship |
| AC 通过数 | 9 / 9 |
| 评审依据 | PRD.AC + TEST-REPORT（vitest 2135 passed · e2e 21 checks · verify-ac 9/9） |
| 决策时间 | 2026-08-26T09:10:00Z |

---

## §2 AC 逐条对照(对照 TEST-REPORT 实际数据 · 不口述 OK)

| AC ID | 描述 | 实测数据出处 | PM 判断 | 备注 |
|---|---|---|---|---|
| AC-1 | 入口改叫 Login；点击只 toggle 菜单，无登录流 | TEST-REPORT §2 verbose：`settingsEntry_renders_avatar_placeholder_and_login_label` PASS；e2e `Login label` | ✅ pass | 无 OAuth/表单路径 |
| AC-2 | 菜单仅 Settings / About / Log out；外点与 Esc 关 | `settingsEntry_toggles_account_menu` + `settingsEntry_menu_closes_on_outside_click_and_esc` PASS | ✅ pass | |
| AC-3 | Settings 打开全局两栏面板；右栏嵌入无套娃 backdrop | `settingsEntry_pin_bottom_bar_lives_in_general_panel` + `settingsEntry_panel_does_not_stack_settings_backdrops` PASS | ✅ pass | review F1 后存储 dialog Esc 单测也绿 |
| AC-4 | 原五项迁入左分类；互跳切分类 | language / browser / pin-in-general 三组 PASS | ✅ pass | |
| AC-5 | About 仍为版本卡，不进面板 | `settingsEntry_about_click_opens_modal_and_closes_menu` + `settingsEntry_no_menu_behind_open_about_modal` PASS | ✅ pass | |
| AC-6 | Logout 不真登出；菜单仍开；出现 Not signed in | `settingsEntry_logout_shows_not_signed_in` PASS；e2e zh `未登录` | ✅ pass | |
| AC-7 | 深链落到 Remote Hosts；与 About 互斥 | `settingsEntry_remote_hosts_page_deep_link_via_store_nonce` + `settingsEntry_deep_link_replaces_open_about` PASS | ✅ pass | |
| AC-8 | 关闭后焦点回入口；三态互斥 | language Esc、About Esc/backdrop、Remote Hosts close PASS | ✅ pass | |
| AC-9 | 不再写「Settings → Remote Hosts」暗示入口仍叫 Settings | openPreview + HtmlPreview 测试 PASS；e2e 三处 `no old * copy` | ✅ pass | 现文案 `Settings (Remote Hosts)` |

覆盖率依据：TEST-REPORT §4.1 `VERIFY_EXIT:0` · 9 条 AC 均绑定到真实存在的测试。

---

## §3 决策(用户已拍板 · 记录结果 · 不是选项脚本)

**决策**: approved_and_ship
**理由**: 用户选 1 · 核心 AC 全过；官方 `npm test` exit-code=0（2135 passed）；源码契约 e2e exit-code=0；无阻塞 finding。

### rejected_with_feedback 时必填 finding 列表

| ID | 描述 | 涉及 AC | 严重度 | 建议改 | 类型(代码/需求/UI) |
|---|---|---|---|---|---|
| - | （无） | - | - | - | - |

---

## §4 主对话试用(可选)

| 路径 | PM 实测 | 截图 / log |
|---|---|---|
| vitest SettingsEntry 26 + 回归 2135 | ✅ 工具自跑 `npm test` exit 0（test-stdout.log） | TEST-REPORT §2 |
| 账号菜单源码契约 21 checks | ✅ python e2e exit 0 | TEST-REPORT §3 |
| 真 Electron 窗口点 Login | 未在本机开应用内点按 | 用户可在预览页或本地 `npm start` 看一眼 |

---

## §5 决策依据

| 来源 | 内容 |
|---|---|
| PRD.AC | acceptance_criteria[] 9 条（P0×8 + P1×1） |
| TEST-REPORT | integration exit-code=0 · e2e exit-code=0 · verify-ac pass |
| 代码评审 | REVIEW round 2 APPROVE；F1/F2/F3 fixed |
| 范围外 | Login/Logout 真实鉴权（PRD 明确本期不做） |
