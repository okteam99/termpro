#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path


def run(repo: Path, cmd: list[str]) -> int:
    print(f"$ {' '.join(cmd)}", flush=True)
    proc = subprocess.run(
        cmd,
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    print(proc.stdout, end="" if proc.stdout.endswith("\n") else "\n")
    print(f"exit-code={proc.returncode}", flush=True)
    return proc.returncode


def main() -> int:
    feature_dir = Path(__file__).resolve().parents[1]
    repo = feature_dir.parents[2]
    commands = [
        ["npm", "test"],
        ["npm", "run", "typecheck"],
        ["npm", "run", "lint"],
    ]
    failures = [code for code in (run(repo, cmd) for cmd in commands) if code != 0]
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
