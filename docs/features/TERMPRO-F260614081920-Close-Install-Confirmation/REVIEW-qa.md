---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewer: qa
round: 4
verdict: NEEDS_REVISION
reviewed_at: "2026-06-14"
---

# QA Review - Round 4

## Regression Status

- Round 3 validation passed before Round 4 review.
- External review found missing coverage around updater staged retry and latest drift.

## Findings

| ID | Severity | Finding | Evidence | Verdict |
|----|----------|---------|----------|---------|
| QA-R4-1 | High | Staged retry and latest drift need automated tests. | Previous tests covered the pure decision function but not the state transition that decides reuse vs download. | Confirmed, add `updateInstallSession.test.ts`. |
| QA-R4-2 | Low | `confirming` UI state should be covered. | Reuse/ready path should disable the update pill without misleading “checking” copy. | Confirmed, add UpdatePill assertion. |
| QA-R4-3 | Low | Dialog rejection should be covered. | No previous test covered rejected native dialog promises. | Confirmed, add lifecycle rejection test. |
| QA-R4-4 | Info | Dock Quit / OS Quit tradeoff needs explicit QA note. | Implementation intentionally confirms App menu / Cmd+Q only. | Confirmed, document in PRD/TC and retain PM acceptance native check. |

## Verdict

NEEDS_REVISION.
