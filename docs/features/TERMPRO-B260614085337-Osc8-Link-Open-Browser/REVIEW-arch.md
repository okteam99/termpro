# Architect Review — BUG-TERMPRO-B260614085337-001 (OSC 8 链接直开浏览器)

**Reviewer**: Architect (skeptical-by-default)
**Dev commit**: `3a07bb7`
**Verdict**: APPROVE
**Confirmed P1**: 0 · **Confirmed P2**: 0 · (3 P3 advisory, all optional)

---

## Summary

The fix adds `linkHandler: createOscLinkHandler()` to the `new Terminal({...})` options in
`terminalRegistry.ts`, where the factory's `activate(event, uri)` calls
`event.preventDefault()` + `window.termpro.openExternal(uri)`. This is the **minimal, correct,
and idiomatic** fix. It is a real root-cause fix, not a symptom patch: xterm's core
`OscLinkProvider` routes OSC-8 activation through `linkHandler.activate` *if and only if* a
`linkHandler` is present, otherwise it falls to `defaultActivate` (the `confirm()` +
`window.open()` dialog). Providing the handler permanently removes the dialog code path.

Security posture is sound and in fact *double-guarded*: OSC-8 URIs are filtered to http/https
by `OscLinkProvider` before they ever reach the handler (`allowNonHttpProtocols` left at its
default falsy value), and main's `shell:open-external` independently re-checks `^https?://`.
The layering red line (README §五) is respected — the handler reaches the OS only via the
`window.termpro.openExternal` → preload → main IPC bridge, never touching fs/PTY/git directly
and never importing Electron in the renderer/host boundary. No double-open or regression to the
custom `SystemWebLinkProvider` (plain-text) or `FsLinkProvider` (file) paths.

I attempted to refute each finding below; none survived as P1/P2.

---

## Findings

### F1 — `linkHandler` is the correct public xterm option, and supplying it provably suppresses `defaultActivate`
- **Severity**: P3 (confirmation, no action)
- **Claim**: The author uses `linkHandler` correctly and it actually prevents the dialog for OSC links.
- **Evidence**:
  - `node_modules/@xterm/xterm/typings/xterm.d.ts:163` — `linkHandler?: ILinkHandler | null` is a public `ITerminalOptions` field.
  - `xterm.d.ts:1353-1360` — `ILinkHandler.activate(event, text, range)`; the factory's `activate: (event, uri) => {...}` (2 params) is type-compatible (a JS callback may ignore trailing params). tsc passed per the gate.
  - `node_modules/@xterm/xterm/src/browser/OscLinkProvider.ts:89` — `activate: (e, text) => (linkHandler ? linkHandler.activate(e, text, range) : defaultActivate(e, text))`. With a handler present, `defaultActivate` (lines 114-129, the `confirm`/`window.open` source) is **never** reached.
  - `node_modules/@xterm/xterm/src/common/services/OptionsService.ts:31,96` — default `linkHandler: null`, which is why the bug existed.
- **Skeptic check**: Could `linkHandler` be a private/proposed API requiring `allowProposedApi`? No — it is in the stable typings `ITerminalOptions`, unrelated to proposed API. Could xterm read `linkHandler` somewhere else and double-fire? Searched all of `node_modules/@xterm/xterm/src`: `linkHandler` is referenced **only** by `OscLinkProvider` (plus the OptionsService default + Services interface decl). No other consumer.
- **Verdict**: CONFIRMED correct. No change needed.

### F2 — Security: only http/https can reach the handler; arbitrary-scheme / file:// / javascript: cannot
- **Severity**: P3 (confirmation, no action)
- **Claim**: Dropping the confirm dialog does not open a scheme-injection hole.
- **Evidence**:
  - `OscLinkProvider.ts:71-83` — when `!linkHandler?.allowNonHttpProtocols`, the provider does `new URL(text)` and sets `ignoreLink = true` unless `parsed.protocol ∈ {http:, https:}`; invalid URLs also ignored. The factory does **not** set `allowNonHttpProtocols` → it is `undefined` → falsy → guard is active. So `javascript:`, `file:`, `data:`, custom schemes are filtered at the provider and never handed to `activate`.
  - `src/main/main.ts:102` — `shell:open-external` independently re-guards `if (typeof url === 'string' && /^https?:\/\//i.test(url))` before `shell.openExternal`. Defense-in-depth: even if a non-http URI somehow reached `openExternal`, main drops it.
  - `src/preload/preload.ts:71-73` — `openExternal` is a thin `ipcRenderer.send('shell:open-external', url)`; no extra surface.
