---
verdict: NEEDS_REVISION
feature_id: TERMPRO-F260710042746-Reconnect-Continuity
review_scope: blueprint
review_target: [TC.md, TECH.md]
reviewer: qa
execution: subagent (opus · 冷审)
reviewed_at: "2026-07-10"
files_read:
  - docs/features/TERMPRO-F260710042746-Reconnect-Continuity/TC.md
  - docs/features/TERMPRO-F260710042746-Reconnect-Continuity/TECH.md
  - docs/features/TERMPRO-F260710042746-Reconnect-Continuity/PRD.md
  - docs/features/TERMPRO-F260710042746-Reconnect-Continuity/PRD-REVIEW.md
  - src/host/ptyPool.ts
  - src/host/hostCore.ts
  - src/host/sessionTracker.ts
  - src/host/wsServer.ts
  - src/renderer/services/hostClient.ts
  - src/renderer/services/remoteWorkspaceSync.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/host/__tests__/wsTestHarness.ts
  - src/host/__tests__/sessionTracker.test.ts
  - src/renderer/services/__tests__/remoteWorkspaceSync.test.ts
summary:
  high: 3
  medium: 6
  low: 3
---

# BL-005 Blueprint TC/TECH 可测性冷审 · QA

## 裁决：NEEDS_REVISION

31 test / 14 AC 的骨架**方向正确**：文件命名/路径与既有 `__tests__` 惯例一致（`*.integration.test.ts`、camelCase basename 均匹配），集成 vs 单测的**host 侧分层合理**（AC-1/3/4/8/9/11/12/14 走真 hostCore+真 ws+真 pty·wsTestHarness 确实能真跑），沙箱 posix_spawnp 预失败登记 test-baseline 差分「0 新增」的口径与 BL-003/004 一脉相承。

但存在**一类系统性幽灵覆盖**（本项目 BL-003/004 两遇的同款陷阱）与**若干不可测/漏异常**，必须在进 dev 前收口——尤其是把「渲染层消费行为」写进 host 集成测的 `And renderer …` 从句，而集成测的 `TestClient` 根本不是 xterm、观测不到那些行为，等于给**北极星级 double-write 风险**挂了个测不到的名。逐条如下。

---

## HIGH

### QA-B-1 · HIGH · AC-3 / AC-5 / AC-12 · 渲染层消费行为被写进 host 集成测的从句里，但 harness 观测不到 → 系统性幽灵覆盖，且 double-write（最高风险）的渲染半侧零测

**问题**：多条 host 集成测（`TestClient` 收帧断言，见 `wsTestHarness.ts:65-125` —— 只累加 `ptyData` 字符串、无 xterm、无 `term.reset`、无 `renderedBytes`）在 Then/And 里断言的是**渲染层行为**：

- TC-005（AC-3）："baseOffset === resumeOffset（本地已有 scrollback 不被重写·无双写错乱）" —— 集成测只能证 **host 发的 gap 对**（`baseOffset===resumeOffset` + data 只含 gap），**证不了 renderer 不双写**。真正会 double-write / 花屏的是 `terminalRegistry.readoptHost`：full=true 才 `term.reset()`、full=false 只增量 `write`、`renderedBytes` 必须用 **host 的 `bytes` 字段累加而非 `data.length`**（补充洞察已自曝 CJK/emoji 字节≠字符会错位）。
- TC-011（AC-5）："renderer 据快照对账 tab 徽标·消除过期 running 残留" —— 集成测只能证 `snapshot.state==='idle'`，证不了徽标对账。
- TC-024（AC-12）："renderer 打「✓ exit 0 已完成」徽标" —— 同理集成测证不到徽标。

**决定性缺口**：TECH 实现步骤 #15「terminalRegistry renderedBytes + readoptHost 幂等收养 🔴🟢 绿」白纸黑字声称有红绿测，但 **TC frontmatter 无任何指向 terminalRegistry 的 test**（已核 `src/renderer/terminal/__tests__/` 无 registry 测，31 条无一覆盖 readoptHost/renderedBytes）。而 TECH §风险表把「增量回放游标错位致双写/花屏」列为 **high**，其缓解写「集成测断言『本地已有内容不重复』」—— 该缓解只覆盖 host 契约半侧，**渲染半侧（bug 真正发生处 + CJK 字节陷阱）无断言**。这正是「AC 只被一层覆盖、危险的那层没测」的幽灵覆盖。

