#!/usr/bin/env python3
"""
E2E for TERMPRO-F260613150158-Settings-About-Entry.

TermPro is an Electron desktop app — there is NO HTTP/API e2e (pure frontend + shell IPC).
The real cross-process verification is the headless smoke: it launches the REAL app
(Electron main + preload + renderer + Host child process), which exercises the only paths
jsdom unit tests cannot:
  - main `buildAdditionalArguments({version: app.getVersion(),...})` injecting `--termpro-version`
  - preload `parseVersionArg(process.argv)` exposing `window.termpro.version` over the real bridge
  - the real <Sidebar> rendering the new SettingsEntry footer without crashing

Pass = the app boots, renders, prints SMOKE_OK, and the renderer logs no errors.
exit-code 0 = pass.
"""
import os
import re
import subprocess
import sys

WORKTREE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
TIMEOUT_SEC = 240


def main() -> int:
    env = dict(os.environ, TERMPRO_SMOKE="1")
    print(f"[e2e] launching headless smoke in {WORKTREE} ...", flush=True)
    try:
        proc = subprocess.run(
            ["npx", "electron-forge", "start"],
            cwd=WORKTREE,
            env=env,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired as e:
        print(f"[e2e] FAIL: smoke timed out after {TIMEOUT_SEC}s", flush=True)
        print((e.stdout or "")[-2000:])
        return 1

    out = (proc.stdout or "") + (proc.stderr or "")

    if "SMOKE_OK" not in out:
        print("[e2e] FAIL: SMOKE_OK not found in output", flush=True)
        print(out[-2000:])
        return 1

    # No renderer-level JS errors during boot/render of the new footer.
    renderer_errors = re.findall(r"\[renderer:error\].*", out)
    if renderer_errors:
        print("[e2e] FAIL: renderer errors during boot:", flush=True)
        print("\n".join(renderer_errors[:10]))
        return 1

    print("[e2e] PASS: app booted, rendered (incl. SettingsEntry footer), SMOKE_OK, no renderer errors.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
