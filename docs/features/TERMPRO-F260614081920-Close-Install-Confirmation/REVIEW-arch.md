---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewer: architect
round: 2
verdict: NEEDS_REVISION
reviewed_at: "2026-06-14"
---

# Architect Review - Round 2

## Scope

Reviewed code after Round 1 fixes through `7545b99`.

## Findings

| ID | Severity | Finding | Evidence | Verdict |
|----|----------|---------|----------|---------|
| ARCH-R2-1 | High | App Quit confirmation should not block OS shutdown / logout paths. | `main.ts` routes every `before-quit` through confirmation; PRD AC-2 names user App Quit / Cmd+Q, not system shutdown. | Confirmed, add `powerMonitor.shutdown` bypass. |
| ARCH-R2-2 | Low | Install confirmation can continue after app quit has already been confirmed. | `confirmWhenIdle` waits for current dialog, but does not know lifecycle is already quitting. | Confirmed, short-circuit install confirmation if lifecycle is quitting. |
| ARCH-R2-3 | Low | Error/fallback can race with a pending install confirmation. | `handleDownloadedUpdateForInstall` awaits user choice after clearing watchdog; updater error handlers can call fallback while the dialog is open. | Confirmed, add `isStillInstalling` guard before acting on confirmation result. |
| ARCH-R2-4 | Info | `allowNextQuitWithoutConfirmation` name implies one-shot, but it marks the app as quitting for the rest of process life. | `ExitLifecycleController` sets `isQuittingConfirmed=true`; all current call sites terminate the app. | Rename to reflect mark-quitting semantics. |

## Verdict

NEEDS_REVISION.
