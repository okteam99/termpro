# QA 复核 R2 · BL-005 断线重连与会话连续性 PRD v0.3

- **feature**: TERMPRO-F260710042746-Reconnect-Continuity（WS-01-S5 · BL-005）
- **review_role**: QA（第二轮 verify · 隔离冷审）
- **review_date**: 2026-07-10
- **round1_verdict**: changes_requested（QA-1 BLOCKER + QA-2~15）
- **verdict**: **approve-with-concerns**

## 裁决摘要

v0.3 认真吃掉了 Round1：**QA-1 BLOCKER 的承重机制已建立**（AC-12/D-11 把 onExit「立即 delete」改为「转 exited 态保留 scrollback+退出码·session.list 仍列出·重连回放+已完成徽标」）——这是能否放行的关键，**已解决**（substance）。QA-2~15 逐条核实：11 项 resolved、3 项 partial、1 项 addressed-but-worsened。没有任何一条 Round1 findings 悬空，也没有「设计根本跑不通」的新硬阻断。

但复核发现 **1 个 high + 3 个 medium 的规格/一致性/可测性新缺口**，其中最要命的是 **AC-12 的 exited 驻留边界（宽限窗）未定且可能与 D-9 自相矛盾**——如按短时窗实现，AC-12 会「测得过、故事失守」（正是本项目 verify-ac 幽灵覆盖反模式）。这些都能在 blueprint 收口，故不 re-block；但必须显式钉死，尤其 H-1。

代码锚点已逐一冷核（见文末 files_read），PRD 对现状的引用**全部属实**。

---

## QA-1 BLOCKER 明确裁决：**RESOLVED（substance）· 附 H-1 强约束**

代码现实复核（`ptyPool.ts:95-100`）确认原判无误：
```
proc.onExit(({ exitCode }) => {
  this.sessions.delete(id);          // 会话对象+scrollback 当场蒸发
  this.stopPollingIfIdle();
  onExit?.(id);
  send({ t: 'pty:exit', ... });      // 发给已死通道 → 退出码丢失
});
```

v0.3 的 AC-12 + D-11 **直接、正确地**对上了这个漏洞：
- **两种退出都覆盖**：AC-12 明写「build 跑完 / 进程崩溃」；`onExit` 对正常退出与信号死亡都触发，故「断线期跑完」与「断线期崩溃」两条路径都落在同一改造点。✅
- **保留物齐全**：最终 scrollback + 退出码/结束状态 + session.list 仍列出 + 已完成徽标 —— 头号用户故事「回来看跑完的 build」在设计层可兑现。✅
- **本机零回归**：仅 standalone 转 exited，本机嵌入式仍立即回收。✅

**⚠️ 但驻留边界不可测、且潜在自相矛盾（→ H-1，见下）**：D-11 用「驻留宽限窗」措辞暗示**时间窗**，而 D-9 恰恰**砍掉了时间型孤儿超时**（因为「合盖过夜回来接着干」不能有时限）。二者对 exited 会话给出相反信号：若 exited 宽限窗是短时窗，则「深夜 build 跑完 → 早晨回来」会**丢结果**——AC-12 能通过一条窄测试（退出后立即重连看得到），却**恰恰测不到它要守的那个过夜场景**。这是 verify-ac 幽灵覆盖的教科书陷阱。裁决：BLOCKER 的机制到位、**不 re-block**，但 blueprint 必须把驻留边界钉成「与存活会话同寿命」（内存/计数压力驱逐、非短时窗），否则 AC-12 是空壳。

附带可测性小缺口：AC-12 需要 session.list 快照带一个 **alive/exited 维度**（打「已完成」徽标的数据源），而 AC-5 的状态枚举只有 running/idle/quiet、sessionTracker.state 也只有 `'idle'|'running'`——exited 是 ptyPool 级概念，须在快照里单列，blueprint 明确。

---

## QA-2~15 逐条 resolution