**建议**：
1. 新增 `src/renderer/terminal/__tests__/readoptHost.test.ts`（或 `terminalRegistry.test.ts`）单测：fake client 返回 `{full,baseOffset,data}` → 断言 (a) full=true 才调 `term.reset()`、full=false **不** reset；(b) `renderedBytes` 前进量 === host `bytes`（喂一个 `bytes≠data.length` 的多字节 chunk，断言偏移用 bytes 不用 length）；(c) found=false 才 new spawn。
2. 把 TC-005/011/024 里的 `And renderer …` 从句**按层拆**：host 集成测只断言 host 契约（gap/snapshot 值），渲染断言移到上述 renderer 单测。否则这些从句是「许愿」不是「断言」。

---

### QA-B-2 · HIGH · AC-1 · TC-002「session.paused 始终为 false」不可观测——无任何暴露的 API，白盒断言打在私有字段上

**问题**：TC-002 决定性断言是「`session.paused` 始终为 false（旁路流控·不调 proc.pause）」。但 `paused` 是 `ptyPool.ts:9-20` `Session` 结构里的**私有字段**（塞在私有 `sessions` Map 内），`PtyPool` 对外只暴露 `pid()`（`:131`），无 `paused` getter；TECH 步骤 #7 加的 `list()` 产出 `SessionSnapshot` 也**不含 paused 字段**（见 TECH §数据结构 SessionSnapshot 无 paused）。所以「断言 paused===false」目前**无路可断**。更糟：一个偷懒实现可以把 detach 分支写成「恒置 paused=false 的假标志」骗过白盒检查，而真实 `proc.pause()` 仍被调——白盒过、真实相反的事故。

**建议**：把可观测量钉死为**行为**而非私有字段：detached 时喂入远超 `FLOW.highWatermark`（512KiB）且**零 ack** → 断言 `proc.onData` **持续发射**越过水位（现码 `:88-91` paused 即 `proc.pause()` 停止 onData）；对照组 embedded/attached 会在 ~512KiB 后 onData 停顿。行为断言天然防幽灵。若仍要白盒，须在 PtyPool 加 test seam（`isPaused(sid)` 或 list 带 paused），并在 TC 明写用哪个。当前 TC-002 如实现照抄「断言 paused」会卡在无 API。

---

### QA-B-3 · HIGH→(可降 MED) · AC-3 · TC-008 CSI/OSC「不切坏序列」断言的是 RingBuffer 未实现的性质 → 挂名覆盖

**问题**：TC-008 Scenario Outline 三个 Examples：UTF-8 多字节 / CSI 转义序列 / OSC 序列，断言「边界前移到下一个完整起点（不产生半个序列）」。但 TECH §数据结构 RingBuffer.push 只承诺「驱逐点**对齐 UTF-8 码点边界**」；对 CSI/OSC，TECH §错误处理明说切片干净来自「renderer 报的 chunk 边界偏移（天然干净）」+「不确定（altscreen/中段）→ full 回退清屏」。即 **RingBuffer 层根本不解析 CSI/OSC 语法**，它只懂字节/UTF-8。对 RingBuffer 单测断言「CSI/OSC 不被切断」= 断言一个该层没实现的能力 → 要么测不出、要么逼 dev 往 RingBuffer 塞不该有的转义解析。

**建议**：TC-008 收窄到 RingBuffer **真正实现**的 UTF-8 码点边界（驱逐 + sliceFrom 起点）；CSI/OSC 完整性改由 **集成测**验证（在 chunk 边界 attach → 回放 gap 起于干净 chunk 偏移、无半个转义）**或**显式走 full 回退清屏路径断言。别让 RingBuffer 单测背 CSI/OSC 的锅。

---

## MEDIUM

### QA-B-4 · MED · AC-9 · TECH 失败路径#3「先逐最旧 exited 再拒新建」的逐出选择逻辑零测（只测了拒新建分支）

**问题**：TECH §错误处理 + §待决策明确采「会话数溢出 → **先逐最旧 exited**（无 exited 可逐才拒新建）·绝不逐 live」。TC-017 只测「无 exited 可逐 → 拒新建 + 不逐 live」这一支。**逐出选择本身**（在 live+exited 混合下精准挑「最旧 exited」而非误伤 live）是有状态变更风险的正确性逻辑，且 H-1 的整个立意就是 exited 驻留正确性（BL-003/004 幽灵覆盖史）——却无一测。

**建议**：加一条 TC（integration，`ptyPoolDetach.test.ts` 或 reconnectContinuity）：cap 满 + 混合 live/exited → 新 spawn 逐出**最旧 exited**（断言被删的 sid 是那个 exited），全部 live 存活。

### QA-B-5 · MED · AC-8/兼容 · 旧 host 能力位退化 new spawn 被 TECH 声称已测，但 TC 无对应 test

