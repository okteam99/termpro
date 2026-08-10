---
feature_id: "OKWORK-F260810151932-Browser-Profile-Login-Continuity"
author: QA
status: confirmed
prd_ref: PRD.md (v0.3)
tc_ref: TC.md (confirmed)
test_run_at: "2026-08-10T19:11:52Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: pass
revision_history:
  - version: v0.1
    date: "2026-08-11"
    author: QA
    summary: "真实 Host RPC API-E2E 与全量门禁首轮记录；package/Vitest 未绿，故不确认。"
  - version: v0.2
    date: "2026-08-11"
    author: QA
    summary: "完整依赖冻结树复验：全量 Vitest 重跑绿、package 绿、API-E2E 两轮绿，确认报告。"
---

# Browser Profile 3A 登录连续性漫游 - Test Report

> 位置：`docs/features/OKWORK-F260810151932-Browser-Profile-Login-Continuity/TEST-REPORT.md`
>
> 本报告仅记录实际命令结果。Cookie identity/value、capability 和原始敏感 RPC response 均不进入脚本 stdout、报告或本报告的摘要；Host RPC stderr 也由 API-E2E 逐步检查。

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 责任人 |
|---|---|---|---|
| integration(进程内集成) | 单进程全量 Vitest：shared、Host、main、preload、renderer 回归 | `npm test` | QA |
| api-e2e(live 跨进程) | 真实 Node Host bundle、每个 RPC 独立子进程、真实 stdin/stdout 与临时远端 data dir | `e2e/profile_continuity_rpc_e2e.py` | QA |

`integration` 指单进程全量 Vitest；`api-e2e` 指多次真实 `node .vite/build/host.js --profile-store-rpc` 子进程，不冒充 browser-e2e。

## §2 integration 结果

### 2.1 执行命令

```bash
npm test
```

### 2.2 stdout 摘录(关键段 · 已脱敏)

```text
✓ src/main/__tests__/browserGuestNavigationGuard.test.ts (10 tests) 338ms
Test Files  195 passed | 1 skipped (196)
Tests  1945 passed | 6 skipped (1951)
```

F1 navigation guard 回归证据：`browserGuestNavigationGuard.test.ts` 两轮均为 10 tests 通过。冻结树首轮出现两条已登记的 `fs.watch` 时序 flake（`wsMultiClientIsolation` T-042、`wsRpcParity` T-032），按项目差分基线规则完整重跑一次；第二轮全量为绿，没有新增失败。Feature worktree 预验证时的 `portFile`/package `node-pty` 缺失由隔离树的完整依赖消除，不登记成测试基线。

### 2.3 exit-code

`Round 1 exit-code = 1`（仅两条已登记 WS 时序 flake）；`Round 2 exit-code = 0`（195 passed / 1 skipped suites，1945 passed / 6 skipped cases）。

## §3 api-e2e 结果

### 3.1 前置环境

| 项 | 内容 | 获取方式 |
|---|---|---|
| Host | `.vite/build/host.js` 的 `--profile-store-rpc` 一请求进程 | `npm run package` prePackage 的 Vite Host build；脚本可由 `OKWORK_HOST_BUNDLE` 覆盖 bundle 路径 |
| 远端数据 | 每轮脚本自己创建的 `TemporaryDirectory` | `OKWORK_HOST_DATA_DIR` 指向该目录，并在 finally/上下文退出时仅清理该目录 |
| 传输 | 每个 RPC 的真实 stdin/stdout | `subprocess.run(["node", bundle, "--profile-store-rpc"])` |

### 3.2 执行命令

```bash
python3 docs/features/OKWORK-F260810151932-Browser-Profile-Login-Continuity/e2e/profile_continuity_rpc_e2e.py
```

### 3.3 stdout 摘录

```text
PASS: capability describes continuity v1
PASS: grant authorizes profile save
PASS: persistent Cookie push is idempotent
PASS: fresh Host process restores continuity record
PASS: wrong capability is fixed forbidden without stderr leak
PASS: continuity file is encrypted with private permissions
PASS: moved profile rejects stale pushes from fresh processes
```

两轮均验证：`describe` capability、grant + `profile.save`、持久 Cookie `continuity.push`、同 operationId 幂等、不同 Host 进程 `continuity.pull` 恢复、错误 capability 的固定 `PROFILE_RPC_FORBIDDEN`、Host 密文与 `0700/0600` 权限，以及 `profile.retire` moved 后旧 capability 在两次新进程 stale push 均为固定 `PROFILE_MOVED`。脚本只输出上述固定脱敏摘要。

### 3.4 exit-code

`首次 exit-code = 0`；`第二次完整可重跑 exit-code = 0`。

## §4 AC 覆盖度(verify-ac.py 结果)

