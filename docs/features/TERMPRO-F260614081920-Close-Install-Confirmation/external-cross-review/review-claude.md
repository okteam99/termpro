---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: review
target_commit: 75b35ba
target_base: d42ccee
title: "TERMPRO-F260614081920-Close-Install-Confirmation · review stage external review"
generated_at: "2026-06-14T10:28:12Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
I have a comprehensive view of the change set. Here is my independent review.

```yaml
---
perspective: external-claude
target: code
generated_at: "2026-06-14T10:26:00Z"
files_read:
  - src/main/exitConfirmation.ts
  - src/main/updateInstallDecision.ts
  - src/main/updater.ts
  - src/main/main.ts (diff vs main)
  - src/renderer/components/Sidebar.tsx (diff vs main)
  - src/main/__tests__/exitConfirmation.test.ts
  - src/main/__tests__/updaterInstallConfirmation.test.ts
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TECH.md
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C5
    severity: high
    location: "src/main/updater.ts:281-340,371-376 (no test); src/main/__tests__/updaterInstallConfirmation.test.ts only covers pure handleDownloadedUpdateForInstall"
    issue: "The stateful integration glue in updater.ts — installingVersion snapshot, the readyToInstallVersion reuse short-circuit (L318-321), and the update-downloaded→confirmReadyToInstall wiring (L371-376) — has zero automated coverage. The pure decision fn is tested, but the module-level state machine that drives it is not."
    rationale: "TECH §关键边界/风险 calls out the staged-reuse retry and version-drift snapshot as the riskiest behaviors, and they live entirely in this untested glue. A regression in the readyToInstallVersion===version branch (wrong version, skipped download, stale reuse) would ship green, and this path is nearly impossible to exercise by hand."
    suggestion: "Extract the install:install IPC handler + update-downloaded handler over injected updater state (or refactor the module state behind a small testable object) and add tests for: (a) cancel→re-click same version reuses staged install without re-download, (b) cancel→newer version found→full re-download, (c) installingVersion snapshot is used (not latest) after latest drifts."
  - id: CR-2
    checklist: C3
    severity: low
    location: "src/main/updateInstallDecision.ts:40 + src/main/updater.ts:298-301,318-321"
    issue: "On cancel, handleDownloadedUpdateForInstall calls cleanupInstallArtifacts() which closes the local feed server and deletes the temp zip; the reuse retry path then calls autoUpdater.quitAndInstall() relying solely on Squirrel's internal staged copy, with no re-validation that the staged update still exists."
    rationale: "Reuse correctness depends on an undocumented Squirrel.Mac assumption (staged copy survives across a cancel+cleanup in the same process). If that assumption is wrong, quitAndInstall() fails and the only recovery is the catch→fallbackToReleasePage. This is the highest-risk path and is unverified (see CR-1)."
    rationale_note: "Likely correct for Squirrel.Mac since ShipIt stages on update-downloaded, but it is an implicit invariant."
    suggestion: "Document the Squirrel staging invariant in a comment at the reuse branch, and treat a quitAndInstall failure on the reuse path as a first-class recoverable state (it already falls back, but a test/log asserting this is the intended recovery would harden it)."
  - id: CR-3
    checklist: C6
    severity: low
    location: "src/main/updater.ts:317 (broadcast 'checking') + :282 + updateInstallDecision.ts:26 (log)"
    issue: "On the reuse retry, the handler broadcasts state:'checking' (UI: '正在连接更新源…') and logs '[updater] downloaded, awaiting install confirmation', though nothing is downloading/connecting — it is only awaiting user confirmation of an already-staged update."
    rationale: "Misleading UI state and log text on the retry path make field diagnosis harder and momentarily show the wrong status to the user; the message does not match the actual lifecycle stage."
    suggestion: "On the readyToInstallVersion===version branch, skip the 'checking' broadcast (or broadcast a confirm-pending state) and log a distinct message like 'reusing staged update, awaiting confirmation'."
  - id: CR-4
    checklist: C3
    severity: low
    location: "src/main/updater.ts:388 (setInterval check) vs :390-394 (focus check gated on !installing)"
    issue: "The periodic setInterval(check) is not gated on `installing`, unlike the focus-triggered check. Because the watchdog is cleared on update-downloaded, the install-confirmation dialog can stay open indefinitely; a periodic check() during that window can overwrite `latest` and broadcast available(newVersion), flipping the pill out of its disabled state mid-confirmation."
    rationale: "The installingVersion snapshot protects install correctness, but not renderer state: the user could see 'new version available' re-enable the pill while their confirm dialog for the prior version is still open. Pre-existing check() was harmless when installing was momentary; the new long-lived confirm window widens the race."
    suggestion: "Gate the interval check() (and/or broadcast in check()) on `!installing`, consistent with the focus handler, so no update events are emitted while an install confirmation is pending."
  - id: CR-5
    checklist: C2
    severity: low
    location: "src/main/exitConfirmation.ts:177-184,195-203 (requestAppQuit / handleWindowClose)"
    issue: "Both attach `.then(...)` to confirmExit() with no `.catch`. If the injected showMessageBox / dialog.showMessageBox rejects, the rejection is unhandled (the coordinator lock is released via finally, so no deadlock, but the error path is silent)."
    rationale: "C2 'assumes-always-succeeds': the dialog promise is treated as infallible. An unhandled rejection in main can surface as a process-level warning/crash depending on Electron config, and the failure is neither logged nor recovered."
    suggestion: "Add `.catch((err) => this.log(...))` to both handlers; on dialog error default to the safe outcome (do not quit / keep window open)."
  - id: CR-6
    checklist: C1
    severity: info
    location: "src/main/main.ts:58-60 (before-quit→handleAppBeforeQuit) + src/main/exitConfirmation.ts:206-208; TECH.md §258"
    issue: "App-quit confirmation only triggers from the macOS menu / Cmd+Q. Dock right-click 'Quit' and other OS-level terminations flow through before-quit, which intentionally only marks quitting (to avoid blocking logout/shutdown), so those quit paths show no confirmation."
    rationale: "This is a deliberate, documented trade-off (Electron cannot distinguish Dock-Quit from OS shutdown on before-quit), but it means 'quitting always confirms' is not literally true — worth explicit PRD/AC sign-off so it is a known gap, not a silent miss."
    suggestion: "Confirm with the PRD owner that no-confirmation on Dock-Quit/OS-quit is acceptable, and note this residual explicitly in the AC so QA does not file it as a defect."
findings_summary:
  blocker: 0
  high: 1
  low: 4
  info: 1
  total: 6
---
```

