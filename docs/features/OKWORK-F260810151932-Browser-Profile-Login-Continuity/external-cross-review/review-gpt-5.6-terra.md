---
perspective: external-claude
review_via: subagent
review_model: gpt-5.6-terra
model: gpt-5.6-terra
target: code
target_commit: a876eb9550611f1a888c4a0da90d3b77fdb0aac8
target_base: 9dc1d2f7de2606e999bcc96a68f99f7555115d1c
generated_at: "2026-08-11T00:00:00Z"
files_read:
  - docs/features/OKWORK-F260810151932-Browser-Profile-Login-Continuity/external-review-prompts/review-subagent-review-20260810T185539Z.md
  - src/main/browserGuestNavigationGuard.ts
  - src/main/__tests__/browserGuestNavigationGuard.test.ts
  - src/main/main.ts
  - src/main/profileContinuityController.ts
  - src/shared/browserProfile.ts
  - docs/features/OKWORK-F260810151932-Browser-Profile-Login-Continuity/TECH.md
  - /tmp/termpro-bl008-final-6cdcc32/node_modules/electron/electron.d.ts
  - "git diff 9dc1d2f7de2606e999bcc96a68f99f7555115d1c..a876eb9550611f1a888c4a0da90d3b77fdb0aac8"
coverage:
  - F1 hydration-plus-attach generation/authority-change bypass
  - synchronous cancellation and dynamic authority resolution
  - generation/host stale-result checks, token coalescing, disposal
  - controlled programmatic replay and redirect semantics
  - Local and migration paths
  - URL/summary/log confidentiality
  - guest binding and lifecycle
  - ten new guard tests, assertion quality
findings: []
findings_summary:
  blocker: 0
  major: 0
  high: 0
  low: 0
  info: 0
  total: 0
---

# F1 verdict

**Fixed.** The repair diff adds a guard to every successfully attached browser guest and routes both `will-navigate` and `will-redirect` through it in `src/main/main.ts:2307-2348`.

- The gate is synchronous: an unhydrated/unknown/blocked Remote authority calls `event.preventDefault()` before scheduling `prepare` (`browserGuestNavigationGuard.ts:146-161`). Resolver or hydration-check exceptions fail closed.
- Authority is resolved afresh for each event from the current catalog entry and current provider generation (`main.ts:2311-2325`), so already-attached guests correctly see Local→Remote, Remote→Remote, and Remote→Local changes.
- Recovery rechecks the original Remote host and generation against current authority and requires hydration for that exact current generation before replay (`browserGuestNavigationGuard.ts:107-117`). Thus a g1-hydrated guest cannot use that result after g2/g3 or a host migration.
- `latestToken`, duplicate coalescing, cancellation on later allowed navigation, and `dispose()` prevent stale or post-destruction replay (`browserGuestNavigationGuard.ts:48-57, 92-99, 138-167`).
- Replay uses `guest.loadURL`; Electron’s declaration explicitly says `loadURL` does not emit `will-navigate` (`electron.d.ts:17426-17442`), so the recovery replay does not loop. The TECH contract states the same distinction for renderer programmatic navigation.
- `will-redirect` is explicitly cancellable according to Electron (`electron.d.ts:17567-17575`) and is registered on the same guard, closing the server-redirect path.
- Non-http(s)/`about:` URLs are denied before any authority logic. Blocked URLs remain only in the guard’s in-memory pending token; recovery broadcasts only the existing summary and performs no URL/Cookie logging (`browserGuestNavigationGuard.ts:43-46, 58-66`; `main.ts:2340-2342`).
- Binding is derived at attach from the actual guest session; an attach-race guest with no current binding is immediately closed, and the guard is disposed at guest destruction (`main.ts:2267-2274, 2346-2348`).

`profileContinuityController.prepare` creates hydration keys from `(profileId, partition, current generation)` and `isHydrated` checks the same tuple (`profileContinuityController.ts:380-459`), matching the gate’s required generation granularity. `parseBrowserPartition` remains shape-only and attach first requires the existing known-partition policy (`browserProfile.ts:252-264`, `main.ts:2209-2259`).

# Test sampling

All 10 added tests make behavioral assertions rather than merely naming scenarios:

1. synchronous block, duplicate coalescing, one replay;
2. offline block plus summary-only recovery;
3. generation-stale result cannot replay;
4. host-stale result cannot replay;
5. newest URL wins over late prior completion;
6. an allowed newer navigation cancels old replay;
7. Local→Remote existing guest dynamically gates;
8. redirect follows the same blocking/recovery path;
9. guest destruction suppresses replay;
10. Local HTTP remains unchanged while disallowed schemes block.

# Repair-diff regression verdict

No new **BLOCKER** or **MAJOR** finding identified within the specified repair diff. No tests, builds, typechecks, linters, or formatters were run.
