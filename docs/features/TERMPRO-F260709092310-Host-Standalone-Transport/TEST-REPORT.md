---
feature_id: "TERMPRO-F260709092310-Host-Standalone-Transport"
author: QA
status: confirmed
prd_ref: PRD.md (v0.3)
tc_ref: TC.md (v1.0)
test_run_at: "2026-07-09T17:10:00Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: pass
revision_history:
  - version: v0.1
    date: "2026-07-10"
    author: QA
    summary: 首版:integration(vitest 全量·真实 ws/pty) + api-e2e(真实打包产物 4 场景) + verify-ac 7/7
---

# Host Standalone + WS 传输 + 握手 - Test Report

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 责任人 |
|---|---|---|---|
| integration(进程内集成 · 真实 ws 服务器/真实 node-pty) | token 闸 T-014..030 · 握手门控 T-008..013 · 畸形帧 T-047..052 · 多客户端归属隔离 T-039..046 · RPC parity 20/20 方法 T-031 · fs.watch 推送 T-032/033 · 版本矩阵 T-001..007 · 嵌入式回归 T-063 | `src/host/__tests__/{tokenGate,wsHandshakeGate,wsMalformedInput,wsMultiClientIsolation,wsRpcParity}.test.ts` · `src/renderer/services/__tests__/hostClient*.test.ts` · `src/shared` 版本纯函数 | QA |
| api-e2e(live 跨进程 · 真实打包产物) | 打包→独立 node 进程→WS token 握手→host.info-first→pty 真实 echo;负向门控(错误/空 token/门控违规) | `e2e/test_host_standalone_e2e.py`(probe: `e2e/ws_negative_probe.mjs`) | QA |
| browser-e2e | 不适用(无新 UI · execution_hints.ui_design_needed=false) | — | — |

说明:本 Feature 的 vitest「integration」已是真实 WS 服务器 + 真实 node-pty(单测试进程内起 live 服务);api-e2e 进一步用**打包产物**(vite bundle + native 组装)在**独立 node 进程**跑全链路,Python 编排断言 —— 覆盖「构建产物可运行」维度(AC-4)。

## §2 integration 结果

### 2.1 执行命令
```bash
npx vitest run   # 全量 39 files
```

### 2.2 stdout 摘录
```text
 Test Files  39 passed (39)
      Tests  352 passed (352)
```
(修复轮后连续 3 轮全量全绿;PMO 独立复核亦 3 轮全绿 —— F1 poke 修法后闪断闭合)

### 2.3 exit-code
`exit-code = 0`(test-complete 经 --run-tests 由工具 subprocess 复跑取证)

## §3 api-e2e 结果

### 3.1 前置环境

| 项 | 内容 | 获取方式 |
|---|---|---|
| host 产物 | package-host.mjs 组装(bundle + node-pty native + 最小 package.json) | 脚本自动 |
| 依赖 | node ≥20 · npx electron-forge · worktree node_modules(ws) | 项目自带 |

### 3.2 执行命令
```bash
python3 docs/features/TERMPRO-F260709092310-Host-Standalone-Transport/e2e/test_host_standalone_e2e.py
```

### 3.3 stdout 摘录
```text
场景 A · AC-5 嵌入式零回归(SMOKE)
  ✓ E2E-A1 TERMPRO_SMOKE → SMOKE_OK
场景 B · AC-4 打包产物组装(darwin-arm64)
  ✓ E2E-B1 package-host.mjs 组装完成
场景 C · AC-1/2/3 正向全链路(真实产物进程 + WS 握手 + PTY echo)
  ✓ E2E-C1 verify-host-artifact → VERIFY_OK
场景 D · AC-3/AC-7 负向门控(错误/空 token · 门控违规 · 阳性对照)
  ✓ E2E-D1 ws_negative_probe → PROBE_OK
OK — 4 e2e assertions passed
```
probe 内部 4 断言:错误 token 拒(零消息)/ 空 token 拒(F3 fail-closed 产物级回归)/ 首条非 host.info 断开 / 阳性对照正常应答。

### 3.4 exit-code
`exit-code = 0`

## §4 AC 覆盖度(verify-ac.py 结果)

### 4.1 verify-ac.py 输出
```text
✅ AC-7: 被 6 个 test 覆盖 (T-047..T-052)
✅ AC 覆盖校验通过（7 条 AC 均有测试覆盖）
```

### 4.2 AC↔Test 矩阵(详表见 REVIEW-qa.md §AC 对照)

| AC ID | 描述 | 覆盖 | 层级 | 状态 |
|---|---|---|---|---|
| AC-1 | 全协议经 WS 等价服务 | T-031..037 + E2E-C1 | integration + e2e | ✅ |
| AC-2 | 版本区间握手/不兼容拒绝 | T-001..007 + T-060..062 | integration | ✅ |
| AC-3 | token 闸(熵/常量时间/信道/读后即抹) | T-014..030 + E2E-D1 | integration + e2e | ✅ |
| AC-4 | 打包产物双平台实机 + linux-arm64 产物 | spike VERIFY_OK ×3 平台 + CI matrix + E2E-B1/C1 | e2e + CI | ✅ |
| AC-5 | 嵌入式零回归 | T-013/T-063 + E2E-A1(SMOKE_OK) | integration + e2e | ✅ |
| AC-6 | 多客户端会话/watch 归属隔离 | T-039..046 | integration | ✅ |
| AC-7 | 畸形输入 host 不崩他人无感 | T-047..052 + E2E-D1 | integration + e2e | ✅ |

覆盖率:7 / 7(100%)

## §5 回归测试

| 测试集 | 范围 | 结果 |
|---|---|---|
| 全量 vitest(39 files) | host + renderer + main | ✅ 352 passed ×3 轮连续 |
| review fix 回归 | F1 poke 修法(4 用例)/ F3 空 token(4 例)/ F5 parity 20/20 | ✅ 含在全量内 |
| 嵌入式冒烟 | TERMPRO_SMOKE 全链路 | ✅ SMOKE_OK(E2E-A1) |

## §6 fix-retry 历史
Round 1 直接全绿,无 fix-retry。

## §7 已知问题(不阻塞 · audit 留痕)

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| F6-F9/F11/F12 | Origin 纵深/告警节流/边界补测组/token 运维面/门控细节组/验证轮 info 组 | MINOR/NIT | deferred | REVIEW.md 台账 · 随 ship 入待规划池 |

## §8 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-07-10 | QA(PMO 编排) | ✅ pass | integration+e2e+verify-ac 三证齐 |
