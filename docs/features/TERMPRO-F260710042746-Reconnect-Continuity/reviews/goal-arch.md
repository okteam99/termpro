<!-- TEAMWORK-MACHINE · Architect 冷审产物 · goal 阶段 · BL-005 -->
# Architect 冷审 · BL-005 断线重连与会话连续性 (PRD goal review)

- feature_id: TERMPRO-F260710042746-Reconnect-Continuity
- reviewer_role: Architect
- review_target: docs/features/TERMPRO-F260710042746-Reconnect-Continuity/PRD.md
- date: 2026-07-10

## verdict

**changes_requested**(方向成立 · blueprint 前须收口 3 个 load-bearing 技术一致性缺口)

PRD 方向正确、grounded 扎实:「按 host 形态分会话存活语义 + host 侧 scrollback 环形缓冲 + 重连认领回放 + 状态对账 + 断线横幅」与 README §五第 5 条、WS-01 R3 缓解原文完全对齐,Out-of-Scope 与本机零回归(AC-2)守门清楚。但 PRD 把三处**真实存在的架构约束**当成「已成立」一笔带过,而当前代码并不支持:① 流控在断开期会**暂停 PTY**(与 AC-1「进程继续运行」直接冲突);② 重连复用同一 HostClient 被 `markDown`/`down` 标志 + `connectPromise` 缓存**卡死**;③「复用 hostCore 归属守卫」在重连场景**不成立**(新客户端 Set 为空,旧 Client 已删)。这三条不是实现细节,是决定该 Feature 能否兑现的地基,必须在 blueprint 明确设计,而非「桩测 + 真机 spike」兜底。其余为应处理项与确认项。

## files_read

- docs/features/TERMPRO-F260710042746-Reconnect-Continuity/PRD.md
- docs/features/TERMPRO-F260710042746-Reconnect-Continuity/YOLO-PREFLIGHT.md
- product-overview/workstream/WS-01-remote-host.md (§WS-01-S5 · R3)
- project-specs/ARCHITECTURE.md (§二依赖契约第 5 条)
- src/host/hostCore.ts (attachClient · close 回调 · 归属守卫 · handleRpc default)
- src/host/ptyPool.ts (Session · onData 流控 · spawn 时 send/onExit 闭包 · kill)
- src/host/sessionTracker.ts (状态机 · 只 emit 无快照)
- src/host/wsServer.ts (心跳 isAlive/ping-pong · terminate · 单 token 闸)
- src/host/host.ts (parentPort 嵌入式 vs --listen standalone 分流)
- src/shared/protocol.ts (PROTOCOL_VERSION=1 · RpcMethods · Client/HostMessage 联合)
- src/renderer/services/hostClient.ts (markDown · down 门 · connectPromise 缓存 · dispose · attachPty/bufferedData)
- src/renderer/services/hostRegistry.ts (per-host 单例 · getOrCreateRemote · drop)
- src/renderer/services/remoteWorkspaceSync.ts (start/stop · 断线回落 dropHostWorkspaces)
- src/renderer/services/sessionEvents.ts (routeSessionEvent · 徽标/通知策略)
- src/renderer/terminal/terminalRegistry.ts (TermInstance · ensureSession · findTab 复合键 · disposeTerminal pty.kill)

## findings

### ARCH-1 · 流控在断开期会暂停 PTY,与 AC-1「进程继续运行」冲突(必须在 blueprint 收口)
- severity: high
- category: technical-consistency / concurrency
- code_evidence:
  - src/host/ptyPool.ts:86-92 — `session.unacked += bytes; if (!paused && unacked > FLOW.highWatermark) { paused = true; proc.pause(); }`
  - src/renderer/terminal/terminalRegistry.ts:182 — ack 只在 renderer `inst.term.write(data, () => client.ack(...))` 时回执
