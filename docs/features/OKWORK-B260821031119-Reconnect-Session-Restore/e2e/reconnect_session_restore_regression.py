#!/usr/bin/env python3
"""Run the executable regression for the reconnect session-restore race.

This is intentionally a thin Python-to-Vitest driver.  It is not an API-E2E
client: the product path under test is an Electron renderer lifecycle path.
"""

from __future__ import annotations

import json
import shlex
import subprocess
import sys
from pathlib import Path


SCENARIO = "stale_readopt_failure_suppressed_after_queued_success"
COMMAND = [
    "npx",
    "vitest",
    "run",
    "src/renderer/services/__tests__/sessionReadoptNotice.test.ts",
    "--testNamePattern",
    "新一轮已排队并成功",
    "--reporter=dot",
]


def find_repo_root() -> Path:
    """Find the repository root without relying on the caller's cwd."""

    script_path = Path(__file__).resolve()
    for candidate in (script_path.parent, *script_path.parents):
        if (candidate / "package.json").is_file() and (candidate / "src").is_dir():
            return candidate
    raise RuntimeError("could not locate repository root from script path")


def main() -> int:
    command_text = shlex.join(COMMAND)
    try:
        repo_root = find_repo_root()
        result = subprocess.run(
            COMMAND,
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.stdout:
            sys.stdout.write(result.stdout)
            if not result.stdout.endswith("\n"):
                sys.stdout.write("\n")
        if result.stderr:
            sys.stderr.write(result.stderr)
        exit_code = result.returncode
    except (OSError, RuntimeError) as error:
        sys.stderr.write(f"regression driver failed to start: {error}\n")
        exit_code = 127

    verdict = "PASS" if exit_code == 0 else "FAIL"
    print(
        json.dumps(
            {
                "scenario": SCENARIO,
                "command": command_text,
                "exit_code": exit_code,
                "verdict": verdict,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
