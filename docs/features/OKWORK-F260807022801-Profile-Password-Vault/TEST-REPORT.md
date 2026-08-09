---
feature_id: "OKWORK-F260807022801-Profile-Password-Vault"
author: QA
status: confirmed
prd_ref: PRD.md (v1.0)
tc_ref: TC.md (confirmed)
test_run_at: "2026-08-09T18:40:48Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: pass
revision_history:
  - version: v1.0
    date: "2026-08-10"
    author: QA
    summary: 全量集成、类型检查与真实 Electron 跨进程旅程通过
---

# BL-006 Profile 密码库与静默保存/填充 - Test Report

> 位置：`docs/features/OKWORK-F260807022801-Profile-Password-Vault/TEST-REPORT.md`
> 本报告记录真实命令、stdout 摘录与 exit code；机器权威证据位于 `state.json.stage_contracts.test`。

---

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 责任人 |
|---|---|---|---|
| integration | Vault 加密持久化、Profile/origin 隔离、登录结果判定、IPC 权限、删除状态机、剪贴板租约及 UI 状态 | `src/**/__tests__/*`，全量 `vitest run` | QA |
| live e2e | fresh Forge package → 独立 Electron 进程 → Playwright 操作真实 OkBrowser 登录、保存、回填、管理、可信显隐/复制 | `e2e/password-vault.e2e.cjs`；Python 入口 `e2e/password_vault_e2e.py` | QA |
| browser-e2e | 同一真实 UI 旅程及截图证据 | 后续 `browser_e2e` stage | QA + Designer |

本产品是 Electron 桌面应用，BL-006 不提供 HTTP API 服务。因此这里的 live e2e 不虚构 API：Python 入口直接驱动 canonical Node runner，后者 fresh package 后启动独立 Electron 进程并通过 Playwright 跨进程验证真实 UI 与主进程边界；子进程 exit code 原样透传。

---

## §2 integration 结果

### 2.1 执行命令

```bash
npm test
npm run typecheck
```

### 2.2 stdout 摘录

```text
Test Files  174 passed | 9 skipped (183)
Tests       1741 passed | 87 skipped (1828)
Duration    13.73s

> termpro@1.0.0 typecheck
> tsc --noEmit
```

全量套件中的既有 skip 保持原状；BL-006 的 T-001 至 T-012 没有用 skip 或 xfail 取得通过。

### 2.3 exit-code

| 命令 | exit-code | 结果 |
|---|---:|---|
| `npm test` | 0 | 通过 |
| `npm run typecheck` | 0 | 通过 |

---

## §3 live e2e 结果

### 3.1 前置环境

| 项 | 内容 | 获取方式 |
|---|---|---|
| 应用 | 当前 worktree 的 fresh macOS arm64 Electron package | runner 内执行 `npm run package` |
| 测试站点 | 临时 `127.0.0.1` loopback 标准登录页 | runner 启动临时 HTTP fixture |
| 应用数据 | 独立临时 `userData` | runner 使用 `mkdtemp`，结束后只清理自身目录 |
| 测试账号 | `alice` 与进程内唯一密码哨兵 | runner 自动创建，不依赖外部账号 |

### 3.2 执行命令

```bash
python3 docs/features/OKWORK-F260807022801-Profile-Password-Vault/e2e/password_vault_e2e.py
```

### 3.3 stdout 摘录

```text
BUILD npm run package
Packaging for arm64 on darwin
T-012 CONTRACT: PASS (compiled boundary assertions)
PASS AC-1 saves only after observable success and reports non-secret chrome status
PASS AC-3 silently fills a saved single account on the same loopback exact origin
PASS AC-6 real user click reveals plaintext only in the isolated trusted window
PASS AC-6 real trusted-window click exports the password to the system clipboard
PASS AC-6 trusted reveal automatically returns to the masked state
PASS E2E restores the pre-existing system clipboard text
T-012 ELECTRON JOURNEYS: PASS
```

耗时约 49.4 秒；默认 fresh build，没有使用 `--skip-build` 从外部绕过构建，也没有跳过 Playwright Electron journey。

