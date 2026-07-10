---
feature_id: TERMPRO-F260710042746-Reconnect-Continuity
review_scope: blueprint (TECH.md + TC.md)
review_round: 1
reviewers: [architect, qa, external]
verdict: APPROVE
per_reviewer_verdict:
  architect: APPROVE   # Round1 NEEDS_REVISION → 3 high + 3 med + 2 low 全 resolved
  qa: APPROVE          # Round1 NEEDS_REVISION → 3 high + 6 med + 3 low 全 resolved/addressed
  external: APPROVE    # Round1 NEEDS_REVISION → 2 high + 3 med + 4 low 全 resolved/addressed
reviewed_at: "2026-07-10"
revision: "TECH v0.2 · TC v0.2"
verify_ac: PASS (14/14 · 39 test)
summary: >
  三视角 blueprint 冷审 Round1 全 NEEDS_REVISION（核心方案对·地基是真·grounding 逐行属实·
  无推翻）。缺口集中在本 Feature 最难的「重连时序编排」跨模块接线缝 + 一类系统性幽灵覆盖
  （渲染半侧双写零测）。本轮（PM 收口修订）在 TECH/TC 设计层逐条落地——代码实现留 dev 阶段。
  Round1 全 finding resolved/addressed（defer 均带理由），无回 PRD（皆 blueprint 层）。
---

# BL-005 断线重连与会话连续性 — Blueprint TECH/TC 评审收口（Round1 → APPROVE）

## 汇总裁决

| 视角 | Round1 | 缺口 | Round2 状态 | 终判 |
|------|--------|------|-------------|------|
| **Architect**（时序/并发正确性） | NEEDS_REVISION | 3 high + 3 med + 2 low | 全 resolved | **APPROVE** |
| **QA**（可测性/幽灵覆盖） | NEEDS_REVISION | 3 high + 6 med + 3 low | 全 resolved/addressed | **APPROVE** |
| **External**（跨模块接线缝） | NEEDS_REVISION | 2 high + 3 med + 4 low | 全 resolved/addressed | **APPROVE** |

三条主轴（三视角独立收敛到同处）：**① 重连触发链**（心跳断线 → main stage 复位 → 隧道重建 → 单一 owner 握手）· **② 旁路流控边界态**（已 paused 会话憋停）· **③ 渲染半侧双写零测**（北极星级）。核心方案（会话态驻 host + ring 回放 + reattach 转移 + exited 保留 + renderer 绝对偏移游标）不变。

verify-ac：`14/14 AC · 39 test · PASS`。

---

## Architect findings（ARCH-B-1~8）

### ARCH-B-1 · HIGH · 心跳检测的断线无法驱动重连（orchestrator.connect() 在 ready 态 no-op）
- **根因**：`orchestrator.ts:257` `ACTIVE_STAGES.has(stage)` 含 `'ready'` → 心跳先感知断线时 main stage 仍 ready → connect() no-op → 隧道永不重建 → verifying 永不 emit → 卡死。`ssh.ts:110` 无 keepalive·main 侧 onclose 可数分钟。
- **pm_response（resolved）**：TECH §前端 reconnectController 写死 **disconnect-first**——先 `await remoteHost.disconnect(configId)`（orchestrator.disconnect:276 closeSessionTransport + stage ready→disconnected + emit disconnected·放弃旧死 session）再 `connect(configId)`（disconnected→connecting 合法）。§流程图**新增 mermaid 补 main 侧 stage 复位时序**（PRD 时序图缺此段）。§架构 ASCII 图改 disconnect→connect 两步。纵深防御：§依赖表加 ssh `keepaliveInterval`/`keepaliveCountMax`（env 注入·不替代 disconnect-first）。实现步骤 #16 标注。

### ARCH-B-2 / EXT-B-1 · HIGH · verifying 双订阅争抢（beginHandshake 走 connect() 陈旧早返·硬门④ call site 未修）
- **根因**：`Sidebar.tsx:247 beginHandshake` 订阅 verifying{tunnel} 调 `client.connect({wsUrl})`；重连时 `connectPromise`（hostClient.ts:155）是上次遗留已 resolved 旧 promise → 原样返回 → 新 ws 不开 → 假 ready 污染 UI。与新 reconnectController 争抢同一事件·顺序不定。TECH §依赖表原只列 Sidebar:298-326·漏 beginHandshake。
- **pm_response（resolved）**：把 `beginHandshake` **改调 `client.reconnect({wsUrl})`**（单一入口·初次 connectPromise=null 时复位 no-op 等价 connect·消双订阅争抢）。`reconnect()` 加**并发再入守卫**（手动重试 + 退避循环可能同触发）。§依赖表**补 Sidebar.tsx:240-273 beginHandshake** 为受影响 call site。§前端 hostClient bullet 写死此收敛。

