---
reviewer: architect
feature: TERMPRO-F260709092310-Host-Standalone-Transport
scope: git diff c66b717..HEAD (de7cbac 阶段A-E + 8570979 阶段F)
verdict_recommendation: 通过
findings:
  - id: A-1
    severity: MINOR
    title: fs.watch 集成测 waitFor 3000ms 对 300ms 去抖 + 无界 FSEvents 延迟余量偏紧,是观测到的重负载偶发失败最可能来源
    files: [src/host/__tests__/wsRpcParity.test.ts, src/host/__tests__/wsMultiClientIsolation.test.ts]
  - id: A-2
    severity: MINOR
    title: T-038 PTY echo 等待 5000ms,与其余 PTY echo 用例 12000ms 不一致且偏紧
    files: [src/host/__tests__/wsRpcParity.test.ts]
  - id: A-3
    severity: MINOR
    title: host.info-first 门控的安全价值仅止于协议卫生(token 已是唯一鉴权屏障);严格 pipelined 拒绝依赖同段/微任务时序,正确但非鉴权边界
    files: [src/host/wsServer.ts]
  - id: A-4
    severity: MINOR
    title: 认证失败告警在窗内越过阈值后每次失败都重复 emit,持续坏 token 洪泛下会刷 WARN 日志
    files: [src/host/wsServer.ts]
  - id: A-5
    severity: NIT
    title: 门控 done 迁移以数字 host.info id 为键;非数字/缺 id 的 host.info 会先回响应再挂到握手超时而非干净开闸(真实客户端恒用数字 id,不可达)
    files: [src/host/wsServer.ts]
  - id: A-6
    severity: NIT
    title: 无并发连接数 / 聚合内存上限(32MiB × N);在既定威胁模型内(token 闸 + loopback)可接受,建议 BL-003/005 补有界连接
    files: [src/host/wsServer.ts]
  - id: A-7
    severity: NIT
    title: package-host.mjs detectNativeDir 无条件优先 build/Release;手工跨平台且不传 --native-dir 可能错标原生二进制(CI 矩阵各跑本机 runner 不受影响)
    files: [scripts/package-host.mjs]
  - id: A-8
    severity: NIT
    title: wsServer 注册两个独立 wss.on('connection') 处理器,可合并提升可读性
    files: [src/host/wsServer.ts]
---

# REVIEW-arch — Host Standalone + WS 传输 + 握手(architect 视角)

## 结论摘要

**verdict 建议:通过(APPROVE)**。深入读过全部安全敏感路径与新增核心代码,并对「已知偶发单测失败」做了实证复现尝试。

- **无 BLOCKER,无 MAJOR**。所有 AC 的安全承诺在真实代码里成立:token env 读后即抹的时序、常量时间比较、loopback 强制、pty.kill/pty.cwd 归属守卫、断连精准回收、AC-5 嵌入式零侵入、版本区间纯函数,逐条核实通过(见 §安全路径核对 / §红线核对)。
- **8 条 MINOR/NIT** 均为测试余量、日志卫生、跨平台打包脚手架的健壮性改进,**不阻断合并**。
- **关于 state.json 的偶发失败 WARN**:实证结论是「重负载余量敏感,非确定性 bug」——不构成 MAJOR(拿不出确定性失败输入)。详见 §时序脆弱点实证。

架构抽取干净、简洁性把控好(counter-lens 下未见过度设计),契约改动面收窄到位。

---

## 时序脆弱点实证(核实 state.json WARN)

state.json concern:两 worktree 并行重负载时 348 中出现过 2 次偶发失败,未捕获具体用例。我做了如下实证:

| 场景 | 结果 |
|---|---|
| 静默环境 WS 集成套件 ×5 | 85/85 全绿 ×5 |
| CPU 燃烧(16×`yes`,load→100)下 WS 套件 ×6 | 85/85 全绿 ×6 |
| 两 vitest 全量并发(load→128) | 各 343/343 全绿 |
| 本 worktree 绝对路径全量 + typecheck | 348/348 全绿 · tsc 零报错 |

