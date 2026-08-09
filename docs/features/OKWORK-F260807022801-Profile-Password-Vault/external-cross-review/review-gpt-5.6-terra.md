---
perspective: external-claude
target: code
generated_at: "2026-08-10T00:00:00Z"
review_model: gpt-5.6-terra
review_via: subagent
target_commit: 35e26a9
target_base: 48bf211
files_read:
  - docs/features/OKWORK-F260807022801-Profile-Password-Vault/external-review-prompts/review-subagent-review-20260809T182857Z.md
  - docs/features/OKWORK-F260807022801-Profile-Password-Vault/PRD.md
  - docs/features/OKWORK-F260807022801-Profile-Password-Vault/TC.md
  - src/main/passwordVaultIpc.ts
  - src/main/main.ts
  - src/main/browserProfileDeletion.ts
  - src/main/browserProfileStore.ts
  - src/main/passwordVaultController.ts
  - src/main/__tests__/browserPasswordIpc.test.ts
  - src/main/__tests__/browserProfileDeletion.test.ts
  - src/main/__tests__/browserPasswordSecurity.test.ts
  - src/renderer/components/settings/BrowserProfilesSection.tsx
  - src/renderer/components/settings/BrowserProfilesSection.css
  - src/renderer/components/settings/SavedPasswordsPage.tsx
  - src/renderer/components/settings/__tests__/BrowserProfilesSection.test.tsx
  - src/renderer/components/browser/PasswordStatusBar.tsx
  - src/renderer/components/browser/PasswordStatusBar.css
  - src/renderer/components/passwords/TrustedPasswordWindow.tsx
  - src/shared/i18n.zh.ts
  - e2e/password-vault.e2e.cjs
coverage:
  - inactive-profile-fail-closed
  - trusted-window-revocation
  - disclosure-three-surfaces
  - test-traceability
  - regression-safety
findings:
  - id: CR-1
    checklist: C5
    severity: low
    location: "docs/features/OKWORK-F260807022801-Profile-Password-Vault/TC.md:448; e2e/password-vault.e2e.cjs:376-384"
    issue: "修订后的 FE-E2E-001 宣称普通 Saved Passwords 页面验证 DOM/Agent 与 clipboard 两类披露，但实际旅程只断言该页的 DOM/Agent 文案；没有断言普通管理页的 clipboard 文案。"
    rationale: "35e26a9 新增的 TC 验证点把 clipboard 风险列入普通管理页，而脚本只检查 DOM exposure；编译产物检查也不能证明该页面实际接线。"
    suggestion: "在真实 Saved Passwords 页面补充 clipboard disclosure 的精确断言。"
findings_summary:
  blocker: 0
  high: 0
  low: 1
  info: 0
  total: 1
---

# Round 2 verification

- AC-7 fail-closed：删除协调器先持久化 `deleting`，随后才调用禁用动作；`isActive` 对 `deleting` 与 `delete_failed` 均为 false。IPC metadata 会过滤 inactive Profile；打开可信窗会拒绝；trusted context、grant、reveal、copy 都经 `trustedEntry()` 的实时 active 检查。删除主接线同时关闭 guest、关闭该 Profile 的可信窗并广播 metadata 变化。
- 可信窗撤销与反例挑战：删除前已签发的 reveal proof 仍会在 `consumeTrustedAction()` 的首次 active 校验失败后被拒绝；删除动作也清除该 sender 的 proof 映射并关闭窗口。单线程 IPC 调用内的 decrypt/copy 没有异步 `await` 点，因此没有“校验后、解密前”被 deletion IPC 抢占的确定性竞态。
- 三处披露：Browser Profiles 与 PasswordStatusBar 均真实渲染新增的显式 clipboard 风险文本并有中文映射；Saved Passwords 页面原有 DOM/Agent 与 clipboard 两项常驻 disclosure 未被破坏。状态栏 disclosure 在 idle 状态仍挂载。
- 回归安全：`closeProfileTrustedWindows()` 在关闭前清除 entry/profile/proof 映射；closed 回调的重复清理安全。全部 `registerPasswordVaultIpc` 调用点已提供新增的 `isProfileActive` 依赖。新增 IPC 测试覆盖 metadata/open/context/grant/reveal/copy 与删除前 proof 的反例。
- TC 的 fresh-build 纵向旅程与脚本的保存、重访填充、非空保护、metadata 脱敏、可信 reveal/copy、自动重遮和 clipboard 恢复一致；Profile 隔离、删除失败、条件清理已明确移交可注入 integration tests。唯一不一致为 CR-1。

结论：FAIL（仅 CR-1 low；F1/F2/F3 修复成立）。
