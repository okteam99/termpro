---
reviewers: [fast]
review_models:
  - fast: grok-4.5
verdict: NEEDS_REVISION
coverage:
  fast: "实现↔PRD/UI（Login 入口、三项菜单、两栏嵌入、深链、Logout 文案）一致；简洁性：未再套 SettingsModal/RemoteHosts backdrop。测试真实性：SettingsEntry 新 IA 断言+postcommit 2132 passed。边界：RemoteHosts 二级 Esc 已拦，Browser Profile 存储迁移层 Esc 未拦 → F1。"
findings:
  - {id: F1, severity: MAJOR, status: open, title: "Profile 存储迁移二级层 Esc 会关掉整块 Settings 面板", source: fast}
  - {id: F2, severity: MINOR, status: deferred, title: "深链未单测 About→面板互斥", source: fast}
  - {id: F3, severity: MINOR, status: deferred, title: "嵌入无套娃 backdrop 缺显式断言", source: fast}
  - {id: F4, severity: NIT, status: rejected, title: "测试注释仍写独立 modal", source: fast}
---

# REVIEW · OKWORK-F260826061325-Account-Menu-Settings-Panel

execution: subagent（explore 隔离冷审 grok-4.5 · 主对话不喂实现心路）

## F1（MAJOR · open）

Profile `Change storage location` 使用 `browser-profiles__storage-backdrop`（`BrowserProfilesSection.tsx` ~733）但没有 document Esc 拦截。新建 Profile 表单有 `onFormKeyDown` + `stopPropagation`；存储迁移层没有。

`SettingsPanel.tsx` 在 `document` bubble 监听 Escape → `onClose`。因此存储迁移对话框打开时按 Esc 会卸掉全局面板（左导航一起没），违反 AC-3：「二级表单（…Profile 迁移确认等）Esc 在没有二级层时才关全局面板」。

RemoteHostsPage 已用 capture + `stopImmediatePropagation` 做对，此处未对齐。

**建议**：`storageProfile` 非空时 document capture 监听 Esc：`preventDefault` + `stopImmediatePropagation` + `closeStorageDialog()`。

## F2（MINOR · deferred）

`SettingsEntry.tsx` 深链 `setOverlay({ kind: 'panel', section: 'remoteHosts' })` 会顶掉 About。测试未覆盖「About 开着时深链」。不挡合并。

## F3（MINOR · deferred）

embedded 实现去掉了独立 backdrop，测试未 `querySelector` 断言 `.settings-modal__backdrop` / `.remote-hosts__backdrop` 不存在。不挡合并。

## F4（NIT · rejected）

注释过时，无行为影响。

## Verdict

NEEDS_REVISION — 修 F1 后再收口。