**判定:非确定性 bug**。RD 已针对本 Feature 唯一的真时序竞态(pipelined 帧的同段到达)在 T-010 用 `socket.cork()/uncork()` 强制同 TCP 段消除非确定性;`vitest.config.ts` 已把 testTimeout 抬到 20s。观测到的失败发生在病理并发(两个全量 vitest × 各 ~20 worker + 子代理评审同抢 18 核)下,属**余量敏感**。风险最高的是 FSEvents 依赖的 fs.watch 用例(A-1),其次是 T-038 的 5s PTY echo(A-2)——见对应 finding 的可操作建议。生产运行时无对应脆弱点(门控/心跳/回收的时序不依赖负载,均为事件驱动 + 定时器,见下)。

---

## Findings 逐条实证

### A-1 (MINOR) fs.watch 集成测余量偏紧 —— 最可能的偶发失败源
- **实证**:`watchService.ts:7` `DEBOUNCE_MS = 300`;首个 `fs:changed` = FSEvents 通知延迟 + 300ms 去抖。而 `wsRpcParity.test.ts:140` T-032、`wsMultiClientIsolation.test.ts:135/149` T-042/T-043 均用 `waitFor(..., 3000)`。macOS FSEvents 在重负载下延迟无上界(实测可达数秒)。对比同套件里 PTY echo 类一律给 `12000`——fs.watch 的 3000 是全套最紧且最不可控的余量。
- **影响**:CPU 争用极端时,首个 fs:changed 可能 >3s → `waitFor timed out`。与 WARN 的「时序敏感 WS 用例」高度吻合。
- **建议**:把 fs.watch「首个事件」等待抬到与 PTY 一致的 8–12s(纯放宽上限,happy-path 仍是 ~400ms,不拖慢正常运行);或在项目约定「单 vitest 进程」为受支持不变量并记入 test-baseline。非阻断。

### A-2 (MINOR) T-038 PTY echo 5s vs 别处 12s 不一致
- **实证**:`wsRpcParity.test.ts:260` `waitFor(frame_check, 5000)`;而 T-034(:177)、T-035、隔离套件里同类 PTY echo 均 `12000`。登录 shell(`/bin/sh -l`)首帧回显在重负载下偶尔 >5s。
- **建议**:统一到 12000。非阻断。

### A-3 (MINOR) host.info-first 门控:安全价值定位 + 时序依赖(简洁性/健壮性观察)
- **实证**:`wsServer.ts:203-222` upgrade 阶段已用 token 做唯一鉴权;`createWsPortAdapter`(:54-162)的门控是在**已鉴权连接**上强制「首条必须 host.info」。因此门控**不是**鉴权屏障,而是协议卫生。其「pipelined 第二帧严格拒绝」依赖 `postMessage` 里 `queueMicrotask` 延迟置 `done`(:129-143):同段到达的第二帧在微任务前落 `awaiting-response` → 违规断开;分段到达则 gate 已 done → 放行。我逐步核实:`ws` 未压缩帧在单次 socket read 内同步 emit 多条 message,微任务不在其间 drain,故同段严格拒绝成立;分段「放行」方向因客户端已持 token 而**无安全影响**。
- **半连接态核实**:连接在 host.info 前即 `attachClient`(:232),但门控确保 host.info 之外的任何入站消息都到不了 `handleRpc`(awaiting-first/awaiting-response 下非 host.info 一律 terminate);握手超时(:67-72,默认 10s)+ 心跳(:241-256)双重回收 pre-handshake 静默连接,`ws.terminate()`→`close`→hostCore 精准回收(`hostCore.ts:111-121`)。**无资源泄漏、无可利用半连接态**。
- **定位**:实现正确,记录其安全边界即可。非阻断。

