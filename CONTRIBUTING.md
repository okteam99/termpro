# Contributing to OkWork

Thank you for your interest in OkWork! We welcome contributions of all kinds — bug reports, feature requests, documentation improvements, translations, UX feedback, and code. If you are new to the project, look for issues tagged **good first issue** or **help wanted** to find a good starting point. Non-code contributions are just as valuable as code.

---

## Dev setup

**Requirements:** Node.js 20+ (CI runs Node 22), npm, macOS (Apple Silicon or Intel).

```bash
npm install          # Install dependencies (also compiles node-pty against Electron)
npm start            # Electron-forge dev server: Vite HMR + Electron
npm run typecheck    # tsc --noEmit full type check (no build output)
npm run lint         # eslint over .ts/.tsx
npm test             # vitest unit tests
```

**Headless smoke test** (also used in CI):

```bash
OKWORK_SMOKE=1 npx electron-forge start
```

The app starts, completes the Host handshake, writes one PTY output, prints `SMOKE_OK`, and exits. If it times out (30 s), it prints `SMOKE_TIMEOUT` and exits with code 1.

---

## The green gate (non-negotiable)

Every commit and every PR must pass all three checks before it is considered ready:

| Check | Command | What it verifies |
|---|---|---|
| Type check | `npm run typecheck` | Zero TypeScript errors |
| Unit tests | `npm test` | vitest suite green |
| Smoke | `OKWORK_SMOKE=1 npx electron-forge start` | App boots and Host handshake succeeds |

Do not submit a PR that fails any of these.

---

## Architecture red lines

These rules exist to keep OkWork's "remote-ready" architecture intact. PRs that violate them will not be merged.

### 1. UI never directly touches the filesystem, PTY, or git

The renderer has zero `node:fs` or `node-pty` imports. All data access (file reads/writes/watch, PTY I/O, git commands) must go through `src/renderer/services/hostClient.ts` using the HostService protocol. This is what makes it possible to move the Host to a remote machine without touching the UI.

### 2. Host process has zero Electron dependencies

No file under `src/host/` may import from `'electron'`. OS notifications and Dock badges live in `src/main/` and are driven by Host events. The Host must run as a plain Node process locally (via `utilityProcess`) and remotely (via SSH) from the same code.

### 3. To add or change an RPC, edit `src/shared/protocol.ts` first

`protocol.ts` is the single source of truth for the communication contract: message types, the `RpcMethods` registry, and `FLOW` constants. Declare the new type there before implementing the host-side handler or renderer-side call.

### 4. All paths in the UI are `(hostId, path)` — never bare local paths

The renderer never holds a raw local filesystem path as a plain string. File tree, read/write, and watch operations all go through the Host fs service.

---

## Directory map

```
src/host/           Pure Node Host process (zero Electron imports, remote-ready)
                    PTY pool · fs service · git service · watch service · session state machine
src/shared/
  protocol.ts       The ONLY communication contract between UI and Host
src/renderer/       React UI
  services/
    hostClient.ts   HostClient singleton: RPC dispatch, PTY stream, flow-control ACK
  state/
    store.ts        Zustand store (Workspace / Tab state)
  terminal/
    terminalRegistry.ts  Terminal instances survive React remounts
src/main/           Electron shell: window, menu, utilityProcess, layout persistence
```

---

## PR process

1. Branch from `main`. Keep PRs focused — one logical change per PR.
2. Fill in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
3. Ensure all three green-gate checks pass.
4. Reference any related issue with `Closes #N` or `Relates to #N`.
5. For UI changes, include a screenshot or recording.

The authoritative deep-dive specs (currently in Chinese) are:

- [`project-specs/DEV-RULES.md`](project-specs/DEV-RULES.md) — architecture red lines, performance red lines, test and release discipline
- [`docs/DEV.md`](docs/DEV.md) — dev details, directory structure, known constraints

---

## Platform notes

OkWork currently targets **macOS only** (Apple Silicon and Intel). Windows and Linux are on the roadmap — if you want to help with that, please open an issue to discuss first.

---

## Questions?

Open a [Discussion](https://github.com/okteam99/termpro/discussions) rather than an issue for questions or design ideas.
