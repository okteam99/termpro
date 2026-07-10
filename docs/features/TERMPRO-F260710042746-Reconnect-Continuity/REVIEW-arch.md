---
verdict: NEEDS_REVISION
reviewer: 架构师(冷审 · grounded)
scope: git diff 954dcc0..HEAD -- src/(BL-005 断线重连与会话连续性)
date: 2026-07-10
---

# BL-005 实现代码架构冷审

## 结论

**NEEDS_REVISION**。核心的 host 侧并发/时序不变式（reattach 所有权转移原子性、detach 解 paused、
exited 保留态与逐出排序、游标 onData 同步累加、embedded 零回归、residency claim 有界重试）**逐条
grounded 核验成立**——这些是本 Feature 声称的「最难处」，实现是扎实的。

但**断线重连的 renderer↔main 集成接线有两处 BLOCKER**，导致「重连收养/回放」与「自动退避重试」这
两条主 AC 路径在真实端到端下**不工作**：readopt 被 main 的 `ready` 事件在**新 ws 尚未打开**时触发
→ `session.attach` 必然 reject → 收养静默中止（A1);`onAttemptFailed` **在生产代码中无任何调用方**
→ 指数退避重试与超预算 drop 状态机全程空转（A2)。两者根因一致:纯逻辑单测覆盖到位、**里程碑集成
接线未闭合**（与 `reconnectWiring.ts:38` 自述「path② 由整合方补」同一模式)。加一条 MAJOR(AC-12
exited 徽标在收养路径未落地)。

修掉 A1/A2/A3 后核心即 sound，可 APPROVE。

---

## Findings

### A1 · BLOCKER · readopt 由 main 的 `ready` 事件在新 ws 打开前触发 → 重连收养必然失败 · open

**证据链:**
- 重连时 orchestrator 的 claim 快路径**同步**先后 emit `verifying` 再 emit `ready`:
  `src/main/remote/orchestrator.ts:550-557`（deploy 路径同款 `:655-660`)。
- 两个事件**无过滤**转发给 renderer:`src/main/remote/remoteHostIpc.ts:33-37`
  （`orchestrator.onEvent(e => win.webContents.send(channel, e))`)。
- renderer 收 `verifying` → `beginHandshake` **异步、不 await** 地开新 ws:
  `src/renderer/components/Sidebar.tsx:251-259`（`client.reconnect({ wsUrl }).then(... applyRuntimeEvent(ready))`)。
  `reconnect()` 内 `this.transport = null`，transport 直到 `ws.onopen` 才由 `attachTransport` 赋值:
  `src/renderer/services/hostClient.ts:253-275` + `:337-339`。
- renderer 收 main 的 `ready` → `runtimeMap` 变更 → ready useEffect **立即** `reconnectController.onReady`:
  `src/renderer/components/Sidebar.tsx:285-294`。
- `onReady` **先** `cleanup`（清 reconnecting)**再** `readopt`:`src/renderer/services/reconnectController.ts:120-127`。
- `readopt` → `adoptInst` → `await client.rpc('session.attach', …)`:`terminalRegistry.ts:358`。此时
  transport 仍为 null → `rpc()` **同步 reject** `'host not connected'`:`hostClient.ts:360-362`。
- `adoptInst` 的 `reject` 经 `finally`（只复位 replaying)**继续上抛** → `readoptHost` 首个 `await adoptInst`
  抛出 → 整个 `readoptHost` reject → `onReady` 的 `void deps.readopt(configId)` **静默吞掉**
  （`reconnectController.ts:125`)。

**为何是 BLOCKER（确定性、非偶发)：** main `this.emit(verifying); this.emit(ready);` 是**同步无 await**
两连发，两条 IPC 消息在 renderer 处理 `verifying` 之前就已入队;renderer 处理 `verifying` 时才 `new WebSocket`，
其 `onopen` 事件要等一次穿隧道到远端 wsServer 的完整 ws 握手（网络 RTT)才入队——**必然晚于**已在队里的
`ready`。故 `ready`→`onReady`→`session.attach` **恒**在 ws 打开前跑、**恒** reject。后果:
- 收养中止 → 无回放;host 侧该 session 仍 `detach`（`send=noop`)所有权未转移 → **无 live 输出**;
  旧 `inst.term.onData → client.input` 因 host 新 client `client.sessions` 不含该 sid 被拦（`hostCore.ts:115`)→
  **打字也无反应**。重连后远程终端**冻结**，击穿 AC-3/AC-4/会话连续性北极星。
