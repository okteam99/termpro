---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewers: [architect, qa, external]
verdict: NEEDS_REVISION
round: 2
reviewed_at: "2026-06-14"
---

# Close / Install Confirmation - Review Round 2

## Summary

Round 2 reviewed the Round 1 fixes. It confirmed the previous code/test gaps were addressed, but external review identified additional lifecycle boundaries around OS shutdown and updater races. These are valid because they sit exactly at Electron lifecycle / updater boundaries and are cheap to harden.

## External Findings Adjudication

External artifact: `external-cross-review/review-claude.md`

| ID | Severity | Adjudication | Evidence / Decision |
|----|----------|--------------|---------------------|
| CR-1 | High | Confirmed | `app.before-quit` is broader than user Cmd+Q. PRD scopes user quit; OS shutdown should not be blocked by a modal confirmation. Fix with `powerMonitor.shutdown` bypass. |
| CR-2 | Low | Confirmed | `confirmWhenIdle` can resume after a quit confirmation. Fix by checking lifecycle quitting state before/after waiting. |
| CR-3 | Low | Confirmed | Updater fallback/error can happen while install confirmation is pending. Fix by injecting `isStillInstalling` and rechecking before broadcasting restarting or calling quitAndInstall. |
| CR-4 | Low | Deferred / residual | Main wiring remains hard to unit test without importing Electron app side effects. Smoke is recorded; native close/install manual verification remains PM acceptance risk. |
| CR-5 | Low | Confirmed | Method name implies one-shot but semantics are mark-quitting. Rename. |
| CR-6 | Info | Confirmed | Busy loop relies on idle-waiting confirm function. Add comment/log guard. |
| CR-7 | Info | Confirmed | Add log for awaiting/busy install confirmation path. |

## Verification Evidence

- `npm run typecheck`: PASS
- `npm test`: PASS, 22 files / 188 tests
- `npm run lint`: PASS with existing warnings
- `TERMPRO_SMOKE=1 npx electron-forge start`: PASS, `SMOKE_OK`

## Verdict

NEEDS_REVISION.
