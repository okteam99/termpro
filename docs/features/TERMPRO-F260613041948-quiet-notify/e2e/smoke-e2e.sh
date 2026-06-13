#!/usr/bin/env bash
# E2E:无头冒烟 —— 端到端启动 Electron 壳 + Host 进程(独立 utilityProcess)+ 首个 PTY
# 握手,验证构建产物可启动、Host RPC/PTY 链路通。打印 SMOKE_OK 即通过(exit 0)。
#
# 为什么用冒烟当 e2e:本 feature(quiet 通知 gating)是渲染层逻辑,无 HTTP API → api-e2e
# 不适用(TC.md 已标);其行为依赖真实 ≥60s 静默 + 系统通知 + 多 tab/窗口,完整行为级
# e2e 不实际。行为正确性由 quietGate 11 单测(AC-1..AC-5)+ 三视角 code review 覆盖;
# 本脚本作为端到端门:确认改动未破坏 app 启动与 Host/PTY 实链路(真跨进程)。
set -uo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"

# electron-forge 需在本目录解析到 electron。worktree 常无独立 node_modules(依赖在主工作区,
# node 向上查找够用,但 forge 只在本目录找 electron),且 npm/工具可能留下不含 electron 的
# stub —— 故按「electron 是否可解析」判定,必要时用指向主工作区依赖的符号链接顶替。
CREATED_LINK=0
if [ ! -d node_modules/electron ]; then
  MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
  if [ -n "${MAIN:-}" ] && [ -d "$MAIN/node_modules/electron" ]; then
    [ -L node_modules ] && rm -f node_modules            # 旧符号链接
    [ -d node_modules ] && rm -rf node_modules           # 不完整 stub(无 electron)
    ln -s "$MAIN/node_modules" node_modules && CREATED_LINK=1
  fi
fi
trap '[ "$CREATED_LINK" = 1 ] && [ -L node_modules ] && rm -f node_modules' EXIT

LOG="$(mktemp)"
TERMPRO_SMOKE=1 npx electron-forge start > "$LOG" 2>&1 || true

if grep -q "SMOKE_OK" "$LOG"; then
  echo "E2E PASS: SMOKE_OK — app + Host(独立进程)+ PTY 端到端启动握手成功"
  exit 0
fi
echo "E2E FAIL: 未出现 SMOKE_OK"
tail -25 "$LOG"
exit 1
