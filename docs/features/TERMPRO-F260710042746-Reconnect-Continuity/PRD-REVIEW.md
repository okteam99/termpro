---
prd_feature_id: TERMPRO-F260710042746-Reconnect-Continuity
review_round: 2
review_started_at: "2026-07-10T04:30:00Z"
review_completed_at: "2026-07-10T05:01:00Z"
reviewers: [qa, architect, pl]
verdicts: {qa: APPROVE, architect: APPROVE, pl: APPROVE}
review_via: subagent  # worktree 无 localconfig → 第三视角降级同模型 opus 隔离冷审(非异质)· 三视角全真跑
reviews:
  - role: qa
    review_scope: prd
    execution: subagent
    verdict: APPROVE
    started_at: "2026-07-10T04:30:00Z"
    completed_at: "2026-07-10T04:57:00Z"
    files_read: [PRD.md, src/host/ptyPool.ts, src/host/hostCore.ts, src/host/sessionTracker.ts, src/host/wsServer.ts, src/renderer/services/hostClient.ts, src/renderer/services/terminalRegistry.ts, src/host/__tests__/hostSubprocessHarness.ts]
    findings:
      - id: QA-1
        severity: high
        description: "会话在断线期间退出(build 跑完/崩溃)→ ptyPool.onExit 立即 delete 会话 + pty:exit 发给已死通道·scrollback 与退出码当场蒸发·重连 session.list 列不到=空 tab。直接击穿头号用户故事「回来看跑完的 build」·与交付表白纸黑字矛盾。原 BLOCKER 无任何 AC。"
        suggestion: "新增 P0 AC:standalone host onExit 转 exited 态保留最终 scrollback+退出码·session.list 仍列出·重连回放+已完成徽标。"
        category: technical-consistency
        code_evidence: {file_path: "src/host/ptyPool.ts", line_range: "95-100"}
        pm_response: "采纳(BLOCKER)。v0.3 新增 AC-12 + D-11。v0.4 据 QA-r2 H-1 收口:exited 驻留寿命=与存活会话同(字节/计数驱逐·无独立短时窗·堵幽灵覆盖)。RESOLVED。"
      - id: QA-2
        severity: high
        description: "AC-8「复用 hostCore 归属守卫」与 AC-4「重新 attach 既有会话」自相矛盾:现守卫=client.sessions.has(sid)·重连是新 client·sessions 为空→复用守卫拦死所有重连 attach。且模型 A 里授权客户端认领该 host 会话是特性非攻击·AC-8 把两者混为一谈。"
        suggestion: "重写 attach 授权:token 过闸即可 claim + send 重绑转移所有权·非 per-client Set。"
        category: technical-consistency
        code_evidence: {file_path: "src/host/hostCore.ts", line_range: "107-120,177-192"}
        pm_response: "采纳。v0.3 AC-8 调和为 token 闸 + 跨重连按 sessionId 重绑(非 per-client Set)。arch-R2 VERIFY-1 独立背书同结论。RESOLVED。"
      - id: QA-3
        severity: high
        description: "多客户端同时 attach 语义空白(session.send 单值 vs 订阅集?转移 vs 扇出?输入仲裁?)·模型 A/mobile 前瞻核心·PRD 无决策项。"
        suggestion: "v1 定 single-owner last-attach-wins。"
        category: business-decision
        pm_response: "采纳。v0.3 新增 AC-14 + D-10 last-attach-wins 单所有者转移·扇出列 Out of Scope。RESOLVED。"
      - id: QA-4
        severity: high
        description: "AC-5「未读通知对账」按现状不可交付:sessionTracker bell/notify 是 emit-and-forget 不留存·session.list 无状态快照·对账要当前态却拿不到。"
        suggestion: "tracker 加可查询对账态 + session.list 返回快照。"
        category: technical-consistency
        code_evidence: {file_path: "src/host/sessionTracker.ts", line_range: "1-117"}
        pm_response: "采纳。v0.3 AC-5 挂 session.list 状态快照(D-5)。v0.4 据 M-1 删「未读计数」字段(与 ARCH-5 不含累积一致)。arch-R2 VERIFY-4:tracker 须加 getter 暴露快照(已入 D-5)。RESOLVED。"
      - id: QA-5
        severity: high
        description: "断线「检测」权威信号/时延未定义:浏览器 WS onclose 在合盖/断网时不及时(TCP 挂起数分钟)·横幅/自动重连/存活全悬于此·无检测时延 AC。"
        suggestion: "定义有界时延信号 + 发版前真机 spike 列门禁。"
        category: technical-consistency
        code_evidence: {file_path: "src/host/wsServer.ts", line_range: "281-302"}
        pm_response: "采纳。v0.3 新增 AC-13 + D-12(app 层心跳)。v0.4 据 M-3 给 T≤10s 量级+心跳周期 env 可注入(可 BDD 断言)。RESOLVED。"
      - id: QA-6-15
        severity: medium
        description: "QA-6 scrollback 字节截断切断转义序列致回放乱码;QA-7 会话数上限溢出策略;QA-8 存活判据注入点 hand-wave;QA-9 本机零回归口径;QA-10 与 BL-004 断线即 drop 衔接;QA-11 重连接线时序;QA-12 resize 对账;QA-13 AC-7 优先级;QA-14 兼容检测用稳定信号;QA-15 token 认领窗。"
        suggestion: "逐条落 AC/决策或合理 defer。"
        category: quality
        pm_response: "全采纳:QA-6→AC-3 安全边界截断;QA-7→AC-9 拒新建+手动 kill(D-9);QA-8→D-1 形态显式注入;QA-9→AC-2 本机不分配缓冲;QA-10→AC-15+D-13;QA-11→blueprint 接线时序;QA-12→AC-11 resize;QA-13→AC-6 折入;QA-14→D-5 稳定信号;QA-15→隐藏前提 token 窗无上界 note。RESOLVED/addressed。"
  - role: architect
    review_scope: prd
    execution: subagent
    verdict: APPROVE
    started_at: "2026-07-10T04:30:00Z"
    completed_at: "2026-07-10T04:48:00Z"
    files_read: [PRD.md, src/host/hostCore.ts, src/host/ptyPool.ts, src/host/sessionTracker.ts, src/host/wsServer.ts, src/host/host.ts, src/renderer/services/hostClient.ts, src/renderer/services/terminalRegistry.ts, src/main/orchestrator.ts, src/renderer/services/remoteWorkspaceSync.ts, src/shared/protocol.ts]
    findings:
      - id: ARCH-1
        severity: high
        description: "detached 会话断开期无客户端 ack·现流控(unacked>512KiB→proc.pause)会憋停子进程·与「会话续跑」冲突·续跑是假的。"
        suggestion: "detached 会话旁路流控·环形缓冲作消费端。"
        category: technical-consistency
        code_evidence: {file_path: "src/host/ptyPool.ts", line_range: "86-92"}
        pm_response: "采纳。D-3 + AC-1 旁路流控。RESOLVED。"
      - id: ARCH-2
        severity: high
        description: "hostClient 复用同一实例重连卡死(markDown→down 拒 rpc·connectPromise 陈旧早返:155·dispose 丢 per-host 结构)。"
        suggestion: "定义显式 reconnect() 路径·markDown 本地/远程分叉。"
        category: technical-consistency
        code_evidence: {file_path: "src/renderer/services/hostClient.ts", line_range: "139-178"}
        pm_response: "采纳。D-6 + AC-10。RESOLVED。"
      - id: ARCH-3
        severity: high
        description: "重连认领若无守卫·第二窗口可劫持另一窗口活跃会话(复活想防的攻击)。"
        suggestion: "认领限孤儿会话 + token。"
        category: technical-consistency
        pm_response: "采纳但经 QA-2/3 + arch-R2 VERIFY-1 调和:承认 standalone 单租户·收养=按 sessionId last-wins 所有权转移顶替旧 owner·「仅孤儿」软化为「转移时顶替」(token 闸挡未授权)。v0.3/v0.4 AC-8+AC-14。RESOLVED。"
      - id: ARCH-4-11
        severity: medium
        description: "ARCH-4 reattach 原语;ARCH-5 sessionTracker 无累积;ARCH-6 增量回放;ARCH-7 形态显式注入;ARCH-8 altscreen resize;ARCH-9 幂等收养防双 spawn;ARCH-10 向后兼容;ARCH-11 本机不分配缓冲。"
        suggestion: "逐条落 AC/决策。"
        category: technical-consistency
        pm_response: "全采纳:D-7/AC-5/D-4+AC-3/D-1/AC-11/D-8+AC-11/D-5/D-2+AC-2。RESOLVED。"
      - id: VERIFY-1
        severity: medium
        description: "Round2:AC-8「仅孤儿」与 AC-11「30s 假死幂等收养」定义级张力:SSH 假死无 RST 时 host 旧 ws readyState 恒 OPEN·无法区分传输已死 vs 活跃第二窗口。"
        suggestion: "收养=按 sessionId 所有权转移(last-wins)顶替旧 owner·孤儿判定不能只靠 readyState。"
        category: technical-consistency
        code_evidence: {file_path: "src/host/wsServer.ts", line_range: "287"}
        pm_response: "采纳=v0.3 AC-14 last-attach-wins。RESOLVED(blueprint 钉死转移语义)。"
      - id: VERIFY-2
        severity: medium
        description: "Round2:AC-3 增量回放游标须 renderer 报(已渲染绝对偏移)非 host last-acked 计数(在途 ack 丢失致重写=双写);gap 超 256KiB 缓冲被挤出→花屏须回退全量。"
        suggestion: "session.attach 携 renderer resume 绝对偏移·加增量-vs-全量判据。"
        category: technical-consistency
        code_evidence: {file_path: "src/host/ptyPool.ts", line_range: "108"}
        pm_response: "采纳折入 v0.3 D-4。blueprint 硬门。RESOLVED。"
      - id: VERIFY-3
        severity: medium
        description: "Round2:reconnect 真实拓扑=renderer→main(SSH 隧道)→host·断线后旧 localPort 已死·自动重连须驱动 main remoteHost.connect 重建隧道·且 AC-3 保 terminal 与 BL-004 断线立刻 disposeTerminal(remoteWorkspaceSync.ts:78)直接冲突·必须抑制 BL-004 drop。"
        suggestion: "重连走 main 隧道重建;瞬时断线抑制 BL-004 full drop。"
        category: technical-consistency
        code_evidence: {file_path: "src/renderer/services/remoteWorkspaceSync.ts", line_range: "78"}
        pm_response: "采纳折入 v0.3 D-6(隧道重建)+D-13/v0.4 AC-15(抑制 drop)。RESOLVED。"
      - id: VERIFY-4-5
        severity: low
        description: "Round2:VERIFY-4 sessionTracker altscreen 未存储(:67 只 emit)·quiet 私有无 getter;VERIFY-5 会话数上限淘汰谁未定义·勿误杀长任务。"
        suggestion: "tracker 加快照 getter;上限=拒新建+日志不主动杀+手动 kill 出口。"
        category: technical-consistency
        code_evidence: {file_path: "src/host/sessionTracker.ts", line_range: "67"}
        pm_response: "采纳折入 v0.3 D-5(getter)+D-9(拒新建+手动 kill)。RESOLVED。"
  - role: pl
    review_scope: prd
    execution: subagent
    verdict: APPROVE
    started_at: "2026-07-10T04:30:00Z"
    completed_at: "2026-07-10T04:45:00Z"
    files_read: [PRD.md, "product-overview/workstream/WS-01-remote-host.md"]
    findings:
      - id: PL-CHALLENGE-1
        severity: high
        description: "质疑六问①既有行为变更/②核心价值:AC-9 时间型孤儿超时(无 attach 超 N 分钟回收)与「合盖过夜回来接着干」核心承诺直接矛盾·会杀长任务。"
        suggestion: "砍时间型 reap·只留字节+计数上限。"
        category: premise-challenge
        pm_response: "采纳。D-9+AC-9+Out-of-Scope 三处一致砍除。RESOLVED。"
      - id: PL-CHALLENGE-2-5
        severity: medium
        description: "PL-2 AC-3 双写风险;PL-3 AC-7 冗余;PL-4 形态判据代理量;PL-5 优先级二轴。"
        suggestion: "增量回放不双写;AC-7 折入 AC-6;形态显式注入;优先级二轴。"
        category: premise-challenge
        pm_response: "全采纳:D-4 增量回放/AC-6 折入/D-1 显式注入/优先级二轴。RESOLVED。"
      - id: PL-R2-1
        severity: low
        description: "Round2:AC-5 把上游字面「通知对账」缩窄为「当前态对账」(去断开期离散 bell/notify 逐条补发)·需确认忠实。"
        suggestion: "点头确认「通知对账=当前态徽标对账·非离散通知逐条补发」。"
        category: business-alignment
        pm_response: "确认(yolo auto):通知对账=当前态徽标对账(未看断开期离散通知逐条补发)·已在 Out of Scope L144 显式列出。GO-012 早把离散通知投递推 M5 后·当前态对账正是兜底。CONFIRMED。"
