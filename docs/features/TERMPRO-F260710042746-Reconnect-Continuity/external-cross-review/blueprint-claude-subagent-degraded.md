---
verdict: APPROVE
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

# BL-005 Blueprint v0.3 官方降级外审复验

复验口径：只裁上一轮 5 条 finding 是否真解（CR-1 high / CR-2~5 low），不翻已 resolved 旧账。交叉核了真实代码 `src/renderer/components/Sidebar.tsx:298-326`、`src/main/remote/orchestrator.ts:276-292`、`src/host/ptyPool.ts:82-160` 以校 blueprint 现状基线与修法自洽性。

---

## CR-1（high）disconnect-first × AC-15 抑制接线闭合 — ✅ RESOLVED

**裁决**：闭合自洽·核心 sound。

**依据**：
- 问题前提**真实成立**（grounded）：`orchestrator.ts:290` `disconnect()` 在 `wasActive`（stage=ready/verifying）时 `safeEmit(configId,{stage:'disconnected'})` — 故 disconnect-first 确会向**全部** listener 自发广播 disconnected；`Sidebar.tsx:301→304→313` 正是 `disconnected`→`setTimeout(DISCONNECT_PANEL_MS≈900ms)`→`stopRemoteWorkspaceSync` 的真 full-drop 触发点；且 `orchestrator.ts:257` `ACTIVE_STAGES` 含 ready → connect() 在 ready 态确是 no-op，坐实 disconnect-first 是 stage 复位的必需前提。blueprint 对三处行号的引用与真码一致。
- v0.3 四步修法齐备且逻辑闭合（TECH §前端·CR-1 块 + §数据结构 + TC-030/031）：① reconnectController **同步先占** `reconnecting[configId]=true` 再调 disconnect-first；② Sidebar `:301` 判据 gate 到 `!isReconnecting(configId)`（reconnecting 期不启动 drop 计时器·改显「重连中」panel）；③ reconnectController disconnected 订阅**再入守卫** `if(reconnecting[configId]) return`（自发/重复 disconnected 不 loop）；④ drop **唯一出口**移到 reconnectController 超预算分支（清 reconnecting + 亲调 stopRemoteWorkspaceSync）。
- **时序自洽性核验（本轮重点探针）**：
  - *isReconnecting set 与 disconnect 先后*：自触发路径「同步先占 → await disconnect(IPC)」，set 先于 IPC 跨进程往返，disconnected 回旋时 reconnecting 必为 true。✅
  - *Sidebar gate 是否稳赢竞态*：Sidebar 的 drop 决策在 `useEffect([runtimeMap])`（`:298`）——**延后到 React commit 之后**执行，而任何同步 onEvent listener（含 reconnectController 的订阅）都在同一 dispatch 内、React commit 之前跑完。故只要 reconnectController 在其 disconnected 处理器里**同步**置 reconnecting，Sidebar 的 gate 必读到 true。此对**主进程侧自发 disconnected**（`handleTransportDown:420` / 新加 ssh keepalive）同样成立。✅
  - *多次断线*：再入守卫 `if(reconnecting[configId]) return` + reconnecting 仅在「成功重连 / 确定断线」清除 → flapping 期 gate 恒生效、不重入 loop。✅
  - *reconnecting 清除时机*：成功→ready（Sidebar `:315` `stage!=='disconnected'&&prev==='disconnected'` 清 panel）；超预算→④ 亲清并 drop。两出口互斥且各自收尾。✅
- 测层升级坐实：TC-030 从「单侧 mock」升到**接线层**（`:677` 标注非纯 mock），gherkin（`:679-687`）直接断言「reconnecting 期即便 >900ms·Sidebar 也不调 stopRemoteWorkspaceSync」+「reconnectController disconnected 订阅命中再入守卫不 loop」；TC-031 断言超预算才 drop。两半接线均被钉，CR-1 测盲区消除。

**一句话**：问题前提真实、四步修法闭合、关键竞态被 React effect 延后语义 + 同步先占 + gate 三者共同兜住，CR-1 真解。

---

## CR-2（low）sessionOwners 转移结构落 §数据结构 — ✅ RESOLVED

**裁决**：已落。

**依据**：TECH §数据结构（prompt L976）新增「sessionOwners（CR-2·hostCore 内·所有权转移单源）」条目：明写 hostCore 持 `sessionOwners: Map<sessionId, clientId>`（或等价现状的 per-client `sessions: Set`），last-attach-wins = **原子同步三步**（旧 owner `client.sessions` 摘除 sid → 加新 client → `pool.reattach` 换 send），并点名「摘除是关键」以防旧连接 close 时 `hostCore:125` 误 detach 已转移会话（ARCH-B-5②）。与现状基线（`hostCore.ts:107-119` per-client Set 守卫、`:125` close 回收）对齐，结构单源明确。TC-028 否定断言（B attach 后 A `ptyData[sid]` 不再增长）+ TC-029（旧 owner input 被拒）验其转移非扇出。

