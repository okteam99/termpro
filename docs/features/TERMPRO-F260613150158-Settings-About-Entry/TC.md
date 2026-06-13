---
feature_id: "TERMPRO-F260613150158-Settings-About-Entry"
status: pending_review
tests:
  - id: T-001
    file: src/preload/__tests__/parseVersionArg.test.ts
    function: parseVersionArg_extracts_version_from_arg
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-002
    file: src/preload/__tests__/parseVersionArg.test.ts
    function: parseVersionArg_returns_empty_on_all_failure_modes
    covers_ac: ["AC-8"]
    level: unit
    priority: P0
  - id: T-003
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: settingsEntry_renders_avatar_placeholder_and_settings_label
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-004
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: settingsEntry_toggles_menu_with_exactly_one_about_item
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-005
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: settingsEntry_menu_closes_on_outside_click_and_esc
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-006
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: settingsEntry_about_click_opens_modal_and_closes_menu
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: T-006b
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: settingsEntry_no_menu_behind_open_about_modal
    covers_ac: ["AC-4"]
    level: unit
    priority: P1
  - id: T-011
    file: src/main/__tests__/buildAdditionalArguments.test.ts
    function: buildAdditionalArguments_includes_version_flag
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-007a
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: aboutModal_shows_version_from_bridge
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-007b
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: aboutModal_shows_unknown_fallback_when_version_empty
    covers_ac: ["AC-8"]
    level: unit
    priority: P0
  - id: T-008
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: aboutModal_closes_via_esc_backdrop_button_and_restores_focus
    covers_ac: ["AC-6"]
    level: unit
    priority: P1
  - id: T-009
    file: src/renderer/components/__tests__/SettingsEntry.test.tsx
    function: footer_renders_entry_devbadge_updatepill_as_siblings
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-010
    file: manual
    function: designer_visual_signoff_and_pm_acceptance
    covers_ac: ["AC-9"]
    level: manual
    priority: P1
---

# 左下角用户信息入口(Settings · About) - 测试用例

## 状态
待评审

## Feature: 左下角用户信息入口
作为 TermPro 用户,我希望侧栏左下角有一个用户区入口,以便查看应用版本(并作为未来设置/账户入口)。

## 需求覆盖矩阵

| AC ID | 需求描述 | 优先级 | 覆盖测试 | 状态 |
|-------|---------|--------|----------|------|
| AC-1 | 入口行(头像占位 + Settings) | P0 | T-003 | ✅ |
| AC-2 | 点击展开菜单(仅 About)+ toggle | P0 | T-004 | ✅ |
| AC-3 | 外点 / Esc 关闭菜单 | P0 | T-005 | ✅ |
| AC-4 | 点 About 弹版本 + 关菜单 + 互斥 | P0 | T-006, T-006b | ✅ |
| AC-5 | 版本取自真实版本(同步暴露,非硬编码) | P0 | T-001(解析), T-011(main 注入侧), T-007a(组件读 bridge) | ✅ |
| AC-6 | 弹窗可关 + 焦点返还 | P1 | T-008 | ✅ |
| AC-7 | 入口+DEV徽标+升级胶囊共存(不重叠) | P1 | T-009(共存结构)+ 冒烟/Designer(不重叠视觉) | ✅ |
| AC-8 | 版本读取失败 → 「版本未知」 | P1 | T-002, T-007b | ✅ |
| AC-9 | 复用 token + 风格一致 | P1 | T-010(Designer/pm 视觉签核) | ✅ |

覆盖率: 9 / 9 (100%)

> 📎 **测试层级与边界说明**(冷审整合):
> - AC-1~AC-8 由 vitest 自动化(parseVersionArg = node env;SettingsEntry/AboutModal = jsdom + @testing-library/react)。
> - **AC-5 "非硬编码"** 的完整证明 = T-001(arg 解析)+ **T-011(main 侧 buildAdditionalArguments 含 `--termpro-version`,冷审 CR-1 闭合注入侧 gap)**+ T-007a(组件读 `window.termpro.version` 而非字面量);三者合证管道两端,不再靠口头静态核对。
> - **AC-8 安全读**:renderer 用 `window.termpro?.version ?? ''`,version 为空**或** bridge 缺失都回退「版本未知」(冷审 CR-3:两态等价,T-007b 覆盖空值,可选链覆盖 absent)。
> - **AC-7 "不重叠遮挡"**:jsdom 无布局引擎,T-009 仅断言三者为 footer 同级兄弟(共存);**视觉不重叠**由冒烟渲染 + Designer/pm_acceptance 核对(同 AC-9,项目无像素回归工具)。
> - **AC-9**:视觉一致非机器可断言 → Designer 签核 + pm_acceptance(T-010 level=manual)。

---

## 测试场景

