#!/usr/bin/env bash
# e2e 本地质量门禁(语言无关入口 · 在 worktree 根运行)
# TERMPRO-F260613152432-Terminal-File-Link-Open
# 端到端验证:类型 + 全量单测(含 FsLinkProvider 端到端路由) + 无头冒烟(应用真启动)
# 用法:bash docs/features/TERMPRO-F260613152432-Terminal-File-Link-Open/e2e/local_quality_gate.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2

fail=0

echo "== [1/3] typecheck (tsc --noEmit) =="
npm run typecheck || fail=1

echo "== [2/3] integration (vitest run · 全量) =="
npx vitest run || fail=1

echo "== [3/3] e2e smoke (TERMPRO_SMOKE=1 electron-forge start → SMOKE_OK) =="
SMOKE_OUT=$(TERMPRO_SMOKE=1 npx electron-forge start 2>&1)
if echo "$SMOKE_OUT" | grep -aq "SMOKE_OK"; then
  echo "SMOKE_OK"
else
  echo "SMOKE_FAIL"; echo "$SMOKE_OUT" | tail -15; fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "== GATE: PASS =="
else
  echo "== GATE: FAIL =="
fi
exit "$fail"
