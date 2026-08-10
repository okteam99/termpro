#!/usr/bin/env python3
"""Live, redacted Host profile-continuity RPC verification.

Each request below starts a new ``node ... --profile-store-rpc`` process.  The
fixture Cookie identity/value and bootstrap capability remain in process memory
only: neither child output nor this script's output is replayed to the caller.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import uuid
from typing import Any


PROFILE_ID = "f" * 32
CLIENT_ID = base64.urlsafe_b64encode(b"\x19" * 32).rstrip(b"=").decode("ascii")
GENERATION = "profile-continuity-e2e-generation"
COOKIE_DOMAIN = "continuity-fixture.example.test"
COOKIE_NAME = "continuity-fixture-session"
COOKIE_VALUE = "continuity-fixture-cookie-value-not-for-output"


class CheckFailure(Exception):
    def __init__(self, step: str, category: str) -> None:
        self.step = step
        self.category = category
        super().__init__(f"{step}:{category}")


def require(condition: bool, step: str, category: str) -> None:
    if not condition:
        raise CheckFailure(step, category)


def repo_root() -> Path:
    # <repo>/docs/features/<feature>/e2e/<this file>
    return Path(__file__).resolve().parents[4]


def host_bundle() -> Path:
    configured = os.environ.get("OKWORK_HOST_BUNDLE")
    bundle = Path(configured) if configured else repo_root() / ".vite/build/host.js"
    if not bundle.is_absolute():
        bundle = (Path.cwd() / bundle).resolve()
    require(bundle.is_file(), "host-bundle", "missing-bundle")
    return bundle


def contains_fixture(value: str, capability: str | None) -> bool:
    markers = (COOKIE_DOMAIN, COOKIE_NAME, COOKIE_VALUE)
    return any(marker in value for marker in markers) or (
        capability is not None and capability in value
    )


def rpc(
    bundle: Path,
    data_dir: Path,
    request: dict[str, Any],
    step: str,
    capability: str | None = None,
) -> dict[str, Any]:
    environment = os.environ.copy()
    environment["OKWORK_HOST_DATA_DIR"] = str(data_dir)
    completed = subprocess.run(
        ["node", str(bundle), "--profile-store-rpc"],
        input=json.dumps(request, separators=(",", ":")),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=environment,
        check=False,
        timeout=15,
    )
    require(completed.returncode == 0, step, "host-exit")
    require(
        not contains_fixture(completed.stderr, capability),
        step,
        "stderr-secret-leak",
    )
    try:
        response = json.loads(completed.stdout)
    except (TypeError, ValueError):
        raise CheckFailure(step, "invalid-response") from None
    require(isinstance(response, dict), step, "invalid-response")
    require(response.get("requestId") == request["requestId"], step, "request-id")
    return response


def request(op: str, **fields: Any) -> dict[str, Any]:
    return {"version": 1, "requestId": str(uuid.uuid4()), "op": op, **fields}


def authorized(capability: str) -> dict[str, str]:
    return {
        "clientId": CLIENT_ID,
        "profileId": PROFILE_ID,
        "generation": GENERATION,
        "capability": capability,
    }


def success(response: dict[str, Any], step: str) -> dict[str, Any]:
    require(response.get("ok") is True, step, "unexpected-rpc-error")
    data = response.get("data")
    return data if isinstance(data, dict) else {}


def fixed_error(response: dict[str, Any], expected: str, step: str) -> None:
    require(response.get("ok") is False, step, "unexpected-success")
    require(response.get("code") == expected, step, "unexpected-error-code")


def cookie_operation(operation_id: str, base_revision: int) -> dict[str, Any]:
    return {
        "deviceId": CLIENT_ID,
        "operationId": operation_id,
        "profileEpoch": 0,
        "baseRevision": base_revision,
        "change": {
            "identity": {
                "domain": COOKIE_DOMAIN,
                "hostOnly": True,
                "path": "/",
                "name": COOKIE_NAME,
            },
            "kind": "upsert",
            "value": COOKIE_VALUE,
            "secure": True,
            "httpOnly": True,
            "sameSite": "lax",
            "expirationDate": 2_000_000_000,
        },
    }


def mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def run() -> None:
    bundle = host_bundle()
    with tempfile.TemporaryDirectory(prefix="okwork-profile-continuity-e2e-") as raw_dir:
        data_dir = Path(raw_dir)

        description = success(
            rpc(bundle, data_dir, request("describe"), "describe"), "describe"
        )
        continuity = description.get("continuity")
        require(isinstance(continuity, dict), "describe", "missing-continuity")
        require(continuity.get("version") == 1, "describe", "continuity-version")
        print("PASS: capability describes continuity v1")

        granted = success(
            rpc(
                bundle,
                data_dir,
                request(
                    "grant",
                    clientId=CLIENT_ID,
                    profileId=PROFILE_ID,
                    generation=GENERATION,
                ),
                "grant",
            ),
            "grant",
        )
        capability = granted.get("capability")
        require(isinstance(capability, str) and capability, "grant", "missing-capability")
        auth = authorized(capability)

        profile = {"id": PROFILE_ID, "name": "E2E continuity profile", "createdAt": 42}
        saved = success(
            rpc(
                bundle,
                data_dir,
                request("profile.save", **auth, payload={"profile": profile}),
                "profile-save",
                capability,
            ),
            "profile-save",
        )
        require(saved.get("id") == PROFILE_ID, "profile-save", "profile-not-saved")
        print("PASS: grant authorizes profile save")

        operation_id = str(uuid.uuid4())
        pushed = success(
            rpc(
                bundle,
                data_dir,
                request(
                    "continuity.push",
                    **auth,
                    payload=cookie_operation(operation_id, 0),
                ),
                "push",
                capability,
            ),
            "push",
        )
        require(
            pushed.get("revision") == 1 and pushed.get("outcome") == "accepted",
            "push",
            "push-result",
        )

        duplicate = success(
            rpc(
                bundle,
                data_dir,
                request(
                    "continuity.push",
                    **auth,
                    payload=cookie_operation(operation_id, 0),
                ),
                "duplicate-push",
                capability,
            ),
            "duplicate-push",
        )
        require(
            duplicate.get("revision") == 1
            and duplicate.get("outcome") == "duplicate",
            "duplicate-push",
            "idempotency",
        )
        print("PASS: persistent Cookie push is idempotent")

        pulled = success(
            rpc(
                bundle,
                data_dir,
                request(
                    "continuity.pull",
                    **auth,
                    payload={"fromRevision": 0, "pageBytes": 512 * 1024},
                ),
                "pull",
                capability,
            ),
            "pull",
        )
        records = pulled.get("records")
        require(
            isinstance(records, list)
            and len(records) == 1
            and isinstance(records[0], dict)
            and records[0].get("revision") == 1,
            "pull",
            "continuity-not-restored",
        )
        print("PASS: fresh Host process restores continuity record")

        forbidden = rpc(
            bundle,
            data_dir,
            request("profile.get", **{**auth, "capability": "invalid-capability"}),
            "forbidden",
            capability,
        )
        fixed_error(forbidden, "PROFILE_RPC_FORBIDDEN", "forbidden")
        print("PASS: wrong capability is fixed forbidden without stderr leak")

        continuity_dir = data_dir / "profile-store" / "continuity"
        continuity_file = continuity_dir / f"{PROFILE_ID}.json"
        encrypted = continuity_file.read_text(encoding="utf-8")
        require(
            not contains_fixture(encrypted, capability), "encrypted-file", "plaintext-leak"
        )
        try:
            envelope = json.loads(encrypted)
        except ValueError:
            raise CheckFailure("encrypted-file", "invalid-envelope") from None
        require(
            isinstance(envelope, dict)
            and envelope.get("algorithm") == "aes-256-gcm"
            and mode(data_dir / "profile-store") == 0o700
            and mode(continuity_dir) == 0o700
            and mode(continuity_file) == 0o600,
            "encrypted-file",
            "storage-protection",
        )
        print("PASS: continuity file is encrypted with private permissions")

        retire_operation = str(uuid.uuid4())
        retired = success(
            rpc(
                bundle,
                data_dir,
                request(
                    "profile.retire",
                    **auth,
                    payload={
                        "operationId": retire_operation,
                        "expectedEpoch": 0,
                        "kind": "moved",
                        "movedTo": "local",
                    },
                ),
                "retire",
                capability,
            ),
            "retire",
        )
        require(
            retired.get("lifecycle") == "moved" and retired.get("epoch") == 1,
            "retire",
            "retire-result",
        )

        for step in ("stale-push-first-process", "stale-push-second-process"):
            stale = rpc(
                bundle,
                data_dir,
                request(
                    "continuity.push",
                    **auth,
                    payload=cookie_operation(str(uuid.uuid4()), 1),
                ),
                step,
                capability,
            )
            fixed_error(stale, "PROFILE_MOVED", step)
        print("PASS: moved profile rejects stale pushes from fresh processes")


def main() -> int:
    try:
        run()
    except subprocess.TimeoutExpired:
        print("FAIL: host-rpc (timeout)")
        return 1
    except CheckFailure as error:
        print(f"FAIL: {error.step} ({error.category})")
        return 1
    except OSError:
        print("FAIL: host-rpc (process-error)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
