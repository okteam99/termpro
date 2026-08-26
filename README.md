<div align="center">

<img src="assets/logo.webp" alt="OkWork" width="112" />

# OkWork

**A terminal-first workbench for running many AI coding agents in parallel.**

The terminal doesn't care which agent runs inside it — **agent-agnostic** is the first design principle.

[![CI](https://github.com/okteam99/termpro/actions/workflows/ci.yml/badge.svg)](https://github.com/okteam99/termpro/actions/workflows/ci.yml)
&nbsp;
[![Release](https://img.shields.io/github/v/release/okteam99/termpro?label=release)](https://github.com/okteam99/termpro/releases)
&nbsp;
![Platform](https://img.shields.io/badge/platform-macOS-black)
&nbsp;
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[What is this](#what-is-this) · [Features](#features) · [Install](#install) · [Concepts](#concepts) · [Architecture](#architecture) · [Development](#development) · [Roadmap](#roadmap)

<sub>**English** · [简体中文](README.zh-CN.md)</sub>

</div>

## What is this

OkWork is a macOS desktop workbench (Electron) built for the workflow of driving multiple CLI agents in parallel across several projects and branches. The terminal is the product; everything around it — project management, session awareness, file browsing, git integration, Markdown preview — is the value layer on top.

## The problem it solves

Your day now looks like this: five Claude Code / Codex / other CLI agents grinding away across several projects and branches at once. Generic terminals give you "windows + tabs" but no concept of *projects* or *parallel sessions*, and they never tell you which session finished or which one is blocked waiting for your input.

Agent managers do the opposite — they lock you to one specific agent and treat the terminal as a second-class citizen.

OkWork takes the middle ground: **the terminal is the product; everything around it is the value.**

One window, many projects, many parallel sessions. The app tells you who is running, who finished, and who is waiting for input — without caring which agent is inside.

<p align="center">
  <img src="snapshot/01.webp" alt="OkWork main UI: workspace list on the left, terminal in the center, file panel on the right" width="860" />
</p>

## Features

- **Truly agent-agnostic** — the terminal stays dumb. Status detection uses only standard terminal-layer signals (foreground process name, OSC sequences, BEL). No parsing of agent-specific output. No dependency on agent hooks.
- **Projects and parallel sessions as first-class citizens** — Workspace / Tab are product-level abstractions. One window manages multiple projects and sessions. Layout and session structure persist across restarts.
- **Active status awareness, less screen-watching** — four agent-agnostic signals (foreground process name, OSC 133 command boundaries, BEL/OSC notifications, silence timeout) roll up into tab status dots, a sidebar attention counter, a notification center, Dock badge, and system notifications. The focused tab is never interrupted.
- **File panel with deep git worktree integration** — the file tree tracks the active session's working directory (Root or WorkTree view). The WorkTree selector pulls from `git worktree list`. Files are colored by git status (untracked / modified / ignored), with directory-level rollup. Auto-refreshes on changes while preserving expanded state. Read-only — OkWork shows worktree state; it doesn't manage worktree lifecycle.
- **Built-in Markdown preview and editing with native Mermaid** — read docs and review plans without switching apps. Toggle between preview and edit mode (default: preview). Rendered with marked + DOMPurify; Mermaid diagrams load lazily in strict mode with click-to-enlarge.
- **Monaco file viewer, light editor, and diff** — click any file to view it; ⌘S to save (binary / >2 MB files degrade gracefully). Diff view for uncommitted changes vs HEAD, and worktree vs merge-base with the base branch. Jump to VS Code or Zed for heavy editing.
- **Remote-ready architecture** — UI and Host process are fully separated; the UI depends on exactly one `HostService` interface. Locally this runs over MessagePort. In the future it runs over SSH tunnel + WebSocket with no UI changes.
- **AI drives the built-in browser (built-in MCP)** — a session's agent can operate OkWork's built-in browser through a per-terminal MCP endpoint: navigate, screenshot, read HTML/text, run JS, click / type / scroll / wait, and manage tabs (13 tools). It acts on your **real logged-in** browser session (cookies included). The endpoint URL is injected into the terminal env (`$OKWORK_BROWSER_MCP_URL`); wire it with one line: `claude mcp add --transport http okbrowser "$OKWORK_BROWSER_MCP_URL"`. Works for remote sessions too — if the remote machine has Chromium, the tools drive a headless browser **on that machine** (see *Cloud browser* below); otherwise an SSH reverse-forward transparently connects agents inside `okwork-node` containers back to the host. See `docs/DEV.md §4.8`, `§4.13`.

## Screenshots

<p align="center">
  <img src="snapshot/02.webp" alt="Git diff window (Monaco diff editor)" width="49%" />
  &nbsp;
  <img src="snapshot/04.webp" alt="Markdown preview with Mermaid diagram" width="49%" />
</p>

## Install

> macOS (Apple Silicon / Intel). Windows / Linux planned for the future.

1. Download the latest `.dmg` from [Releases](https://github.com/okteam99/termpro/releases) and drag OkWork to Applications.
2. On first launch, macOS may warn "unidentified developer" — go to System Settings › Privacy & Security › Open Anyway.
3. After that, no manual downloads needed. OkWork polls GitHub Releases and shows an upgrade capsule in the bottom-left sidebar when a new version is available. One click downloads and restarts via Squirrel.Mac (falls back to the release page if the update fails).

To run from source, see [Development](#development).

## SSH sandbox image (Docker)

Need a disposable SSH host to try OkWork's remote features — or just a Node.js box reachable over SSH? We publish a ready-made image (Node.js 22 + npm 12 + sshd + Docker Engine, with Claude Code and Codex CLI preinstalled, `linux/amd64` + `linux/arm64`):

**Image**: [`bdpgogoup/okwork-node`](https://hub.docker.com/r/bdpgogoup/okwork-node)

```bash
# SSH box on localhost:2222 (root / dev123)
docker run -d --name okwork-node -e SSH_PASSWORD=dev123 -p 2222:22 bdpgogoup/okwork-node
ssh root@127.0.0.1 -p 2222                # node -v → v22.x

# Same + Docker-in-Docker: an isolated inner dockerd per node
# (own container names / networks / ports / image cache)
docker run -d --name okwork-node --privileged -e SSH_PASSWORD=dev123 -p 2222:22 bdpgogoup/okwork-node
ssh root@127.0.0.1 -p 2222 docker run --rm hello-world
```

Common add-ons (all flags go **before** the image name):

- `-v ~/some-dir:/workspace` — share a host folder; login shells start in `/workspace`
- `-e SSH_USER=alice -e SSH_AUTHORIZED_KEYS="$(cat ~/.ssh/id_ed25519.pub)"` — non-root user with key-based login
- `-v alice-docker:/var/lib/docker` — keep the inner Docker image cache in a named volume so it survives recreating the node (default: a fresh anonymous volume per container; never share one volume between nodes)
- `--runtime=sysbox-runc` instead of `--privileged` — DinD without privileged mode, for servers shared by mutually untrusted users (requires [Sysbox](https://github.com/nestybox/sysbox) on the host)

Everything is set at `docker run` time via env vars:

| Env | Default | Meaning |
|---|---|---|
| `SSH_USER` | `root` | Login user; any other name is created on startup with passwordless `sudo` (and added to the `docker` group) |
| `SSH_PASSWORD` | random, printed in `docker logs` | Login password |
| `SSH_PORT` | `22` | sshd listen port **inside** the container |
| `SSH_AUTHORIZED_KEYS` | — | Public key(s) written to `~/.ssh/authorized_keys` |
| `DIND` | `auto` | Inner dockerd policy: `auto` starts one unless a host `/var/run/docker.sock` is mounted (DooD) and degrades to SSH-only if it can't start; `1` makes it required (container exits on failure); `0` disables it |
| `DOCKERD_EXTRA_ARGS` | — | Extra flags for the inner dockerd, e.g. `--registry-mirror=… --mtu=1400` |

Without `--privileged` (or sysbox) the inner dockerd can't start and the node falls back to SSH-only — `docker logs` shows the status either way. To reuse the host's Docker daemon instead (shared with everything else on the host), mount `-v /var/run/docker.sock:/var/run/docker.sock`. SFTP is enabled. Build source: [`docker/okwork-node/`](docker/okwork-node/).

Login shells export `IS_SANDBOX=1`, so agent CLIs treat the container as the disposable sandbox it is — e.g. Claude Code allows `--dangerously-skip-permissions` under the default root login (it refuses that combination elsewhere). Prefer not to run agents as root at all? Use `-e SSH_USER=<name>`.

## Concepts

| Concept | Meaning | UI location |
|---|---|---|
| **Workspace** | One project, usually one repo | Sidebar item |
| **Tab** | One parallel development session inside a Workspace; holds one PTY. Typically maps to a git worktree, but not required to. | Top tab bar |
| **Terminal** | A dumb terminal running any CLI | Center area |
| **File Panel** | File tree for the active session, switchable between Root and WorkTree root | Right panel |

> Core rule: the terminal stays dumb and agent-agnostic. All status detection goes through standard terminal-layer signals (process name, OSC sequences, BEL). OkWork never parses agent-specific output and never requires agent-specific hooks. Optional adapters may be added in the future, but the core will never depend on them.

## UI tour

```
┌────────────┬───────────────────────────────┬─────────────────┐
│ 🔔  ＋     │ Tab1 │ Tab2 ✕    [⌨][🌐][▥]   │ Root │ WorkTree │
│            ├───────────────────────────────┤ path…  [Choose] │
│ ▌Project A │                               │ 38 entries   ⟳  │
│  staging*  │                               │ ▸ .claude       │
│  ~/path    │      Terminal (xterm.js)      │ ▸ apps          │
│            │                               │ ▸ docs          │
│ Project B  │                               │   README.md     │
│  main      │                               │   …             │
│  ⎇ PR#289  │                               │                 │
└────────────┴───────────────────────────────┴─────────────────┘
```

- **Left sidebar (Workspace list)** — each item shows name / current branch (dirty marker `*`) / path / status badges (PR number, running / waiting for input). The active item is highlighted. `＋` at the top adds a new workspace.
- **Top tab bar** — session name + close button. Right side: content type / split-layout toggles.
- **Right File Panel** — Root / WorkTree toggle switches the tree root. The path bar accepts manual input + Apply. Entries are colored by git status. Entry count + manual refresh.
- **Notification center (🔔)** — aggregates "waiting for input" and "finished" events across all tabs. Click to jump to the relevant tab.

## What's shipped

Current release is a daily-usable local workbench (M1–M4 + v0.2/v0.3 increments, June 2026):

- **Project and session orchestration** — three-panel layout with drag-to-resize (persisted); workspace add/remove/rename/switch; tab add/remove/switch (⌘T / ⌘W / ⌘1–9), each tab gets one node-pty session (optional start directory); xterm.js ≥ 6 with WebGL renderer, unicode11 wide-char alignment, and search; structure and layout survive restarts.
- **Status awareness and notifications** — foreground process polling + OSC 133 command boundaries + BEL/OSC 9/777 + silence timeout; state machine lives in Host (keeps tracking when UI is disconnected); tab status dots, sidebar attention counter, notification center, Dock badge, system notifications; focused tab is never interrupted.
- **File and git workspace** — File Panel tracks Root / WorkTree per tab (not per `cd` in the terminal); file tree auto-refreshes on changes (preserving expanded state) with git status coloring and directory rollup; sidebar shows the main worktree's current branch; WorkTree selector pulls from `git worktree list`.
- **Preview / edit / diff** — Monaco file viewer with light editing (⌘S save; binary / >2 MB degrades gracefully); diff view (uncommitted vs HEAD, worktree vs merge-base); Markdown preview/edit with marked + DOMPurify sanitization and strict Mermaid rendering; one-click jump to VS Code / Zed.
- **Windows and updates** — three-window model (main terminal window / file content window / git diff modal); Host shares PTY pool across clients and routes by ownership; GitHub Release polling + sidebar upgrade capsule with Squirrel.Mac one-click update; dirty-tab close confirmation.
- **Crash resilience** (July 2026) — the local Host runs the same standalone session semantics as remote hosts: when the renderer dies or the window reloads, sessions detach and keep running (ring-buffer replay on re-attach) and get re-adopted with scrollback restored; the main process auto-reloads on abnormal renderer exit (rate-limited), so a renderer crash costs one flicker instead of a black screen with lost sessions.
- **Browser profiles per workspace** (July 2026) — the built-in browser supports multiple profiles (managed in Browser Settings; the built-in OkWork profile is undeletable): each profile gets isolated cookies / storage / cache and an optional custom User-Agent. A workspace picks its profile in the workspace edit dialog; sessions are partitioned two-dimensionally (profile × per-tab network exit) with the same fail-closed proxy discipline as remote exits. See `docs/DEV.md §4.7`.
- **In-project HTML preview** (August 2026) — click any `.html`/`.htm` file to render it instead of just viewing source: the Host lazily starts a per-root static server (loopback-only, token-gated, sandboxed to the project root with no directory listing), and the file panel / viewer open it as a pinned browser tab whose network exit is locked to the file's own machine — works for remote sessions too. See `docs/DEV.md §4.10`.
- **Remote file transfer** (August 2026) — hover a file in a remote project to download it to a local path of your choice, or hover a directory to upload local files into it: chunked stateless-offset protocol over the existing host connection (512 KiB blocks, strict-ordered upload parts with no-clobber landing), local disk access gated by a main-process ticket channel where paths only ever come from native dialogs, serial transfer queue with progress bar and cancel. See `docs/DEV.md §4.11`.
- **Remote host upgrade** (August 2026) — connected remote hosts show their version in Remote Hosts settings, with a one-click **Update** when it lags the app: after an explicit confirm (running sessions on that machine are terminated), the old host is reaped and the current bundle redeployed over the same connection lifecycle UI; "host too old" hints across the app (file transfer, image paste, HTML preview) now point at — or directly open — this entry. See `docs/DEV.md §4.12`.

- **Cloud browser** (August 2026) — on a remote machine with Chromium installed, the browser an agent drives now **runs on that machine**: the 13 `browser_*` MCP tools go straight to a headless Chromium over CDP on `127.0.0.1`, so the SSH reverse-forward back to your laptop is out of the loop entirely. It is headless by default (zero picture traffic); pressing ☁ in the browser panel switches the whole panel into **cloud-browser mode** — tabs, address bar, back/forward/reload all drive the remote browser (a blank remote tab shows an empty, focused address bar, ready to type), and you can actually drive the remote page — mouse, keyboard, IME (Chinese input included) and paste all reach it, with the page seeing `isTrusted` events. Frames travel on their **own** WebSocket (a separate SSH channel) as raw binary, so the picture never queues behind terminal output, and they stay ack-gated so at most one is ever in flight. Machines without Chromium keep the previous behaviour unchanged. See `docs/DEV.md §4.13`.

> Full milestone breakdown and roadmap: [`product-overview/OkWork_业务架构与产品规划.md`](product-overview/OkWork_业务架构与产品规划.md)

## Architecture

> **UI and Host are separated. Remote-ready by design.** The hard rule: the UI layer never directly touches the filesystem, PTY, or git — everything goes through the `HostService` protocol.
>
> The goal: terminal core logic can move to a remote machine in the future with zero UI changes. Modeled after VS Code Remote (workbench ↔ vscode-server).

```
┌── UI shell (Electron renderer + main) ───────────────────────┐
│  xterm.js · Monaco · React · OS notifications / Dock badge   │
│              depends on exactly one interface: HostService    │
└───────────────────────┬──────────────────────────────────────┘
    Unified protocol: RPC + event push + PTY binary stream (with flow control)
    Local transport: MessagePort     Remote transport: SSH tunnel + WebSocket
┌───────────────────────┴──────────────────────────────────────┐
│  Host process (pure Node, zero Electron dependency)          │
│  PTY pool · fs read/write/watch · git/gh · session state machine │
│  Output ring buffer (reconnect replay, tmux-style)           │
└──────────────────────────────────────────────────────────────┘
```

Key rules (full spec in [`project-specs/DEV-RULES.md`](project-specs/DEV-RULES.md) and [`project-specs/ARCHITECTURE.md`](project-specs/ARCHITECTURE.md)):

1. **Host process has zero Electron dependency** — locally it runs in a utilityProcess; remotely it runs as a standalone Node process spawned over SSH. Same code, both cases. OS notifications and Dock badge stay in the shell layer, driven by Host events.
2. **One protocol, three message types** — RPC, event push, PTY binary stream. Flow control (credit / pause-resume) is part of the protocol and shared between local and remote.
3. **All paths in the UI are `(hostId, path)` tuples** — no bare local paths exist in the UI. File tree, reads, writes, and watches all go through Host. APIs are coarse-grained to avoid chatty calls over WAN.
4. **git / gh run on the Host side** — the UI receives structured results only. Monaco file reads, writes, and diff content go through the fs service, so remote works automatically.
5. **Session state machine lives in Host** — Host does lightweight scanning of PTY byte output plus `pty.process` polling. Sessions and their states keep running when the UI disconnects. Host maintains an output ring buffer for reconnect replay.

This separation unlocks a tmux-like experience: close the lid, let agents keep running on the server, reconnect and see the badges. That maps directly to why this product exists.

## Tech stack and key decisions

| Decision | Choice | Reason |
|---|---|---|
| Shell | **Electron** (utilityProcess for PTY, MessagePort to renderer) | node-pty / xterm.js / Monaco are all first-class here |
| Terminal | **`@xterm/xterm` ≥ 6.0** + addon-webgl / fit / unicode11 / serialize / search | 6.0 adds synchronous output (DEC mode 2026), so Ink-style TUIs (Claude Code) render without flicker |
| PTY | **node-pty** | `process` property gives the foreground process name directly — status signal #1 |
| Editor / diff | **monaco-editor** (lazy-loaded) | diff view comes for free; not bundled in the initial render |
| git | Shell out to **`git` / `gh`** | No libgit2 dependency; smaller maintenance surface |
| Architecture | UI ↔ Host process separation, single RPC protocol | Remote-ready; local uses MessagePort, remote uses SSH tunnel + WebSocket |

**Why not fork Ghostty or build a native terminal?** Terminal quality (GPU rendering, input latency) is not the differentiator here. The native route would mean writing a sidebar, file tree, diff viewer, and notification system in Swift — and it would still only cover macOS. The cost-benefit is wrong. xterm.js running agentic CLIs is battle-tested at scale by VS Code and Cursor. [Crystal](https://github.com/stravu/crystal) (Electron + xterm.js + git worktree multi-session, MIT) is a same-shape precedent worth studying.

## Non-goals

- ❌ No full editor or LSP — delegate heavy editing to VS Code, Zed, or your editor of choice
- ❌ No bundled or locked-in agent; no parsing of agent-specific output formats
- ❌ Not chasing raw terminal performance — smooth enough for agent CLIs is the bar
- ⚠️ macOS only for now — Windows / Linux planned but not scheduled
- ⚠️ Remote sessions — the architecture is designed for it, but the feature ships in M5 (see the planning doc)

## Development

```sh
npm start          # dev mode
npm run typecheck  # type check
npm test           # unit tests
```

Headless smoke test: `OKWORK_SMOKE=1 npx electron-forge start` — pass if it prints `SMOKE_OK`.

Release: `npm version patch && git push --follow-tags` — CI builds and publishes the Release automatically.

More details and known constraints: [`docs/DEV.md`](docs/DEV.md). Architecture hard rules and test/release discipline: [`project-specs/DEV-RULES.md`](project-specs/DEV-RULES.md).

## Roadmap

Next up is **M5: Remote Host** — evolving the local Host into SSH/WebSocket remote access: Host packaged as a standalone executable, protocol version handshake, reconnect with scrollback replay and state reconciliation, remote notification bridging. Running in parallel: a stability pass (file panel positioning, worktree expansion, git status consistency, window and notification edge cases).

Full architecture, execution plan, and milestone tracking:

- [`product-overview/OkWork_业务架构与产品规划.md`](product-overview/OkWork_业务架构与产品规划.md) — product positioning, business architecture, execution plan, MVP scope, roadmap (upstream source of truth)
- [`project-specs/ARCHITECTURE.md`](project-specs/ARCHITECTURE.md) — architecture source of truth
- [`project-specs/DEV-RULES.md`](project-specs/DEV-RULES.md) — development rules and hard constraints

## Contributing

Issues and PRs welcome. Before writing code, read [`project-specs/DEV-RULES.md`](project-specs/DEV-RULES.md) (architecture constraints, performance constraints, test and release discipline) and [`docs/DEV.md`](docs/DEV.md). If you're changing the communication contract, start with `src/shared/protocol.ts`. The UI must never directly touch fs / PTY / git.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution guide.

## License

[MIT](LICENSE) © 2026 okteam99
