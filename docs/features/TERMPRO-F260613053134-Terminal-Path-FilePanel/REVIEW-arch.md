---
reviewer: architect
verdict: APPROVE
round: 2
---
# Architecture Review

## Scope

Reviewed the round-2 implementation through commit `2bf092b`, including fixes after the round-1 NEEDS_REVISION review.

## Recheck Results

| Previous finding | Result |
|------------------|--------|
| A-1 / CR-2 directory target expanded without children | Fixed. `loadLocateChain` now reads the directory target before commit, so expanded target directories have cache entries. |
| A-2 / CR-1 unconditional darwin case-fold | Fixed. `FilePanelDeps.platform` gates trusted case-fold behavior. |
| A-3 symlink-to-directory display path not expandable | Fixed. Host `listDir` classifies symlink-to-directory entries as `dir` with a bounded follow-stat, preserving display-path expansion. |

## Current Assessment

- Terminal routing still owns fallback; FilePanel returns only a boolean locate result.
- `locateCommit` remains the single cross-mode transaction and handles runtime mode/root/tree/watch/status together.
- Store mode echo is now covered by a controller integration test that re-emits `inputs` from `persistMode` and verifies no duplicate root read is triggered.
- Host fs changes remain behind HostService. The symlink classification behavior is now documented in TECH.

## Advisory

Component-level DOM behavior for `FilePanel.tsx` one-shot scroll/highlight is not unit-tested because the repo currently has no jsdom/RTL test stack. This is acceptable for review with explicit carry-forward to browser_e2e/manual UI verification.

## Verdict

APPROVE.
