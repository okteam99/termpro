---
verdict: NEEDS_REVISION
degraded: true
heterogeneous: false
feature_id: TERMPRO-F260710042746-Reconnect-Continuity
review_scope: blueprint (TECH.md + TC.md)
reviewer: external-cross-review (independent · fresh eyes · grounded on real code)
review_via: subagent   # worktree 无 localconfig 异质源 → 降级同模型 opus 隔离冷审(独立 fresh-eyes · 真跑 · 非异质跨模型)
resolution: "Round1 findings(2 high EXT-B-1/2 + 3 med + 4 low)全在 TECH v0.2 收口 · 详见 TECH-REVIEW.md(consolidated verdict=APPROVE)"
reviewed_at: "2026-07-10"
files_read:
  - docs/.../TECH.md
  - docs/.../TC.md
  - docs/.../PRD.md
  - docs/.../PRD-REVIEW.md
  - src/host/ptyPool.ts
  - src/host/hostCore.ts
  - src/host/sessionTracker.ts
  - src/host/wsServer.ts
  - src/host/host.ts
  - src/renderer/services/hostClient.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/renderer/services/remoteWorkspaceSync.ts
  - src/renderer/components/Sidebar.tsx
  - src/shared/protocol.ts
  - src/main/remote/orchestrator.ts
  - src/main/remote/residency.ts
summary:
  blocker: 0
  high: 2
  medium: 3
  low: 4
---

# 外部冷审 · BL-005 断线重连与会话连续性 blueprint

## 裁决

**NEEDS_REVISION**（2 high · 均直接威胁北极星端到端流；无 blocker）。

方案的**内核是对的**：会话态驻 host + 环形缓冲回放 + reattach 换 send + exited 保留态 + 显式 reconnect，这五样正是从"声称连续"到"真连续"的地基，与 README §5 一致。grounding 质量**优秀**——我逐行核对了 TECH 引用的每个行号，全部属实（无杜撰证据，见文末"核验通过清单"）。协议追加是纯加法、向后兼容路径成立。

但两处高危缺口不是模块内的实现细节，而是**跨模块接线缝**——恰好落在 arch/qa 视角的交界处，两边都假设对方覆盖了：

1. **EXT-B-1**：重连时 `verifying{tunnel}` 的既有订阅者（Sidebar.beginHandshake）仍调 `connect()`（陈旧早返 bug），TECH 新增的 `reconnect()`/reconnectController 没有 gate 掉它们——头号流可能静默半连。
2. **EXT-B-2**：重连的会话续存**静默依赖** orchestrator `resolveResidency` 选中 `claim` 复用存活 host；而 claim 探测**只探一次无重试**，一次瞬时失败（正是刚从抖动恢复的场景）→ `reapThenDeploy` **kill 掉存活 host**→ 断线期跑完的 build 连同会话被销毁。TECH 完全没提这条依赖。

这两条修掉（或明确 defer + 加护栏）即可 APPROVE。

---

## 逐条 finding

### EXT-B-1 · HIGH · 重连的 `verifying{tunnel}` 有多个既有订阅者仍走 `connect()`（陈旧早返），reconnect() 没接管它们

**证据链（真实代码）**：
- `hostClient.ts:154-165` `connect()` 首行 `if (this.connectPromise) return this.connectPromise`。成功连接后 `connectPromise` **不复位**（仅 `:161-163` catch 时置 null，`dispose()` 时置 null）。断线走 `markDown()`（`:139-147`）置 `down=true`，但**不动 connectPromise**。
- `Sidebar.tsx:241-272`：`beginHandshake` 订阅 `remoteHost.onEvent`，`e.stage==='verifying' && e.tunnel` → `client.connect({wsUrl})` → 成功即 `applyRuntimeEvent({stage:'ready'})` → 触发 `startRemoteWorkspaceSync`。注释（`:233-237`）明说 RemoteHostsPage 也有一份同样的 beginHandshake。
- `orchestrator.ts:548-556`（claim 路径）与 `:652-657`（fresh 路径）**都** emit `verifying{tunnel}`——首连和重连**用同一个事件、无区分字段**（claim 与 reconnect-claim 都是 `fastPath:true`）。

