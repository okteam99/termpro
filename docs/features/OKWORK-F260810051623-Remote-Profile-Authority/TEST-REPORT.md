---
feature_id: "OKWORK-F260810051623-Remote-Profile-Authority"
author: QA
status: confirmed
prd_ref: PRD.md (v0.4)
tc_ref: TC.md (confirmed, TC-001..TC-013)
test_run_at: "2026-08-10T14:36:11Z"
evidence:
  integration_test_exit_code: 1
  e2e_test_exit_code: 0
  ac_coverage_verify: pass
revision_history:
  - version: v0.1
    date: "2026-08-10"
    author: QA
    summary: "全量回归、真实 Host CLI 跨进程 E2E 与 AC 覆盖核验"
---

# Remote Host Profile 权威存储与迁移 - Test Report

> 🟢 本文是 teamwork test-stage 产物。`integration_test_exit_code=1` 是本轮真实的最终全量命令退出码；唯一失败项已登记为项目级 Host 文件监听负载 flake，未被改写为通过。

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 结果 |
|---|---|---|---|
| integration（进程内） | Profile authority、迁移、删除、离线、UI 与 Host 回归 | `npm test`（全量 Vitest） | 1 个已登记 flake；无 BL-007 用例失败 |
| Host CLI live cross-process E2E | 真实编译 Host bundle、独立 OS 进程、stdin/stdout RPC、AES-GCM 文件与 capability 拒绝 | `e2e/host_cli_profile_store_e2e.py` | ✅ 5/5 |
| package | 真实 main/preload/host/renderer bundle 与 macOS package | `npm run package` | ✅ |

本项目没有 HTTP/DB API；本报告将第二层准确称为 **Host CLI live cross-process E2E**，不把 stdin/stdout RPC 冒充 HTTP api-e2e。

## §2 integration 结果

### 2.1 执行命令

```bash
npm test
npx vitest run src/host/__tests__/wsMultiClientIsolation.test.ts \
  src/host/__tests__/wsRpcParity.test.ts
npm test
```

### 2.2 stdout 摘录（关键段）

首次全量（exit 1）真实统计：

```text
Test Files  2 failed | 190 passed | 1 skipped (193)
Tests       2 failed | 1888 passed | 6 skipped (1896)
FAIL wsMultiClientIsolation.test.ts ... T-042 ... rpc timeout: fs.unwatch
FAIL wsRpcParity.test.ts ... T-032 ... 在 8000ms 预算内始终未收到 fs:changed
```

两文件单独重跑用于确认负载不稳定性（exit 0）：

```text
Test Files  2 passed (2)
Tests       18 passed (18)
```

最后一次新鲜全量仍如实返回 exit 1，且失败收敛为已登记项：

```text
Test Files  1 failed | 191 passed | 1 skipped (193)
Tests       1 failed | 1889 passed | 6 skipped (1896)
FAIL wsRpcParity.test.ts ... T-032 ... 在 8000ms 预算内始终未收到 fs:changed
```

`project-specs/test-baseline.md` 已登记 `src/host/__tests__/wsRpcParity.test.ts` 与 `src/host/__tests__/wsMultiClientIsolation.test.ts` 的真实文件监听/PTY 负载 flakes；失败路径不在本 Feature 的 Profile authority、Host RPC、迁移或 renderer 改动范围。上述两文件脱离全量负载后 18/18 通过，因此本轮未发现新的 BL-007 回归；该 baseline 项仍须由主编排以 `test-baseline --diff` 机械确认。

### 2.3 exit-code

最终新鲜全量 `npm test`：`exit-code = 1`（已登记 baseline flake，非通过伪报）。

## §3 Host CLI live cross-process E2E 结果

### 3.1 前置环境

| 项 | 内容 | 获取方式 |
|---|---|---|
| 可执行 Host | `.vite/build/host.js` | `npm run package`，exit 0 |
| 进程边界 | 每个请求以独立 `node host.js --profile-store-rpc` 子进程运行 | Python `subprocess.run` |
| 传输 | 单个 JSON stdin 请求 / 单个 stdout 响应 | Host main-only RPC，不经过 HTTP 或 renderer |
| 临时数据 | `/tmp/teamwork/OKWORK-F260810051623-Remote-Profile-Authority/host-cli-live-e2e` | 脚本每次运行先清理并重建 |

### 3.2 执行命令

```bash
npm run package
python3 docs/features/OKWORK-F260810051623-Remote-Profile-Authority/e2e/host_cli_profile_store_e2e.py
```

