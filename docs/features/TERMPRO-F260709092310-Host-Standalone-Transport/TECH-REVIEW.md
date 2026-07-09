---
feature_id: TERMPRO-F260709092310-Host-Standalone-Transport
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
        description: "TECH 结构完整 · 现状基线逐字读码(PortLike 可承载 WS/协议 JSON-safe/归属缺口/env 继承 四条 decisive 前提亲验)· 简洁性自查列 4 处最小化抉择 + 3 处拒绝的更复杂方案 · §数据模型标注不涉 DB schema。"
        suggestion: "无 · counter-lens 通过:不新造握手消息(复用 host.info)/不发明二进制分帧(JSON 文本帧)/不自研网络认证(ssh+本机 token 闸)/传输只抽一层——四刀都砍在过度设计上。"
        category: quality
      - id: ARCH-BP-2
        severity: medium
        description: "external CR-3 的限速 DoS 杠杆:阻断式限速在 loopback 单源下无法区分攻击者与合法客户端,同机攻击者持续发坏 token 即把冷却窗强加给合法方。此属简洁性 counter-lens 命中(external 罕见地反向指出『多余的校验』)。"
        suggestion: "限速降级为告警 only 不阻断 · 真屏障是 128-bit token 熵。"
        category: technical-consistency
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:去掉阻断式限速会不会削弱安全?steelman 保留方:限速是纵深防御——但回读威胁模型:token 128-bit 熵使爆破本就不可行(2^128 尝试),限速的边际安全收益≈0;而 loopback 单源使限速无法定向攻击者,反而给了一个 DoS 杠杆(近零收益换新攻击面)。这正是 architect 该拦的过度设计。质疑不成立,采纳降级。
          rationale: "TECH §token 校验:AUTH_RATE_* 阻断方案废弃,改 AUTH_FAIL_ALERT 告警 only(窗内失败≥10 emit WARN 供观测,不 destroy/不冷却);常量表/错误处理/测试/风险四处同步;TC-B07/B08 相应调整为验证『告警不阻断合法连接』。"
          responded_at: "2026-07-09T13:35:00Z"
  - role: external
    execution: subagent
    verdict: CHANGES_REQUESTED
    degraded: true
    degraded_mode: config-disabled
    review_via: subagent
    note: "同模型 subagent 冷审 · 独立性权重调低 · 3 条 high 经主对话核实"
    findings:
      - id: CR-1
        severity: high
        description: "TECH 承诺给 pty.cwd 补归属校验(真实跨客户端 cwd 泄露,核 host.ts L175-179),声称 TC-K3 覆盖,但 TC.md tests[] 与 AC-6 矩阵无 pty.cwd 越权用例,且 TC-K1/K2/K3 编号在 TC 不存在(实际 TC-D01..D08)——安全修复零测试覆盖 + 交叉引用悬空。"
        suggestion: "TC 补 pty.cwd 越权用例;TECH 改用实际编号。"
        category: technical-consistency
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:pty.cwd 校验是否 pty.kill 用例的推论、无需独立用例?回读:pty.kill 与 pty.cwd 是两个独立 RPC handler,各自的 client.sessions.has 守卫是两处独立代码,一个绿不保证另一个绿;安全修复无独立回归门 = 可能实现时漏掉一个。且 TC-K1/K2/K3 编号确实凭空(TC 实际用 TC-D0x),交叉引用悬空会误导 dev。质疑不成立,采纳。
          rationale: "TC.md 新增 T-041b/TC-D03b(pty.cwd 越权回归门,与 T-041 同 harness);AC-6 矩阵加 T-041b;TECH advisory 对照表编号改 T-041/T-041b(TC-D03/D03b)。"
          responded_at: "2026-07-09T13:35:00Z"
      - id: CR-2
        severity: high
        description: "TECH 已定 payload 32MiB,交付的 TC-E02/E03 两条 P0 边界仍写 ~10MB(差 3 倍),边界测试会写在错误 cap 上。"
        suggestion: "TC 边界值同步 32MiB。"
        category: technical-consistency
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:TC 有占位声明说『TECH 定稿后同步数字』,是否已隐式覆盖?但占位声明是流程说明,external 看到的是具体断言值仍写 10MB——具体数字不同步则边界用例在错值上,占位声明不替代实际数字同步。质疑不成立,采纳(主对话已同步 TC-E02 Given=32MiB,E03 用相对『上限 95%』表达自动跟随)。
          rationale: "TC-E02 Given 改 32MiB(并注明上修理由);E03 用相对上限表达;第 404 行占位说明段保留(记录方法论)。"
          responded_at: "2026-07-09T13:35:00Z"
      - id: CR-3
        severity: high
        description: "限速进程级全局单桶(T-021),同机攻击者每窗口发 10 次坏 token 即持续锁死合法客户端;128-bit token 已使爆破不可行,限速边际收益≈0 却引入 DoS 杠杆——需设计取舍决策。"
        suggestion: "去阻断式限速或改不影响合法连接的方案。"
        category: security
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            见 ARCH-BP-2(主对话 architect 同源裁决):这是 counter-lens 命中的过度设计,token 熵是真屏障,阻断式限速近零收益换 DoS 杠杆。质疑保留限速的纵深论据不成立,采纳降级为告警 only。
          rationale: "同 ARCH-BP-2:限速降级告警不阻断 · TECH 五处同步 · 属技术取舍(architect 主对话裁决,非 DB schema 变更,不触发 §7.5 用户暂停点)。"
          responded_at: "2026-07-09T13:35:00Z"
      - id: CR-4-8
        severity: low
        description: "CR-4/6 阈值/CI 文件名占位未随定稿收敛(low) · CR-5 常量时间/时序断言脆弱(low) · CR-7 ::1 绑定矛盾(info) · CR-8 token 走 query string 反模式(info)。"
        suggestion: "dev 阶段收口。"
        category: quality
        pm_response:
          action: DEFER
          category: business-decision
          rationale: "非阻塞 · 留档交 dev:CR-5 常量时间断言改『审查比较函数用 timingSafeEqual』结构断言(TC 已如此)· CR-7 ::1 归入 loopback 白名单(TECH 已列)· CR-8 query token 由 dev 评估改 header/subprotocol · CI 文件名 dev 定稿。blueprint 不因 low 再转轮。"
          responded_at: "2026-07-09T13:35:00Z"
overall_verdict: APPROVE
overall_decided_at: "2026-07-09T13:40:00Z"
---

# TECH-REVIEW（TERMPRO-F260709092310-Host-Standalone-Transport）Blueprint

- **QA**:TC.md 64 条(+T-041b) · 7 层 · verify-ac PASS(AC-1..7 全覆盖) · 含 pty.kill/pty.cwd 归属回归门 + env-token 泄漏断言。
- **Architect(主对话)**:APPROVE · 简洁性 counter-lens 抓到 external CR-3 的限速 DoS 杠杆(ARCH-BP-2)· 不涉 DB schema。
- **External(降级 subagent 冷审)**:3 条 high 全 ADOPT 修入(pty.cwd 用例+编号 · payload 口径 · 限速降级)· 4 条 low/info DEFER 交 dev。

**收敛:APPROVE · TECH/TC 定稿 · 不涉数据库结构变更 · 交 dev 的 DEFER:常量时间断言口径 / ::1 白名单 / query-vs-header token / CI 文件名。**