```bash
python3 /Users/liam/apps/okok/teamwork/skills/teamwork/templates/verify-ac.py \
  docs/features/OKWORK-F260810151932-Browser-Profile-Login-Continuity
```

### 4.1 verify-ac.py 输出

```text
📋 AC↔test 覆盖校验：docs/features/OKWORK-F260810151932-Browser-Profile-Login-Continuity
├── PRD AC 数：10
├── TC test 数：17
✅ AC 覆盖校验通过（10 条 AC 均有测试覆盖）
```

### 4.2 AC↔Test 矩阵

| AC ID | 描述 | 覆盖 TC | 层级 | 状态 |
|---|---|---|---|---|
| AC-1 | 发现、加入与 hydration gate | T-001, T-002 | integration | ✅ |
| AC-2 | 持久 Cookie 对账、session 跳过 | T-003, T-004 | unit + integration | ✅ |
| AC-3 | revision 与幂等 | T-005 | integration + api-e2e | ✅ |
| AC-4 | tombstone 防复活 | T-006 | integration | ✅ |
| AC-5 | v1 兼容、能力与分页 | T-007, T-008 | integration + api-e2e | ✅ |
| AC-6 | 离线 journal/generation | T-009, T-010 | integration | ✅ |
| AC-7 | Cookie 秘密与私有加密存储 | T-011, T-012 | integration + api-e2e | ✅ |
| AC-8 | 单项跳过与脱敏统计 | T-013 | integration | ✅ |
| AC-9 | Settings/OkBrowser 脱敏反馈 | T-014, T-015 | fe-e2e | ✅ |
| AC-10 | 删除/迁移 epoch fence | T-016, T-017 | integration + api-e2e | ✅ |

覆盖率：10 / 10 (100%)。

## §5 回归测试

| 测试集 | 范围 | 结果 |
|---|---|---|
| package | Electron Forge package（含 Host bundle 构建） | ✅ exit 0：native dependencies 1/1，成品含 `pty.node` + `spawn-helper` |
| 全量 integration | `npm test` 单进程 Vitest | ✅ Round 2 exit 0：195 passed / 1 skipped suites；1945 passed / 6 skipped cases |
| critical-path 回归 | `browserGuestNavigationGuard.test.ts` | ✅ 10 passed |
| typecheck | `npm run typecheck` | ✅ exit 0 |
| API-E2E | 两轮真实多进程 Host RPC | ✅ exit 0 / exit 0 |
| Python 编译 | `python3 -m py_compile`（pycache 定向 `/tmp`） | ✅ exit 0 |
| diff | `git diff --check` | ✅ exit 0 |

## §6 fix-retry 历史(若 round > 1)

> 产品代码未进入 test-fix。冻结树 Round 1 只出现项目已登记的 WS/fs.watch 时序 flake，因此按基线规则完整重跑一次；Round 2 全绿。

| Round | test_commit | integration_exit | e2e_exit | fix_commit | addresses_findings | 备注 |
|---|---|---:|---:|---|---|---|
| 1 | `62d97bd` | 1 | 0 | - | - | T-042/T-032 已登记时序 flake；触发一次完整重跑 |
| 2 | `62d97bd` | 0 | 0 | - | - | 195 suites passed，package/API-E2E/AC 全绿 |

## §7 已知问题(不阻塞 · audit 留痕)

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| - | 无 Feature 阻塞问题；首轮 WS 时序 flake 已按项目基线完整重跑并自愈。 | - | - | `frozen-62d97bd.log` |

## §8 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-08-11 | QA | ✅ confirmed | 完整依赖冻结树：integration/package/API-E2E/AC 全绿。 |

## §9 原始执行日志

所有路径均为完整 stdout/stderr 与追加的 exit-code 记录；本报告只摘取了脱敏行。预验证日志保留环境差异，最终确认以冻结树日志为权威。

| 项 | exit | 日志 |
|---|---:|---|
| package | 1 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/01-package.log` |
| API-E2E 首次 | 0 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/02-api-e2e-first.log` |
| npm test round 1 | 1 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/03-npm-test-round-1.log` |
| typecheck | 0 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/04-typecheck.log` |
| verify-ac help | 0 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/05-verify-ac-help.log` |
| verify-ac | 0 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/06-verify-ac.log` |
| py_compile | 0 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/07-py-compile.log` |
| API-E2E 第二次 | 0 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/08-api-e2e-second.log` |
| diff-check | 0 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/09-diff-check.log` |
| 最终冻结预确认（全量两轮/package/API-E2E 两轮/AC） | 0 | `/tmp/teamwork/OKWORK-F260810151932-Browser-Profile-Login-Continuity/frozen-62d97bd.log` |
