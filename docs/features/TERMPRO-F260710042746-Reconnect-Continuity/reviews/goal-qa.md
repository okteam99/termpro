# QA 冷审 · BL-005 断线重连与会话连续性 PRD

- **feature**: TERMPRO-F260710042746-Reconnect-Continuity（WS-01-S5 · BL-005）
- **review_role**: QA（隔离冷审）
- **review_date**: 2026-07-10
- **verdict**: **changes_requested**（方向正确、结构完整；但有 5 项 load-bearing 缺口在进 blueprint 前必须收口，另有多条 AC 缺失/自相矛盾）

## verdict 摘要

PRD 骨架扎实：三条 WS-01-S5 核心（存活 / 回放认领 / 对账+横幅+自动重连）在 AC 层面都有落点，按 host 形态分语义、向后兼容追加协议、孤儿超时防泄漏这些方向都对得上 R3 缓解原文与代码现状。但**冷读代码后发现 PRD 与实现现实存在数处硬矛盾**，其中最关键的一条（会话在断线期间退出 → 无迹可查）会直接击穿本 Feature 的核心价值主张（「回来看跑完的 build」）。这些不是措辞问题，是会在实现阶段爆的设计漏洞，须先补决策再开工。

## files_read

- `docs/features/TERMPRO-F260710042746-Reconnect-Continuity/PRD.md`（评审对象）
- `docs/features/TERMPRO-F260710042746-Reconnect-Continuity/YOLO-PREFLIGHT.md`
- `product-overview/workstream/WS-01-remote-host.md`（§WS-01-S5 + R3）
- `src/host/hostCore.ts`（attachClient / close 回调 :124-136 / 归属守卫 :107-120,177-192）
- `src/host/ptyPool.ts`（Session 结构 / spawn / onExit :95-100 / kill / 流控）
- `src/host/sessionTracker.ts`（状态机 / emit-and-forget 事件）
- `src/host/host.ts`（嵌入式 vs standalone 分流 :43-165）
- `src/host/wsServer.ts`（心跳 isAlive/terminate :281-302 / token 闸 / 握手门控）
- `src/shared/protocol.ts`（RpcMethods / SessionEvent / ClientMessage / HostMessage）
- `src/renderer/services/hostClient.ts`（connect/markDown/attachPty/bufferedData/dispose）
- `src/renderer/services/hostRegistry.ts`（per-host client / drop / forWorkspace）
- `src/renderer/services/remoteWorkspaceSync.ts`（start/stopRemoteWorkspaceSync）
- `src/renderer/state/remoteHostStore.ts`、`src/renderer/state/__tests__/remoteDisconnectFallback.test.ts`（BL-004 AC-11 回落语义）
- `src/renderer/terminal/terminalRegistry.ts`（tabId 键 / (hostId,sessionId) 复合键 / TermInstance）
- `src/host/__tests__/hostSubprocessHarness.ts`、`__tests__/` 目录（真子进程 + 真 node-pty + loopback WS 测试基座）

---

## findings

### QA-1 · 会话在断线期间退出 → 结果与退出码被立即丢弃，重连无迹可查
- **severity**: blocker
- **category**: 完备性 / 正确性（核心价值主张）
- **description**: `ptyPool.ts:95-100` `proc.onExit` 立即 `this.sessions.delete(id)` + 向**已死的 send 通道**发 `pty:exit`（丢失）+ `onExit` 把 sid 从 client.sessions 摘除。也就是说 standalone host 上一个存活会话若在断线期间**自然跑完（build 完成）或崩溃**，会话对象连同 scrollback、退出码**当场蒸发**，重连后 `session.list` 列不到它。而本 Feature 的头号用户故事正是「跑长任务→断网→回来看结果」，交付预期表更白纸黑字写「断开期间任务完成 → 重连 → 徽标反映已完成」。当前实现下这条**根本无法兑现**：重连看到的是一个凭空消失的 tab、没有最终输出、没有退出码。这是整个 Feature 最重要的缺失场景，却没有任何 AC 覆盖。
- **suggestion**: 新增 P0 AC——standalone host 的存活会话在断线期间退出时，须**保留最终 scrollback + 退出码/结束状态一段宽限期**（"recently-exited" 驻留），供重连回放结果 + 打「已完成」徽标；明确该宽限窗与 D-6 孤儿超时的关系（退出后驻留窗口通常应短于活跃会话孤儿超时）。ptyPool 的 onExit 需从「立即 delete」改为「转 exited 态保留缓冲」。