- description: 会话存活语义靠「close 回调不 kill」实现,但**流控是另一条独立回路**。断开期间没有客户端 ack(renderer 已断),`unacked` 单调累积,越过 `highWatermark`(512KiB)即 `proc.pause()`。node-pty `pause()` 停止读取 PTY fd,内核 pty 缓冲填满后子进程 write 阻塞——一个持续产出的 build/agent 会**在长断开中被憋停**。这与 AC-1「PTY 进程继续运行·scrollback 继续填充」直接矛盾:scrollback「继续填充」的前提是 PTY「继续产出」,而当前流控恰恰会掐断产出。D-2 只说「环形缓冲断开期继续填充」,没说清缓冲如何**替代 ack 成为消费者**。
- suggestion: blueprint 明确:会话进入 detached(无归属客户端)态时,输出路径**旁路流控**——直接排入有界环形缓冲并视同「已消费」(缓冲满丢最旧,内存自然有界),detached 期间**不 pause**;重连 attach 后恢复正常 ack 流控。等价于「环形缓冲 = 断开期的流控消费端」。这条不定死,scrollback 会空、AC-1 会假。

### ARCH-2 · 重连复用同一 HostClient 被 markDown/down + connectPromise 缓存卡死(必须收口)
- severity: high
- category: technical-consistency
- code_evidence:
  - src/renderer/services/hostClient.ts:139-147 — `markDown()` 置 `down=true` + reject 全部 pending
  - src/renderer/services/hostClient.ts:154-165 — `connect()` 首行 `if (this.connectPromise) return this.connectPromise`(成功后不清)
  - src/renderer/services/hostClient.ts:248 — `rpc()` 里 `if (this.down) return Promise.reject('host process exited')`
  - src/renderer/services/hostClient.ts:173-178 — 仅 `dispose()` 复位 `down=false`,但同时 `transport=null; connectPromise=null`(丢弃全部握手态)
  - src/renderer/services/hostRegistry.ts:24-32 — `getOrCreateRemote` 复用**同一** HostClient 实例(per configId)
- description: D-5 说 renderer「检测断线(hostClient markDown / disconnected 事件)→ 自动重连」,但对**远程** client,`markDown` 会把实例毒化:`down=true` 让后续 `rpc()` 全部拒绝、`connectPromise` 仍指向旧的**已 resolve** 承诺 → 再调 `connect()` 直接返回陈旧 HostInfo **而不重开 transport**。当前唯一复位 `down` 的是 `dispose()`,而 dispose 会 null 掉 transport/connectPromise/从 registry 删除(= 走 drop 语义,丢 per-host 结构)。也就是说「原地重连同一实例」这条路当前**走不通**。`down` 语义本身也是本地/远程混用:本地 `host:down` = 进程真死(永久),远程 transport close = 网络抖动(可恢复),同一 `markDown` 通道无法区分。
- suggestion: blueprint 定义显式 reconnect 路径,区别于 dispose:(a) 断线时对远程 client 走「软断线」态(复位 `down`、清 `connectPromise`、保留 configId 结构),(b) 重连 = 新 transport + 重跑 host.info 门控 + 认领回放,(c) 只有「删除远程机/真死」才 dispose+drop。明确 markDown 的本地/远程分叉语义。

### ARCH-3 ·「复用 hostCore 归属守卫」在重连场景不成立;认领 authz 实为单 token(必须收口 + AC-8 措辞修正)
- severity: high
- category: technical-consistency / security
- code_evidence:
  - src/host/hostCore.ts:107,116 — PTY 控制消息守卫 `if (client.sessions.has(msg.sessionId))`(per-client 内存 Set)
  - src/host/hostCore.ts:177-178 — `pty.kill` 归属守卫「非归属静默忽略」(QA-R3-1)
  - src/host/hostCore.ts:129 — close 回调 `clients.delete(id)`(旧 Client 对象销毁)
  - src/host/wsServer.ts:252 — upgrade 仅比对单一 `opts.token`(整机单 token · 单租户)
- description: AC-8/D-3 说认领「复用 hostCore 归属守卫防跨客户端认领他人会话」。但现有守卫 = **per-client 内存 Set** `client.sessions`;重连是**新 Client**(Set 空)去认领**旧 Client**(已 `clients.delete`)的会话——用现有守卫,认领会被**拒绝**。守卫根本没有跨连接存活的「会话归某身份」概念。standalone 上实际的认领 authz = **wsServer 单 token 闸**(整机单租户,过 token 即合法主人),不是 Set 守卫。更要紧:若 `session.list`/attach 不限「孤儿会话」,则一个仍在线的第二窗口(同 token)可 list + attach 另一活跃窗口**正在用**的会话 → 恰好复活 QA-R3-1 想防的跨客户端劫持。
- suggestion: blueprint 明确:(1) 认领 authz = token 闸(单租户,承认「无他人」),Set 守卫在 attach 成功后**重建**(新 client 收养会话进自己 Set),不是防线本身;(2) `session.list` 只返回**孤儿会话**(当前无活跃归属),或 attach 对「仍有活跃 owner transport」的会话拒绝 —— 否则跨窗口劫持活跃会话。AC-8 措辞从「复用归属守卫」改为「token 闸单租户认领 + 孤儿限定 + 收养重建 Set」。

