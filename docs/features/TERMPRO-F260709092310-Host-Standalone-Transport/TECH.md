# Host Standalone 可执行 + WebSocket 传输 + 协议握手 - 技术方案

## 状态
待评审

## 复杂度评估
- [x] 修改文件数: ~11 个(host 5 · renderer 2 · shared 1 · 构建/CI 3),新增 ~4 个(wsServer / transport 抽象 / 测试)
- [x] 涉及多模块: 是(host / shared / renderer / 打包 / CI)
- [x] 数据库变更: **否**(本 Feature 不涉及任何数据库 / 持久化数据结构变更;仅协议 DTO `HostInfo` 追加一个字段)
- [x] 影响现有功能: 是(但 AC-5 P0 钉死零回归 —— 嵌入式 MessagePort 路径行为不变;版本/token/门控逻辑不侵入嵌入式路径)
- [x] 新技术栈/依赖: 是(新增 `ws` 运行时依赖,纯 JS,仅 host 侧;renderer 用浏览器原生 `WebSocket`)

**结论**: 复杂方案(需确认)

**简洁性自查**:
- **是最简方案吗**:是。四条「最小化」抉择均已在 PRD 冷审 3 轮里对抗过并落地为约束:
  1. **不新造握手消息**(ARCH-2):版本+身份复用既有 `host.info`,不引入 hello/welcome/reject 三消息;host 侧只做「host.info-first 顺序门控」,不做版本 enforcement(客户端四数齐备可单方判定,host 回传客户端版本纯属往返膨胀)。
  2. **不发明二进制分帧**(ARCH-6):WS 线格式 = JSON 文本帧承载既有消息形状(PTY 输出本就是字符串流),`WebSocket` 包装成现有 `PortLike` 抽象即可复用 `attachClient` 全部多客户端/归属/回收逻辑。
  3. **不自研网络认证**(PL-1):跨网信任全由 BL-003 的 ssh 隧道承担;host 只做本机 loopback 端口闸(capability token,类比 Jupyter)。
  4. **传输抽象只抽一层**:client 侧 `Transport` 接口(MessagePort / WebSocket 两实现),`hostClient` 公共 API 签名一字不改。
- **想过但拒绝的更复杂方案**:
  - 独立握手协议(能力协商/加密参数帧)→ YAGNI:当前只需版本+身份,`host.info` 已全承载;未来真要能力协商,版本区间本身就能引导升级。
  - host 侧双向版本 enforcement(host 也校验客户端版本)→ 拒绝:需把客户端版本回传 host = 重新膨胀刚砍掉的握手往返,纵深收益为零(客户端单方判定已足够,不存在可交互半连接态)。
  - 真正的「单可执行文件」(SEA/pkg 强做)→ 降级为**门控 spike**:node-pty 的 `.node` + `spawn-helper` 无法塞进 JS bundle,单文件不是硬需求;spike 失败有 D-1 兜底(node≥20 + tar 包)。

## 现状基线（🔴 grounded 真实代码）

已逐字读过下列真实文件,方案基于其现状而非假设:

- **`src/host/host.ts`**(可复用度最高):
  - L36-45 `PortLike` 接口已抽象出传输层契约(`postMessage` / `on('message')` / `on('close')` / `start?` / `close?`)—— **WebSocket 只需包装成 `PortLike` 即复用下游全部逻辑**。
  - L50-55:无 `parentPort` 时 `console.error + exit(1)` —— **standalone 入口就填在这里**(检测 `--listen` argv 走 WS 模式,否则走现有 parentPort 模式)。
  - L88-140 `attachClient(port: PortLike)`:多客户端路由 + 会话/watcher 归属 + `port.on('close')` 精准回收(`pool.kill` + `watches.dispose`)已就绪,WS 路径直接复用。
  - L107-121:`pty:input/resize/ack` 三条 PTY 控制消息**已有** `client.sessions.has(sessionId)` 归属校验。
  - 🔴 **L169-174 `pty.kill` RPC 缺归属校验**(QA-R3-1 实锤):直接 `pool.kill(sid)` 不校验 `client.sessions.has(sid)` —— WS 多连接下 A 可 kill B 的会话。**本 Feature 必修**(见 §接口 / TDD)。
  - 🔴 **L175-178 `pty.cwd` RPC 同类缺陷**(本 RD 复查追加):`pool.pid(sid)` → `processCwd` 泄露非归属会话的 cwd,同一归属校验缺口,一并修。
  - L150-160 `host.info` handler:返回 `HostInfo`,需追加 `minCompatible` 字段。
- **`src/shared/protocol.ts`**:
  - L4 `PROTOCOL_VERSION = 1`;L25-31 `HostInfo` 无 `minCompatible`(需加);消息全 JSON-safe(L135-149)。
  - `HostMessage` union(L142-149)是与 **BL-001 的共享行**(BL-001 加 `workspace:changed`);**本 Feature 不新增任何 HostMessage/ClientMessage 类型**(WS 复用既有形状),协议改动面收窄为「HostInfo 加一字段 + 新增一个 `PROTOCOL_MIN_COMPATIBLE` 常量」,与 BL-001 的合并冲突面极小。
- **`src/renderer/services/hostClient.ts`**:
  - `private port: MessagePort`(L22)硬绑 MessagePort;`connect()`(L84-110)经 `window.termpro.requestHostPort()` 拿 port 后 `rpc('host.info')`。需抽出 `Transport` 接口,`port` 换成 `transport`。公共 API(`rpc`/`attachPty`/`input`/`resize`/`ack`/`onDown`/`onFsChanged`/`onSessionEvent`/`info`)**签名不变**。
  - `info: HostInfo | null`(L39)被 renderer 18 处只读消费(`info?.homedir` 等,grep 已核)—— 追加 `minCompatible` 字段**向后兼容**,无消费方需改。
