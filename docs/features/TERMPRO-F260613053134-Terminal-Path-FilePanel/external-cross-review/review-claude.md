---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: review
target_commit: 1d932fca40400d5c960a3eef8215731f70c4e43b
target_base: main
title: "TERMPRO-F260613053134-Terminal-Path-FilePanel · review stage external review"
generated_at: "2026-06-13T07:12:49Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
REVIEW-ACK review-claude-20260613T070618Z

```yaml
---
perspective: external-claude
target: code
generated_at: "2026-06-13T07:11:00Z"
files_read:
  - docs/features/TERMPRO-F260613053134-Terminal-Path-FilePanel/TECH.md
  - src/renderer/filepanel/controller.ts
  - src/renderer/filepanel/core.ts
  - src/renderer/filepanel/pathContainment.ts
  - src/renderer/filepanel/locateRegistry.ts
  - src/renderer/filepanel/types.ts
  - src/renderer/filepanel/deps.ts
  - src/renderer/filepanel/useFilePanel.ts
  - src/renderer/filepanel/__tests__/locateTarget.test.ts
  - src/renderer/components/FilePanel.tsx
  - src/renderer/components/FilePanel.css
  - src/renderer/terminal/terminalLinks.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/renderer/terminal/terminalLinkParse.ts
  - src/host/fsService.ts
  - src/host/host.ts
  - src/shared/protocol.ts
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C2
    severity: high
    location: "src/renderer/filepanel/controller.ts:336 (loadLocateChain → matchEntry)"
    issue: "matchEntry is always invoked with { darwinTrusted: true }; there is no platform/volume gate anywhere in the renderer (grep for process.platform/navigator/darwin returns only this literal)."
    rationale: "TECH §Path segment matching pt 4 & 6 restricts case-fold to darwin on a proven case-insensitive volume ('非 darwin...不做任意 lower-case 猜测'). Host is explicitly remote-ready (Linux) and APFS can be case-sensitive; on such volumes exact+NFC fail then case-fold matches a *different* file, so the panel locates/highlights the wrong row."
    suggestion: "Gate darwinTrusted on actual host platform (e.g. hostClient.info platform === 'darwin') rather than hardcoding true; on case-sensitive hosts return false on a missing exact/NFC row and fall back."
  - id: CR-2
    checklist: C1
    severity: high
    location: "src/renderer/filepanel/controller.ts (loadLocateChain dir branch) + core.ts applyLocateCommit"
    issue: "For a directory target the target dir is added to requiredExpanded but its children are never read into cacheDelta and applyLocateCommit emits no fetchChild for it. flattenTree (FilePanel.tsx:140) only renders children when cache.get(absPath) exists, otherwise nothing."
    rationale: "loadLocateChain reads each segment's PARENT entries; the leaf dir's own children are never loaded, and commit only emits stopWatch/startWatch/fetchStatus/persist. Result: the located directory shows as an empty expanded folder until an unrelated watcher/refresh — TECH §Ancestor loading pt 7 / AC T-005 ('expands_directory_target_itself') is visibly broken and untested."
    suggestion: "In applyLocateCommit emit { k:'fetchChild', root, absPath:targetDir } for a dir target whose children are absent from cache/cacheDelta (mirror seedExpanded/toggleDir), or have loadLocateChain read the target dir's entries into cacheDelta."
  - id: CR-3
    checklist: C5
    severity: high
    location: "src/renderer/filepanel/__tests__/ (only locateTarget.test.ts has 4 cases) + missing terminal/RTL/integration tests"
    issue: "37 TCs are listed in TECH but only ~6 are exercised. No terminal-routing test (T-001/006/016/021/028/030-034), no cross-mode store-inputs re-feed integration (T-017/018), no FilePanel render/scroll/highlight RTL (T-019/024/036), no realpath-escape (T-020), no live-cache-merge (T-025), no directory-target (T-005), no macOS case/unicode locate (T-023)."
    rationale: "The riskiest behaviors — terminal await-before-fallback routing, cross-mode locateCommit not re-triggering applyRootChange, symlink trust rejection, one-shot scroll — are entirely unverified, so regressions in exactly the concurrency/trust paths this feature is built around would pass CI."
    suggestion: "Add the missing TC files (terminalLinkFilePanelRouting, locateTarget.integration with a real reduce + inputs re-feed fake store, FilePanel RTL highlight/scroll, realpath-escape, dir-target). At minimum cover T-005, T-017/018, T-020 before merge."
  - id: CR-4
    checklist: C3
    severity: low
    location: "src/renderer/filepanel/controller.ts:138-145 (locateTarget stale → return true)"
    issue: "When the request is staled by a non-locate event (refresh, tab change, pollTick cwd drift) rather than a newer locate, locateTarget still resolves true, which suppresses the terminal fallback."
    rationale: "A background refresh/watcher firing during the brief readdir window clears activeLocateRequestId; the in-flight click then neither locates nor falls back, so the user's click is silently dropped (next click works). Last-click-wins assumes a newer click will handle it, but refresh/drift is not a newer click."
    suggestion: "Distinguish 'superseded by newer locate' (return true) from 'staled by refresh/tab/drift' (return false so terminal fallback still opens the target), e.g. track whether a newer activeLocateRequestId was issued vs. cleared to null."
  - id: CR-5
    checklist: C6
    severity: low
    location: "src/renderer/filepanel/controller.ts (loadLocateChain only logs 'missing-row')"
    issue: "Only the missing-row fallback logs console.warn('[filepanel] locate fallback', ...). Containment-fail, realpath-null/escape, and a mid-chain readdir throw (uncaught → caught by tryLocateInFilePanel) fall back silently."
    rationale: "TECH risk table promises console.warn('[filepanel] locate fallback', reason) for failures; without it, diagnosing why a click silently opened the old fallback (especially symlink-escape or realpath-null) is hard in the field."
    suggestion: "Log the trustedContainment reason and a 'readdir-failed' reason (wrap readdir in try/catch) before returning false, keeping paths desensitized as TECH specifies."
  - id: CR-6
    checklist: C1
    severity: info
    location: "src/renderer/terminal/terminalLinks.ts:36-46 + controller.ts chooseLocateCandidate"
    issue: "FilePanelLocateTarget.sourceTabId is populated but never validated; the active-tab guard relies solely on registry keying (handler only registered for activeTabId)."
    rationale: "TECH data structure states 'sourceTabId 必须等于 active tab id'. The structural guard is correct in practice, but the documented explicit check is absent, so the field is dead weight and a future refactor that decouples registry keying loses the guard."
    suggestion: "Either drop sourceTabId from the type, or assert sourceTabId === current active tab inside the handler to make the invariant explicit."
findings_summary:
  blocker: 0
  high: 3
  low: 2
  info: 1
  total: 6
---
```

# 详情

实现整体与 TECH 一致度较高:`locateCommit` 单事务跨 mode 切换、stale gate(requestId+generation)、display-segment 优先(T-037)、realpath symlink-escape 信任门(`trustedContainment` reason='realpath-outside-root')都按设计落地,跨 mode commit 后 runtime `inputs.mode` 先更新使后续 `inputs` 事件命中全等短路(core.ts:398-406)也验证通过。

最该在合并前处理的三条:

- **CR-2(目录定位空展开)**:文件 target 正确,但目录 target 被展开却不拉子项,是一个核心 AC(T-005)的可见破窗,且无测试兜底。建议优先修。
- **CR-1(case-fold 未门控)**:在"远程就绪"红线下,Linux remote / case-sensitive APFS 上会定位到错文件,且与 TECH 显式约束相悖。
- **CR-3(测试缺口)**:37 条 TC 仅约 6 条落地,terminal 路由 / 跨 mode 集成 / realpath-escape / RTL 滚动高亮均未覆盖——这些恰是本 feature 风险最高的并发与信任路径。

CR-4/CR-5 为健壮性与可观测性边角,CR-6 为契约清理,可按需处理。
