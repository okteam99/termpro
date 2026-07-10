---
verdict: NEEDS_REVISION
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: subagent-fallback
degraded_reason: "项目 localconfig disable_external_review=true 单模型 opt-out·无异质跨模型源·降级同模型(opus)隔离 subagent 冷审兜底(BL-003/004 同基线)"
review_via: subagent
feature_id: TERMPRO-F260710042746-Reconnect-Continuity
review_scope: blueprint
reviewed_at: "2026-07-10"
---

# BL-005 断线重连与会话连续性 · blueprint v0.2 官方降级外审

## Verdict 依据

独立冷审：逐文件读取真实代码交叉核验了 blueprint 的「现状基线」全部 decisive 前提——**8 硬门根因与行号全部核实成立**，v0.2 声明的 **7 条 high 收口逐条真解、且相互自洽**（见文末「前序收口确认 resolved」）。核心架构（会话态权威留 host + 环形缓冲回放源 + exited 保留态 + renderer 显式重连/幂等收养/绝对偏移增量回放）方向正确、grounded、YAGNI 边界清晰。

给 **NEEDS_REVISION** 的唯一实质原因：v0.2 为解「connect() 在 ready 态 no-op」而引入的 **disconnect-first（ARCH-B-1）本身制造了一条新的反馈路径——`disconnect(configId)` 会向渲染层 re-emit `disconnected` 事件**，而该事件的两个既有/新增消费者（Sidebar 旧 drop 计时器 + reconnectController 自身状态机）如何消化「自己触发的 disconnected」**没有被闭合**。这与 v0.2 已给足 HIGH 处理的**对称** `verifying` 双订阅问题（ARCH-B-2）同构，却未获同等显式收敛，且现有抑制测（TC-030/031）在 reconnectController 层 mock，**测不到这半侧接线**。这是「收口引入的新问题」，非翻旧账，属 P0（AC-15）north-star 守门范畴，故要求一次修订。其余为 low 完整性缺口，可一并带入。

---

## Findings

### CR-1 · high · disconnect-first 自发 `disconnected` 事件未与 Sidebar 旧 drop 计时器 / reconnectController 自身 loop 闭合，且测试在其之上 mock
- **checklist**: C4 / C6（TECH 架构一致性 + TC↔TECH 对齐）
- **location**: `orchestrator.ts:290`（disconnect 内 `safeEmit({stage:'disconnected'})`→ `:376` 广播给**全部** listeners）× `Sidebar.tsx:301-314`（`disconnected` → 900ms → **无条件** `stopRemoteWorkspaceSync` full drop）× 新增 reconnectController（TECH L1068 «app 层心跳/disconnected 判定断线»）；测试 TC-030/031 = `reconnectSuppressDrop.test.ts`（TECH L1117「mock terminalRegistry + 直驱 store」）
- **issue**: disconnect-first 的 mermaid（TECH L1092-1101）把 `M->>M: emit disconnected` 当成「只做 stage 记账」，但 `orchestrator.emit`（`:376 for (const cb of this.listeners) cb(event)`）会把这条 disconnected **回推给渲染层每一个订阅者**。于是：(a) **Sidebar 旧 panel effect** 收到这条 disconnected → 起 900ms 计时 → `stopRemoteWorkspaceSync`（dispose 全终端 + 删 ws + drop client）= 正是 AC-15 要抑制的 full drop；(b) **reconnectController** 同样订阅 disconnected，若不识别「这条是我自己 disconnect-first 发的」，会把它当新断线 → 再 reconnecting → 再 disconnect(configId) → **自激循环**。v0.2 对同构的 `verifying` 双订阅（beginHandshake vs reconnectController，ARCH-B-2/EXT-B-1）给了 call-site 级显式收敛，`disconnected` 这条对称边却只有一句「改由 reconnectController 决策」（L1077），既没定「Sidebar 计时器如何被 reconnecting 门死/移除」，也没定「reconnectController 如何忽略自发 disconnected」。
- **rationale**: 现码 `disconnect()` 确会 emit disconnected（`:287-290` wasActive=ready → safeEmit）；`emit` 确广播全 listeners（`:376`）；Sidebar 确无条件在 900ms 后 drop（`:304-314`）。三者叠加即：reconnectController 的 disconnect-first 动作会亲手喂饱 Sidebar 的 full-drop 计时器，除非显式门断。而 TC-030/031 在 reconnectController 层 mock terminalRegistry+直驱 store，**只证控制器决策对，证不到 Sidebar 半侧计时器被真正抑制**，也证不到 loop 不发生。
- **suggestion**: ① 显式指定 `disconnected` 单一 owner——把「disconnected → {reconnecting | drop}」收敛进 reconnectController，Sidebar panel effect 的 `stopRemoteWorkspaceSync` 调用改为**仅由 reconnectController 的确定断线分支触发**（或计时器回调 fire 时 re-check reconnecting 态再决定 drop）；② reconnectController 状态机显式声明「进入 reconnecting 后，对自身 disconnect-first 触发的 disconnected 为幂等 no-op」（同 verifying 期的自驱事件不重复触发）；③ 补一条**接线级**抑制测（真订阅 remoteHost 事件流或直驱 Sidebar effect + reconnectController），断言「reconnecting 期收到（含自发的）disconnected 时不 `stopRemoteWorkspaceSync`」——补齐 TC-030/031 覆盖不到的这半侧。