### QA-2 · AC-8「复用 hostCore 归属守卫」与 AC-4「重新 attach 既有会话」直接矛盾
- **severity**: high
- **category**: 正确性 / 安全语义
- **description**: 现有归属守卫 = `client.sessions.has(sid)`（hostCore.ts:107-120、177-192）。但重连时是**新连接 = 新 client（clientSeq 自增），其 `client.sessions` 为空集**——本次连接没 spawn 过任何会话。AC-4 要求「按 (hostId,sessionId) 重新 attach 既有会话」，AC-8 却要求「复用 hostCore 归属守卫」防认领。二者不可兼得：若真复用现守卫，**所有重连 attach 都会被守卫拦死**（新 client 名下无该 sid）；认领的本质恰恰是「认领一个本连接没 spawn 的会话」。此外 AC-8 把「跨客户端认领」当攻击防，但在模型 A 里「连上机器即见其全部 workspace 与会话」正是设计意图——**授权客户端认领该 host 的任意会话是特性，不是攻击**。「未授权 vs 已授权多端」在此被混为一谈。
- **suggestion**: 重写 attach 的授权模型：**凡通过 token 闸的该 host 客户端，皆可 list/claim/attach 该 host 的会话**；claim 动作 = 把 `session.send` 重绑到新 client + 把 sid 加进新 client.sessions（所有权转移/接管），而非用「本连接是否 spawn 过」判定。把这条写进 D-3 与 AC-8。真正要防的是「无 token 客户端」（wsServer token 闸已挡）与下条的并发 attach 仲裁。

### QA-3 · 多客户端同时 attach 的语义未定义（转移 vs 扇出）
- **severity**: high
- **category**: 完备性（协议决策缺失）
- **description**: 模型 A 明确面向「多 UI 端连同一 Host」（mobile 前瞻，WS-01 §129 硬约束）。但 `ptyPool` 的会话在 spawn 时把输出绑死到**单个** send 通道（`session.send`），input/resize/ack 也按单一归属校验。断线重连、以及「主窗口 + 未来 mobile 同时连」都会触发「一个会话被多个客户端 attach」。PRD 全篇没有一个决策项/AC 回答：claim 是**所有权转移**（踢掉旧端、last-attach-wins）还是**扇出订阅**（多端同看同一输出、输入需仲裁）？这决定了 `session.send` 要不要从单值改成订阅者集合、输入冲突怎么处理、AC-8 的安全边界怎么划。任务清单里点名的「多客户端同时 attach」在 PRD 里是空白。
- **suggestion**: 新增决策项 + AC 明确 v1 策略。建议 v1 采用**显式 single-owner 转移（last-attach-wins：新 attach 接管 send，旧连接若还活着则降级/被动断该会话输出）**，扇出订阅列为未来项——但无论选哪个都要写死，且要有测试覆盖「A attach → B attach 同一 sid → 输出去向、A 的后续 input 是否被拒」。

