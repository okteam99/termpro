---
reviewers: [qa, architect, external]
verdict: APPROVE
---
# TECH Review

## QA Review

Verdict: APPROVE

- TC.md frontmatter covers AC-1 through AC-10 with at least one test per AC.
- Test plan separates route decision, containment, FilePanel locate behavior, fallback no-mutation, and concurrency.
- Browser E2E is recommended because the observable value is a UI workflow in the Electron workbench.

## Architect Review

Verdict: APPROVE

- The方案 keeps fs/git access behind HostService and does not import Node APIs in renderer.
- The key simplification is correct: terminal link activation awaits a FilePanel locate handler; FilePanelController owns root knowledge, lazy loading, expansion, and stale gates, while terminalLinks owns fallback.
- The plan avoids a broad global event bus and avoids storing locate requests in persisted tab state.
- No database schema change is involved, so blueprint §7.5 does not require a DB confirmation pause.

## External Review

Verdict: APPROVE after revision

The first external cross-review produced 9 findings, including one blocker. The blocker was valid: the original TECH used current-mode-first containment, which would let Root swallow a nested WorkTree target. PM/RD/Architect adopted the finding and revised PRD v0.7, TC.md, and TECH.md.

| Finding | Severity | Disposition | Change |
|---------|----------|-------------|--------|
| CR-1 | blocker | ADOPT | PRD and TECH now choose the most specific root; nested WorkTree wins over enclosing Root. |
| CR-2 | high | ADOPT | Ancestor loading is now transactional: read full chain first, commit only after all levels succeed. Added T-010. |
| CR-3 | high | ADOPT | Added switch-to-Root test T-011. |
| CR-4 | high | ADOPT-PARTIAL | Did not add a new PRD AC because runtime-only request is an implementation invariant under transient/stale behavior; added T-012 and TECH persistence rule. |
| CR-5 | high | ADOPT | Added inactive-tab negative test T-013. |
| CR-6 | high | ADOPT | TECH now names effective root sources and states mode-only patching without binding overwrite. |
| CR-7 | low | ADOPT | Removed dual-token ambiguity; `target.id` is the single stale token. |
| CR-8 | low | ADOPT | TECH now reuses cache and adds minimal `console.warn` fallback observability. |
| CR-9 | low | ADOPT | T-007 now covers `fs.realpath` null fallback. |

## Second External Review

Verdict: APPROVE after revision

The second external run is the latest artifact in `external-cross-review/blueprint-claude.md`. It found no blocker, but raised two high-severity risks around fallback ownership and runtime-only locate view state. Both were adopted.

| Finding | Severity | Disposition | Change |
|---------|----------|-------------|--------|
| CR-1 | high | ADOPT | TECH now makes `terminalLinks.ts` own fallback. FilePanel registers an async locate handler and returns only `true/false`, so opener context stays in terminal routing. Added T-016. |
| CR-2 | high | ADOPT | TECH and TC now name `activeLocateRequestId`, `locateHighlightPath`, and `locateScrollPath` as runtime-only view fields. T-012 covers persistence/hydration replay. |
| CR-3 | low | ADOPT | Added T-015 for host `fs.realpath` safe-null behavior. |
| CR-4 | low | ADOPT | Split target-equals-root behavior into T-014. |
| CR-5 | low | ADOPT-PARTIAL | TECH keeps cache reuse and minimal fallback warning; no new pending UI was added because PRD did not require a loading state for path location. |
| CR-6 | info | ADOPT | TC negative opener assertions now cover current-mode, mode-switch, and terminal-owned fallback branches. |
| CR-7 | low | ADOPT | T-010 now asserts directory cache remains unchanged on mid-chain failure. |

## Third External Review

Verdict: APPROVE after revision

The third external run found one blocker around cross-mode locating. The issue was valid: patching store mode before loading ancestors would cause the existing inputs/applyRootChange path to reset tree state, which conflicts with transactional locate semantics. PM/RD/Architect adopted the finding and changed TECH to a single `locateCommit` reducer transaction.

| Finding | Severity | Disposition | Change |
|---------|----------|-------------|--------|
| CR-1 | blocker | ADOPT | TECH now preloads the full chain before any store mode patch and commits runtime mode/root/top/cache/expanded/highlight/watch/status through one `locateCommit` event. Added T-017 and T-018. |
| CR-2 | high | ADOPT | Added integration-level cross-mode tests with real reducer + inputs echo, and component-level FilePanel render/scroll/clear test T-019. |
| CR-3 | high | ADOPT | `locateCommit` explicitly includes stopWatch/startWatch and status refresh/clear effects when the effective root changes. |
| CR-4 | low | ADOPT | PRD AC-6 already defined location-only for media/system-open extensions; added explicit regression T-021 for repository `.zip` locate=true. |
| CR-5 | low | ADOPT | PRD/TECH/TC now call out symlink escape where display containment passes but realpath exits the root. Added T-020. |
| CR-6 | low | ADOPT | TECH file list now includes `FilePanel.css`, and locate view fields are defined as runtime `FilePanelState`/`FilePanelView` fields, not persisted state. |
| CR-7 | low | ADOPT | TECH implementation plan requires `it.each`/split subcases for path parsing, containment, and highlight-clear variants. |
| CR-8 | info | ADOPT-PARTIAL | TECH specifies the stale-token id as the terminal routing id and constrains WorkTree selection to the current effective WorkTree root; auto-selecting other linked worktrees remains out of scope. |

