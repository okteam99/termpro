---
prd_feature_id: TERMPRO-F260710011342-Sidebar-Machine-Groups
review_round: 2
reviewers: [qa, architect, pl]
verdicts: {qa: APPROVE, architect: APPROVE, pl: APPROVE}
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-07-10T01:35:00Z"
reviews:
  - role: qa
    review_scope: prd
    execution: subagent
    round_1_verdict: NEEDS_REVISION
    round_2_verdict: APPROVE
    doc: reviews/goal-qa.md
  - role: architect
    review_scope: prd
    execution: subagent
    round_1_verdict: NEEDS_REVISION
    round_2_verdict: APPROVE
    doc: reviews/goal-arch.md
  - role: pl
    review_scope: prd
    execution: subagent
    round_1_verdict: NEEDS_REVISION
    round_2_verdict: APPROVE
    doc: reviews/goal-pl.md
---

# PRD-REVIEW（TERMPRO-F260710011342-Sidebar-Machine-Groups）· goal 两轮收敛

> 全文见 `reviews/goal-qa.md` · `reviews/goal-arch.md`（含 PL-CHALLENGE 段：reviews/goal-pl.md）。三路隔离 subagent 冷审。本文件机读整合单源。

## Round 1（三路 NEEDS_REVISION / changes_requested）

三路一致：Feature 方向不可杀（M5 唯一用户可见收口面 · BL-001~003 已交付但未被工作台消费），核心 AC 忠实对齐 WS-01-S4 + Q-002。缺口集中在**架构地基缺失 + 范围切分**：

| 缺陷组 | QA | Architect | PL | 严重度 |
|--------|-----|-----------|-----|--------|
| workspace 无 hostId 维度（数据模型隐性未交付·路由前提不存在） | QA-3 | ARCH-2 | — | MAJOR/high |
| per-host 键双源（host.info.hostId vs hostRegistry map 键·本机发散） | QA-4 | ARCH-1/6 | PL-4 | MAJOR/high |
| 独立查看器窗口够不到远程 host（AC-4/5 对远程不成立） | QA-7 | ARCH-3 | — | high |
| AC-5「全链路」40+ 消费点无覆盖门禁 | QA-2 | ARCH-5 | — | MAJOR |
| 会话徽标数据源未定义/机制说错（session:event 无 workspace 归属） | QA-1 | ARCH-9 | — | MAJOR |
| 断线时活跃远程 workspace 回落未定义 | QA-5 | — | — | MAJOR |
| AC-8 越界 BL-005（断线/重连入口） | — | — | PL-1 | medium |
| AC-9 搭车 PENDING-002 全组（仅 F10 真耦合） | QA-10 | — | PL-2 | medium |
| M=0 纯本机退化态未定义 | — | — | PL-3 | minor |

## Round 2 修订（PRD v0.2 → v0.3）

- **数据地基**：D-6 WorkspaceState 加运行时 hostId（本机持久化/远程实时发现不持久化·远程持久化划归 BL-005）；D-2 撤销 host.info.hostId 真实化·权威键=hostRegistry map 键（消双源）。
- **范围收口**：D-7 远程查看器窗口出 v1 范围（ARCH-3）· v0.3 传导入 AC-5（远程「文件」=树浏览+git着色·内容/Diff 禁用+提示·ARCH-8）· 登记 PENDING-005（PL-5 上游 SHRINK 认可）。
- **覆盖门禁**：AC-5 穷举主窗口消费点 + grep 门禁 + 豁免清单（viewer/*·ARCH-10）+ (hostId,sessionId) 复合键（ARCH-9）。
- **徽标现实**：D-9/AC-2 徽标=本客户端 hostId-aware tab 数（QA-1-R·零协议改·主机侧既存会话归 BL-005）。
- **范围缩**：AC-8 缩连接态（PL-1）· AC-9 收敛仅 F10（PL-2）· 补 AC-10 M=0（PL-3）· AC-6 升 P0 + AC-11 升 P1。

## Round 2 Verify（三路 APPROVE）

- **qa verify：APPROVE**。13/14 R1 消解 · 唯一硬阻塞 QA-1-R（徽标机制说错）v0.3 已按方案 A 修正（尊重 session:event 无 workspace 归属的协议现实）· QA-15~18 blueprint 带。
- **architect verify：APPROVE**。4 收口动作实质落地且与代码自洽（hostRegistry.ts/store.ts/ptyPool.ts 核实）· ARCH-8/9/10 三条 D-7 传导残留 v0.3 已文字收敛（远程文件=树浏览·复合键·门禁豁免）· 无架构返工。
- **pl verify：PASS**。四条 SHRINK 全消解 + 净收紧 · PL-5（D-7 静默收窄上游 AC②）v0.3 已显式认可 + 登记 PENDING-005 + 确定性 UX（禁用+提示）。

## 整合结论

- overall_verdict: **APPROVE**（三路 Round 2 verify 一致 APPROVE）· PRD v0.3 · 11 AC。
- needs-ui: **true**（Sidebar 机器分组 + 添加项目流程 · 全景 add-workspace/sidebar-machine-groups · ui_design 增量细化）。
- 移交 blueprint 的强制事项：D-6 serialize() 过滤 hostId!=='local'（远程不写 v2 存档）· D-9 (hostId,sessionId) 复合键路由 · AC-5 全消费点迁移清单 + grep 门禁豁免 viewer/* · 会话徽标/远程终端 per-host pty+session-event 接线估独立阶段（ARCH-7）· 远程文件点击禁用+提示 UX。
- concerns（发版前/后续）：PENDING-005 远程查看器窗口可见性延后 · 真机远程 spike（承接 BL-003）。
- 用户确认暂停点：yolo auto 代确认（blanket 授权 · 三路评审两轮全真跑 · 本文件 + concerns WARN 留痕）。