### 3.4 exit-code

`exit-code = 0`（通过）

---

## §4 AC 覆盖度

### 4.1 verify-ac.py

```bash
python3 /Users/liam/apps/okok/teamwork/skills/teamwork/templates/verify-ac.py \
  docs/features/OKWORK-F260807022801-Profile-Password-Vault
```

```text
PRD AC 数：9
TC test 数：12
AC-1 至 AC-9：全部至少被 1 个 test 覆盖
AC 覆盖校验通过（9 条 AC 均有测试覆盖）
```

### 4.2 AC↔Test 矩阵

| AC ID | 描述 | 覆盖 TC | 层级 | 状态 |
|---|---|---|---|---|
| AC-1 | 可观察成功后才自动保存 | T-001, T-012 | integration + live e2e | ✅ |
| AC-2 | Profile、exact origin 与安全 origin 隔离 | T-002 | integration | ✅ |
| AC-3 | 确定性静默填充且不覆盖非空字段 | T-003, T-012 | integration + live e2e | ✅ |
| AC-4 | 仅成功时更新同一账号 | T-004 | integration | ✅ |
| AC-5 | 加密持久化与 fail-closed | T-005 | integration | ✅ |
| AC-6 | 脱敏管理、可信显隐/复制及条件清理 | T-006, T-007, T-012 | unit + integration + live e2e | ✅ |
| AC-7 | 单账号/Profile 删除、失败与重试 | T-008, T-009 | integration | ✅ |
| AC-8 | 不可信调用方隔离与暴露面披露 | T-010, T-012 | integration + live e2e | ✅ |
| AC-9 | 日志、错误和事件不泄密 | T-011 | integration | ✅ |

覆盖率：9 / 9（100%）

---

## §5 回归测试

| 测试集 | 范围 | 结果 |
|---|---|---|
| 全量 Vitest | 全仓 183 个测试文件、1828 个测试 | ✅ 174 files passed / 9 skipped；1741 passed / 87 skipped |
| TypeScript | 全仓 `tsc --noEmit` | ✅ exit 0 |
| 编译边界契约 | fresh compiled main/preload/renderer 产物与权限分层 | ✅ `T-012 CONTRACT: PASS` |
| Electron critical path | 登录成功保存、重访填充、非空保护、metadata-only、三处风险披露、可信显隐/复制、10 秒重新遮罩、剪贴板恢复 | ✅ `T-012 ELECTRON JOURNEYS: PASS` |

---

## §6 Test-stage 修正记录

| Round | test_commit | integration_exit | e2e_exit | 修正 | 备注 |
|---|---|---:|---:|---|---|
| preflight | `53db5ab` 前 | 0 | 1 | 新增 Python 入口并映射到根目录 canonical Node runner | 初次人工验证把 `.cjs` 误写到 Feature 目录，得到 `MODULE_NOT_FOUND`；产品断言未启动 |
| 1 | `53db5ab` | 2 | 0（传入值） | 最终门禁改用绝对 Python 入口 | Teamwork 从 Feature 目录启动 test command，相对路径被重复拼接；全量 Vitest/typecheck 通过，但 E2E 未启动。工具表面 verdict 为 PASS，但真实合并 exit code 2，故本报告按失败处理并进入 fix/retry |
| 2 | 见 `state.json.stage_contracts.test.rounds` | 0 | 0 | - | 使用绝对入口重跑全量 Vitest、typecheck、fresh package 与 Electron journey |

Round 1 的 `e2e_exit=0` 是命令行预先传入的字段，不代表 E2E 实际运行；真实合并 exit code 与 `test-stdout.log` 明确显示 Python 启动失败。本轮没有篡改产品代码，也没有把工具的矛盾 verdict 当成通过证据。

---

## §7 已知问题

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| - | 无阻塞问题 | - | - | - |

---

## §8 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-08-10 | QA validation tier (`gpt-5.6-terra`) | ✅ pass | 全量 integration、typecheck、fresh Electron e2e 与 AC 覆盖均通过 |
