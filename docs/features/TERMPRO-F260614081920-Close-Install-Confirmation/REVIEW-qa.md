---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewer: qa
round: 3
verdict: NEEDS_REVISION
reviewed_at: "2026-06-14"
---

# QA Review - Round 3

## Regression Status

- Round 2 validation passed before Round 3 review.
- Round 3 external review found lifecycle cases that were not covered by the previous unit matrix.

## Findings

| ID | Severity | Finding | Evidence | Verdict |
|----|----------|---------|----------|---------|
| QA-R3-1 | High | OS logout/shutdown must have an explicit non-blocking test/documented boundary. | Previous tests covered confirmed user quit bypass, not `before-quit` as system/programmatic exit. | Confirmed, add unit coverage for mark-only `before-quit` and PM acceptance native check. |
| QA-R3-2 | High | Update cancel/retry after `update-downloaded` needs a defined staged retry behavior. | AC-3/AC-4 require retryable available state; re-running Squirrel check after staging was not verified. | Confirmed, document and implement staged-ready retry path. |
| QA-R3-3 | Low | `quitAndInstall()` failure should not permanently disable future confirmations. | No previous test covered `quitAndInstall()` throwing after `prepareToQuitAndInstall()`. | Confirmed, add rollback test. |
| QA-R3-4 | Info | TC/TECH naming drift should be corrected. | T-004 function name and main wiring notes lagged implementation. | Confirmed, align docs. |

## Verdict

NEEDS_REVISION.
