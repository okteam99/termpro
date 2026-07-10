---
verdict: NEEDS_REVISION
feature_id: TERMPRO-F260710042746-Reconnect-Continuity
review_scope: blueprint (TECH.md + TC.md)
reviewer: architect (opus 冷审 · 无人值守 yolo)
reviewed_at: "2026-07-10"
grounded_files:
  - src/host/ptyPool.ts
  - src/host/hostCore.ts
  - src/host/sessionTracker.ts
  - src/host/wsServer.ts
  - src/host/host.ts
  - src/shared/protocol.ts
  - src/renderer/services/hostClient.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/renderer/services/remoteWorkspaceSync.ts
  - src/renderer/components/Sidebar.tsx
  - src/main/remote/orchestrator.ts
  - src/main/remote/ssh.ts
summary: >
  Blueprint 整体 grounded 扎实、8 硬门根因核验属实、简洁性判断站得住。但本 Feature 最难的
  「重连时序编排」有两个 high 级缺口没接住(orchestrator connect() 在 ready 态是 no-op → 心跳
  检测到的断线无法驱动重连;既有 Sidebar.beginHandshake 与新 reconnectController 争抢同一
  verifying 事件 → connectPromise 陈旧早返复现硬门④),外加旁路流控「已 paused 会话」在断开瞬间
  被永久憋停的 high 缺口。三者都落在 concurrency/timing 门,须 blueprint 修订后再实现。
findings_count: {high: 3, med: 3, low: 2}
---

# BL-005 断线重连与会话连续性 — Blueprint 架构冷审

**verdict: NEEDS_REVISION**

三条 high 全在重连时序/并发正确性上,均可在 blueprint 层补齐(非推翻方案)。方案骨架(会话态驻 host + ring 回放 + reattach 转移 + exited 保留 + renderer 绝对偏移游标)是对的、grounded 是真的;但「重连怎么被触发、隧道怎么被重建、旁路流控在边界态怎么收敛」这三处的时序细节没钉死,而这正是 PRD-REVIEW 自己点名的「最不确定 = 真机时序」核心区。

---

## 高优先(high · 阻断实现)

### ARCH-B-1 — 心跳检测到的断线无法驱动重连:orchestrator.connect() 在 ready 态是 no-op

**severity: high (blocker)**

TECH §前端 reconnectController 的重连编排是「订阅 remoteHost `disconnected` → 驱动 `window.termpro.remoteHost.connect(configId)` 重建隧道 → verifying{tunnel} → reconnect()」。但 AC-13 存在的**根本理由**是:合盖/断网时 TCP 冻结无 RST,`WebSocket.onclose` 与 SSH 层都**不及时**,只有 renderer app 层心跳能在 T≤10s 内感知。问题是这条 fast-path 到不了隧道重建:

- `src/main/remote/orchestrator.ts:257`
  ```ts
  const session = this.ensureSession(configId);
  if (ACTIVE_STAGES.has(session.stage)) {
    // 已在连接中或已就绪:不重复编排
    return Promise.resolve();
  }
  ```
  `ACTIVE_STAGES`(`:64-71`)**含 `'ready'`**。心跳检测断线时,main 侧还没感知到传输已死(见下),session.stage 仍是 `'ready'` → `connect()` 直接 no-op 返回。**隧道永远不会被重建,verifying{tunnel} 永远不 emit,重连卡死。**

- main 为什么没感知:`src/main/remote/ssh.ts:110-118` 的 `client.connect({...})` **只设 `readyTimeout`(连接建立超时),没有 `keepaliveInterval`/`keepaliveCountMax`**。冻结 TCP 下 ssh2 Client 不会主动探活 → `wireSshDisconnectWatcher`(orchestrator.ts:448)→ `handleTransportDown`(`:420`,守卫 `stage==='ready'||'verifying'`)不触发 → 不 emit `disconnected` → stage 恒 `ready`。这与 PRD D-12 自己写的「onclose 可数分钟」完全一致——恰恰是这个场景 fast-path 失效。

**净结果**:main 检测得到的断线(ssh/forward server 真的 emit close/error,如显式断开或进程死)重连能走通(stage→disconnected→connecting 合法);但**心跳检测到的断线(AC-13 的头号目标场景)重连是死的**——因为 stage 还在 ready,connect() no-op。

