---
prd_feature_id: TERMPRO-F260613152432-Terminal-File-Link-Open
review_round: 2
review_started_at: "2026-06-13T15:40:00Z"
review_completed_at: "2026-06-13T15:52:00Z"
reviewers: [qa, architect]
verdicts: {qa: APPROVE, architect: APPROVE}
reviews:
  - role: qa
    review_scope: prd
    execution: subagent
    verdict: APPROVE   # Round 2 verification flipped from Round-1 NEEDS_REVISION
    started_at: "2026-06-13T15:40:00Z"
    completed_at: "2026-06-13T15:52:00Z"
    files_read:
      - PRD.md
      - src/renderer/terminal/terminalLinks.ts
      - src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    findings:
      - id: QA-1
        severity: high
        category: technical-consistency
        description: "既有测试 terminalLinkFilePanelRouting.test.ts:60-73 断言根内 .zip locate 成功时『只定位不打开』,与新 AC-3(文件直接打开)冲突,实现后必失败,而 AC 未指示更新该测试。"
        suggestion: "AC-3 显式声明该测试无效,须改为断言媒体文件直接 openPath。"
        code_evidence:
          file_path: "src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts"
          line_range: "60-73"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑(ADOPT 前找反方):这条会不会是 false positive——也许该测试针对的是 openTargetInFilePanelFirst 这个旧入口,新实现可能换函数名,旧测试自然作废无需 PRD 提?
            回读 terminalLinkFilePanelRouting.test.ts:60-73 确认:该 case 明确 mock locate handler 返回 true 后断言 openPath/openViewerWindow 均 not called(= 只定位)。新行为下根内 .zip 必须直接 openPath。无论实现入口怎么命名,这条断言的语义与新 AC-3 直接矛盾,留着必红或被静默删却无痕。故质疑不成立——确为真 gap,AC-3 点名要求更新是对的。
          rationale: "已在 AC-3 frontmatter + 验收表加『并同步更新断言旧只定位行为的既有测试(点名 keeps repository system-open extensions location-only when locate succeeds)』,给 TC 作者确定性指令。"
          responded_at: "2026-06-13T15:45:00Z"
      - id: QA-2
        severity: high
        category: technical-consistency
        description: "activate 复用 hover 时 statCache(5s TTL)的 kind;文件在 hover 后点击前被删,kind 仍为 file → openViewerWindow 打开已不存在路径。PRD 仅说『resolves to an existing file』,无 AC/范围声明。"
        suggestion: "加 AC 或显式 out-of-scope:激活时重校验 OR 文档化 viewer/系统打开对缺失文件的现状处理。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:是否过度反应——这是本次新引入的风险吗?
            回读 terminalLinks.ts:225-238(stat 缓存 5s)+ 旧 activate:旧代码同样用缓存 kind 走 locate/fallback,同样会在已删路径上跑。Architect ARCH-2 也独立判定『pre-existing edge,本次不加重』。故不应为此新增激活时 re-stat(那才是过度设计)。正确处置=文档化:沿用 hover kind、不重 stat、缺失文件交 viewer/系统按现状处理。质疑部分成立(不该加 re-stat),但 QA 要求『给 TC 一个明确 spec』成立 → 用 OoS 文档化满足。
          rationale: "Out-of-Scope 增『不在激活时重新 stat:沿用 hover kind ≤5s,删后由 viewer/系统按现状处理(不新增重校验)』。明确 scope-out,TC 可据此写『激活不二次 stat』断言。与 ARCH-2 一致。"
          responded_at: "2026-06-13T15:45:00Z"
      - id: QA-3
        severity: high
        category: quality
        description: "AC-2『text/image→viewer / media→system』未定义边界;SYSTEM_OPEN_EXT 不含 png/jpg/svg,这些落 viewer。测试作者无法据 PRD 写边界用例。"
        suggestion: "AC-2 枚举/引用确切扩展名集合。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:把实现常量写进 PRD 是否下沉了实现细节(PRD 不该写实现)?
            回读 terminalLinks.ts:22-24 SYSTEM_OPEN_EXT 正则 + line 22 注释『图片与文本进 TermPro 文件窗口』:确认 png/jpg/svg 不在正则 → 走 viewer。但『哪些文件交系统 vs 交 viewer』是用户可感知的产品行为(打开方式不同),不是纯实现——属 AC 该定的边界。引用扩展名集合是定义可测行为,不是写实现。质疑不成立 → 采纳。
          rationale: "AC-2 锚定 SYSTEM_OPEN_EXT(列全扩展名 + 点名 png/jpg/svg→viewer),Round-2 再补常量出处供测试 import(QA-R2-2)。"
          responded_at: "2026-06-13T15:45:00Z"
      - id: QA-4
        severity: medium
        category: quality
        description: ":line:col 文件应以 stripped 路径打开,需测试核实闭包内 hit.abs 是 stripped 路径。"
        suggestion: "加 TC:候选 /repo/src/App.tsx:42:10 → 断言 openViewerWindow 收 {mode:file, path:/repo/src/App.tsx}。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:这要不要进 PRD AC?
            回读 terminalLinks.ts:249(stripLineCol 在 256 stat 之前)+ resolveCandidateText 返回 hit.abs=stripped:行为已正确,AC-4 也已规定『:line:col 用 stripped 路径打开不声明行跳转』。这是『要一条测试』,测试用例归 blueprint_lite TC,不是 PRD 缺陷。质疑成立 → 不改 PRD,路由 TC。
          rationale: "AC-4 已规定行为;具体 TC 在 blueprint_lite 由 QA 写(test_refs 届时回填)。"
          responded_at: "2026-06-13T15:45:00Z"
      - id: QA-5
        severity: medium
        category: quality
        description: "缺『目录 locate 成功 → 不走 fallback』正向测试,防新路由误把目录送进直接 open。"
        suggestion: "加 TC:dir + handler 返回 true → openPath/openViewerWindow 均 not called。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:AC-1 是否已隐含?回读 AC-1『目录维持 File-Panel-first 不变』+ 现有测试只覆盖 locate=false 分支。正向(locate=true 不 fallback)确无显式守护,且本次改路由确有误伤目录分支的风险 → finding 成立。但归属是 TC(测试用例),非 PRD 文字。
          rationale: "路由到 blueprint_lite TC(覆盖目录 locate-success 正向 + 目录不被误送 open)。AC-1 已规定行为。"
          responded_at: "2026-06-13T15:45:00Z"
      - id: QA-6
        severity: medium
        category: quality
        description: "缺『根内文件 → 直接 openViewerWindow 不走 locate』测试(本 feature 核心还原点),无测试则未来回退不可见。"
        suggestion: "加 TC:根内 file 路径 + 已注册 handler → handler NOT called,openViewerWindow called。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:无。这是本 feature 最核心的回归守护(in-root file 不再 locate-only),QA 指出它缺测试 = 真 gap。回读现有测试集确无此正向 case。
            归属 TC(blueprint_lite),AC-3 已规定行为。这条优先级最高,blueprint_lite 必须落。
          rationale: "路由 TC,标注为 blueprint_lite 必落的核心回归用例(根内 file → 不调 locate handler + openViewerWindow called)。AC-3 已规定。"
          responded_at: "2026-06-13T15:45:00Z"
      - id: QA-7
        severity: low
        category: business-decision
        description: "DEC-1(open + 同时定位?)未决,business_direction_locked=false,若选 B 则路由大改,现在写的覆盖可能作废。"
        suggestion: "RD 启动前锁 DEC-1,或加 option B 的 AC 桩。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:DEC-1 真有必要现在锁吗?用户原话『明确是单个存在的文件,需要尝试直接打开』字面只要『打开』,B(还顺带定位)是额外。
            但 QA 对(若 dev 后才定 B,TC 返工)→ 应在进 blueprint_lite 前闭合。处置:§8 用户最终确认时一次性 escalate DEC-1,默认 A;不预建 B 管线(ARCH-3 同向)。
          rationale: "DEC-1 给确定性默认(未指定即 A · blueprint_lite kickoff 前锁定),§8 escalate。不建 B 桩(若后续选 B 是 trivial 追加调用,延后零成本)。"
          responded_at: "2026-06-13T15:50:00Z"
      - id: QA-8
        severity: low
        category: quality
        description: "symlink 全程未提:链到文件→file 分支打开,链到目录→dir 分支定位,断链→null 不激活;均未声明。"
        suggestion: "加一行 out-of-scope 说明 symlink 跟随与断链行为。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:symlink 需要本 feature 特殊处理吗?回读 stat 经 hostClient.rpc('fs.stat') 返回 file|dir|null,默认跟随符号链接。本 feature 不改 stat 语义,symlink 行为自然继承。故无需特殊代码,只需文档化避免后续歧义。质疑(『要特殊处理』)不成立 → 仅文档化。
          rationale: "Out-of-Scope 增 symlink 说明(跟随→按 kind 走对应分支;断链→null 不激活;无特殊处理)。"
          responded_at: "2026-06-13T15:50:00Z"
      - id: QA-R2-1
        severity: low
        category: business-decision
        description: "Round-2:DEC-1 无确定性闭合路径,若 blueprint_lite 后才定 B 则 TC 返工。"
        suggestion: "给 DEC-1 默认或截止(未响应即 A)。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:已在 §8 escalate,还不够?QA 要『day-one 确定性 spec』。回读 DEC-1 原文确实只写『待用户最终确认』无默认值兜底 → 若用户 §8 回避此项,TC 作者仍悬空。加默认值消除悬空,合理。
          rationale: "DEC-1 加『用户未另指定则默认 A · blueprint_lite kickoff 前锁定』,TC 作者 day-one 有确定 spec。"
          responded_at: "2026-06-13T15:52:00Z"
      - id: QA-R2-2
        severity: low
        category: quality
        description: "Round-2:AC-2 内联了 SYSTEM_OPEN_EXT 扩展名但未指出常量出处,运行时集合演进后 PRD 列表会静默陈旧。"
        suggestion: "AC-2 注明常量定义位置,测试 import 常量而非硬编码。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:这是不是把实现位置塞进 PRD?回想 QA-3 已确立『打开方式边界 = 产品可测行为』。指明权威常量出处是让测试与单一真相同步,防 PRD 列表与代码漂移(正是 teamwork 反复强调的文档腐烂风险)。利大于弊,采纳。
          rationale: "AC-2 补『SYSTEM_OPEN_EXT 定义在 src/renderer/terminal/terminalLinks.ts,测试应 import 该常量』。"
          responded_at: "2026-06-13T15:52:00Z"
  - role: architect
    review_scope: prd
    execution: subagent
    verdict: APPROVE
    started_at: "2026-06-13T15:40:00Z"
    completed_at: "2026-06-13T15:46:00Z"
    files_read:
      - PRD.md
      - src/renderer/terminal/terminalLinks.ts
      - src/renderer/filepanel/locateRegistry.ts
      - src/preload/preload.ts
      - src/renderer/types.d.ts
      - project-specs/DEV-RULES.md
    findings:
      - id: ARCH-1
        severity: info
        category: technical-consistency
        description: "kind 分流完全可行且最简:openTargetFallback(absPath, kind) 已按扩展名正确路由文件,file 分支=直接调既有函数,dir 分支=保留 openTargetInFilePanelFirst,改动≈ activate 闭包内一行 if。"
        suggestion: "activate: () => { if (hit.kind === 'dir') openTargetInFilePanelFirst(...); else openTargetFallback(hit.abs, hit.kind); }。无 host/protocol 改动。"
        code_evidence:
          file_path: "src/renderer/terminal/terminalLinks.ts"
          line_range: "28-48, 279-281"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            ADOPT(info 确认类):质疑——是否过度乐观,真的一行就够?回读 openTargetFallback(28-34)确含 dir/媒体→openPath、文本→openViewerWindow 全分支,file 分支直接复用即可。确认可行。该实现指引转交 blueprint_lite/dev。
          rationale: "确认实现路径=renderer 单点 activate 分叉,blueprint_lite TECH-lite 据此写;无协议改动。"
          responded_at: "2026-06-13T15:46:00Z"
      - id: ARCH-2
        severity: low
        category: technical-consistency
        description: "flowchart 写『activation-time fs.stat 取 kind』,实际 kind 在 hover 解析时取(statCache ≤5s),激活不重 stat;措辞会误导实现者加多余 re-stat。"
        suggestion: "改 flowchart 首节为 hover 解析 kind,或 OoS 显式声明不加激活时 re-stat(勿加,过度设计)。"
        code_evidence:
          file_path: "src/renderer/terminal/terminalLinks.ts"
          line_range: "225-238, 256-257, 279-281"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            ADOPT:质疑——flowchart 小措辞值得改吗?回读 resolveCandidateText→stat(缓存)+ activate 闭包用 hit.kind:确认激活不再 stat。错措辞会诱导 dev 加 re-stat(= QA-2 的反向过度设计)。改措辞 + OoS 双重防呆,成本极低收益明确。采纳。
          rationale: "flowchart 首节改『使用 hover 解析的 kind · statCache ≤5s · 激活不重新 stat』+ OoS 同步声明不加 re-stat。与 QA-2 收敛到同一处置。"
          responded_at: "2026-06-13T15:46:00Z"
      - id: ARCH-3
        severity: low
        category: business-decision
        description: "DEC-1 option B(open+同时定位)相对目标(还原意图分离)是 scope creep,会让 file 分支变双动作、反糊本 feature 要恢复的意图分离。"
        suggestion: "默认 A,仅用户显式要才升 B;不预建 locate-on-file 管线。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            ADOPT:steelman B——B 能让用户既看内容又在树里知道位置,确有价值。但本 feature 的 telos 正是『把被揉死的 文件打开 与 目录定位 拆开』,B 又把它们焊回去,与目标相悖;且用户原话只要『直接打开』。A 更贴目标 + 更简。采纳默认 A。
          rationale: "DEC-1 守 A 默认,§8 仍给用户 B 选项(用户主权),但不预建管线。与 QA-7 收敛。"
          responded_at: "2026-06-13T15:46:00Z"
      - id: ARCH-4
        severity: info
        category: technical-consistency
        description: "无分层(DEV-RULES)违规:路由全在 renderer,openViewerWindow/openPath/openExternal 是 shell/window IPC 非 fs/PTY/git,存在性校验仍走 hostClient.rpc('fs.stat')。无 protocol/host 改动。"
        suggestion: "无。"
        pm_response:
          action: REJECT
          adversarial_self_check: |
            REJECT(此为 info 确认,无需动作):steelman——是否该留个 TODO?不需要,这是『确认无违规』的正向结论,无可执行项。无动作即正确响应。
          rationale: "info 确认类,无改动项。记录于此供 blueprint/review 复用结论。"
          responded_at: "2026-06-13T15:46:00Z"
      - id: ARCH-5
        severity: info
        category: technical-consistency
        description: "还原框架自洽:stat 返回 file|dir|null 互斥且完备,dir-locate / file-open 分支互斥;根内媒体(.pdf)正是 AC-3 要修的——现作 kind:file 走 file 分支经 SYSTEM_OPEN_EXT→openPath,不再降级 locate-only。"
        suggestion: "无。"
        pm_response:
          action: REJECT
          adversarial_self_check: |
            REJECT(info 确认):steelman——需要为『根内 .pdf』单列 AC 吗?AC-2+AC-3 已覆盖(媒体扩展名走 openPath + 根内文件不降级),无需新增。无动作正确。
          rationale: "info,AC-2/AC-3 已覆盖根内媒体场景,无改动。"
          responded_at: "2026-06-13T15:46:00Z"
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-06-13T15:52:00Z"
---