- `onReady` 已清 reconnecting，之后 `beginHandshake.then` 合成的第二个（ws 已开的)`ready` 命中
  `wasReconnecting=false` → **不再重试 readopt**。手动「立即重试」走同一时序 → **同样失败** → 永久冻结。

**为何单测没抓到:** `terminalRegistryReadopt.test.ts` 用 fake client 直接返回 attach 结果、无 transport-null
时序;`reconnectController` 单测用 fake `readopt`（resolve)。端到端「main ready 先于 ws 打开」的 orchestration
时序无任何测试覆盖。

**修复方向（择一):** ① readopt 的触发点从「main 的 raw ready」改为 `beginHandshake` 的 `client.reconnect().then`
之后（ws 确已打开)显式调用;或 ② `readoptHost`/`adoptInst` 在 `session.attach` 前 `await client.connect()`
（复用 in-flight connectPromise，确保 transport 就绪)再发 rpc;或 ③ `onReady` 仅在 renderer 合成 ready
（区别于 main 的 fast-path ready)时驱动 readopt。任一都需补一条端到端时序断言。

---

### A2 · BLOCKER · `onAttemptFailed` 生产无调用方 → 自动退避重试 + 超预算 drop 状态机全程空转 · open

**证据链:**
- `ReconnectController.onAttemptFailed` 是退避重试与「超预算→确定断线 drop」的**唯一驱动**:
  `src/renderer/services/reconnectController.ts:100-118`（失败 → `overBudget?definite:排 backoff timer→fireAttempt`)。
- `fireAttempt` 的三个调用点:`onDisconnected`（立即首试 `:97`)、`onAttemptFailed` 排的 timer（`:115`)、
  `manualRetry`（`:138`)。**自动续试只可能经 `:115`**，而它挂在 `onAttemptFailed` 上。
- 全仓 grep:`onAttemptFailed` **仅出现在 reconnectController.ts 与 __tests__**，生产接线（`reconnectWiring.ts`、
  `Sidebar.tsx`)**从不调用**。Sidebar 只接了 `onReady`（`:294`)、`onDisconnected`（`:299`)、
  `manualRetry`（`:616`)。
- 重连失败的真实事件是 main emit `'failed'`（`orchestrator.failSession`)与 `beginHandshake.catch →
  applyRuntimeEvent(failed)`（`Sidebar.tsx:261-267`)——**都没有**接到 `onAttemptFailed`。

**为何是 BLOCKER:** `onDisconnected` 只 fire **一次** attempt（`fireAttempt` 首试)。该次 `connect()` 若失败
（网络仍未恢复、ssh connect 抛、host 拒 token…)→ main emit `failed` → 无人推进状态机 → **不排退避 timer、
不再重试、也不因超预算 drop**。reconnecting 永久 true，横幅永久「重连中…」，只有用户手点「立即重试」能再
试一次（且仍无自动续试)。这直接使 AC-6「指数退避续试(base 1s×2, cap 30s，预算 8 次)」与 D-13/AC-15
「超预算→确定断线→full drop」在自动路径下**完全不生效**。北极星「合盖过夜、醒来自动重连」在首试落网络窗口
外（醒来瞬间网络常未就绪)时**必然**卡死。

**为何单测没抓到:** `reconnectSuppressDrop.test.ts` **手动**调 `controller.onAttemptFailed('cfg-1')` 六次来
验证退避/超预算逻辑——逻辑本身对，但**没有测「谁在生产里调它」**，正好漏掉这条缺失的接线。

**修复方向:** 在 Sidebar 的事件订阅里，把 main 的 `stage==='failed'`（以及 `beginHandshake.catch`)接到
`reconnectController.onAttemptFailed(configId)`；注意与 `onDisconnected` 的再入/预算计数对齐（首试已在
`onDisconnected` 里 `nextDelayMs()` 推进过)。补一条「失败事件驱动退避重试直至 drop」的接线层断言。

---

### A3 · MAJOR · 收养一个「断开期已退出」的会话时未落 exited 徽标(AC-12 渲染半侧缺失) · open

**证据链:**
- 正常 live 会话退出:`terminalRegistry` attachPty `onExit → inst.callbacks.onExit?.(exitCode)`
  （`terminalRegistry.ts:196-202`)→ `App.tsx:27` 的 `onExit: () => updateTab(tabId, { exited: true })`
  → `TabBar.tsx:210-211` 渲染「exited」。
