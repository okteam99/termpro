# Architect 冷审 · BL-003 PRD（远程机管理与 SSH 连接编排）

> 隔离冷审 · 评审者未参与起草 · 只看文档 + 真实代码。不鼓掌，找真问题。

## verdict

**NEEDS_REVISION**

范围/职责边界守得住（UI 零 SSH、Host 零 Electron 的表述正确，无 BL-004/005 夹带，无明显过度设计）。但有 **3 处会塌的载重前提/内部矛盾** 必须在 PRD 层修正后再进 blueprint：

- **ARCH-1**（部署产物来源未定）—— AC-4「自动上传 host bundle」在运行时**没有 bundle 可传**：`package-host.mjs` 是 CI/构建脚本，产物没有任何机制随 Electron 应用分发；forge.config.ts 只把 host 当嵌入式 utilityProcess 打，无 `extraResource`。
- **ARCH-2**（驻留 × 随机端口 × token 不落盘 三方张力）—— 时序图画的 happy path（`--listen :0` 随机端口 + 从 stdout 读端口）与 D-5 驻留语义、AC-8「token 不落远端持久日志」互相冲突，PRD 未点破。
- **ARCH-3**（两张图对「ready」定义打架）—— 时序图在握手前就 emit `ready`，状态图却定义 `starting→ready = 握手成功`；且 AC-6「不兼容→断开」在状态机里无落点。

其余为「说清楚/对齐」类，正常 PRD→blueprint 交接可带走。

## files_read

- docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH/PRD.md（评审对象）
- docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH/YOLO-PREFLIGHT.md（意图锚 · 6 决策）
- product-overview/workstream/WS-01-remote-host.md（上游权威 · §S3 + 风险 R1/R2/R3）
- README.md §Architecture（架构红线 · 行 115-143）
- src/host/host.ts（standalone 入口 · parseListen · token/listening 日志）
- src/host/wsServer.ts（loopback 强制 + token 闸 + host.info-first 门控 + 认证告警节流）
- src/host/token.ts（token 信道 · 禁 argv 明文 · 0600 · 常量时间校验）
- src/host/hostCore.ts（attachClient · hostId:'local' · 端口 close 即回收会话）
- src/main/main.ts（现仅本地 utilityProcess · 无 SSH · 无 host bundle 引用）
- src/renderer/services/hostClient.ts（Transport 抽象 · 单例单连接 · WS dev 开关）
- src/shared/protocol.ts（HostInfo/host.info · PROTOCOL_VERSION=1 · min_compatible）
- scripts/package-host.mjs（standalone 产物形态 · engines node>=20 · 单平台/次）
- forge.config.ts（确认无 extraResource 携带 standalone bundle）
- package.json（确认 deps 零 ssh 库）

---

## findings

### ARCH-1 · 部署时的「按架构 host bundle」来源未定，AC-4 无物可传
- **severity**: high
- **category**: technical-consistency
- **description**: AC-4/交付预期要求「首次连接自动上传并拉起远程 host」。但真实代码里，standalone 产物只由 `scripts/package-host.mjs` 这条 **CI/构建旁路** 产出到 `--out`/tar，**没有任何机制把它随 Electron 应用打包分发**——forge.config.ts 只把 `src/host/host.ts` 当嵌入式 utilityProcess 打（`entry: 'src/host/host.ts'`），无 `extraResource`；`main.ts` 全篇只有一处 `serviceName: 'termpro-host'`（本地进程），零 bundle 引用。运行时 main **手里没有可上传的产物**。且产物按平台切分（node-pty native 二进制），main 还必须先探测远端架构（`uname -m`）再选对应 bundle——时序图只画了「检测 node ≥20 / host 产物与版本」，没有架构探测与 bundle 选取。PRD 的「隐藏前提③」提到平台矩阵覆盖，却漏了**更前置的一环：这些按架构的 bundle 在部署时刻从哪来**（随应用 resources 分发全架构？按需从 Release 下载？远端 npm 装？）。这不是 blueprint 细节，是 AC-4 能否成立的地基。
- **code_evidence**:
  - scripts/package-host.mjs:1-18, 169-198（standalone 产物流水线 · 单平台/次 · 产到 --out/tar，与 forge 解耦）
  - forge.config.ts:143-144（host 仅作嵌入式 utilityProcess 打，无 extraResource 携带 standalone 产物）
  - src/main/main.ts:117-137（ensureHost 只 fork 本地 host.js，无任何远程 bundle 上传/选取）
