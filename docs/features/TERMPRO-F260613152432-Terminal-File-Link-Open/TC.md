---
feature_id: "TERMPRO-F260613152432-Terminal-File-Link-Open"
status: draft
tests:
  - id: T-001
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: file link (non-SYSTEM_OPEN_EXT) opens in viewer directly, locate handler not called
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-002
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: file link (SYSTEM_OPEN_EXT eg .zip/.pdf) opens via system opener directly, locate handler not called
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-003
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: in-root file with locate handler returns true still opens directly (NOT location-only) — replaces old "keeps system-open extensions location-only" assertion
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-004
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: directory link with locate handler returns true is located in File Panel, no openPath/openViewerWindow fallback
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-005
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: directory link with locate returns false falls back to system opener (openPath) — unchanged dir behavior
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-006
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: file link with :line:col suffix opens viewer using stripped path (no suffix, no line-jump claim)
    covers_ac: ["AC-4"]
    level: unit
    priority: P1
  - id: T-007
    file: src/renderer/terminal/__tests__/terminalWebLinks.test.ts
    function: http/https web link still opens via system browser (openExternal), unaffected
    covers_ac: ["AC-5"]
    level: unit
    priority: P1
---

# Terminal 文件链接点击直接打开(目录仍定位) - 测试用例(精简版)

## 状态
草稿

---

## Feature: 终端链接按 kind 分流激活

作为在终端跑 CLI/agent 的开发者
我希望点击文件链接直接打开、点击目录链接在 File Panel 定位
以便看内容与浏览结构各走最短路径。

---

## 需求覆盖矩阵

| AC ID | 需求描述 | 优先级 | 覆盖测试 | 状态 |
|-------|---------|--------|----------|------|
| AC-1 | 目录链接维持 File-Panel-first 定位(根内定位 / 根外 fallback 系统打开) | P0 | T-004, T-005 | ✅ |
| AC-2 | 文件链接直接打开,按 SYSTEM_OPEN_EXT 分流(命中→openPath / 否则→openViewerWindow) | P0 | T-001, T-002 | ✅ |
| AC-3 | 根内文件同样直接打开,不再 location-only(迁移旧只定位测试) | P0 | T-003 | ✅ |
| AC-4 | 解析形态不回退;:line:col 文件用 stripped 路径打开不声明行跳转 | P1 | T-006 | ✅ |
| AC-5 | http/https web 链接仍走系统浏览器 | P1 | T-007 | ✅ |

覆盖率: 5 / 5 (100%)

📎 实现注:路由分叉建议落在 `terminalLinks.ts` 的 fs 链接 `activate` 闭包(ARCH-1:`if (hit.kind==='dir') openTargetInFilePanelFirst(...); else openTargetFallback(hit.abs, hit.kind)`)。测试应针对该路由入口断言「是否调用 locate handler / openPath / openViewerWindow」。SYSTEM_OPEN_EXT 从 `terminalLinks.ts` import,不硬编码列表(AC-2)。

---

## 测试场景

### Scenario: T-001 文件(文本/图片)直接进 viewer
**优先级**: P0 | **类型**: 功能 | **层级**: unit

```gherkin
Given 已注册 File Panel locate handler(mock 可返回 true)
When 激活解析为 file 的链接 "/repo/src/App.tsx"(扩展名不在 SYSTEM_OPEN_EXT)
Then openViewerWindow 被以 { mode: 'file', path: '/repo/src/App.tsx' } 调用
 And openPath 未被调用
 And locate handler 未被调用(文件不先尝试定位)
```

---

### Scenario: T-002 文件(媒体/系统扩展名)直接系统打开
**优先级**: P0 | **类型**: 功能 | **层级**: unit

```gherkin
Given 已注册 File Panel locate handler(mock 可返回 true)
When 激活解析为 file 的链接 "/repo/assets/clip.mp4"(或 .zip/.pdf,命中 SYSTEM_OPEN_EXT)
Then openPath 被以该绝对路径调用
 And openViewerWindow 未被调用
 And locate handler 未被调用
```

---

### Scenario: T-003 根内文件不再 location-only(核心还原 · 替换旧断言)
**优先级**: P0 | **类型**: 功能 | **层级**: unit

```gherkin
Given 已注册 locate handler 且对该路径返回 true(模拟「根内、可定位」)
When 激活解析为 file 的根内链接 "/repo/archive.zip"
Then openPath 被调用(直接系统打开)
 And locate handler 未被调用
 And 旧用例「keeps repository system-open extensions location-only when locate succeeds」被本用例替换(原断言 openPath/openViewerWindow 均不调用 = 已失效)
```

> 🔴 实现时必须删除/改写 `terminalLinkFilePanelRouting.test.ts:60-73` 的旧 location-only 断言(QA-1)。

---

### Scenario: T-004 目录定位成功 · 不走 fallback
**优先级**: P0 | **类型**: 功能 | **层级**: unit

```gherkin
Given 已注册 locate handler 且对目标返回 true
When 激活解析为 dir 的链接 "/repo/src"
Then locate handler 被以 { path: '/repo/src', kind: 'dir', sourceTabId } 调用
 And openPath 未被调用
 And openViewerWindow 未被调用
```

---

### Scenario: T-005 目录定位失败 · 回退系统打开(行为不变)
**优先级**: P0 | **类型**: 异常 | **层级**: unit

```gherkin
Given locate handler 返回 false(根外 / 无法定位)
When 激活解析为 dir 的链接 "/repo/src"
Then openPath 被以 "/repo/src" 调用
 And openViewerWindow 未被调用
```

---

### Scenario: T-006 :line:col 文件用 stripped 路径打开
**优先级**: P1 | **类型**: 边界 | **层级**: unit

```gherkin
Given 候选文本带行列后缀 "/repo/src/App.tsx:42:10" 解析为 file
When 激活该链接
Then openViewerWindow 被以 { mode: 'file', path: '/repo/src/App.tsx' } 调用(无 :42:10 后缀)
 And 不声明/不跳转 line:col(沿用现状)
```

---

### Scenario: T-007 web 链接行为不变
**优先级**: P1 | **类型**: 功能 | **层级**: unit

```gherkin
Given 终端输出含 "https://example.com"
When 激活该 web 链接
Then openExternal 被以该 URL 调用(系统浏览器)
 And 不受本次 fs 链接路由改动影响
```

---

## E2E 端到端验收

### API E2E 判断
| 项目 | 内容 |
|------|------|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | 纯 renderer 交互路由改动,无对外 API / 无 API 驱动业务链路、无数据库副作用 |

### Browser E2E 判断
| 项目 | 内容 |
|------|------|
| 是否需要 Browser E2E | ⏭️ 可跳过 |
| 原因 | 无新 UI 组件/页面结构;行为由 unit 测试 + Electron 无头冒烟(SMOKE_OK)覆盖。点击文件→出现文件窗口的真机核对归 pm_acceptance 人工/test 冒烟 |

---

## 变更记录
| 日期 | 变更 |
|------|------|
| 2026-06-13 | 初稿:7 条 unit 用例覆盖 AC-1~5;含 QA-4(T-006)/QA-5(T-004)/QA-6(T-003)路由测试 + QA-1 旧测试迁移(T-003) |
