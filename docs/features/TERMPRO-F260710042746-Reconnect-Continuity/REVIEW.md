---
feature_id: TERMPRO-F260710042746-Reconnect-Continuity
review_scope: code (review 阶段 · BL-005 增量 954dcc0..HEAD)
review_round: 1
reviewers: [architect, qa, external]
verdict: APPROVE
per_reviewer_round1:
  architect: NEEDS_REVISION   # 2 BLOCKER + 1 MAJOR + 3 MINOR/NIT
  qa: NEEDS_REVISION          # 2 MAJOR + 2 MINOR + 2 NIT
  external: NEEDS_REVISION     # 1 MAJOR + 2 MINOR + 1 NIT (degraded subagent · review_via:subagent)
reviewed_at: "2026-07-10"
review_via: subagent   # 第三视角降级同模型 opus 隔离冷审(worktree 无异质源·单模型 opt-out)
gate: "tsc 0 error · vitest 765 passed 0 failed(含真 node-pty 集成测端到端绿) · SMOKE_OK · 11 新测覆盖生产接线"
findings:
  - {id: A1, severity: BLOCKER, status: fixed, title: "readopt 在新 ws 打开前由 main 'ready' 事件触发 → session.attach transport=null 恒 reject → 重连后终端冻结(击穿 AC-3/4)", source: arch}
  - {id: A2, severity: BLOCKER, status: fixed, title: "onAttemptFailed 无生产调用方 → 自动退避重试只 1 次 + 超预算 drop 死代码 → 首试失败永卡「重连中」(击穿 AC-6/AC-15)", source: arch}
  - {id: A3, severity: MAJOR, status: fixed, title: "断线期 exited 会话收养 exitCode 未透传 → AC-12「已完成 ✓ exit N」徽标北极星场景不亮(scrollback 回放本身通过)", source: arch}
  - {id: Q1, severity: MAJOR, status: fixed, title: "900ms drop gate 生产路径(Sidebar 内联)无测 · 测的是零调用者死助手 → CR-1 抑制盲区(删 isReconnecting 判断测仍绿)", source: qa}
  - {id: Q2, severity: MAJOR, status: fixed, title: "AC-12 完成徽标渲染半侧幽灵覆盖(T-035 只断言写死字段·reconcileBadge 忽略 snapshot.status)", source: qa}
  - {id: E1, severity: MAJOR, status: fixed, title: "重连编排 onAttemptFailed 未桥接(同 A2·external 独立命中)", source: external}
  - {id: E2, severity: MINOR, status: fixed, title: "RemoteHostsPage.beginHandshake 仍用 connect() 未改 reconnect()(硬门④只改半边)", source: external}
  - {id: E3, severity: MINOR, status: deferred, title: "reconnectWiring rebuildTab:()=>null → path② 关 tab 后重连再发现(AC-4)生产禁用 · v1 defer + PENDING-006(path① 闪断常态覆盖北极星·path② 需 session→workspace 映射+addTab 返 tabId 接线·牵扯大)", source: external}
  - {id: A5, severity: MINOR, status: fixed, title: "CR-1 附带闭合:host 进入 reconnecting 一刻清已排 panel drop timer(修 main-disconnected 先于心跳判死到达的漏 drop 竞态)", source: arch}
  - {id: A6, severity: NIT, status: deferred, title: "心跳判死后悬挂 host.info rpc(纯短时无用 pending·beat settled 卫已防重复·无正确性影响·留注后续)", source: arch}
  - {id: Q3, severity: MINOR, status: fixed, title: "AC-5 reconcileBadge 生产对账 + AC-4 路径①收养由真测覆盖(reconnectWiring.test.ts / SidebarReconnect.test.tsx)", source: qa}
---

# REVIEW · BL-005 断线重连与会话连续性 — 代码评审

## 汇总裁决

**三视角代码冷审 Round1 全 NEEDS_REVISION → review-fix 收口 → APPROVE**。

