---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
author: PM
status: draft
decision: ""
decided_at: ""
prd_ref: PRD.md
test_report_ref: TEST-REPORT.md
browser_test_report_ref: ""
ac_total: 8
ac_passed: 8
revision_history:
  - version: v0.1
    date: "2026-06-14"
    author: PM
    summary: "PM acceptance note drafted from PRD AC and TEST-REPORT evidence."
---

# Close / Install Confirmation - PM Acceptance Note

## §1 Acceptance Summary

| Item | Content |
|---|---|
| Decision | Pending user decision |
| AC passed | 8 / 8 |
| Evidence | PRD.AC + TEST-REPORT |
| Decision time | Pending |

## §2 AC Check

| AC ID | Description | Evidence | PM Judgment | Notes |
|---|---|---|---|---|
| AC-1 | Main window close asks for confirmation and cancel keeps workspace/tab/terminal view alive. | TEST-REPORT §4: T-001, T-010, T-019; §5 full unit suite passed. | ✅ pass | Native close path still needs PM manual feel check. |
| AC-2 | App menu Quit TermPro / Cmd+Q asks for confirmation; system logout/shutdown does not block. | TEST-REPORT §4: T-002, T-008, T-010, T-013, T-014, T-019. | ✅ pass | Dock/system quit tradeoff documented in PRD. |
| AC-3 | Update install asks before restart; cancel does not restart or call quitAndInstall. | TEST-REPORT §4: T-003, T-009, T-011, T-012, T-016, T-017, T-018. | ✅ pass | Squirrel native retry remains PM manual check. |
| AC-4 | Cancel install clears watchdog/artifacts/installing and restores retryable available state. | TEST-REPORT §4: T-003, T-009, T-016, T-017, T-018. | ✅ pass | Staged retry contract e2e passed. |
| AC-5 | Confirm install broadcasts restarting and continues quitAndInstall. | TEST-REPORT §4: T-004, T-012, T-015. | ✅ pass | Rollback on synchronous quitAndInstall failure covered. |
| AC-6 | Confirmation lock prevents stacked dialogs and duplicate actions. | TEST-REPORT §4: T-005, T-008, T-009, T-010, T-011. | ✅ pass | Coordinator lock and wait-when-idle covered. |
| AC-7 | Update pill copy no longer promises automatic restart. | TEST-REPORT §4: T-006; renderer UpdatePill test passed. | ✅ pass | `confirming` state displays waiting-for-confirmation copy. |
| AC-8 | TERMPRO_SMOKE bypass avoids blocking automation. | TEST-REPORT §4: T-007; smoke output `SMOKE_OK`. | ✅ pass | Electron smoke passed. |

## §3 Decision Options

### 3.1 approved_and_ship (recommended)

Reason: all 8 AC are covered by TEST-REPORT evidence, review approved after five rounds, and test stage passed.

Action: enter ship stage, push feature branch, create MR. Ship Phase 1 still stops for the user to merge on the platform.

### 3.2 approved_no_ship

Reason: use only if the implementation is accepted but should not be shipped yet due to timing or coordination.

Action: mark Feature completed without ship.

### 3.3 rejected_with_feedback

Findings: none from PM based on current evidence.

Action if selected: user feedback determines whether to return to dev, goal, ui_design, or abandon.

## §4 PM Manual Checks To Do During Acceptance

| Path | Expected |
|---|---|
| Main window red close / Close Window menu | Confirmation appears; cancel keeps work surface; confirm closes. |
| App menu Quit TermPro / Cmd+Q | Confirmation appears; cancel keeps app running; confirm quits. |
| System logout/shutdown or Dock quit | No TermPro modal should block OS quit. |
| Update downloaded then cancel then retry same version | Cancel restores available; retry asks for install confirmation and can continue. |

## §5 Decision Evidence

| Source | Content |
|---|---|
| PRD.AC | 8 acceptance criteria |
| TEST-REPORT | typecheck/test/lint/smoke/e2e exit-code all 0 |
| Review | Round 5 APPROVE; remaining items advisory only |