**问题**：TECH §前端技术方案让 reconnectController 订阅 `verifying{tunnel}` → 调 `hostClient.reconnect()`。但它**没有**把既有的 Sidebar/RemoteHostsPage `beginHandshake` 从重连路径上摘掉或改道。重连时 main re-emit `verifying{tunnel}`，**两个独立订阅者同时触发**：
- reconnectController → `reconnect()`（复位 connectPromise，正确）
- beginHandshake → `connect({wsUrl:新})` → `connectPromise` 仍是**首连时那个已 resolved 的旧 promise**（指向死 transport）→ **立即 resolve** → `applyRuntimeEvent ready` → `startRemoteWorkspaceSync` → `client.rpc('workspace.list')` 但 `down=true`（`:248` 直接 reject `'host process exited'`）。

结果：重连时头号流可能被 beginHandshake 抢先"假 ready"，在死 transport / down 态上建订阅，reconnect() 的真重连与之竞态。这正是 PRD-REVIEW 硬门 #4（ARCH-2）——TECH 为 `reconnect()` 原语落了修复，却**没把调用方路由过去**。

**建议**：显式协调二者其一——
- (a) reconnectController 进 reconnecting 态时把 configId 标记（如 store 的 `reconnecting` 子态），beginHandshake / RemoteHostsPage 的 verifying 处理**对 reconnecting 中的 configId 短路跳过**；或
- (b) beginHandshake 判定"该 configId 已有 down 的既有 client" → 改调 `hostClient.reconnect()` 而非 `connect()`（把重连语义收敛进握手单源）。
- 补一条测试：`verifying during reconnect → 走 reconnect() 不走 connect()`（当前 TC 无此断言）。

---

### EXT-B-2 · HIGH · 重连续存静默依赖 residency 选 `claim`；claim 探测只探一次无重试 → 瞬时失败会 reap 掉存活 host（连同断线期跑完的 build）

**证据链（真实代码）**：
- 重连要复用**存活的** host（否则会话全丢——这是 BL-005 的全部前提）。orchestrator 的复用点是 `residency.ts`：`decideResidency:75` `candidateEligible && probeResult?.ok && compatible!==false` → `claim`（复用运行中 host + `storedToken`，见 orchestrator `:539-556` 用 `storedToken` emit verifying）。
- `resolveResidency:174-188`：候选合格 → `buildTunnel` → **单次** `probeHostInfo(localPort, storedToken)`（`:177`）→ 无重试/退避。
- `decideResidency:79-83`：若 `probeResult.ok` 为 false **但** host 仍存活且 `--host-tag` 匹配本 configId → `reapThenDeploy`（`kill:true`，`:82`）→ **杀掉运行中 host** + 全新部署。

**问题**：重连恰好发生在**网络刚从抖动恢复**时——这正是 claim 探测最可能瞬时失败的时刻。一次假阴性 probe（隧道刚建、时序未稳）就把一个**活着、正持有 BL-005 detached/exited 会话**的 host 判成"回收"并 `kill`。断线期跑完的 build（AC-12 北极星）连同退出码当场销毁——**与本 Feature 的头号承诺正面相撞**。

TECH 对此**零提及**：§架构与流程图把 `remoteHost.connect(configId)` 当黑盒"重建隧道（新 localPort/token）"。两点问题：
1. "**新 token**"表述对 claim 路径是**错的**——claim 复用 `storedToken`（orchestrator `:543/:552`）。实现者照字面理解可能误判会话丢失是"token 轮换"所致，掩盖真因。
2. 没有声明"重连续存 = residency 必须选 claim"这条**核心依赖**，也没有对 claim 假阴性→reap 设任何护栏。

