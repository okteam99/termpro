#!/usr/bin/env python3
"""BL-002 Host Standalone + WS 传输 api-e2e(真跨进程 · 真实打包产物)。

场景(对应 PRD AC):
  A. AC-5 嵌入式零回归:TERMPRO_SMOKE=1 electron-forge start → SMOKE_OK。
  B. AC-4 打包产物:scripts/package-host.mjs 组装 darwin-arm64 产物(真实构建链)。
  C. AC-1/2/3 正向全链路:scripts/verify-host-artifact.mjs 起真实产物进程,
     WS token 握手 + host.info-first + 版本协商 + pty.spawn 真实 echo → VERIFY_OK。
  D. AC-3/7 负向门控:ws_negative_probe.mjs 对真实产物验证 错误 token/空 token(F3 回归)/
     首条非 host.info 均被拒 + 阳性对照 → PROBE_OK。

exit-code 0 = 全部通过。
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]

PASSED = []


def ok(name):
    PASSED.append(name)
    print(f"  ✓ {name}")


def run(name, cmd, expect, env=None, timeout=300):
    r = subprocess.run(
        cmd, cwd=REPO, env={**os.environ, **(env or {})},
        capture_output=True, text=True, timeout=timeout,
    )
    if expect not in r.stdout:
        print(f"  ✗ {name}: expect '{expect}' in stdout", file=sys.stderr)
        print(f"    stdout tail: {r.stdout[-500:]}", file=sys.stderr)
        print(f"    stderr tail: {r.stderr[-300:]}", file=sys.stderr)
        sys.exit(1)
    ok(name)
    return r


def main():
    print("场景 A · AC-5 嵌入式零回归(SMOKE)")
    run("E2E-A1 TERMPRO_SMOKE → SMOKE_OK", ["npx", "electron-forge", "start"],
        "SMOKE_OK", env={"TERMPRO_SMOKE": "1"})

    artifact = tempfile.mkdtemp(prefix="termpro-e2e-artifact-")
    print("场景 B · AC-4 打包产物组装(darwin-arm64)")
    run("E2E-B1 package-host.mjs 组装完成",
        ["node", "scripts/package-host.mjs", "--out", artifact],
        "[package-host] done:")

    print("场景 C · AC-1/2/3 正向全链路(真实产物进程 + WS 握手 + PTY echo)")
    run("E2E-C1 verify-host-artifact → VERIFY_OK",
        ["node", "scripts/verify-host-artifact.mjs", "--dir", artifact],
        "VERIFY_OK", timeout=60)

    print("场景 D · AC-3/AC-7 负向门控(错误/空 token · 门控违规 · 阳性对照)")
    run("E2E-D1 ws_negative_probe → PROBE_OK",
        ["node", str(HERE / "ws_negative_probe.mjs"), "--dir", artifact],
        "PROBE_OK", timeout=90)

    print(f"\nOK — {len(PASSED)} e2e assertions passed")


if __name__ == "__main__":
    main()