## Fourth External Review

Verdict: APPROVE after revision

The fourth external run found no blocker. It raised three high-severity gaps around TOCTOU missing rows, macOS path matching, and offscreen row scrolling. All high findings were adopted before blueprint completion.

| Finding | Severity | Disposition | Change |
|---------|----------|-------------|--------|
| CR-1 | high | ADOPT | Added T-022 for `readdir` success but missing target row; TECH keeps this as fallback without mutating panel state. |
| CR-2 | high | ADOPT | TECH now defines canonical display path + NFC row matching, with darwin trusted-path case-fold fallback. Added T-023. |
| CR-3 | high | ADOPT | TECH confirms current FilePanel is non-virtualized and requires scroll-to-index if that changes. T-019/T-024 cover offscreen scroll/highlight. |
| CR-4 | low | ADOPT | Same-root locate commit now merges pending cache delta into current live cache instead of replacing from a stale snapshot. Added T-025. |
| CR-5 | low | ADOPT | Added FE-E2E-002 for Root-mode click into WorkTree, including segmented control, tree expansion, git status refresh, and highlight. |
| CR-6 | low | ADOPT | T-009 now requires parameterized subcases for toggle, refresh, tab switch, and newer locate request. |
| CR-7 | low | ADOPT | PRD now explicitly says successful locate may persist `mode/expanded`; only request/highlight/scroll are runtime-only. |
| CR-8 | low | ADOPT | Added partial-cache variants T-026 and T-027 for AC-2/AC-3. |

## Fifth External Review

Verdict: APPROVE after revision

The fifth external run found no blocker. It raised three high-severity specification gaps: directory target highlight/scroll behavior, handler rejection fallback, and Root mode behavior for non-current linked worktrees under the root. All high findings were adopted.

| Finding | Severity | Disposition | Change |
|---------|----------|-------------|--------|
| CR-1 | high | ADOPT | PRD/TECH now define non-root directory targets as expanded, scrolled, and transiently highlighted; effective root target remains no-highlight/no-scroll. T-005 locks this. |
| CR-2 | high | ADOPT | TECH now requires terminalLinks to catch locate handler reject/throw and use original fallback without state mutation. Added T-028. |
| CR-3 | high | ADOPT | TECH states Root mode does not filter `.worktree`; non-current linked worktree paths physically under Root locate in Root mode. Added T-029. |
| CR-4 | low | ADOPT | TECH now says same-root commit inserts only missing cache keys and never overwrites existing live cache keys. |
| CR-5 | low | ADOPT | Split AC-7 path forms into independently named tests T-030 through T-034 while keeping T-006 as compatibility umbrella. |
| CR-6 | low | ADOPT | T-019/T-024 now require `Element.prototype.scrollIntoView` spy/stub before assertion. |
| CR-7 | low | ADOPT | TECH requires active-tab changes, handler unregister, and controller dispose to clear locate view state and stale the current request. |
| CR-8 | info | ADOPT | TECH makes the post-commit store-to-inputs echo guard explicit: matching runtime inputs/effectiveRoot must early-return without `applyRootChange`. |

## Sixth External Review

Verdict: APPROVE after revision

The sixth external run found no blocker. It raised two high-severity runtime gaps: cwd drift while locate is in flight, and repeated scroll on unrelated re-renders. Both high findings were adopted.

| Finding | Severity | Disposition | Change |
|---------|----------|-------------|--------|
| CR-1 | high | ADOPT | TECH now records `activeLocateGeneration` and requires locateCommit to validate request id + generation. Added T-035 for pollTick/resolveDone cwd drift. |
| CR-2 | high | ADOPT | TECH now makes scroll one-shot and separates `locateScrollPath` from highlight lifetime. Added T-036. |
| CR-3 | low | ADOPT | TECH states `locateCommit` must be handled before the existing root-equality stale gate because cross-mode commit intentionally changes root. |
| CR-4 | low | ADOPT-PARTIAL | Terminal link visual styling remains a UI restoration/manual E2E concern, not a separate product AC for this routing feature. |
| CR-5 | low | ADOPT | TECH clarifies realpath is trust/case assistance; row segments remain display-path segments for in-root symlink paths. Added T-037. |
| CR-6 | info | ADOPT | TECH now reuses the existing inputs equality short-circuit by requiring `locateCommit` to update runtime `inputs.mode`; no second divergent guard is introduced. |

## PM Response

Current response: APPROVE.

The revised plan matches the PRD's product boundary: location-only inside current Root/WorkTree, WorkTree preferred over enclosing Root, terminal-owned fallback outside trusted internal handling, and no agent-specific parsing.

## Review Checklist

| Check | Result |
|-------|--------|
| `reviewers` includes blueprint roles `qa, architect, external` | PASS |
| TC covers every PRD AC | PASS |
| TECH states DB schema impact | PASS: no DB schema change |
| TECH follows DEV-RULES renderer/host boundary | PASS |
| External artifact present | PASS |
| External blocker resolved | PASS |