---

# PRD-REVIEW · BL-005 断线重连与会话连续性

## 汇总裁决

**三视角冷审收敛 = 全 APPROVE**（advisory finding 已全部整合进 PRD v0.4·留痕于上）。

| 视角 | 执行 | Round1 | Round2 (verify) | 终判 |
|------|------|--------|-----------------|------|
| **QA**（完备性/可测性） | opus 隔离冷审 | changes_requested · **QA-1 BLOCKER** + QA-2~15 | v0.3 → approve-with-concerns · **QA-1 RESOLVED** · H-1/M-1/M-2/M-3 收口 | **APPROVE** |
| **Architect**（简洁/一致性） | opus 隔离冷审 | 3 high(ARCH-1/2/3) + ARCH-4~11 | v0.2 → approve_with_conditions · VERIFY-1~5 折入 | **APPROVE** |
| **PL**（前提对抗六问） | opus 隔离冷审 | approve-with-concerns · PL-1~5 | v0.2 → approve · 5/5 消解 · 1 low 确认 | **APPROVE** |

## 冷审有效性证据（真跑·非鼓掌）

- **QA 揪出 1 BLOCKER**：会话在断线期间退出→结果与退出码当场蒸发（ptyPool.ts:95-100），直接击穿头号用户故事「回来看跑完的 build」，v0.1/v0.2 完全无覆盖。这是本 Feature 的**北极星承诺**，冷审在 goal 门拦下。→ 新增 AC-12。
- **QA×Arch 独立互证**：QA-2/3（授权多端认领是特性、per-client Set 拦死重连）与 arch-R2 VERIFY-1（last-wins 所有权转移顶替旧 owner）**独立收敛到同一认领模型**，共同修正了 arch Round1 ARCH-3「仅孤儿」的过严限制。
- **QA-r2 堵幽灵覆盖陷阱**：H-1 指出 AC-12「驻留宽限窗」若按短时窗实现，能过窄测试却测不到「深夜 build 完成→早晨回来」核心场景（本项目 BL-003/004 已两遇 verify-ac 幽灵覆盖）。→ v0.4 钉死 exited 会话=与存活会话同寿命（无独立短时窗）。
- **PL 拦下核心价值自毁**：PL-1 指出时间型孤儿超时与「合盖过夜」承诺自相矛盾（会杀长任务）。→ 砍时间型 reap。