- **`src/main/main.ts`** L113-139:`utilityProcess.fork(host.js)` + `MessageChannelMain` 建 port 直连。standalone 模式**不经 main**(host 作为独立进程被外部拉起),此路径不改。
- **`src/host/ptyPool.ts`** L46:`baseEnv = { ...process.env, ...opts.env }` 后 `pty.spawn(..., { env })` —— 🔴 **token 若走 env,PTY 会全量继承 `process.env`**(ARCH-R3-1)。因此 host 读取 env token 后**必须 `delete process.env.TERMPRO_HOST_TOKEN` 再允许任何 `pool.spawn`**。
- **`src/host/watchService.ts`**:`WatchService` **per-client 实例**(每个 `Client` 各持一个,host.ts L94),`watch()` 的 `watchId` 是**该实例内自增**(两个客户端会各有 `watchId=1`);`fs.unwatch` RPC 走 `client.watches.unwatch(id)` —— **watchId 归属天然按 client 隔离**(非归属方拿到的 id 只作用于自己的 WatchService)。AC-6 的 watchId 隔离**已由现结构保证**,TC 需验证其不因 WS 帧序错乱。
- **`forge.config.ts`** L16/54/106-122:node-pty 作 external,`packageAfterCopy` 钩子手工搬运 + 裁剪 prebuilds(现仅留 `darwin-*`);asar unpack node-pty(含 `spawn-helper`)。**这是打包 spike 的现成基线**(spike 要把它扩到 linux-x64/arm64 且脱离 asar 语境)。
- **`vite.host.config.ts`**:host build 把 node-pty external。`ws` 是纯 JS,可被 esbuild/vite 打进 host bundle(不违背「零 native 追加」)。
- **`.github/workflows/release.yml`**:仅 `macos-14`,步骤 typecheck/test/smoke/make/公证/发布。**无任何 Linux 打包基建** —— host 打包是全新 CI 能力,必须独立 job 不阻塞既有 macOS 发版 gate(PL-3)。`ci.yml`:ubuntu typecheck+test,可挂 host 侧新单测。

**decisive 前提核验**(方案成立的关键前提,均已对真实文件核实):
- ✅ `PortLike` 足以承载 WS(核 host.ts L36-45):WS 的 message/close/send 语义与 `PortLike` 完全对齐,`ports` 数组恒空(WS 无 MessagePort 转移)。
- ✅ 协议 JSON-safe(核 protocol.ts L135-149 + ptyPool `pty:data` 为 `string`):`JSON.stringify/parse` 无损,WS 文本帧成立。
- ✅ 归属校验缺口真实存在(核 host.ts L169-178):pty.kill / pty.cwd 确无 `client.sessions.has`,不是臆测。
- ✅ token 经 env 会被 PTY 继承(核 ptyPool.ts L46):`{...process.env}` 实锤,`delete` 是必要动作。

**真缺口**:① standalone WS 入口(监听/token 闸/门控/心跳/畸形防护)全新;② client 传输抽象 + WS 实现全新;③ 版本区间校验双端全无(host 只存 `host.info` 未比对);④ node-pty 多平台打包(spike);⑤ pty.kill/pty.cwd 归属校验补齐。

---

## PRD advisory 落定对照（🔴 交付 blueprint 前逐条核 · Round 3 七条)

| advisory | 落定位置 | 精确决策 |
|---|---|---|
| ① QA-R3-1 pty.kill 缺归属校验 | §接口 · §TDD 步骤 | `pty.kill` 加 `client.sessions.has(sid)` 守卫;非归属静默忽略(不回错误,零信息);TC.md **T-041/TC-D03** 覆盖;**pty.cwd 同类一并修**,TC.md **T-041b/TC-D03b** 覆盖 |
| ② ARCH-R3-1 token 走 env 后抹除 | §架构 · token 生命周期 | host 读 `process.env.TERMPRO_HOST_TOKEN` 后**立即 `delete process.env.TERMPRO_HOST_TOKEN`**,再允许任何 `pool.spawn`;顺序断言进 TC-T4 |
| ③ QA-R3-2 版本区间闭区间伪代码 | §数据结构 · 版本校验 | 闭区间重叠判定 `max(Mc,Mh) ≤ min(Vc,Vh)`,给伪代码;`minCompatible` 缺省=`protocolVersion` |
| ④ 量级阈值精确值 | §常量表 | HANDSHAKE=10000ms · PING=30000ms · 失败告警(不阻断)10 次/60s · **maxPayload=32 MiB**(见下,PRD ~10MB 需上修以容纳 readFileBinary 20MB→base64 ~27MB) |
| ⑤ PL-R3-1 D-1 时间盒耗尽即判失败 | §待决策 D-1 | 时间盒 ≤2 工作日,**耗尽即判失败,不因方案未试完而顺延** |
| ⑥ ARCH-R3-2 措辞「客户端主动断开」 | §时序图 · §错误处理 | 全文不兼容路径统一措辞「**客户端主动断开**」(非「连接关闭」) |
| ⑦ PL-R3-2 client 缓存 token 介质锚点 | §补充洞察 | host 侧不落盘;**client 缓存介质留锚点**:建议比照凭据入系统钥匙串(macOS Keychain),具体归 BL-003/BL-005 开工前钉死 |

---

## 技术方案

### 架构

两条传输、一套协议、一份 host 逻辑:

```
嵌入式(默认 · 零回归):
  renderer ─ MessagePortTransport ─╮
                                    ├─ hostClient(公共 API 不变)
远程/loopback(新增 · dev 开关):     │
  renderer ─ WebSocketTransport ───╯
       │ ws://127.0.0.1:<port>?token=…(JSON 文本帧)
       ▼
  standalone host ── wsPortAdapter(WebSocket→PortLike)── attachClient(复用)── PtyPool/fs/git(复用)
       ▲ token 闸 + host.info-first 门控 + 心跳 + 畸形防护(仅 WS 层)
```

**host 侧分层**(关键:新增逻辑全部夹在「WS 连接层」,不下沉进 `attachClient`,保证嵌入式路径零侵入 —— AC-5):

