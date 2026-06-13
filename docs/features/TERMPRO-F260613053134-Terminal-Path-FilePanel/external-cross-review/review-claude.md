---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: review
target_commit: 2bf092b
target_base: main
title: "TERMPRO-F260613053134-Terminal-Path-FilePanel · review stage external review"
generated_at: "2026-06-13T07:42:24Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
REVIEW-ACK was emitted. Findings below.

```yaml
---
perspective: external-claude
target: code
generated_at: "2026-06-13T07:37:04Z"
files_read:
  - src/host/fsService.ts
  - src/host/host.ts
  - src/host/__tests__/fsService.test.ts
  - src/shared/protocol.ts
  - src/renderer/filepanel/pathContainment.ts
  - src/renderer/filepanel/locateRegistry.ts
  - src/renderer/filepanel/controller.ts
  - src/renderer/filepanel/core.ts
  - src/renderer/filepanel/types.ts
  - src/renderer/filepanel/deps.ts
  - src/renderer/filepanel/useFilePanel.ts
  - src/renderer/components/FilePanel.tsx
  - src/renderer/components/FilePanel.css
  - src/renderer/terminal/terminalLinks.ts
  - src/renderer/terminal/terminalLinkParse.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/renderer/filepanel/__tests__/locateTarget.test.ts
  - src/renderer/filepanel/__tests__/pathContainment.test.ts
  - src/renderer/filepanel/__tests__/locateRegistry.test.ts
  - src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
  - docs/features/TERMPRO-F260613053134-Terminal-Path-FilePanel/TECH.md
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C5
    severity: high
    location: "src/renderer/components/FilePanel.tsx:108-124 (scrollIntoView/highlight effects); TECH.md T-019/T-024/T-036"
    issue: "The user-visible core of the feature — row highlight class, one-shot scrollIntoView, clear-on-interaction, and 'no repeat scroll while highlight remains' — lives entirely in FilePanel.tsx and has no component/RTL test. No FilePanel.test.tsx exists in the diff; T-019, T-024, T-036 are listed in TECH but unimplemented."
    rationale: "Controller tests assert state (locateHighlightPath/locateScrollPath) but never exercise the DOM effects. The one-shot scroll has subtle re-render semantics (clearLocateScrollPath must fire exactly once; watcher/status re-renders must not re-scroll while highlight survives) that are exactly the kind of bug a state-only test cannot catch."
    suggestion: "Add a React Testing Library test for FilePanel that: (a) renders a located row with the locate-target class, (b) asserts scrollIntoView is called once then locateScrollPath cleared, (c) re-renders (simulated watcher tick) and asserts scrollIntoView is NOT called again while highlight persists, (d) asserts toggle/refresh/mode/tab-switch clears the highlight."
  - id: CR-2
    checklist: C2
    severity: low
    location: "src/renderer/filepanel/controller.ts:135-150 (locateTarget returns isLocateStale(...) ? true : false)"
    issue: "When a locate goes stale due to generation drift (e.g. a 2s pollTick cwd change lands mid-locate, not a newer click), locateTarget resolves true, so openTargetInFilePanelFirst skips the fallback. The highlight was already cleared by clearLocateState in the pollTick reducer, so the click produces no locate AND no viewer/Finder fallback — it is silently dropped."
    rationale: "Returning true is correct when a NEWER locate request supersedes this one (avoid double-open), but generation drift from a benign cwd poll is conflated with that case. The test 'stales an in-flight locate when generation changes' confirms the no-op outcome (resolves true, highlight null). Old behavior always opened the target; this is a (rare, recoverable) regression."
    suggestion: "Distinguish supersession (activeLocateRequestId changed → true, no fallback) from generation-only drift (→ false, let terminalLinks fall back), or document the dropped-click as accepted and note the recover-by-reclick UX. Window is tiny (locate normally <100ms vs 2s poll), hence low."
  - id: CR-3
    checklist: C1
    severity: low
    location: "src/host/fsService.ts:9-39 (statSymlinkKind / classifyDirent / Promise.all)"
    issue: "listDir now resolves EVERY symlink dirent via a followed fs.stat on EVERY directory listing (global behavior change), and fans them out with an uncapped Promise.all. TECH's fsService change description only specifies 'implement safe realpath'; the listDir symlink reclassification is not documented there."
    rationale: "The reclassification is justified (a symlinked dir must report kind 'dir' so flattenTree renders the expanded locate chain), but it changes file-panel rendering for all symlinked entries beyond the feature's ACs, and a directory with many symlinks (e.g. a *.bin dir) issues that many concurrent fs.stat + setTimeout timers per listing. Each is bounded by the 100ms timeout, but concurrency is unbounded."
    suggestion: "Note the listDir symlink-kind change in TECH's fsService entry (it is a real semantic change), and consider a small concurrency cap (or only stat symlinks lazily) if any listed directory can hold hundreds+ of symlinks."
  - id: CR-4
    checklist: C5
    severity: low
    location: "src/renderer/filepanel/controller.ts:280-283 / core.ts applyLocateCommit targetId gate; TECH.md T-009"
    issue: "Last-click-wins via a NEWER request id (activeLocateRequestId !== targetId) is not directly tested. locateTarget tests cover the generation-stale path (T-035) and missing-row/tab-guard paths, but no test fires two overlapping locateTarget calls with different ids to confirm the earlier one becomes stale and its highlight is suppressed."
    rationale: "The id-based stale gate is a distinct code path from the generation gate; both guard applyLocateCommit and isLocateStale. T-009 ('newer_locate_request_wins_and_clears_stale_highlight') is enumerated in TECH but absent from the suite."
    suggestion: "Add a test that starts locateTarget(id=A) with a slow readdir, starts locateTarget(id=B) before A resolves, and asserts only B commits (A's commit is dropped, B's highlight wins)."
  - id: CR-5
    checklist: C5
    severity: low
    location: "src/renderer/filepanel/core.ts:312-320 (sameRoot cache-merge: 'if (!cache.has(path))'); TECH.md T-012/T-025"
    issue: "Two enumerated TCs are unimplemented: T-025 (same-root commit must keep live cache values updated by the watcher during locate, not overwrite with the locate snapshot) and T-012 (locate view fields are runtime-only / not serialized into persisted tab state)."
    rationale: "The merge guard 'insert only missing keys' exists specifically to preserve concurrent watcher updates, but no test drives a watcher cache update mid-locate to lock the behavior. T-012's negative-persistence assertion guards against replaying a stale highlight after hydration — also unverified."
    suggestion: "Add (a) a same-root locate where a watcher childDone updates an already-cached ancestor mid-flight, asserting commit keeps the live entries; (b) a serialization test asserting the persisted tab payload (updateTabFilePanel) never contains locateHighlightPath/locateScrollPath/activeLocate* fields."
findings_summary:
  blocker: 0
  high: 1
  low: 4
  info: 0
  total: 5
---

# 详情（人读补充）

整体实现质量高，与一份异常详尽的 TECH 高度吻合：terminal→registry→handler→controller 解耦清晰；fallback 归属保留在 `terminalLinks.ts`（reject/throw 安全兜底，T-028 有测试）；stale 双闸（request id + generation）+ `locateCommit` 单事务跨 mode 切换（不走 `applyRootChange` 重置）设计正确；realpath 信任门 + display-segment 行走（不跳到 realpath sibling）兼顾 symlink 逃逸防护与显示一致性，且都有针对性单测（escape→reject、in-root symlink→display path）。可观测性达标：失败路径统一 `console.warn('[filepanel] locate fallback', reason)`，reason 为固定枚举字符串、不含路径，无敏感信息泄漏。

未发现 blocker。最值得补的是 **CR-1**：feature 的可见价值（高亮 + 一次性滚动 + 交互清除 + 重渲染不重复滚动）完全在 `FilePanel.tsx`，却没有任何组件级测试覆盖，而 one-shot scroll 的重渲染语义恰是状态级测试照不到的盲区。其余为 low：CR-2 是 generation 漂移期间点击被静默吞掉（与"新点击覆盖"语义混用）；CR-3 是 listDir 的 symlink 重分类未在 TECH 落档且并发无上限；CR-4/CR-5 是 TECH 已列但未落地的 TC（T-009 / T-012 / T-025）。

C4（KNOWLEDGE/约定）方面：renderer 不直接碰 fs，新增的 realpath 经 HostService RPC，符合 README §五架构红线；Host 侧 `fs.realpath` catch→null，无 Electron import 引入。未见违反。
```
