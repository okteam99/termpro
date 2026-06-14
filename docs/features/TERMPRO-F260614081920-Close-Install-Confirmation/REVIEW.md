---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewers: [architect, qa, external]
verdict: APPROVE
round: 5
reviewed_at: "2026-06-14"
---

# Close / Install Confirmation - Review Round 5

## Summary

Round 5 reviewed the staged-update session helper, `confirming` UI state, install-check gating, and dialog rejection handling added after Round 4. External review reported no blocker/high findings. Remaining findings are low/info advisory items around rare Squirrel staged-copy no-op behavior, main wiring coverage, modal parent-window choice, and log granularity.

## External Findings Adjudication

External artifact: `external-cross-review/review-claude.md`

| ID | Severity | Adjudication | Evidence / Decision |
|----|----------|--------------|---------------------|
| CR-1 | Low | Deferred / advisory | A silent `quitAndInstall()` no-op after Squirrel staging is plausible but speculative and hard to detect without risking false fallback during a legitimate slow quit. Current code covers synchronous throw rollback and PM acceptance keeps native update retry as a manual check. |
| CR-2 | Low | Deferred / advisory | Main wiring direct tests would require additional Electron-module harnessing. The risky logic is extracted into `exitConfirmation`, `updateInstallDecision`, and `updateInstallSession` tests; smoke covers main startup. Keep as residual test gap. |
| CR-3 | Low | Deferred / advisory | Focused/modal parent choice for install confirmation is UX-hardening, not a correctness blocker. Current parent fallback is stable for the main window; defer to a focused-window polish task if needed. |
| CR-4 | Info | Deferred / advisory | Reuse-staged path now logs reuse and `confirming`; additional quit result logging can be added later if field diagnostics require it. |

## Verification Evidence

- `npm run typecheck`: PASS
- `npm test`: PASS, 23 files / 198 tests
- `npm run lint`: PASS with existing warnings
- `TERMPRO_SMOKE=1 npx electron-forge start`: PASS, `SMOKE_OK`

## Verdict

APPROVE. Residual advisories are non-blocking and should be considered during PM acceptance / future updater hardening.