| ID | Round1 severity | v0.3 落点 | 复核裁决 |
|----|---|---|---|
| **QA-1** | blocker | AC-12 + D-11 | **RESOLVED**（substance）·附 **H-1** |
| **QA-2** authz 矛盾 | high | AC-8 改 token 闸 + 归属守卫按 sessionId 重绑 | **RESOLVED**。矛盾已消解：authz=token 闸，`client.sessions.has(sid)` 守卫改为「session.attach 时转移归属（旧 owner 摘除/新 owner 加入）」。⚠ 措辞「非 per-client Set」易被误读成**废除**守卫；blueprint 须澄清守卫保留、attach 只是**转移 Set 成员**，否则 input/resize/ack 的纵深守卫（`hostCore.ts:107-120,177-192`）失效。 |
| **QA-3** 多端语义 | high | AC-14 last-attach-wins + D-10 | **RESOLVED**。v1 = 单所有者转移、`session.send` 保持单值、扇出列 Out-of-Scope、点名测试「A→B 同 sid→输出去向+A input 被拒」。可测。小 UX 留白：旧端「被动断」时是否收到「已被他处接管」信号未定，v1 可接受。 |
| **QA-4** 无状态快照 | high | AC-5 挂 session.list 状态快照 + D-5 | **PARTIAL**。方向对（session.list 带当前态快照、AC-5 正确缩到「当前态对账、不补发离散通知」，与 sessionTracker emit-and-forget 现实一致 ✅）。**但 D-5 快照字段列了「未读计数」，与 AC-5/Out-of-Scope/ARCH-5「不含未读累积」直接打架**——已冷核 `sessionTracker.ts` 确认 notify 是纯 emit、无任何计数器（→ **M-1**）。另：快照要的 altscreen/最近退出码 sessionTracker 当前**只 emit 不留存**，须新增留存字段（blueprint 任务，非矛盾）。 |
| **QA-5** 断线检测时延 | high | AC-13 app 层心跳·T 秒横幅 + D-12 | **PARTIAL**。根因判对（renderer 无应用层心跳、只靠 `ws.onclose`，合盖 TCP 挂起不及时 ✅ 冷核 hostClient 属实）。方案方向对。**但「有界 T 秒」T 无量级、无注入约定 → 不可 BDD 断言**（→ **M-3**）。 |
| **QA-6** 字节截断切坏序列 | medium | AC-3 安全边界截断 | **RESOLVED**。AC-3 明写「不切断 UTF-8/CSI/OSC」。altscreen 全屏应用「进 altscreen 指令被逐出」的语义乱码由 **AC-11 proc.resize→逼重绘** 兜底（对 vim/htop 等响应 SIGWINCH 的 TUI 成立）。可脚本化测。 |
| **QA-7** 溢出策略 + 过期 UX | medium | AC-9 拒绝新建 + D-9 砍时间 reap | **PARTIAL**。溢出=拒绝新建（非逐出运行）已钉死、可测 ✅。**第二半「重连时会话已没了 → 明确过期态」被换成 AC-11「未命中→静默 new spawn」**：hang 风险消除 ✅，但「宽限窗过期/host 重启后 build 结果没了」时**静默起新 shell、无任何提示**（用户丢结果不自知），与 Round1 诉求的「明确过期态」不同，且该取舍未被点明。低影响、知会。 |
| **QA-8** 形态注入点 | medium | D-1 host.ts 显式注入 | **RESOLVED**。冷核 `createHostCore()` 现无参、host.ts 做 argv 分流——注入 flag 是正解（每 core 一属性、守传输无关）。blueprint 补 `createHostCore({sessionSurvival})` 签名即可，可测。 |
| **QA-9** 本机足迹口径 | medium | AC-2 本机不分配 + D-2 | **RESOLVED**。scrollback 仅 standalone、本机不分配、AC-2 扩为「无新增内存/行为足迹」。可测（本机 spawn N → 断言无 scrollback 分配）。 |
| **QA-10** 瞬时断线 vs BL-004 full drop | medium | D-13 保活不走 dropHostWorkspaces | **PARTIAL**。冷核 `stopRemoteWorkspaceSync→dropHostWorkspaces（含 disposeTerminal）+hostRegistry.drop` 属实；D-13 决策正确（瞬时断线保「重连中」态+保活终端不 dispose+恢复 active tab）。**但 D-13 的保活/不-drop 行为无任何 AC 覆盖 → verify-ac 不会测它**，QA-10 警告的 BL-004 碰撞正是可能裸奔上线的那条（→ **M-2**）。且瞬时→确定断线的转换阈值（超重连预算=多少）未在任何 AC 钉死。 |
| **QA-11** 跨注册表接线时序 | medium | AC-4/AC-11/D-4/D-7/D-8 + 时序图 | **RESOLVED（PRD 层）**。所有零件已命名：ptyPool.reattach 原语（D-7）、幂等收养记 sessionId（D-8/AC-11）、(hostId,sessionId) 复合键重绑（AC-4，冷核 terminalRegistry `findTab` 复合键属实）、增量回放游标（D-4）、闪断 xterm 存活 vs 重建 tab 生命周期模型（D-4）。详细时序合理 defer blueprint；mermaid 已给顺序。⚠ 冷核提示：现 `ack` 只是流控计数器（`ptyPool.ts:108-116`），D-4「已确认字节游标」需把 ack 扩成回放偏移——新机制，blueprint 明确。 |
| **QA-12** 维度对账 resize | medium | AC-11 收养后 proc.resize 对账 | **RESOLVED**。可测（不同 cols 重连 → 断言发 resize）。 |
| **QA-13** AC-7 优先级偏低 | low | AC-7 折进 AC-6（P1） | **RESOLVED（更优结构）**。恢复承重件 AC-3/4/5/11/12 **全 P0**，端到端恢复实质是 P0；折进 AC-6/P1 的只剩「横幅+退避编排」这层包装 UX，P1 合理。比 Round1 建议的拆法更干净。 |
| **QA-14** 兼容退化 error 探测 | low | D-5 catch unknown rpc 退化 | **RESOLVED（PRD 层）**。机制命名（冷核 `hostCore.ts:263-264` 抛 `unknown rpc method` 属实）。⚠ 建议 blueprint 用**稳定信号**（结构化 error code 或「session.list 任意 reject→退化」）而非子串匹配错误文案（文案一变探测就断）。低。 |
| **QA-15** 存活扩大 token 爆炸半径 | low | 挂 D-9 联动 | **ADDRESSED-BUT-WORSENED**。D-9 **彻底砍掉**时间型超时后，「泄漏 token 认领活 shell」的**时间窗从 N 分钟变为无上界**（直到字节/计数压力或 host 重启）——比 Round1 flag 的风险**更大**，而 PRD **无一句安全段点明此权衡**（原诉求「N 取值保守」也因无 N 而落空）。仍属低（token=loopback+128-bit+单租户为主屏障），但应补一行 note（→ 并入 M 级 minor）。 |

