---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
status: pending_review
tests:
  - id: T-001
    file: src/main/__tests__/exitConfirmation.test.ts
    function: confirmExit_close_window_cancel_and_confirm_copy
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-002
    file: src/main/__tests__/exitConfirmation.test.ts
    function: exitLifecycle_app_quit_cancel_and_confirm_flow
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-003
    file: src/main/__tests__/updaterInstallConfirmation.test.ts
    function: updater_downloaded_update_cancel_does_not_quit_or_restart
    covers_ac: ["AC-3", "AC-4"]
    level: unit
    priority: P0
  - id: T-004
    file: src/main/__tests__/updaterInstallConfirmation.test.ts
    function: updater_downloaded_update_confirm_broadcasts_restarting_and_bypasses_quit_dialog
    covers_ac: ["AC-5"]
    level: unit
    priority: P1
  - id: T-005
    file: src/main/__tests__/exitConfirmation.test.ts
    function: confirmExit_lock_prevents_stacked_dialogs_and_second_action
    covers_ac: ["AC-6"]
    level: unit
    priority: P1
  - id: T-006
    file: src/renderer/components/__tests__/SidebarUpdatePill.test.tsx
    function: updatePill_available_and_downloading_copy_requires_confirmation_not_auto_restart
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-007
    file: src/main/__tests__/exitConfirmation.test.ts
    function: confirmExit_smoke_bypasses_dialog
    covers_ac: ["AC-8"]
    level: unit
    priority: P1
  - id: T-008
    file: src/main/__tests__/exitConfirmation.test.ts
    function: exitLifecycle_quit_confirm_allows_window_close_without_second_prompt
    covers_ac: ["AC-2", "AC-6"]
    level: unit
    priority: P0
  - id: T-009
    file: src/main/__tests__/updaterInstallConfirmation.test.ts
    function: updater_install_confirm_waits_when_another_confirmation_is_active
    covers_ac: ["AC-3", "AC-4", "AC-6"]
    level: unit
    priority: P0
  - id: T-010
    file: src/main/__tests__/exitConfirmation.test.ts
    function: exitLifecycle_window_all_closed_quit_bypasses_second_app_quit_confirm
    covers_ac: ["AC-1", "AC-2", "AC-6"]
    level: unit
    priority: P1
  - id: T-011
    file: src/main/__tests__/exitConfirmation.test.ts
    function: confirmWhenIdle_can_cancel_after_waiting_before_showing_dialog
    covers_ac: ["AC-3", "AC-6"]
    level: unit
    priority: P1
  - id: T-012
    file: src/main/__tests__/updaterInstallConfirmation.test.ts
    function: updater_confirmed_install_is_ignored_if_installing_was_cleared
    covers_ac: ["AC-3", "AC-5"]
    level: unit
    priority: P1
  - id: T-013
    file: src/main/__tests__/exitConfirmation.test.ts
    function: exitLifecycle_mark_quitting_bypasses_app_quit_confirmation
    covers_ac: ["AC-2"]
    level: unit
    priority: P1
---

# Close / Install Confirmation - 测试用例

## 状态
待评审

## Feature: Close / Install Confirmation

作为正在使用多个 Workspace / Tab 跑终端会话的开发者，
我希望关闭主工作台、退出应用或安装升级前先看到确认，
以便误点关闭或升级按钮后仍能保留当前工作现场。

## 需求覆盖矩阵

| AC ID（PRD） | 需求描述 | 优先级 | 覆盖测试 | 状态 |
|-------------|---------|--------|----------|------|
| AC-1 | 主窗口关闭前确认，取消保持窗口 | P0 | T-001 | ✅ |
| AC-2 | App Quit / Cmd+Q 前确认，取消保持应用 | P0 | T-002, T-013 | ✅ |
| AC-3 | 更新下载完成后安装前确认，取消不 restarting、不 quitAndInstall | P0 | T-003, T-011, T-012 | ✅ |
| AC-4 | 取消安装后清 watchdog / artifacts / installing，并恢复 available | P0 | T-003, T-009 | ✅ |
| AC-5 | 确认安装后广播 restarting 并继续 quitAndInstall | P1 | T-004, T-012 | ✅ |
| AC-6 | 任一确认等待时不堆叠弹窗、不重复动作 | P1 | T-005, T-008, T-009, T-010, T-011 | ✅ |
| AC-7 | 升级胶囊文案不再承诺完成后自动重启 | P1 | T-006 | ✅ |
| AC-8 | TERMPRO_SMOKE 自动化路径绕过确认 | P1 | T-007 | ✅ |

覆盖率: 8 / 8 (100%)

## 测试场景

### Scenario: T-001 主窗口关闭确认的取消与确认路径
**优先级**: P0
**类型**: 功能
**测试层级**: unit

