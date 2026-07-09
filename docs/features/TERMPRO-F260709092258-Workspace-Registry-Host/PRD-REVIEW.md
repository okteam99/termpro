---
prd_feature_id: TERMPRO-F260709092258-Workspace-Registry-Host
review_round: 3
review_started_at: "2026-07-09T09:30:00Z"
review_completed_at: "2026-07-09T12:10:00Z"
reviewers: [qa, architect, pl]
verdicts: {qa: APPROVE, architect: APPROVE, pl: APPROVE}
reviews:
  - role: qa
    review_scope: prd
    execution: subagent
    verdict: APPROVE
    started_at: "2026-07-09T09:30:00Z"
    completed_at: "2026-07-09T09:35:00Z"
    files_read: [PRD.md, WS-01-remote-host.md, ROADMAP.md, store.ts, persistence.ts, protocol.ts, host.ts, App.tsx, appStore.ts, hostClient.ts]
    findings:
      - id: QA-1
        severity: low
        description: "PRD 引 App.tsx:66 作 hydrate 时序证据,但该行是 smoke 专用路径;真实证据是 App.tsx:55-60 的 initPersistence gate。"
        suggestion: "改引 App.tsx:55-60。"
        category: technical-consistency
        code_evidence:
          file_path: "src/renderer/App.tsx"
          line_range: "54-67"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:也许 :66 虽是 smoke 路径但仍能证明「host 先于 store 可用」?回读 App.tsx 54-67:该分支只在 window.termpro.smoke 为真时执行,正常启动根本不进入,拿它当时序证据确属引证错误;55-60 的 useEffect 才是真实 gate。质疑不成立,采纳。
          rationale: "v0.2 §开工前·隐藏前提① 改引 App.tsx:55-60 并显式注明 :66 为 smoke 专用。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: QA-2
        severity: low
        description: "AC-4 的『下次启动自动重试』未界定持续失败时的出口,用户可能无限停在只读模式。"
        suggestion: "有界重试或手动重试/诊断出口。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:失败是极小概率事件,加出口是否过度设计?结合 ARCH-4 重审:问题根源是「只读模式」本身制造了降级面;改为「继续用 v1 全功能 + 重试 + 连续 3 次失败才提示」后,用户永不丢功能,出口天然存在。质疑部分成立(不该修补只读,而该消灭只读),按更简方案采纳。
          rationale: "v0.2 AC-4 重设计:失败继续 v1 全功能、下次启动重试、连续 3 次失败经既有通知提示(不阻塞使用)。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: QA-3
        severity: info
        description: "AC-1 未点名 N=0 / 无存档的全新安装边界。"
        suggestion: "Blueprint TC 显式覆盖。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:N=0 是否平凡到不值得写进 AC?但迁移幂等标记恰在「无存档」路径最易出错(标记写到哪?),PRD 层点一句成本为零且给 TC 明确入口。质疑不成立,采纳。
          rationale: "v0.2 AC-1 改为『N≥0,含 N=0 与无存档全新安装』。"
          responded_at: "2026-07-09T10:00:00Z"
  - role: architect
    review_scope: prd
    execution: subagent
    verdict: NEEDS_REVISION
    started_at: "2026-07-09T09:30:00Z"
    completed_at: "2026-07-09T09:40:00Z"
    files_read: [PRD.md, WS-01-remote-host.md, ROADMAP.md, 业务架构与产品规划.md, ARCHITECTURE.md, protocol.ts, host.ts, store.ts, persistence.ts, hostClient.ts, appStore.ts]
    findings:
      - id: ARCH-1
        severity: high
        description: "迁移执行层未指派;若 Host 读 v1 存档(Electron 专属路径)将破坏 Host 零 Electron 红线。"
        suggestion: "迁移 reader 归壳层,壳驱动 workspace.create;Host 只做注册表 CRUD。"
        category: technical-consistency
        code_evidence:
          file_path: "src/main/appStore.ts"
          line_range: "13-15"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:能否让 Host 经 fork 参数拿到 v1 存档路径,由 Host 迁移更原子?回读 appStore.ts:13(app.getPath('userData'))与 host.ts:1-2(零 Electron 宣言):传路径虽可行,但会让通用 Host 认识「桌面 UI 的存档格式」,远程 host 场景该知识毫无意义且成耦合债;壳层驱动 + 逐条 create 在注册表侧幂等即可原子。质疑不成立,采纳壳层方案。
          rationale: "v0.2 §背景新增『迁移执行层边界』段:壳读 v1、经 workspace.create 写入;AC-1 加『壳层驱动迁移』。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: ARCH-2
        severity: medium
        description: "name/root 双写漂移:UI 防抖写回若仍持久化 name/root 将与 Host 注册表两写者分叉。"
        suggestion: "v2 存档 PersistedWorkspace 去 name/root,只留 workspaceId 外键 + 视图态。"
        category: technical-consistency
        code_evidence:
          file_path: "src/renderer/state/store.ts"
          line_range: "66-72"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:保留 name/root 当离线缓存是否更好(host 未就绪时可先渲染)?回读 persistence.ts:36-47:写回是防抖自动的,缓存必然变第二写者;离线渲染需求属 BL-005 断线场景,本地嵌入式 host 与 UI 同生命周期,不存在该窗口。质疑不成立,采纳。
          rationale: "v0.2 AC-5 明确 v2 去 name/root 只留外键,name/root 单源 = Host 注册表。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: ARCH-3
        severity: medium
        description: "排序(moveWorkspace)/activeWorkspaceId/孤儿 tab 的层归属未指派,模型 A 多客户端下 load-bearing。"
        suggestion: "排序+activeWorkspaceId 留 per-client 视图态;孤儿引用 hydrate 丢弃。"
        category: business-alignment
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:排序是否该进注册表共享(mobile 上看到同样顺序更一致)?但注册表共享排序意味着任一端拖拽影响所有端,与「视图态属客户端」的边界冲突,且 mobile 需求未定,先共享是过度设计。质疑不成立,按 per-client 采纳;孤儿丢弃是唯一不悬空的选择。
          rationale: "v0.2 AC-5 补排序/activeWorkspaceId 留 UI + 孤儿引用静默丢弃。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: ARCH-4
        severity: medium
        description: "镀金:AC-3 双客户端集成 P0 但本地无第二消费客户端;AC-4 只读模式是新 Sidebar 交互面,与『外观不变』自相矛盾。"
        suggestion: "AC-3 集成验证降 P1(事件单测足够);失败路径简化为『继续 v1 + 重试』。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:降级 AC-3 会不会让 BL-004 接手时发现推送根本没验过?回读判据:事件触发单测(P0 保留在 AC-3 文内)已锁协议契约,双客户端 harness 是集成信心,P1 不砍只降;只读模式确与 §Out of Scope『Sidebar 交互不变』直接矛盾,是我起草时的自相矛盾,必须采纳消灭。
          rationale: "v0.2 AC-3 降 P1(单测 P0/集成 P1 分层写明);AC-4 重设计为继续 v1 全功能(连带解 ARCH-5/QA-2)。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: ARCH-5
        severity: low
        description: "requires_ui:false 与 AC-4 的迁移失败提示(新 UI 面)冲突。"
        suggestion: "翻 flag 或把提示收窄为非设计面。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:提示是否根本不需要(静默重试即可)?QA-2 已证持续失败需要用户可见出口,不能全静默;AC-4 重设计后提示复用既有通知中心机制,零新组件零新布局,requires_ui=false 成立但须写明依据。质疑不成立,按『收窄为非设计面』采纳。
          rationale: "v0.2 Out of Scope 注明『提示复用既有通知机制,无新 UI 设计面,故 requires_ui=false』。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: ARCH-6
        severity: low
        description: "workspace:changed 应指明全量快照推送,防 blueprint 造增量 patch 协议。"
        suggestion: "PRD 写明 simple default。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:PRD 写线格式是否越界到 TECH?这条是防过度设计的方向性约束(注册表就几条记录,增量协议纯负担),一句话锁方向属产品级简洁性裁决,不是 schema 设计。质疑不成立,采纳。
          rationale: "v0.2 AC-3 写明『全量列表快照,非增量』。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: ARCH-7
        severity: low
        description: "注册表数据目录需可注入(Host 不能调 app.getPath),否则零 Electron 单测不可达。"
        suggestion: "PRD 一句注入约定。"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/host.ts"
          line_range: "5"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:os.homedir() 下固定路径是否更简单?可行但把路径约定焊死在 Host 内,单测/多实例(并行测试)互踩;fork 参数/env 注入成本一样低且可测。质疑不成立,采纳。
          rationale: "v0.2 §开工前·隐藏前提③ 写明数据目录可注入(fork 参数/env,单测用临时目录)。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: ARCH-8
        severity: low
        description: "与 BL-002 的真实同改行是 HostMessage union(workspace:changed 新成员),RpcMethods 各自追加不冲突。"
        suggestion: "确认 BL-002 不加 HostMessage 事件,细化协调注记。"
        category: technical-consistency
        code_evidence:
          file_path: "src/shared/protocol.ts"
          line_range: "142-149"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:这条是否过细(本来就有『先合先赢』)?但笼统的『分区块追加』正是漏掉 union 单行冲突的原因,点名具体行让 rebase 者有明确靶子;并同步核对 BL-002 v0.2——其握手复用 host.info 不加 HostMessage 成员,冲突面确认最小。质疑不成立,采纳。
          rationale: "v0.2 §开工前·涟漪 点名 HostMessage union 为共享行 + PROTOCOL_VERSION 策略归 BL-002。"
          responded_at: "2026-07-09T10:00:00Z"
  - role: pl
    review_scope: prd
    execution: subagent
    verdict: NEEDS_REVISION
    started_at: "2026-07-09T09:30:00Z"
    completed_at: "2026-07-09T09:45:00Z"
    files_read: [PRD.md, WS-01-remote-host.md, ROADMAP.md, 业务架构与产品规划.md, KNOWLEDGE.md, App.tsx, store.ts, protocol.ts, index.tsx, host.ts, main.ts]
    findings:
      - id: PL-CHALLENGE-1
        severity: medium
        description: "零即时用户价值却背 R4 迁移风险,『现在做 vs 与 S4 一起做』的时序取舍未留痕。"
        suggestion: "背景补一句可追溯的取舍理由。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:WS-01 已写了解耦理由,PRD 复述是否冗余?但 PRD 是 feature 单点的自足文档,评审者/执行者不必回翻 WS 才能理解「为什么现在」;且「越晚迁移存量纠缠越多」这层理由 WS 未写。质疑不成立,采纳。
          rationale: "v0.2 §背景补『为什么现在做』三点(解耦/接口权威先行/越晚越难)+ 自认零即时价值是有意识取舍。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: PL-CHALLENGE-2
        severity: high
        description: "跨客户端删除 workspace 时本地存活 tab/PTY 的回收语义是全新行为分支,不在任何 AC 也不在 Out of Scope(BL-005 是断线场景,非此)。"
        suggestion: "补 AC 或显式排除并写兜底。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:本地现实中只有一个 workspace 消费客户端,该分支是否是为不存在的场景加 AC(过度设计)?回读 store.ts removeWorkspace(本地同步 dispose)与 AC-3 的多客户端契约:一旦推送存在,「收到远端删除」就是协议消费者必答题,不答 = 留给 BL-004 现场发明,孤儿 PTY 风险真实。质疑不成立,采纳为 P1 AC(与 AC-3 同 harness 验证,成本边际)。
          rationale: "v0.2 新增 AC-6(远端删除 → 本地 dispose 全部 tab/PTY + 视图移除 + 活跃切换);Out of Scope 注明与 BL-005 的区分。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: PL-CHALLENGE-3
        severity: medium
        description: "日常增删改从『本地必成功』变『可失败 RPC』,UI 反馈语义(乐观 vs 确认)是静默的行为契约变化,未列决策。"
        suggestion: "显式决策并规定失败提示。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:本地 RPC 毫秒级几乎不失败,是否小题大做?但「几乎不失败」正是现状假设,迁移后磁盘满/host 异常是真实分支;不定语义则实现者随手选乐观更新,失败回滚的复杂度反而更高。质疑不成立,采纳并由 PM 裁决为等待确认式(低频操作简单正确优先)。
          rationale: "v0.2 §待决策项 D-1 记录裁决(等待确认);AC-2 写入失败语义。"
          responded_at: "2026-07-09T10:00:00Z"
      - id: PL-CHALLENGE-4
        severity: low
        description: "原 AC-6(零 Electron + roundtrip 单测)是工程约束不是产品行为验收,混在 PRD AC 层不干净。"
        suggestion: "移入 TECH.md。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:零 Electron 是架构红线,从 PRD 撤掉会不会丢失约束力?不会——它已由 ARCHITECTURE.md 全局红线 + blueprint TECH 工程约束双重承载,PRD 的 AC 层留它反而稀释行为契约;撤 AC 不等于撤约束。质疑不成立,采纳(v0.2 §开工前·隐藏前提③ 仍保留可注入/可单测的设计约束句)。
          rationale: "v0.2 删除原 AC-6,槽位由跨客户端删除语义(新 AC-6)使用;零 Electron 约束移交 blueprint TECH。"
          responded_at: "2026-07-09T10:00:00Z"
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-07-09T12:10:00Z"
---