## blueprint 必继承的硬门（从冷审沉淀）

blueprint 阶段须把以下作硬约束钉死（当前代码均不支持·是从「声称连续」到「真连续」的地基）：

1. **detached 会话旁路流控**（D-3/AC-1）——否则断开期 proc.pause 憋停子进程，续跑是假的。
2. **exited 会话同存活寿命保留**（AC-12/H-1）——onExit 转 exited 态·字节/计数驱逐·无独立短时窗。
3. **增量回放游标 = renderer 报的绝对字节偏移**（D-4/VERIFY-2）——非 host ack 计数·gap 超缓冲回退全量。
4. **reconnect 走 main SSH 隧道重建**（D-6/VERIFY-3）——非 renderer 对死端口开 socket·复位 connectPromise。
5. **瞬时断线抑制 BL-004 full drop**（AC-15/D-13/VERIFY-3）——保「重连中」态 + 保活终端·仅确定断线才 drop。
6. **认领 = token 闸 + last-attach-wins 所有权转移**（AC-8/AC-14/VERIFY-1）——非 per-client Set·非仅孤儿。
7. **断线检测 app 层心跳 T≤10s + env 可注入**（AC-13/M-3）。
8. **sessionTracker 暴露快照 getter**（D-5/VERIFY-4）——altscreen/quiet 当前态可查询·session.list 不含未读计数。

## 可测试性结论

`hostSubprocessHarness`（真子进程 + 真 node-pty + loopback WS 起 standalone host）已能端到端测 AC-1/3/4/9/12——只需把退出留存窗/心跳周期/会话数上限做成 env 可注入。**唯一测不了**：真机合盖/断网时序（AC-13 检测时延），列**发版前真机 spike** 门禁。

## 降级说明

worktree 无 `.teamwork_localconfig.json` → 第三视角 external 降级为**同模型（opus）隔离 subagent 冷审**（非跨模型异质）·三视角全真跑·满足 P0-154 门（`review_via: subagent`）。