**suggestion**:reconnectController 在 connect() 之前**必须先强制 main 侧转出 ready**。两条路二选一:
1. 先 `await window.termpro.remoteHost.disconnect(configId)`(orchestrator.disconnect `:276` 会 `closeSessionTransport` + emit `disconnected`,把 stage 打到 disconnected),再 `connect(configId)`(disconnected→connecting 合法,`:55`);或
2. 给 orchestrator 加显式 `reconnect(configId)`,内部强制 `handleTransportDown` 语义(ready→disconnected)后再 runConnect。

无论哪条,blueprint 都要把「心跳 markDown(remote)→ 谁通知 main 放弃旧 session」这一步显式画进时序图。当前 TECH 时序图只有 `R->>H: reconnect()`,跳过了 main 侧 stage 复位,是断的。顺带建议给 ssh2 加 `keepaliveInterval`(纵深,让 main 也能较快感知),但这不能替代上面的 disconnect-first——心跳仍是权威 fast 信号。

---

### ARCH-B-2 — 既有 Sidebar.beginHandshake 与新 reconnectController 争抢同一 verifying 事件 → connectPromise 陈旧早返(硬门④在此 call site 未修)

**severity: high**

硬门④(connectPromise 陈旧早返 → 新 ws 永不打开)TECH 说用显式 `reconnect()` 修。但 `reconnect()` 只是 HostClient 上的新方法;**触发它的入口没接对**。重连隧道重建后,main emit `verifying{tunnel}`,而**既有** Sidebar 有一个独立订阅者也吃这个事件:

- `src/renderer/components/Sidebar.tsx:269-272`
  ```ts
  return window.termpro.remoteHost.onEvent((e) => {
    applyRuntimeEvent(e);
    if (e.stage === 'verifying' && e.tunnel) beginHandshake(e.configId, e.tunnel);
  });
  ```
- `beginHandshake`(`:246-247`)调的是 **`client.connect({ wsUrl })`**,不是 `reconnect()`。而 `connect()` 首行 `src/renderer/services/hostClient.ts:155`:
  ```ts
  if (this.connectPromise) return this.connectPromise;
  ```
  重连场景下 `connectPromise` 是**上一次连接遗留的已 resolve 的旧 promise**(断线路径里 `markDown`/`onClose` 都不复位 connectPromise,只有 `dispose()`/connect 的 catch 会;见 `:139-147`、`:173-178`)→ `connect({wsUrl:新localPort})` **原样返回旧 promise,新 ws 根本不开**,`.then` 立刻拿旧 info 合成 `ready`(Sidebar:254),UI 显示已连but终端 I/O 是死的。**这正是硬门④,而 TECH 没有改这个 call site。**

TECH §依赖表只列了要改 `Sidebar.tsx:298-326`(disconnected→drop 抑制),**没列 `Sidebar.tsx:240-273` beginHandshake**。于是 verifying 事件同时被 beginHandshake(错误地 connect())和 reconnectController(正确地 reconnect())处理,两个订阅者顺序不确定,存在:
- 双重握手 / 双开 transport(beginHandshake 与 reconnectController 都动同一 client);
- 若 beginHandshake 先跑 → 陈旧早返,reconnectController 后跑 reconnect() 复位——但 UI 已被 beginHandshake 的假 ready 污染。

orchestrator 本身对 verifying 是否为「初次 vs 重连」**无标记**(runConnect 同一路径 emit,orchestrator.ts:652),所以 beginHandshake 无从自我豁免。

**suggestion**:blueprint 必须显式收敛 verifying→握手的**唯一 owner**。建议:
- 把 beginHandshake 改为调 `client.reconnect({wsUrl})`(reconnect 内部复位 connectPromise 后开新 ws,对初次连接等价于 connect——初次 connectPromise 为 null,复位是 no-op),让**单一入口**兼容初次/重连;或
- reconnectController 接管 verifying,beginHandshake 在「该 configId 正处 reconnecting 子态」时 early-return 让路。
- 同时给 `reconnect()` 加**并发再入守卫**(手动「立即重试」+ 退避循环可能同时触发 reconnect();beginHandshake 现有 `handshakingRef` 只护 beginHandshake 自己,护不到 reconnectController 的调用)。