### ARCH-4 · 会话→客户端绑定(send 闭包 + onExit)在 spawn 时捕获,重连必须可重绑
- severity: medium
- category: technical-consistency
- code_evidence:
  - src/host/ptyPool.ts:79 — `session.send = send`(spawn 时捕获归属方发送通道)
  - src/host/ptyPool.ts:92,99 — `proc.onData`/`onExit` 用闭包里的 `send`
  - src/host/ptyPool.ts:98 — `onExit?.(id)`(闭包指向 spawn 时 client 的 `sessions.delete`)
  - src/host/hostCore.ts:168-171 — `pty.spawn` 时 `client.sessions.add(sessionId)`
- description: 会话与客户端的绑定不止 `client.sessions` Set 成员关系,还有两条 spawn 时定死的闭包:`session.send`(输出回哪个 port)与 `onExit`(退出清理哪个 client 的 Set)。重连认领若只把 sessionId 塞进新 client 的 Set,输出仍会 postMessage 到**已死的旧 port**(经 wsPortAdapter readyState 检查静默丢弃 → 屏幕不动),且会话退出时清理的是旧(死)client。PRD/D-3 只说「重新 attach 既有会话」,没点破 ptyPool 需要一个 `reattach(sessionId, newSend, newOnExit)` 原语来**重绑闭包 + 转移归属**。
- suggestion: blueprint 给 ptyPool 增 `reattach(sessionId, send, onExit)`:重绑 `session.send`、重挂 onExit 目标、回放环形缓冲。hostCore 认领 RPC 调用它并 `newClient.sessions.add(sid)`。

### ARCH-5 · 状态/通知对账(AC-5)超出 sessionTracker 现有能力;断开期离散通知不可重建
- severity: medium
- category: technical-consistency
- code_evidence:
  - src/host/sessionTracker.ts:19-31 — 唯一可读快照是 `state: 'idle'|'running'`;bell/notify/cmd-done/quiet 均为**瞬时 emit**,无累积
  - src/host/ptyPool.ts:82-84 — scanner 只在 live `proc.onData` 时喂入
  - src/renderer/services/sessionEvents.ts:36 — `waitingNotified` 未读闩锁在 **renderer** 侧
- description: AC-5 承诺「未读通知对账·消除断开期间漂移·不残留过期态」。可对账的只有**当前 running/idle/quiet**(sessionTracker.state 是当前值)——这部分成立(断开期任务完成 → 重连读到 idle ✓)。但断开期间发生的**离散通知**(一次 bell、一次 cmd-done)是瞬时 emit,发给死 port 即丢失;回放走的是 scrollback **字节**写进 xterm,**不会**重新喂 host scanner,故这些通知既没 live 送达也无法从字节重建。AC-5「未读通知对账」对离散通知**不可兑现**。
- suggestion: 二选一:(a) 缩 AC-5 到「状态对账(running/idle/quiet 当前态)」,离散通知明确 out-of-scope;或 (b) 给 sessionTracker 加断开期**累积计数**(未读 bell/notify/done 数),session.list 元数据带出供徽标对账。倾向 (a) + 徽标只反映当前态。

### ARCH-6 · 与 BL-004 断线回落冲突:disposeTerminal 会 pty.kill;回落 drop 是回放去重的隐含依赖
- severity: medium
- category: cross-subsystem
- code_evidence:
  - src/renderer/services/remoteWorkspaceSync.ts:78-82 — `stopRemoteWorkspaceSync` → `dropHostWorkspaces(configId)`
  - src/renderer/terminal/terminalRegistry.ts:240-256 — `disposeTerminal` 内 `inst.client.rpc('pty.kill', {sessionId})`