root cause 三视角完全一致：**host 侧并发/时序 9 大不变式逐条 grounded 全成立**（reattach 原子转移 / detach 解 paused 续跑 / 游标 onData 按 bytes 同步累加 / exited 保留逐出 / residency 有界重试 / embedded 零回归——arch 实证），纯逻辑单测扎实；但**里程碑集成接线未补齐**——reconnect 编排的 seam 被单测直驱给假绿，而从真实事件源（main verifying/ready/failed、beginHandshake、心跳）到 controller 机器的**生产接线缺口/错序**，两条 BLOCKER 直接让「重连后终端冻结」「首试失败永卡重连中」在真机确定复现。

这是代码评审的核心价值：单测的假信心被冷审戳穿，ship 前拦下核心价值 bug。

## Round1 findings × 处置

| id | severity | 处置 | 修法要点 |
|----|----------|------|----------|
| **A1** | BLOCKER | fixed | readopt 从 main 'ready' 事件解耦 → 由 `client.reconnect().then`（ws 真 open·transport 就绪）驱动 `onReconnected` |
| **A2/E1** | BLOCKER | fixed | onAttemptFailed 接两处失败源：beginHandshake `.catch`（ws 打不开）+ onEvent `stage==='failed' && isReconnecting`（隧道重建失败）→ 退避重试 + 超预算 drop 真转 |
| **A3/Q2** | MAJOR | fixed | reconcileBadge 据 `snapshot.status==='exited'` 落 `tab.exited+exitCode`（reattach 不重发 pty:exit·徽标从快照点亮）·TabState 加 exitCode·TabBar 渲染「exit N」 |
| **Q1** | MAJOR | fixed | Sidebar 内联 900ms drop gate 收敛到被测 seam `scheduleDropUnlessReconnecting`（生产路径由 T-030/031 真断言） |
| **E2** | MINOR | fixed | RemoteHostsPage.beginHandshake connect→reconnect |
| **A5** | MINOR | fixed | reconnecting 一刻清已排 panel drop timer（闭合竞态漏 drop） |
| **E3** | MINOR | deferred | path② rebuildTab v1 defer + PENDING-006（path① 覆盖北极星·path② 需 session→workspace 映射 + addTab 返 tabId·牵扯大） |
| **A6** | NIT | deferred | 心跳判死后悬挂 rpc（无正确性影响·留注） |

## 门禁验证（review-fix 后·主循环亲跑）

- **tsc --noEmit**：0 error（三层集成）。
- **vitest**：`exit=0` · **765 passed / 1 skipped / 0 failed** —— 🔴 真 node-pty 集成测端到端绿（`reconnectContinuity.integration` 14 ✓ / `ptyPoolDetach` 5 ✓·host reconnect 全链路真机级验证）· renderer 469 ✓（含 11 新覆盖生产接线的测·堵 A1/A2/Q1/A3 幽灵覆盖复发）。
- **冒烟**：SMOKE_OK（4s）· embedded 路径「sessions killed」（本机零回归·AC-2）。

## 关键不变式实证（arch 冷审记录·未成 finding）

reattach 同步原子转移（从旧 owner Set 摘除先于换 send）· detach 解已 paused（proc.resume + unacked=0·续跑真）· renderedBytes onData 按 host bytes 字段同步累加（非 write 回调·非 data.length·CJK 不双写）· onExit standalone→exited 保留（停轮询·pid/resize 对死 pty 安全）· 逐出按 exitedAt·拒逐 live · residency claim 有界重试复用 storedToken · 协议向后兼容双保险 · 架构红线（UI 不碰 PTY·host 零 Electron·协议纯追加）均守。

## 结论

**APPROVE** — 2 BLOCKER + 4 MAJOR 全 fixed（生产接线补齐 + 生产路径真测覆盖）· 2 MINOR/NIT deferred 带理由（PENDING-006 登记）· 无 open BLOCKER/MAJOR。可进 test。
