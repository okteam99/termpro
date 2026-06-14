#!/usr/bin/env python3
from pathlib import Path


def require(name: str, condition: bool, failures: list[str]) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"{status} {name}")
    if not condition:
        failures.append(name)


def main() -> int:
    script = Path(__file__).resolve()
    feature_dir = script.parents[1]
    repo = script.parents[4]

    main_ts = (repo / "src/main/main.ts").read_text()
    updater_ts = (repo / "src/main/updater.ts").read_text()
    session_ts = (repo / "src/main/updateInstallSession.ts").read_text()
    sidebar_tsx = (repo / "src/renderer/components/Sidebar.tsx").read_text()
    prd_md = (feature_dir / "PRD.md").read_text()
    tc_md = (feature_dir / "TC.md").read_text()

    failures: list[str] = []
    require("app quit uses explicit requestAppQuit", "requestAppQuit" in main_ts, failures)
    require("before-quit is mark-only", "handleAppBeforeQuit();" in main_ts, failures)
    require("powerMonitor shutdown hook removed", "powerMonitor" not in main_ts, failures)
    require("update session helper is wired", "requestUpdateInstall" in updater_ts, failures)
    require("install checks are gated while installing", "!installSession.installing" in updater_ts, failures)
    require("confirming event is broadcast", "state: 'confirming'" in updater_ts, failures)
    require("staged retry decision exists", "reuse-staged" in session_ts, failures)
    require("renderer supports confirming label", "等待确认安装" in sidebar_tsx, failures)
    require("PRD scopes user quit to menu/Cmd+Q", "Quit TermPro" in prd_md and "Cmd+Q" in prd_md, failures)
    require("PRD documents system logout bypass", "logout / shutdown" in prd_md, failures)
    for test_id in ("T-016", "T-017", "T-018", "T-019"):
        require(f"TC includes {test_id}", test_id in tc_md, failures)

    if failures:
        print("\nFAILED checks:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("\nAll close/install contract checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
