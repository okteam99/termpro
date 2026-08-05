#!/usr/bin/env python3
"""
E2E smoke test for OKWORK-F260805033051 Remote Connection Controls.

Verifies cross-process orchestration:
- Main process + Renderer process + Host process all start successfully
- IPC handler registration/unregistration is properly balanced (no double-registration)
- SMOKE_OK signal appears in logs

Does NOT verify:
- UI interaction or visual correctness (that's browser_e2e scope)
- Detailed connection/disconnection logic (that's covered by unit/integration tests)
"""

import os
import subprocess
import sys
from pathlib import Path


def run_smoke_test() -> int:
    """
    Run electron-forge smoke test with validation.

    Returns:
        0 if all assertions pass, 1 otherwise
    """
    # Get worktree root (script is in docs/features/.../e2e/)
    script_dir = Path(__file__).parent
    worktree_root = script_dir.parent.parent.parent.parent

    print(f"Running smoke test from: {worktree_root}")

    # Prepare environment
    env = {"OKWORK_SMOKE": "1"}

    try:
        # Run electron-forge with timeout
        result = subprocess.run(
            ["npx", "electron-forge", "start"],
            cwd=str(worktree_root),
            capture_output=True,
            text=True,
            timeout=180,
            env={**os.environ, **env},
        )

        stdout = result.stdout
        stderr = result.stderr
        combined_output = stdout + stderr

        # Assertion 1: Exit code should be 0
        if result.returncode != 0:
            print(f"❌ Exit code assertion failed: expected 0, got {result.returncode}")
            print(f"\nSTDOUT:\n{stdout}")
            print(f"\nSTDERR:\n{stderr}")
            return 1

        print("✅ Exit code is 0")

        # Assertion 2: SMOKE_OK should appear in output
        if "SMOKE_OK" not in combined_output:
            print("❌ SMOKE_OK assertion failed: marker not found in output")
            print(f"\nSTDOUT:\n{stdout}")
            print(f"\nSTDERR:\n{stderr}")
            return 1

        print("✅ SMOKE_OK marker found")

        # Assertion 3: No double handler registration
        if "Attempted to register a second handler" in combined_output:
            print("❌ Handler registration assertion failed: double-registration detected")
            print("This indicates IPC handler teardown was not properly called")
            print(f"\nSTDOUT:\n{stdout}")
            print(f"\nSTDERR:\n{stderr}")
            return 1

        print("✅ No double handler registration")

        # All assertions passed
        print("\n" + "=" * 60)
        print("✅ All smoke test assertions passed")
        print("=" * 60)
        print("Three processes (main + renderer + host) started successfully")
        print("IPC handler registration/unregistration is properly balanced")
        return 0

    except subprocess.TimeoutExpired:
        print("❌ Test timed out after 180 seconds")
        return 1
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(run_smoke_test())
