---
prd_feature_id: "TERMPRO-F260613041948-quiet-notify"
review_round: 2
review_started_at: "2026-06-13T04:30:00Z"
review_completed_at: "2026-06-13T04:40:00Z"
reviewers: [pm, qa, architect]
verdicts: {pm: APPROVE, qa: APPROVE, architect: APPROVE}
reviews:
  - role: pm
    review_scope: prd
    execution: main-conversation
    verdict: APPROVE
    pm_self_check:
      checklist_passed: true
      code_context_read: true
      failed_items: []
      notes: "起草前经 Explore 子代理完成代码现状调研(sessionTracker/ptyPool/sessionEvents/protocol/store/hostClient/terminalRegistry);AC 与现状契合,未下沉技术细节(实现方向段为评审要求的可行性锚点,代码落点留 blueprint)"
    findings: []
  - role: qa
    review_scope: prd
    execution: subagent
    verdict: APPROVE   # Round 2(Round 1 = NEEDS_REVISION · 8 findings 全 ADOPT 已解决)
    files_read: [PRD.md, src/host/sessionTracker.ts, src/renderer/services/sessionEvents.ts, src/host/__tests__/sessionTracker.test.ts]
  - role: architect
    review_scope: prd
    execution: subagent
    verdict: APPROVE   # Round 2(Round 1 = NEEDS_REVISION · 7 findings 全 ADOPT 已解决)
    files_read: [PRD.md, src/host/sessionTracker.ts, src/host/ptyPool.ts, src/renderer/services/sessionEvents.ts, src/shared/protocol.ts, src/renderer/state/store.ts, src/renderer/services/hostClient.ts, src/renderer/terminal/terminalRegistry.ts]
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-06-13T04:40:00Z"
---

# PRD-REVIEW(TERMPRO-F260613041948-quiet-notify)

> Round 1(qa/architect 子代理隔离评审)→ 全 NEEDS_REVISION · PM 逐条回应并修订 PRD v0.1→v0.2 → Round 2 复核 → 全员 APPROVE。

## PM 段(execution: main-conversation · verdict: APPROVE)

PM 起草前完成代码现状调研(Explore 子代理 · 见 pm_self_check)。PRD 聚焦 WHAT(行为/价值);因 QA/Architect 评审要求显式锚定可行性前提,补「实现方向」段到**方向级**(判据 + 落点层),代码细节(数据结构/确切重置点)留 blueprint。`code_context_read: true`。

## QA 段(execution: subagent · verdict: APPROVE @ Round 2)

### Round 1 Findings(全 ADOPT)

##### QA-1(severity: high · category: quality)
「切走后」时间基准未定义,AC Given 依赖 PRD 未定义的隐含状态字段,测试无法确定性构造。
**建议**:明确「切走时刻」的持有者与取法,使每条 AC 自洽。
**PM 回应**:ADOPT。
- 对抗自查:QA 反方最强论据 = AC 若不指明参考点(deactivatedAt)谁持有、怎么传,QA 写不出确定的 Given,等于把判定押在实现细节上;不同实现(host 记 vs 渲染层记)会得到不同测试结果。该论据成立。
- 理由:已修订 —— 新增「## 实现方向」段,明确 `deactivatedAt = setActiveTab 去激活时刻(渲染层持有)`,判据 `lastOutputAt > deactivatedAt`。

##### QA-2(severity: high · category: quality)
Out-of-Scope「优先不动 host」与 AC 可判定性矛盾,纯渲染层能否拿到「离开后有输出」信号无判据(渲染层不收 output 事件流)。
**建议**:补「实现可行性前提」,给 blueprint 可对照判据。
**PM 回应**:ADOPT。
- 对抗自查:QA 反方最强论据 = 若渲染层确实拿不到「离开后是否有输出」,纯渲染层方案根本不可达成,把它留在 Out-of-Scope「再议」= 把最高风险决策悬空。该论据成立(且 Architect ARCH-2 给出渲染层确可拿到的具体来源)。
- 理由:已修订 —— 实现方向段写明渲染层 per-tab `lastOutputAt`(终端输出更新)可达成,纯渲染层可行性闭合。

