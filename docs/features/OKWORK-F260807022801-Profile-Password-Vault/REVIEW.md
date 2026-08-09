---
reviewers: [fast]
verdict: NEEDS_REVISION
coverage:
  fast: "Architect 实现↔设计/简洁性 + QA 测试真实性/边界/错误日志并发 + 自主方向：审过三类 IPC、Profile/origin 隔离、原子 Vault、删除状态机、生命周期、UI 三页接线、T-001..T-012 与实跑证据；见 F1-F3，并对其余方向查过无同级发现"
findings:
  - {id: F1, severity: BLOCKER, status: open, title: "Profile 删除失败后，普通/可信 IPC 仍可显示、解密和复制该 Profile 的密码", source: arch}
  - {id: F2, severity: BLOCKER, status: open, title: "Profile 设置和浏览器 chrome 缺少系统剪贴板导出风险的常驻披露", source: qa}
  - {id: F3, severity: MINOR, status: open, title: "TC 声称的 T-012 多账号、Profile 隔离、剪贴板条件清除和删除重试 Browser E2E 未实际执行", source: qa}
---

# BL-006 Review Round 1（fast：Architect + QA）

## 执行方法

静态审读 `e64c75d..a4ffb74` 的完整变更清单和关键实现：`LocalPasswordVault`、`PasswordVaultController`、`passwordVaultIpc`、`BrowserProfileDeletionCoordinator`、剪贴板租约、main 接线、两类 preload、Profile/partition policy，以及 Settings、OkBrowser chrome 与可信窗口。逐条对照 PRD AC-1..AC-9、TECH、TC、UI、KNOWLEDGE 的 RD-1..RD-14 和 review-stage 契约；没有运行 npm/typecheck/E2E/package。

## Coverage 结论

### Architect：实现、边界与简洁性

- AC-1..AC-5 的主链路总体对齐：Profile/origin 从已注册 guest 的 sender URL 推导；`canonicalPasswordOrigin` 仅放行 HTTPS 与 loopback HTTP；候选 nonce、same-profile/origin settle、空字段保护、safeStorage 密文与原子 tmp→fsync→rename 均有明确实现。损坏文档不回写为空，且同步文件操作避免了单 main 进程写入交错。
- 三类 IPC 的常态边界基本成立：普通 preload 只有 metadata/delete/open；guest 固定 preload 不向网页暴露；可信窗的 proof 是 sender/action/单次/5 秒绑定，普通 renderer 没有 reveal/copy/decrypt channel。main 的 will-attach 也先删除 renderer 指定 preload，再按已知 Profile×出口分区固定注入 guest preload；Viewer 不走该 bridge。
- 删除状态机的骨架、in-flight 去重、重启续跑和 cache/storage 的逐步清理符合 TECH，也避免了为 BL-007 预建 provider/远端双写。可是 F1 说明「Profile inactive」只被 guest 路径落实，未成为 Vault metadata/可信窗的一致闸门，破坏 AC-7 的核心不变式。
- 资源生命周期无额外 BLOCKER：guest 注销会清 pending/timer，剪贴板租约只保留 digest + generation 且退出时条件清理，可信窗在 app quit 时收口。未发现为安全而无收益地重复建立 provider、数据库或站点规则引擎。

### QA：测试真实性、错误/日志/并发与 UI

- T-001..T-011 都是实际断言而非 `if` 跳过：T-005 读真实落盘文本并重建 Vault；T-007/clipboard 测「未改写清除、改写保留」；T-008 覆盖状态持久化、重启与 in-flight 去重；T-010/T-011 分别检查 sender boundary/哨兵脱敏。没有发现 RD-9..RD-14 型静默绿灯。
- 但 T-008 仅把 cache 清理注入失败，因而 Vault 已被删；它不覆盖 `clearVault` 失败后 Vault 内容仍在、Profile 已 inactive 时的 ordinary/trusted IPC，未能抓到 F1。T-010 和 IPC 测试也以 `isProfileActive: () => true` 建构，缺失这一 fail-closed 组合断言。
- T-012 是真实 Electron/Playwright 脚本而非源码快照：它校验新 preload 产物，驱动 loopback 登录、重访填充、普通列表和真实可信窗 click/reveal/copy，并在 finally 恢复系统剪贴板。现有 `state.json` 记录 dev 已实跑「1739 passed, 87 skipped；typecheck 0；fresh Forge + T-012 PASS」。本审按契约未重跑。其 E2E 场景与 TC 所述范围不一致，见 F3。
- UI 的入口没有代码层断裂：Settings → Browser Settings → Saved Passwords、普通列表→可信独立窗、BrowserPanel 的 status→原生账号菜单均已接通；mask/loading/error/empty 与隔离 click 行为也存在。反向对照 UI.md 的“三页常驻披露”后发现 F2。

## Findings

### F1 — BLOCKER：Profile 删除失败后，普通/可信 IPC 仍可显示、解密和复制该 Profile 的密码

**质疑。** 成功删除时 `clearVault` 会同步删文件，表面上没有可观察窗口；若只是微任务时序猜测，不应定为 BLOCKER。

