---
reviewers: [architect, qa, external]
verdict: NEEDS_REVISION
---
# Review Summary

## Verdict

NEEDS_REVISION.

The implementation follows the intended ownership split and transaction shape, but review confirmed merge-blocking defects in directory target expansion and platform-gated row matching. The automated tests also under-cover the TC plan enough that focused regression tests are required before approval.

## Findings

| ID | Source | Severity | Disposition | Summary |
|----|--------|----------|-------------|---------|
| A-1 / CR-2 | architect + external | high | confirmed | Directory targets are marked expanded without loading their children, so AC-5 / T-005 can render an empty expanded directory. |
| A-2 / CR-1 | architect + external | high | confirmed | Row matching always enables darwin-style case fold, despite TECH requiring platform-gated behavior. |
| A-3 | architect | medium | confirmed | In-root symlink directory display-path traversal can fail to render because symlink rows are not expandable directory rows. |
| Q-1 / CR-3 | qa + external | high | confirmed | TC.md lists 37 cases, while implemented tests cover only a narrow subset of the high-risk behavior. |
| CR-4 | external | low | rejected for this round | Stale locate resolving `true` is intentional for last-click-wins: an older click should not open fallback after a newer locate/root change has superseded it. This can be revisited if product wants refresh/drift fallback instead of silent stale-drop. |
| CR-5 | external | low | deferred | Additional fallback reason logging is useful but non-blocking once correctness tests are added. |
| CR-6 | external | info | deferred | `sourceTabId` is redundant today because handler registration is active-tab scoped; cleanup can be folded into a later refactor. |

## Required Fixes Before Retry

1. Load or fetch directory target children when committing a successful directory locate.
2. Gate case-folded `matchEntry` behavior on host platform instead of hardcoding `darwinTrusted: true`.
3. Ensure symlink-to-directory display paths can render through the FilePanel tree for T-037.
4. Add focused tests for the fixed behavior: directory target expansion, platform-gated case matching, realpath escape at locate level, and symlink display-path traversal.

## Evidence

- External review artifact: `external-cross-review/review-claude.md`
- Dev evidence from previous stage: `npm test` PASS, `npm run typecheck` PASS, `npm run lint` PASS with warnings only.

## Next Step

Record this review round as NEEDS_REVISION, then apply a review-stage fix commit and rerun review.
