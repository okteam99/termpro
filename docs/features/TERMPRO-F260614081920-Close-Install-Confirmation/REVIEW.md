---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewers: [architect, qa, external]
verdict: NEEDS_REVISION
round: 4
reviewed_at: "2026-06-14"
---

# Close / Install Confirmation - Review Round 4

## Summary

Round 4 reviewed the user-intent App Quit and staged-update retry changes. External review found one remaining high-value gap: the updater module state that owns staged retry and version drift was not directly covered. The rest were low-severity hardening / documentation items. The findings are valid and cheap to address.

## External Findings Adjudication

External artifact: `external-cross-review/review-claude.md`

| ID | Severity | Adjudication | Evidence / Decision |
|----|----------|--------------|---------------------|
| CR-1 | High | Confirmed | `handleDownloadedUpdateForInstall` was tested, but `readyToInstallVersion` / `installingVersion` state decisions lived in `updater.ts` without focused tests. Extract a pure session helper and cover staged retry, newer-version redownload, and latest drift. |
| CR-2 | Low | Confirmed | Reusing a staged update depends on Squirrel.Mac's update-downloaded staged copy. Document the invariant at the reuse branch and keep fallback/rollback as recovery. |
| CR-3 | Low | Confirmed | Reuse retry broadcast `checking` and used a generic downloaded log, which was misleading. Add `confirming` state and distinct staged-reuse log. |
| CR-4 | Low | Confirmed | Periodic `check()` was not gated while installing; this could broadcast a new available state during a long native confirmation. Gate timer checks on `!installing`. |
| CR-5 | Low | Confirmed | Close/App Quit dialog promise rejections were not caught. Add catch logging and keep safe outcome: no close / no quit. |
| CR-6 | Info | Confirmed / documented tradeoff | Dock Quit cannot be distinguished from OS quit via `before-quit`. PRD/TC should explicitly scope App Quit confirmation to App menu / Cmd+Q and not system logout/shutdown. |

## Verification Before This Review

- `npm run typecheck`: PASS
- `npm test`: PASS, 23 files / 198 tests after local Round 4 fix draft
- `npm run lint`: PASS with existing warnings
- `TERMPRO_SMOKE=1 npx electron-forge start`: PASS, `SMOKE_OK`

## Verdict

NEEDS_REVISION.
