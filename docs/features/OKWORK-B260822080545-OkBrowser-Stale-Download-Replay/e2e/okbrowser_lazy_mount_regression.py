#!/usr/bin/env python3
"""Python→Vitest process regression driver for the OkBrowser lazy-mount bug.

This is deliberately not a live Electron, browser-e2e, or API-e2e test.  It
launches the two relevant Vitest files as a child process and preserves both
child streams while emitting a machine-readable result JSON on stdout.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path


COMMAND = [
    "npx",
    "vitest",
    "run",
    "src/renderer/components/__tests__/BrowserPanel.test.tsx",
    "src/renderer/services/__tests__/browserControl.test.ts",
]


def locate_worktree() -> Path:
    """Find the repository root from this file, independent of cwd."""

    script_path = Path(__file__).resolve()
    for candidate in script_path.parents:
        if not (candidate / "package.json").is_file():
            continue
        if not (candidate / ".git").exists():
            continue
        probe = subprocess.run(
            ["git", "-C", str(candidate), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=False,
        )
        if probe.returncode == 0:
            return Path(probe.stdout.strip()).resolve()
    raise RuntimeError(f"could not locate worktree from {script_path}")


def main() -> int:
    started = time.monotonic()
    try:
        worktree = locate_worktree()
        completed = subprocess.run(
            COMMAND,
            cwd=worktree,
            capture_output=True,
            text=True,
            check=False,
        )
        exit_code = completed.returncode
        stdout = completed.stdout
        stderr = completed.stderr
    except OSError as error:
        worktree = None
        exit_code = 127
        stdout = ""
        stderr = f"driver failed to start Vitest: {error}\n"
    except RuntimeError as error:
        worktree = None
        exit_code = 2
        stdout = ""
        stderr = f"driver setup failed: {error}\n"

    # Preserve the exact child streams without contaminating the final stdout
    # JSON document.  The report can retain these sections verbatim.
    sys.stderr.write("=== vitest stdout ===\n")
    sys.stderr.write(stdout)
    if stdout and not stdout.endswith("\n"):
        sys.stderr.write("\n")
    sys.stderr.write("=== vitest stderr ===\n")
    sys.stderr.write(stderr)
    if stderr and not stderr.endswith("\n"):
        sys.stderr.write("\n")
    sys.stderr.flush()

    result = {
        "driver": "Python→Vitest process regression driver",
        "live_electron": False,
        "api_e2e": False,
        "scope": "BrowserPanel lazy ZIP/programmatic mount request + browserControl background navigate",
        "worktree": str(worktree) if worktree is not None else None,
        "command": COMMAND,
        "exit_code": exit_code,
        "duration_seconds": round(time.monotonic() - started, 3),
        "stdout": stdout,
        "stderr": stderr,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