注：orchestrator `:630-649` 的 A14 修复已处理过"部署探测瞬时失败 vs 真不兼容"的混淆，但 **claim 探测（residency.ts:177）没有对应的重试兜底**——同一类 bug 在重连热路径上仍裸奔。

**建议**：
- TECH 明确写出"重连续存依赖 resolveResidency 的 claim 分支复用存活 host + storedToken"（并改正"新 token"→ claim 复用 storedToken）。
- claim 探测在判 reap 之前**加重试/退避**（尤其是 tag 匹配且 alive 时——一个自证属于本 configId 的活 host，单次 probe miss 不该直接 kill）。这可能落在 BL-003 residency 内，但 BL-005 的连续性保证以它为地基，blueprint 必须点名并设门。
- 加测试：`alive tag-matching host + 瞬时 probe 失败 → 不 reap（重试后 claim）`。

---

### EXT-B-3 · MEDIUM · D-4 的第二条路径（tab 已 dispose → 据 session.list 重建 tab 全量回放）在 TECH 无设计、TC 无测试

- PRD D-4 明列**两条**重连路径：闪断（xterm 实例存活 → 增量）**与** tab 已关/BL-004 已 disposeTerminal → **据 session.list 重建 tab（cwd/title/state）后全量回放**。
- TECH §前端 `readoptHost(configId)` 只实现第一条：`对该 host 全部持 sessionId 的 inst → session.attach`。**只重连 renderer 已持有的实例**，不为 session.list 里"实例已不在"的会话重建 tab。
- TC 侧同缺：`TC-009` 只在 host 层断言 list 返回会话，无 renderer 重建 tab 用例。
- 因此 `AC-4「session.list 发现现存会话」`只交付了一半——"发现"退化为"重连已知实例"。

AC-15 让 suppress-drop 成默认，实例通常存活，所以这条路径多数时候是潜伏的（不影响主场景）。但它是**静默缺失**而非显式 defer。

**建议**：二选一——(a) 在 readoptHost 补"session.list 有、本地无实例 → 重建 tab + full 回放"；或 (b) 显式移入 Out-of-Scope 并说明（"确定 drop 后手动重连不自动重建 tab"）。别让它悬在 AC-4 字面与实现之间。

---

### EXT-B-4 · MEDIUM · Sidebar 断线 effect（298-326）改造未定义新状态机；selectionLock 可能在多分钟重连期冻结整个 sidebar

- 现 `Sidebar.tsx:298-326`：`disconnected` → 900ms panel → `stopRemoteWorkspaceSync`。`:336` `selectionLocked = 有任何 panelHosts` → panel 期间**锁死点击其它 workspace 行**（`:335` 注释：防半路打断）。
- 重连预算 ~2min / 8 次（TECH §错误处理）。TECH 只说"disconnected 不再无条件 900ms→drop，改由 reconnectController 决策"，但**没给新状态机**（disconnected→reconnecting→ready | retry-failed | 确定 drop）也**没说 selectionLock 在 reconnecting 期的语义**。
- 若现有锁语义顺延到 reconnecting：用户在**长达 2 分钟**内无法切换任何 workspace——严重 UX 回归，且正是评审 prompt 问的"改 drop 时机会不会碰 BL-004"的实处。

**建议**：明确 reconnecting 为**非锁定态**（重连期用户可自由切 workspace / 切 tab），并把完整转移表 + panel/lock 语义在 blueprint 钉死再实现。BL-004 的 workspace 作用域隔离本身不回归（stop 仍 per-configId），风险在**时序与锁**，不在 scope。

---

### EXT-B-5 · MEDIUM · SessionAttachResult 缺 end/next 绝对偏移，renderer 须自算 byteLength 推进 renderedBytes（跨运行时脆弱）

