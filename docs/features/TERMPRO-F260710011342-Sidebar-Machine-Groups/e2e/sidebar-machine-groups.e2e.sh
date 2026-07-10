#!/usr/bin/env bash
# BL-004 机器分组 Sidebar + 添加项目流程 · 端到端验证（语言无关 · 可运行）
#
# 本 Feature 纯 renderer UI + 数据模型迁移，端到端面分三层：
#   L1 无头冒烟（恒可跑）: 整应用启动 → 嵌入式 host 握手 → renderer 加载(含机器分组 Sidebar) → SMOKE_OK
#                         证明 hostClient→hostRegistry 53 消费点迁移未回归本机路径(AC-6 硬约束)。
#   L2 组件+数据模型（恒可跑）: renderer 全套(422)——Sidebar 机器分组/AddWorkspaceModal 远程目录浏览器/
#                         作用域隔离(本机加项目不清远程组)/复合键路由/D-7 远程文件禁用/import 集门禁。
#   L3 真机远程（条件跑）: 远程 workspace 全链路走该机 host——沙箱无 sshd → 承接 BL-003 concern·发版前 spike。
#
# 用法: bash docs/features/.../e2e/sidebar-machine-groups.e2e.sh   （仓库根跑）
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
FAIL=0

echo "== L1 无头冒烟（整应用 + 机器分组 Sidebar 加载）=="
SMOKE_LOG=$(mktemp)
( TERMPRO_SMOKE=1 npx electron-forge start >"$SMOKE_LOG" 2>&1 & )
for _ in $(seq 1 90); do grep -q 'SMOKE_OK\|node-gyp failed\|Error:' "$SMOKE_LOG" && break; sleep 1; done
pkill -f 'electron-forge start' 2>/dev/null
if grep -q 'SMOKE_OK' "$SMOKE_LOG"; then echo "  ✓ SMOKE_OK"; else echo "  ✗ 冒烟未通过"; tail -5 "$SMOKE_LOG" | sed 's/^/    /'; FAIL=1; fi
rm -f "$SMOKE_LOG"

echo "== L2 组件 + 数据模型（renderer 全套）=="
if npx vitest run src/renderer >/tmp/bl004_l2.log 2>&1; then
  echo "  ✓ renderer 全套绿"; tail -3 /tmp/bl004_l2.log | sed 's/^/    /'
else echo "  ✗ 有失败"; tail -8 /tmp/bl004_l2.log | sed 's/^/    /'; FAIL=1; fi

echo "== import 集门禁（AC-5 迁移完整性·perl -0777 权威正则）=="
if npx vitest run src/renderer/state/__tests__/hostClientImportGate.test.ts >/tmp/bl004_gate.log 2>&1; then
  echo "  ✓ 无残留裸 hostClient 单例 importer"
else echo "  ✗ 门禁红"; tail -5 /tmp/bl004_gate.log | sed 's/^/    /'; FAIL=1; fi

echo "== L3 真机远程（沙箱无 sshd → 承接 BL-003 发版前 spike）=="
echo "    远程 workspace 全链路(终端/fs/git 走该机 host) + 添加项目落远程注册表 · 需真机远程环境验证"

echo "== AC 覆盖机读校验 =="
python3 ~/.claude/skills/teamwork/templates/verify-ac.py docs/features/TERMPRO-F260710011342-Sidebar-Machine-Groups 2>&1 | grep -E '通过|未覆盖' | sed 's/^/    /'

[ "$FAIL" = 0 ] && echo "== E2E PASS ==" || { echo "== E2E FAIL =="; exit 1; }
