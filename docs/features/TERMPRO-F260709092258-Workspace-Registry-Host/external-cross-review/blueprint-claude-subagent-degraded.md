---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "localconfig disable_external_review=true(单模型 · 异质评审降级为同模型 exec 自审 · 已 startup WARN)"
review_via: subagent
perspective: external-claude
target: blueprint
generated_at: "2026-07-09T13:22:00Z"
verdict: approve_with_conditions
files_read:
  - docs/features/TERMPRO-F260709092258-Workspace-Registry-Host/external-review-prompts/blueprint-claude-subagent-20260709T131510Z.md (含 inline TC.md + TECH.md)
  - docs/features/TERMPRO-F260709092258-Workspace-Registry-Host/PRD.md (仅 AC 定义核对 · 未读 PRD-REVIEW)
  - src/shared/protocol.ts
  - src/host/host.ts
  - src/renderer/state/store.ts
  - src/renderer/state/persistence.ts
  - src/renderer/services/hostClient.ts
  - src/main/main.ts
  - src/main/appStore.ts
  - src/renderer/App.tsx
  - src/renderer/index.tsx
  - src/renderer/components/Sidebar.tsx
model: "claude-opus (subagent · degraded same-model self-review)"
findings:
  - id: CR-1
    checklist: C6
    severity: high
    location: "TECH.md §错误处理(『失败计数+1』/『连续3次失败』) vs §数据结构 PersistedState;TC.md MIG-009"
    issue: "迁移『失败计数』无持久化落点:PersistedState(v1/v2)只有 version/activeWorkspaceId/workspaces/ui,没有失败计数字段;而迁移每次启动只跑一次、失败『下次启动重试』(MIG-008),要达到『连续3次』必须跨启动累计。"
    rationale: "迁移完成标记单源=存档 version(1|2),失败计数是独立状态且必须跨进程重启存活并在成功时清零;TECH 定义了标记单源却未给失败计数定义存储位置,MIG-009(P1)按现设计不可实现。in-memory 计数每次启动归零,永远到不了 3。"
    suggestion: "在 PersistedState 顶层(或独立小文件)显式加 migrationFailureCount 字段并规定:每次迁移失败 +1、成功或翻 v2 时清零、跨越阈值 3 那次触发一次 transient toast、之后启动仍重试但去重不再提示;同步在 §数据结构表与 MIG-009 断言里补上该字段的读写与清零时机。"
  - id: CR-2
    checklist: C5
    severity: high
    location: "TECH.md §实现思路 步骤3(『原子写+写穿回滚』) / §风险表『写穿回滚』;host.ts:103 `void handleRpc`;TC.md REG-008 + INT-001..004"
    issue: "注册表是 host 首个有状态『读-改-写单 JSON 文件』的 RPC,但 TECH 只规定单次写的『原子写+写穿回滚』,未规定并发写的序列化机制与临时文件命名。host 现有 dispatch 是 fire-and-forget(`void handleRpc`)并发执行,多客户端广播设计+REG-008(并发同 id create)使并发 mutate 可达。"
    rationale: "两个并发 create/update/remove 会在 `await persist()` 处交错:若临时文件名固定(如 workspaces.json.tmp)两次写会互相截断;若各自快照落盘则丢更新(A 写[.,A]、B 写[.,B]→A 丢)。REG-008 是 P0 却依赖『内存 upsert 同步先于 await + 唯一临时名/写队列』这一未在 TECH 明写的实现细节,存在 P0 测试不稳过与工作区静默消失/改名丢失的正确性风险(本地虽单主窗口写、但 REG-008 直测注册表且 create+remove 跨操作仍可交错)。"
    suggestion: "在 TECH §实现思路/§风险表显式补一条:注册表持有单一 in-memory 数组作唯一真相、mutate 同步先行再 await 持久化;持久化用 per-registry 串行写队列(或 mutex)+ 唯一临时文件名(如 `.tmp-<pid>-<seq>`)再 rename;并在 REG-008 断言里锁定『并发后 list 仍为单条且内存/盘一致』。"
  - id: CR-3
    checklist: C2
    severity: low
    location: "TC.md REGR-004(fe-e2e·P0·file=src/main/main.ts) 第二 Then 子句;main.ts:276-286 冒烟分支;App.tsx:28-33 onFirstData→smokeOk"
    issue: "REGR-004 的第二 Then『Sidebar workspace 列表来源可追溯到 Host 注册表而非仅 UI 存档』当前冒烟 harness 不可验证:现冒烟只在首个终端数据到达时打印 SMOKE_OK,没有任何针对『列表来源=注册表』的断言,TC 自身用『若冒烟路径附带断言』做了免责对冲。"
    rationale: "如此 REGR-004(挂 AC-1 的 P0)实质退化为『冒烟仍通过』,其对 AC-1『列表来自 Host 注册表』的正向证明为零,真正的端到端证明落在 REGR-005(integration·P1)。P0 用例名义覆盖强于实际覆盖。"
    suggestion: "要么把 REGR-004 第二 Then 明确降为 non-blocking 观察项(改写为『冒烟不因本改动超时/报错』单一断言),把 AC-1 端到端强断言权重显式归给 REGR-005;要么给冒烟分支补一条可断言钩子(如 hydrate 后把 workspace 数量/来源标记 console 输出供 smoke 抓取)。避免 P0 名实不符。"
  - id: CR-4
    checklist: C6
    severity: low
    location: "TECH.md §时序图(hydrate 合并 v2 外键) / reconcileWorkspaces 三分支;TC.md 分层6 无对应用例;对照 COORD-001/INT-001"
    issue: "hydrate 路径缺一条『Host 注册表存在某 id 但本地 v2 存档无对应视图态 → 合成默认视图』的直测用例。COORD-001/INT-001 覆盖的是 workspace:changed 推送路径的合成,REGR-001 只测『存档里有的 tab 被保留』,REGR-002 只测孤儿丢弃。"
    rationale: "模型 A 注册表按机器共享,冷启动 hydrate 时注册表可能含本 UI 存档从未见过的条目(未来 BL-004/多客户端场景),这条『注册表有、存档无 → 默认视图』的 hydrate 合并分支是与孤儿丢弃对称的另一半,却无专用 TC;推送路径的 COORD-001 不能替代冷 hydrate 路径(两者代码入口不同)。"
    suggestion: "在分层6补一条 hydrate 单测:注册表返回[w1,w2]、v2 存档只含 w1 视图态 → hydrate 后 w2 出现且为单 root tab 默认视图、w1 视图态保留。本地先行阶段可标 P2,但应显式登记以免 BL-004 现场重新发明。"
  - id: CR-5
    checklist: C1
    severity: low
    location: "TC.md frontmatter REG-009 covers_ac:[AC-4] 与 REG-008 covers_ac:[AC-1];TC.md §补充洞察(自述 REG-009 与 AC-4 为『间接关联』)"
    issue: "两处 AC 映射偏松:REG-009(损坏注册表文件不崩溃)映射 AC-4,但其本质是注册表自身健壮性而非 AC-4 定义的『迁移失败 fallback』路径(TC 补充洞察已自认『不是 AC-4 定义的迁移失败路径』);REG-008(并发同 id create)映射 AC-1(迁移幂等),但并发写属通用注册表正确性,与迁移语义正交。"
    rationale: "AC↔TC 映射应反映真实因果覆盖:把注册表健壮性/并发正确性挂到迁移 AC 上,会让 AC-4/AC-1 的覆盖矩阵看起来比实际更满,掩盖『注册表健壮性/并发』本身缺独立 AC 归属的事实(它们其实支撑 AC-2『重启一致』与整体地基稳健)。"
    suggestion: "REG-009 归为支撑性/robustness 用例并在矩阵注明『间接支撑 AC-4 重试底线』;REG-008 移挂 AC-2(或标记为跨 AC 的注册表不变式);保持覆盖矩阵百分比诚实,不影响用例本身保留。"
  - id: CR-6
    checklist: C5
    severity: info
    location: "TECH.md §前端技术方案 transient toast(`transientNotice: string|null` + setTimeout 自动清空)"
    issue: "单值 transientNotice + setTimeout 自动清空在『短时间内连续多次失败』下有覆盖/提前清空隐患:第二次 setTransientNotice 覆盖第一条文案,而先前 setTimeout 仍在计时,可能提前清掉第二条消息或串扰。"
    rationale: "AC-2 CRUD 失败与 AC-4 迁移失败都走同一 transient 路径,批量迁移逐条失败或用户连点失败会触发多次;单字段+裸 setTimeout 缺 timer 句柄管理时行为不确定。属实现细节而非契约缺陷,故 info。"
    suggestion: "实现时保存并在每次 setTransientNotice 清除上一个 timer 句柄(或用带 nonce 的清除守卫),保证『最后一条消息完整存活其时长』;在 §前端技术方案补一句 timer 生命周期约束即可,无需改 requires_ui。"