##### QA-3(severity: medium)·「从未激活过」初始态未覆盖 → **ADOPT**:AC-1 描述补「含从未被激活过」+ 状态图入口标注。
##### QA-4(severity: medium)·AC-4 多次往返重置语义不精确 → **ADOPT**:AC-4 固定「重新计时起点 = 下一次输出后静默,仅旧 lastOutput 满足时间条件不触发」。
##### QA-5(severity: medium)·tick(~1.5s)精度/验收上界缺失 → **ADOPT**:交付预期加「触发精度」note(60~61.5s · ≤65s 过 · >70s fail),验证方式改「等 ≥65s」。
##### QA-6(severity: medium)·失焦 vs 后台 区分缺失 → **ADOPT**:AC-3 拆明聚焦+当前 tab / 失焦+当前 tab,声明不触碰该策略。
##### QA-7(severity: low)·渲染层无单测 → **ADOPT**:实现方向段加「blueprint 须补渲染层 sessionEvents 单测」+ 3 条覆盖方向。
##### QA-8(severity: low · business-decision)·Q1 与 Out-of-Scope 一致性 → **ADOPT**:Out-of-Scope 顶部标注「以 Q1=A 为前提」。

### Round 2:全部解决 → APPROVE。

## Architect 段(execution: subagent · verdict: APPROVE @ Round 2)

### Round 1 Findings(全 ADOPT)

##### ARCH-1(severity: high · category: technical-consistency)🔴 本次最高价值
拟议判据「`quiet` 恰在 `lastOutput+QUIET_MS` 后 emit,故 quiet 到达时 `(now − deactivatedAt) ≥ QUIET_MS` ⟺ 离开后有过输出」**不成立** —— host `tick(~1.5s)` 抖动 + 传输延迟 + host/renderer 时钟不同源,会同时产生假阴(漏报 AC-2)与假阳(误报 AC-1)。
**code_evidence**:`src/host/ptyPool.ts:22,152`;`src/host/sessionTracker.ts:83-89`
**建议**:改渲染层直接记 per-tab `lastOutputAt`,判据 `lastOutputAt > deactivatedAt`,与抖动/延迟/时钟解耦。
**PM 回应**:ADOPT。
- 对抗自查:Architect 反方最强论据 = 时间差推断在 host 轮询/网络抖动下有秒级误差,边界用户操作(lastOutput 后、quiet emit 前那 0~1.5s 切走)直接导致误报,正是要修的 AC-1 根因没修掉;且依赖跨进程时钟不可靠。该论据**完全成立** —— 我初稿的「巧妙」判据其实脆弱。
- 理由:已修订 —— 实现方向段**明确弃用**时间差推断,改 `lastOutputAt > deactivatedAt`(同源 renderer 时钟),并写明弃用理由。

##### ARCH-2(severity: high · technical-consistency)·纯渲染层落点 = `terminalRegistry` onData 维护 per-tab `lastOutputAt` + sessionEvents 读取 → **ADOPT**:实现方向段锚定该来源,确认 ≤3 渲染文件、不改协议/host。
**code_evidence**:`hostClient.ts:186-193`;`terminalRegistry.ts:124-132`;`sessionEvents.ts:37,123-141`
##### ARCH-3(severity: medium)·`deactivatedAt` 无现成记录点 + 时钟同源要求 → **ADOPT**:实现方向写明 deactivatedAt 取 setActiveTab 转移时刻、与 lastOutputAt 同 renderer 时钟。
##### ARCH-4(severity: medium · business-decision)·简洁性:勿为省一个 Map 去改协议/host(过度设计+责任归错层)→ **ADOPT**:Out-of-Scope 明确「不动协议/host、不让 host 感知激活态」。
##### ARCH-5(severity: medium)·并发/时序边角(多次切走取最近、失焦语义、spawn 未首帧初值)→ **ADOPT**:新增 AC-5、AC-3 澄清失焦、实现方向说明初值。
##### ARCH-6(severity: low)·AC-4「沿用现有机制」误导(需重置新增基线)→ **ADOPT**:AC-4 补「重置去激活时刻/输出基线」。
##### ARCH-7(severity: info · business-decision)·Q1=A 架构正确(done/bell/OSC9 语义不同不应一并收紧)→ **ADOPT**:Q1 决策表引用该结论,Out-of-Scope 限定改动在 quiet 分支。

### Round 2:全部解决 → APPROVE。

## 整合结论(Round 2)

- overall_verdict: **APPROVE**(pm/qa/architect 全 APPROVE)
- next_round_required: false
- 关键产出:评审把初稿脆弱的「时间差推断」纠正为健壮的「`lastOutputAt > deactivatedAt` 同源比较」,并锁定纯渲染层落点(≤3 文件 · 不改协议/host · 维持敏捷需求定级)。
- 下一步:Substep 8 `--needs-ui=false`(无 UI 组件改动)→ Substep 9 用户确认 → goal-complete。