**代码实证。** 可复现的是持久失败分支，而非时序假设：`BrowserProfileDeletionCoordinator.performCleanup()` 在 `clearVault` 抛错时转入 `persistFailure()`，将 Profile 持久化为 `delete_failed`（`src/main/browserProfileDeletion.ts:170-178,210-232`）。生产接线的 `clearVault` 仅调用 `passwordVault.deleteProfile(profileId)`，所以 I/O/权限失败会保留原 Vault 文档（`src/main/main.ts:254-259`）。

此后 `disableProfileAccess` 只调用 `passwordVaultController.closeProfileGuests()`（`src/main/main.ts:254-257`）；它会阻止/关闭 guest，但不撤销可信窗口。普通 `listMetadata`、`openTrusted` 直接访问 `deps.vault`，没有 Profile active 判定（`src/main/passwordVaultIpc.ts:93-105,126-182`）；可信窗的 context/reveal/copy 同样只按 entry/sender/proof 取 `deps.vault.getDecrypted()`（`src/main/passwordVaultIpc.ts:207-258`）。`SavedPasswordsPage` 会渲染返回的条目并允许打开可信窗（`src/renderer/components/settings/SavedPasswordsPage.tsx:323-375`）。

因此只要 Vault 清理这一步失败，Profile 已按要求不可用却仍可由主窗列出，且真实可信点击可 reveal/copy 明文；这直接违背 AC-7 的“删除中/失败后不参与显示或复制”。T-008 的故障注入在 cache 而非 Vault，故不能证明该分支安全。

**裁决。** confirmed，BLOCKER（AC-7/P0 安全边界）。修复应把 active Profile 判定置于普通 metadata、openTrusted、trusted context/action/reveal/copy 的 main 权威门；删除开始时撤销/关闭该 Profile 已开的可信窗，并在状态变化时广播 metadata。新增一个 `clearVault` 失败的端到端 IPC/状态机集成用例，断言 list 过滤、open/reveal/copy 全部 fail-closed，重试成功前始终如此。

### F2 — BLOCKER：Profile 设置和浏览器 chrome 缺少系统剪贴板导出风险的常驻披露

**质疑。** 可信窗口在 Copy 按钮前确实说明“Other apps and ordinary OkWork pages may read it”（`TrustedPasswordWindow.tsx:275-303`），Saved Passwords 也有 DOM 与 clipboard 两栏说明（`SavedPasswordsPage.tsx:397-412`）；若 PRD 只要求复制前提示，则不构成问题。

**代码实证。** PRD AC-8 明确要求 DOM 和 clipboard 两种导出面“都在 Profile 设置、密码管理页和浏览器状态中明确披露”（`PRD.md:120`），UI.md 也将其标为“三页常驻披露”（`UI.md:48`）。实际 Profile 设置只有填入后网站/Agent 可读（`BrowserProfilesSection.tsx:143-146`），Browser chrome 也只有页面/Agent DOM 可读（`PasswordStatusBar.tsx:122-126`）；两处没有 clipboard/ordinary renderer/other app 风险。只有 Saved Passwords 与可信窗说明了这一边界。

**裁决。** confirmed，BLOCKER（AC-8/P0 的用户安全披露）。在 Profile section 和 `PasswordStatusBar` 增加本地其他应用及普通 OkWork renderer 可读取“用户主动复制后”的常驻说明，保持和可信窗的 60 秒条件清除事实一致；补 UI/组件或 E2E 断言三处同时存在两类文案。

### F3 — MINOR：TC 声称的 T-012 Browser E2E 覆盖没有落到脚本

**质疑。** T-012 的 frontmatter 只承诺 AC-1/3/6/8，且 Profile 删除、租约条件清除已有 T-007/T-008 integration；这不降低当前产品实现的确定性。

**代码实证。** TC 的 FE-E2E-001 至 003 把多账号切换/Profile B 隔离、筛选与 60 秒改写保护、删除失败→重试列为 T-012 Browser E2E（`TC.md:375-497`）。`e2e/password-vault.e2e.cjs` 实际只保存/重访 alice、检查预填字段、打开普通列表、可信 reveal/copy（`e2e/password-vault.e2e.cjs:301-432`）；没有创建 bob/Profile B、没有操作筛选、没有等待或改写 clipboard，也没有故障注入删除与重试。

**裁决。** confirmed，MINOR（测试计划/实跑证据的可追溯性，不单独阻塞 AC）。要么实现这些 E2E journeys，要么收窄 TC 的 T-012 场景和验收表，明确其余由 T-007/T-008 integration 覆盖；无论选择哪种，都应更新实跑证据的覆盖说明。

## 简洁性 counter-lens

本轮不建议为 F1 提取 Vault provider、引入数据库、向 renderer 下发 deletion ACL 快照，或把可信密码交给普通 UI 再二次屏蔽：这些都扩大了 P0 明文面或提前实现 BL-007。最小正确修复是在 main 的既有 Profile activity authority 上复用一个一致的 entry→profile active guard，并使删除协调器拥有该 Profile 的可信窗口撤销回调；让普通列表只消费过滤后的 metadata。F2 只需复用现有 i18n disclosure 文案，不需要新增状态机。

## 最终 verdict

**NEEDS_REVISION**。F1、F2 均是确定性 P0 AC/安全违约；修复并补相应组合测试后再进入验证轮。F3 可同轮修复或作为随行 MINOR，但不能用来替代 F1/F2 的安全收口。