### 3.3 stdout 摘录

```text
PASS E2E-001 describe real Host CLI
PASS E2E-002 save profile and exact-origin Vault credential
PASS E2E-003 metadata list excludes password plaintext
PASS E2E-004 wrong capability fails closed without enumeration
PASS E2E-005 AES-GCM ciphertext and private file permissions
Host CLI live cross-process E2E: 5 passed
```

该脚本仅以断言检查密码哨兵，绝不输出其值；它还验证 `profile-store` 为 `0700`、密文为 `0600`，以及密文不含 Profile 名或密码明文。

### 3.4 exit-code

`npm run package`: `exit-code = 0`  
Host CLI live cross-process E2E: `exit-code = 0`

## §4 AC 覆盖度（verify-ac.py 结果）

### 4.1 执行命令与输出

```bash
python3 /Users/liam/apps/okok/teamwork/skills/teamwork/templates/verify-ac.py \
  /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810051623-Remote-Profile-Authority/docs/features/OKWORK-F260810051623-Remote-Profile-Authority
```

```text
PRD AC 数：9
TC test 数：13
✅ AC-1 ... TC-001, TC-002
✅ AC-2 ... TC-002
✅ AC-3 ... TC-003
✅ AC-4 ... TC-004, TC-005
✅ AC-5 ... TC-006, TC-007
✅ AC-6 ... TC-008, TC-012
✅ AC-7 ... TC-009
✅ AC-8 ... TC-007, TC-010, TC-013
✅ AC-9 ... TC-011, TC-012
✅ AC 覆盖校验通过（9 条 AC 均有测试覆盖）
```

### 4.2 AC↔Test 矩阵

| AC ID | 验收结果 | 覆盖 TC | 层级 | 状态 |
|---|---|---|---|---|
| AC-1 | 每 Profile 唯一持久存储位置，Default 可迁移 | TC-001, TC-002 | integration + renderer | ✅ |
| AC-2 | 仅 ready 目标、信任披露与二次确认 | TC-002 | renderer | ✅ |
| AC-3 | main-only 专用通道与错配 capability 拒绝 | TC-003；E2E-004 | integration + live process | ✅ |
| AC-4 | copy→verify→switch 前锁 mutation、重启安全 | TC-004, TC-005 | integration | ✅ |
| AC-5 | 提交边界、cleanup pending 与幂等 retry | TC-006, TC-007 | integration | ✅ |
| AC-6 | Remote authority 离线 fail-closed、无陈旧 metadata | TC-008, TC-012 | integration + renderer | ✅ |
| AC-7 | 删除先撤权、跨重启保留并可 retry | TC-009 | integration | ✅ |
| AC-8 | authority/migration/cleanup 依赖阻止删 Host | TC-007, TC-010, TC-013 | integration + renderer | ✅ |
| AC-9 | 错误/磁盘不泄露秘密 | TC-011, TC-012；E2E-003, E2E-005 | integration + live process | ✅ |

覆盖率：**9 / 9（100%）**。

## §5 回归测试

| 测试集 | 范围 | 结果 |
|---|---|---|
| Feature targeted | 8 个 TC 文件 | 63/63 通过（本 stage 前的最终验证） |
| 全量 Vitest | 193 文件 / 1896 tests | 1889 通过、6 跳过、1 已登记 flake |
| Host CLI live E2E | Profile/Vault 真编译 Host 进程 | 5/5 通过 |
| Electron 密码 E2E | 密码保存、填充、可信窗口、普通存储文案 | T-012 先前最终验证通过；本 test stage 未复用为 fresh evidence |

## §6 fix-retry 历史

| Round | integration_exit | e2e_exit | 备注 |
|---|---:|---:|---|
| 1 | 1 | 0 | 全量仅剩既登记 `wsRpcParity` T-032 文件监听负载 flake；两 Host flake 单独复跑 18/18 通过；未修改产品代码。 |

## §7 已知问题（不阻塞）

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| BASELINE-WS-WATCH | 全量负载下 `wsRpcParity` T-032 可在 8 秒 budget 内收不到 `fs:changed` | 既有 flaky | 不把实际 exit 1 改写为通过；按项目 baseline 差分门禁处理 | `project-specs/test-baseline.md` |

## §8 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-08-10 | QA | ✅ confirmed | AC/TC 100%；无新增 BL-007 回归；全量 baseline flake 如实留痕。 |