**问题**：TECH §测试策略写「旧 host 兼容退化在 hostClientReconnect 单测（capabilities 缺失 → 不调 list）」，且 §依赖与影响把「BL-003/004 旧 host 零破坏」列为兼容保证。但 TC-019/020（hostClientReconnect）只覆盖 reconnect 复位 + markDown 分叉，**无一条断言** `info.capabilities` 缺失 → 跳过 list/attach 直接 new spawn，也无双保险 catch（unknown rpc → `rpc:res ok:false`（`hostCore.ts:264,270`）→ 退化）。整个协议追加设计押在这条兼容性上，却裸奔无测。

**建议**：加 TC（unit·hostClientReconnect）：`capabilities` undefined → 不发 session.list/attach、走 new spawn；可选加 integration 断言旧 core 收到未知 method 回 `ok:false`。

### QA-B-6 · MED · AC-14 · TC-028 缺「旧 owner A 不再收到输出」的**否定断言** → 区分不了「转移」与「被禁的扇出」

**问题**：TC-028 Then 只断言「send 转移到 B」「后续输出路由到 B」。一个错误的**扇出**实现（同时发 A 和 B）也能过「B 收到」。要证 last-attach-wins 的**单所有者转移**（AC-14·非扇出），必须**同时**断言 A 转移后**不再**收到该 sid 的 `pty:data`。`TestClient.ptyData` 按 client 分别累加（`wsTestHarness.ts:102-107`），这个否定断言完全可写。TC-029 只覆盖 A 的 **input** 被拒，没覆盖 A 的 **output** 停止。

**建议**：TC-028 补「B attach 后 A 的 `ptyData[sid]` 不再增长」否定断言。这正是转移 vs Out-of-Scope 扇出的判别点。

### QA-B-7 · MED · AC-5/AC-12 · 两个不同来源的 exitCode 都叫 "exitCode"，TC-012 有接错线风险

**问题**：`sessionTracker` 的 cmd-done exitCode（`sessionTracker.ts:97-102` OSC133 D）是**最近一条命令**的退出码；而 `SessionSnapshot.exitCode`（AC-12「✓ exit 0」徽标）应为**进程/会话**退出码（`ptyPool.ts:95` onExit 的 exitCode）。TC-012 说 tracker.snapshot() 暴露 exitCode「from cmd-done exitCode 序列」= 命令退出码。若 dev 把 `SessionSnapshot.exitCode` 从 `tracker.snapshot().exitCode` 取，AC-12 徽标会显**最近命令**退出码而非 build/进程退出码。TC-012 与 TC-023/024 各自内部自洽，但同名 exitCode 邀请交叉接错。

**建议**：TC-012 注明 tracker.snapshot().exitCode = 最近命令退出码、**不是** SessionSnapshot.exitCode 的来源；TC-023/024 补一条独立断言：session `exit 3` → `snapshot.exitCode===3` 来自进程 onExit（与任何 cmd-done 无关）。

### QA-B-8 · MED · 集成/单测基建 · 关键测试 seam 未在 TECH/TC 声明，dev 会中途撞墙

**问题**：几处 seam 是前置但没写明——
- `startTestHost`（`wsTestHarness.ts:30-47`）硬编码 `createHostCore()` 无 mode 入参，`TestHostOptions` 无 mode。而 AC-1/AC-12（detach/exited 仅 standalone）需 standalone core、TC-003 需 embedded core。集成套件跑不起来除非先给 harness 加 mode 选项。
- TC-026/027（AC-13 心跳）标 `level: unit`，但 `hostClient.ts` 现无 heartbeat、且 `connect()` 自建 MessagePort/WebSocket（`:180-240`）**无 transport 注入 seam**——要单测「host.info 探活超时→判断线」需注入一个「静默不回」的 fake transport 或把心跳逻辑抽成纯模块。否则 TC-026/027 只能整成 integration，与 `level: unit` 矛盾。
- TC-001「pool.pid 仍非空」需白盒读 `core.pool.pid(sid)`（HostCore 确实暴露 `pool`，`hostCore.ts:63,142`，可行），但断线 client 才知 sid——须写明经 `core.pool` 白盒 vs 经新 client `session.list` 观测，别留给 dev 猜。

**建议**：TECH §测试策略补：startTestHost 增 `mode` 选项；hostClient 心跳走 transport 注入 seam（或抽纯模块类比 reconnectBackoff）；逐条钉死每个 integration TC 的内部态观测路径。

### QA-B-9 · MED · AC-1（补 QA-B-2 之外的层）· 集成侧「输出持续入 ring 不 pause」如何证「不 pause」同样含糊

**问题**：TC-001（integration）Then「PTY 子进程继续运行且持续产出（断开期无 ack 也不 proc.pause 憋停）」+「输出继续填入环形缓冲」。经协议侧证「续跑 + 入 ring」可行（重连 attach 看到断开期字节）。但「不 pause」在协议侧与「ring 有界驱逐」难区分（两者都表现为重连只看到部分尾部）。与 QA-B-2 同根：pause 无可观测量。