```gherkin
Given 主窗口处于打开状态
When 用户触发主窗口 close 事件
Then main 阻止本次 close
 And 显示标题为“关闭主窗口？”的确认
 And 正文提示“关闭后再打开，Tab 内容可能丢失”
When 用户选择取消
Then 主窗口 close 方法不被再次调用
When 用户再次触发主窗口 close 并选择确认
Then main 允许下一次 close 继续执行
```

### Scenario: T-002 App Quit / Cmd+Q 确认的取消与确认路径
**优先级**: P0
**类型**: 功能
**测试层级**: unit

```gherkin
Given TermPro 应用处于运行状态
When 用户触发 before-quit
Then main 阻止本次 quit
 And 显示标题为“退出 TermPro？”的确认
 And 正文提示“退出后再打开，Tab 内容可能丢失”
When 用户选择取消
Then app.quit 不被再次调用
When 用户再次触发 before-quit 并选择确认
Then main 允许下一次 quit 继续原退出流程
```

### Scenario: T-003 更新下载完成后取消安装恢复可重试
**优先级**: P0
**类型**: 功能
**测试层级**: unit

```gherkin
Given 更新器处于 installing 状态
 And Squirrel.Mac 已发出 update-downloaded
When 安装确认显示后用户选择稍后
Then 更新器不广播 restarting
 And 不调用 autoUpdater.quitAndInstall
 And 安装 watchdog 被清除
 And 本地 feed server 与已下载 zip 被清理
 And installing 状态复位为 false
 And renderer 收到同版本 available 状态以重新启用升级胶囊
```

### Scenario: T-004 更新下载完成后确认安装继续原流程且不再弹 App Quit 确认
**优先级**: P1
**类型**: 功能
**测试层级**: unit

```gherkin
Given 更新器处于 installing 状态
 And Squirrel.Mac 已发出 update-downloaded
When 安装确认显示后用户选择“安装并重启”
Then 更新器清除 watchdog 和临时安装产物
 And renderer 收到 restarting 状态
 And main 标记本次 quitAndInstall 可绕过 App Quit 确认
 And autoUpdater.quitAndInstall 被调用一次
When quitAndInstall 内部触发 before-quit
Then main 不再调用 showMessageBox
 And 原安装退出流程继续放行
```

### Scenario: T-005 确认锁阻止弹窗堆叠和重复动作
**优先级**: P1
**类型**: 边界
**测试层级**: unit

```gherkin
Given 一个关闭确认正在等待用户选择
When 用户在弹窗未关闭前再次触发关闭、退出或安装确认
Then main 不创建第二个确认弹窗
 And 第二个触发不会执行关闭、退出或安装动作
When 第一个确认完成
Then 确认锁释放，之后新的触发可以重新显示确认
```

### Scenario: T-006 升级胶囊 available / downloading 文案不承诺自动重启
**优先级**: P1
**类型**: UI
**测试层级**: unit

```gherkin
Given renderer 收到 update:event available
When Sidebar 渲染升级胶囊
Then 胶囊 title 表达下载完成后需要确认安装或重启
 And 胶囊 title 不包含“自动重启升级”
When renderer 收到 update:event downloading
When Sidebar 渲染升级胶囊
Then 胶囊文本表达下载完成后需要确认安装或重启
 And 胶囊文本不包含“完成后自动重启”
```

### Scenario: T-007 冒烟模式绕过确认
**优先级**: P1
**类型**: 自动化
**测试层级**: unit

```gherkin
Given TERMPRO_SMOKE=1
When 冒烟流程触发应用退出或主窗口关闭
Then main 不调用确认弹窗
 And 原退出路径继续执行，避免 CI 或无头验证卡住
```

### Scenario: T-008 App Quit 确认通过后内部 close 事件不二次弹窗
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given TermPro 应用处于运行状态
When 用户触发 before-quit 并在退出确认中选择确认
Then main 标记应用正在退出
 And app.quit 被调用一次
When app.quit 关闭主窗口并触发 mainWin close
Then close handler 不再显示关闭确认
 And 主窗口 close 事件被放行
 And showMessageBox 总调用次数仍为 1
```

### Scenario: T-009 更新安装确认遇到其他确认锁时等待而不是取消安装
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given 一个关闭或退出确认正在等待用户选择
 And 更新器处于 installing 状态
 And Squirrel.Mac 已发出 update-downloaded
When 更新安装准备显示安装确认
Then 更新器不清理本地 feed server 或已下载 zip
 And 不把 installing 复位为 false
 And 不广播 available
 And 不调用 quitAndInstall
When 先前的关闭或退出确认结束
Then 更新器再显示安装确认
When 用户在安装确认中选择稍后
Then 才执行 T-003 的取消安装恢复逻辑
```