findings_summary:
  blocker: 0
  high: 2
  low: 3
  info: 1
  total: 6
---

# Blueprint 冷审（降级 · 同模型 exec 自审）— Workspace 注册表驻留 Host

> ⚠️ **降级声明**：localconfig `disable_external_review=true`，异质外部评审不可用，本轮为**同模型 subagent exec 自审**（启动已 WARN）。独立性弱于真异质评审：本报告可作盲区采样，但**不构成异质交叉验证信号**，主对话应据此调低对该评审独立性的权重。评审严格遵守只读约束——未读 PRD-REVIEW / TC-REVIEW / TECH-REVIEW / discuss/* / 任何 review-*/pmo-internal 产物；仅读 inline 的 TC/TECH、PRD 的 AC 定义、以及 worktree 内真实生产代码用于 grounding。

## Verdict：APPROVE_WITH_CONDITIONS（有条件通过）

蓝图整体**方向正确、grounded 扎实、边界/失败覆盖优秀**（44 条用例中边界+异常型约 28 条，非成功占比约 64%，远超 C3 的 30% 底线；TC↔AC 六条 AC 均有 ≥3 条覆盖、无 phantom AC；TECH 的 simple-default 逐条取舍与 YAGNI 拒绝理由充分，与 ARCHITECTURE『UI 壳 ↔ Host / host 零 Electron』红线一致——已亲验 host.ts 仅 import os、fork 处 argv/env 空置可注入、initPersistence 单主窗口 gate 于 host 就绪后）。