- TECH §数据结构 `SessionAttachResult = {found, full, baseOffset, data, snapshot}`——**只有起点 baseOffset，无终点**。
- renderer 写完回放切片后要把 `renderedBytes` 推到切片末尾，才能让紧随其后的 live `pty:data`（携 host 算好的 `bytes`）对齐。但 DTO 不给末尾偏移 → renderer 只能 `renderedBytes = baseOffset + byteLength(data)` 自算。renderer 无 `Buffer`，得用 `TextEncoder().encode(data).length`，且该值必须**逐字节等于** host 切片时的 absoluteOffset，否则首个后续 pty:data 错位 → 双写/空洞。
- TECH §补充洞察点了"用 bytes 不用 data.length"（好），但**没点这条自算脆弱性**：切片经 JSON 字符串往返（UTF-8 解码再编码），只有在 ring 保证切在码点边界时才干净——耦合了两处不变式。

**建议**：给 SessionAttachResult 加 `nextOffset`（= host 切片时的 absoluteOffset），renderer 直接权威赋值 `renderedBytes = nextOffset`，不自算、不依赖跨运行时 byteLength 一致。成本一个字段，消一类花屏根因。

---

### EXT-B-6 · LOW · exited 保留态的 `pool.pid()` 返回陈旧非空 pid；`pty.cwd` 会对死 pid 取 cwd

- TECH §数据结构断言 exited 会话"pty 已死，仅取 pid=null"。但 node-pty 的 `pty.pid` 在进程退出后**仍返回原 pid**（不会变 null）。`ptyPool.ts:131-133` `pid()` = `session.pty.pid ?? null` → 对保留在 map 里的 exited 会话返回**陈旧 pid**。
- 连带 `hostCore.ts:190-191` `pty.cwd`：`pid===null ? null : await processCwd(pid)` → 会对已死 pid 调 `processCwd`（拿到空/错误）。

**建议**：`pid()` / `pty.cwd` 对 `status==='exited'` 显式返回 null（或调用方查 status）；加一条 exited 会话 pid()===null 的单测（与 TC-003 embedded 分支对称）。

---

### EXT-B-7 · LOW / advisory · renderer 心跳能在 T≤10s 判断线，但 main 侧 SSH 层可能同样迟滞；reconnect 前须确保 main 拆掉陈旧 ssh

- app 层心跳（AC-13）解决 renderer↔host 的 onclose 不及时。但**同一 TCP 挂起**也会拖慢 main 的 ssh close 检测——`orchestrator.ts` 未见 `ServerAliveInterval`/keepalive；`handleTransportDown` 靠 `ssh.onClose`（`:449`）触发，合盖场景可能数分钟不响。
- reconnectController 调 `remoteHost.connect(configId)` 时，若旧 ssh 会话仍"挂起未关"，重建是否干净未验证。这在已 defer 的 AC-13 真机 spike 范围内，但 blueprint 应点明：**renderer 侧检测到断线 ≠ main 已拆隧道**，reconnect 需驱动 main 先关旧 ssh 再重建。

**建议**：reconnect 路径显式 teardown-before-rebuild（或给 ssh 配 ServerAliveInterval）；真机 spike 断言"合盖→main 在有界时延内 disconnected 并可重连"。

---

### EXT-B-8 · LOW / advisory · 安全：单租户 + loopback + token 闸下可接受；建议明写信任边界与"静默顶替"性质

- 攻击面已被 `wsServer.ts:204-210`（强制 loopback bind）+ `:252` token 闸（缺失/错误同路径 `socket.destroy`，零信息）+ 128-bit 熵收窄：要顶替会话，攻击者须**同时**持有 token **且**能触到被转发的回环端口。
- 残余（QA-15 已 note，我背书其可接受但建议显式化）：D-9 砍掉时间型 reap → 会话（及其可认领窗）随 host 进程存活而无上界；任何**曾**拿到 token 的进程（如误入日志——`host.ts:89-92` 已对驻留态防落盘）可在会话整个生命期内**静默**顶替其 I/O。last-attach-wins 对旧 owner **无任何通知**（AC-14），故 token 泄露 = 不可察觉的接管。

