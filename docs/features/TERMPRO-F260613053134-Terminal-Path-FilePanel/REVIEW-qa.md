---
reviewer: qa
verdict: NEEDS_REVISION
---
# QA Review

## Scope

Reviewed PRD AC-1..AC-10, TC T-001..T-037, implementation tests, and dev evidence:

- `npm test`: PASS, 12 files, 124 tests
- `npm run typecheck`: PASS
- `npm run lint`: PASS with warnings only

## Findings

### Q-1 · Implemented tests do not match the committed TC plan

Severity: high

TC.md lists 37 named test cases, but the dev commit only adds a small subset:

- `locateTarget.test.ts`: 4 locate tests
- `pathContainment.test.ts`: 3 helper tests
- `locateRegistry.test.ts`: 2 registry tests
- `fsService.test.ts`: 2 realpath tests

Missing coverage includes terminal await-before-fallback routing, repository system-open extension location-only behavior, cross-mode inputs echo integration, directory target child loading, realpath escape through `locateTarget`, FilePanel scroll/highlight rendering, live cache merge, and symlink display-path behavior.

At minimum, this round should add regression tests for the confirmed implementation defects and the highest-risk trust/transaction paths.

### Q-2 · Directory target behavior is not tested and is visibly incomplete

Severity: high

T-005 requires non-root directory targets to expand themselves and display their contents after lazy children load. No implemented test asserts this. Code inspection confirms the target directory's children are not read before commit and no post-commit child fetch is emitted.

### Q-3 · Case sensitivity policy is helper-tested but not locate-tested

Severity: medium

`pathContainment.test.ts` covers `matchEntry` case folding directly, but no controller test asserts that case-fold behavior is gated by host platform or that non-darwin hosts fall back when exact/NFC row matching fails.

### Q-4 · Browser/Electron workflow remains unverified

Severity: medium

TC.md marks Browser E2E as needed. This stage has not run Electron/Playwright UI verification. It is acceptable to defer to later browser_e2e/test stages, but review should not treat the current automated coverage as complete UI proof.

## AC Coverage Assessment

| AC | Review result |
|----|---------------|
| AC-1 | Partially covered by registry and code inspection; no terminal activation unit test. |
| AC-2 | Partially covered; WorkTree main path is tested through cross-mode case, not a direct current-WorkTree test. |
| AC-3 | Covered by a current Root file locate test. |
| AC-4 | Partially covered by WorkTree-over-Root mode switch; cross-mode persistence/input echo not tested. |
| AC-5 | Not fully covered; directory target child loading is broken. |
| AC-6 | Partially covered by code inspection; no system-open extension regression test. |
| AC-7 | Existing parse tests still pass, but FilePanel routing of stripped line-col is not directly tested. |
| AC-8 | Partially covered by helper tests; locate-level realpath escape and platform gate missing. |
| AC-9 | Partially covered by missing-row fallback; readdir failure/realpath escape fallback not fully covered. |
| AC-10 | Partially covered by generation-stale test; FilePanel scroll one-shot and newer-click variants missing. |

## Verdict

NEEDS_REVISION. Add focused tests for confirmed defects before retry; broader UI/E2E coverage can remain for downstream test/browser_e2e stages if explicitly recorded.
