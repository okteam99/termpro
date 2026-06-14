---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: review
target_commit: 5c0141f
target_base: d42ccee
title: "TERMPRO-F260614081920-Close-Install-Confirmation · review stage external review"
generated_at: "2026-06-14T09:54:19Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
REVIEW-ACK review-claude-20260614T094948Z

```yaml
---
perspective: external-claude
target: code
generated_at: "2026-06-14T09:55:00Z"
files_read:
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/PRD.md
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TECH.md
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TC.md
  - src/main/exitConfirmation.ts
  - src/main/updateInstallDecision.ts
  - src/main/updater.ts
  - src/main/main.ts
  - src/renderer/components/Sidebar.tsx
  - src/main/__tests__/exitConfirmation.test.ts
  - src/main/__tests__/updaterInstallConfirmation.test.ts
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C5
    severity: low
    location: "src/main/updateInstallDecision.ts:24-26 / src/main/__tests__/updaterInstallConfirmation.test.ts (T-009)"
    issue: "`while (result.status === 'busy')` 安装确认重试循环没有任何测试覆盖；T-009 通过 deferred promise 直接 resolve 成 'canceled'，从未让 confirmInstallWhenIdle 返回 'busy'。"
    rationale: "该重试是 AC-3/AC-6 协调（锁忙→等待→再确认）的核心机制，且 confirmWhenIdle 在多 idle waiter 竞争下确实可返回 busy；未测意味着 busy 分支为未验证代码。"
    suggestion: "新增一条 T-009 变体：confirmInstallWhenIdle 第一次 mock 返回 {status:'busy'}、第二次返回 'canceled'/'confirmed'，断言最终走到取消恢复或 quitAndInstall，且无 cleanup/广播被提前触发。"
  - id: CR-2
    checklist: C6
    severity: low
    location: "src/main/updater.ts:330 (update-downloaded handler) / updateInstallDecision.ts:28-37"
    issue: "`console.log('[updater] downloaded, restarting to install')` 在确认弹窗之前无条件打印；用户选择“稍后”时应用并不会重启，日志与实际行为不符；且取消/确认两条决策路径都没有区分日志。"
    rationale: "现在 update-downloaded 不再必然导致重启，原日志变成误导信息；排障“升级为什么没装上”时缺少“用户取消安装”这一关键状态记录。"
    suggestion: "把该 log 改为中性措辞（如 'downloaded, awaiting install confirmation'），并在 updateInstallDecision 取消/确认两分支各加一行 log（canceled→restored available / confirmed→quitAndInstall）。"
  - id: CR-3
    checklist: C3
    severity: low
    location: "src/main/updater.ts:332 (version: latest?.version) / updateInstallDecision.ts:31 / src/renderer/components/Sidebar.tsx:66"
    issue: "update-downloaded 时若 latest 为 null（被并发 check() 或异常清空），version 为 undefined：取消分支广播 {state:'available', version: undefined}，UpdatePill 渲染为 “新版本 vundefined”，安装确认标题也回退为通用文案。"
    rationale: "version 取自可变模块级 latest，setInterval check() 在 installing 期间仍会运行并可改写 latest；undefined 透传到 UI 是可感知缺陷。"
    suggestion: "在 update-downloaded 入口对 latest/version 做存在性兜底（缺失即走 fallbackToReleasePage 或不广播 version），或在 UpdatePill available 文案对 undefined version 做保护。"
  - id: CR-4
    checklist: C2
    severity: low
    location: "src/main/updateInstallDecision.ts:28-33 (cancel 分支 cleanupInstallArtifacts) / src/main/updater.ts:46-53,273-297"
    issue: "取消安装时 cleanupInstallArtifacts() 关闭本地 feed server 并删除已下载 zip，但 Squirrel.Mac 此刻已 staged 该更新。重新点击升级会再次 downloadUpdate+serveForSquirrel+checkForUpdates，而 Squirrel 对“已 staged 更新”再次 checkForUpdates 的行为（可能立即/重复 emit update-downloaded，或使用陈旧 staged bundle）未被验证或在 TECH 风险表中说明。"
    rationale: "取消→再安装是本 Feature 的核心可重试路径，但其与 Squirrel.Mac 内部 staging 状态的交互只有单元 mock 覆盖，真实 re-arm 行为属未知；TC 的 Install Canceled/Ready UI 检查仍为 ⬜。"
    suggestion: "对 cancel→reinstall 做一次打包后的手工/smoke 验证，确认无重复 quitAndInstall 与无陈旧版本安装；并在 TECH 风险表补一行 Squirrel re-arm 假设与缓解。"
  - id: CR-5
    checklist: C1
    severity: info
    location: "docs/.../TECH.md L120-128 (接口表) vs src/main/exitConfirmation.ts:88-138"
    issue: "TECH 接口表把 confirmExit / confirmExitWhenIdle 列为 exitConfirmation.ts 的函数，实际实现导出的是 createExitConfirmationCoordinator() 工厂（返回 confirm/confirmWhenIdle）与 ExitLifecycleController 类，并无同名独立函数。"
    rationale: "功能等价但命名/形态与 TECH 描述漂移，后续按 TECH 检索接口会找不到对应符号。"
    suggestion: "更新 TECH 接口表为 createExitConfirmationCoordinator / ExitLifecycleController 的真实签名，保持文档与实现一致。"
  - id: CR-6
    checklist: C3
    severity: low
    location: "src/main/exitConfirmation.ts:141,156-169 (allowNextWindowClose) / src/main/main.ts:67-79,426-431"
    issue: "ExitLifecycleController 是 main.ts 模块级长生命周期单例，allowNextWindowClose 为实例状态并跨窗口重建存活；正常路径下 win.close() 会同步重发 close 事件把该标志复位，但若 close() 未同步发事件/窗口被销毁，标志可能残留 true，导致下一个（重建的）主窗口首次关闭被静默放行、跳过确认。"
    rationale: "失败模式正是本 Feature 要防的“无确认直接关闭/丢工作现场”，虽概率低但属安全检查被静默绕过。"
    suggestion: "将放行意图与具体窗口绑定（如用 WeakSet 记录待放行窗口）或在 createWindow 注册 close 时重置 allowNextWindowClose，避免单例标志跨窗口复用。"
  - id: CR-7
    checklist: C5
    severity: info
    location: "src/main/main.ts:59-92,425-449 / docs/.../TC.md L254-261 (UI 还原检查均为 ⬜)"
    issue: "main.ts 的实际接线（before-quit 注册、window-all-closed 的 allowNextQuitWithoutConfirmation、showMessageBox parent 适配器、confirmInstallWhenIdle 注入）仅靠隔离的 ExitLifecycleController/coordinator 单测间接覆盖，wiring 本身无测试；TC 的 Close/Quit 文案、Install Ready/Canceled、pill copy 四项 UI 还原检查仍为未勾选。"
    rationale: "纯函数与控制器逻辑测试充分，但集成正确性（事件挂在正确对象、参数传递、native dialog 模态行为）依赖人工/smoke，而该手工验证尚未记录完成。"
    suggestion: "补一次 smoke（含 TERMPRO_SMOKE bypass）+ 手工跑通 close/quit/install 取消与确认四路径，并回填 TC UI 还原检查与实现完整性报告，再进入收尾。"
findings_summary:
  blocker: 0
  high: 0
  low: 5
  info: 2
  total: 7
---
```