- description: 两处未点破的耦合。① BL-004 断线回落经 dropHostWorkspaces 触发 disposeTerminal,后者**对每个 tab 发 pty.kill**。网络断开时该 RPC 因 `down`/不可达被吞(futile-not-fatal),host 侧会话靠 D-1 存活——**碰巧**能工作,但设计上脆弱:必须保证不存在「抖动瞬间 kill 恰好送达存活 host」的路径,并区分「用户关 tab」(真 kill)与「网络回落」(保会话)。② 回落 drop **dispose 掉 terminal 实例**,这恰是重连**全量回放不重复**的前提(重连 = 全新 xterm,回放 256KiB 落空屏,不叠加)。若改成断开保留 terminal,则全量回放会与屏上残留**双写**。PRD 从未声明「断开销毁 terminal、重连从 session.list 重建 tab」这一模型,而它决定了 session.list 必须带 cwd/title/state 以重建 tab。
- suggestion: blueprint 明确:(1) 远程网络回落路径**不发 pty.kill**(新增「保会话拆 UI」拆解,区别于用户主动关 tab);(2) 声明「断开销毁 terminal、重连据 session.list 重建 tab + fresh xterm 全量回放」的连续性模型,并据此定 session.list 返回字段(sessionId/cwd/title/running 态/scrollback 大小)。

### ARCH-7 · D-1 挂载点:host 形态标志须由 host.ts 注入 hostCore,不得在 hostCore 内嗅探
- severity: low
- category: technical-consistency
- code_evidence:
  - src/host/hostCore.ts:1-3,70,85 — 文件头明示「传输无关·零 Electron」;`createHostCore()`/`attachClient(port)` 均**不知**自己是嵌入式还是 standalone
  - src/host/host.ts:43,138 — 形态分流只在 host.ts(`--listen` vs `parentPort`)
- description: D-1 说「判据 = host 启动形态(host.ts 已分流)」——传输分流确在 host.ts,但 `hostCore.attachClient` 是**形态盲**的,两条传输走的是同一份 close 回调代码。要按形态分「kill vs 存活」,形态标志必须**从 host.ts 显式穿进** hostCore(如 `createHostCore({ sessionSurvivesDetach })` 或 `attachClient(port, { survive })`)。绝不能在 hostCore 内读 `process.argv` 嗅探——那违背该模块「传输无关」的立身原则。挂载点成立,但需补一条显式注入的实现约束。
- suggestion: `createHostCore` 或 `attachClient` 增布尔参数由 host.ts 注入;嵌入式默认 kill、standalone 存活。blueprint 写死「不在 hostCore 内嗅探形态」。

### ARCH-8 · 字节环形缓冲回放对 alt-screen/TUI 状态重建不完整
- severity: low
- category: technical-consistency
- code_evidence:
  - src/host/sessionTracker.ts:67 — host 已跟踪 altscreen on/off
  - src/host/ptyPool.ts (无终端状态序列化,仅原始字节)
- description: scrollback 回放是**原始字节重放**进新 xterm。对滚动型 shell 精确;对长驻全屏 TUI(vim/htop)不成立——其初始整屏绘制早被 256KiB 环形缓冲挤出,重放只剩片段 → 花屏。终端**状态**序列化(xterm serialize addon)在客户端,断开时客户端已不在,host 只能字节重放。这是 byte-ring 方案的固有上限,PRD 未设预期。
- suggestion: blueprint 设定预期「连续性:滚动 shell 精确,全屏 TUI 近似」。缓解:重连 attach 后若 sessionTracker 处 altscreen,host 主动 `proc.resize()` 触发 SIGWINCH 逼 TUI 整屏重绘,优于依赖字节重放。

### ARCH-9 · 心跳协调 + 重连早于旧连接回收的双 spawn 竞态(确认 + 缓解)
- severity: low
- category: concurrency
- code_evidence:
  - src/host/wsServer.ts:287-301 — 心跳 30s 周期,pong 超时才 `ws.terminate()`
  - src/renderer/terminal/terminalRegistry.ts:39,171 — `inst.sessionId` 跨挂载存活(renderer 记得自己的会话 id)