- 但断开期退出的会话，renderer 从未收到 `pty:exit`（host `send=noop`)。重连收养走 `adoptInst`:
  拿到 `snapshot.status==='exited'` 后**只**置 `inst.exited = true`（`terminalRegistry.ts:446`、`:480`)，
  **既不**调 `inst.callbacks.onExit`、**也不**经 `reconcileBadge` 落 store。
- `reconcileBadge` 只写 `activity: idle`，**不碰 exited/exitCode**:`reconnectWiring.ts:18-24`。
- 结果:`store` 的 `tab.exited` 保持 false → TabBar 不渲染「exited」提示;`SessionSnapshot.exitCode`
  （host 已按 QA-B-7 正确取 onExit 进程退出码 · `ptyPool.ts:324`)拿到了却被丢弃 → AC-12「✓ exit N」
  在**正是北极星场景**（合盖期间 build 跑完)下不显示。

**严重度判据:** 非数据损坏（scrollback 仍回放、退出行仍在屏)，但 AC-12 是点名 AC 且正中北极星，退出码
已备齐却未透传属确定性 UI 落地缺失，记 MAJOR。

**修复方向:** `readoptHost`/`reconcileBadge` 在 `snapshot.status==='exited'` 时把 exited + `snapshot.exitCode`
透传到 store（等价触发 `updateTab(tabId,{exited:true})` 并带退出码)。

---

### A4 · MINOR · path②「session.list 有本地无 inst → 重建 tab」在生产被 stub 掉 · open

**证据:** `reconnectWiring.ts:38-40` 的 `rebuildTab: () => null`（自述「path②…store 接线属集成职责，由
里程碑整合方补」)。`readoptHost` 内 path② 逻辑（`terminalRegistry.ts:463-482`)与单测（T-036)俱在，但
生产恒返 null → **不重建**。后果:被关/已 disposeTerminal 的 tab 对应的断开期会话，重连后不会被发现重建
（AC-4「发现」在此路径退化)。常态下 path① 覆盖存活 inst，故记 MINOR，但需在里程碑整合明确补齐或显式降级
声明，不能停留在「stub 留 TODO」。

---

### A5 · MINOR · Sidebar 900ms drop 计时器的抑制在「main 先于心跳感知断线」时依赖 connecting 清 timer，而非纯 gate · open

**证据/分析:** CR-1 的主机制是「reconnectController 同步先占 reconnecting 再 disconnect-first，Sidebar
`:324` gate 到 `!isReconnecting` 不排 900ms drop」。但 `onDisconnected` 的**唯一**触发是
`client.onReconnectNeeded`（心跳判死 / transport close · `Sidebar.tsx:298-299`)。若 ssh 干净断连使 main
的 `handleTransportDown` **先于** renderer 感知 emit `disconnected`（`orchestrator.ts:420-427`)，则该
`disconnected` 到达时 `isReconnecting` 仍 false → **900ms drop timer 被排上**（gate 只在排程一刻判断，事
后置 reconnecting=true 不撤销已排的 timer)。实际未 full-drop **仅**因随后 `connect()→emit 'connecting'`
（`prev==='disconnected'` 分支 `Sidebar.tsx:343` clearTimeout)在 900ms 内清掉 timer。即「不 drop」这个正确
结果依赖的是 connecting-清-timer 这条侧路，而非 CR-1 声称的纯 gate。合盖冻结 TCP 场景（心跳先于 main)不受
影响、清连断连场景靠侧路兜住，故记 MINOR;但这条侧路脆弱（一旦 `connecting` 因任何原因晚于 900ms 就漏 drop)，
建议 reconnecting 置真时主动 `clearTimeout` 已排的 panel timer，把 CR-1 gate 做成真正闭合。

---

### A6 · NIT · 心跳判死后仍留一条挂起的 host.info rpc(≤RPC_TIMEOUT) · open

**证据:** `heartbeat.beat` 的 probe = `client.rpc('host.info')`（`hostClient.ts:203-206`)。心跳 timeout(默 5s)
先于 RPC_TIMEOUT(15s · `hostClient.ts:29`)触发 `die()`；原 probe promise 仍挂在 `pending` map，直到 15s
超时才清。`beat` 内 `settled` 卫已防重复处理，纯属短时一条悬挂条目，无正确性影响。可选:die 时清对应 pending。

---