- **suggestion**: PRD 增一条明确前提并落到 AC-4：部署产物的**运行时来源与架构选取**——推荐「应用 resources 内置全支持架构 bundle（darwin-arm64/linux-x64/linux-arm64）+ main 先 `uname -m` 探测远端架构选 bundle」，兜底走 WS-01 R1 的「远端 npm 装 host」。否则 AC-4 在 blueprint 会撞空。

### ARCH-2 · 驻留进程 × 随机端口发现 × token 不落持久日志：三方张力未点破
- **severity**: high
- **category**: technical-consistency
- **description**: 时序图明确「启动 host `--listen 127.0.0.1:0`（驻留）」。`:0` = 随机端口，而 host **唯一暴露实际端口的途径是 stdout 那行 `[host] listening ws://...:<port>`**（host.ts:63-68）；main 必须读 stdout 才知道该连哪个端口。但 D-5 要求进程**驻留**（UI/SSH 断开后存活），驻留必然要脱离 ssh exec 通道（nohup/setsid/disown），stdout 要么重定向到远端文件、要么丢弃：重定向到文件 → `listening`/`token` 行落远端持久日志（撞 AC-8「token 不落远端持久日志」，自动生成 token 时 host.ts:59-61 会打 `[host] token=%s`）；丢弃 → main 读不到随机端口。三者不能同时成立。PRD 把它当干净 happy path 画了，未承认这是需要设计取舍的开放约束（YOLO-PREFLIGHT §1 只笼统提「stdout 落盘风险…在部署编排一并设计」，PRD 正文和图都没体现）。
- **code_evidence**:
  - src/host/host.ts:26-34（parseListen 默认 `:0` 随机端口）
  - src/host/host.ts:59-68（bound port 只在 stdout `listening` 行暴露；`token=` 行仅 source==='generated' 时打）
  - src/host/hostCore.ts:125-136（端口 close 即回收该客户端会话——驻留进程 + WS 断开时会话行为的关联点）
- **suggestion**: PRD 定死解法或显式标为「部署编排待定约束」：推荐 **main 侧生成 token → 经 stdin/fd 注入（host `--token-stdin`/`--token-fd`，token.ts 已支持，天然不落盘、无 TOCTOU）**；端口用「固定端口」或「host 把端口写进约定文件由 main sftp 回读」，避免依赖 stdout；驻留启动的 stdout/stderr 处置（重定向到何处、是否含敏感行）在 PRD 层明确。至少不能画成无损耗 happy path。

### ARCH-3 · 两张图对「ready」语义不一致，AC-6 不兼容断开在状态机里无落点
- **severity**: medium
- **category**: technical-consistency
- **description**: 时序图里 main 在 `建立本地端口转发` 后就 `事件 ready(localPort, token)`——**发生在 renderer 的 host.info 握手之前**（图中 `R->>H host.info` 在 `ready` 之后）。而状态图定义 `starting --> ready: 握手成功`。两处「ready」含义打架：一处 = 隧道通/host 在听，一处 = 协议握手成功。更实的：AC-6 说「不兼容则明确报错并断开」，客户端侧版本校验（hostClient.ts:211-221）发生在拿到 `ready` 之后，但状态图**没有 `ready --> failed` 边**来承接「握手/版本不兼容后的断开」。状态机漏了这条真实存在的失败路径。
- **code_evidence**:
  - src/renderer/services/hostClient.ts:207-224（onopen 后才发 host.info、client 侧 checkHostInfoCompatible 不兼容则 `transport.close()`——即「ready 之后仍可能因不兼容断开」）
  - src/host/wsServer.ts:96-113（host.info-first 门控：握手是连接后独立一步，非「listening 即 ready」）