- description: PRD「最不确定」里担心「心跳 terminate 现在会 kill·standalone 需改为 terminate 传输层但保会话」——澄清:**terminate 本身不 kill 会话**,kill 发生在 close 回调;D-1 改了 standalone close 回调即已达成「保会话」,**无需**额外改 wsServer。真正的隐藏竞态在别处:纯 TCP 假死(合盖)下 host 侧要等最多 30s 心跳才 terminate 旧 ws;若 renderer 在这 30s 内先重连,旧会话**尚未孤儿化**,若认领只靠 session.list「发现孤儿」→ 发现不到 → 新 spawn → 原会话泄漏 + 双会话。
- suggestion: 认领不要只靠 session.list 发现孤儿;renderer 用**自己记得的** (hostId, sessionId) 直接 attach,host 侧 attach 对「owner transport 已死但尚未 reap」的会话允许**幂等收养**(顺带 reap 旧 client)。session.list 作对账,不作唯一发现路径。

### ARCH-10 · PROTOCOL_VERSION 不 bump 的向后兼容成立(确认)
- severity: low
- category: technical-consistency
- code_evidence:
  - src/host/hostCore.ts:263-264 — 未知 method 走 `default: throw` → 回 `rpc:res ok:false, error:'unknown rpc method'`(不崩)
  - src/renderer/services/hostClient.ts:306-344 — `handle()` switch **无 default**,未知 `t` 静默忽略(前向安全)
- description: 追加 session.list/attach RPC + 可选新 HostMessage 变体是纯增量。旧 host 收到 session.list 返回 `ok:false` 拒绝(非崩溃);旧 renderer 收到新消息变体静默丢弃;新 host 从不主动给旧 renderer 发新消息。三向兼容成立,不 bump 版本正确。唯一前提:**退化触发是 RPC 拒绝而非版本判断**——新 renderer 连旧 host(仍 v1,过 compat 校验)只能在**调用时**从 `unknown rpc method` 拒绝里得知不支持,须 catch 该拒绝退化为新 spawn。
- suggestion: blueprint 写明「session.list 拒绝(unknown rpc method)→ 退化为新 spawn」的客户端契约,不要指望版本号能提前挡住。

### ARCH-11 · 环形缓冲在共享 PtyPool 上会给本机嵌入式会话也分配,微增本机内存(AC-2 纯度)
- severity: low
- category: scope / regression
- code_evidence:
  - src/host/ptyPool.ts:24-25 — 单一 `PtyPool` 实例,本地/远程会话共池
  - src/host/hostCore.ts:71 — `createHostCore` 里 `new PtyPool()`,两形态共用
- description: PtyPool 是本地/远程共享的,若无差别地给每个 Session 加环形缓冲,本机嵌入式会话(永不回放)也会承担 256KiB×N 的常驻内存。有界、非致命,但严格讲是本机零回归路径上的一个**新行为差**(内存)。
- suggestion: 环形缓冲分配 gate 到 detach-survivable(standalone)会话;嵌入式会话不分配或用极小上限。让 AC-2「与改造前行为一致」在内存维度也成立。

## 小结(给 PMO/RD)

- **必须在 blueprint 收口(否则 AC 会假)**:ARCH-1(流控旁路)、ARCH-2(重连不毒化 HostClient)、ARCH-3(认领 authz = 单 token + 孤儿限定,别号称复用 Set 守卫)。
- **应处理**:ARCH-4(reattach 重绑闭包)、ARCH-5(AC-5 缩到状态对账)、ARCH-6(回落不 kill + 声明重建模型)。
- **确认/设预期**:ARCH-7(形态标志显式注入)、ARCH-8(TUI 近似 + resize 重绘)、ARCH-9(记住 sessionId 幂等收养)、ARCH-10(退化靠 RPC 拒绝)、ARCH-11(缓冲不分给本机)。
- 方向与 WS-01 R3、README §5 一致,无夹带、Out-of-Scope 清楚,AC-2 本机零回归守门到位;上述均为「把隐藏前提显式化」而非推翻方向。

---

## Round 2 verify (PRD v0.2 · 2026-07-10)

### verdict

**approve_with_conditions**(三条 high 真消解 · 可进 blueprint · VERIFY-1/2/3 列为 blueprint 必钉)