---

## 新发现（v0.3 引入 / 复核暴露）

### H-1 · AC-12 exited 驻留边界未定且与 D-9 潜在矛盾 → 幽灵覆盖风险
- **severity**: high（不 re-block · blueprint 必须收口）
- **description**: D-11「驻留宽限窗」暗示时间窗；D-9 为守「合盖过夜」**砍掉**了时间型超时。对 exited 会话二者信号相反。若宽限窗按短时窗实现，AC-12 可通过窄测试（退出→立即重连看得到结果）却**测不到它要守的过夜场景**（深夜 build 完成→早晨回来→结果已被短窗驱逐）。这正是「回来看跑完的 build」头号故事，AC-12 会「测得过、故事失守」。
- **suggestion**: blueprint 钉死 exited 会话驻留 = **与存活会话同寿命**（受 D-2 字节上限 + D-9 会话数上限驱逐，**不设短于存活会话的时间窗**）；AC-12 应补可断言判据：「exited 会话在会话数/字节压力驱逐前一直可 session.list + 回放」。并明确 session.list 快照的 alive/exited 维度（已完成徽标数据源，独立于 tracker 的 idle/running）。

### M-1 · D-5 快照字段「未读计数」与 AC-5/Out-of-Scope 自相矛盾（无数据源）
- **severity**: medium
- **description**: 冷核 `sessionTracker.ts` 确认 notify 纯 emit、**无任何计数器**。AC-5 正文 + Out-of-Scope + ARCH-5 都说「不含未读累积·sessionTracker 无累积能力」，但 D-5 的快照字段列表却写了「未读计数」。blueprint 会不知道到底建不建未读计数。
- **suggestion**: 从 D-5 快照字段划掉「未读计数」（与 AC-5 对齐），或若确要保留则须先撤销 Out-of-Scope/ARCH-5 并给 sessionTracker 加累积能力（不建议，超本 BL）。二选一、消歧。

### M-2 · D-13 瞬时断线保活行为无 AC 覆盖 → 不被 verify-ac 测试
- **severity**: medium
- **description**: D-13「瞬时断线不走 dropHostWorkspaces·保活终端不 dispose·保『重连中』态·恢复 active tab」只活在决策项里，**无对应 AC**。AC-10 管的是 hostClient reconnect（非 dispose client），而 dropHostWorkspaces/disposeTerminal 是 store 级独立路径——D-13 的行为**没被任何 AC 断言**。QA-10 警告的 BL-004 碰撞回归会裸奔上线。且瞬时→确定断线的转换阈值未在 AC 钉死。
- **suggestion**: 新增 AC：「Given 远程 host 瞬时断线（未超重连预算）/ When 断线回落触发 / Then 不 dispose 该 host 终端、不从 Sidebar 删 workspace（呈『重连中』）、重连后恢复原 active tab；仅超预算/机器删除才走 BL-004 full drop」。给 renderer 单测挂载点（fake close→reopen 断言 disposeTerminal/dropHostWorkspaces 未被调用）。

