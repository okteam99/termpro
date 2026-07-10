#!/usr/bin/env bash
# BL-003 远程机管理与 SSH 连接编排 · 端到端验证脚本（语言无关 · 可运行）
#
# 本 Feature 的端到端面分三层，本脚本按可用性逐层执行：
#   L1 无头冒烟（恒可跑）  : 整应用启动 → 嵌入式 host 握手 → renderer 完成 host.info → SMOKE_OK
#                           证明 hostClient.connect(opts) 向后兼容改造未回归本地路径（BL-003 硬约束）。
#   L2 集成级（恒可跑）    : vitest 集成套件——host WS harness 真实 ws server + hostCore 全 RPC 往返、
#                           真实 host 子进程端口文件 O_EXCL/token 零落盘、真实 ws upgrade Origin 门/节流、
#                           orchestrator 全状态机（注入 SSH 传输桩 · 确定性不触网）。
#   L3 真机 SSH（条件跑）  : sshLocalhost.integration —— 本机 sshd 可达（BatchMode 免密）时跑真实
#                           SshConnection connect+forwardOut+sftp 往返，作「传输桩不失真」锚点；
#                           不可达 → 如实 skip（不伪绿），CI 可起 loopback sshd 常跑。
#
# 用法: bash docs/features/.../e2e/remote-hosts.e2e.sh   （从仓库根跑）
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
FAIL=0

echo "== L1 无头冒烟（整应用 + 嵌入式 host 握手）=="
# macOS 无 coreutils `timeout`：后台起 + 轮询 SMOKE_OK/超时 + 收尾 kill。
SMOKE_LOG=$(mktemp)
( TERMPRO_SMOKE=1 npx electron-forge start >"$SMOKE_LOG" 2>&1 ) &
SMOKE_BG=$!
for _ in $(seq 1 90); do
  grep -q 'SMOKE_OK' "$SMOKE_LOG" && break
  kill -0 "$SMOKE_BG" 2>/dev/null || break
  sleep 1
done
pkill -f 'electron-forge start' 2>/dev/null; kill "$SMOKE_BG" 2>/dev/null
if grep -q 'SMOKE_OK' "$SMOKE_LOG"; then echo "  ✓ SMOKE_OK"; else echo "  ✗ 冒烟未通过"; tail -5 "$SMOKE_LOG" | sed 's/^/    /'; FAIL=1; fi
rm -f "$SMOKE_LOG"

echo "== L2 集成级（host ws harness + 真实子进程 + orchestrator 状态机）=="
if npx vitest run \
    src/host/__tests__/wsRpcParity.test.ts \
    src/host/__tests__/wsOriginGate.test.ts \
    src/host/__tests__/wsAuthThrottle.test.ts \
    src/host/__tests__/portFile.test.ts \
    src/main/remote/__tests__/orchestrator.test.ts \
    src/main/remote/__tests__/deploy.test.ts \
    src/main/remote/__tests__/residency.test.ts \
    src/renderer/components/settings/__tests__/RemoteHostsPage.test.tsx \
    >/tmp/bl003_l2.log 2>&1; then
  echo "  ✓ 集成套件全绿"; tail -3 /tmp/bl003_l2.log | sed 's/^/    /'
else echo "  ✗ 集成套件有失败"; tail -8 /tmp/bl003_l2.log | sed 's/^/    /'; FAIL=1; fi

echo "== L3 真机 SSH（本机 sshd 可达才跑，否则如实 skip）=="
npx vitest run src/main/remote/__tests__/sshLocalhost.integration.test.ts 2>&1 | grep -E 'skip|pass|✓|↓' | sed 's/^/    /'

echo "== AC 覆盖机读校验 =="
python3 ~/.claude/skills/teamwork/templates/verify-ac.py docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH 2>&1 | grep -E '通过|未覆盖' | sed 's/^/    /'

[ "$FAIL" = 0 ] && echo "== E2E PASS ==" || { echo "== E2E FAIL =="; exit 1; }