- **suggestion**: 拆两态（如 `tunnel-ready`→`verified/ready`，握手成功才 verified）或给状态图补 `ready/verifying --> failed(incompatible)` 边；并让时序图的「ready」与状态图对齐（统一为「握手校验通过」才叫 ready）。

### ARCH-4 · AC-8 Origin 白名单必须匹配「合法 renderer 实际呈现的 Origin」，否则误杀自家客户端
- **severity**: medium
- **category**: technical-consistency
- **description**: AC-8 新增「非白名单 Origin 拒绝」（现 wsServer 只验 token、零 Origin 校验）。风险在于：renderer 走浏览器原生 `new WebSocket()`，**Origin 由 UA 自动设置、应用无法自定**。而合法 renderer 的 Origin 随渠道不同而不同——打包版 `loadFile`（file:// → Origin 往往是 `null` 或 `file://`），dev 版 `loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)`（http://localhost:xxxx）。若白名单没枚举对这些真实值，会把自家 renderer 拒之门外。PRD 把它当「纵深加固」正确定位（token 仍是主屏障，与 wsServer 既有哲学一致），但没点明「合法 Origin 到底是什么」这个实现前提。
- **code_evidence**:
  - src/host/wsServer.ts:203-222（upgrade 处理仅验 token，无 Origin 读取/校验——新增点）
  - src/main/main.ts:486-492（打包 `loadFile` vs dev `loadURL` → renderer 两种 origin）
  - src/renderer/services/hostClient.ts:186-224（浏览器 WebSocket，Origin 不可由应用设置）
- **suggestion**: PRD/blueprint 明确白名单允许的**确切 Origin 值集**（dev 的 vite origin + 打包版 file:///null），并保留「Origin 仅纵深、token 为主」的既定表述。

### ARCH-5 · SSH 私钥的存储模型未定，零明文保证不完整
- **severity**: medium
- **category**: completeness
- **description**: AC-3/D-2 只覆盖**密码与 passphrase** 经 safeStorage 加密；交付预期表也只写「密码与 passphrase 加密存储」。但认证方式含「SSH 私钥」，PRD 全篇没说私钥是**按路径引用**（用户 ~/.ssh 下的 key 文件）还是**导入内容存库**。若是后者，私钥内容同样需要 safeStorage + 零明文落盘，否则 AC-3 的「配置文件/日志/仓库零明文」保证有缺口。
- **code_evidence**: 无（PRD 缺项，非代码冲突）
- **suggestion**: PRD 明确私钥处置模型（推荐「按路径引用，不复制私钥内容入库」；若允许粘贴私钥内容则须同 safeStorage 加密），把零明文保证补全到私钥这一支。

### ARCH-6 · 两类密钥需在 PRD 里显式区分，避免误读为 AC-3 违规
- **severity**: low
- **category**: technical-consistency
- **description**: AC-3 说「凭据…不进入渲染进程」，但设计上 **host 端口 capability token 必然进 renderer**——时序图 `M->>R ready(localPort, token)` 且 `R->>H ws://127.0.0.1:localPort?token=…`，与 D-4「renderer 直连本地转发端口」一致。二者其实自洽（SSH 凭据 ≠ host 会话 token；后者是本机 loopback 端口的一次性 capability），但字面极易被后续 verify/审计误判为「凭据进了渲染进程」的违规。
- **code_evidence**:
  - src/renderer/services/hostClient.ts:151-152, 186-190（WS URL 携带 token，renderer 侧持有）
  - src/host/token.ts:1-3（威胁模型：token 是远端本机 loopback 端口的唯一屏障，与 SSH 网络层凭据不同层）
- **suggestion**: PRD 显式分两类：「SSH 登录凭据（密码/passphrase/私钥）— 永不入 renderer、仅 main 瞬时解密」vs「host loopback capability token — 一次性、按设计必入 renderer 的 ws URL」。