---

### ARCH-B-3 — 旁路流控只挡「新 pause」,断开瞬间已 paused / 高水位的会话被永久憋停

**severity: high**

AC-1/D-3 的旁路流控,TECH 落在「detached 恒不 pause」(数据结构表 `unacked/paused` 行 + 风险表「detached 时 paused 永不置 true」)。但这**只阻止断开后新触发 pause**,没处理**断开那一刻会话已经 paused、或 unacked 已逼近高水位**的态:

- `src/host/ptyPool.ts:107-116` `ack()` 是**唯一**的 resume 路径:
  ```ts
  s.unacked = Math.max(0, s.unacked - bytes);
  if (s.paused && s.unacked < FLOW.lowWatermark) { s.paused = false; s.pty.resume(); }
  ```
  detached 后**没有 renderer → 没有 ack → 永远不会 resume**。若断开瞬间 `session.paused===true`(重输出 build 下 UI 渲染追不上、unacked 常年顶在 512KiB,合盖那一刻 paused 为真的概率不低),该 PTY 在整个断开期**保持 pause,子进程被憋停**——"续跑"是假的,恰恰击穿 AC-1。

- 这个洞连 TECH 自己的验证断言都漏了:风险表写「集成测断言 close 后 `pool.pid` 存活且**输出持续入 ring**」。`pid` 存活为真(pause≠kill),但「输出持续入 ring」在 pre-paused 情形下会**恒 false**(paused 的 proc 不产出),测试若不刻意在 detach 前把会话推到 paused,根本测不到这个洞。

- 附带:onData `:87` 无条件 `session.unacked += bytes`,detached 期 unacked 单调涨到天文数字;reattach 后若不复位,新 owner 一挂上 unacked 就 > 高水位 → 立即又 pause 等 ack,回放刚开始就卡。

**suggestion**:blueprint 把 detach 语义写全,不只是「不 pause」:
- `detach(sid)` 内:`session.attached=false` + **`if (session.paused){ session.paused=false; proc.resume(); }`** + `session.unacked=0`;
- onData 的 pause 判据 gate 到 attached:`if (session.attached && !session.paused && unacked>high) pause`;
- `reattach()` 内复位 `unacked=0`(回放是全新记账起点),避免立刻二次 pause;
- 集成测断言改为:**先把会话打到 paused(灌 >512KiB 不 ack)再 detach**,断言 detach 后 `paused===false` 且 ring 字节数持续增长。

---

## 中优先(med)

### ARCH-B-4 — 增量回放游标记在 xterm write 回调里,滞后于「已接收」→ 复现双写风险

**severity: med**

TECH 把 `renderedBytes` 定为「write 回调后累加 = 已渲染绝对偏移」(§前端 terminalRegistry + 补充洞察),记账点是 `src/renderer/terminal/terminalRegistry.ts:182`:
```ts
inst.term.write(data, () => client.ack(sessionId, bytes));
```
xterm 的 write 是**异步解析**的,回调滞后于「已接收」。resumeOffset 要保证的不变式是「host 别重发 renderer 已经吃进去的字节」——而 renderer「已吃进去」的界限是**已交给 term.write 的字节(已接收)**,不是「已解析回调的字节(已渲染)」。若 attach 时 xterm 写队列还有在途未回调的 chunk,`renderedBytes` 偏小 → host 回放 [resumeOffset, absoluteOffset) 覆盖到队列里待写的字节 → **双写**。这正是本游标设计要消灭的危险,却被记账点选错重新引入。

实践上多数时候不炸:重连要走 main 隧道重建(数秒),xterm 写队列(毫秒级)早排空、`renderedBytes==已接收`。但这是**靠时序侥幸**,重输出 backlog(断开前刚灌了几百 KiB 还在解析)下就破。且更安全的等价写法极简。

TECH 说「chunk 边界天然干净」——对**增量切片的起点**成立(host absoluteOffset 与 renderer renderedBytes 都按同一 `bytes` 逐 chunk 累加,offset 落在 host chunk 边界上,ring.sliceFrom 起点干净);但对「是否会双写」这层不成立,后者取决于记账点是"已接收"还是"已渲染"。

