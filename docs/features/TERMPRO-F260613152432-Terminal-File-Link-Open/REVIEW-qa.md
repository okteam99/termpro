---
role: qa
review_scope: code-review
execution: subagent
verdict: APPROVE
target_commit: 56cff61
files_read:
  - src/renderer/terminal/terminalLinks.ts
  - src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
  - src/renderer/terminal/__tests__/terminalWebLinks.test.ts
  - src/renderer/filepanel/locateRegistry.ts
  - docs/features/TERMPRO-F260613152432-Terminal-File-Link-Open/PRD.md
  - docs/features/TERMPRO-F260613152432-Terminal-File-Link-Open/TC.md
---

# REVIEW-qa(TERMPRO-F260613152432-Terminal-File-Link-Open)

verdict: **APPROVE** · AC 逐条对照实现 + 测试均成立

## AC 对照

- **AC-1**(目录定位优先):✅ T-004(handler 被调 + 无 fallback)/ T-005(locate=false → openPath)。旧「no handler」「locate rejects」两测试虽删,但三条件都汇到 `tryLocateInFilePanel` 的 `located=false` 分支(locateRegistry.ts:22-33),净行为不变,T-005 已覆盖。
- **AC-2**(文件按 SYSTEM_OPEN_EXT 直开):✅ T-001(.tsx→openViewerWindow)/ T-002(.mp4→openPath),均断言 handler 未被调(回归会红)。
- **AC-3**(根内文件不再 location-only · 旧测试迁移):✅ T-003;`git grep "keeps repository"` 零命中,旧 location-only 断言确已移除。
- **AC-4**(:line:col 用 stripped 路径):✅ T-006 真端到端——stub `hostClient.rpc`,造 `FsLinkProvider`,`provideLinks`→activate,断言 `openViewerWindow` 收 `/repo/src/App.tsx`(无 :42:10)。若移除 stripLineCol 或误传 c.text 会红。
- **AC-5**(web 不变):✅ T-007(terminalWebLinks.test.ts),`openExternal` 调用 + windowOpen/confirm 未调,且 web 激活路径不在 diff 内。

## Findings

- **QA-3(low)→ 已修复(advisory · 非 NEEDS_REVISION)**:原 T-001/T-002 硬编码扩展名,违反 AC-2「测试应 import SYSTEM_OPEN_EXT 而非硬编码」。**裁决 ADOPT**(质疑:把常量塞测试是否多余?回读 AC-2〔QA-R2-2 采纳的条款〕确为本 feature 自定要求,且能防 PRD 列表与代码漂移 → 确为真)。修复:`terminalLinks.ts` 导出 `SYSTEM_OPEN_EXT`,T-001/T-002 加边界锚定断言 `SYSTEM_OPEN_EXT.test(path)===false/true`,测试现引用权威常量。typecheck 0 + 7 测试绿。
- 其余 QA-1/2/4/5/6/7 = APPROVE 确认项(见 AC 对照),无动作。
