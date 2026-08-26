---
feature_id: "OKWORK-F260826061325-Account-Menu-Settings-Panel"
author: QA
status: confirmed
prd_ref: PRD.md (v1.0)
tc_ref: n/a (lite · PRD.test_refs)
test_run_at: "2026-08-26T09:00:36Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: pass
revision_history:
  - version: v0.1
    date: "2026-08-26"
    author: QA
    summary: 首版 · vitest 全量绿 + 源码契约 e2e + verify-ac test-refs 9/9
---

# 账号菜单 + 全局 Settings 面板 - Test Report

> 位置：`docs/features/OKWORK-F260826061325-Account-Menu-Settings-Panel/TEST-REPORT.md`
> 🟢 **本文是 teamwork test-stage 产物** · 起草模板 = `{SKILL_ROOT}/templates/test-report.md`
> 🔴 **必含 stdout 摘录 + exit-code 数值** · 不口述「测试通过」

---

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 责任人 |
|---|---|---|---|
| integration(进程内) | SettingsEntry ↔ store nonce / 嵌入页 / i18n / 预览文案 | `npm test`（vitest jsdom · 全仓） | QA |
| api-e2e | 本 Feature 无独立 Host/HTTP 面；用源码契约锁生产字符串，防旧 footer 清单静默回归 | `{Feature}/e2e/test_account_menu_contract.py` | QA |
| browser-e2e | N/A（`needs_browser_e2e=false`） | — | — |

本 Feature 是 renderer-only IA 改动（无新 RPC、无 auth backend）。jsdom 组件套件是可交互的「活」路径；Python 脚本锁生产字符串，避免只靠组件测试、源码被改回 `Settings → Remote Hosts` 箭头文案时漏检。

---

## §2 integration 结果

### 2.1 执行命令

```bash
cd /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260826061325-Account-Menu-Settings-Panel
npm test
# 日志：.teamwork-scratch/test-stage-vitest.log
```

Feature 相关 verbose 复跑：

```bash
npx vitest run \
  src/renderer/components/__tests__/SettingsEntry.test.tsx \
  src/renderer/services/__tests__/openPreview.test.ts \
  src/renderer/components/viewer/__tests__/HtmlPreview.test.tsx \
  src/renderer/components/settings/__tests__/BrowserProfilesSection.test.tsx \
  --reporter=verbose
```

### 2.2 stdout 摘录

全量 `npm test`（2026-08-26T09:00:36Z 起跑）：

```text
 ✓ src/renderer/components/settings/__tests__/BrowserProfilesSection.test.tsx (12 tests) 308ms
 ✓ src/renderer/components/__tests__/SettingsEntry.test.tsx (26 tests) 495ms
 ✓ src/renderer/services/__tests__/openPreview.test.ts (7 tests) 4ms
 ✓ src/renderer/components/viewer/__tests__/HtmlPreview.test.tsx (21 tests) 229ms

 Test Files  210 passed | 4 skipped (214)
      Tests  2135 passed | 33 skipped (2168)
   Start at  17:00:36
   Duration  11.97s
EXIT:0
```

Feature 相关 verbose（66 passed）：

```text
 ✓ settingsEntry_renders_avatar_placeholder_and_login_label > renders Login label and avatar container
 ✓ settingsEntry_logout_shows_not_signed_in > keeps the menu open and shows Not signed in
 ✓ settingsEntry_toggles_account_menu > shows Settings, About, Log out and hides on second click
 ✓ settingsEntry_pin_bottom_bar_lives_in_general_panel > toggles pin from General, not from the account menu
 ✓ settingsEntry_language_switcher > opens the Language modal and switches UI language + notifies main on pick
 ✓ settingsEntry_language_switcher > closes via close button / Esc / backdrop and restores focus (AC-6 parity)
 ✓ settingsEntry_browser_settings_modal > opens the Browser Settings modal and writes both settings to the store
 ✓ settingsEntry_about_click_opens_modal_and_closes_menu > clicking About opens the About modal and closes the menu
 ✓ settingsEntry_panel_does_not_stack_settings_backdrops > opens the global panel without a nested settings-modal or remote-hosts backdrop
 ✓ settingsEntry_deep_link_replaces_open_about > closes About when openRemoteHostsPage fires
 ✓ settingsEntry_remote_hosts_page_deep_link_via_store_nonce > nonce 自增打开远程机页并关掉已开着的菜单;关闭后再次自增可重新打开
 ✓ aboutModal_closes_via_esc_backdrop_button_and_restores_focus > closes via Esc key and restores focus
 ✓ BrowserProfilesSection > Escape closes the storage dialog and leaves the profiles section mounted
 ✓ openHtmlPreview > preview.ensure 抛 unknown rpc method(旧 host)→ 升级提示
 Test Files  4 passed (4)
      Tests  66 passed (66)
```

### 2.3 exit-code

`exit-code = 0`

---

## §3 api-e2e 结果

### 3.1 前置环境

| 项 | 内容 | 获取方式 |
|---|---|---|
| 运行时 | 无 live Electron / 无 HTTP 服务 | renderer-only · 读生产源码 |
| 代码根 | worktree `OKWORK-F260826061325-Account-Menu-Settings-Panel` | 脚本自 `SettingsEntry.tsx` 上溯 |
| 鉴权 | N/A（Login/Logout 明确不做真登录） | PRD 范围 |