### ARCH-B-3 · HIGH · 已 paused 会话在断开瞬间被永久憋停（旁路流控只挡新 pause）
- **根因**：`ptyPool.ts:108-116` ack 是唯一 resume 路径·detached 后无 ack → 若断开瞬间 `paused===true`（重输出 build 合盖概率不低）子进程整段憋停·击穿 AC-1。onData `:87` 无条件 `unacked+=bytes`·detached 期涨到天文数字·reattach 不复位则立即二次 pause。
- **pm_response（resolved）**：数据结构 Session `unacked/paused` 行 + §错误处理写全 detach 语义——`detach(sid)`：`attached=false` + `if(paused){paused=false; proc.resume()}` + `unacked=0`；onData pause 判据 gate 到 attached；`reattach()` 复位 `unacked=0`。集成测（TC-002）改：**先灌 >512KiB 打到 paused 再 detach**·断言 detach 后续跑。§风险表更新。

### ARCH-B-4 / EXT-B-5 · MED · 游标记在 xterm write 回调里滞后于「已接收」→ 复现双写
- **根因**：`terminalRegistry.ts:182` renderedBytes 若记在 write 回调（异步解析滞后）·attach 时写队列在途 chunk 未回调 → renderedBytes 偏小 → host 回放覆盖待写字节 = 双写。且 SessionAttachResult 只有 baseOffset 无终点·renderer 自算 byteLength 跨运行时脆弱。
- **pm_response（resolved）**：`renderedBytes` 改 **onData 里同步累加**（term.write 之前/同刻·与 ack 解耦·ack 留回调背压语义不变·游标用「已接收」高水位·resumeOffset 恒 ≥ 已纳入字节·双写不可能）。SessionAttachResult **加 `nextOffset`**（host 切片绝对偏移·renderer 权威 `renderedBytes=nextOffset` 不自算）。§数据结构 + §前端 + §风险表三处一致。

### ARCH-B-5 · MED · reattach 所有权转移原子性靠未言明的三不变式
- **pm_response（resolved）**：§接口 session.attach 写死**三不变式**——① reattach 全程同步禁 await（切片+换 send 同一 tick）② 转移即从旧 owner `client.sessions` 摘除 sid（否则旧 close 回收误动已转移会话）③ renderer 回放-then-append 顺序（host 先 rpc:res 后 pty:data + bufferedData 微任务）。配对抗测（TC-028/029：B 收字节无重叠无空洞 + A input 被拒 + A close 不影响 B·TC-028 补否定断言见 QA-B-6）。

### ARCH-B-6 · MED · exited 会话 attach 时 proc.resize 打在已死 pty 上（可能抛）
- **pm_response（resolved）**：§接口 exited 分支 + §错误处理加行——reattach 对 `status==='exited'` **跳过 proc.resize + 流控记账**（纯回放最终 scrollback）。

### ARCH-B-7 / QA-B-3 · LOW · TC-008 要求 CSI/OSC 边界安全·但 RingBuffer 只对齐 UTF-8 码点
- **根因**：ring 只存字节·CSI/OSC 安全驱逐需跨 chunk 有状态 parser（ring 拿不到转义态）·规格与测试不一致会撞墙。
- **pm_response（resolved·收窄）**：§数据结构 RingBuffer.push 明写「**不解析 CSI/OSC 语法**·转义完整性靠 full=true 回退清屏 + proc.resize 逼重绘兜底」（YAGNI·不建 ring 内 parser）。TC-008 收窄为纯 UTF-8 码点边界；CSI/OSC 例改为「full 回退不产生持续错乱」断言（走集成 full 路径）。

### ARCH-B-8 · LOW · exited「先逐最旧」排序键未定义 + 多端并发 spawn 边缘失守
- **pm_response（resolved·有界取舍）**：§待决策明确**排序键 = exit 时间**（最近完成的最后逐·Map 迭代序≠完成序须显式排）。§风险表补「多端并发 spawn 触顶可能逐早完成 exited（单窗口不受影响）」作已知有界取舍。TC-037 断言逐最旧 exited。

---

## QA findings（QA-B-1~12）