### A-4 (MINOR) 认证失败告警重复 emit
- **实证**:`wsServer.ts:191-201` `recordAuthFailure` 在 `authFailures.length >= 10` 时 emit;窗内一旦越阈,后续每次失败都仍 ≥10 → 每次都 emit WARN + `onAuthAlert`。持续坏 token 洪泛下刷屏。
- **建议**:越阈后节流(如每窗一次,或指数退避 emit)。非阻断(external CR-3 明确「告警 only 不阻断」是对的,这里仅是日志卫生)。

### A-5 (NIT) 门控 done 迁移以数字 id 为键
- **实证**:`wsServer.ts:102` `pendingHostInfoId = typeof data.id === 'number' ? data.id : null`;:135 `m.id === pendingHostInfoId`。若 host.info 携非数字/缺 id,`pendingHostInfoId=null`,响应发出后 gate 不置 done → 挂到握手超时 terminate。真实客户端(`hostClient.ts:220` `++this.seq`)恒用数字 id,不可达。仅健壮性注记。

### A-6 (NIT) 无并发连接 / 聚合内存上限
- **实证**:`wsServer.ts:184` 仅设 `maxPayload`(单帧 32MiB),无连接数上限、无聚合内存闸。威胁模型内(未持 token 者 upgrade 即 `socket.destroy()`;持 token 者即受信方)可接受。建议 BL-003/005 接远程隧道后补有界连接。

### A-7 (NIT) 打包脚本原生目录探测的跨平台脚手架
- **实证**:`package-host.mjs:77-89` `detectNativeDir` 无条件先看 `build/Release`,再看 `prebuilds/<platform>`。手工在 macOS 传 `--platform linux-x64` 但不传 `--native-dir` 时,会把本机 arm64 的 `build/Release` 或落空的 `prebuilds/linux-x64` 误组进 linux 标签产物。CI 矩阵(:26-31 各跑本机 runner)与 D-1 spike(显式 `--native-dir`)均规避了此路径,交付流程无缺陷。仅注记误用面。

### A-8 (NIT) 两个 connection 处理器
- `wsServer.ts:224` 与 :237 各注册一个 `wss.on('connection')`(前者接入 adapter,后者装心跳)。功能无碍(按注册序同步触发),可合并一处提升可读性。

---

## 红线核对(DEV-RULES / README §5)

| 红线 | 结论 | 证据 |
|---|---|---|
| Host 进程零 Electron import(远程就绪) | ✅ | `hostCore.ts` 仅 import node 内建 + 本地 service;`wsServer.ts` 仅 node:http/net + ws + 本地;`token.ts` 仅 node:crypto/fs;`host.ts` 无 Electron。parentPort 经 `process.parentPort` 运行时取,不引类型(host.ts:82) |
| UI 不碰 fs/PTY/git | ✅ | renderer 侧仅 `hostClient` 走协议;Transport 抽象未引入任何直连 fs/pty |
| 改契约先改 protocol.ts | ✅ | `PROTOCOL_MIN_COMPATIBLE` + `HostInfo.minCompatible?` 落在 protocol.ts;不碰 HostMessage union(与 BL-001 零冲突);向后兼容不 bump 版本 |
| 嵌入式 MessagePort 路径零侵入(AC-5) | ✅ | 门控/token/版本逻辑全夹在 wsServer/wsPortAdapter 与 hostClient WS 分支;T-013 用裸 PortLike 证嵌入式不受门控,T-063 证嵌入式不做版本校验(host 声明 v999 仍连上) |

---

## 安全路径核对(本 Feature 安全敏感)