### 3.2 执行命令

```bash
python3 docs/features/OKWORK-F260826061325-Account-Menu-Settings-Panel/e2e/test_account_menu_contract.py
```

### 3.3 stdout 摘录

```text
✓ Login label
✓ Settings menu item
✓ About menu item
✓ Log out item
✓ Not signed in
✓ Appearance group
✓ Language embedded
✓ Browser embedded
✓ Remote Hosts embedded
✓ SettingsPanel shell
✓ nav General
✓ nav Language
✓ nav Browser
✓ nav Passwords
✓ nav Remote Hosts
✓ zh Login
✓ zh Log out
✓ zh Not signed in
✓ no old preview copy
✓ no old html preview copy
✓ no old paste copy
OK · account-menu source contract
E2E_EXIT:0
```

### 3.4 exit-code

`exit-code = 0`

---

## §4 AC 覆盖度(verify-ac.py 结果)

```bash
python3 ~/.agents/skills/teamwork/templates/verify-ac.py \
  --prd docs/features/OKWORK-F260826061325-Account-Menu-Settings-Panel/PRD.md \
  --mode test-refs \
  --repo-root /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260826061325-Account-Menu-Settings-Panel
```

### 4.1 verify-ac.py 输出

```text
📋 AC↔测试引用校验(lite 档 · 无 TC)
├── PRD AC 数：9
└── 逐条：
    ✅ AC-1 … AC-9 测试引用均存在
✅ AC↔测试引用校验通过（9 条 AC 均绑定到真实存在的测试）
VERIFY_EXIT:0
```

### 4.2 AC↔Test 矩阵

| AC ID | 描述 | 覆盖测试 | 层级 | 状态 |
|---|---|---|---|---|
| AC-1 | 入口改叫 Login；点击只 toggle 菜单，无登录流 | `settingsEntry_renders_avatar_placeholder_and_login_label` · e2e Login label | unit/integration + source-e2e | ✅ |
| AC-2 | 菜单仅 Settings / About / Log out；外点与 Esc 关闭 | `settingsEntry_toggles_account_menu` · `settingsEntry_menu_closes_on_outside_click_and_esc` | integration | ✅ |
| AC-3 | Settings 打开全局两栏面板；右栏嵌入，无套娃 settings backdrop | `settingsEntry_pin_bottom_bar_lives_in_general_panel` · `settingsEntry_panel_does_not_stack_settings_backdrops` | integration | ✅ |
| AC-4 | 原菜单五项迁入左分类；互跳切分类 | language / browser / pin-in-general | integration | ✅ |
| AC-5 | About 仍为版本卡，不进 Settings 面板 | `settingsEntry_about_click_opens_modal_and_closes_menu` · `settingsEntry_no_menu_behind_open_about_modal` | integration | ✅ |
| AC-6 | Logout 不真登出；菜单仍开；出现 Not signed in | `settingsEntry_logout_shows_not_signed_in` | integration | ✅ |
| AC-7 | `openRemoteHostsPage` 落到面板 Remote Hosts；与 About 互斥 | `settingsEntry_remote_hosts_page_deep_link_via_store_nonce` · `settingsEntry_deep_link_replaces_open_about` | integration | ✅ |
| AC-8 | 关面板/About 后焦点回入口；三态互斥 | language Esc · About Esc/backdrop · Remote Hosts close | integration | ✅ |
| AC-9 | 不再写「Settings → Remote Hosts」暗示入口仍叫 Settings | `openPreview.test.ts` · `HtmlPreview.test.tsx` · e2e no-old-copy | integration + source-e2e | ✅ |

覆盖率: 9 / 9 (100%)

Review F1 回归（Profile 存储 dialog Esc 不关全局面板）：`BrowserProfilesSection > Escape closes the storage dialog and leaves the profiles section mounted` PASS。

---

## §5 回归测试

| 测试集 | 范围 | 结果 |
|---|---|---|
| 全量 unit+integration | `npm test` · vitest run | ✅ 2135 passed · 33 skipped · exit-code 0 |
| Feature 相关 | SettingsEntry 26 + BrowserProfiles 12 + openPreview 7 + HtmlPreview 21 | ✅ 66 passed |
| 源码契约 | `e2e/test_account_menu_contract.py` 21 checks | ✅ exit-code 0 |

本轮未复现历史 flake `wsMultiClientIsolation` T-046。

---

## §6 fix-retry 历史(若 round > 1)

无。test stage round 1 即绿。

---

## §7 已知问题(不阻塞 · audit 留痕)

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| - | Login / Log out 仍无真实鉴权（PRD 明确本期不做） | — | 范围外 | 后续账号 Feature |
| T-046 | 历史 vitest 偶发 `wsMultiClientIsolation`（他处） | 低 | 本轮全量绿，未登记基线 | 预存在 · 非本 Feature |

---

## §8 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-08-26 | QA | ✅ pass | integration 0 + e2e 0 + verify-ac 9/9 |