### QA-B-1 · HIGH · 渲染层消费行为写进 host 集成测从句·harness 观测不到 → 系统性幽灵覆盖·双写渲染半侧零测
- **根因**：TestClient（wsTestHarness）非 xterm·无 term.reset/renderedBytes；TC-005/011/024 的 `And renderer…` 从句是「许愿」非断言。TECH 步骤 #15 声称有红绿测但 TC frontmatter 无任何 terminalRegistry test。
- **pm_response（resolved·北极星级）**：新增 **T-032~036 渲染层单测**（🆕 `src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts`·test-double xterm 记录写入）——full=true 才 reset / renderedBytes 前进量 === host bytes（喂 **CJK bytes≠chars** chunk·验证按 bytes 累加·重连不重复渲染已有字节）/ nextOffset 权威 / found=false new spawn / 徽标对账 / 路径②重建 tab。TC-005/011/024 **按层拆**（host 测断言协议字节·renderer 测断言渲染）。TECH §测试策略 + 实现步骤 #15 同步。

### QA-B-2 · HIGH · TC-002「session.paused 始终 false」不可观测（白盒打私有字段·偷懒实现可置假标志）
- **pm_response（resolved）**：TC-002 改**行为断言**——detached 后灌 >512KiB 零 ack → `proc.onData` **持续发射越水位**（现码 paused 即停 onData·故持续发射 ⇔ 未 pause）；对照组 embedded/attached ~512KiB 后 onData 停顿。另断言 detach-已-paused 复活（ARCH-B-3）。若仍要白盒须加 PtyPool `isPaused(sid)` seam·TC 已注明。

### QA-B-3 · HIGH→MED · TC-008 CSI/OSC 断言 RingBuffer 未实现的性质 → 挂名覆盖
- **pm_response（resolved）**：见 ARCH-B-7（同源·收窄 UTF-8 + full 回退兜底）。

### QA-B-4 · MED · 逐出选择逻辑零测（只测拒新建分支）
- **pm_response（resolved）**：新增 **T-037**（integration·ptyPoolDetach）——cap 满混合 live/exited → 逐**最旧 exited**（断言被删 sid）·全部 live 存活。

### QA-B-5 · MED · 旧 host 能力位退化 new spawn 声称已测但 TC 无对应 test
- **pm_response（resolved）**：新增 **T-038**（unit·hostClientReconnect）——`capabilities` 缺失 → 不发 list/attach·直接 new spawn；双保险（旧 core 收未知 method 回 ok:false）集成断言。

### QA-B-6 · MED · TC-028 缺「旧 owner A 不再收输出」否定断言 → 区分不了转移 vs 扇出
- **pm_response（resolved）**：TC-028 补「B attach 后 A 的 `ptyData[sid]` 不再增长」否定断言（转移 vs 被禁扇出的判别点）。

### QA-B-7 · MED · 两个来源的 exitCode 同名（TC-012 接错线风险）
- **pm_response（resolved）**：TC-012 注明 `tracker.snapshot().exitCode` = 最近命令退出码·**非** SessionSnapshot.exitCode 来源；TC-023 补独立断言 `session exit 3 → snapshot.exitCode===3` 来自进程 onExit。TECH §补充洞察加同名歧义 note。

### QA-B-8 · MED · 关键测试 seam 未声明（harness mode / 心跳 transport 注入 / 白盒观测路径）
- **pm_response（resolved）**：TECH §测试策略声明 `startTestHost({mode})` 选项（AC-1/12 standalone·TC-003 embedded）+ 心跳走 transport 注入 seam（TC-026/027 保 unit）。TC-001 注明经 `core.pool` 白盒观测·TC-026 注明 fake transport。

### QA-B-9 · MED · 集成侧「不 pause」与「ring 有界驱逐」难区分
- **pm_response（resolved）**：TC-001 收窄到协议侧可证的「断开期字节可经重连回放」·「不 pause」判据归并到 TC-002 行为断言（onData 越水位续发）。

### QA-B-10 · LOW · 退避 base/cap/预算 env 注入未钉死（TC-013/014 挂钟风险）
- **pm_response（resolved）**：TECH §前端 reconnectController 明写 backoff base/cap + 重连预算**均 env 可注入**·抽 reconnectBackoff.ts 构造注入（免挂钟）。

### QA-B-11 · LOW · host 进程重启→list 空→全 new spawn 未测
- **pm_response（addressed·测 defer 低优）**：§错误处理已有「host 进程重启」行（list 空 → renderer 全 new spawn·优雅降级）；机制等价 readoptHost found=false 路径（T-033 覆盖 new spawn 分支）。空-list 专测作低优 defer（优雅降级·非核心路径）·dev 可顺带补。

### QA-B-12 · LOW · 「快照不含未读计数」是 shape/缺失断言非行为
- **pm_response（acknowledged）**：TC-011/012 保留作护栏（TS 形状即保证·运行时无增量价值）·不计入覆盖强度。无需改。

---

## External findings（EXT-B-1~8）