### Scenario Outline: TC-001/002 版本号解析(AC-5 / AC-8)
**优先级**: P0 | **类型**: 功能 + 异常 | **层级**: unit(node)
```gherkin
When preload 调用 parseVersionArg(argv)
Then 返回 "<output>"

Examples:
| argv 含                          | output    |
| --termpro-version=0.3.12         | 0.3.12    |
| --termpro-version=               | (空串)     |
| --termpro-version (无等号)        | (空串)     |
| (完全无该 arg)                    | (空串)     |
| --termpro-version="   "(纯空格)   | (空串)     |
```
> 🔴 三种失败态(值空 / 无 `=` / arg 缺失)+ 纯空格全须回退 `""` 不抛错(契约见 TECH.md parseVersionArg 契约表)。

### Scenario: TC-003 入口渲染头像占位 + Settings(AC-1)
**优先级**: P0 | **类型**: 功能 | **层级**: unit(jsdom)
```gherkin
Given 渲染 Sidebar(含 footer)
Then sidebar-footer 内存在 Settings 入口:可见文本 "Settings"
And 存在头像占位元素(avatar 占位容器,无真实账户图像)
```

### Scenario: TC-004 入口展开菜单且有且仅有一个 About 项(AC-2)
**优先级**: P0 | **类型**: 功能 | **层级**: unit(jsdom)
```gherkin
Given 渲染 Settings 入口
When 用户点击入口
Then 入口上方出现菜单,菜单内 menuitem 数量 === 1 且文本为 "About"
When 用户再次点击入口
Then 菜单关闭(toggle)
```

### Scenario: TC-005 菜单外点/Esc 关闭(AC-3)
**优先级**: P0 | **类型**: 功能 | **层级**: unit(jsdom)
```gherkin
Given 菜单已展开
When 用户点击菜单外区域 或 按下 Esc
Then 菜单关闭
```

### Scenario: TC-006 点 About 弹版本并关菜单(AC-4)
**优先级**: P0 | **类型**: 功能 | **层级**: unit(jsdom)
```gherkin
Given 菜单已展开
When 用户点击 "About"
Then 出现版本信息弹窗(含 "TermPro" 与版本号)
And 菜单同时关闭(不可见)
```

### Scenario: TC-006b 弹窗打开时入口背后不残留菜单(AC-4 互斥)
**优先级**: P1 | **类型**: 边界 | **层级**: unit(jsdom)
```gherkin
Given About 弹窗已打开(经 About 点击路径)
Then 文档中不存在已展开的菜单(menu 与 modal 不共存)
```

### Scenario: TC-007a/007b 版本展示与回退(AC-5 / AC-8)
**优先级**: P0 | **类型**: 功能 + 异常 | **层级**: unit(jsdom)
```gherkin
# T-007a
Given window.termpro.version = "0.3.12"
When About 弹窗渲染
Then 显示 "版本 0.3.12"(读自 bridge,非组件内字面量)

# T-007b
Given window.termpro.version = ""(读取失败)
When About 弹窗渲染
Then 显示 "版本未知" 且不抛错/不崩溃
```

### Scenario: TC-008 弹窗关闭并返还焦点(AC-6)
**优先级**: P1 | **类型**: 功能 | **层级**: unit(jsdom)
```gherkin
Given About 弹窗已打开(打开前焦点在 Settings 入口)
When 用户按 Esc / 点遮罩 / 点关闭按钮
Then 弹窗关闭
And document.activeElement 返还到先前聚焦元素
```

### Scenario: TC-009 footer 三元素共存(AC-7 结构部分)
**优先级**: P1 | **类型**: 功能 | **层级**: unit(jsdom)
```gherkin
Given devChannel=true 且存在可用更新事件
When 渲染 Sidebar footer
Then 升级胶囊、DEV 徽标、Settings 入口均存在于 sidebar-footer 内为同级兄弟元素
# 注:视觉不重叠由冒烟 + Designer 核对(jsdom 无布局引擎)
```

---

## E2E 端到端验收

### API E2E 判断
| 项目 | 内容 |
|------|------|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | 纯前端 / 壳层 IPC 改动,无对外 API、无网络请求、无后端副作用 |

### Browser E2E 判断
| 项目 | 内容 |
|------|------|
| 是否需要 Browser E2E | ⏭️ 可跳过 |
| 原因 | Electron 桌面应用(非 Web,无法浏览器黑盒驱动主窗口);UI 交互由 jsdom 组件测试覆盖 + `TERMPRO_SMOKE=1` 冒烟渲染兜底 + Designer/pm_acceptance 视觉核对 |

---

## 变更记录
| 日期 | 变更 |
|------|------|
| 2026-06-13 | v0.1 初稿(9 AC 全覆盖) |
| 2026-06-14 | v0.2 整合 blueprint 冷审:T-002 穷举失败态(QA-2)· 补 TC-003 场景(QA-3)· 拆 T-007a/007b(QA-4)· AC-7 overlap 归 smoke+designer(QA-5)· 加 T-006b 互斥守卫(QA-6)· T-010 level→manual(QA-7) |
| 2026-06-14 | v0.3 整合 external(codex)冷审:加 T-011 main 注入侧测试(CR-1)· AC-8 安全读覆盖 bridge-absent(CR-3)· T-009 harness 细化(CR-4) |