# PRD-REVIEW（TERMPRO-F260709092258-Workspace-Registry-Host）Round 1

冷审三方(隔离 subagent):QA=APPROVE(3 advisory) · Architect=NEEDS_REVISION(8) · PL=NEEDS_REVISION(4 · 含 PL-CHALLENGE 段)。
PM 全部 15 条逐条对抗自查后 ADOPT(其中 QA-2/ARCH-4 以「消灭只读模式」的更简方案合并采纳;PL-4 采纳但保留约束移交 TECH 的路径)· PRD 修订至 v0.2。

## PL-CHALLENGE 段(六问结论)

① 价值前提:成立但零即时价值,取舍已留痕(PL-1→v0.2 背景)。② 问题定义:真问题(Q-002 用户已拍板),用户故事已注明价值由下游兑现。③ 范围最小化:原 AC-6 移 TECH;AC-3 降 P1。④ 上游对齐:与 WS-01-S1/BL-001/Q-002 对应良好;「renderer 按 host 发现」隐含于 AC-1/AC-3。⑤ 复活检查:无(KNOWLEDGE OS-001~005 不相关;更正:KNOWLEDGE 非空骨架)。⑥ 既有行为变更:两处已显式化(D-1 失败语义裁决 + AC-6 新分支)。

## 整合结论(Round 1)