**suggestion**:`renderedBytes` 在 `onData` 里**同步累加(term.write 之前/同刻)**,与 `ack` 的回调解耦——ack 仍留在回调(背压语义对),游标改用「已接收」高水位。这样 resumeOffset 恒 ≥ renderer 已纳入的字节,双写不可能发生,且不依赖写队列排空时序。

### ARCH-B-5 — reattach 所有权转移的原子性靠若干未言明的不变式撑着

**severity: med**

转移本身在单线程 Node 里、只要 reattach **全程同步无 await**,swap send 与算切片之间就不会有 onData 插入(我核过:同步执行下 onData 是事件循环回调,无法抢占;wire 上 host 先发 rpc:res(slice) 再发 post-attach 的 pty:data,配合 hostClient `bufferedData`(hostClient.ts:82-84,320-324)与微任务排空,顺序是对的)。但这份正确性依赖三条 TECH 没写死的不变式,任一破了就 overlap/乱序:

1. **reattach 必须同步(禁 await)**:切片(ring.sliceFrom)+ `session.send=newSend` 必须在同一 tick 内完成。一旦中间插入 await,onData 就能在 swap 与 slice 之间跑,同一批字节既进 ring 切片又作 live pty:data 到新 owner → 重复。
2. **转移必须把 sid 从旧 owner 的 `client.sessions` 移除**:否则旧连接稍后 close 时,`src/host/hostCore.ts:125-126` 的回收(embedded→kill / standalone→detach)会**误动已转移给新 owner 的会话**——standalone 下把它 detach 掉,新 owner 输出转进 ring 不回屏,楔死。
3. **闪断路径的 renderer 监听器生命周期**:闪断时 tab 未 dispose,`hostClient.ptyListeners` 里旧 listener(键=同一 sessionId)在 reconnect 后仍在(reconnect 保 per-host 结构)。若 live pty:data 在「写回放切片」之前经旧 listener 直写 xterm,就会乱序。安全序 = 收到 attach 的 rpc:res 先写切片,再让 live 数据 append(靠 host 先 rpc:res 后 pty:data 的 wire 序 + 微任务成立,但 blueprint 要显式声明这条依赖,不能默认实现者知道)。

**suggestion**:blueprint 把「reattach 同步不变式 / 转移即从旧 Set 摘除 / renderer 回放-then-append 顺序」三条写进 §接口与 §错误处理,并配对抗测:`A attach → 灌输出使 A 落后 → B attach → 断言 (a) B 收到的字节 = 旧内容+gap 无重叠无空洞 (b) A 后续 input 被拒(hostCore:107 守卫,A.sessions 已无 sid) (c) A 稍后 close 不影响 B 的会话`。

### ARCH-B-6 — exited 会话 attach 时 proc.resize 打在已死 pty 上

**severity: med**

AC-11/QA-12 要求 attach 携 cols/rows,reattach 内 `proc.resize` 对账。但 AC-12 的 exited 会话 pty 已死(TECH 数据结构 `pty` 行注「exited 后仍持引用(已死,仅取 pid=null)」)。`ptyPool.resize`(`src/host/ptyPool.ts:122-125`)只守 `cols<2||rows<1`,不守 dead proc;node-pty 对已退出 pty 调 resize 可能抛。exited 会话回放路径若无脑走 reattach→proc.resize 会异常(或被 catch 成 ERROR 噪声)。

**suggestion**:reattach 对 `status==='exited'` 分支跳过 `proc.resize`(死进程无重绘意义,回放最终 scrollback 即可),并跳过 attached/流控记账。blueprint §错误处理补一行「exited attach = 纯回放,不 resize/不记流控」。

---

## 低优先(low)

### ARCH-B-7 — TC-008 要求 CSI/OSC 边界安全截断,但 RingBuffer 规格只对齐 UTF-8 码点

**severity: low**

`TC.md` TC-008(T-008)Examples 列了 `UTF-8 多字节 / CSI 转义序列 / OSC 序列` 三类都要「边界前移到完整起点」。但 TECH §数据结构 RingBuffer.push 只写「驱逐点对齐 **UTF-8 码点边界**」。CSI/OSC 安全驱逐需要在整条流上维护转义序列解析状态(有状态 parser 跨 chunk),比 UTF-8 码点边界(无状态、看高位 bit)复杂一个量级——ring 只存字节,拿不到跨 chunk 的转义态。规格与测试不一致,实现者会撞墙。

