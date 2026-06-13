---
feature_id: TERMPRO-F260613152432-Terminal-File-Link-Open
integration_exit_code: 0
e2e_exit_code: 0
ac_total: 5
ac_passed: 5
target_commit: 792b28d
generated_at: "2026-06-14T00:04:30Z"
---

# TEST-REPORT(TERMPRO-F260613152432-Terminal-File-Link-Open)

## §1 概要

| 项目 | 结果 |
|------|------|
| 集成测试(vitest 全量) | ✅ 15 files · 143 tests passed · exit 0 |
| E2E(e2e/local_quality_gate.sh) | ✅ GATE PASS · exit 0(typecheck + vitest + SMOKE_OK) |
| typecheck(tsc --noEmit) | ✅ exit 0 |
| 无头冒烟(TERMPRO_SMOKE=1) | ✅ SMOKE_OK(应用真启动) |
| AC 覆盖(verify-ac.py) | ✅ 5/5 |

## §2 AC 覆盖矩阵

| AC | 描述 | 覆盖测试 | 结果 |
|----|------|----------|------|
| AC-1 | 目录链接维持 File-Panel 定位优先 | T-004, T-005 | ✅ |
| AC-2 | 文件按 SYSTEM_OPEN_EXT 直开(openPath / openViewerWindow) | T-001, T-002 | ✅ |
| AC-3 | 根内文件直接打开不再 location-only(旧测试已迁移) | T-003 | ✅ |
| AC-4 | :line:col 文件用 stripped 路径打开(端到端 FsLinkProvider) | T-006 | ✅ |
| AC-5 | http/https web 链接仍走系统浏览器 | T-007 | ✅ |

## §3 测试执行

- **集成**:`npx vitest run` → 143 passed(含 `terminalLinkFilePanelRouting.test.ts` 6 + `terminalWebLinks.test.ts` 1 = 本 feature 7 条核心)。exit 0。
- **E2E**:`bash docs/features/TERMPRO-F260613152432-Terminal-File-Link-Open/e2e/local_quality_gate.sh` → 三段(typecheck / vitest / 无头冒烟)全绿,GATE PASS,exit 0。冒烟验证 Electron 应用在改动后仍能真实启动(main/preload/host build + 渲染),路由改动未破坏启动路径。
- T-006 为真端到端:经 `FsLinkProvider.provideLinks → activate`(stub `hostClient.rpc('fs.stat')`),验证 `:line:col` 链接以 stripped 路径调用 `openViewerWindow`。

## §4 边界/回归

- 旧「根内媒体 location-only」断言已移除(`git grep "keeps repository"` 零命中),由 T-003 反向断言「直接系统打开」替换。
- web 链接路径(`SystemWebLinkProvider`)不在改动 diff 内,T-007 独立守护未回归。
- 目录定位内核(locateRegistry / controller / core)未触,11 条 locateTarget 测试 + 47 条 core 测试照常全绿。

## §5 结论

集成 exit 0 · e2e exit 0 · AC 5/5 覆盖。建议进 pm_acceptance(真机点击核对:终端点文件→打开 / 点目录→定位,归用户视角验收)。

📎 worktree 限定环境处理:worktree 默认无 `node_modules`,本次为跑冒烟在 worktree 软链 `node_modules/electron → 主仓 electron`(worktree-local · gitignored · ship 删 worktree 时一并清除)。不影响交付代码。
