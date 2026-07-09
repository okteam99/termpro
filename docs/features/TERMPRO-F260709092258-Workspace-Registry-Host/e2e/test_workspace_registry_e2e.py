#!/usr/bin/env python3
"""BL-001 Workspace 注册表 api-e2e(真跨进程 · 真实构建产物 · 真实磁盘)。

场景(对应 PRD AC):
  A. 应用级冒烟:TERMPRO_SMOKE=1 electron-forge start → SMOKE_OK(壳层↔host 握手全链路;
     同时保证 .vite/build/host.js 为最新构建产物)。
  B. CRUD 落盘(AC-1/AC-2):真实 host 进程上 create×2 / update / remove,
     断言 rpc:res 与磁盘 workspaces.json 一致。
  C. 跨重启存活(AC-2):kill host → 同数据目录重启 → workspace.list 与场景 B 终态一致。
  D. 多客户端广播一致(AC-3):双客户端,client2 create → 两端都收到 workspace:changed
     全量快照且包含新条目。

exit-code 0 = 全部通过。任何断言失败/超时 → 非 0。
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import queue
from pathlib import Path

MARK = "@@E2E@@"
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]  # docs/features/<F>/e2e → worktree 根
DRIVER = HERE / "host_driver.mjs"

PASSED = []


def ok(name: str):
    PASSED.append(name)
    print(f"  ✓ {name}")


def fail(name: str, detail: str = ""):
    print(f"  ✗ {name}: {detail}", file=sys.stderr)
    sys.exit(1)


class HostProc:
    """驱动一个真实 host 进程(经 host_driver.mjs)。"""

    def __init__(self, data_dir: str):
        env = {**os.environ, "TERMPRO_HOST_DATA_DIR": data_dir}
        self.proc = subprocess.Popen(
            ["node", str(DRIVER)],
            cwd=REPO,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        self.events: "queue.Queue[dict]" = queue.Queue()
        self.rpc_id = 0
        t = threading.Thread(target=self._pump, daemon=True)
        t.start()
        self._wait_ev(lambda e: e.get("ev") == "ready", "driver ready")

    def _pump(self):
        for line in self.proc.stdout:
            if line.startswith(MARK):
                try:
                    self.events.put(json.loads(line[len(MARK):]))
                except json.JSONDecodeError:
                    pass

    def _send(self, obj: dict):
        self.proc.stdin.write(json.dumps(obj) + "\n")
        self.proc.stdin.flush()

    def _wait_ev(self, pred, what: str, timeout: float = 15.0) -> dict:
        deadline = time.time() + timeout
        stash = []
        while time.time() < deadline:
            try:
                e = self.events.get(timeout=max(0.05, deadline - time.time()))
            except queue.Empty:
                break
            if pred(e):
                for s in stash:
                    self.events.put(s)
                return e
            stash.append(e)
        fail(what, f"timeout waiting; stashed={stash[-3:]}")

    def attach(self, client: int):
        self._send({"op": "attach", "client": client})
        self._wait_ev(
            lambda e: e.get("ev") == "attached" and e.get("client") == client,
            f"attach client{client}",
        )

    def rpc(self, client: int, method: str, params=None, timeout: float = 15.0):
        self.rpc_id += 1
        rid = self.rpc_id
        self._send(
            {
                "op": "send",
                "client": client,
                "msg": {"t": "rpc:req", "id": rid, "method": method, "params": params},
            }
        )
        e = self._wait_ev(
            lambda e: e.get("ev") == "msg"
            and e.get("client") == client
            and e.get("msg", {}).get("t") == "rpc:res"
            and e.get("msg", {}).get("id") == rid,
            f"rpc {method} response",
            timeout,
        )
        msg = e["msg"]
        if not msg.get("ok"):
            fail(f"rpc {method}", f"host error: {msg.get('error')}")
        return msg.get("result")

    def wait_broadcast(self, client: int, timeout: float = 15.0) -> list:
        e = self._wait_ev(
            lambda e: e.get("ev") == "msg"
            and e.get("client") == client
            and e.get("msg", {}).get("t") == "workspace:changed",
            f"workspace:changed on client{client}",
            timeout,
        )
        return e["msg"]["workspaces"]

    def stop(self):
        try:
            self._send({"op": "exit"})
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()


def scenario_a_smoke():
    print("场景 A · 应用级冒烟(SMOKE_OK · 并产出最新 host 构建)")
    r = subprocess.run(
        ["npx", "electron-forge", "start"],
        cwd=REPO,
        env={**os.environ, "TERMPRO_SMOKE": "1"},
        capture_output=True,
        text=True,
        timeout=300,
    )
    if "SMOKE_OK" not in r.stdout:
        fail("SMOKE_OK", f"tail: {r.stdout[-400:]} / {r.stderr[-200:]}")
    ok("E2E-A1 应用无头冒烟 SMOKE_OK(壳层↔host 握手)")


def scenario_bcd():
    data_dir = tempfile.mkdtemp(prefix="termpro-e2e-reg-")
    root_a = tempfile.mkdtemp(prefix="termpro-e2e-wsA-")
    root_b = tempfile.mkdtemp(prefix="termpro-e2e-wsB-")
    root_c = tempfile.mkdtemp(prefix="termpro-e2e-wsC-")
    reg_file = Path(data_dir) / "workspaces.json"

    print("场景 B · CRUD 经协议落真实磁盘(AC-1/AC-2)")
    host = HostProc(data_dir)
    host.attach(1)
    a = host.rpc(1, "workspace.create", {"name": "alpha", "root": root_a})
    b = host.rpc(1, "workspace.create", {"name": "beta", "root": root_b})
    host.rpc(1, "workspace.update", {"id": a["id"], "name": "alpha2"})
    host.rpc(1, "workspace.remove", {"id": b["id"]})
    on_disk = json.loads(reg_file.read_text())
    names = [w["name"] for w in on_disk["workspaces"]]
    if names != ["alpha2"]:
        fail("E2E-B1 磁盘终态", f"expect ['alpha2'] got {names}")
    ok("E2E-B1 create×2/update/remove 后磁盘 = 内存终态(['alpha2'])")
    listed = host.rpc(1, "workspace.list")
    if [w["name"] for w in listed["workspaces"]] != ["alpha2"]:
        fail("E2E-B2 list 一致", str(listed))
    ok("E2E-B2 workspace.list 与磁盘一致")

    print("场景 C · 跨 host 重启存活(AC-2)")
    host.stop()
    host2 = HostProc(data_dir)
    host2.attach(1)
    survived = host2.rpc(1, "workspace.list")
    got = [(w["name"], w["root"]) for w in survived["workspaces"]]
    if got != [("alpha2", os.path.realpath(root_a))] and got != [("alpha2", root_a)]:
        fail("E2E-C1 重启存活", f"got {got}")
    ok("E2E-C1 重启后列表 = 最后一次成功操作终态")

    print("场景 D · 多客户端广播一致(AC-3)")
    host2.attach(2)
    host2.rpc(2, "workspace.create", {"name": "gamma", "root": root_c})
    bc1 = host2.wait_broadcast(1)
    bc2 = host2.wait_broadcast(2)
    for tag, bc in (("client1", bc1), ("client2", bc2)):
        if "gamma" not in [w["name"] for w in bc]:
            fail(f"E2E-D1 {tag} 广播含 gamma", str(bc))
    if [w["name"] for w in bc1] != [w["name"] for w in bc2]:
        fail("E2E-D2 两端快照一致", f"{bc1} vs {bc2}")
    ok("E2E-D1 两客户端均收到 workspace:changed 全量快照(含 gamma)")
    ok("E2E-D2 两端快照一致")
    host2.stop()


def main():
    scenario_a_smoke()
    scenario_bcd()
    print(f"\nOK — {len(PASSED)} e2e assertions passed")


if __name__ == "__main__":
    main()