**suggestion**:降诉求到「UTF-8 码点边界 + full=true 回退清屏 + proc.resize 逼重绘」兜底(driven 驱逐落在 CSI/OSC 中段时,顶部一个残序列在 term.reset 后仅影响最旧一行,altscreen 由 resize 重绘覆盖),把 TC-008 的 CSI/OSC 例改为「full 回退不产生持续错乱」断言;或明确要 ring 内建转义 parser(不推荐,YAGNI)。二选一,别让规格悬空。

### ARCH-B-8 — exited「先逐最旧」的排序键未定义 + 多端并发 spawn 下北极星有边缘失守

**severity: low**

「会话数上限溢出先逐最旧 exited」的**「最旧」按什么排**没写(spawn 序 vs exit 序,Map 迭代序=插入序≠完成序)。单窗口北极星成立(断开期无新 spawn → 无逐出 → 刚跑完的 build 稳留),这条判断是**对的**。但 AC-14 承认多端:断开期若有第二个客户端(多窗口/未来 mobile)在同一 standalone host 狂 spawn 触顶,逐出「最旧 exited」时,若目标 build **早于**其它会话完成,它就成了最旧 exited 被逐——北极星在多端并发 spawn 下有边缘失守。

**suggestion**:明确排序键(建议按 exit 时间,最近完成的最后逐),并在 §风险表补一句「多端并发 spawn 触顶可能逐出早完成的长任务 exited(单窗口不受影响)」作已知有界取舍;或逐出策略改「逐最旧 exited 且优先保留有 exitCode 的完成态」需 PM 确认。

---

## 核验为「站得住」的点(未成 finding,记录以示真跑)

- **8 硬门根因全部核验属实**:onExit 立即 delete(ptyPool.ts:95-100)✅ · ack 是计数非位置(:108-111)✅ · per-client Set 拦重连(hostCore.ts:107-119)✅ · connectPromise 陈旧早返(hostClient.ts:155)✅ · sessionTracker altscreen 只 emit 不存储(sessionTracker.ts:67)/quiet 私有无 getter(:21)✅ · 无 renderer app 层心跳(wsServer 心跳是 server→client,:281-302)✅ · 形态注入点 host.ts:14 在分流 :43 之前 ✅ · unknown rpc 稳定错误路径(hostCore.ts:263-275)✅。
- **协议向后兼容判断正确**:`RpcMethods` 追加 + `HostInfo.capabilities?` 可选、不 bump PROTOCOL_VERSION;旧 host 走 unknown rpc → `rpc:res ok:false` 稳定退化,双保险(能力位 + catch)成立。versionCompat 不参与能力位判定也对。
- **简洁性自查诚实**:拒绝的 4 个更复杂方案(持久化 exited / 多端扇出 / host ack 双端对账 / 时间型 reap)判断都对,与 PRD 决策一致,无过度设计。新增 7 字段里 `evicting`(区分手动 kill vs 自然退出→exited)最可疑但可辩护(手动 kill 应真删不留 exited 徽标),接受。
- **所有权转移的单线程原子性本身成立**(见 ARCH-B-5 前言),只是依赖的不变式要写死。
- **exited×会话数上限调和对单窗口北极星忠实**(见 ARCH-B-8):断开期无新 spawn → 无逐出压力 → 深夜 build 完成后作为最新 exited 稳留至早晨,成立。

---

## 结论

方案值得做、地基是对的,但**重连触发链(B-1 connect no-op / B-2 verifying 双订阅)与旁路流控边界态(B-3 已 paused 憋停)**三条 high 落在本 Feature 最难、PRD 自己标注「最不确定」的时序区,且当前 TECH 时序图恰好在这些 main↔renderer↔host 交接处是断的/含糊的。建议 blueprint 修订:把三条 high 的时序显式画进流程图 + 钉进 §接口/§错误处理,med(游标记账点、reattach 不变式、exited resize)一并收口,再进实现。
