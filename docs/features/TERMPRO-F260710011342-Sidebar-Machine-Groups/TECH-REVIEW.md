---
tech_feature_id: TERMPRO-F260710011342-Sidebar-Machine-Groups
review_stage: blueprint
review_rounds: 2
reviewers: [qa, architect, external]
verdict: APPROVE
db_schema_change: false
db_schema_pause_required: false
reviews:
  - role: qa
    execution: subagent
    scope: "TC 作者 + 可测性把关：AC↔test 覆盖(verify-ac 11/11 · 35 test) · 数据模型作用域缺口补测(E2/E3/E4/E5 对称非干扰+create不落本机+v1 fallback+session 生命周期) · 门禁 import 集对齐"
    round_1_verdict: APPROVE
    round_2_verdict: APPROVE
    doc: TC.md
  - role: architect
    execution: subagent
    round_1_verdict: NEEDS_REVISION
    round_2_verdict: APPROVE
    findings_count: 7
    doc: reviews/blueprint-architect.md
  - role: external
    execution: subagent
    heterogeneous: false
    degraded: true
    degraded_mode: config-disabled
    round_1_verdict: NEEDS_REVISION
    round_2_verdict: APPROVE
    findings_count: 6
    doc: external-cross-review/blueprint-claude-subagent-degraded.md
overall_verdict: APPROVE
decided_at: "2026-07-10T03:20:00Z"
---

# TECH-REVIEW（TERMPRO-F260710011342-Sidebar-Machine-Groups）· blueprint 两轮收敛

> 全文：`reviews/blueprint-architect.md`（architect · R1+R2 verify）· `external-cross-review/blueprint-claude-subagent-degraded.md`（第三视角隔离冷审 · R1+R2 verify · v8.204 yolo 默认介质）。qa=TC 作者+可测性把关。本文件机读整合单源。

## Round 1（architect + external NEEDS_REVISION）

两路一致：TECH grounding **扎实**（53 hostClient 消费点 A/B/C 分类逐条独立复核正确 · App.tsx:76 折行漏网点捕获 · 复合键必要性 · AC-6 物理基础 forWorkspace('local')===单例 · AC↔TC 映射完整）。缺陷集中在**数据模型作用域「点到目标没给可落地机制」**：

| 缺陷 | architect | external | 严重度 |
|------|-----------|----------|--------|
| reconcileWorkspaces 作用域隔离（本机加项目清空所有远程机分组 + 远程 active 被抢） | A1 | E2 | **BLOCKER/MAJOR** |
| serialize v1 fallback + CRUD v1 分支不过滤 hostId（远程 ws 落 v1 存档被 runMigration 本机重建） | A2 | E3 | high |
| forHostId 未定义 + create `?? local()` 兜底静默写错 host | A5 | E4 | high |
| grep 门禁 pattern 自伤（折行/注释两难） | A3 | E1 | high |
| deps.platform 构造期值 / FsLinkProvider 构造注入 / session 订阅挂载点 / reconcile 签名 | A4/A6 | E5/E6 | minor/low |

## Round 2 修订（TECH v0.2 + TC 35 test）

- **A1/E2 作用域隔离**：给出四步机制（filter-in inScope/outScope → reconcileWorkspaces(+scopeHostId 形参) → 按原位次 merge-back outScope 透传 → active 守卫：active 属本作用域被删才回落）。applyWorkspaceSnapshot scopeHostId='local' / setHostWorkspaces=configId 对称。QA 补 BL004-U-snapshot-scope-local/-remote 两 P0。
- **A5/E4**：写读分流 forWorkspace(读·兜底 local+恒 WARN)/forHostId(写·null 绝不兜底)·create null→拒绝不落本机。
- **A2/E3**：serialize v1+v2 双分支都 filter(hostId==='local')+active coerce·CRUD v1 拒绝非 local。
- A4/A6/E5/E6 全消解。

## Round 2 Verify（三路 APPROVE）

- **architect verify**：A1/A2/A4/A5/A6/E5/E6 逐条闭环（推演两关键场景本机加项目不清空远程 + 远程 active 不被抢）。新增 **V1/V2 MAJOR**：import 集门禁 `grep import[^;]*hostClient` unsound（跨进路径段 type-import 假阳）+ incomplete（多行漏）+ TECH↔TC 门禁分叉。
- **external verify**：E2 blocker + E3/E4 high + E5/E6 low 全真闭环。新增 **V1（high）**：TECH↔TC 门禁未收敛（V2 同）+ V3（TC create gherkin 误用 forWorkspace 读原语）+ V4（陈述性残留）。

## Round 3 门禁定稿（PMO · verify V1~V4 收敛）

两路 verify 共同锁定门禁未真收敛——PMO 直接定稿单一权威门禁（实测验证）：
- **权威正则**（一次免疫折行/注释/type-import/路径段/多行五坑）：`import\s+(?:type\s+)?\{[^}]*\bhostClient\b[^}]*\}`（perl -0777 多行 + 大小写敏感 + 花括号作用域）+ tsc 背靠。实测：`import { hostClient }`（单/多行/混合花括号）→ MATCH 违规；`import type { HostClient }`（大写 type）+ 注释 → 放行。
- TECH §覆盖门禁 + TC BL004-U-grepgate **统一为同一条正则**（不再使用点 grep + 剥注释 allowlist）。V4 陈述性残留（TECH:511 补充洞察 + TC 变更记录）订正。V3 create gherkin forWorkspace→forHostId。deps.ts 不进豁免集靠 import 正则守（未完成参数化即命中·非注释假阳）。

## 整合结论

- overall_verdict: **APPROVE**（三路 R2 verify 一致 · 门禁 R3 定稿实测通过）· TECH v0.2 · TC 35 test（verify-ac 11/11）。
- **无 DB schema 变更**（protocol.ts 零改 · workspaces.json/v2 存档 schema 不变 · 无 §7.5 DB 暂停点）。
- 移交 dev 强制事项：① reconcileWorkspaces 作用域隔离四步机制（本机加项目不清空远程 + 远程 active 守卫）② forHostId 写原语 null 绝不兜底(create) ③ serialize v1+v2 双分支过滤 ④ import 集门禁正则(perl -0777) + tsc 背靠 ⑤ 复合键 (hostId,sessionId) + sessionEvents 并入 remoteWorkspaceSync ready 编排。
- concerns：真机远程 spike（承接 BL-003 · 沙箱无 sshd · 远程路由靠注入 per-host client 桩）· PENDING-005 远程查看器窗口延后。
- 用户确认暂停点：yolo auto 代确认（blanket 授权 · 三路评审两轮全真跑）。
