---
reviewer: architect
verdict: NEEDS_REVISION
---
# Architecture Review

## Scope

Reviewed `PRD.md`, `TC.md`, `TECH.md`, the dev diff from `55efc1618f1cdb032bfd0241f4dc7b715671347a..1d932fca40400d5c960a3eef8215731f70c4e43b`, and the FilePanel/Terminal implementation.

## Findings

### A-1 · Directory targets are marked expanded before their children are loaded

Severity: high

`FilePanelController.loadLocateChain` adds the directory target to `requiredExpanded`, but it only reads each segment's parent entries. It does not read the target directory's own entries into `cacheDelta`, and `applyLocateCommit` does not emit a `fetchChild` effect for the newly expanded target. `FilePanel.tsx` renders expanded children only when `cache.get(absPath)` exists, so a successfully located directory can appear as an expanded empty folder until a later refresh or watcher update.

This violates AC-5 / T-005 and should be fixed before merge.

### A-2 · Case-folded row matching is not gated by host platform

Severity: high

`loadLocateChain` always calls `matchEntry(..., { darwinTrusted: true })`. TECH limits case-fold fallback to darwin trusted paths and says non-darwin or unknown sensitivity must not lower-case guess. The current implementation bakes that policy into every host, which is inconsistent with TermPro's remote-ready architecture.

This should be gated on host platform before merge.

### A-3 · Symlink directory display-path scenario is under-specified in implementation

Severity: medium

TECH T-037 requires `/repo/link/file.ts` to expand the displayed `link/file.ts` path, not jump to the real sibling path. The controller does use display segments, but the rendered tree only expands rows whose `entry.kind === "dir"`. Host `listDir` currently reports symlink entries as `symlink`, while activation-time `fs.stat` follows symlinks and may report the clicked target as a directory. A symlink-to-directory in the middle of the path can therefore be added to `expanded` while the React tree refuses to recurse into it.

Fix either by classifying symlink-to-directory entries as expandable directory rows at the host boundary, or by making FilePanel expansion/rendering explicitly support located symlink directories.

## Positive Checks

- Terminal routing stays decoupled from FilePanel internals through `locateRegistry`.
- Fallback ownership remains in `terminalLinks.ts`, so opener context is not reconstructed from a reduced FilePanel request.
- `locateCommit` is handled before root stale gating and updates runtime inputs before persisting mode, which matches the TECH transaction design.
- `fs.realpath` stays behind HostService; renderer does not import Node fs APIs.

## Verdict

NEEDS_REVISION. The architecture is mostly aligned, but A-1 and A-2 are merge-blocking because they contradict explicit TECH/AC behavior. A-3 should be covered while touching the same locate path.