1. **入口分流**(host.ts):`process.argv` 含 `--listen` → `startWsServer()`;否则走现有 `parentPort` 分支(**一字不改**)。
2. **`startWsServer(host, port, token)`**(新增 `src/host/wsServer.ts`):
   - 解析 `--listen 127.0.0.1:<port>`;**强制 loopback**:host 只 `server.listen(port, '127.0.0.1')`,拒绝 `0.0.0.0` / 外部 IP(校验 argv host 段 ∈ {127.0.0.1, ::1, localhost},否则 `exit(1)` 报错)。
   - `new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD, ... })`。
   - **token 校验**(连接建立时,`verifyClient` 或 upgrade 回调):取 `?token=` query(或 `Sec-WebSocket-Protocol` / header);`timingSafeEqual(sha256(provided), sha256(expected))`(先 sha256 消除长度泄露 + 满足常量时间);不匹配/缺失 → **立即 `socket.destroy()`,零信息**(不回 body/reason)。
   - **失败监测(告警 only · 不阻断 · external CR-3 裁决)**:滑动窗口 `AUTH_FAIL_WINDOW_MS=60000` 内失败认证 ≥ `AUTH_FAIL_ALERT=10` → emit **WARN**(`[host] repeated ws auth failures`)供运维观测,**但不 destroy/不冷却后续连接**。裁决理由(architect 简洁性 counter-lens):真实屏障是 128-bit token 熵(爆破不可行);而「阻断式限速」在 loopback 单源下无法区分攻击者与合法客户端,同机攻击者持续发坏 token 即可把冷却窗强加给合法方 = 用一个近零收益的校验换来 DoS 杠杆。故限速降级为纯可观测告警,不阻断合法连接。原 `AUTH_RATE_*` 阻断方案废弃。
   - **host.info-first 门控 + 超时**(仅 WS):每条连接建 `HANDSHAKE_TIMEOUT_MS=10000` 定时器;首条入站应用消息**必须**是 `{t:'rpc:req', method:'host.info'}`,否则 `ws.close()` + 回收;首条即 host.info → 清定时器、开闸,之后消息正常转发给 `attachClient`。超时未发起 → close + 回收。
   - **心跳**:`PING_INTERVAL_MS=30000` 周期 ping;`isAlive` 标记法(收到 pong 置 true,每周期前置 false,仍 false → `ws.terminate()`),静默断连检测窗口 ~30–60s;terminate 触发 `close` → 复用 `attachClient` 的精准回收(会话 + watcher)。
   - **畸形输入防护**(AC-7):`ws.on('message')` 内 `try/catch` 包 `JSON.parse`;非 JSON / 未知 `t` / 校验不过 → 仅**断开该发送方连接**(或忽略该帧),host 进程不崩、其他客户端不受影响;超限 payload 由 `ws` 的 `maxPayload` 直接拒帧关连接。
3. **`wsPortAdapter(ws): PortLike`**(WS→PortLike 适配器,含门控):
   - `postMessage(msg)` → `ws.send(JSON.stringify(msg))`。
   - `on('message', cb)` → `ws.on('message', raw => { try { const data = JSON.parse(raw); gate(data) && cb({ data, ports: [] }); } catch { closeSender(); } })`。
   - `on('close', cb)` → `ws.on('close', cb)`。
   - `start?()` → no-op。
   - 适配器构造后 `attachClient(adapter)` —— 下游 host.ts / PtyPool / WatchService **完全复用**。
4. **token 生命周期**(AC-3 契约,供 BL-003/BL-005 引用):
   - **来源优先级**:显式传入(env `TERMPRO_HOST_TOKEN` / `--token-file <0600 路径>` / `--token-fd <n>` / `--token-stdin`)> 未传则自动 `crypto.randomBytes(16)`(128-bit)→ base64url。
   - **禁 argv 明文**(ARCH-R2-2):不接受 `--token <明文>`(Linux `/proc/<pid>/cmdline` 同机他用户可读,击穿同租户边界)。`--token-file` 须校验文件 mode=0600。
   - **env 读后即抹**(ARCH-R3-1):读 `TERMPRO_HOST_TOKEN` 后**立即 `delete process.env.TERMPRO_HOST_TOKEN`**,在**任何 `pool.spawn` 之前**(否则 PTY 经 `{...process.env}` 继承 token)。
   - **自动生成时** stdout 打印**单行固定格式** `[host] token=<token>`(调用方/ssh exec 捕获);进程存活期固定,**host 侧不落盘、不轮换**。
   - **client 侧缓存不禁止**:该约束仅约束 host 侧;client 可缓存已捕获 token 供重连同一存活 host(host 无感知);持久化介质留锚点(见 §补充洞察),归 BL-003/BL-005。
5. **client 侧传输抽象**(hostClient.ts):
   - 新增 `Transport` 接口(`send` / `onMessage` / `onClose` / `close`),两实现:`MessagePortTransport`(包 MessagePort,行为等价现状)、`WebSocketTransport`(包浏览器原生 `WebSocket`,`onmessage` 内 `JSON.parse`,`send` 内 `JSON.stringify`)。
   - `connect()` 分流:`import.meta.env.VITE_TERMPRO_REMOTE_WS`(dev 开关,值 = 完整 `ws://127.0.0.1:<port>?token=…`)存在 → 走 WS;否则走现有 MessagePort 路径。**默认(嵌入式)分支逻辑不变**。
   - `host.info` 返回后做**版本区间校验**(见 §数据结构);不兼容 → 客户端**主动 `transport.close()`** 并 reject 一个结构化不兼容错误(含双方四数)。

**固定日志行**(CI 可 grep · AC-4/交付预期):
- standalone 就绪:`[host] listening ws://127.0.0.1:<port> protocol=v1`
- 自动生成 token:`[host] token=<token>`(单行)
- 嵌入式就绪(现有,保留):`[host] ready, pid=%d, protocol=v%d`

### 数据结构

