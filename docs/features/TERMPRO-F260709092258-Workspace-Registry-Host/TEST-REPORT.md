---
feature_id: "TERMPRO-F260709092258-Workspace-Registry-Host"
author: QA
status: confirmed
prd_ref: PRD.md (v0.3)
tc_ref: TC.md (v1.0)
test_run_at: "2026-07-09T16:50:00Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: pass
revision_history:
  - version: v0.1
    date: "2026-07-10"
    author: QA
    summary: 首版:integration(vitest 全量)+ api-e2e(真实 host 进程 4 场景)+ verify-ac 全过
---

# Workspace 注册表驻留 Host - Test Report

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 责任人 |
|---|---|---|---|
| integration(进程内集成) | 注册表 CRUD/持久化/回滚 · RPC 语义 · reconcile 协调 · 迁移 · 多客户端广播(内存端口 harness) | `src/host/__tests__/workspaceRegistry.test.ts` · `workspaceMultiClient.integration.test.ts` · `src/renderer/state/__tests__/workspace*.test.ts` · `persistence.test.ts` · `src/main/__tests__/workspaceMigration.test.ts` | QA |
| api-e2e(live 跨进程) | 真实构建产物 host.js 独立 node 进程 + 真实磁盘注册表 + 跨重启 + 双客户端广播;Python 编排断言 | `e2e/test_workspace_registry_e2e.py`(driver: `e2e/host_driver.mjs`) | QA |
| browser-e2e | 不适用(execution_hints.ui_design_needed=false · Sidebar 交互已有组件级测试) | — | — |

api-e2e 说明:host 在本地形态依赖 Electron utilityProcess 注入 parentPort;e2e driver 在独立 node 进程内以同契约(PortLike)注入伪造 parentPort 后加载**真实 .vite/build/host.js 产物**,Python ⇄ driver 经 stdio JSON-lines,跨进程边界真实(编排进程 ≠ host 进程),磁盘/重启/多客户端全真。

## §2 integration 结果

### 2.1 执行命令
```bash
npx vitest run   # 全量(40 files · 含本 Feature 全部 integration)
```

### 2.2 stdout 摘录
```text
 Test Files  40 passed (40)
      Tests  343 passed (343)
   Duration  1.55s
```

### 2.3 exit-code
`exit-code = 0`(test-complete 经 --run-tests 由工具 subprocess 复跑取证,log 落 test-stdout.log)

## §3 api-e2e 结果

### 3.1 前置环境

| 项 | 内容 | 获取方式 |
|---|---|---|
| host 产物 | `.vite/build/host.js` | 场景 A 的 electron-forge start 构建产出 |
| 数据目录 | 临时目录(TERMPRO_HOST_DATA_DIR 注入) | 脚本自建 |
| 依赖 | node ≥20 · npx electron-forge | 项目自带 |

### 3.2 执行命令
```bash
python3 docs/features/TERMPRO-F260709092258-Workspace-Registry-Host/e2e/test_workspace_registry_e2e.py
```

### 3.3 stdout 摘录
```text
场景 A · 应用级冒烟(SMOKE_OK · 并产出最新 host 构建)
  ✓ E2E-A1 应用无头冒烟 SMOKE_OK(壳层↔host 握手)
场景 B · CRUD 经协议落真实磁盘(AC-1/AC-2)
  ✓ E2E-B1 create×2/update/remove 后磁盘 = 内存终态(['alpha2'])
  ✓ E2E-B2 workspace.list 与磁盘一致
场景 C · 跨 host 重启存活(AC-2)
  ✓ E2E-C1 重启后列表 = 最后一次成功操作终态
场景 D · 多客户端广播一致(AC-3)
  ✓ E2E-D1 两客户端均收到 workspace:changed 全量快照(含 gamma)
  ✓ E2E-D2 两端快照一致

OK — 6 e2e assertions passed
```

### 3.4 exit-code
`exit-code = 0`

## §4 AC 覆盖度(verify-ac.py 结果)

### 4.1 verify-ac.py 输出
```text
✅ AC-5: 被 5 个 test 覆盖 (REG-003, COORD-006, REGR-001, REGR-002, REGR-003)
✅ AC-6: 被 4 个 test 覆盖 (COORD-008, COORD-009, COORD-010, INT-003)
✅ AC 覆盖校验通过（6 条 AC 均有测试覆盖）
```

### 4.2 AC↔Test 矩阵(详表见 REVIEW-qa.md §AC 对照)

| AC ID | 描述 | 覆盖 | 层级 | 状态 |
|---|---|---|---|---|
| AC-1 | v1→v2 迁移(保 id/备份/幂等/N=0) | MIG-001..010 + E2E-A1 | integration + e2e | ✅ |
| AC-2 | 增删改经协议落 Host · 跨重启存活 | REG-* / RPC-* + E2E-B1/B2/C1 | integration + e2e | ✅ |
| AC-3 | 全量快照广播 · 按 id 协调 | COORD-* / INT-* + E2E-D1/D2 | integration + e2e | ✅ |
| AC-4 | 迁移失败 v1 fallback + 重试 + 提示 | MIG-006..010 | integration | ✅ |
| AC-5 | 视图态留 UI · v2 去 name/root · 孤儿丢弃 | REGR-001..003 / COORD-006 | integration | ✅ |
| AC-6 | 远端删除释放 tab/PTY · 活跃切首个 | COORD-008..010 / INT-003 | integration | ✅ |

覆盖率:6 / 6(100%)

## §5 回归测试

| 测试集 | 范围 | 结果 |
|---|---|---|
| 全量 vitest(40 files) | host + renderer + main 全模块 | ✅ 343 passed |
| review fix 回归 | F1(list 失败降级 3 例)/ F2(并发写失败 1 例)/ F3(upsert 1 例) | ✅ 含在全量内 |
| 应用冒烟 | TERMPRO_SMOKE 全链路 | ✅ SMOKE_OK(E2E-A1) |

## §6 fix-retry 历史
Round 1 直接全绿,无 fix-retry。

## §7 已知问题(不阻塞 · audit 留痕)

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| F13 | 注册表读失败重试耗尽后提示措辞与实际不符(纯 UX) | MINOR | deferred | REVIEW.md 台账 · 随 ship 入待规划池 |

## §8 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-07-10 | QA(PMO 编排) | ✅ pass | integration+e2e+verify-ac 三证齐 |
