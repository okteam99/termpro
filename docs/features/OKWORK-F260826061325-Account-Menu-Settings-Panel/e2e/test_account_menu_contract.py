#!/usr/bin/env python3
"""Static contract check for the account menu / Settings panel (no Electron).

Renderer-only UI: live interaction e2e is the jsdom SettingsEntry suite.
This script locks production strings so a revert cannot silently restore
the old Settings footer list.
"""
from __future__ import annotations

import sys
from pathlib import Path


def find_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "src/renderer/components/SettingsEntry.tsx").is_file():
            return candidate
    print("cannot find repo root from", start, file=sys.stderr)
    sys.exit(2)


ROOT = find_root(Path(__file__).resolve())
entry = (ROOT / "src/renderer/components/SettingsEntry.tsx").read_text(encoding="utf-8")
panel = (ROOT / "src/renderer/components/settings/SettingsPanel.tsx").read_text(
    encoding="utf-8"
)
zh = (ROOT / "src/shared/i18n.zh.ts").read_text(encoding="utf-8")
preview = (ROOT / "src/renderer/services/openPreview.ts").read_text(encoding="utf-8")
html_preview = (ROOT / "src/renderer/components/viewer/HtmlPreview.tsx").read_text(
    encoding="utf-8"
)
registry = (ROOT / "src/renderer/terminal/terminalRegistry.ts").read_text(
    encoding="utf-8"
)

checks = [
    ("Login label", "t('Login')" in entry),
    ("Settings menu item", "t('Settings')" in entry),
    ("About menu item", "t('About')" in entry),
    ("Log out item", "t('Log out')" in entry),
    ("Not signed in", "t('Not signed in')" in entry),
    ("Appearance group", "t('Appearance')" in entry),
    ("Language embedded", "<LanguagePage" in entry and "embedded" in entry),
    ("Browser embedded", "<BrowserSettingsPage" in entry and "embedded" in entry),
    ("Remote Hosts embedded", "<RemoteHostsPage" in entry and "embedded" in entry),
    ("SettingsPanel shell", "export function SettingsPanel" in panel),
    ("nav General", "id: 'general'" in panel and "t('General')" in panel),
    ("nav Language", "id: 'language'" in panel),
    ("nav Browser", "id: 'browser'" in panel),
    ("nav Passwords", "id: 'passwords'" in panel),
    ("nav Remote Hosts", "id: 'remoteHosts'" in panel),
    ("zh Login", "Login: '登录'" in zh),
    ("zh Log out", "'Log out': '退出登录'" in zh),
    ("zh Not signed in", "'Not signed in': '未登录'" in zh),
    ("no old preview copy", "Settings → Remote Hosts" not in preview),
    ("no old html preview copy", "Settings → Remote Hosts" not in html_preview),
    ("no old paste copy", "Settings → Remote Hosts" not in registry),
]

failed = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(f"{'✓' if ok else '✗'} {name}")

if failed:
    print(f"FAIL {len(failed)}: {failed}", file=sys.stderr)
    sys.exit(1)

print("OK · account-menu source contract")
sys.exit(0)