放行**前提**是解决 2 条 high：
1. **CR-1（迁移失败计数无持久化落点）** — MIG-009(P1) 按现设计不可实现，需在 schema 显式加 `migrationFailureCount` 并定义 +1/清零/去重时机。
2. **CR-2（并发注册表写序列化未规定）** — REG-008(P0) 依赖 TECH 未明写的实现细节；需补『单内存数组 + 同步 upsert 先行 + 串行写队列/唯一临时名』。

3 条 low + 1 条 info 属映射诚实化与实现细节收口，可在 dev 阶段带走，不阻塞进入实现。

## 逐项 checklist 结论

- **C1 TC↔AC 映射完整性**：✅ 六 AC 全覆盖、每 AC ≥3 用例、无引用不存在的 AC（已对 PRD.md AC-1..AC-6 亲验）。瑕疵：两处映射偏松（CR-5，low）。
- **C2 TC 可执行性**：基本 ✅，Gherkin 前置/期望具体。唯 REGR-004 第二 Then 子句在现冒烟 harness 下不可验证、以免责句对冲（CR-3，low）。
- **C3 边界与失败用例**：✅ 强。非成功占比 ~64%；并发(REG-008)/损坏文件(REG-009)/超时(hostClient 15s→CRUD RPC 失败)/降级(v1 fallback)/远端删除回收(AC-6) 均有 TC。
- **C4 TECH 架构一致性**：✅ 与既有模式一致（RpcMethods 追加、HostMessage union 单行加成员、hostClient handle switch 照 onFsChanged 范式、host 零 Electron）。无未记录的新依赖（沿用 node builtin + zustand）。PROTOCOL_VERSION 不 bump 且能力探测推给 BL-002——本地范围可接受，属显式 defer。
- **C5 TECH 可行性与风险**：主要风险点在**并发写序列化（CR-2, high）**与**失败计数持久化（CR-1, high）**;其余（迁移期防抖竞态、v2 不可逆降级、广播必先持久化）TECH 已识别并给缓解。transient toast timer 生命周期需收口（CR-6, info）。
- **C6 TC↔TECH 对齐**：TECH 关键接口（4 RPC + workspace:changed + reconcile 三分支 + 迁移器）均有对应 TC。缺口：hydrate 路径『注册表有、存档无 → 合成默认视图』分支无专用 TC（CR-4, low）；失败计数行为在 TC(MIG-009) 与 TECH schema 之间不对齐（CR-1, high）。

## 补充观察（非 finding · 供主对话参考）

- **正确性亮点**：TECH『先持久化成功再广播 + 写穿回滚不广播』把『广播快照 = 已落盘状态』锁死，避免客户端渲染盘上不存在的 workspace——这条隐性不变式抓得准。
- **PL-R3-1 收敛论证扎实**：create RPC 应答驱动激活 + 回声按 id 幂等 upsert，无论应答/回声孰先到终态一致，COORD-011 作兜底不变式，设计与用例自洽。
- **smoke 回归提醒已自列**（TECH 补充洞察#4）：addWorkspace 变异步后冒烟依赖 `TERMPRO_HOST_DATA_DIR` 在 `os.tmpdir()/termpro-smoke` 可写——已亲验 main.ts:40-42 冒烟确实改写 userData 到该路径，注入锚点(main.ts:119 fork)与之兼容，方向可行。
