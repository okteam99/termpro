---
reviewers: [fast]
review_models:
  - fast: "gpt-5.5"
verdict: APPROVE
coverage:
  fast: "Architect: checked generation方案一致性、同host串行/不同host隔离、Map清理、ABA与简洁性counter-lens; QA: checked真实生产入口测试、最新代次失败提示保留、实跑证据与边界遗漏"
findings: []
---

# Code Review

Verdict: APPROVE.

本轮是 fast 单路冷审，合并 Architect + QA 视角。按要求只做静态审读，没有重新运行测试；测试证据来自 bug 报告与 `state.json` 的 dev 证据快照。未读取其他 reviewer 报告。

## Findings

无 open finding。

## Review Notes

### Q1. 修复是否严格符合用户确认的 per-host generation 方案？

质疑：如果只是继续按 `hostId` 串行，旧代次仍可能在最终失败窗口写入不可撤回的 xterm 提示。

回读证据：`src/renderer/services/sessionReadopt.ts:199-202` 为每次 `readoptHostSessions(hostId)` 创建 object token 并写入 `latestGeneration`；`213-216` 将最终失败提示包进 generation 检查；`241-247` 在失败后若已被新代次取代则返回，不再把旧错误升级为最终失败；`264-267` 只由当前最新代次清理 generation。

裁决：符合确认方案。用户可见的 `notifyAdoptFailed` 副作用已受最新代次闸门保护，且没有改 Host/main/RPC 协议。

### Q2. 并发、Map 清理、ABA、同 host 串行、不同 host 隔离是否正确？

质疑：generation 可能破坏原有同 host 串行，或旧 finally 清掉新代次，产生 ABA/泄漏。

回读证据：`inflight` 仍是 `hostId -> Promise` 尾指针，`223-268` 保留原有 `prev.then(...)` 串行链；不同 host 由 `Map` 的 `hostId` key 自然隔离。`latestGeneration` 存 object token 而非递增数字，`finally` 里用 `isLatestGeneration()` 保护清理，旧代次不会删除新代次 token；`inflight` 同样保留 `inflight.get(hostId) === next` 的既有尾指针清理。

裁决：并发模型成立。ABA 与旧 finally 误清理已被 token identity 规避；不同 host 不共享 token 或队列。

### Q3. “首次尝试始终执行、仅重试取消”的语义是否足够？

质疑：如果一个请求已经被更新请求取代，继续执行首次尝试是否会引入陈旧副作用？

回读证据：`227-235` 明确只在 `i > 0` 时取消旧代次，保留既有“并发调用串行各跑一轮”语义。生产 `readoptHost` 是幂等收养：已有 session 通过 `adoptedSids/localSids` 去重收敛，成功路径主要是 re-attach、badge reconcile、tab rebuild；失败路径的用户提示已由 `213-216` 保护，失败后的重试由 `241-247` 取消。若一个过时代次首次尝试成功，后续更新代次仍会按队列执行一次，最终状态由更新代次再对账。

裁决：接受。这里选择保留 idempotent 首次收养，比引入 AbortSignal 或跳过整轮更贴合既有代码，也避免漏掉“后一轮只是重复 ready 事件”的合法收养机会。

### Q4. 新增测试是否从真实生产入口触达真实队列与 hook？

质疑：测试可能只 mock seam，没触达真实 `readoptHostSessions` 串行队列和 production hook 包装。

回读证据：新增用例 `sessionReadoptNotice.test.ts:74-103` 直接调用真实导出 `readoptHostSessions` 两次，同一 `hostId` 下第二轮必须排在真实 `inflight` 队列后；fake `readopt` 只模拟 `readoptHost` 生产注入点，仍通过真实 hooks 对象调用 `onAdoptFailed` / `reconcileBadge`。生产 `readoptHost` 的失败 hook 调用点在 `terminalRegistry.ts:1040-1043` 与 `1084-1088`，与测试模拟形状一致。

裁决：测试触达真实队列与 hook 包装，不属于 seam-tested-but-not-wired。它能在旧实现下稳定复现报告中的过期提示。

### Q5. 最新代次真实失败提示是否保留？不同 host 边界是否遗漏？

质疑：generation 闸门可能把最新代次的真实失败也静默掉；或者一个 host 的更新请求影响另一个 host。

回读证据：既有提示回归用例 `sessionReadoptNotice.test.ts:105-152` 仍覆盖“最新轮最终失败才带 `onAdoptFailed` 并写提示”、“成功清位后可再次提示”。不同 host 并发不阻塞由 `sessionReadopt.test.ts:245-264` 覆盖；生产实现对 `inflight` 与 `latestGeneration` 均按 `hostId` key 隔离。

裁决：核心行为覆盖足够。没有单独新增“cfg-1 旧失败被抑制时 cfg-2 最新失败仍提示”的组合用例，但该项会是覆盖加密度，不是当前代码已暴露的行为风险，因此不列 finding。

### Q6. `__resetAdoptNoticeMemoForTests()` 清 generation 是否有并行测试或生产风险？

质疑：测试 hook 新增 `latestGeneration.clear()`，若和在途 readopt 并行，可能让在途请求看起来不再是最新代次。

回读证据：全仓搜索显示该 hook 只在 `sessionReadoptNotice.test.ts` 使用；生产代码没有调用。该测试文件每个用例都 await `readoptHostSessions` 返回后结束，`beforeEach` 清理不会与本文件内在途 promise 重叠。原 hook 也没有清 `inflight`，所以任何泄漏在途 readopt 的测试本来就会污染下一用例。

裁决：无生产风险；测试风险受当前用法约束可接受。这里清 generation 是必要的测试隔离，否则上一用例的最新 token 会影响下一用例断言。

### Q7. 错误处理、WARN 语义、资源泄漏、兼容性

质疑：旧代次被吞掉后是否无日志，或者新增 Map/token 是否泄漏、改变兼容面。

回读证据：旧代次失败后有带 `hostId` 与原始错误的 WARN (`241-247`)；退避期间被取代也有 WARN (`229-234`)。最新代次最终失败仍走既有 catch WARN (`261-263`) 和终端提示。新增状态是 renderer 模块内存 Map，无协议、数据、依赖或持久化变更；最新代次完成时会清理 token，旧代次 finally 不会误清新 token。

裁决：错误可观测性和兼容性可接受。Map 泄漏面不大于既有 `inflight` 挂起面；正常完成路径会清理。

## Test Evidence Reviewed

- Bug 报告记录红灯：`sessionReadoptNotice.test.ts` 旧实现 1 failed / 5 passed，失败为收到过期 `host connection lost` 提示。
- Bug 报告记录绿灯：单文件 6 passed，邻近集合 5 files / 48 tests passed。
- `state.json` dev 证据记录：`npm test` 210 files passed / 4 skipped，2128 tests passed / 33 skipped；typecheck exit 0；touched eslint exit 0；Electron smoke `SMOKE_OK` exit 0。

## Approval Rationale

修复集中在 renderer 的收养生命周期状态，按 `hostId` 增加代次闸门，直接覆盖已复现竞态。实现没有改变 Host 协议、RPC 契约、tab 重建语义或按键自愈语义；测试从真实 `readoptHostSessions` 入口触达真实串行队列和 hook 包装。剩余边界属于覆盖密度而非已证实缺陷，因此本轮批准进入下一阶段。