### ARCH-7 · 「PTY 流量不过 Electron IPC」措辞准确但易误读为「绕过 main」
- **severity**: low
- **category**: technical-consistency
- **description**: D-4 表述「PTY 流量不过 Electron IPC / renderer 直连本地转发端口」准确，但 renderer 连的是 **main 用 ssh2 建的本地转发端口**——字节流仍在 **main 进程内经 ssh2 forwardOut 中继**（TCP pipe，不走 MessagePort/IPC、不经 renderer↔main 序列化）。即 main 仍在数据路径上（作为流式转发），并非「完全绕过 main」。blueprint 若据此低估 main 侧的中继背压/缓冲会踩坑（与既有 FLOW 水位相关）。
- **code_evidence**:
  - src/shared/protocol.ts:11-14（FLOW 高低水位 · 流控是协议一部分，中继两端都要尊重）
- **suggestion**: PRD/blueprint 措辞收紧为「不经 Electron IPC，但经 main 的 ssh2 转发做流式中继」，提示按 FLOW 水位设计中继背压。

### ARCH-8 · hostId 真实化推迟到 TECH：BL-003 的 per-host 键必须用「TermPro 配置 id」而非 host.info.hostId
- **severity**: low
- **category**: technical-consistency
- **description**: hostCore 对所有 host 恒返回 `hostId:'local'`（hostCore.ts:156）。PRD「跨子系统涟漪」把 hostId 真实化推到 TECH、且承诺 protocol.ts 本 Feature 零改动——对 BL-003 可接受。但要点明：BL-003 的 per-host HostClient 注册表与 AC-5 事件流**必须以 TermPro 侧配置 id（别名/uuid）为键**，绝不能用 host.info.hostId（否则多台远程机全部撞 `'local'`）。这是 BL-004 消费事件流的前提。
- **code_evidence**:
  - src/host/hostCore.ts:155-165（host.info 硬编码 hostId:'local'，所有 host 相同）
- **suggestion**: PRD 明写「BL-003 以配置 id 作 host 键；host.info.hostId 真实化为 BL-004 前置」，避免 BL-004 建在撞键前提上。

### ARCH-9 · token 交接信道现实性：ssh2 exec 的 env 注入通常不可用
- **severity**: low
- **category**: technical-consistency
- **description**: token 若走「SSH exec 注入环境变量」，现实中常失败——远端 sshd `AcceptEnv` 默认限制，`TERMPRO_HOST_TOKEN` 多半不被接受。token.ts 支持 env/file/fd/stdin 四路，其中 **stdin/fd 最稳**（不落盘、无 TOCTOU、不依赖 sshd 配置）；file 路 AC-8 已正确点出 TOCTOU 需 O_CREAT|O_EXCL+0600。PRD 把信道留给 blueprint 可以，但别默认 env 可用。
- **code_evidence**:
  - src/host/token.ts:64-119（四信道优先级 · env 读后即抹 · file 须 0600 · fd/stdin）
- **suggestion**: PRD 备注「env 注入受远端 sshd AcceptEnv 限制多不可靠，token 交接优先 stdin/fd」，与 ARCH-2 的解法呼应。

### ARCH-10 · 上游 WS-01-S3 的 AC#3 文案与 PRD AC-3 已字面背离，建议同步上游
- **severity**: low
- **category**: consistency
- **description**: 上游 WS-01-S3 核心 AC③原文「凭据仅存**系统钥匙串**，仓库/日志/配置文件零明文」；PRD AC-3 改为 safeStorage（**密文落 userData**、加密密钥在钥匙串）。用户已在 D-2 明确接受此「字面差异」，PRD 侧无问题。但上游文档仍是旧措辞，未来 verify-ac/审计对读会困惑。
- **code_evidence**:
  - product-overview/workstream/WS-01-remote-host.md:184（上游 AC③「仅存系统钥匙串」）vs PRD:103（AC-3 safeStorage）
- **suggestion**: 回写上游 WS-01 文档 AC③措辞为 safeStorage 语义（或注一句「实现落 safeStorage，见 BL-003 D-2」），保持单源一致。

---

## 附：守住了的点（给正反馈也要有依据）