复核结论:ARCH-1/2/3 三条 high **在设计层真正消解**,v0.2 的 D-3(旁路流控)/D-6(显式 reconnect)/D-5(孤儿 authz)方向正确、与代码现实自洽;ARCH-4~11 也逐条落到 D-2/D-4/D-7/D-8/D-9 + AC 调整,PL-1(砍时间型 reap·合盖过夜矛盾)采纳正确。**但 v0.2 所选方案(尤其 PL-2 引入的「闪断 xterm 存活 + 增量回放」)带出三个集成层残留**——都不是重开 high,而是所选解法的**下游后果**,blueprint 必须钉死,否则对应 AC 仍会在真机翻车。额外读了 orchestrator.ts / Sidebar.tsx / RemoteHostsPage.tsx / remoteWorkspaceSync.ts 追 reconnect 真实拓扑。

### files_read (Round 2 追加)

- src/main/remote/orchestrator.ts(stage 机 · disconnected→connecting · handleTransportDown · wireDisconnectWatcher · connect 活跃态 no-op)
- src/renderer/components/Sidebar.tsx:241-247(verifying{tunnel} → wsUrl → getOrCreateRemote + connect)
- src/renderer/components/settings/RemoteHostsPage.tsx:180-194(同一握手挂载 · remoteHost.connect({id}) 手动触发)
- src/renderer/state/remoteHostStore.ts / MachineGroup.tsx(runtime stage 呈现)
- (复读) src/renderer/services/remoteWorkspaceSync.ts · hostClient.ts · ptyPool.ts · sessionTracker.ts · wsServer.ts

### 消解确认(逐条)

| 原 finding | v0.2 决策 | 消解 | 备注 |
|---|---|---|---|
| ARCH-1 high 流控憋停 | D-3/AC-1 detached 旁路流控·环形缓冲作消费端·不 pause | ✅ 真消解 | 残留:reattach 时 unacked 计数须复位以重启流控(VERIFY-2 附带·low) |
| ARCH-2 high 重连卡死 | D-6/AC-10 显式 reconnect·markDown 本地/远程分叉 | ✅ 方向对 | 但落点被 v0.2 简化了(VERIFY-3):真实 reconnect 依赖 main 重建隧道 + 现有 verifying 握手路径的 connectPromise 早返 |
| ARCH-3 high 归属守卫+劫持 | D-5/AC-8 token 单租户 + 仅孤儿会话 + sessionId 重绑 | ✅ 方向对 | 与 AC-11 幂等收养有定义级张力(VERIFY-1):假死窗口内「孤儿」判定不成立 |
| ARCH-4 reattach 原语 | D-7 ptyPool.reattach(sessionId,newSend) | ✅ | onExit 目标也须重绑(round1 已述·blueprint 带上) |
| ARCH-5 通知对账超能力 | AC-5 缩当前态 + Out-of-Scope 声明离散通知 | ✅ 诚实收口 | VERIFY-4:altscreen/quiet 当前态今未存储 |
| ARCH-6 terminal 生命周期 | D-4 闪断增量 vs 关/回落重建 | ✅ 声明了 | VERIFY-3:闪断须**抑制** BL-004 现有断线回落 drop |
| ARCH-7 形态标志 | D-1 host.ts 显式注入 | ✅ | |
| ARCH-8 altscreen 近似 | 最不确定段 proc.resize 逼重绘 | ✅ 设了预期 | |
| ARCH-9 双 spawn | D-8/AC-11 幂等收养 | ✅ 方向对 | 与 AC-8 张力见 VERIFY-1 |
| ARCH-10 不 bump | D-5 catch unknown rpc 退化 | ✅ | |
| ARCH-11 缓冲不给嵌入式 | D-2 仅 detached-capable 分配 | ✅ | |

### 残留 findings(blueprint 必钉 · 非重开 high)

#### VERIFY-1 · AC-8「仅孤儿会话」与 AC-11「假死窗口内幂等收养」定义级张力
- severity: medium
- category: technical-consistency / concurrency
- code_evidence:
  - src/host/wsServer.ts:287-301 — 心跳 30s 周期,pong 超时才 terminate;窗口内旧 ws `readyState` 仍 OPEN
  - src/host/hostCore.ts:129 — close 回调才 `clients.delete`(reap)
