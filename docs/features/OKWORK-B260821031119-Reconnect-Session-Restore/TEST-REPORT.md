---
feature_id: "OKWORK-B260821031119-Reconnect-Session-Restore"
author: QA
status: confirmed
prd_ref: N/A (Bug flow; no PRD)
tc_ref: N/A (Bug flow; no TC)
test_run_at: "2026-08-21T08:20:36Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: not_applicable
revision_history:
  - version: v0.1
    date: "2026-08-21"
    author: QA
    summary: Bug 回归测试报告：L2 竞态回归、邻近重连集合与 Python→Vitest 驱动均通过
---

# 重连会话恢复过期失败提示 - Test Report

> 本报告是 Bug flow 的 Test stage 产物。规格依据为
> `bugfix/BUG-OKWORK-B260821031119-001.md`，不是 PRD/TC。

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 责任人 |
|---|---|---|---|
| integration / L2 regression | renderer `readoptHostSessions` 串行队列、generation 闸门、失败提示 hooks，以及相邻 Host/Sidebar 重连契约 | `src/renderer/services/__tests__/sessionReadopt.test.ts`、`sessionReadoptNotice.test.ts`、`SidebarReconnect.test.tsx`、`hostClientDeadSocketRpc.test.ts`、`src/host/__tests__/reconnectContinuity.integration.test.ts` | QA |
| API-E2E | N/A：本 Electron renderer 生命周期 Bug 没有 HTTP/DB API 或 live gateway | N/A | QA |
| 可执行关键路径驱动 | Python 从任意 cwd 定位 repo root，启动真实 Vitest 子进程验证核心竞态；这是跨 Python→Vitest 的回归驱动，不冒名为 live app/API-E2E | `e2e/reconnect_session_restore_regression.py` | QA |

## §2 integration / 邻近回归结果

### 2.1 执行命令

```bash
npx vitest run src/renderer/services/__tests__/sessionReadopt.test.ts \
  src/renderer/services/__tests__/sessionReadoptNotice.test.ts \
  src/renderer/components/__tests__/SidebarReconnect.test.tsx \
  src/renderer/services/__tests__/hostClientDeadSocketRpc.test.ts \
  src/host/__tests__/reconnectContinuity.integration.test.ts
```

### 2.2 stdout 摘录

```text
✓ src/renderer/services/__tests__/hostClientDeadSocketRpc.test.ts (5 tests)
✓ src/renderer/services/__tests__/sessionReadoptNotice.test.ts (6 tests)
✓ src/renderer/services/__tests__/sessionReadopt.test.ts (17 tests)
✓ src/renderer/components/__tests__/SidebarReconnect.test.tsx (6 tests)
✓ src/host/__tests__/reconnectContinuity.integration.test.ts (14 tests)
Test Files  5 passed (5)
Tests       48 passed (48)
```

### 2.3 exit-code

`exit-code = 0`

补充：jsdom 输出 `HTMLCanvasElement.getContext()` 未安装 canvas 的提示；Host session-cap 用例输出预期的拒绝日志，均未导致测试失败。

## §3 API-E2E 与可执行关键路径驱动

### 3.1 API-E2E 分类

`API-E2E = N/A`。本 Bug 不涉及 HTTP endpoint、数据库、Redis 或独立 gateway；把下面的 Python 驱动称为 API-E2E 会夸大证据边界。

### 3.2 执行命令

从 `/tmp`（非 repo cwd）执行，验证脚本自行定位 repo root：

```bash
/Users/liam/apps/okok/TermPro/.worktree/OKWORK-B260821031119-Reconnect-Session-Restore/docs/features/OKWORK-B260821031119-Reconnect-Session-Restore/e2e/reconnect_session_restore_regression.py
```

脚本内部真实启动：

```bash
npx vitest run src/renderer/services/__tests__/sessionReadoptNotice.test.ts \
  --testNamePattern '新一轮已排队并成功' --reporter=dot
```

### 3.3 stdout 摘录

