---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewer: qa
round: 1
verdict: NEEDS_REVISION
reviewed_at: "2026-06-14"
---

# QA Review - Round 1

## AC Coverage

| AC | Implementation | Automated Coverage | Verdict |
|----|----------------|--------------------|---------|
| AC-1 | Main window `close` goes through `ExitLifecycleController.handleWindowClose`. | `exitConfirmation.test.ts` now covers close copy + cancel + confirm + next close pass-through. | Pass after fix commit `17d588c`. |
| AC-2 | `before-quit` goes through `handleAppBeforeQuit`; confirmed quit lets internal close pass. | `exitLifecycle_app_quit_cancel_and_confirm_flow`, `exitLifecycle_quit_confirm_allows_window_close_without_second_prompt`. | Pass. |
| AC-3 | `update-downloaded` calls install decision helper before `quitAndInstall`. | cancel test covers no restarting / no quit. | Pass with one gap below. |
| AC-4 | cancel branch clears watchdog, cleanup, resets installing, broadcasts available. | updater cancel test. | Pass. |
| AC-5 | confirm branch broadcasts restarting and calls `quitAndInstall`. | updater confirm test. | Pass. |
| AC-6 | dialog lock and quit/close interaction covered. | coordinator lock + quit/close tests. | Needs one more busy-loop variant. |
| AC-7 | Update pill copy no longer says auto restart. | `SidebarUpdatePill.test.tsx`. | Pass. |
| AC-8 | `TERMPRO_SMOKE` bypass does not show dialog; smoke produced `SMOKE_OK`. | coordinator bypass test + Electron smoke. | Pass. |

## Findings

| ID | Severity | Finding | Evidence | Verdict |
|----|----------|---------|----------|---------|
| QA-R1-1 | Low | T-001 originally only asserted copy, not close cancel/confirm lifecycle. | `exitConfirmation.test.ts` before `17d588c`. | Confirmed and already fixed in commit `17d588c`. |
| QA-R1-2 | Low | `updateInstallDecision` has a `busy` retry loop but no test that returns `busy` then a terminal result. | `src/main/updateInstallDecision.ts` loop; updater tests use deferred canceled result but not immediate busy. | Confirmed, add test variant. |
| QA-R1-3 | Info | Real Squirrel cancel -> reinstall cannot be fully proven by unit mocks. | Existing tests mock updater decision only; smoke bypass validates Electron start/exit, not packaged Squirrel staging. | Record as residual manual risk; no code blocker. |

## QA Verdict

NEEDS_REVISION.