- description: AC-8 要求「仅可 attach 无活跃客户端的孤儿会话」防第二窗口劫持;AC-11 要求「30s 假死窗口内(旧连接未 reap)幂等收养」。二者在 **SSH 假死分区**下冲突:合盖/断网无 RST 时,host 侧旧 ws 在心跳 30s 到期前 `readyState` 恒 OPEN——host **无法**区分「传输已死该允许收养」与「另一活跃窗口该拒绝劫持」,两者都是 OPEN。若「孤儿」= 传输非 OPEN,则窗口内重连会被 AC-8 判为「非孤儿」拒绝 → 退化 new spawn → 恰好复现 AC-11 要防的双 spawn。
- suggestion: 承认 standalone = 单租户(单 token = 单主体),把收养定义为**按 renderer 记住的 sessionId 做所有权转移(last-attach-wins)**:命中即把该 sessionId 的 send/归属转给发起方,被顶替的旧 owner 若传输已死则 reap、若仍活(罕见的同用户双窗)则被动 detach。「仅孤儿」软化为「转移时顶替旧 owner」。blueprint 明确:孤儿判定不能只靠 `readyState`(窗口内不可判),单租户下 sessionId 精确匹配 + token 即足够授权转移;跨用户隔离本就不在 standalone 单 token 威胁模型内。

#### VERIFY-2 · AC-3 增量回放「已确认字节游标」有两处正确性缺口
- severity: medium
- category: technical-consistency
- code_evidence:
  - src/host/ptyPool.ts:108-116 — `ack(sessionId, bytes)` 只递减 `unacked` **计数**,无绝对字节偏移游标
  - src/renderer/terminal/terminalRegistry.ts:182 — renderer 在 `term.write(data, () => client.ack(...))` 回调里 ack
  - D-2 环形缓冲 256KiB 有界·超限丢最旧
- description: v0.2 增量回放「按已确认字节游标·只回放 gap」比全量回放优雅(保住存活 xterm 的完整历史),但两处正确性未定死:① **游标须 renderer 报**,不能用 host 的 last-acked 计数——断开瞬间在途的 ack 消息丢失,host 的已确认游标**滞后**于 renderer 实际已渲染位置,从 host 游标回放会**重写** renderer 已有字节(恰是 AC-3 要避免的双写);② **gap 超环形缓冲时**(长断开产出 >256KiB),游标之后最旧的 gap 字节被挤出 → 本地内容与回放尾之间出现**空洞** → 花屏。增量-vs-全量的判据不能只是「tab 开/关」,还要看「游标是否仍在保留的环形缓冲内」,否则即便闪断也须清屏全量回放。且今日 ack 是计数非位置,须新增 per-session 绝对产出/已确认偏移。
- suggestion: session.attach 携带 **renderer 侧 resume 偏移**(renderer 累积的绝对已渲染字节数);host 从该偏移回放,若偏移 < 环形缓冲最旧偏移(已被挤出)→ 回退清屏 + 全量回放。blueprint 定义 renderer 侧绝对偏移累积 + host 侧环形缓冲按绝对偏移索引。

#### VERIFY-3 · reconnect 非 renderer 独立完成:依赖 main 重建 SSH 隧道 + 须抑制 BL-004 断线回落
- severity: medium-high
- category: cross-subsystem
- code_evidence:
  - src/renderer/components/Sidebar.tsx:241-247 / settings/RemoteHostsPage.tsx:180-194 — wsUrl = `ws://127.0.0.1:${tunnel.localPort}?token=…`,由 **verifying{tunnel}** 事件驱动 `getOrCreateRemote(configId, wsUrl)` + `client.connect({wsUrl})`
  - src/main/remote/orchestrator.ts:55 — `disconnected: ['connecting']` 合法,但 `connect()` 目前**手动触发**(RemoteHostsPage 按钮)且活跃态 no-op
  - src/renderer/services/remoteWorkspaceSync.ts:78-82 — 断线即 `dropHostWorkspaces` → `disposeTerminal`(**立刻销毁 terminal**)
  - src/renderer/services/hostClient.ts:155 — `connect()` 首行 `if (this.connectPromise) return this.connectPromise`(旧已 resolve 承诺早返)