- overall_verdict: NEEDS_REVISION → PRD 已修订 v0.2
- next_round_required: true → Round 2 验证模式(重派冷 Agent 核实 fix + 找新)

---

# Round 2(验证模式 · 重派冷 Agent)

Round 1 全部 15 条 **VERIFIED-FIXED**(Arch 8/8 · PL 4/4;QA R1 即 APPROVE 免复验)。新 finding 8 条,PM 全部 ADOPT → PRD 修订 v0.3:

### architect(R2)· verdict: NEEDS_REVISION → 处置

- **ARCH-R2-1(med)** 远端新增 workspace 的镜像方向未指派(合成默认视图/不抢激活/排序落点)。PM 对抗自查:质疑「本地无第二客户端,是否为不存在场景设计」——但 AC-3 推送契约一旦存在,增/删两方向必须对称闭合,否则 BL-004 现场发明。ADOPT → v0.3 AC-3 协调算法「新增 id → 合成默认视图(单 root tab · 不改本端 activeWorkspaceId · 排序末尾)」。
- **ARCH-R2-2(med)** 「v2 后不再写 name/root」与 AC-4「v1 全功能 fallback」措辞张力,双模式须显性化。PM 自查:回读 persistence.ts:32-54 确认 serialize 现无条件写 name/root,若照涟漪句删除写路径则 AC-4 失败分支破坏——真问题。ADOPT → v0.3 涟漪限定「v2 模式下」+ AC-4 写明 persistence 双模式以迁移标记为闸。
- **ARCH-R2-3(low)** 通知机制「零新组件」主张与 NotificationItem(tab 作用域必填字段)不符。与 PL-R2-3 同源,ADOPT → v0.3 AC-4 改「非 tab 级轻量一次性提示,最小扩展或独立路径归 TECH」,Out of Scope 依据句诚实化。
- **ARCH-R2-4(low)** AC-3 机读 P1 与正文 P0 不一致。ADOPT → v0.3 AC-3 整条升回 P0(协调契约是 BL-004 接口权威,载重升级;集成用例归 TC P1)。
- **ARCH-R2-5(low)** 迁移保留原 workspace id 的载重前提未写死。ADOPT → v0.3 AC-1 写明「保留原 workspace id(幂等键+外键连续性单源)」。