### CR-2 · low · 所有权转移的 `sessionOwners` 结构只在风险表出现，未落 §数据结构
- **checklist**: C4（TECH 架构一致性）
- **location**: TECH §数据结构（Session/无 Client 表）vs 风险表 L1160「hostCore `sessionOwners` map O(1) 移旧加新」；现码 `hostCore.ts:56 Client.sessions: Set<string>`
- **issue**: last-attach-wins 转移（AC-14）与假死窗幂等收养（AC-11）都依赖「从**旧 owner** 的 `client.sessions` 摘除 sid」（reattach 三不变式②，L1022）。要按 sid 找到当前 owner，需要一张 `sessionId→Client` 映射（或遍历 clients）。该结构只在风险表被点名「O(1) map」，§数据结构 / §接口均未定义它住哪、何时建/删条目（spawn 建？onExit 删？detach 时如何处理？）。
- **rationale**: 缺了它，转移②不变式无处落地；dev 依 §数据结构 实现会缺这层，可能退化成「遍历 clients 找 sid」（功能可但与声称 O(1) 不符）或漏删旧 owner（触发 CR 风险表所述的「旧连接 close 误动已转移会话·楔死」）。
- **suggestion**: 在 §数据结构补一节 `sessionOwners: Map<sessionId, clientId>`（或明写「遍历 clients」的取舍），并规定其在 spawn/attach/onExit/detach 四处的维护点，与 reattach 三不变式②对齐。

### CR-3 · low · exited 逐出「排序键=exit 时间」缺对应的 Session 时间戳字段
- **checklist**: C6（TC↔TECH 对齐）
- **location**: TECH §数据结构 Session 表（有 status/exitCode/evicting，**无 exitedAt**）vs TC-037 / ARCH-B-8（L1171「排序键=exit 时间·Map 迭代序=插入序≠完成序·须显式按 exit 时间」）
- **issue**: TC-037 断言「逐**最旧 exited**（排序键=exit 时间）」，ARCH-B-8 特意警告不能靠 Map 插入序。但 Session 数据结构没有承载 exit 时刻的字段（exitedAt / exitSeq），无从据以排序。
- **rationale**: 依 §数据结构 字面实现的 dev 手里没有 exit 时间，只能退回 Map 迭代序——正是 ARCH-B-8 明令禁止的、会逐掉「早完成的长任务 exited」威胁 north-star 的实现。
- **suggestion**: Session 表加 `exitedAt: number | null`（onExit 时 `Date.now()` 记入），逐出比较该键；或加单调 `exitSeq` 计数器。TC-037 断言据此字段。