# 详情

整体实现质量较高：确认锁的 `confirmed | canceled | busy` 三态语义清晰，`WeakSet` 绑定 per-window 放行、`isQuittingConfirmed` 防二次弹窗、`installingVersion` 版本快照、`rollbackQuitAndInstall` 同步失败回滚等关键边界都已覆盖，纯决策函数 `handleDownloadedUpdateForInstall` 的单测也较完整（取消/确认/锁忙重试/installing 已清除忽略/quitAndInstall 抛错回滚）。与 TECH.md 的关键路径一致（C1 基本对齐），未触碰 HostService 协议与 fs/pty/git 红线（C4 通过）。

主要遗漏集中在两点：

1. **测试覆盖的"最后一公里"缺口（CR-1，high）**：被测的是抽离出的纯函数，而真正承载文档化高风险行为（staged-reuse 重试、version 漂移快照、update-downloaded 接线）的 `updater.ts` 模块级状态机没有任何自动化测试。这正是手工 QA 最难触达、回归后果最直接（装错版本/装不上）的部分。建议把 IPC/事件处理也做成可注入状态的形态并补测三条 reuse/drift 路径。

2. **取消→复用路径的隐式不变量与状态噪声（CR-2/CR-3/CR-4）**：取消已 `cleanupInstallArtifacts()`（关本地 feed、删 zip）后，复用路径完全依赖 Squirrel 内部 staged 副本仍然有效——大概率成立但属未声明不变量；同路径还会广播误导性的 `checking` 状态、且 watchdog 清零后确认弹窗可无限停留，期间未被 `installing` 门控的周期 `check()` 可能改写 `latest` 并把胶囊从禁用态翻回可点。这些都不阻断主流程但值得收口。

CR-5 是 dialog promise 无 `.catch` 的健壮性小洞；CR-6 是 Dock/OS 退出不弹确认这一已记录的设计取舍，建议在 AC 里显式签字以免被当缺陷。

无 blocker。建议优先补 CR-1 的 reuse/drift 集成测试，再顺手处理 CR-4 的 `check()` 门控。
