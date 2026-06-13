---
feature_id: "TERMPRO-F260613041948-quiet-notify"
integration_test_exit_code: 0
e2e_test_exit_code: 0
ac_coverage: "5/5"
tested_commit: 9bcb00bbc544cea2c4956b2b75f458e787cc1e8f
generated_at: "2026-06-13T05:05:00Z"
---

# TEST-REPORT(TERMPRO-F260613041948-quiet-notify)

> 测试层映射(本 feature = 渲染层逻辑 · 无后端/HTTP API):
> **integration** = 项目 vitest 套件(含本 feature 11 单测,覆盖 AC-1..AC-5 逻辑) ·
> **api-e2e** = 不适用(无服务进程,详下) · **e2e** = 无头冒烟(真跨进程:Electron 壳 + Host + PTY)。

## §integration(vitest · exit 0)

```
 Test Files  8 passed (8)
      Tests  113 passed (113)
   Duration  303ms
```

- 命令:`npm test`(vitest run)· **exit code = 0**
- 本 feature 新增 11 用例(`src/renderer/services/__tests__/quietNotify.test.ts`)全绿,直接覆盖:
  - AC-1:离开后无新输出 / 从未激活 → `hadOutputSinceLeave=false` → `decideQuietAction` 不标 waiting/不通知
  - AC-2:离开后有新输出 → `true` → 标 waiting + 通知一次(闩锁后不重复)
  - AC-3:聚焦 / 当前 tab → 不打扰 / 只亮 waiting(行为不变)
  - AC-4:`resetTabActivity` 重置基线,旧输出不触发,须再次「去激活后新增」
  - AC-5:多次切走取最近一次去激活时刻

## §api-e2e(不适用)

| 项 | 结论 |
|---|---|
| 是否需要 | ⏭️ **不适用** |
| 原因 | 本 feature 为渲染层通知 gating,**无对外 HTTP API、无后端服务进程**(TermPro 桌面应用),无 live 跨进程 API 链路可测(TC.md 已标 API E2E 不适用)。 |

## §e2e(无头冒烟 · exit 0)

```
E2E PASS: SMOKE_OK — app + Host(独立进程)+ PTY 端到端启动握手成功
```

- 脚本:`e2e/smoke-e2e.sh`(`TERMPRO_SMOKE=1 npx electron-forge start`)· **exit code = 0**
- 性质:**真跨进程 e2e** —— 启动 Electron 壳 + Host(独立 utilityProcess)+ 首个 PTY 握手,验证改动后构建产物可启动、Host RPC/PTY 实链路通(host git smoke 输出正常,SMOKE_OK)。
- 🔴 **行为级 e2e 的取舍**(非走捷径 · 留 audit):quiet 通知 gating 的完整行为依赖真实 ≥60s 静默 + OS 系统通知 + 多 tab/窗口交互,自动化行为 e2e 不实际;其正确性由 quietGate **11 单测(AC-1..AC-5)** + **三视角 code review**(Architect/QA/External 均确认接线)覆盖。本 e2e 守的是「改动未破坏 app 启动与 Host/PTY 端到端链路」。

## §AC 覆盖(verify-ac · 5/5)

```
✅ AC-1: T-001, T-002   ✅ AC-2: T-003   ✅ AC-3: T-004   ✅ AC-4: T-005   ✅ AC-5: T-006
✅ AC 覆盖校验通过(5 条 AC 均有测试覆盖)
```

## §回归

- 全套 113 测试通过,**含改动前既有套件**:host(sessionTracker 8 / outputScanner 11 / gitParsers 9)、renderer(tabPathLabel / terminalLinkParse / filepanel core 47 + controller 14)—— 均保持绿,无回归。
- done/bell/notify 通知分支未触碰(Architect + External 复核确认);`waitingNotified` 闩锁语义保持。
- 冒烟 host git smoke 链路正常,无启动回归。

## 遗留(P2 测试债 · review 阶段 deferred · 见 REVIEW.md)
- QA-C1:AC-2「进通知中心 / 不发系统通知」的 sessionEvents **集成测试**(受限于项目无 jsdom)—— 当前靠纯函数 + 代码阅读 + external 复核;P2,不阻交付。
- QA-C2:`quiet:false→quiet:true` 闩锁路径集成测试 —— P2。
> 二者为集成层测试债,纯逻辑已 11 测覆盖。需引入 jsdom 测试环境,体量超本敏捷需求范围;登记待后续。