### CR-4 · low · exited 会话滞留 pool 后，进程名轮询仍对死 pty 读 `.process` 且轮询永不停
- **checklist**: C2 / C3（错误路径 + 资源）
- **location**: `ptyPool.ts:145-146`（`for (const s of this.sessions.values()) { const name = s.pty.process; ... s.tracker.tick() }`）+ `:157-158`（`stopPollingIfIdle` 判 `sessions.size === 0`）；EXT-B-6 只对 `pid()`/`pty.cwd` 显式返 null（TECH L958）
- **issue**: exited 会话「仍在 pool（未 delete）」（TC-023），而 ensurePolling 遍历 `this.sessions.values()` **含 exited**，每 1.5s 对已死 pty 读 `s.pty.process`、调 `s.tracker.tick()`；且只要有任一 exited 滞留，`sessions.size` 永不为 0 → 轮询定时器**永不停**（deep-night build 完成后 exited 留存整晚 = 定时器空转整晚）。EXT-B-6 收口了 pid()/cwd 对 exited 返 null，却没覆盖轮询循环这条 `.process` 死 pty 读路径。
- **rationale**: 对死 pty 读 `.process` 行为依 node-pty 未定义（返陈旧名/空/潜在抛错），tracker.tick() 对 exited 会话还可能误 emit quiet 污染语义；轮询空转是 north-star「留存整晚」放大的资源浪费。
- **suggestion**: ensurePolling 循环内 `if (s.status === 'exited') continue`；`stopPollingIfIdle` 的 idle 判据改为「无 **live** 会话」而非 `size===0`（exited 不需要轮询）。

### CR-5 · low · 路径①（闪断）「回放-then-append 顺序」的成立机理表述有误，易误导实现者
- **checklist**: C4（TECH 架构一致性）
- **location**: TECH reattach 三不变式③（L1023）：「靠 host 先发 rpc:res 后发 pty:data 的 wire 序 + hostClient `bufferedData` 微任务排空成立；闪断路径旧 ptyListener（键=同 sessionId）reconnect 后仍在」
- **issue**: 闪断路径下旧 `ptyListener` 仍注册（该 note 自己也承认），意味着 live `pty:data` 直接命中 listener→同步 `term.write`，**根本不走 `bufferedData`**（`hostClient.ts:317-324` 只在无 listener 时缓存）。所以「bufferedData 微任务排空」这条机理在闪断路径**不适用**；真正保证「回放切片先于 live 写入」的是 **WebSocket 逐消息 macrotask 边界**（每条 onmessage 独立宏任务，微任务在其间排空 → attach 的 rpc:res `.then` 里的回放写入先于下一条 pty:data 的 onData），**且仅当回放写入紧接 attach resolution 同步完成、其间无额外 await** 时成立。
- **rationale**: 若 dev 采信「bufferedData 微任务排空」这条（错误）机理，会以为缓存机制在兜底顺序，从而放心在 readoptHost 里 attach resolution 与回放写入之间插入 await（如重 fit、二次 list）——一旦插入 await 就开了宏任务窗，live pty:data 可抢先写入，回放切片盖上去 = 错序/双写。
- **suggestion**: 把③的机理更正为「逐消息 macrotask 边界 + 回放写入须与 attach resolution 同步紧邻（禁 await 间隔）」，并把它列为 readoptHost 路径①的显式实现约束（不变式），而非依赖 bufferedData。

---

## Advisory（留痕·非门禁）

- **A1 · ring 容量 256KiB 是 north-star 的直接调参却未列「待决策」**：detach 期旁路流控续跑、ring（默认 `TERMPRO_SESSION_RING_BYTES`=256KiB）只留最后 256KiB；断线期 build 若尾部输出 >256KiB，重连走 full 清屏回放最后 256KiB——完成日志/退出码能否幸存直接由此上限决定。§待决策只列了会话数上限与心跳周期，建议把 ring 字节上限也纳入评审可调项（与 north-star 直接相关）。
- **A2 · app 层心跳超时与 `RPC_TIMEOUT_MS`(15s) 的关系未言明**：心跳目标 T≈10s（interval 5s+timeout 5s），但 host.info 走 `hostClient.rpc` 自带 15s 超时（`hostClient.ts:28`）。若心跳复用 rpc 超时而非自持定时器，判断线会滑到 15s（破 AC-13 上界）。QA-B-8 已声明「抽纯模块 + 注入 seam」，建议顺带明确「心跳用自持 `heartbeatTimeoutMs` 计时、不依赖 RPC_TIMEOUT_MS」。
- **A3 · 远程 markDown 分叉后在途 rpc 的清理**：markDown remote=「非终结·不永久拒 rpc」（TC-020），则断线瞬间挂在死 transport 上的在途 rpc（含心跳 host.info）不会被 markDown reject，只能等各自 15s 超时。功能无害（最终会 reject），但重连期调用方会悬 15s。建议 reconnect() 复位 transport 时顺带 reject/清理旧 transport 的 pending（避免悬挂延迟）。

---