> 🔴 **不涉及任何数据库 / 持久化 schema 变更**(PRD 明确)。以下仅为协议 DTO(内存内 JSON 消息),无 DB Schema、无迁移。

#### HostInfo（用途:RPC `host.info` Response DTO · 现有结构追加字段）

| 字段 | 类型 | 必填 | 校验规则 | 默认值 | 备注 |
|------|------|------|----------|--------|------|
| hostId | string | 是 | - | `'local'` | 本 Feature 沿用 `'local'`(机器身份归 BL-003 产 / BL-004 消费) |
| protocolVersion | number | 是 | 整数 ≥1 | `PROTOCOL_VERSION`(=1) | 现有字段 |
| **minCompatible** | number | 否 | 整数 ≥1 且 ≤ protocolVersion | 缺省视同 = `protocolVersion` | **新增**;`PROTOCOL_MIN_COMPATIBLE`(=1);向后兼容不 bump 版本 |
| platform | string | 是 | - | - | 现有 |
| homedir | string | 是 | - | - | 现有 |
| shell | string | 是 | - | - | 现有 |

新增 shared 常量:`export const PROTOCOL_MIN_COMPATIBLE = 1;`(protocol.ts,紧邻 `PROTOCOL_VERSION`)。

#### 版本兼容判定（客户端单方 · 闭区间重叠 · ③ QA-R3-2）

四数:客户端 `Vc=PROTOCOL_VERSION`、`Mc=PROTOCOL_MIN_COMPATIBLE`;host `Vh=info.protocolVersion`、`Mh=info.minCompatible ?? info.protocolVersion`(缺省回落)。

每个端点声明自己能讲的**闭区间** `[minCompatible, protocolVersion]`。协商版本 = `min(Vc, Vh)`(新端向旧端降级)。兼容 ⇔ 该协商版本同时落在**双方**闭区间内:

```
compatible(Vc, Mc, Vh, Mh):
  negotiated = min(Vc, Vh)
  # negotiated ≤ Vc 且 ≤ Vh 恒成立,故成员判定只剩下界:
  return (Mc <= negotiated <= Vc) and (Mh <= negotiated <= Vh)
       # 等价于 max(Mc, Mh) <= min(Vc, Vh)
# 任一方向落在对方区间之外(negotiated < Mc 或 < Mh)→ 不兼容
```

用例自检:① v1 双端(1,1,1,1)→ negotiated=1,兼容 ✅;② 客户端升级 Vc=2 Mc=1(仍支持 v1),host Vh=1 Mh=1 → negotiated=1 ∈[1,2]∩[1,1],兼容 ✅(正是 ARCH-1 要保住的漂移正例);③ 客户端 Vc=2 Mc=2(弃 v1),host Vh=1 → negotiated=1 < Mc=2,不兼容 ✅。

不兼容时客户端构造结构化错误:`{ code: 'PROTOCOL_INCOMPATIBLE', client: {v:Vc, min:Mc}, host: {v:Vh, min:Mh} }`,主动断开;呈现复用既有错误提示机制(App.tsx `setError`),无新 UI。

#### 跨层映射
不涉及(协议两端同一 TS 类型 `HostInfo`,无 snake/camel 转换)。

### 接口

> 本 Feature **不新增 RPC 方法、不新增消息类型**。改动集中在:host.info 结果加字段、两条既有 RPC 补归属校验、WS 传输层为既有消息换壳。

| 接口 | 类型 | 改动 | 说明 |
|------|------|------|------|
| `host.info` | RPC result | 追加 `minCompatible` | host.ts handler 加一字段;客户端校验后消费 |
| `pty.kill` | RPC handler | **加归属校验** | `if (!client.sessions.has(sid)) return;`(非归属静默忽略,零信息)—— ① QA-R3-1 |
| `pty.cwd` | RPC handler | **加归属校验** | 同上,防跨客户端 cwd 泄露(本 RD 追加) |
| WS 连接 | 传输 | 新增 | token 闸 / host.info-first 门控 / 心跳 / 畸形防护 / maxPayload |
| `Transport`(client) | 内部接口 | 新增 | MessagePort / WebSocket 两实现;`hostClient` 公共 API 不变 |

#### 常量表（④ 量级阈值精确落定）

| 常量 | 值 | 位置 | 依据 |
|------|-----|------|------|
| `HANDSHAKE_TIMEOUT_MS` | `10_000` | wsServer | PRD ~10s;超时未发 host.info → 断开回收 |
| `PING_INTERVAL_MS` | `30_000` | wsServer | 心跳周期;isAlive 法 → 静默断连检测窗 ~30–60s |
| `AUTH_FAIL_WINDOW_MS` | `60_000` | wsServer | 失败认证监测滑窗(告警 only) |
| `AUTH_FAIL_ALERT` | `10` | wsServer | 窗内失败 ≥ 此值 emit WARN 供观测;**不阻断后续连接**(external CR-3:阻断会给同机攻击者 DoS 杠杆) |
| `WS_MAX_PAYLOAD` | `32 * 1024 * 1024`(32 MiB) | wsServer | 🔴 **上修**:PRD 量级 ~10MB,但须容纳 `fs.readFileBinary` 20MB 二进制 → base64 ≈ 27MB + JSON 封套,故取 32 MiB。此为精确落定值,取代 PRD 的 ~10MB 量级锚点 |
| `TOKEN_BYTES` | `16`(128-bit) | wsServer | `crypto.randomBytes(16)` → base64url |
| env 变量名 | `TERMPRO_HOST_TOKEN` | wsServer | 读后立即 `delete` |
| dev 开关 | `VITE_TERMPRO_REMOTE_WS` | hostClient | 值=完整 ws URL(含 token);仅 dev |

### 错误处理 / 异常路径

> 项目级风格(结构化返回、不静默吞)见 DEV-RULES §错误处理;下表为本 Feature 传输面特异失败路径。措辞统一「客户端主动断开」(⑥)。

