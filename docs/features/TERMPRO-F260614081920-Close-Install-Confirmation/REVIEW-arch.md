---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewer: architect
round: 3
verdict: NEEDS_REVISION
reviewed_at: "2026-06-14"
---

# Architect Review - Round 3

## Scope

Reviewed code after Round 2 fixes through `ecdbf4c` plus Round 3 external review output.

## Findings

| ID | Severity | Finding | Evidence | Verdict |
|----|----------|---------|----------|---------|
| ARCH-R3-1 | High | App Quit confirmation must be bound to a user-controlled Quit entry, not all `before-quit` events. | Electron `before-quit` also covers OS / programmatic quit paths; system logout/shutdown must not be blocked by a modal. | Confirmed, move confirmation to App menu / Cmd+Q and make `before-quit` mark-only. |
| ARCH-R3-2 | High | Cancel-after-download retry should reuse the Squirrel staged update instead of rerunning the full download/check path. | After `update-downloaded`, Squirrel has already staged the update; rechecking the same version is an avoidable integration risk. | Confirmed, retain `readyToInstallVersion` and retry from the staged-ready path. |
| ARCH-R3-3 | Low | `quitAndInstall()` synchronous failure can leave quitting bypass enabled. | `prepareToQuitAndInstall()` marks quitting before `quitAndInstall()`. If that call throws, the process continues with bypass still true. | Confirmed, add rollback callback. |
| ARCH-R3-4 | Low | Close/App Quit cancellation paths need minimal logs. | Updater logs were added; lifecycle cancellation / busy paths remained silent. | Confirmed, add debug logs on non-confirmed outcomes. |

## Verdict

NEEDS_REVISION.
