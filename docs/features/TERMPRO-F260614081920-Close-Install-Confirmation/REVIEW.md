---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewers: [architect, qa, external]
verdict: NEEDS_REVISION
round: 1
reviewed_at: "2026-06-14"
---

# Close / Install Confirmation - Review Round 1

## Summary

Round 1 reviewed dev commit `5c0141f`. One internal QA test gap was fixed in `17d588c` while preparing review. External review still targets the dev-complete anchor `5c0141f`, so the formal Round 1 verdict remains NEEDS_REVISION and the next step is review-fix / review-retry.

## Internal Findings

| ID | Source | Severity | Finding | Disposition |
|----|--------|----------|---------|-------------|
| QA-R1-1 | QA | Low | T-001 copy test did not assert close cancel/confirm lifecycle. | Confirmed and fixed in `17d588c`. |
| QA-R1-2 | QA | Low | Busy retry loop in update install decision lacks direct test. | Confirmed, fix in next review-fix commit. |
| ARCH-R1-1 | Architect | Low | Window close allow flag should bind to the specific window, not a process-long boolean. | Confirmed, fix in next review-fix commit. |
| ARCH-R1-2 | Architect | Low | Update install log says restarting before install confirmation. | Confirmed, fix in next review-fix commit. |
| ARCH-R1-3 | Architect | Info | TECH interface table drifted from actual helper names. | Confirmed, fix in next review-fix commit. |

## External Findings

External artifact: `external-cross-review/review-claude.md`

| ID | Severity | Adjudication | Evidence / Decision |
|----|----------|--------------|---------------------|
| CR-1 | Low | Confirmed | The `busy` loop exists at `src/main/updateInstallDecision.ts:24`; current tests do not force a busy return. Add test. |
| CR-2 | Low | Confirmed | The updater log is emitted before confirmation and can be false on cancel. Make it neutral and add branch logs. |
| CR-3 | Low | Partially confirmed | `latest` is not cleared during install, so `vundefined` is unlikely; however using `latest?.version` after async work can drift if releases change. Capture `installingVersion` from the original click. |
| CR-4 | Low | Deferred / residual risk | True packaged Squirrel re-arm behavior cannot be proven by unit test or dev smoke. Keep unit retry path and document residual manual verification need; not a blocker for code review. |
| CR-5 | Info | Confirmed | TECH lists standalone `confirmExit` names that do not exist. Update TECH to real exported factory/controller names. |
| CR-6 | Low | Confirmed | Singleton boolean can outlive a window if the synthetic close event does not replay. Use per-window allowance. |
| CR-7 | Info | Partially confirmed | Smoke was run and passed (`SMOKE_OK`); native close/install manual paths are not automatable in this environment. Record evidence and residual manual risk. |

## Verification Evidence So Far

- `npm run typecheck`: PASS
- `npm test`: PASS, 22 files / 187 tests
- `npm run lint`: PASS with existing warnings
- `TERMPRO_SMOKE=1 npx electron-forge start`: PASS, `SMOKE_OK`

## Verdict

NEEDS_REVISION.