# PRD-REVIEW(TERMPRO-F260613152432-Terminal-File-Link-Open)

> 两轮并行隔离冷审(QA sonnet / Architect opus · 均 subagent · 不喂主对话起草心路)。Round 1:QA NEEDS_REVISION(8) + Architect APPROVE(5)。PM 整合修订 PRD v0.1→v0.2。Round 2:QA 验证模式 APPROVE(2 新 low,采纳→v0.3)。收敛:qa APPROVE / architect APPROVE。

## QA 评审段(execution: subagent · Round 1 → Round 2 验证)

verdict: APPROVE(Round-1 NEEDS_REVISION → Round-2 验证翻 APPROVE)

Round 1 八条 findings(QA-1..8)+ PM 逐条对抗式处置见 frontmatter。要点:
- **QA-1/QA-3(high · technical-consistency)**:已回读代码核实为真 → ADOPT(AC-3 点名旧测试更新 · AC-2 锚定 SYSTEM_OPEN_EXT 边界)。
- **QA-2(high)**:回读确认为 pre-existing 非本次加重(ARCH-2 同判)→ 文档化 scope-out · **不加激活时 re-stat**(避免反向过度设计)。
- **QA-4/5/6(medium · 测试覆盖)**:AC 已规定行为,测试用例归 **blueprint_lite TC** → ADOPT 路由 TC(QA-6 根内文件直接打开 = 核心回归用例,blueprint_lite 必落)。
- **QA-7/8(low)** + **QA-R2-1/2(Round 2 low)**:DEC-1 确定性默认 + symlink 文档化 + AC-2 常量出处 → 全 ADOPT。

