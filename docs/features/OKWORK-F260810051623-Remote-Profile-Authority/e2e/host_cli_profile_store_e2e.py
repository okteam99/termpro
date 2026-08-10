#!/usr/bin/env python3
"""Live cross-process E2E for the Remote Host Profile Store CLI.

This is deliberately not an HTTP API test.  Every request starts the real
compiled Host CLI in its one-request ``--profile-store-rpc`` mode, sends JSON
through stdin, and checks the single stdout response after process exit.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
HOST_BUNDLE = ROOT / ".vite" / "build" / "host.js"
DATA_DIR = Path(
    "/tmp/teamwork/OKWORK-F260810051623-Remote-Profile-Authority/"
    "host-cli-live-e2e"
)
PROFILE_ID = "a" * 32
CLIENT_ID = "c" * 43
GENERATION = "live-e2e-generation"
SENTINEL_PASSWORD = "bl007-e2e-password-sentinel-never-print"


def fail(message: str) -> None:
    raise AssertionError(message)


def rpc(request: dict[str, object]) -> tuple[dict[str, object], str]:
    env = os.environ.copy()
    env["OKWORK_HOST_DATA_DIR"] = str(DATA_DIR)
    completed = subprocess.run(
        ["node", str(HOST_BUNDLE), "--profile-store-rpc"],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        env=env,
        timeout=15,
        check=False,
    )
    if completed.returncode != 0:
        fail(f"Host CLI returned exit {completed.returncode}")
    try:
        response = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        fail(f"Host CLI did not return JSON: {error}")
    if not isinstance(response, dict):
        fail("Host CLI response was not an object")
    return response, completed.stderr


def request(op: str, **fields: object) -> dict[str, object]:
    return {"version": 1, "requestId": str(uuid.uuid4()), "op": op, **fields}


def require_ok(response: dict[str, object], label: str) -> dict[str, object]:
    if response.get("ok") is not True:
        fail(f"{label} failed with fixed code {response.get('code')!r}")
    data = response.get("data", {})
    if not isinstance(data, dict):
        fail(f"{label} returned unexpected data")
    return data


def require_private(path: Path, mode: int) -> None:
    actual = stat.S_IMODE(path.stat().st_mode)
    if actual != mode:
        fail(f"private permissions mismatch for {path.name}: {oct(actual)}")


def main() -> int:
    if not HOST_BUNDLE.is_file():
        fail("compiled Host bundle is missing; run npm run package first")
    shutil.rmtree(DATA_DIR, ignore_errors=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    described, stderr = rpc(request("describe"))
    description = require_ok(described, "describe")
    if description != {
        "protocolVersion": 1,
        "bundleVersion": 1,
        "encryption": "aes-256-gcm",
    } or stderr:
        fail("describe did not expose the expected non-secret capability description")
    print("PASS E2E-001 describe real Host CLI")

    granted, stderr = rpc(
        request(
            "grant",
            clientId=CLIENT_ID,
            profileId=PROFILE_ID,
            generation=GENERATION,
        )
    )
    grant = require_ok(granted, "grant")
    capability = grant.get("capability")
    if not isinstance(capability, str) or stderr:
        fail("grant did not issue an in-band capability")
    auth = {
        "clientId": CLIENT_ID,
        "profileId": PROFILE_ID,
        "generation": GENERATION,
        "capability": capability,
    }

    profile = {"id": PROFILE_ID, "name": "Live CLI Profile", "createdAt": 1700000000000}
    saved, stderr = rpc(request("profile.save", **auth, payload={"profile": profile}))
    if require_ok(saved, "profile.save") != profile or stderr:
        fail("profile.save did not persist the scoped profile")

    inserted, stderr = rpc(
        request(
            "vault.upsert",
            **auth,
            payload={
                "origin": "https://example.test",
                "username": "e2e-user",
                "password": SENTINEL_PASSWORD,
                "now": 1700000001000,
            },
        )
    )
    credential = require_ok(inserted, "vault.upsert")
    metadata = credential.get("metadata")
    if not isinstance(metadata, dict):
        fail("vault.upsert did not return credential metadata")
    entry_id = metadata.get("id")
    if (
        not isinstance(entry_id, str)
        or SENTINEL_PASSWORD in json.dumps(credential)
        or stderr
    ):
        fail("vault.upsert leaked a password or did not return scoped metadata")
    print("PASS E2E-002 save profile and exact-origin Vault credential")

    listed, stderr = rpc(request("vault.list", **auth))
    if listed.get("ok") is not True:
        fail(f"vault.list failed with fixed code {listed.get('code')!r}")
    entries = listed.get("data")
    if not isinstance(entries, list) or len(entries) != 1 or SENTINEL_PASSWORD in json.dumps(entries) or stderr:
        fail("vault.list leaked plaintext or did not return exactly one metadata row")
    print("PASS E2E-003 metadata list excludes password plaintext")

    forbidden, stderr = rpc(
        request(
            "vault.get",
            clientId=CLIENT_ID,
            profileId=PROFILE_ID,
            generation=GENERATION,
            capability="wrong-capability",
            payload={"id": entry_id},
        )
    )
    if forbidden.get("ok") is not False or forbidden.get("code") != "PROFILE_RPC_FORBIDDEN":
        fail("wrong capability was not rejected with the fixed forbidden code")
    if SENTINEL_PASSWORD in json.dumps(forbidden) or stderr != "[profile-store-rpc] PROFILE_RPC_FORBIDDEN\n":
        fail("forbidden response or stderr leaked the password or a variable error")
    print("PASS E2E-004 wrong capability fails closed without enumeration")

    ciphertext = DATA_DIR / "profile-store" / "profiles" / f"{PROFILE_ID}.json"
    root_dir = DATA_DIR / "profile-store"
    if not ciphertext.is_file():
        fail("encrypted profile ciphertext was not written")
    serialized = ciphertext.read_text(encoding="utf-8")
    if SENTINEL_PASSWORD in serialized or "Live CLI Profile" in serialized:
        fail("ciphertext file contains Profile or password plaintext")
    require_private(root_dir, 0o700)
    require_private(ciphertext, 0o600)
    print("PASS E2E-005 AES-GCM ciphertext and private file permissions")
    print("Host CLI live cross-process E2E: 5 passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, subprocess.TimeoutExpired) as error:
        print(f"FAIL Host CLI live cross-process E2E: {error}", file=sys.stderr)
        raise SystemExit(1)