### QA-4 · AC-5「未读通知对账」按现状不可交付（无 host 侧留存 + session.list 无状态快照）
- **severity**: high
- **category**: 完备性 / 可测试性
- **description**: `sessionTracker` 的 bell/notify 是 **emit-and-forget**（onBell/onOsc 直接 emit，不计数、不留存）；断线期间这些事件 emit 到已死通道即丢失，tracker 内部也**不保留任何「未读通知数 / 注意力态」**。而 D-3 规定 `session.list` 只返回 `running/lastProcess/scrollback 大小`——**没有当前状态快照**（idle/running、quiet、altscreen、未读通知计数、最近退出码）。AC-5 P0 要求「对账 tab 徽标/未读通知·消除漂移」，但重连时既拿不到当前状态快照，也拿不到断开期间累积的未读通知——**这条 P0 AC 目前无法落地**。对账要的是「当前态」，不是被丢掉的历史事件流。
- **suggestion**: sessionTracker 增加**可查询的当前对账态**（state、quiet、altscreen on/off、未读 bell/notify 计数、last cmd-done exit）并跨断线保留；`session.list`（或新增 `session.state`）须返回该快照。补进 D-3/D-4，否则 AC-5 须降级或改写。附带确认 altscreen 恢复走「scrollback 回放让 xterm 重解析」还是「快照元数据」——PRD 现在两条路都暗示、未消歧。

### QA-5 · 断线「检测」的权威信号与时延未定义——整个横幅/自动重连/存活 UX 悬于此
- **severity**: high
- **category**: 正确性（可感知性根因）
- **description**: PRD「最不确定」段点到心跳 terminate 与存活的协调，但**漏了更前置的问题：谁来、多快地检测到断线**。合盖/断网时浏览器 `WebSocket.onclose` **不会及时触发**（TCP 无 RST 时可挂起数分钟），`hostClient` 的 onClose→markDown 因此可能长时间不响；而 main 侧的本地端口转发 socket 在网络掉时往往仍 open，SSH 隧道死也未必即时可见（须靠 ssh keepalive）。D-5 一句「renderer 检测断线（markDown / BL-003 disconnected 事件）」把可靠性寄托在 BL-003 事件上，却没验证该事件在合盖/断网下**及时**触发。若检测不及时，横幅不出、自动重连不启、用户对着一个「假活」的终端敲字石沉大海——本 Feature 最核心的可感知承诺落空。
- **suggestion**: 定义权威且有界时延的断线信号：renderer 应用层心跳/超时（或 main 侧 ssh ServerAliveInterval → disconnected 事件，并给出有界时延），新增 AC 钉「断线在 T 秒内呈现横幅」。真机合盖/断网时序列为发版前 spike（承接 BL-003/004 同类 concern，但此处须显式列为门禁）。

### QA-6 · scrollback 环形缓冲按字节「丢最旧」不做序列边界安全 → 回放可能渲染乱码
- **severity**: medium
- **category**: 正确性 / 可测试性
- **description**: D-2/AC-3 规定「字节上限环形缓冲·超限丢最旧」。字节级截断会**从中间切断 UTF-8 多字节字符与 CSI/OSC 转义序列**，回放起点落在半个转义序列上会污染 xterm 解析；更严重的是运行中的全屏应用（vim/htop）——若「进 altscreen 的 DECSET」早于 256KiB 窗口被逐出，回放只剩后半段重绘指令 → 满屏乱码。AC-3「回放全量 scrollback·屏幕恢复到当前状态」对 altscreen 应用或截断后的会话**并不成立**。
- **suggestion**: blueprint 定义**安全边界截断 / 有界 resync**策略；新增 AC 或明确降级契约：「断线时有全屏应用在跑 → 重连正确渲染 **或** 触发一次干净重绘」。测试用脚本化的 altscreen 序列（enter altscreen → 绘制 → 截断点落在序列中）验证不崩不乱。