Round 2:QA 验证 v0.2 修订全部站得住(QA-1/2/3/8 RESOLVED · QA-4/5/6 deferral 合理 · QA-7 hold 正确),新增 2 low 已采纳入 v0.3。

## Architect 评审段(execution: subagent)

verdict: APPROVE(Round 1 即 APPROVE,无阻塞)

- **ARCH-1(info)**:确认 kind 分流可行最简(activate 闭包一行 if · 复用既有 openTargetFallback · 无 host/protocol 改动)。
- **ARCH-2(low)**:flowchart 措辞误导 → ADOPT(改 hover kind + OoS 不加 re-stat · 与 QA-2 收敛)。
- **ARCH-3(low · business-decision)**:DEC-1 option B = scope creep → ADOPT 守 A 默认(与 QA-7 收敛)。
- **ARCH-4/5(info)**:确认无 DEV-RULES 分层违规 + 还原框架自洽(根内媒体经 file 分支→openPath)→ 结论留档供 blueprint/review 复用。

## 整合结论(Round 2 完成)

- overall_verdict: **APPROVE**(qa APPROVE / architect APPROVE)
- next_round_required: false
- 下一步:substep 7 needs-ui 判定(--needs-ui=false · 无新 UI 组件)→ substep 8 用户最终确认(escalate DEC-1)
