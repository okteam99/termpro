---
feature_id: TERMPRO-F260709092258-Workspace-Registry-Host
review_scope: blueprint
reviewers: [qa, architect, external]
verdict: APPROVE
review_completed_at: "2026-07-09T13:40:00Z"
reviews:
  - role: architect
    execution: main-conversation
    verdict: APPROVE
    findings:
      - id: ARCH-BP-1
        severity: info
        description: "TECH 结构完整(现状基线 grounded 真实代码 · 简洁性自查逐条列 YAGNI 拒绝项 · 错误处理表每条失败有日志不静默 · 完工自查槽) · §数据模型显式标注不涉 DB schema(注册表=JSON 文件)。"
        suggestion: "无 · 简洁性 counter-lens 通过:全量快照(非增量 patch)/等待确认(非乐观回滚)/version 单标记/renderer 驱动迁移/transient toast 五处均选了最简 default 并记录了拒绝的更复杂方案。"
        category: quality
  - role: external
    execution: subagent
    verdict: APPROVE_WITH_CONDITIONS
    degraded: true
    degraded_mode: config-disabled
    review_via: subagent
    note: "同模型 subagent 冷审(异质 CLI 不可用降级)· 独立性权重调低 · 但 grounded 真实代码 · 2 条 high 经主对话核实为真缺口"
    findings:
      - id: CR-1
        severity: high
        description: "迁移『失败计数』无持久化落点:PersistedState schema 只有 version/activeWorkspaceId/workspaces/ui,而 AC-4『连续 3 次』需跨启动累计,in-memory 每启动归零→MIG-009 不可实现。"
        suggestion: "加 migrationFailureCount 字段,定义 +1/清零/去重时机。"
        category: technical-consistency
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:失败极小概率,加持久字段是否过度?但 AC-4 白纸黑字要求「连续 3 次」跨启动语义,不加字段则该 P1 AC 物理上无法实现(每次启动计数归零永远到不了 3),这不是过度设计而是补齐可实现性缺口。质疑不成立,采纳。
          rationale: "TECH §PersistedState 加 migrationFailureCount(int · 默认0 · version=1 且迁移失败→+1 落盘 · 成功随 version=2 清0 · 达3 emit 一次性提示且本启动去重);错误处理表『单条迁移失败』『连续3次』两行呼应。"
          responded_at: "2026-07-09T13:35:00Z"
      - id: CR-2
        severity: high
        description: "host `void handleRpc` 是 fire-and-forget 并发,注册表是首个『读-改-写单 JSON』有状态 RPC;TECH 只规定单次写原子+回滚,未规定并发序列化,REG-008(P0)+多客户端广播使并发可达→丢更新风险。"
        suggestion: "补『单内存数组 + 同步 upsert 先行 + 串行写队列 + 唯一临时名』。"
        category: technical-consistency
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:local 单机迁移器已论证单实例(index.tsx:26-28),并发是否不可达?回读:迁移器单实例成立,但『多客户端广播』是模型 A 的既定契约(AC-3),第二个协议客户端 + 迁移逐条 create 使 host 侧并发真实可达;host.ts 的 void handleRpc 确无序列化。质疑不成立,采纳。
          rationale: "TECH §workspaceRegistry.json 加『并发写序列化』段:内存数组唯一真相 + 同步 upsert(后到 RPC 见前一条结果杜绝丢更新)+ promise 链串行写队列 + atomicWrite 唯一临时名(pid+seq)+ 写失败先回滚内存再抛 + 先落盘再广播;测试清单加 concurrent creates serialize 用例。"
          responded_at: "2026-07-09T13:35:00Z"
      - id: CR-3-6
        severity: low
        description: "3 条 low + 1 info:REGR-004 冒烟第二 Then 子句不可验证 · hydrate『注册表有/存档无→合成默认视图』分支无专用 TC · REG-009/REG-008 AC 映射偏松 · transient toast timer 生命周期需收口。"
        suggestion: "TC/dev 阶段顺带收口。"
        category: quality
        pm_response:
          action: DEFER
          category: business-decision
          rationale: "非阻塞项 · 留档交 dev 阶段(TC 补 hydrate 合成分支用例 · toast timer 在实现时收口 · REGR-004 措辞 dev 校正);blueprint 层不因 low 再转一轮。"
          responded_at: "2026-07-09T13:35:00Z"
overall_verdict: APPROVE
overall_decided_at: "2026-07-09T13:40:00Z"
---

# TECH-REVIEW（TERMPRO-F260709092258-Workspace-Registry-Host）Blueprint

- **QA**:TC.md 44 条 · 6 层 · verify-ac PASS(AC-1..6 全覆盖) · 含协调算法 11 条 + 迁移 10 条单测。
- **Architect(主对话)**:APPROVE · 简洁性 counter-lens 通过 · 结构完整 · 不涉 DB schema。
- **External(降级 subagent 冷审)**:2 条 high 已 ADOPT 修入 TECH(失败计数持久化 + 注册表并发序列化)· 3 low+1 info DEFER 交 dev。

**收敛:APPROVE · TECH/TC 定稿 · 不涉数据库结构变更(§7.5 暂停点不触发)· 交 dev 的 DEFER 项:hydrate 合成分支 TC / toast timer / REGR-004 措辞。**