```text
 RUN  v3.2.6 /Users/liam/apps/okok/TermPro/.worktree/OKWORK-B260821031119-Reconnect-Session-Restore
·-----
 Test Files  1 passed (1)
 Tests       1 passed | 5 skipped (6)
{"scenario":"stale_readopt_failure_suppressed_after_queued_success","command":"npx vitest run src/renderer/services/__tests__/sessionReadoptNotice.test.ts --testNamePattern '新一轮已排队并成功' --reporter=dot","exit_code":0,"verdict":"PASS"}
```

### 3.4 exit-code

脚本真实 `exit-code = 0`，并原样透传 Vitest exit code。脚本无交互、可从任意 cwd 执行、重复执行幂等。

## §4 AC 覆盖度

本 Feature 是 Bug flow，无 PRD/TC/AC；按 Test stage Bug carve-out，AC↔Test 机器校验为 `N/A`，不运行 `verify-ac.py`。

### 4.1 Bug 回归矩阵

| 回归目标 | 测试 | 层级 | 状态 |
|---|---|---|---|
| 同一 Host 旧 readopt 在最终失败窗口，新 readopt 已排队并成功；旧代次不得写终端提示 | `收养失败提示去重 > 新一轮已排队并成功 → 旧一轮最终失败不写过期提示` | L2 regression + Python→Vitest driver | ✅ |
| 最新代次真实最终失败仍提示 | `收养失败提示去重 > 反复闪断 → 同一 tab 只写一条提示`（单轮最终失败提示能力） | L2 regression | ✅ |
| 成功对账清除提示记忆，后续真实失败可再次提示 | `收养成功清位 → 此后再失败会再说一次` | L2 regression | ✅ |
| 旧 Host 会话协议、Sidebar 握手、dead-socket RPC 不回归 | 邻近 5 files / 48 tests | integration / host continuity | ✅ |

覆盖率：N/A（Bug 无 AC），回归目标 4/4 通过。

## §5 回归测试

| 测试集 | 范围 | 结果 |
|---|---|---|
| L2 focused | `sessionReadoptNotice.test.ts`，6 tests | ✅ 6 passed |
| critical-path driver | Python→Vitest，目标竞态 1 test（其余 5 skipped by pattern） | ✅ exit 0 / JSON PASS |
| 邻近重连集合 | 5 files / 48 tests，含真实 PTY/WS continuity 14 tests | ✅ 48 passed |
| 全量 Vitest（dev 门禁记录） | 214 files / 2161 tests | ✅ 210 passed、4 skipped；2128 passed、33 skipped |
| typecheck（dev 门禁记录） | `npm run typecheck` | ✅ exit 0 |
| touched lint（最终 HEAD） | `sessionReadopt.ts` + `sessionReadoptNotice.test.ts` | ✅ exit 0 |
| Electron smoke（dev 门禁记录） | `OKWORK_SMOKE=1 npx electron-forge start` | ✅ `SMOKE_OK` / exit 0 |

## §6 fix-retry 历史

无 fix-retry。dev 阶段先以旧生产实现得到预期红灯（1 failed / 5 passed），generation 修复后 focused 6/6、邻近 48/48 通过；Test stage 本轮直接复验绿灯。

## §7 已知问题（不阻塞 · audit 留痕）

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| LINT-BASELINE | 全仓 `npm run lint` 曾报告 144 errors / 430 warnings；问题分布于既有测试、Host、renderer 与配置文件。最终 touched lint 为 0 error / 0 warning。 | 既有 baseline | 不阻塞本 Bug；本轮不重复全仓 lint | 既有 dev concern |
| E2E-CLASSIFICATION | Python 驱动只跨 Python→Vitest 子进程，不启动 live Electron app，也不访问 HTTP/DB。 | 说明性 | 明确归为可执行关键路径回归驱动，不计 API-E2E | 本报告 §3 |

## §8 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-08-21 | QA / Test stage | ✅ pass | focused、邻近回归、Python 驱动均 exit 0；AC coverage N/A（Bug flow） |
| 2026-08-21 | Review fast | ✅ APPROVE | generation 闸门与真实生产入口测试通过静态审查 |