---

## CR-3（low）Session 加 exitedAt 作逐出排序键 — ✅ RESOLVED

**裁决**：已加。

**依据**：§数据结构（L971）新增 `exitedAt: number|null`（onExit 时刻 `Date.now()`），明确「会话数上限『先逐最旧 exited』排序键 = `exitedAt` 升序（最近完成的最后逐·保北极星刚跑完 build 最后被逐·ARCH-B-8）；live 会话 null 不参与」。与 TC-037（cap 满逐最旧 exited·live 全存活）、待决策表、风险表「排序键=exit 时间」三处一致，消解了「Map 迭代序=插入序≠完成序」的隐患。

---

## CR-4（low）exited 停轮询死 pty — ✅ RESOLVED

**裁决**：已收口·修法必需且正确。

**依据**：问题前提 grounded 且**严重性偏实**——`ptyPool.ts:144-154` poll 循环遍历 `this.sessions.values()` 读 `s.pty.process`（死 pty 读）+ `s.tracker.tick()`；`stopPollingIfIdle:157-161` 仅在 `sessions.size===0` 清全局 timer。exited 保留（不 delete）后，若不特判，poll 会对已死 pty 每 `PROCESS_POLL_MS` 空转 + tracker 永不停 = 真泄漏 + 噪声。v0.3 §数据结构 note（L974）明写「onExit 转 exited 时须停掉进程状态轮询（现 stopPollingIfIdle + tracker `pty.process` 轮询）；exited 态 tracker 冻结为退出时最终快照（state=idle·exitCode 定），不再轮询」，与 EXT-B-6（exited `pid()`/`pty.cwd` 显式返 null·勿对死 pid 调 processCwd）呼应，修法方向正确。

*Advisory（low·非阻断）*：blueprint 已捕获「per-session 跳过 exited」意图，但**全局 timer 停止判据**建议在实现步骤显式点出——现 `stopPollingIfIdle` 判 `size===0`，exited 保留后应改判「无 live 会话即可停」（否则全 live 完工但 exited 驻留时 timer 仍空转）。此为实现细节，intent 已在，不影响 blueprint 裁决。

---

## CR-5（low）路径①回放顺序机理修正 — ✅ RESOLVED

**裁决**：机理修正到位。

**依据**：TECH §接口 reattach 三不变式③（L1031）把 v0.2 的错误归因（`bufferedData` 微任务排空）修正为正确机理：靠 **host wire 序**——reattach 内**同步**先发 `rpc:res(回放切片)` 再切 `send`，此后 live `pty:data` 才经新 send 发出；两者是同一 ws 连接上的独立消息，renderer 按**逐消息到达序（macrotask 边界）**处理，故 rpc:res 先于 pty:data 被消费。并显式辨明 `bufferedData` 只在 connect 未 ready 前缓冲、闪断 reconnect 后 transport 已 ready 不走该缓冲（消除误依赖）。更进一步点出**闪断路径隐患**：旧 `ptyListener`（键=同 sessionId）reconnect 后仍在（保 per-host 结构）→ 要求 `readoptHost` 内「先 `session.attach` await 拿切片写完·再解冻/重挂 live 投递」，并明写「不可依赖两条独立路径的天然时序·此序 blueprint 显式声明·dev 不可默认知晓」。与不变式①（reattach 全程同步禁 await）互锁，构成完整的不双写/不乱序论证。

*Advisory（low·非阻断）*：「解冻/重挂 live 投递」隐含「冻结期 live pty:data 须**缓冲不丢弃**」（否则 await 窗内到达的 nextOffset 之后字节丢失 = gap）。建议实现步骤 15 显式一句「冻结=挂起投递并缓冲·解冻时按序释放·非 detach 丢弃」。此为实现纪律，非机理缺口。

---

## 总结

上轮 5 条 finding **逐条真解**：CR-1（high）的接线闭合前提真实、四步修法自洽、关键竞态被「React effect 延后 + 同步先占 reconnecting + Sidebar gate」三重兜住，未见残漏时序；CR-2~5 均落到 §数据结构 / §接口 / TC，并与真实代码基线（Sidebar/orchestrator/ptyPool 行号）交叉核对一致。仅 3 条 low advisory（CR-4 全局 timer 停止判据、CR-5 冻结即缓冲、以及 CR-1 建议在文档补一句「主进程侧自发 disconnected 路径亦同步置 reconnecting」显式约束），均属实现纪律留痕、不构成实质缺口。核心方案 sound → **APPROVE**。