**建议**：把 TC-001 的「不 pause」判据交给 QA-B-2 的行为断言（onData 越水位持续），TC-001 只留「断开期字节可经重连回放」这条协议侧可证的。避免两条 TC 都靠不可观测的 pause。

---

## LOW

### QA-B-10 · LOW · AC-6/AC-13/AC-15 · 退避 base/cap/预算 的 env/注入未钉死，TC-013/014 有挂钟风险
TC-013 cap 30s、TC-014 预算「8 次/~2min」。TECH 只显式点了**心跳** interval/timeout env 可注入（AC-13/M-3），退避 base/cap/预算的可注入仅隐含于「抽 reconnectBackoff.ts 便于单测」。若不注入，TC-013/014 会真等 30s/2min。建议 TECH 明写 backoff base/cap/预算构造或 env 可注入。

### QA-B-11 · LOW · 优雅降级 · host 进程重启→session.list 空→全 new spawn 未测
TECH §错误处理列了「host 进程重启→内存态全失→list 空→renderer 全 new spawn（优雅降级非崩溃）」，TC 无覆盖。非核心但属声明的降级路径。建议补一条 renderer 单测（list 返回空 → 每个记了 sessionId 的 inst 走 new spawn），或明确 defer。

### QA-B-12 · LOW · AC-5 · 「快照不含未读计数字段」是 shape/缺失断言，非行为
TC-011/012 断言「快照不含未读计数字段」。设计上根本不加该字段，故这是结构/类型层缺失断言，运行时测不出增量价值（TS 形状即可保证）。保留作护栏无害，但别当行为测计入覆盖强度。

---

## 分层合理性结论（正面确认）

- **host 侧集成分层正确**：AC-1/3/4/8/9/11/12/14 走真 hostCore+真 ws+真 pty 是对的——detach 存活、exited 驻留、last-attach-wins 所有权转移、token 闸都是 host 权威行为，必须端到端真跑，wsTestHarness（`createHostCore`+`startWsServer`+真 ws client）确能承载。**未见**「本该集成却 mock 掉」的 host 侧漏网。
- **renderer 单测分层正确**：AC-15 suppress-drop（mock terminalRegistry+store 直驱）、AC-6 backoff、AC-10 reconnect 走单测，与既有 `remoteWorkspaceSync.test.ts`（vi.hoisted + vi.mock hostRegistry/store）惯例一致，可写。
- **唯一分层事故风险 = QA-B-1**：AC-3 的 host 契约集成覆盖了，但 renderer 消费（readoptHost 的 reset-vs-增量 + 字节记账）被 TestClient「mock 掉」——两侧各自会绿、真实 double-write 仍可能发生。这就是任务里点名要揪的「两边 mock 各自绿、真实相反」的那类事故，落在北极星风险上，故定 HIGH。

## 异常/边界覆盖对账（TECH §错误处理 8 条）

| # | 失败路径 | TC 覆盖 | 结论 |
|---|---------|---------|------|
| 1 | 退避失败 | TC-014 | ✅ |
| 2 | gap 超缓冲→full | TC-007 | ✅ |
| 3 | exited 逐出（选最旧 exited·不逐 live） | — | ❌ QA-B-4 |
| 4 | 会话数上限拒新建 | TC-017 | ✅ |
| 5 | token 拒 | TC-015 | ✅ |
| 6 | 双 spawn 防护 | TC-021 | ✅ |
| 7 | 截断切坏序列 | TC-008（UTF-8 真·CSI/OSC 挂名） | ⚠️ QA-B-3 |
| 8 | resize 错行 | TC-022 | ✅ |
| + | host 重启空 list 降级 | — | ⚠️ QA-B-11 |
| + | 旧 host 兼容退化 | — | ❌ QA-B-5 |

## 收口清单（进 dev 前）

1. **QA-B-1**（HIGH）新增 terminalRegistry.readoptHost 渲染层单测（reset-vs-增量 + bytes 记账），TC-005/011/024 按层拆从句。
2. **QA-B-2**（HIGH）TC-002 的 paused 断言改行为式（onData 越水位续发）或加 PtyPool test seam。
3. **QA-B-3**（HIGH→MED）TC-008 收窄到 UTF-8，CSI/OSC 移集成/full 回退。
4. **QA-B-4/5/6/7/8/9**（MED）补 exited 逐出选择测、兼容退化测、AC-14 否定断言、exitCode 双源澄清、harness/心跳注入 seam 声明、AC-1 不-pause 判据归并。
5. **QA-B-10/11/12**（LOW）钉死 backoff 注入、补/defer 重启降级、认清缺失断言价值。

这些均为 **TC/TECH 层可修**（补测 + 钉可观测量 + 收窄挂名），非方案返工。修完可 APPROVE。