## 已 grounded 核验成立的核心不变式(驳回「此处有 bug」的默认质疑 · 均回读真码确认)

1. **reattach 所有权转移原子性(不变式①②③) — 成立。** `hostCore.ts:296-332` session.attach:先同步
   从其余 client 的 `sessions` **摘除 sid**（`:299-301`)→ `pool.reattach` 换 send（`:303`)→ 加入本
   client（`:330`)，**全程无 await**。`ptyPool.reattach:271-299` 先 `ring.sliceFrom` 再 `s.send=newSend`
   同一 tick 完成，`nextOffset=absoluteOffset`。rpc:res(回放)在 `handleRpc:338` 同步发出、先于任何新
   `pty:data`（onData 回调排在同步 handler 之后)→ wire 序保证「回放 then live」。旧 owner close 因 sid 已
   摘除不会误 detach 新 owner（ARCH-B-5② 满足)。

2. **detach 解已 paused + pause gate to attached + reattach 复位 unacked — 成立。** `ptyPool.detach:245-255`
   `if(status==='live'&&paused){paused=false;pty.resume()}` + `unacked=0` + `send=noop`;onData pause 判据
   `session.attached && !paused && unacked>high`（`:157-164`);reattach `unacked=0;paused=false`（`:280-281`)。

3. **游标 onData 同步累加、用 host bytes、readopt 用 nextOffset — 成立。** `terminalRegistry.ingestPtyData:296`
   `inst.renderedBytes += bytes`（用 host `bytes` 形参、term.write `:297` 之前、同步)；`adoptInst:367`
   `inst.renderedBytes = result.nextOffset`（权威，不自算 byteLength)。CR-5 回放冻结:`replaying` + `replayQueue`
   先写切片再 flush live（`:287-318`、`:356-372`)。

4. **disconnect-first — 成立。** `reconnectController.fireAttempt:80-83` 先 `deps.disconnect` 再 `deps.connect`;
   接线 `reconnectWiring.ts:27-29` 映射到 `remoteHost.disconnect/connect`。`beginHandshake` 改 `client.reconnect`
   单一 owner（`Sidebar.tsx:251-252`)。

5. **exited 保留态 — 成立。** `ptyPool.onExit:168-186` standalone 自然退出转 `status='exited'`（不 delete)、
   `exitCode/exitedAt` 记录、`tracker.freeze()` 冻结、`stopPollingIfIdle` 停轮询死 pty(CR-4)。`ensurePolling:358`
   与 `stopPollingIfIdle:371` 均按 `status==='live'` 过滤。pid/resize/input/ack 对 exited 显式早返
   （`:196,206,213,234`)。逐出按 `exitedAt` 升序 `evictOldestExited:332-344`(ARCH-B-8)、拒逐 live。

6. **hostClient reconnect — 成立。** `hostClient.reconnect:253-275` 复位 down+connectPromise+关旧 transport+
   保 per-host 结构（listeners 不清)，`reconnectPromise` 并发再入守卫;`markDown`/`handleTransportClose` 按
   `reconnectable` 分叉本地终结 vs 远程触发重连（`:175-199`)。

7. **residency claim 有界重试 — 成立。** `residency.resolveResidency:189-213` 同隧道有界重试
   （`claimProbeRetries` 默 3 · env 可注入)、瞬时失败短退避重探、契约违反(throw)才立即关隧道归一失败;
   `decideResidency:67-89` 保持纯函数（只看最终 probeResult)，reap 仍仅在 alive+tag 全等匹配分支;
   claim 复用 storedToken 不换 token（`orchestrator.ts:543-546`)。

8. **本机 embedded 零回归 — 成立。** `host.ts:16-18` 无 --listen → `createHostCore('embedded')`;embedded
   session 不分配 ring（`ptyPool.ts:138`)、onExit 立即 delete（`:169-175`)、close→kill（`hostCore.ts:138`)、
   不进 `list()`（`ptyPool.ts:306`)、pause 判据经 `attached`（embedded 恒 true)与原语义等价。协议全为向后
   兼容追加（`protocol.ts`)、`capabilities` embedded 省略（`hostCore.ts:181-182`)。

9. **RingBuffer 游标/UTF-8 边界 — 成立。** `ringBuffer.ts` 字节记账 absoluteOffset/startOffset 正确、驱逐点
   与切片起点对齐续字节边界、offset<startOffset→full 整缓冲、offset≥absoluteOffset clamp 空增量,边界穷举
   均自洽。