### pl(R2)· verdict: NEEDS_REVISION → 处置

- **PL-CHALLENGE-R2-1(high)** AC-3「替换本地列表」按字面会清空未变更 workspace 的视图态,与 AC-5/AC-6 互斥。PM 自查:steelman「替换」写法(全量快照本意即整体替换)——但被替换对象是含视图态的 WorkspaceState 而快照只有定义字段,字面实现必丢数据,矛盾真实且比 R1 原问题更重。ADOPT → v0.3 AC-3 改写为按 id 协调算法(与 ARCH-R2-1 合并成一条对称契约)。
- **PL-CHALLENGE-R2-2(med)** 等待窗口防重复提交未答。ADOPT → v0.3 AC-2 补「RPC 等待期间操作入口防重复提交(禁用或幂等去重)」。
- **PL-CHALLENGE-R2-3(med)** 通知数据模型装不下 CRUD 失败提示且点击导航会踩空。与 ARCH-R2-3 同源 ADOPT(处置见上)。

overall_verdict(R2): NEEDS_REVISION → PRD v0.3 · next_round_required: true → Round 3 验证

---

# Round 3(验证模式 · 收敛)

- **architect: APPROVE** — R2 五条全 VERIFIED-FIXED(AC-3 三分支协调与 AC-5/AC-6 交叉一致 · 双模式闸 · 提示诚实化 · 机读 P0 一致 · id 保留)。advisory 留档:ARCH-R3-1(requires_ui 边界判断可辩护 · TECH 定提示路径时确认是否需 Designer 过目)· ARCH-R3-2(迁移完成标记须单源设计)。
- **pl: APPROVE**(含 D-1 补修复验)— R2 三条终态全 VERIFIED-FIXED;NOT-FIXED 半边(D-1 仍写「复用既有通知机制」与 AC-4 矛盾)由 PM 补修对齐后复验通过。advisory 留档:PL-CHALLENGE-R3-1(自发起变更的回声推送 vs 他端推送:创建方「新建即选中」需 blueprint 显式界定路径)。
- **qa: APPROVE**(R1 即 APPROVE · 免复验)。

**收敛:verdicts 全 APPROVE · PRD 定稿 v0.3(含 D-1 补修)· 交付 blueprint 的 advisory 清单:ARCH-R3-1/R3-2 · PL-R3-1。**

> 用户已确认 PRD v0.3(2026-07-09 · 选项 1)· status→confirmed · business_direction_locked→true