## 前序收口确认 resolved（非翻旧账·逐条交叉核验真解）

| v0.2 声明的 high 收口 | 交叉核验结论 |
|---|---|
| **ARCH-B-1** disconnect-first 复位 main stage | ✅ 真解：`disconnect()` wasActive=ready → `safeEmit({disconnected})` → `emit` 置 `session.stage='disconnected'`（`orchestrator.ts:287-290/374`）；`ready→disconnected→connecting` 均合法边（`:53/:55`）；`connect()` 的 `ACTIVE_STAGES.has('disconnected')===false`（`:64-71/:257`）→ 真能进 runConnect。机制成立（但 emit 的**回推副作用**未闭合 → CR-1）。 |
| **ARCH-B-2/EXT-B-1** verifying 单一 owner + 并发再入守卫 | ✅ 真解：`Sidebar.beginHandshake:247` 确调 `connect({wsUrl})` 命中陈旧 `connectPromise`（`hostClient.ts:155`）；改 `reconnect()` 复位后开新 ws、对初次 connectPromise=null 等价，单一入口消双订阅，方向正确。 |
| **ARCH-B-3** detach 解已 paused + reattach unacked 复位 | ✅ 真解：现码 `onData` 无 attached gate、`ack` 是唯一 resume 路径（`ptyPool.ts:88-91/108-115`），无 renderer 即无 ack → detach 内 `paused=false;proc.resume();unacked=0` 是「续跑」不落假的必要手段。行为断言（TC-002 灌>512KiB 打到 paused 再 detach）设计正确。 |
| **ARCH-B-4/EXT-B-5** 游标 onData 同步累加 + nextOffset 权威 | ✅ 真解：现码 `renderedBytes` 记账点在 write 回调（`terminalRegistry.ts:182`）确为异步；改「onData 同步累加=已接收高水位」+ `renderedBytes=nextOffset`（不自算 byteLength）消除在途写队列致游标滞后双写。pty:data 已带 `bytes` 字段（`protocol.ts`/`hostClient.ts:319`）支撑按字节累加。 |
| **EXT-B-2** residency claim 有界重试复用 storedToken | ✅ 真解：现码 `resolveResidency` 候选路径 `probeHostInfo` **单探**（`residency.ts:177`），失败即落 `decideResidency` → tag-match+alive → `reapThenDeploy` kill（`:81-82`）= 假阴性会连断线期跑完的 build 一并销毁。加有界重试（`TERMPRO_CLAIM_PROBE_RETRIES`）+ 复用 storedToken 正解，TC-039 守门到位。 |
| **QA-B-1** readoptHost 渲染层测 + 按层拆从句 | ✅ 真解：新增 T-032~036（真实文件 `terminalRegistryReadopt.test.ts`）断言 reset-vs-增量 / bytes 记账（CJK bytes≠length）/ nextOffset 权威 / found=false→new spawn / 徽标对账 / 路径②重建 tab；host 集成测只断协议字节、渲染断言下移，分层正确。 |
| **QA-B-2** AC-1 改行为断言 | ✅ 真解：`paused` 是私有无 getter（`ptyPool.ts:14`），白盒可被假标志骗过；改「onData 越水位持续发射」行为断言天然防幽灵，判据正确。 |

其余 v0.2 med/low 收口（reattach 三不变式 ARCH-B-5、exited attach 跳 resize ARCH-B-6、D-4 重建 tab 路径 EXT-B-3、reconnecting 非锁定 EXT-B-4、AC-14 否定断言 QA-B-6、exitCode 双源 note QA-B-7、心跳注入 seam QA-B-8、UTF-8 收窄 ARCH-B-7、exited pid()=null EXT-B-6）均已在文中落到 TC/数据结构/错误表，抽样核验与真码一致——除 CR-2~CR-5 指出的四处完整性缺口外，自洽。

---

## 一句话总结

核心方案 grounded 且 sound、7 条 high 收口逐条真解，但 disconnect-first（ARCH-B-1）这条 v0.2 新收口**引入了一条自发 `disconnected` 事件的反馈路径**，其对 Sidebar 旧 full-drop 计时器与 reconnectController 自身状态机的消化未闭合、且现有抑制测在其之上 mock（CR-1 high）——补齐这半侧接线与测试、并顺带收 CR-2~CR-5 四处数据结构/资源完整性缺口后即可 APPROVE。
