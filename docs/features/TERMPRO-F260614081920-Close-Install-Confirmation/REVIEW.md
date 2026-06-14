---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewers: [architect, qa, external]
verdict: NEEDS_REVISION
round: 3
reviewed_at: "2026-06-14"
---

# Close / Install Confirmation - Review Round 3

## Summary

Round 3 reviewed the Round 2 lifecycle hardening. External review found that the shutdown bypass fix still left two real lifecycle problems: `before-quit` was still too broad for system logout/shutdown, and update cancel/retry relied on unverified Squirrel.Mac staged-update behavior. These are valid and require another review-fix.

## External Findings Adjudication

External artifact: `external-cross-review/review-claude.md`

| ID | Severity | Adjudication | Evidence / Decision |
|----|----------|--------------|---------------------|
| CR-1 | High | Confirmed | The `powerMonitor.shutdown` hook was registered at module load and only existed to compensate for `before-quit` confirmation. Fix by removing that hook and making `before-quit` non-blocking. |
| CR-2 | High | Confirmed | `before-quit` cannot reliably distinguish user Cmd+Q from OS logout/shutdown. Fix by moving user App Quit confirmation to the App menu / Cmd+Q entry and letting `before-quit` only mark quitting. |
| CR-3 | High | Confirmed | Cancel-after-`update-downloaded` should not depend on re-running Squirrel checks against an already staged update. Fix by retaining a staged `readyToInstallVersion` and reusing it on retry. |
| CR-4 | Low | Confirmed | `quitAndInstall()` throwing after `markQuitting()` would leave confirmation bypass enabled. Fix by adding rollback on synchronous `quitAndInstall()` failure. |
| CR-5 | Low | Confirmed | Close/App Quit cancellation and busy paths were silent. Add lightweight debug logs for non-confirmed close/quit outcomes. |
| CR-6 | Info | Confirmed | TC/TECH naming and main wiring evidence drifted after fixes. Align TC names and add OS quit / retry manual checks. |

## Verification Before This Review

- `npm run typecheck`: PASS
- `npm test`: PASS, 22 files / 191 tests after Round 2 fix; 193 after local Round 3 fix draft
- `npm run lint`: PASS with existing warnings
- `TERMPRO_SMOKE=1 npx electron-forge start`: PASS, `SMOKE_OK`

## Verdict

NEEDS_REVISION.