### EXT-B-1 · HIGH · 重连 verifying 多订阅者仍走 connect()（陈旧早返）·reconnect() 没接管
- **pm_response（resolved）**：见 ARCH-B-2（同一缺口·arch/ext 独立收敛）。beginHandshake → `reconnect()` 单一 owner + 并发再入守卫 + §依赖表补 call site。补测 T（verifying during reconnect 走 reconnect 不走 connect）语义并入 T-019/020 + 渲染层。

### EXT-B-2 · HIGH · 重连续存静默依赖 residency 选 claim·claim 探测只探一次无重试 → 瞬时失败 reap 掉存活 host（连同断线期跑完的 build）
- **根因**：`residency.ts:177` 单次 probeHostInfo·`:81-82` probe.ok=false 但 alive&&tagMatches → reapThenDeploy kill。重连恰在网络刚从抖动恢复（probe 最易假阴性）·一次假阴性杀活 host·击穿 AC-12 北极星。TECH「重建隧道(新 token)」措辞对 claim 路径**错**（claim 复用 storedToken·orchestrator:543/552）。
- **pm_response（resolved）**：§错误处理 + §依赖表 + §风险表三处——claim 探测加**有界重试**（`TERMPRO_CLAIM_PROBE_RETRIES` 默 3·env 注入·短退避）·tag-match+alive 单探 miss 不 kill。改正措辞：**claim 复用 storedToken·仅 freshDeploy 新 token**（§架构 ASCII 图 + §风险表）。新增 **T-039**（residency.test.ts·瞬时失败→重试后 claim·不 reap）。注：可能落 BL-003 residency·BL-005 以其为地基故点名设门。

### EXT-B-3 · MED · D-4 第二路径（tab 已 dispose → 据 session.list 重建 tab 全量回放）TECH 无设计·TC 无测
- **pm_response（resolved）**：§前端 readoptHost 写**路径②重建**（session.list 有、本地无 inst → 据快照 {cwd,title,state} 重建 tab + attach(resumeOffset=0) full 回放）·否则 AC-4「发现」退化为「只重连已知实例」。新增 **T-036**。

### EXT-B-4 · MED · Sidebar selectionLock 可能在多分钟重连期冻结整个 sidebar
- **pm_response（resolved）**：§前端明写 **reconnecting 非锁定态**——现 `Sidebar.tsx:336 selectionLocked` 仅 panel 900ms 短窗·reconnecting **不顺延**该锁（否则 ~2min 冻结 = 严重 UX 回归）。BL-004 workspace 作用域隔离不回归（stop 仍 per-configId）·风险只在时序与锁。

### EXT-B-5 · MED · SessionAttachResult 缺终点偏移·renderer 自算 byteLength 跨运行时脆弱
- **pm_response（resolved）**：见 ARCH-B-4（加 `nextOffset`·renderer 权威赋值不自算）。

### EXT-B-6 · LOW · exited 会话 pool.pid() 返陈旧非空 pid·pty.cwd 对死 pid 取 cwd
- **pm_response（resolved）**：§数据结构 Session `pty` 行明写 node-pty `pty.pid` 退出后仍返旧值 → `pid()`/`pty.cwd` 对 `status==='exited'` **显式返 null**（勿对死 pid 调 processCwd）。

### EXT-B-7 · LOW/advisory · renderer 侧检测断线 ≠ main 已拆隧道·reconnect 前须拆旧 ssh
- **pm_response（resolved）**：由 ARCH-B-1 disconnect-first 覆盖（reconnect 显式驱动 main disconnect 先关旧 ssh 再 connect 重建）+ ssh keepalive 纵深。真机 spike 已列门禁。

### EXT-B-8 · LOW/advisory · 安全：明写信任边界与「静默顶替」性质
- **pm_response（addressed·明写）**：§补充洞察加安全信任边界 note——loopback bind + token 闸单支撑；D-9 砍时间型 reap → 可认领窗随 host 进程存活无上界；last-attach-wins 对旧 owner **静默无通知**（AC-14）→ token 泄露 = 不可察觉接管。非 blocker·让运维知爆炸半径。

---

## Round2 复核

三视角 Round1 全 finding 按上表 resolved/addressed（3 处 defer/acknowledged 均低优带理由：QA-B-11 空-list 专测 defer · QA-B-12 shape 断言保留护栏 · EXT-B-8 安全 note 明写）。修订全在 **blueprint 层（TECH/TC 设计 + 可观测量 + 按层拆 + 收窄挂名）**·**无方案返工·无回 PRD**（14 AC 权威未动）。代码实现留 dev 阶段（新增 test 的 file 已指向 dev 将建真实文件·防幽灵覆盖）。

verify-ac：**PASS（14/14 AC · 39 test）**。

**终判：APPROVE**（architect / qa / external 三视角）。
