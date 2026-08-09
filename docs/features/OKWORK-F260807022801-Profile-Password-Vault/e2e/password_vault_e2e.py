#!/usr/bin/env python3
"""Run the BL-006 live Electron end-to-end journey.

The product under test is a desktop Electron application, not an HTTP service.
This Test-stage Python entrypoint therefore delegates to the canonical Node
driver, which packages the app, launches a separate Electron process, and
controls it with Playwright. The child process exit code is propagated unchanged.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    project_root = Path(__file__).resolve().parents[4]
    driver = project_root / "e2e" / "password-vault.e2e.cjs"
    completed = subprocess.run(
        ["node", str(driver)],
        cwd=project_root,
        check=False,
    )
    return completed.returncode


if __name__ == "__main__":
    sys.exit(main())