| 场景 | 触发条件 | 处理 | 日志级别 | 幂等/重试 |
|------|---------|------|---------|----------|
| token 缺失/错误 | 认证不过 | **立即 destroy 连接,零信息**(无 body/reason) | **WARN**(`[host] ws auth rejected`,不打印 token) | 客户端可重连;host 侧失败计数(仅告警) |
| 失败认证频发 | 窗内失败 ≥10 | emit WARN 供观测,**不阻断后续连接**(external CR-3) | **WARN**(`[host] repeated ws auth failures`) | 合法客户端不受影响 |
| host.info-first 违规 | 首条非 host.info / 握手前收其他消息 | host `ws.close()` + 回收会话/watcher | **WARN**(`[host] ws gate: unexpected first msg`) | 客户端重连重来 |
| 握手超时 | 10s 未发 host.info | host close + 回收 | **WARN** | - |
| 版本不兼容 | 区间不重叠 | **客户端主动断开** + 结构化错误(含四数);呈现复用既有机制 | **WARN**(客户端 console) | 不重试(需升级) |
| 畸形帧 | 非 JSON / 未知 t / 超 maxPayload | 仅断开/忽略发送方,**host 进程不崩、他客户端无感**(AC-7) | **WARN**(`[host] ws malformed frame from client %d`) | 发送方自负 |
| 静默断连 | 心跳 pong 超时 | `ws.terminate()` → 触发 close → 回收自己的会话+watcher | **INFO/WARN** | 归 BL-005 重连 |
| 跨客户端越权 | 操作非归属 sessionId/watchId | 静默忽略(pty.kill/cwd 归属校验;watchId 天然隔离) | **WARN**(可选,含 client id) | - |
| RPC handler 抛错 | 现有路径 | 现有:`rpc:res ok:false` + `console.error`(host.ts L246-255,不改) | **ERROR** | - |

> 🔴 不静默吞:每条 catch 均带 WARN/ERROR + 上下文(client id / 原因);**token 明文绝不入任何日志**。

### 依赖与影响面

- **改的对外契约**:`protocol.ts` 的 `HostInfo` 追加 `minCompatible`(可选,**向后兼容**)+ 新增 `PROTOCOL_MIN_COMPATIBLE` 常量。无破坏性契约变更。
- **消费方清单**(grep 已核,口径 = `tsc --noEmit` 零报错):

| 被改契约 | 消费方(文件) | 需要的同步改动 | 向后兼容? |
|---------|------------|--------------|----------|
| `HostInfo` 加 `minCompatible` | host.ts(host.info handler) | 返回值加字段 | 兼容 |
| `HostInfo` 加 `minCompatible` | hostClient.ts(版本校验) | 读取并比对 | 兼容 |
| `HostInfo` 加 `minCompatible` | renderer 18 处 `info?.xxx` 只读(App/Sidebar/TabBar/FilePanel/viewer 等) | **无需改**(仅读已有字段) | 兼容 |
| `pty.kill`/`pty.cwd` handler | 仅 host.ts 内部 | 加归属守卫;renderer 调用不变 | 兼容 |
| `hostClient` 公共 API | renderer 全部调用方 | **无需改**(签名不变,内部换 transport) | 兼容 |

- **跨子项目方向 / 并行 worktree 风险**:与 **BL-001 同改 `protocol.ts`**。`HostMessage` union 是共享行,**本 Feature 不碰它**(仅 BL-001 加 `workspace:changed`);本 Feature 只动 `HostInfo` + 新常量(不同区域)。约定:**后合者 rebase**;版本策略「向后兼容追加不 bump,仅破坏性变更 bump」由本 Feature 作规则 owner,两 Feature 均不 bump 到 2。
- **新增运行时依赖**:`ws`(纯 JS)。登记入 `package.json` dependencies;host bundle 由 esbuild/vite 打入(不新增 native)。
- **`package.json` engines**:补 `"engines": { "node": ">=20" }`(fs.watch 递归监听在 linux 依赖 node≥20,与 D-1 兜底基线一致)。
- **`project-specs/ARCHITECTURE.md` 措辞校正**(ARCH-R2-5 涟漪):L37/L49「PTY 二进制流」→「PTY 输出流」;note1 补「WS = JSON 文本帧」。dev 阶段顺带改(PRD 外产物,记入本 Feature 改动清单)。

## 实现思路

### 改动文件清单

```
src/
├── shared/
│   └── protocol.ts               # 加 PROTOCOL_MIN_COMPATIBLE 常量 + HostInfo.minCompatible 字段
├── host/
│   ├── host.ts                   # 入口分流(--listen→WS);host.info 返 minCompatible;pty.kill/pty.cwd 补归属校验
│   ├── wsServer.ts               # 【新增】WS 监听/loopback 强制/token 闸/限速/host.info-first 门控/心跳/畸形防护/wsPortAdapter
│   ├── token.ts                  # 【新增】token 来源解析(env 读后即抹/file 0600/fd/stdin)+ 生成 + 常量时间校验
│   └── __tests__/
│       ├── versionCompat.test.ts # 【新增】区间校验纯逻辑(可两端复用)
│       ├── wsGate.test.ts        # 【新增】门控/超时/畸形/token/归属
│       └── ...
├── renderer/
│   └── services/
│       └── hostClient.ts         # 抽 Transport 接口 + MessagePort/WebSocket 两实现;connect 分流;版本校验
├── (可选)shared/versionCompat.ts # 【新增】区间判定纯函数(host 门控无关,仅 client 用;放 shared 便于两端/测试复用)
package.json                      # 加 ws 依赖 + engines.node>=20
forge.config.ts                   # (spike 阶段)扩 prebuilds 到 linux 矩阵 / host 独立打包产物
vite.host.config.ts               # (spike 阶段)host bundle 策略(ws 打入 / node-pty external 解包)
.github/workflows/host-package.yml# 【新增】host 打包独立 job(ubuntu+macos 矩阵),不阻塞 release.yml
project-specs/ARCHITECTURE.md      # 「二进制流」措辞校正
```

### 数据库变更
无(本 Feature 不涉及任何 schema / 持久化数据结构变更)。