**建议**：非 blocker。TECH §安全建议重申信任边界（loopback + token 保密单支撑）并明写"所有权转移对旧 owner 静默"，让运维知道 token 一旦泄露的爆炸半径。

---

## 核验通过清单（grounding 真实性 · 我逐行对过）

TECH §现状基线引用的行号**全部属实**，无杜撰：

- `ptyPool.ts:82-93` onData 流控憋停 ✅ · `:95-100` onExit 立即 delete + 发死通道 ✅ · `:108` ack 是计数非位置 ✅ · `send` 闭包 spawn 定死（`:19/79`）✅
- `hostCore.ts:125-126` port close 即 kill 全会话 ✅ · `:107-119` per-client `Set` 守卫 ✅ · `:263-264` unknown rpc default throw → `:267-276` catch 转 `rpc:res ok:false` ✅ · `createHostCore()` `:70` 无 mode 入参 ✅
- `sessionTracker.ts:20` state 公有 · `:21` quiet 私有无 getter · `:67-69` onAltScreen 只 emit 不存储 ✅
- `wsServer.ts:281-302` 心跳是 server→client（无 renderer app 层心跳）✅ · `:252` token 闸在 upgrade ✅
- `host.ts:43` `--listen` 分流 · `:14` `createHostCore()` 在分流前（形态注入点）✅
- `hostClient.ts:155` connectPromise 陈旧早返 ✅ · `:139-147` markDown 置 down 拒 rpc ✅ · `:173-178` dispose 丢结构 ✅ · `:303` onClose→markDown ✅
- `terminalRegistry.ts:31-50` TermInstance 持 sessionId/hostId/client · `:221` findTab 复合键 · `:182` write 回调 ack（绝对偏移记账挂载点）✅
- `remoteWorkspaceSync.ts:78-82` stopRemoteWorkspaceSync = teardown + dropHostWorkspaces + drop ✅
- `Sidebar.tsx:241-272` beginHandshake by verifying{tunnel} · `:298-326` disconnected→900ms→stop ✅
- `protocol.ts` HostInfo 有 `minCompatible?`（可选字段先例）· **无** capabilities（追加成立）· RpcMethods 表单源 ✅
- `orchestrator.ts:420-427` handleTransportDown emit disconnected · `:652-657` verifying{tunnel} ✅
- （额外核验）`residency.ts:75` claim 判据 · `:81-82` reapThenDeploy kill · `:177` 单次 probe 无重试 ✅

## 红线合规结论

- **UI 不碰 fs/PTY/git**：新增 renderer 代码（reconnectController/renderedBytes/readoptHost）仍只经 hostClient RPC，未直碰 PTY ✅
- **host 零 Electron import**：ring/exited 态/reattach/snapshot 全在 `src/host/` 纯 Node 层 ✅
- **协议向后兼容**：session.list/attach + `HostInfo.capabilities?` 纯追加，旧 host 走 unknown-rpc catch（`hostCore.ts:264`）稳定退化；能力位判存在性非文案匹配（QA-14）✅。不 bump PROTOCOL_VERSION 与 minCompatible 先例一致 ✅
- **本机零回归**：embedded mode 四点（不分配 ring / close 仍 kill / onExit 立即 delete / 不进 list）设计自洽；TC-003/004 覆盖 ✅

## 与 arch/qa 视角的差异（本审新增的洞）

arch/qa 已充分覆盖 host 内三处并发（旁路流控 / 游标 / 转移）与 8 硬门。本审补的是**它们视角外的跨模块接线缝**：EXT-B-1（重连事件的多订阅者路由）、EXT-B-2（重连续存对 orchestrator residency 的静默依赖 + reap 假阴性）、EXT-B-4（Sidebar 锁语义在长重连期的 UX）——这三条都在"host 单模块"与"renderer 单模块"的评审焦点之间的**边界**上，是端到端串一遍才暴露的。