- **边界干净**：Out of Scope 正确排除 Sidebar（BL-004）、会话存活/回放/自动重连（BL-005）、~/.ssh/config 导入、node 自动安装；AC-5 只「产出可订阅事件流」供 BL-004 消费，不建 Sidebar——无范围夹带。
- **架构红线表述正确**：连接编排驻 main、UI 永不碰 SSH、host 零 Electron——与 README §Architecture 红线一致；per-host 注册表承诺「本机 host 路径行为零变化」方向对（hostClient 单例被 store/terminal/filepanel 广泛引用，hostClient.ts:344）。
- **安全约束与 BL-002 自洽**：loopback 强制（wsServer.ts:170-176）、token 常量时间校验（token.ts:125-131）、禁 argv 明文（token.ts:77-82）、认证失败节流告警（wsServer.ts:191-201）、host.info-first 门控（wsServer.ts:96-113）——PRD 的 AC-8 是在这套既有约束上做纵深叠加，未与之矛盾。
- **无过度设计**：AC-7 最近使用、AC-10 删除即清凭据+先断连，均属合理最小面，未见镀金。

---

# Round 2 验证（PRD v0.2 · 只验 findings 消解 + 是否引入新矛盾）

## verdict

**APPROVE**（附 1 条 must-resolve-at-blueprint 残留 + 2 条非阻断文档尾巴）

Round 1 的 10 条 ARCH findings **逐条有效消解**（下表复核）。修订未引入硬性文本矛盾，AC 机读块与正文优先级/类目一致（AC-1..14 交叉核对通过）。唯一需要点名的是：v0.2 为回应 PL-CHALLENGE-5 **新增**了 D-5 的绝对保证「无孤儿进程堆叠 · 再连接必认领」，其可实现性依赖一个 PRD 未点明的 host-token 生命周期/进程身份机制——这是 **TECH 层可解、不改产品意图** 的欠定，按「实现细节归 blueprint」不阻断 PRD，但必须在 blueprint 明确落地，故记为 must-resolve 残留（ARCH-11），不放它消失。

## 复核：Round 1 findings 逐条