### 前端技术方案（renderer · 仅传输抽象,无新 UI)

- **组件结构**:无新组件。不兼容错误复用 App.tsx 现有 `error` 态展示。
- **状态管理**:`hostClient` 单例内部 `port` → `transport`;`Transport` 接口两实现。无 store 变更。
- **路由**:无。
- **dev 开关**:`import.meta.env.VITE_TERMPRO_REMOTE_WS`(Vite build-time env),仅本机 loopback 验收用;正式包不设该 env → 恒走 MessagePort。

### 时序图（standalone WS 连接建立 · 含门控/token/版本/env 抹除）

```mermaid
sequenceDiagram
  participant Caller as 调用方(dev/ssh exec)
  participant H as Standalone Host(WS)
  participant PTY as PtyPool
  participant C as 客户端(hostClient WebSocketTransport)
  Caller->>H: --listen 127.0.0.1:port (+token via env/file/fd/stdin)
  H->>H: 读 env token → delete process.env.TERMPRO_HOST_TOKEN
  H->>H: 未显式传入则生成 128-bit token
  H-->>Caller: stdout「[host] token=<token>」「[host] listening ws://127.0.0.1:port protocol=v1」
  C->>H: WS upgrade ?token=…
  H->>H: sha256+timingSafeEqual;失败→destroy(零信息)+失败计数(仅告警)
  H->>H: 开 HANDSHAKE_TIMEOUT(10s) + PING(30s)
  C->>H: rpc host.info(必须是首条)
  Note over H: 非 host.info / 超时 → close + 回收(仅 WS 门控,非版本 enforcement)
  H->>C: {protocolVersion, minCompatible, hostId:'local', ...}
  C->>C: 闭区间重叠校验;不兼容→客户端主动断开+结构化错误
  C->>H: 此后与 MessagePort 完全同构(rpc/pty/fs);token 已从 env 抹除,PTY 不继承
  C->>H: pty.spawn → H 校验归属后 PTY.spawn
  Note over H: pty.kill/pty.cwd 均校验 client.sessions.has;心跳 pong 超时→terminate→回收
```

## TDD 开发计划

### 测试策略

- **单元测**(vitest,可 mock):版本区间判定(纯函数,四数矩阵含边界/缺省);token 常量时间校验 + env 抹除断言;门控状态机(首条非 host.info / 超时);畸形帧不抛;失败告警计数(不阻断)。
- **集成测(真实 host 进程 · 不能 mock)**:起真实 standalone host(`--listen 127.0.0.1:0` 取随机端口)+ 真实浏览器/`ws` 客户端,跑 AC-1 全方法冒烟(pty.spawn/io/resize/kill、fs.readdir/readFile/writeFile、**fs.watch 的 fs:changed 经 WS 推送**、git.info/status);两客户端并发验 AC-6(sessionId + watchId 归属、pty.kill 跨客户端被拒);畸形/超限验 AC-7 不崩他客户端。—— 传输面契约必须真跑,不靠两端 mock。
- **契约/端到端**:嵌入式 SMOKE(`TERMPRO_SMOKE=1 npx electron-forge start` → SMOKE_OK)证 AC-5 零回归;standalone 就绪日志行 grep 证 AC-4。
- **基线失败集**:brownfield,base 无预存失败(如有,登记 `project-specs/test-baseline.md` 走「0 新增」差分)。

### 测试清单（对应 TC 用例）

| TC 用例 | 测试方法名 | 状态 |
|---------|-----------|------|
| 区间兼容:v1 双端 / 客户端超前(2,1)vs(1,1)兼容 / 弃旧(2,2)vs(1,1)不兼容 / minCompatible 缺省 | versionCompat.* | ☑ |
| 不兼容错误含双方四数 | versionCompat.incompatibleError | ☑ |
| TC-T4 env token 读后 process.env 被 delete(spawn 前) | token.envErasedBeforeSpawn | ☑ |
| token 常量时间校验(sha256+timingSafeEqual);禁 argv 明文 | token.constantTime / token.rejectArgv | ☑ |
| host.info-first:首条非 host.info → 断开 | wsGate.firstMustBeHostInfo | ☑ |
| 握手 10s 超时 → 断开回收 | wsGate.handshakeTimeout | ☑ |
| 畸形帧(非 JSON/未知 t/超 maxPayload)host 不崩、他客户端无感 | wsGate.malformedIsolated | ☑ |
| 失败告警:窗内 10 次失败 emit WARN 不阻断 | wsGate.authFailAlert | ☑ |
| TC-K1/K2 pty.kill 跨客户端被拒(归属校验) | wsOwnership.killNotOwner | ☑ |
| TC-K3 pty.cwd 跨客户端被拒 | wsOwnership.cwdNotOwner | ☑ |
| AC-6 两客户端 sessionId + watchId 归属隔离 | wsMultiClient.isolation | ☑ |
| AC-1 全方法 WS 冒烟含 fs.watch 推送 | wsSmoke.allMethods | ☑ |
| 心跳 pong 超时 → terminate → 回收 | wsHeartbeat.reclaim | ☑ |
| AC-5 嵌入式 SMOKE_OK 零回归 | (CI 冒烟) | ☑ |

### 实现步骤（分阶段 · 每阶段一 commit · 三绿才进)

**阶段 A — 协议 + 版本校验(纯逻辑,先落地不依赖 WS)**

| # | 步骤 | 类型 | 验证 | 状态 |
|---|------|------|------|------|
| 1 | 写区间兼容失败测试(四数矩阵) | 🔴 Red | 测试失败 | ☑ |
| 2 | protocol.ts 加 `PROTOCOL_MIN_COMPATIBLE` + `HostInfo.minCompatible` + 区间纯函数 | 🟢 Green | 测试通过 + tsc | ☑ |
| 3 | host.ts host.info 返回 minCompatible;hostClient 校验并主动断开 | 🟢 Green | 单测 + tsc | ☑ |