| 安全项 | 结论 | 实证 |
|---|---|---|
| token env 读后即抹时序 | ✅ 正确 | `token.ts:55-59` 无条件 `delete env[TOKEN_ENV]`(读时,选用与否都删);`host.ts:43` 在 `startWsServer` 前同步调用 → 任何 `pool.spawn` 之前。`ptyPool.ts:46` `{...process.env}` 泄露向量已确认存在,故删除是必要且到位的。T-025/T-030 断言顺序 + PTY 内 `$TERMPRO_HOST_TOKEN` 为空 |
| 常量时间比较 | ✅ 正确 | `token.ts:101-107` sha256(provided)+sha256(expected) 后 `timingSafeEqual`(定长 32B 消除长度泄露、无提前 return);非字符串 guard 返回 false。sha256 耗时仅随攻击者自控的 provided 长度变化,不泄露 expected |
| loopback 强制的绕过面 | ✅ 未见绕过 | `wsServer.ts:170-176` 白名单 {127.0.0.1,::1,localhost} 且**绑定同一字符串**(无 TOCTOU/无解析歧义);`host.ts:26-34` parseListen 缺省回落 127.0.0.1 且下游再校验(纵深);IPv6 方括号处理正确。T-022 证 0.0.0.0 被拒 |
| host.info-first 门控状态机(pipelined/半连接) | ✅ 无漏洞 | 见 A-3:token 已鉴权;门控确保非 host.info 消息到不了 handleRpc;同段 pipelined 严格拒绝、分段放行无安全影响;pre-handshake 静默连接由握手超时+心跳双回收 |
| 心跳回收资源泄漏 | ✅ 无泄漏 | `wsServer.ts:236-256` isAlive WeakMap(terminate 后 GC);handshakeTimer 与 heartbeat 均 `unref()` + close 时 clear;terminate→close→hostCore `clients.delete`+`watches.dispose`+`pool.kill`(hostCore.ts:111-121)。T-045 证 pong 超时→terminate→回收自身、B 不受影响 |
| maxPayload DoS 面 | ✅ 受控 | 32MiB 单帧上限;超限 ws emit 'error' 被 adapter `ws.on('error')`(:121-123)兜住不崩进程。T-048 证超限断开发送方、host 存活。聚合上限见 A-6(威胁模型内可接受) |
| token 泄入日志/PTY 环境 | ✅ 不泄露 | host 侧不记 URL(裸 http + 手工 upgrade,无 request 日志);拒绝日志 `[host] ws auth rejected` 不含 token;error 日志仅 err.message;仅 source==='generated' 时按契约单行 stdout 打印(供 caller 捕获,设计使然)。env/file/fd/stdin 来源不回显。PTY 环境经 env 抹除已隔离 |
| pty.kill/pty.cwd 归属校验 | ✅ 补齐 | `hostCore.ts:159-166` kill 守 `client.sessions.has` 静默忽略;:167-177 cwd 守卫返回 `{cwd:null}`。T-041/T-041b 证跨客户端被拒。复查其余以 sessionId/watchId 为参的 handler:pty:input/resize/ack 已守(:92-106);fs.unwatch 走 per-client WatchService,watchId 结构性隔离(:195-196)——**无其他未覆盖的 capability-style handler** |

---

## 简洁性评估(counter-lens)

- **Transport 抽象只抽一层**:client 侧 `Transport`(send/onMessage/onClose/close)两实现,`hostClient` 公共 API 一字未改(T-061 断言);host 侧复用既有 `PortLike`。未过度设计。
- **hostCore 抽取真传输无关**:仅依赖 PortLike 契约,嵌入式/WS 双传输复用全部多客户端路由与归属回收;门控/token/版本零下沉。分层达成 AC-5 承诺。
- **版本区间纯函数**:`isProtocolCompatible` 化简为 `max(Mc,Mh) ≤ min(Vc,Vh)`(闭区间边界正确,缺省 minCompatible 回落 protocolVersion),放 shared 供两端 + 测试复用,合理。
- **唯一「聪明」处**:门控的 `queueMicrotask` 延迟置 done(A-3)。为满足「pipelined 第二帧严格拒绝」这一确有要求的行为,该机制是必要的,不算过度;但其安全价值与时序依赖值得在注释/文档里点明定位(已在 :129-143 有较充分注释)。

**净评**:契约改动面收窄(HostInfo 加一字段 + 一常量,不碰 union)、新增逻辑分层干净、无 YAGNI 违背。批准合并;上列 MINOR/NIT 作为后续小改与 BL-003/005 承接项即可。
