---
reviewers: [fast]
verdict: APPROVE
reviewed_head: "a876eb9550611f1a888c4a0da90d3b77fdb0aac8"
reviewed_base: "c06e528c9f3b3cd7e4c8e8c42f8d026eef2f3a99"
coverage:
  fast:
    - "Architect：PRD/TECH/TC/UI 与 base..HEAD 实现、分层契约、数据流及简洁性反查"
    - "QA：新增测试真实性、边界/回归、错误处理、日志、并发与 generation 竞态"
    - "自主方向：Cookie/日志敏感数据边界、兼容迁移与离线恢复、资源清理"
    - "视觉：实际查看 real-app-browser-settings.png 与 panorama-browser-profiles.png，并核对 dev-visual-evidence"
    - "Round 2：F1 修复核实与 9dc1d2f..a876eb9 修复差异回归 —— F1 fixed，无新增 BLOCKER/MAJOR"
findings:
  - id: F1
    severity: MAJOR
    status: fixed
    title: "已 attach 的 Remote webview 在 generation 失效后可通过站内导航绕过 hydration gate"
    source: arch
---

# BL-008 Fast Review

Round 1 审读对象为 `c06e528c9f3b3cd7e4c8e8c42f8d026eef2f3a99..6cdcc32066505fced9a875a4031f665f7e3e93a6`；Round 2 范围锁定审读 `9dc1d2f7de2606e999bcc96a68f99f7555115d1c..a876eb9550611f1a888c4a0da90d3b77fdb0aac8`。已阅读 Feature 的 PRD、TECH、TC、UI、开发视觉证据及索引、项目 `project-specs/KNOWLEDGE.md`、完整变更集中的实现/测试和给定验证日志；未采纳其他评审结论。两张视觉证据实际显示了同一 520px Settings 壳层，新增 Profile 行的状态信息为行内脱敏文本，未见 Cookie 明文或面向用户的 `AUTHORITY`。

## F1 — 已 attach 的 Remote webview 在 generation 失效后可通过站内导航绕过 hydration gate

**质疑 false positive / ROI：** Chrome 地址栏、前进后退与刷新按钮确实都会先调用 `prepareActiveNavigation`，而 `will-attach-webview` 也会验证当前 generation 的 hydration。因此若所有导航都经这些入口，额外的 guest 导航拦截没有收益。

**代码实证（确定性输入与错误行为）：** 这个前提不成立。首次 mount 后，`ContinuityGatedWebview` 一旦进入 `ready`，其 effect 在 `gate.kind === 'ready'` 时直接返回，且组件 key 只含 tab、partition、UA，不含 Remote authority 或 generation：[BrowserPanel.tsx:304](/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/src/renderer/components/BrowserPanel.tsx:304)、[BrowserPanel.tsx:1223](/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/src/renderer/components/BrowserPanel.tsx:1223)。Renderer 的 prepare 仅包住地址栏与按钮入口：[BrowserPanel.tsx:855](/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/src/renderer/components/BrowserPanel.tsx:855)、[BrowserPanel.tsx:1033](/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/src/renderer/components/BrowserPanel.tsx:1033)。Main 仅在 attach 时检查 `isHydrated`：[main.ts:2212](/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/src/main/main.ts:2212)；对已 attach guest 的 `will-navigate` 只拦截非 HTTP(S) scheme，未验证 profile/generation/hydration：[main.ts:2302](/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/src/main/main.ts:2302)。

确定性复现：先让 Remote Profile 在 generation `g1` 完成 hydration 并创建 webview；随后 Host 断线/重连（或 Remote authority 切换）使当前 generation 不再是 `g1`；在这个既有页面点击普通 `<a href="https://site.example/next">`。该导航不调用 renderer 的 `prepareContinuity`，main 的 guest handler 也不阻断它，于是请求会在当前 generation hydration 完成前发出；离线时同样会发出请求。此行为直接违反 AC-1 的“每个当前 generation 完成 hydration 后才导航”和 AC-6 对新导航/重载继续受 gate 约束。现有 T-002/T-010 只测试 controller 的 `prepare` 与 `isHydrated`，而 BrowserPanel 测试明确不触及 webview 事件，故未覆盖该实际浏览器路径：[remoteProfileAuthority.test.ts:905](/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/src/main/__tests__/remoteProfileAuthority.test.ts:905)、[BrowserPanel.test.tsx:5](/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/src/renderer/components/__tests__/BrowserPanel.test.tsx:5)。

**Round 1 裁决：** 确认 MAJOR。它在正常网页点击、脚本导航或 authority/generation 改变后发生，破坏该 Feature 的核心 fail-closed 合同；不是仅限测试装置或既有基线的问题。

**修复建议：** 将“当前 Remote generation 已 hydration”变成 guest 每次主帧导航的 main-side 强制条件，而非仅 attach-time 条件。`will-navigate`（并覆盖 reload/其他主帧导航入口）在不满足条件时必须 `preventDefault()`，向 renderer 发固定、脱敏的 blocked 信号；renderer 以受控流程 `prepare → loadURL/retry` 恢复导航。同步在 authority/generation 改变时使 UI gate 失效（key/状态不能永久保留 `ready`）。补一条真实 guest-navigation 或等价 main event harness：`g1` attach → generation 变更/离线 → anchor 导航零请求 → `prepare` 成功后才允许请求；另覆盖 Local→Remote 和 Remote→Remote 迁移后的既有 tab。

**Round 2 修复核实：** `a876eb9` 新增 main-side guest navigation guard，并把 `will-navigate` 与 `will-redirect` 都接入同步 fail-closed。每次事件动态读取 catalog authority/current generation；未 hydration 立即阻断，prepare 完成后仍须满足同 Host、同 generation、当前 tuple 已 hydration、最新 URL token、guest 存活，才以 `guest.loadURL` 单次重放。Local/Remote 动态迁移、旧 generation/Host 结果、重复事件、redirect、销毁和非法 scheme 均有确定性测试。隔离验证档只静态复核 F1 与修复 diff，结论为 fixed，且未发现新 BLOCKER/MAJOR；详见 `external-cross-review/review-gpt-5.6-terra.md`。

## 总体结论

**APPROVE**。F1 已按当前 authority/generation 的 main-side 强制门修复并完成范围锁定复核；所有 BLOCKER/MAJOR finding 均已关闭，修复差异未引入新的阻断问题。Host ledger、加密 journal、严格 RPC、脱敏 DTO/日志、迁移 epoch 与视觉呈现的其余静态审读同样无阻断项。