### Scenario: T-010 非 macOS window-all-closed 触发 app quit 时不二次确认
**优先级**: P1
**类型**: 边界
**测试层级**: unit

```gherkin
Given 非 macOS 平台最后一个主窗口已被用户确认关闭
When window-all-closed handler 调用 app.quit
Then main 标记本次 app quit 来源于已确认的 window close
 And before-quit handler 不再显示第二个 App Quit 确认
```

### Scenario: T-011 App Quit 已确认后等待中的安装确认不再弹出
**优先级**: P1
**类型**: 边界
**测试层级**: unit

```gherkin
Given App Quit 确认弹窗正在等待用户选择
 And 更新安装确认正在等待确认锁释放
When 用户确认 App Quit
Then lifecycle 标记应用正在退出
 And 更新安装确认在锁释放后返回 canceled
 And 不再显示安装确认弹窗
```

### Scenario: T-012 fallback 已清理 installing 后忽略迟到的安装确认
**优先级**: P1
**类型**: 边界
**测试层级**: unit

```gherkin
Given 更新器处于 installing 状态
 And 安装确认弹窗正在等待用户选择
When updater error 或 update-not-available 先触发 fallback 并清理 installing
 And 用户随后选择“安装并重启”
Then main 不广播 restarting
 And 不调用 prepareToQuitAndInstall
 And 不调用 autoUpdater.quitAndInstall
```

### Scenario: T-013 系统 shutdown / logout 路径不弹 App Quit 确认
**优先级**: P1
**类型**: 边界
**测试层级**: unit

```gherkin
Given 系统关机或注销事件已通知 main
When Electron 触发 before-quit
Then lifecycle 识别应用正在退出
 And 不显示 App Quit 确认
 And 不阻止系统退出流程
```

## UI 还原检查

| 检查点 | 设计稿标准 | 状态 |
|--------|------------|------|
| Close / Quit 正文 | 明确提示“关闭/退出后再打开，Tab 内容可能丢失” | ⬜ |
| Install Ready | 下载完成后显示安装确认，不直接重启 | ⬜ |
| Install Canceled | 升级胶囊恢复可重试，不保留禁用态 | ⬜ |
| Upgrade pill copy | 不再出现“完成后自动重启” | ⬜ |

## E2E 端到端验收

### API E2E 判断

| 项目 | 内容 |
|------|------|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | 本 Feature 不引入 HTTP/API/数据库链路；行为集中在 Electron main/updater lifecycle 与 renderer copy。 |

### Browser E2E 判断

| 项目 | 内容 |
|------|------|
| 是否需要 Browser E2E | ⏭️ 可跳过 |
| 用户是否可选择跳过 | 是 |
| 原因 | 实际确认是 Electron native dialog 与 updater 事件，浏览器 DOM 自动化无法直接验证；采用 main/updater 单元测试 + smoke 验证。UI 设计预览已在 ui_design 阶段验证。 |

## 实现完整性报告（代码审查时填写）

| 需求项 | 状态 | 代码位置 | 测试位置 |
|--------|------|----------|----------|
| 主窗口关闭确认 | ⬜ | src/main/main.ts / src/main/exitConfirmation.ts | src/main/__tests__/exitConfirmation.test.ts |
| App Quit 确认 | ⬜ | src/main/main.ts / src/main/exitConfirmation.ts | src/main/__tests__/exitConfirmation.test.ts |
| 更新安装确认与取消恢复 | ⬜ | src/main/updater.ts | src/main/__tests__/updaterInstallConfirmation.test.ts |
| 确认锁 | ⬜ | src/main/exitConfirmation.ts | src/main/__tests__/exitConfirmation.test.ts |
| 升级胶囊文案 | ⬜ | src/renderer/components/Sidebar.tsx | src/renderer/components/__tests__/SidebarUpdatePill.test.tsx |
| TERMPRO_SMOKE bypass | ⬜ | src/main/exitConfirmation.ts / src/main/main.ts | src/main/__tests__/exitConfirmation.test.ts |

完整性: 0/6 (开发阶段填写)

## TDD 检查（代码审查时填写）

- [ ] 测试先于实现（检查 git 提交顺序）
- [ ] 每个 TC 至少有一个自动化测试
- [ ] 测试可独立运行
- [ ] 测试命名符合 Scenario 描述
- [ ] 边界条件已覆盖
- [ ] 异常场景已覆盖

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-06-14 | 起草关闭/退出/更新安装确认测试矩阵，覆盖 AC-1..AC-8。 |
| 2026-06-14 | 根据 external review 补充 close/quit 串扰、安装锁忙等待、available 文案与 quitAndInstall bypass 测试。 |
| 2026-06-14 | Round 2 补充系统 shutdown bypass、App Quit 后安装确认取消、fallback race 测试。 |