- description: AC-10「显式 reconnect·重开 transport」把重连当成 renderer 单方开 socket,但真实拓扑是 renderer→main(SSH 隧道)→host。断线后旧 `localPort` 已死,**重连必须先由 main 重建隧道**(orchestrator connect(configId):disconnected→connecting→…→verifying{**新** localPort/token}→新 wsUrl)。两处落点未点破:① **自动重连退避(AC-6)须驱动 main `remoteHost.connect(configId)`**(重建隧道),而非 renderer 对死端口重开 socket;② 新隧道就绪走的是**现有 verifying 握手路径** `getOrCreateRemote + connect({wsUrl})`——但它复用**同一(已 down)**HostClient,`connect()` 撞 connectPromise 早返 → 返回陈旧 HostInfo → **新 ws 永不打开**(ARCH-2 正是**在这条路径**发作,不是抽象的 reconnect())。③ 更关键:AC-3「闪断 xterm 存活增量回放」**强制**保住 client + terminal,而 BL-004 现路径断线**立刻** stopRemoteWorkspaceSync→drop→disposeTerminal(销毁 terminal),二者直接冲突——BL-005 闪断路径**必须抑制** BL-004 断线回落 drop(只挂横幅 + 原地退避重连),把 drop **推迟到彻底放弃/硬断开**。这条 BL-004 抑制是最吃重的集成点,PRD 只在 D-4 侧面点到,未声明「谁决定走哪条 + 闪断禁跑现有回落」。
- suggestion: blueprint 定义:(a) 断线检测 → 挂横幅 + **不** drop(保 client/terminal)+ 自动退避**调 main orchestrator connect(configId)**;(b) 新 verifying{tunnel} → 复用 client 前先**复位 down + 清 connectPromise**(或让 remote markDown 就清而不像 local 那样毒化),使 `connect({wsUrl:新})` 真开新 transport;(c) 只有重连彻底失败/用户删机 → 才走 BL-004 drop + disposeTerminal。明确闪断路径**旁路**现有 stopRemoteWorkspaceSync。

#### VERIFY-4 · sessionTracker 当前态快照缺 altscreen/quiet 存储(AC-5 对账所需)
- severity: low
- category: technical-consistency
- code_evidence:
  - src/host/sessionTracker.ts:20 — `quiet` 私有字段(有存储·无 getter)
  - src/host/sessionTracker.ts:67 — `onAltScreen(on)` 只 `emit`,**无** `this.altscreen` 字段(不存当前态)
- description: AC-5 列出「running/idle/quiet/altscreen 当前态对账」,但 session.list 要出当前态快照:`state`(running/idle)已公有 ✓;`quiet` 私有需加 getter;**altscreen 根本没存**(只在切换时 emit)。「altscreen 当前态对账」当前无源。
- suggestion: sessionTracker 增 `altscreen` 当前字段 + 暴露 { state, quiet, altscreen } 快照供 session.list 元数据。或 AC-5 去掉 altscreen(altscreen 靠 ARCH-8 的 resize 重绘兜)。

#### VERIFY-5 · AC-9 会话数上限的淘汰策略未定义(不得误杀长任务)
- severity: low
- category: technical-consistency
- code_evidence: PRD AC-9 / D-9(只说「会话数上限」未说命中后行为)
- description: 砍时间型 reap(PL-1)对齐 tmux「持久到显式 kill/重启」心智,正确。但「会话数上限」命中时**杀谁**未定义——若杀最老 detached 而它恰是合盖过夜的长 build,就违背核心承诺。且无用户可见的「远端仍存活会话·认领或杀」手动出口,abandoned 会话只能靠上限被动淘汰。
- suggestion: blueprint 定淘汰优先级(detached-idle 先于 detached-running·或命中即拒新 spawn 而非杀存活)+ 预留手动 kill 出口(tmux kill-session 类)。v1 可只做「拒新建 + 日志」不主动杀,最保守。

### Round 2 小结

- **三条 high 真消解**,v0.2 忠实整合三路冷审,PL-1 砍时间 reap 判断正确,AC-2 本机零回归守得更严(D-2 不给嵌入式分配缓冲)。
- **blueprint 必钉(所选解法的下游后果·非重开)**:VERIFY-3(reconnect 依赖 main 重建隧道 + 抑制 BL-004 回落·medium-high)、VERIFY-1(AC-8/AC-11 孤儿判定张力·单租户转移收养·medium)、VERIFY-2(增量回放游标须 renderer 报 + gap 超缓冲回退全量·medium)。
- **低残留**:VERIFY-4(altscreen/quiet 存储)、VERIFY-5(上限淘汰策略)。
- 可进 blueprint;上述残留在 blueprint 钉死即可,不必再回 PRD。