- **Skeptic check**: Is removing the user-facing confirm acceptable for a terminal app? Yes, and it is the *correct* product decision: (a) plain-text http(s) links already open without a dialog via `SystemWebLinkProvider` — keeping OSC links behind a dialog was an inconsistent accident, not a security feature; (b) the scheme is constrained to http/https by two independent guards; (c) the dialog text ("could potentially be dangerous") is xterm's generic default, not a TermPro-considered warning. Terminal output is already trusted-enough to run arbitrary code, so a click-to-open http link is a strictly smaller risk than what the user already grants the shell. Could a malicious OSC link spoof a benign visible label while pointing elsewhere? Yes — but that is true of *all* hyperlinks everywhere (and of the plain-text path too); `shell.openExternal` to the system browser (sandboxed, no `opener`) is the safe sink. Not introduced or worsened by this fix.
- **Verdict**: CONFIRMED safe. No change needed.

### F3 — Layering / remote-ready red line is respected
- **Severity**: P3 (confirmation, no action)
- **Claim**: The handler does not bypass the renderer→Host/IPC boundary.
- **Evidence**: `terminalLinks.ts:165-168` calls `window.termpro.openExternal(uri)`, a `contextBridge`-exposed shell API (`preload.ts:6,71-73`) that `ipcRenderer.send`s to main. This is the *shell/OS* IPC lane (window/OS capabilities), explicitly distinct from the HostService protocol used for fs/pty/git (`preload.ts:4-5` comment: "一切工程数据(fs/pty/git)走 HostService 协议,不经过这里"). Opening a system browser is an OS-shell concern, correctly on the shell lane. No Electron import enters the renderer; the host process is untouched.
- **Skeptic check**: Should browser-opening have gone through HostService instead (for true remote readiness)? No — `openExternal` is inherently a *client-local* action (open the user's local browser), so routing it through the local Electron shell lane is correct; a remote Host opening a browser would be wrong. The existing `SystemWebLinkProvider` and viewer paths already use `window.termpro.*` the same way; this fix is consistent with established architecture.
- **Verdict**: CONFIRMED compliant. No change needed.

### F4 — `event.preventDefault()` is correct; no double-open risk between OscLinkProvider and SystemWebLinkProvider
- **Severity**: P3 (confirmation, no action)
- **Claim**: `preventDefault` is appropriate and the two link paths cannot both fire for one click.
- **Evidence**:
  - Registration order → precedence: `node_modules/@xterm/xterm/src/browser/services/LinkProviderService.ts:16` registers via `push` (append). Core registers `OscLinkProvider` at construction (`CoreBrowserTerminal.ts:160`) → index 0; `terminalRegistry.ts:88,96` register `SystemWebLinkProvider`/`FsLinkProvider` later → indices 1,2.
  - De-dup keeps the lowest index: `Linkifier.ts:160-171` (intersecting cells `splice` out later providers' links) and `:175-198` (only the first non-undefined provider's link at a position is used). So for an OSC-8 cell, OscLinkProvider's link wins and `SystemWebLinkProvider` is suppressed for those cells → exactly one `activate` fires.
  - `preventDefault`: mirrors the existing `SystemWebLinkProvider.activate` (`terminalLinks.ts:198`) and prevents any default browser navigation on the synthesized link element. Harmless and consistent. (The OSC handler omits `stopPropagation`, which `SystemWebLinkProvider` calls — see F5; not a correctness defect.)
- **Skeptic check**: Could a plain http(s) URL that is *also* an OSC link cause both handlers to run? No — the de-dup guarantees one winner per cell. Could `preventDefault` swallow a needed default? The link target is a synthetic xterm overlay, not a real anchor; there is no useful default to preserve. Could omitting `stopPropagation` bubble the click to the terminal and, say, move the cursor / start a selection? xterm dispatches link activation on mouseup after a mousedown-mouseup match (`Linkifier.ts:220-233`); in practice this has not caused issues for the existing path, and the symmetric plain-text path does call it — see F5 for the minor consistency nit.
- **Verdict**: CONFIRMED no double-open. No change required.

### F5 — (advisory) `createOscLinkHandler` could mirror `SystemWebLinkProvider` and also call `stopPropagation()`
- **Severity**: P3 (optional polish)
- **Claim**: For full symmetry with the plain-text path, the OSC handler might also `event.stopPropagation()`.
- **Evidence**: `terminalLinks.ts:197-201` (plain text) does `preventDefault()` **and** `stopPropagation()`; `terminalLinks.ts:165-168` (OSC) does only `preventDefault()`.
- **Skeptic check**: Is this a real bug? No — the activation is delivered by xterm's own Linkifier mouseup handler, not a bubbling DOM anchor click, so propagation past the handler is not known to cause misbehavior, and the dev gate (smoke) passed. This is cosmetic consistency, not correctness. Over-prescribing it would be gold-plating.
- **Verdict**: CONFIRMED as a minor inconsistency, **not** a defect. Optional: add `event.stopPropagation()` for parity with the plain-text handler. No blocking action.

### F6 — (advisory) OSC `file://` links become non-clickable, but this is pre-existing, not a regression
- **Severity**: P3 (note only)
- **Claim**: An OSC-8 hyperlink whose URI is `file://...` will be dropped (not opened in the file panel).
- **Evidence**: `OscLinkProvider.ts:71-83` ignores non-http(s) OSC URIs whenever `allowNonHttpProtocols` is falsy. This was already the case **before** this fix (no `linkHandler` → `allowNonHttpProtocols` still effectively undefined/falsy), so `file://` OSC links were already ignored. `FsLinkProvider` only ever handled plain-text path candidates (`terminalLinks.ts:232` filters `kind === 'fs'`), never OSC cells.
- **Skeptic check**: Does the fix make file-link behavior worse? No — behavior for `file://` OSC links is identical before and after (silently non-clickable). Bringing OSC `file://` into the FsLinkProvider flow would be a *new feature*, out of scope for this bug, and would require `allowNonHttpProtocols: true` + a careful path-validation handler — explicitly more risk. Correctly out of scope.
- **Verdict**: CONFIRMED no regression. Out of scope; note only.

---

## Tests

`src/renderer/terminal/__tests__/terminalWebLinks.test.ts:96-131` adds two regression tests that
directly exercise `createOscLinkHandler().activate(...)`: they assert `preventDefault` fires
once, `openExternal` receives the exact URI, and `window.confirm`/`window.open` are **never**
called (the dialog/new-window path is gone). They use the real bug URL
`http://localhost:56868/shell/close-install-confirmation` plus an https case. The existing
`SystemWebLinkProvider` test (`:65-94`) confirms the plain-text path is unchanged. Tests target
the factory directly rather than the full Linkifier integration — acceptable for a unit-level
regression, since the integration contract (OscLinkProvider → linkHandler.activate) is xterm's
documented behavior verified above. Gate reported tsc 0 / vitest 179 / SMOKE_OK.

**Suggested (optional, non-blocking)**: a test asserting a non-http OSC URI is *not* routed to
`openExternal` would lock in the `allowNonHttpProtocols=false` security contract at the TermPro
layer — currently that guard lives only in xterm core + main, untested from this module.

---

## Alternatives considered (is this the minimal correct fix?)

Yes. Alternatives — (a) deregister/reorder the core `OscLinkProvider`, (b) a custom OSC provider
— are strictly worse: the core provider is auto-registered and not cleanly removable, and neither
turns off the `defaultActivate` semantics that cause the dialog. `linkHandler` is xterm's
*official* customization point for exactly this; supplying it is the smallest change that fixes
the root cause. The diagnosis doc (`BUG-...-001.md:116-139`) reasoned through and correctly
rejected the hacks.

---

VERDICT: APPROVE
