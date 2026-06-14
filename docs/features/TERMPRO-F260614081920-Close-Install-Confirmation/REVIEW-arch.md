---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewer: architect
round: 4
verdict: NEEDS_REVISION
reviewed_at: "2026-06-14"
---

# Architect Review - Round 4

## Scope

Reviewed code after Round 3 fixes through `cdd0cd3` plus Round 4 external review output.

## Findings

| ID | Severity | Finding | Evidence | Verdict |
|----|----------|---------|----------|---------|
| ARCH-R4-1 | High | Staged update retry / version drift state should be extracted and unit tested. | `readyToInstallVersion`, `installingVersion`, and retry decisions are the riskiest updater behavior and were embedded in `updater.ts`. | Confirmed, extract `updateInstallSession` helpers and tests. |
| ARCH-R4-2 | Low | Reuse staged update branch needs explicit invariant and clearer UI/log state. | The branch relies on Squirrel.Mac retaining the staged update after `update-downloaded`; `checking` is misleading for this path. | Confirmed, document invariant and broadcast `confirming`. |
| ARCH-R4-3 | Low | Periodic update checks should be disabled while install confirmation is pending. | Focus-triggered checks already gate on `!installing`; interval checks did not. | Confirmed, gate timer checks. |
| ARCH-R4-4 | Low | Dialog rejection should be caught. | Native dialog promise rejection would otherwise be unhandled. | Confirmed, catch and log safe outcome. |

## Verdict

NEEDS_REVISION.
