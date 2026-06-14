---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewer: qa
round: 2
verdict: NEEDS_REVISION
reviewed_at: "2026-06-14"
---

# QA Review - Round 2

## Regression Status

- Round 1 test gap for close cancel/confirm was fixed in `17d588c`.
- Busy retry loop test was added in `7545b99`.
- Verification after `7545b99`:
  - `npm run typecheck`: PASS
  - `npm test`: PASS, 22 files / 188 tests
  - `npm run lint`: PASS with existing warnings
  - `TERMPRO_SMOKE=1 npx electron-forge start`: PASS, `SMOKE_OK`

## Findings

| ID | Severity | Finding | Evidence | Verdict |
|----|----------|---------|----------|---------|
| QA-R2-1 | High | No automated or documented boundary for OS shutdown / logout bypassing quit confirmation. | PRD AC-2 covers user quit; main currently confirms all `before-quit` unless already marked. | Confirmed, add testable shutdown bypass hook/wiring note. |
| QA-R2-2 | Low | Pending install confirmation needs guard if app is already quitting or updater fallback already happened. | External CR-2/CR-3; current tests do not cover these races. | Confirmed, add unit tests. |

## Verdict

NEEDS_REVISION.
