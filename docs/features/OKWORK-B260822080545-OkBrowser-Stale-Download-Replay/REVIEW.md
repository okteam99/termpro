---
reviewers: [fast]
review_models:
  fast: "gpt-5.5"
verdict: NEEDS_REVISION
coverage:
  fast: "Architect+QA cold review: checked fix-plan consistency, React effect updater ordering, first-active immediate mount, visited keep-alive, liveIds pruning, close/switch/popped-pane/Profile remount behavior, real store+BrowserPanel test seam, old-implementation red signal, window.open source precondition, state leakage, StrictMode, UUID assumptions, navigation/download semantics, privacy redaction. No tests rerun; dev evidence only read from state/report."
findings:
  - id: F1
    severity: MAJOR
    status: open
    source: qa
    title: "Programmatic browser_navigate on an unvisited background tab can report success without creating or loading a webview"
---

# Review Summary

Verdict: NEEDS_REVISION.

The lazy keep-alive implementation matches the diagnosed stale-download fix for the visible user path: the current active tab mounts on the first render, historical background ZIP tabs are not created, active tabs are added to a panel-session keep-alive set, and deleted tabs are pruned from that set. The new regression test uses the real store and `BrowserPanel` entry, and would fail against the old eager implementation because the background ZIP webview would be present on first render.

One production navigation path is still broken by the new render gate.

## Findings

### F1 · MAJOR · open

`browser_navigate` can now return success for a background terminal tab while no webview is mounted and no navigation request is sent.

Deterministic path:

1. `BrowserPanel` is open on terminal tab A. Terminal tab B has a persisted browser tab that has not been activated in this panel session.
2. The new render gate in `BrowserPanel.tsx` only renders a tab when it is currently visible or already in `mountedBrowserTabIds` (`src/renderer/components/BrowserPanel.tsx:1287`). Tab B is neither, so it returns `null`.
3. The MCP browser server is bound per terminal tab, and `browser_navigate` calls renderer `browserControl.navigate` for that terminal (`src/main/browserMcp.ts:37`).
4. `browserControl.navigate` resolves B's active browser tab, finds no registered webview, updates the store URL, skips `loadURL`, and returns success (`src/renderer/services/browserControl.ts:135`).
5. That store update does not add B to `mountedBrowserTabIds`, and B is still not the visible terminal, so `BrowserPanel` continues not rendering it. No page load happens; follow-up `eval` / screenshot will hit `browser view not ready`.

This is a regression from the old eager render, where B's webview existed and `loadURL` executed. It also contradicts the existing `browserControl.navigate` comment that an unmounted store update triggers first load.

Suggested fix: keep the historical ZIP protection, but treat explicit programmatic browser control as an intentional visit. For example, add a non-persistent "requested/mounted browser tab id" signal that `browserControl.navigate/openTab/activateTab` can set, and let `BrowserPanel` include those ids in the same session keep-alive gate. Avoid reverting to eager mounting all restored history.

## Coverage Notes

- React effect ordering looked sound: the active-tab add effect and workspaces prune both use functional updaters, and prune preserves the newly active id when it exists in `liveIds`.
- Current active first render is immediate because the render gate checks `isActive` before the effect-populated set.
- Closed/deleted tabs are removed from `mountedBrowserTabIds` through the existing `liveIds` prune.
- `poppedOut` panes remain skipped in the main window, and shell windows reuse the same lazy behavior.
- The new ZIP regression test uses real `useAppStore` actions and real `BrowserPanel`; it does not mock the component under test.
- Privacy check: the report uses a placeholder download host and does not persist real remote host identity.