| id | 处置 | 复核结论 | 证据 |
|----|------|----------|------|
| ARCH-1 | D-6 内置全架构 bundle + 隐藏前提③(CI 接 forge extraResource) + AC-4 加 uname 探测/选取/幂等覆盖 | **消解** | PRD:116(D-6)、126(AC-4)、218(前提③) |
| ARCH-2 | D-7 token main 生成经 --token-stdin + 端口写端口文件(O_EXCL 0600)sftp 回读 + 驻留 stdout 重定向到不含 token 的日志；时序图/AC-8 重画 | **消解**（且与代码一致：host.ts:59 `source==='generated'` 才回显 token，stdin 路不触发） | PRD:117(D-7)、130(AC-8)、159-162(图) |
| ARCH-3 | 状态图加 verifying 态 + verifying→failed(incompatible)；时序图事件改名 tunnel-ready，ready=握手校验通过；AC-5/AC-6 同步 | **消解**（两图语义已统一，不兼容断开有落点） | PRD:127-128、164-171、183-193 |
| ARCH-4 | AC-10 白名单=合法 renderer 实际 Origin 值集(file://\|null · dev vite)，无 Origin/白名单内不误杀 | **消解** | PRD:132(AC-10) |
| ARCH-5 | 私钥按路径引用不入库(AC-2/AC-3)+Out of Scope 排除私钥内容导入 | **消解** | PRD:124、125、204 |
| ARCH-6 | AC-3 显式区分 SSH 登录凭据(永不入 renderer) vs host capability token(按设计入 renderer ws URL)+ADR-001 | **消解** | PRD:125、ADR-001 文件存在 |
| ARCH-7 | D-4 措辞收紧「经 main ssh2 流式中继」+涟漪段提示 FLOW 水位背压 | **消解** | PRD:114(D-4)、219 |
| ARCH-8 | D-4/Out of Scope 明写 per-host 键=配置 id，hostId 真实化=BL-004 前置 | **消解** | PRD:114、208 |
| ARCH-9 | 并入 D-7(stdin 优先，env 因 AcceptEnv 不可靠不采用) | **消解** | PRD:117(D-7) |
| ARCH-10 | 上游 WS-01 核心 AC③已改「实现语义=safeStorage…D-2/ADR-001」；ADR-001 落地 | **基本消解**（规范 AC 已改；见下非阻断尾巴） | WS-01:184 已同步 |

## 新残留 findings

### ARCH-11 · D-5「无孤儿 · 必认领」保证缺 token 生命周期/进程身份机制（新增内容暴露）
- **severity**: medium
- **category**: technical-consistency
- **status**: must-resolve-at-blueprint（不阻断 PRD · 阻断进入实现）
- **description**: v0.2 新增 D-5 绝对保证「无孤儿进程堆叠——再连接**必**认领既有驻留进程（经端口文件发现 + **握手验证**）」。但「握手验证以认领」必须先过 WS token 闸（wsServer 只认 token），即 main 必须持有该驻留进程的 token。而：(1) AC-8 只规定 token「不落**远端**持久文件/日志」，对 **main 侧本地是否留存 token 跨应用重启** 只字未提；(2) D-7 只说「token 由 main 生成」，未定 token 是**绑定驻留进程生命周期的稳定值**还是**每次连接重新生成**。若按后一种读法(每连接新 token)，旧驻留进程持旧 token → **认领必然失败**，与「必认领」直接冲突；(3) 「无孤儿」的**兜底 kill** 需要进程身份（PID），但 standalone host 现今**既不写端口文件也不暴露 PID**（host.ts 仅嵌入式模式日志打 pid，standalone 分支无），端口文件只有端口无 PID——跨重启要 kill 一个孤儿进程缺可靠身份；(4) 端口文件用 O_CREAT\|O_EXCL：崩溃残留的陈旧端口文件会让新启动的 O_EXCL create 失败，fresh-start 前需先清理陈旧端口文件（D-5 只覆盖「版本更替时确定性退出」，未覆盖崩溃残留）。
- **code_evidence**:
  - src/host/host.ts:36-78（standalone 分支：无 portFile/PID 写出；端口仅经 stdout listening 行——D-7 改为端口文件后，PID 身份仍缺）
  - src/host/wsServer.ts:203-222（认领必过 token 闸 → 认领需 main 持 token）
  - src/host/token.ts:64-118（token 生成/来源，无「跨连接/跨重启稳定留存」语义）
- **suggestion**: PRD 只需一句 PRD 高度的澄清（机制细节留 TECH）：明确 **host token 绑定驻留进程生命周期（进程存活期内稳定），main 侧本地留存（userData/safeStorage · 按配置 id 键 · AC-8 仅禁远端持久化，本地留存合规且与 ADR-001 的「capability token ≠ SSH 凭据」自洽）**；并把 D-5 的「必认领」精化为 **认领-或-确定性回收**：token 已知 → 认领；token 不可用/陈旧 → 经进程身份（新增 PID 文件或按 cmdline 定位）确定性 kill 孤儿 + 清陈旧端口文件后 fresh-start。这样「无孤儿」保证才有可交付机制，且不与 AC-8 冲突。

## 非阻断文档尾巴（可顺手清，不影响 verdict）

- **T-1（低）**：ARCH-10 规范 AC③已同步，但 WS-01-remote-host.md 内仍有**两处旧措辞**未随手更新——line 85 风险 R2 缓解「凭据仅建连瞬时从**钥匙串**取用」、line 110 背景 Q-003「密码凭据存**系统钥匙串**」。规范 AC 已正确，这两处是背景/缓解复述，建议一并注记「实现=safeStorage，见 D-2/ADR-001」以彻底消歧。证据：WS-01-remote-host.md:85,110。
- **T-2（提示）**：AC-13「跳过上传/认领驻留进程」与 D-5 的成功前提都落在 ARCH-11 的 token/身份机制上——ARCH-11 一旦在 blueprint 落定，AC-13 的「认领既有进程不重复启动」即自动可测；blueprint 请把三者(D-5/AC-13/ARCH-11)绑在同一 TECH 小节设计，避免割裂。

## 小结

修订质量高：10 条 findings 无一敷衍，图/AC/决策/上游台账/ADR 联动一致，且 D-6/D-7 的取舍与 BL-002 既有安全约束（token 闸、loopback、常量时间校验、host.info-first）自洽。放行进入 blueprint；blueprint 开工第一件事 = 落定 ARCH-11 的 token 生命周期 + 孤儿回收机制（连带 AC-13/D-5 可测性）。