### QA-7 · 孤儿超时 × 重连竞态无 AC/UX；孤儿定时器生命周期与会话上限溢出策略未定
- **severity**: medium
- **category**: 完备性（任务点名边界）
- **description**: 任务明确点名「重连时会话已被孤儿超时回收」。AC-9 只说「超时→回收」，但没回答重连恰好晚于回收 N（或自动重连退避累计超过 N）时的 UX：`session.list` 列不到 / attach 失败 → tab 须给「会话已过期」明确态，而非 hang 或静默消失。另外 D-6/AC-9 未定义：孤儿定时器**何时起**（末个客户端 detach 时）/**何时取消**（重新 attach 时）；「会话数上限」溢出时是**拒绝新 spawn** 还是**逐出最旧存活会话**（后者会杀掉别人正跑的任务）。
- **suggestion**: 新增 AC 覆盖「重连时会话已被回收 → 明确过期提示」；在 D-6 写死定时器 start/cancel 时机与上限溢出策略（建议拒绝新建而非逐出运行中会话）。

### QA-8 · 存活/回收判据的注入点被 hand-wave（close 回调在传输无关的 hostCore 里）
- **severity**: medium
- **category**: 正确性 / 架构 / 可测试性
- **description**: D-1 说「hostCore close 回调按 host 形态分支」，但 close 回调正身处 `hostCore.ts`——按 README §5 它是**传输无关、零 Electron**的，**它自己无从知道**当前是 parentPort 嵌入式还是 --listen standalone（那是 host.ts 的知识）。让 close 回调自行内省形态会破坏传输无关契约。形态其实是**每个 core 一个属性**（一个进程只跑一种形态），应由 host.ts 依 argv 分流后注入，例如 `createHostCore({ sessionSurvival })`，而非「回调内分支」。这个注入点没钉死，AC-1/AC-2 就没有干净的单测挂载点。
- **suggestion**: blueprint 明确 `createHostCore(survival flag)` 由 host.ts 的 argv 分支注入；AC-1/AC-2 的单测据此注入 flag 验证 kill/不 kill。顺带澄清 scrollback/存活是否也随此 flag 门控（见 QA-9）。

### QA-9 · AC-2「本机零回归」口径过窄——只管杀会话，未覆盖新增缓冲/协议对本机的足迹
- **severity**: medium
- **category**: 完备性 / 可测试性
- **description**: AC-2 只断言「本地嵌入式端口 close 照常 kill」。但 `ptyPool` 是本机/远程**共用**的类：若 scrollback 环形缓冲无差别地对所有会话开，**本机每个会话也白白吃 256KiB 缓冲**（本机根本不会重连回放）——这是本机内存/行为的**真回归**，却不在 AC-2 视野内。session.list 是否对本机 host 也暴露、对本机语义有无影响，同样没说。
- **suggestion**: 决策并写明：scrollback 环形缓冲与存活语义**是否仅对 standalone core 开**（建议是）；把 AC-2 扩为「本机嵌入式 host 无新增内存/行为足迹」并加测试（本机 spawn N 会话，断言无 scrollback 分配 / 无 session.list 副作用）。

### QA-10 · 重连 UX 与 BL-004「断线即回落」的衔接未消歧（断线窗口态 + active tab 恢复 + 历史截断）
- **severity**: medium
- **category**: 完备性 / UX 一致性
- **description**: BL-004 的 `stopRemoteWorkspaceSync` → `dropHostWorkspaces` 会**dispose 该 host 全部终端 + 从 Sidebar 删掉其全部 workspace + active 回落本机首个**（见 remoteDisconnectFallback.test.ts）。PRD 只说「断线先回落·重连再恢复」，但没解决断线窗口内的态：远程 workspace 是**从 Sidebar 消失**的同时又弹「重连横幅」（自相矛盾的呈现）？重连后用户原本所在的远程 tab 会**恢复为 active** 吗？且断线即 dispose 终端 → 重连只能从 ≤256KiB scrollback **全量重建**，用户**静默丢失断开前超出缓冲上限的历史滚动**。这些都是可感知行为，PRD 未定。
- **suggestion**: 定义断线窗口态（建议：瞬时断线**不**drop、保留该 host 的 workspace 以「重连中」态呈现，而非走 BL-004 的 drop 全路径；或显式接受「消失→恢复」并说明）；明确重连后 active tab 恢复策略；把「重连后 scrollback 历史被上限截断」列为已知限制（或在瞬时断线期间**保活终端实例**不 dispose，仅补断开期间缺失字节）。

### QA-11 · 「重新 attach 而非重 spawn」的跨注册表接线只点到未展开（terminalRegistry 存活 / HostClient 新建 / sessionId 稳定）
- **severity**: medium
- **category**: 可测试性 / 完备性
- **description**: 重连接线是本 Feature 最精细处，却只被一句带过。现状：断线时 `hostRegistry.drop(configId)` 会 `dispose()` 并从 map 移除该 HostClient；重连时 `getOrCreateRemote` **新建一个 HostClient**（新实例，bufferedData/ptyListeners 全空）。而 `terminalRegistry` 的 TermInstance 按 **tabId** 存活、持 `sessionId`。要做到「重新 attach 非重 spawn」，重连须把**每个 tab 的 TermInstance.sessionId 重新绑到新 client 的 attachPty**，且要防旧 disposed client 的残留缓冲/监听。PRD 没给这个时序，实现极易走偏成「重连 = 重 spawn」（scrollback 断裂 + 双 PTY，正是 §开工前必须想清里点名要避免的）。
- **suggestion**: blueprint 写死重连接线时序：重连成功 → `session.list` → 对每个既有 tab 按 (hostId,sessionId) 复合键重绑 attachPty + 回放 → 对账。加 renderer 单测（fake WS close/reopen：断言同 tabId 保持 sessionId、attachPty 重绑、pty.spawn 调用数不增、回放字节写进既有 xterm）。

### QA-12 · 重连维度对账缺失（断线期间窗口 resize → 回放错行）
- **severity**: medium
- **category**: 完备性
- **description**: 断线期间用户可能改窗口大小；存活 PTY 仍是旧 cols/rows；把按旧宽输出的 scrollback 回放进新宽 xterm 会**错误折行**。AC-3 只讲回放、没讲维度一致。
- **suggestion**: 重连回放前后须把 PTY + xterm resize 到当前视口；补进 AC-3 或单列 AC + 测试（以不同 cols 重连，断言发出 resize、回放按新宽渲染）。

### QA-13 · AC-7 优先级偏低——它才是「重连成功 = 认领+回放+对账无感恢复」的端到端兑现
- **severity**: low
- **category**: 优先级合理性
- **description**: AC-7 是把 AC-3/4/5 串起来的**成功重连全链路**（真正的 payoff）。它被标 P1，而其组成部件 AC-3/4/5 都是 P0——一个「重连永远走不完」的 Feature 毫无价值。成功恢复路径不该低于其部件。
- **suggestion**: 把 AC-7 的「重连成功 → 恢复」半条提到 P0（失败保持横幅/退避的半条留 P1）。AC-6（横幅+自动重连）留 P1 尚可接受，但成功恢复须 P0。

### QA-14 · session.list 向后兼容退化依赖 error-based 特性探测，无版本信号、无测试
- **severity**: low
- **category**: 可测试性 / 兼容性
- **description**: PRD 称「旧 host 无 session.list → 退化为新 spawn·不崩」。但协议不 bump 版本、握手不带能力位，唯一信号是 hostCore 对未知方法抛的 `unknown rpc method` 错误（hostCore.ts:263-264）。renderer 须**精确 catch 该错误并回退 spawn**，否则重连崩。PRD 把「不崩」当既成事实，却没钉探测机制与测试。
- **suggestion**: 定义特性探测机制（session.list reject → 回退新 spawn 的具体判定）并加测试。severity 低是因「旧 host + 存活语义」组合不常见，但 PRD 既明确宣称就得可验。

### QA-15 · 会话存活把「token 可认领的活 shell」窗口从「有活跃连接」放宽到「至孤儿超时」
- **severity**: low
- **category**: 安全（纵深说明）
- **description**: 存活语义下，一个通过 token 的客户端可 attach 到仍在跑真实进程的 PTY；而现在这个「可被 token 认领的活 shell」窗口从「必须有活跃合法连接」延长到「无任何客户端也驻留至孤儿超时 N 分钟」。泄漏/重放的 token 的爆炸半径与时间窗随之扩大。此风险内生于 token 模型（loopback + 128-bit·文档已定 token 为主屏障），非新引入，但时间窗确实变大。
- **suggestion**: 在 PRD 安全段点明此权衡；N 默认取值宜保守（孤儿超时同时也是此暴露的上界，与 D-6 联动）。不阻断，属知会。

---

## 三条 WS-01-S5 核心的 AC 覆盖对账（① 完备性结论）

| WS-01-S5 核心 | 对应 AC | 覆盖判定 |
|---|---|---|
| ① UI 断开会话存活（含本机零回归） | AC-1 / AC-2 | 高层覆盖；**缺**断线期间会话退出的留存（QA-1 blocker）、本机足迹口径过窄（QA-9） |
| ② 重连回放 + 认领 | AC-3 / AC-4 / AC-8 | 高层覆盖；**AC-8 与 AC-4 自相矛盾**（QA-2）、多端并发 attach 空白（QA-3）、回放序列安全（QA-6）、重连接线时序（QA-11）、维度对账（QA-12）均缺 |
| ③ 状态对账 + 横幅 + 自动重连 | AC-5 / AC-6 / AC-7 / AC-9 | 横幅/退避覆盖；**AC-5 未读通知对账按现状不可交付**（QA-4）、断线检测时延无 AC（QA-5）、孤儿×重连竞态无 UX（QA-7）、AC-7 优先级偏低（QA-13） |

**遗漏的用户可感知场景（无任何 AC）**：断线期间会话完成/崩溃后的结果留存（QA-1）、重连时会话已被孤儿回收的过期提示（QA-7）、断线检测时延（QA-5）、重连后 active tab 恢复 + 断线窗口 Sidebar 呈现（QA-10）、多端并发 attach（QA-3）、重连维度对账（QA-12）。

## 可测试性结论（② AC 可测试性）

- **利好**：`hostSubprocessHarness.ts` 已能以**真子进程 + 真 node-pty + loopback WS** 起 standalone host（BL-002 已用于 wsRpcParity/multiClient）。故 AC-1/AC-3/AC-4/AC-9 **无需真机即可端到端测**：起 host → spawn 一个跑已知输出的会话 → 关 WS 客户端 → 新 WS 客户端重连 → `session.list` + attach → 断言回放字节 / 会话未被杀 / pty.spawn 未重复。
- **测试使能项（须 blueprint 一并建）**：① 孤儿超时 N、退出留存宽限窗、心跳周期须 **env/参数可注入**（照 wsServer 已有的 `pingIntervalMs` 惯例）以便快测；② sessionTracker 已有可注入 `now`，对账态快照测试可复用；③ 需一个可模拟 close→reopen 的 renderer 侧 fake WS transport 测重连接线（QA-11）。
- **AC-2「本机零回归」怎么验**：createHostCore 注入 embedded/survival flag（QA-8）后，用 mock PortLike + node-pty stub：嵌入式 core → spawn → 触发 port close → 断言 `pool.kill` 被调用（且无 scrollback 分配，QA-9）；standalone core 同构断言 kill **未**被调用、会话仍在。
- **真正测不了的**：真机合盖/断网/切网的隧道死与恢复时序（QA-5）——只能发版前 spike，须显式列为门禁项而非可选。

## 优先级合理性（④）

大体合理（存活/回放/认领/安全列 P0、横幅/孤儿超时列 P1 可接受），两处要调：**AC-7 成功恢复半条应提 P0**（QA-13）；**AC-5 若维持 P0 则必须先补 QA-4 的 host 侧留存与状态快照**，否则该 P0 无法达成、应降级或改写。QA-1 揭示的「退出留存」建议以 P0 新增（它是核心价值主张的守门）。