### M-3 · AC-13「T 秒内」无量级、无注入约定 → 不可 BDD 断言
- **severity**: medium（可测性）
- **description**: AC-13 是带时限的 AC，但 T 是纯占位符，既无默认量级也无「参数可注入」约定。对照 wsServer 已有 `pingIntervalMs`（命名常量 + 可注入），renderer 侧心跳应同构。现状 AC-13 测不了。
- **suggestion**: AC-13 补具体量级（如「T ≤ ~10s 默认」）+ 声明心跳周期/超时**参数可注入**（照 `pingIntervalMs` 惯例）以便快测；blueprint 定 renderer 应用层心跳的 ping 周期 X + 超时 Y（T≈X+Y）。

### minor（知会，不阻断）
- **QA-15 残留**：D-9 砍时间超时后「泄漏 token 认领活 shell」时间窗变无上界，PRD 无安全段点明。补一行权衡 note（主屏障仍是 token，纵深说明即可）。
- **QA-2 措辞**：blueprint 澄清归属守卫保留、session.attach 只转移 Set 成员（非废除守卫）。
- **QA-14**：兼容探测用稳定信号（error code / 任意 reject）而非错误文案子串。

---

## 可测性结论（本轮重点：带时序/时限的 AC 是否可落测）

- **利好不变**：`hostSubprocessHarness.ts`（真子进程+真 node-pty+loopback WS）使 AC-1/3/4/9/12/14 可端到端桩测；sessionTracker 已有可注入 `now`；wsServer 已立 `pingIntervalMs` 可注入惯例。
- **带时序/时限的 AC 逐条可测性**：
  - **AC-12（exited 态）**：机制可测，但**驻留边界目前不可断言**（H-1）——须先把「同寿命/压力驱逐」写成判据，否则只能测窄窗、幽灵覆盖。
  - **AC-13（T 秒时延）**：**当前不可断言**（M-3）——须给 T 量级 + 心跳周期可注入。
  - **AC-11（假死窗 + resize 对账）**：可测（fake close→reopen + 不同 cols → 断言 attach 幂等不双 spawn + 发 resize）。
  - **AC-9（无时间 reap，字节+计数上限）**：可测（注入小上限 → 溢出断言拒新建、不逐出运行）。
- **仍只能真机 spike**：合盖/断网/切网隧道死与恢复的真机时序（承接 BL-003/004 同类 concern，须显式列门禁）。
- **D-13 行为无 AC** → 无测试挂载点（M-2）。

## 优先级合理性

结构较 v0.2/我 Round1 建议更优：恢复承重件 AC-3/4/5/11/12 全 P0、横幅/退避编排 AC-6 P1、检测时延 AC-13 P1（可辩护，存活 P0 不依赖检测）。无需再调优先级；只需按 H-1/M-1~3 收口规格。

## files_read（本轮冷核）
- `PRD.md`（v0.3 · 评审对象）、`reviews/goal-qa.md`（我 Round1）
- `src/host/ptyPool.ts`（onExit :95-100 立即 delete · 流控 :82-92 · ack :108-116 纯计数）
- `src/host/hostCore.ts`（归属守卫 :107-120,177-192 · close kill :125-126 · createHostCore 无参 :70 · unknown rpc :263-264）
- `src/host/sessionTracker.ts`（state 仅 idle/running · notify 纯 emit 无计数 · altscreen 仅 emit 不留存）
- `src/host/wsServer.ts`（服务端心跳 isAlive/terminate :281-302 · pingIntervalMs 可注入 · token 闸）
- `src/renderer/services/hostClient.ts`（onClose→markDown · 无应用层心跳 · dispose/down · attachPty/bufferedData）
- `src/renderer/terminal/terminalRegistry.ts`（tabId 键 · (hostId,sessionId) findTab · disposeTerminal kill）
- `src/renderer/services/remoteWorkspaceSync.ts` + `state/store.ts:536`（stopRemoteWorkspaceSync→dropHostWorkspaces+drop · D-13 锚点属实）
