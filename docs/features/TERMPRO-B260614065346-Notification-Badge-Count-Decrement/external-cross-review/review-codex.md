---
review_model: codex-cli 0.139.0
review_role: external
review_stage: review
target_commit: de1de39
target_base: origin/main
title: "TERMPRO-B260614065346-Notification-Badge-Count-Decrement · review stage external review"
generated_at: "2026-06-14T07:28:27Z"
invoked_by: state.py external-review (v8.20)
host: claude-code
---
REVIEW-ACK review-codex-20260614T072646Z

---
perspective: codex external reviewer
target: origin/main...de1de39
files_read:
  - src/renderer/state/store.ts
  - src/renderer/state/__tests__/notificationBadge.test.ts
  - src/renderer/components/Sidebar.tsx
  - src/renderer/components/NotificationCenter.tsx
  - src/renderer/services/sessionEvents.ts
  - src/renderer/App.tsx
  - docs/features/TERMPRO-B260614065346-Notification-Badge-Count-Decrement/bugfix/BUG-TERMPRO-B260614065346-001.md
  - docs/features/TERMPRO-B260614065346-Notification-Badge-Count-Decrement/state.json
  - docs/features/TERMPRO-B260614065346-Notification-Badge-Count-Decrement/review-log.jsonl
findings:
  - severity: medium
    file: src/renderer/state/store.ts
    line: 271
    summary: Workspace switching still bypasses the new read-marking path.
---

**Findings**

1. **Medium**: Workspace activation still leaves the bell badge stale for that workspace’s already-active tab. The new read-marking only runs inside `setActiveTab` at `src/renderer/state/store.ts:271`, but clicking a workspace row calls `setActiveWorkspace(ws.id)` at `src/renderer/components/Sidebar.tsx:260`, whose store action only updates `activeWorkspaceId` at `src/renderer/state/store.ts:202`. Repro: workspace B’s active tab receives a background notification while workspace A is active; click workspace B in the sidebar. The tab is now visible, but `notifications[].read` is not updated, so the top bell badge still does not decrement. The “viewed tab” cleanup should also run when `setActiveWorkspace` makes a workspace’s active tab visible, preferably via a shared helper.

**Verification**

- `npx vitest run src/renderer/state/__tests__/notificationBadge.test.ts` passed.
- `npm run typecheck` passed.

NEEDS_REVISION