**阶段 B — 归属校验补齐(小而独立,先修再上 WS)**

| 4 | 写 pty.kill/pty.cwd 跨客户端被拒测试 | 🔴 Red | 失败 | ☑ |
| 5 | host.ts 两 handler 加 `client.sessions.has` 守卫 | 🟢 Green | 通过 | ☑ |

**阶段 C — token 模块**

| 6 | 写 token 生成/常量时间校验/env 读后即抹测试 | 🔴 Red | 失败 | ☑ |
| 7 | 实现 token.ts(来源解析 + 生成 + `delete process.env` + sha256 timingSafeEqual) | 🟢 Green | 通过 | ☑ |

**阶段 D — WS 传输 host 侧**

| 8 | 写门控/超时/畸形/失败告警测试 | 🔴 Red | 失败 | ☑ |
| 9 | 实现 wsServer.ts(loopback 强制 / token 闸 / 门控 / 心跳 / maxPayload / wsPortAdapter) | 🟢 Green | 通过 | ☑ |
| 10 | host.ts 入口 `--listen` 分流接 wsServer;打印固定日志行 | 🟢 Green | 起真实 host grep listening 行 | ☑ |

**阶段 E — client 传输抽象 + WS 实现 + 集成冒烟**

| 11 | 抽 Transport 接口 + MessagePortTransport(等价重构) | 🔵 Refactor | 嵌入式 SMOKE_OK 不变 | ☑ |
| 12 | WebSocketTransport + connect 分流(VITE_TERMPRO_REMOTE_WS) | 🟢 Green | tsc | ☑ |
| 13 | 集成测:起真实 standalone host,AC-1 全方法 + AC-6 双客户端 + AC-7 畸形 | 🟢 Green | 集成全绿 | ☑ |

**阶段 F — 打包 spike(门控 · 独立分阶段 · 见 D-1)+ CI + 文档**

| 14 | 打包 spike(时间盒 ≤2 工作日,枚举方案) | spike | darwin-arm64 + linux-x64 实机 node-pty spawn | ☑ |
| 15 | host-package.yml 独立 job(不阻塞 release.yml);ARCHITECTURE 措辞校正;engines>=20 | 🟢 Green | CI 绿且 macOS 发版 gate 不受影响 | ☑ |

> 阶段 A–E 交付 AC-1/2/3/5/6/7,**不依赖** F;阶段 F(AC-4)独立验收,spike 结论回写本 TECH 并通知 BL-003。

## 风险与缓解

| 风险 | 严重度 | 缓解 / 兜底 |
|------|--------|-----------|
| node-pty native 打包(.node/spawn-helper 加载路径、RPATH)在单文件产物内失败(WS-01 R1 最高风险) | **high** | 门控 spike 先行(时间盒 ≤2 工作日,耗尽即判失败);D-1 兜底 = node≥20 + tar 包;不阻塞 AC-1/2/3/5/6/7 合并 |
| token 经 env 被 PTY 继承泄露给子 shell | **high** | 读后立即 `delete process.env.TERMPRO_HOST_TOKEN`,置于任何 spawn 之前;TC-T4 断言顺序 |
| 门控/心跳/畸形逻辑下沉进 attachClient 侵入嵌入式路径,AC-5 回归 | **high** | 新逻辑全部夹在 wsServer/wsPortAdapter 层;attachClient 一字不改;阶段 E 步骤 11 以 SMOKE_OK 守回归 |
| 与 BL-001 同改 protocol.ts 合并冲突 | med | 本 Feature 不碰 HostMessage union;只动 HostInfo + 新常量(不同区域);后合者 rebase;版本不 bump |
| WS maxPayload 卡死 readFileBinary 大图 | med | maxPayload=32MiB 覆盖 20MB 二进制 base64;超限明确断连不静默截断 |
| 阻断式限速在 loopback 单源下给同机攻击者 DoS 杠杆 | med | external CR-3 裁决:降级为告警 only 不阻断;真屏障是 128-bit token 熵 |
| host.info-first 门控误伤嵌入式 | low | 门控仅 WS 层生效;MessagePort 路径不引入 |
| linux fs.watch 递归依赖 node≥20 | low | engines>=20 声明 + D-1 兜底基线绑定 |

## 待决策

| 问题 | 建议 |
|------|------|
| **D-1**(条件项 · spike 触发):单文件打包被证明不可行 | 兜底 A) 远程机要求 **node≥20 + tar 包部署**(node≥20 亦是 linux fs.watch 递归下限)。**失败判据(可枚举不可主观)**:① 时间盒 **≤2 个工作日**;② 穷举方案集 **{Node SEA · esbuild/vite bundle + node-pty prebuilds 显式解包 · pkg 类工具}**;③ 任一目标平台(darwin-arm64 / linux-x64)仍无法从产物加载 node-pty `.node` / exec `spawn-helper` 即判失败。🔴 **时间盒耗尽即判失败,不因方案未试完而顺延**(PL-R3-1)。判失败 → D-1 升级为用户裁决(A 兜底 / B 继续攻延期)。在此之前 AC-4 按「spike 结论产物」验收,不阻塞其余 AC 合并 |

**D-1 spike 结论(2026-07-10 · 未耗尽时间盒即出结果 · D-1 未触发,不需用户裁决)**:

采用穷举集第二项方案 —— **vite bundle(`scripts/package-host.mjs`)+ node-pty 原生二进制显式解包 + tar 包**,判据①②③全部满足且两目标平台均**成功**:

- **darwin-arm64(本机实机)**:`node scripts/package-host.mjs --out <dir> --platform darwin-arm64` 打出 428KB 产物(`host.js` + `node_modules/node-pty/{package.json,lib/,build/Release/{pty.node,spawn-helper}}`,native 取自本机 `prebuilds/darwin-arm64`)。`node scripts/verify-host-artifact.mjs --dir <dir>` 实测:握手(token+host.info-first)通过、`pty.spawn` 真实拉起 `/bin/sh`、`echo TERMPRO_SPIKE_OK` 输出经 PTY 真实回传并匹配 —— 终端输出 `VERIFY_OK`。
- **linux-x64(docker `--platform linux/amd64` qemu 仿真,本机 aarch64)**:先在 `node:20-bookworm`(带 build-essential/python3)容器内 `npm install node-pty@1.1.0 --no-save` 走 node-gyp 源码编译(**关键发现**:node-pty 的 `binding.gyp` 里 `spawn-helper` target 门在 `OS=="mac"` 分支,Linux 完全不编译该二进制;C++ 侧 `pty.cc` 对应 `#if defined(__APPLE__)` 才走 `posix_spawn`+helper 路径,非 mac 分支用普通 `fork()`——故 linux-x64 产物**不含** `spawn-helper` 属预期,非缺失),产出 `build/Release/pty.node`(ELF x86-64)。再用 `package-host.mjs --native-dir <该产物>` 在本机(macOS)组装 linux-x64 产物(纯文件操作,无需交叉编译工具链)。最终验证在**干净的** `node:20-bookworm-slim`(容器内确认 `gcc/g++/make/python3/node-gyp` 均不存在,即无编译工具链)里跑 `verify-host-artifact.mjs`:握手 + `pty.spawn` + echo 真实回传全部通过,终端输出 `VERIFY_OK`——证明产物自包含,目标机无需任何编译工具链。
- **结论**:D-1 兜底(node≥20 + tar 包部署)不需要触发用户裁决升级;spike 直接产出可用的两平台打包方案,已固化为 CI(`.github/workflows/host-package.yml`)。单文件可执行(SEA/pkg)未验证(PRD/TECH 已定性为非硬需求,判据只要求「darwin-arm64 + linux-x64 实机 node-pty spawn 成功」,已满足,故未消耗额外时间盒去试 SEA/pkg)。

## 变更记录
| 日期 | 变更 |
|------|------|
| 2026-07-09 | v0.1 首版技术方案:基于 PRD v0.3 + 真实代码基线;落定 R3 全部 7 条 advisory;WS 复用 PortLike/attachClient;client Transport 抽象;闭区间版本校验;token 生命周期;打包 spike 门控 |
| 2026-07-10 | 阶段 F 打包 spike 完成:darwin-arm64 + linux-x64 均实机验证 node-pty 真实 spawn 成功(D-1 未触发);新增 `scripts/package-host.mjs`/`scripts/verify-host-artifact.mjs`/`.github/workflows/host-package.yml`;`package.json` 补 `engines.node>=20`;`project-specs/ARCHITECTURE.md` 措辞校正(「PTY 二进制流」→「PTY 输出流」+ note1 补 WS JSON 文本帧) |

## 完工自查（RD 实现完逐项打钩）

**对照本 TECH 的设计落地:**
- [x] **现状基线**:pty.kill/pty.cwd 缺归属校验、ptyPool env 继承等前提在实现时仍成立(变则回 blueprint)
- [x] **§错误处理**:token 拒绝/门控违规/超时/不兼容/畸形/静默断连每条失败路径都实现(非只跑 happy-path)
- [x] **错误有 WARN/ERROR 日志**:每条 catch 带 WARN/ERROR + 上下文;**token 明文绝不入日志**;不静默吞
- [x] **§依赖与影响**:`tsc --noEmit` 零报错(HostInfo 加字段的 18 处消费方 + hostClient API 不变)
- [x] **§数据结构**:HostInfo.minCompatible 两端一致;无 DB 变更
- [x] **§测试策略**:集成测(真实 standalone host)写了 —— AC-1 全方法 + AC-6 双客户端 + AC-7 畸形,不靠两端 mock
- [x] **安全**:token ≥128-bit / 常量时间比较 / env 读后即抹 / loopback 强制 / 禁 argv 明文
- [x] **AC-5 零回归**:嵌入式 SMOKE_OK;门控/token/版本逻辑未侵入 MessagePort 路径

**通用质量门:**
- [x] 规范符合(DEV-RULES:改契约先改 protocol.ts / host 零 Electron import / UI 不碰 fs/pty/git)
- [x] 已有测试无回归(exit-code=0)
- [x] build 通过 · lint pass · 改共享基建(protocol.ts)则全景编译过
- [x] (无新 UI)
- [x] commit message 含 Feature ID;改动文件全在 changeset 内

## 🧩 补充洞察

- **⑦ client 缓存 token 介质锚点**(PL-R3-2):host 侧不落盘/不轮换的约束**不禁止 client 缓存**已捕获 token 供重连同一存活 host。缓存**持久化介质**本 Feature 不实现(重连本身 Out of Scope,归 BL-005),但**建议锚点**:比照凭据入**系统钥匙串**(macOS Keychain / Electron `safeStorage`),不落明文磁盘。BL-003/BL-005 开工前钉死具体介质。
- **pty.cwd 归属校验是本 RD 追加**:R3 advisory 只实锤了 pty.kill,但 pty.cwd(host.ts L175-178)同属「拿 sessionId 直接操作、无归属校验」一类,WS 多连接下会泄露非归属会话 cwd。已纳入阶段 B 与 TC-K3。建议 review 时确认是否还有同类未覆盖的「以 sessionId/watchId 为参数但不校验归属」的 handler(现存仅此二处 + 已校验的 pty:input/resize/ack)。
- **maxPayload 与 PRD 量级的偏差需 review 确认**:PRD 给「~10MB」量级锚点,但 readFileBinary 上限 20MB → base64 ≈ 27MB,10MB 会卡死大图预览。本 TECH 精确落定 **32 MiB**,属对 PRD 量级的必要上修(PRD 本就授权「上限 TECH 定」),非违背 —— 请 review 知悉此数值决策。
- **Transport 抽象放 shared 与否**:区间判定纯函数建议放 `shared/`(两端 + 测试复用);`Transport` 接口本身是 renderer 内部实现细节,放 hostClient 同文件即可,不必上升到 shared 契约(避免过度抽象)。
