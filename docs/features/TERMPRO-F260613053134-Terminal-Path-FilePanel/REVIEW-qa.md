---
reviewer: qa
verdict: APPROVE
round: 2
---
# QA Review

## Evidence

- `npm test`: PASS, 13 files, 138 tests
- `npm run typecheck`: PASS
- `npm run lint`: PASS with 13 warnings, no errors

## Coverage Added During Review Fix

- Directory target child loading before expanded commit.
- Non-darwin no case-fold fallback.
- Realpath escape rejection at `locateTarget` level.
- Required directory `readdir` failure returns false without mutation.
- In-root symlink display segments stay on the displayed path.
- Cross-mode store input echo after `persistMode` is a no-op.
- Terminal route locate-before-fallback, handler false, handler reject, and system-open extension location-only behavior.
- Symlink-to-directory, symlink-to-file, and broken symlink host classification.
- Root `/` containment helper boundary.
- Source-tab mismatch guard.

## Remaining Test Gaps

| Gap | Disposition |
|-----|-------------|
| FilePanel DOM highlight / one-shot `scrollIntoView` / clear-on-interaction lacks RTL/jsdom unit test | Deferred to browser_e2e/manual UI verification because the project does not currently include a DOM component test stack. |
| Some TC.md planned variants remain broader than unit coverage | Acceptable for review because the highest-risk P0 logic paths now have focused regression coverage and test/browser_e2e stages remain downstream. |
| Rare generation-drift stale click may suppress fallback | Accepted as low residual risk; newer-locate suppression is intentional and the drift window is small. |

## AC Recheck

| AC | Result |
|----|--------|
| AC-1 | Pass. Terminal routing tests cover locate before fallback and fallback when no handler/false/reject. |
| AC-2 | Pass. WorkTree path location and expansion covered through controller tests. |
| AC-3 | Pass. Root path location remains covered. |
| AC-4 | Pass. WorkTree-over-Root and store echo cross-mode behavior covered. |
| AC-5 | Pass for controller state; UI scroll/highlight is deferred to browser_e2e. |
| AC-6 | Pass. System-open extension is location-only when locate succeeds. |
| AC-7 | Pass at parser level; routing receives resolved absolute paths. |
| AC-8 | Pass. Realpath escape and display-segment symlink cases covered. |
| AC-9 | Pass. Missing row, realpath escape, handler reject, no handler, and readdir failure fall back without committed tree mutation. |
| AC-10 | Pass for generation stale and store echo; full DOM one-shot scroll remains browser_e2e scope. |

## Verdict

APPROVE.