# 详情

整体实现质量良好：核心决策逻辑被正确拆成纯函数（`updateInstallDecision.ts`）与可注入控制器（`exitConfirmation.ts`），遵守了项目分层红线（UI 不碰 fs/pty/git、Host 零 Electron import、不改 protocol），取消/确认/锁忙三态语义清晰，watchdog 在确认前清理、确认锁区分 `busy` 与 `canceled` 等关键设计点都落实到位，且保留了原 `cleanupInstallArtifacts()`→`quitAndInstall()` 的既有时序，未引入回归。

无 blocker / high。主要可改进点集中在两类：

1. **测试盲区（C5）**：`busy` 重试循环、main.ts 接线、cancel→reinstall 真实路径均未被自动化或手工验证（CR-1、CR-4、CR-7）。鉴于 Squirrel.Mac re-arm 行为不可由 mock 证伪，建议收尾前补一次打包 smoke。

2. **边界与可观测性（C2/C3/C6）**：`version` undefined 透传到 UI（CR-3）、取消后 Squirrel staged 更新的二次安装行为未验证（CR-4）、单例 `allowNextWindowClose` 跨窗口重建的潜在静默放行（CR-6）、误导性 install 日志（CR-2）。

文档侧仅一处 TECH↔实现命名漂移（CR-5）。建议优先处理 CR-1/CR-4/CR-7 的验证缺口与 CR-3 的 undefined 兜底，CR-6 视改动成本酌情加固。
