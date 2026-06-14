---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewer: architect
round: 1
verdict: NEEDS_REVISION
reviewed_at: "2026-06-14"
---

# Architect Review - Round 1

## 范围

Reviewed commit: `5c0141f`

Files reviewed:

- `src/main/exitConfirmation.ts`
- `src/main/updateInstallDecision.ts`
- `src/main/main.ts`
- `src/main/updater.ts`
- `src/renderer/components/Sidebar.tsx`
- main / renderer tests added in dev stage

## Findings

| ID | Severity | Finding | Evidence | Verdict |
|----|----------|---------|----------|---------|
| ARCH-R1-1 | Low | `allowNextWindowClose` is a process-long boolean and can theoretically survive a failed/suppressed synthetic close event, letting a future rebuilt main window close once without confirmation. | `src/main/exitConfirmation.ts` keeps `allowNextWindowClose` on the controller singleton; `main.ts` reuses one controller across recreated windows. | Confirmed, fix by binding the allowance to the specific window instance. |
| ARCH-R1-2 | Low | Update install log still says “restarting to install” before the user has confirmed install. | `src/main/updater.ts` logs before `handleDownloadedUpdateForInstall`; cancel path is now valid. | Confirmed, use neutral pre-confirmation log and decision logs. |
| ARCH-R1-3 | Info | TECH interface table names helper functions as if they are standalone exports, while implementation uses `createExitConfirmationCoordinator()` and `ExitLifecycleController`. | `TECH.md` interface table vs `src/main/exitConfirmation.ts`. | Confirmed docs drift, fix TECH. |

## Architecture Verdict

NEEDS_REVISION.

The main architecture is sound: Electron lifecycle concerns remain in `src/main`; renderer only changes copy; Host and protocol stay untouched. The requested fixes are small and local.
