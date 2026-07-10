<!-- TEAMWORK-MACHINE · 机读契约 · 勿删外层注释包裹 · 2 空格缩进
feature_id: "TERMPRO-F260709180208-Remote-Hosts-SSH"
doc: review-arch
stage: review
reviewer: architect
model: opus
verdict: REQUEST_CHANGES
open_blockers: 1
open_majors: 3
verify_commit: "36cdb0a"
verify_verdict: APPROVE
verify_open_blockers: 0
verify_open_majors: 0
verify_residuals: ["R1 MINOR meta-less 锁永久 wedge", "R2 观察 disconnect 强制超时窄竞态", "R3 观察 打包 Origin 实证"]
-->

# BL-003 远程机管理与 SSH 连接编排 · Architect 代码评审

评审基准：`git diff origin/yolo/m5-remote-host...HEAD -- src/`（38 文件 · 6135 insertions）逐文件回读真实代码，
对照 TECH.md v0.3（SSH-4 residency / SSH-5 部署锁 / ARCH-B1/B2 / R2-*）+ 架构红线。
默认姿态=质疑：每条先假定 false positive → 回读代码 → 才 confirmed。

## Overall Verdict：**REQUEST_CHANGES（NEEDS_REVISION）**

存在 **1 个 open BLOCKER（A1 · 全新远程机首次部署必失败，核心 AC 走不通）** + **3 个 open MAJOR**。
不满足 APPROVE 门槛（无 open BLOCKER/MAJOR）。residency 纯决策与 reap 双验的安全性质（ARCH-B1/B2）
落地忠实、扎实，无误杀漏洞；主要问题集中在 **部署路径的远端目录前置条件、SSH 断链检测、
main/renderer 状态机竞态、in-flight guard 语义**。

---

## Findings

### A1 · BLOCKER · 全新远程机首次部署必失败（无人创建 `${dataDir}/bundle` 父目录）
- **status**: open
- **证据**：
  - 部署锁：`deploy.ts:98` `mkdir "${dir}"`（**非递归**），`dir = ${dataDir}/bundle/.deploying-<v>`（`deploy.ts:44-46`）。
  - 上传：`ssh.ts:206-229` `sftpWriteDir` → `mkdirRemote`（`ssh.ts:290-297` = `sftp.mkdir` **非递归**），tmp 目标 `${dataDir}/bundle/.tmp-<v>-<rand>`。
  - 全仓 remote/ 内**没有**任何 `mkdir -p ${dataDir}/bundle`（或 `${dataDir}`）先于 `deployBundle`。唯一的 `mkdir -p` 是 `orchestrator.ts:524` `mkdir -p ${dataDir}/hosts/<id>`，且在 **deploy 之后**的 starting 阶段，也不含 `bundle/`。
- **描述**：全新远端 `~/.termpro-host/bundle` 不存在。`deployBundle` 第一步 `acquireLock` 的 `mkdir "${dataDir}/bundle/.deploying-<v>"` 因**父目录 `${dataDir}/bundle` 缺失**而失败 → `tryMkdir` 判为 `EXISTS`（`deploy.ts:97-100`）→ 读 meta 得 null → `age=Infinity`（`deploy.ts:79`）→ 判陈旧 → `rm -rf`（空操作）→ 重试 `mkdir` 仍失败 → 返回 `waitForPeer` → `waitForReady` 轮询 `.ready`（无人产出）→ **120s 超时后 `deployFailed`**。首次连接任何新远程机（AC-1/AC-4/AC-6 主路径）都走不通，且用户要等满 120s 才见失败。
- **为何测试没抓到**：`deploy.test.ts:133-174` 把 `ssh.exec` 的 mkdir 桩恒返回 `LOCKED`（`testKit.ts:71-73` 默认亦然），从不触发真实非递归 mkdir 的父缺失失败；`sshLocalhost.integration.test.ts` 只测 `SshConnection` 底层原语，且上传目标 `remoteBase`（`:59` `mkdtempSync`）已存在，从不跑 `deployBundle`，无 sshd 时整段 `it.skipIf` 跳过。
- **建议**：`deployBundle` 起始处（取锁前）显式 `await ssh.exec('mkdir -p "${dataDir}/bundle"')`（幂等）；或 orchestrator 进 deploy 前统一 `mkdir -p ${dataDir}` 与 `${dataDir}/bundle`。同时修 A8（`isEexist` 过宽会掩盖 ENOENT，放大此类静默失败）。补一条不 mock `exec`-mkdir 的部署冒烟（真机或本地 sftp）覆盖「全新目录」路径。

### A2 · MAJOR · SSH 传输层断链不被检测 → ready 后真实掉线不 emit `disconnected`（AC-12 缺口）
- **status**: open
- **证据**：`ssh.ts:77-112` `SshConnection.connect` 只在 ready 前挂 `client.on('ready'/'error')`，settle 后 error 处理器 `if (settled) return` 空转；**无** post-ready 的 `client.on('close'/'end'/'error')` 向 orchestrator 传播。`orchestrator.ts:372-382` `wireDisconnectWatcher` 只监听**本地 `net.Server`** 的 `'close'/'error'`。
- **描述**：本地转发 `net.Server`（`ssh.ts:243-267`）在 SSH 连接死亡时**不会关闭**——它仍在 listen，只是每个入站 socket 的 `client.forwardOut` 回调失败后 `socket.destroy()`。因此 `handleDown` 只在**显式** `server.close()`（用户 disconnect/dispose）时触发，**永不**因网络掉线/远端 sshd 重启触发。结果：真实掉线后 main 侧 session 仍停在 `ready`，UI 一直显示已连接，renderer ws 只会收到连接重置。TECH §错误处理明确要求「ready 后 ssh/forward `error`/`close` → disconnected」，此处 ssh 一侧完全没接。
- **建议**：`SshConnection` 暴露 `onClose(cb)`（内部 `client.on('close', cb)` + `client.on('error', cb)`），orchestrator connect 成功后 wire 到 `closeSessionTransport(session)` + `safeEmit(disconnected)`。同时补一条 SSH 掉线→disconnected 的桩测。

### A3 · MAJOR · main 同步 emit `verifying→ready` 与 renderer「verifying 门控握手」竞态 → renderer 冒烟/连接大概率不执行
- **status**: open
- **证据**：orchestrator 在同一同步栈内背靠背 `emit(verifying)` 紧跟 `emit(ready)`——认领路径 `orchestrator.ts:479-485`、部署路径 `orchestrator.ts:565-570`。renderer 的二次握手 + AC-6 冒烟只在 `runtime?.stage === 'verifying'` 时触发（`RemoteHostsPage.tsx:178-182`），且 `applyEvent` 无条件覆盖最近事件（`remoteHostStore.ts:23-25`）。
- **描述**：两条 IPC 事件（verifying、ready）背靠背抵达 renderer，`applyEvent(ready)` 覆盖掉瞬时的 `verifying`。而 `RemoteHostsPage` 的握手是 React **passive effect**，在两条事件之间通常**来不及**flush，effect 跑时 `runtime.stage` 已是 `ready` → 条件为假 → **renderer 从不调用 `hostClient.connect({wsUrl})`，也从不跑 `fs.readdir` 冒烟（AC-6）**。后果：(1) per-host `HostClient` 实际从未建立 ws 连接（BL-004 复用前提落空，BL-003「让远程连接跑通」仅由 main 探测证明，非 renderer）；(2) 探测后到握手间的罕见竞态若令 renderer 握手 reject（incompatible/internal），会在 main 已 `ready` 之后把 runtime 翻回 `failed`，main/renderer 状态发散且隧道悬留。dev-main「main 自主推进 ready」的澄清本身可辩护（main 探测是权威 · ARCH-B1），但**当前实现把 renderer 的连接/冒烟挂在一个被 main 立刻覆盖的瞬时态上**，等于让 TECH §前端写明的 AC-6 冒烟运行时不可达。
- **建议**：让 renderer 的握手由 **verifying 事件本身**驱动（在 `onEvent` 回调里捕获 `stage==='verifying' && tunnel` 即发起 `connect({wsUrl})`），而非采样当前 stage；main 仍可自主 emit ready（保持无 renderer→main 信道）。这样 renderer 连接 + 冒烟确定执行、且不与 main 的 ready 覆盖竞态。

### A4 · MAJOR · in-flight guard 语义缺陷（ARCH-B3）：connect 被 test 吞掉 + 无条件 delete 误删他人槽位
- **status**: open
- **证据**：
  - `orchestrator.ts:222-224`：`connect()` 命中任意在途（含 `test`）即 `return existing.then(...)`，**不再运行 `runConnect`**。
  - `orchestrator.ts:233-235`：`connect` 的 `.finally(() => this.inflight.delete(configId))` **无条件**删除；而 `test` 的删除有守卫（`orchestrator.ts:260-263` `if (this.inflight.get(configId) === tracked)`）。
- **描述**：
  - (a) 若 `test(id)` 在途时用户点 connect：`connect` 返回 test 的 promise 却**不排队执行连接** → 用户的 connect 意图被静默丢弃（须再点一次）。connect 与 test 语义不同，不应像两个 connect 那样去重。
  - (b) 若 connect 在途时点 test：test 把 `inflight[id]` 覆盖为 `tracked`；待 connect 的 promise settle，其**无条件** `delete` 会把 `tracked`（test 的槽位）一并删掉 → 单飞不变量被打破，随后一个新 connect 可与仍在跑的 `runTest` 重叠。爆炸半径有限（不会两次 `runConnect`：`inflight` 在 connect 内**同步**置位去重；host.port `O_EXCL` 是跨实例最后防线），但确定性违反了文档承诺的互斥语义。
- **建议**：connect 的 finally 改为守卫式删除（`if (this.inflight.get(configId) === promise) this.inflight.delete(...)`，与 test 对齐）；connect 命中在途 test 时应链在其后再决定是否进编排，而非直接复用其 promise。

### A5 · MINOR · 部署锁「mkdir 后另写 meta」的竞态窗口 → 并发首装锁形同虚设（自愈但重复全量上传）
- **status**: open
- **证据**：`deploy.ts:70-74` 先 `tryMkdir`（成功即算持锁）再**单独** `writeLockMeta`；等待方 `deploy.ts:77-83` 读 meta，缺失即 `age=Infinity`（`:79`）判陈旧 → `rm -rf ${dir}` break 锁（`:86-88`）。
- **描述**：winner `mkdir` 成功到 `writeLockMeta` 完成之间有 ~1 个 exec RTT 窗口。此窗口内另一 flow（同 host 同版本的另一 configId/另一 App 实例）`tryMkdir` 失败→读 meta 得 null→判为无限陈旧→`rm -rf` 掉 winner 的锁目录并重取。两 flow 都自认持锁、各自全量上传到不同 tmp。最终由 `sftpRename(tmp→verDir)` 的 ENOTEMPTY 兜底串行化（`deploy.ts:172-179`），**无数据损坏**，但锁在「并发首装」这一它本该防的场景下失效 → 冗余整包上传。（注：`rm -rf .tmp-<v>-*` 的通配删除只会命中窗口期，正常上传时 meta 已在、age 小，不会误删在途上传。）
- **建议**：`mkdir`+`writeLockMeta` 之间「meta 缺失」应按**刚获取/宽限**处理而非无限陈旧（如加短 grace，或把 ts 编码进锁创建本身），避免 winner 未及写 meta 就被 break。

### A6 · MINOR · `TERMPRO_ALLOWED_ORIGINS` 注入（TECH AC-10）未实现；standalone host 恒用 DEFAULT 白名单
- **status**: open
- **证据**：`host.ts:61-66` 调 `startWsServer` **未传** `allowedOrigins`、也不读任何 origin env；`buildStartCommand`（`orchestrator.ts:165-178`）只注入 `TERMPRO_HOST_DATA_DIR`/`TERMPRO_HOST_PORT_FILE`；全仓 grep 无 `TERMPRO_ALLOWED_ORIGINS` 读取方。故远端 host 恒用 `DEFAULT_ALLOWED_ORIGINS = {null, file://}`（`wsServer.ts:216`）。
- **描述**：TECH §AC-10 明确「白名单经 env `TERMPRO_ALLOWED_ORIGINS`（main 注入 · dev 追加 vite origin）传入」，实现里这条注入链**整条缺失**。影响：(1) **打包态→远程机**：仅当打包 renderer 的 Origin ∈ {null, file://} 才放行——而 A0/ARCH-B11「抓打包版真实 Origin」在计划里仍是 `☐` 未勾，**该前提未经实证**，若打包 Origin 是别的值则所有 renderer 直连被拒（届时升级为 BLOCKER）。(2) **dev WS 路径**（`VITE_TERMPRO_REMOTE_WS`，renderer Origin=`http://localhost:<vite>`）会被 DEFAULT 白名单拒绝 → 回归既有开发直连能力。main 侧 probe 无 Origin 头恒放行（`wsServer.ts:260` `checkOrigin(undefined)=true`），故编排/认领不受影响，破的是 renderer 直连。
- **建议**：先落地 A0/ARCH-B11 实证打包 Origin；`buildStartCommand` 注入 `TERMPRO_ALLOWED_ORIGINS`、host.ts 读之传 `startWsServer`；dev 追加 vite origin。

### A7 · MINOR · 远端路径在 shell 命令里未加引号（远端 `$HOME` 含空格/元字符即破）
- **status**: open
- **证据**：`residency.ts:221` `rm -f ${portFilePath(...)}`；`deploy.ts:86-87` `rm -rf ${dir}` / `.tmp-...-*`、`:178` `:193`；`orchestrator.ts:170-176` setsid 命令、`:524` `mkdir -p ${hostDir}` 均把 `${dataDir}`（= `echo $HOME` 结果 + `/.termpro-host`，`orchestrator.ts:432-439`）**未引号**内插。
- **描述**：`configId` 是 base64url（`credentialStore.ts:205-207`），无 shell 元字符，安全；但 `dataDir` 源于**远端** `$HOME`，若含空格会令 `rm -f a b/.../host.port`、`mkdir -p a b/...` 作用到错误路径。远端可控但通常是用户自有机器，属健壮性而非提权。
- **建议**：所有远端路径统一双引号包裹。

### A8 · MINOR · `isEexist(err)` 判定过宽（任意 error code 均当 EEXIST 吞掉）
- **status**: open
- **证据**：`ssh.ts:299-304` `return code !== undefined`——即**任何**带 code 的 sftp 错误（EACCES/ENOENT/…）都被 `mkdirRemote`（`ssh.ts:290-297`）当作「已存在」放行。
- **描述**：注释自认「真实失败由后续 putFile 暴露」，但这会把 A1 的父目录缺失（ENOENT）等错误静默掉，报错点后移、语义模糊。
- **建议**：只对真实 EEXIST（ssh2 SFTP status 4 `FAILURE`/字符串 `EEXIST`）放行，其余上抛。

### A9 · MINOR · safeStorage 不可用时配置落盘却带 `hasPassword/hasPassphrase=true`（旗标与实际不符）
- **status**: open
- **证据**：`remoteHostIpc.ts:38-49`：先 `configStore.save({..., hasPassword: hasPassword||undefined})` 落盘，再 `credentials.setSecret(...)`——而 `setSecret` 在 `isAvailable()===false` 时抛错（`credentialStore.ts:72-75`）。
- **描述**：AC-3 硬约束（不明文落盘）**守住了**（setSecret 抛错前不写密文，也不写明文）；但 config 已带 `hasPassword=true` 持久化，密文却不存在 → 下次 connect `getSecret` 得 null、UI 却显示「已存密码」。
- **建议**：save 前先校验 `credentials.isAvailable()`，或 setSecret 失败时回滚 config 的 has* 旗标。

### A14 · MINOR · 部署路径 probe 失败被误分类为 `incompatible`（QA 标 AC-6 P0 零覆盖的正是此边）
- **status**: open
- **证据**：`orchestrator.ts:555-562`：`if (!probeResult.ok || probeResult.compatible === false) { this.failSession(configId, 'incompatible', ...) }`。
- **描述**：`probeHostInfo`（`probeHostInfo.ts:52-104`）把**一切**失败（连接失败/超时/被关/畸形/rpc error）都归一为 `{ok:false}`，只有真·版本不符才 `compatible===false`。当前把 `!ok` 与 `compatible===false` **合并**判为 `incompatible` → 一个刚部署成功、端口文件已写（`pollPortFile` 已过）的 host，若 main 侧探测因隧道时序/超时短暂 `!ok`，会被报成「版本不兼容 · 已断开」并引导用户「升级 app/host」——误导且重试语义错。且此路径是**部署 happy-path 的唯一 main 侧终态门**，QA 已指出其运行时零测试驱动（AC-6 P0）。语义应拆：`compatible===false → incompatible`；`!ok → startFailed`（或 `internal`）。self-heal 尚可（token 已在 `:547` 存，下次连接可 claim/reap），但分类与文案错。
- **建议**：拆分两支的 FailReason；补该边的桩测（探测 `{ok:false}` vs `{ok:true,compatible:false}` 各驱动一次），闭合 QA 的 AC-6 P0 覆盖缺口。

### QA 交叉确认 · AC-6 运行时零覆盖（架构视角）
QA 报「AC-6(P0) 运行时零覆盖」与本评审两条独立发现同源，架构上确认成立：
- **A3（MAJOR）是根因**：AC-6 的真冒烟（`fs.readdir`/`git.info`/`pty.spawn`）在设计上由 renderer 在 `verifying` 态执行（`RemoteHostsPage.tsx:188-197`），但 main 同步把 `verifying` 覆盖成 `ready`，该 effect 大概率不触发 → renderer 侧 AC-6 **运行时根本不跑**，只剩 main 探测的 `host.info`。这不是「测试没写」，是**产品路径本身运行时不可达**。
- **A14（MINOR）是 main 侧那一半门**：deploy 路径 main 探测的成/败边（`orchestrator.ts:555-562`）既误分类又无测试驱动。
- 综合：AC-6 应在 **A3 修复后**（renderer 握手改由 verifying 事件驱动）补 renderer 冒烟的渲染层测试 + A14 的两支桩测，才算真覆盖。仅补 main 桩测会掩盖 A3 的运行时缺口。

### A10 · NIT · disconnect 路径重复 emit `disconnected`
- **status**: open
- `disconnect()`（`orchestrator.ts:249-252`）`closeSessionTransport` → `server.close()` 触发 `wireDisconnectWatcher.handleDown`（`:372-382`）已 emit 一次 disconnected；随后 disconnect 自身再 emit 一次（`from===to` 合法故双发）。renderer 幂等则无害，建议择一。

### A11 · NIT · `deploy.waitForReady` 用 `Date.now()` 而非注入的 `now()`
- `deploy.ts:124/128` deadline 用真实时钟，与锁陈旧判定注入的 `now` 不一致；fake-timer 单测下可能失真，非生产 bug。

### A12 · NIT · 文档/死代码小瑕疵
- `residency.ts:60-66` `decideResidency` docstring 称 step1=`!bundleReady→freshDeploy`，但代码在 `!bundleReady` 且存活+tag 匹配时会**先 reap**（`:79-83` 先于 `:85`）——实际行为更正确（回收本配置遗留孤儿），是 doc 滞后。`credentialStore.ts:115` `void prefixes` 死变量。

### A13 · NIT · execDetached token-EOF 时序（ARCH-B5 spike 未勾）
- `ssh.ts:156-184`：若 channel `'close'` 抢在 write 回调前 settle，`stream.end()` 不执行 → 远端 `readFileSync(0)` 可能拿不到 EOF/token → 退化为 startFailed（`orchestrator.ts:535-545` 15s 超时兜底，不 hang main）。属 A0 spike（计划 `☐`）应实证的时序，非静态可判的 bug，登记留痕。

---

## 忠实落地（回读确认无误 · 记功防过度质疑）
- **residency 安全性质扎实**：`cmdlineMatchesHostTag`（`residency.ts:49-57`）argv 分词**全等**比对，兼容 darwin 空格 / linux `\0`；reap 唯一放行分支 `alive && tagMatches`（`:81-83`），兄弟/无关进程**永不 kill**（ARCH-B2 无误杀）；claim 前置 main 探测失败即同栈回收（`:174-224`），无 livelock（ARCH-B1）。决策纯函数与执行编排分离得当。
- **probe 有界超时 + 用后即 close**（`probeHostInfo.ts:52-105`），永不 reject，一切失败归 `{ok:false}`；`host.info` 确为 rpc 方法（`hostCore.ts:155`）且过 host.info-first 门控（`wsServer.ts:135`），探测可行。
- **架构红线守住**：SSH 编排全在 main（renderer/host 零 SSH）；`host.ts` 仅新增纯 Node 端口文件写入（O_EXCL `wx` fail-closed · `:82-106`），零 Electron；`protocol.ts` 零改；`hostClient.connect(opts?)` 向后兼容（`hostClient.ts:150-162`），本地单例路径不变。
- **AC-8/9/10 主体正确**：token 走 stdin 不入 argv/不回显/不落远端盘、加密留存 main；`shouldAlert` 纯函数节流（`wsServer.ts:37-49`）+ 冷却窗；Origin 在 token 闸之后追加、无头放行（模 A6 的 env 注入缺口）。
- **AC-3 无 get-secret 通道**：`preload.ts` remoteHost bridge 仅 list/save/delete/test/connect/disconnect/onEvent，`remoteHostIpc.ts` handler 集合一致，密文只经 save 单向进 main。
- **部署 rename 幂等兜底**（`deploy.ts:172-191`）：目标已存在即弃 tmp、复用赢家、等 `.ready`——是并发场景真正的串行化点，兜住了 A5 的锁失效不致损坏。

## 摘要
| id | severity | title |
|----|----------|-------|
| A1 | BLOCKER | 全新远程机首次部署必失败（无人建 `${dataDir}/bundle` 父目录，非递归 mkdir 连环失败 → 120s 后 deployFailed；测试全 mock 未覆盖） |
| A2 | MAJOR | SSH 传输层断链不检测 → ready 后真实掉线不 emit disconnected（AC-12） |
| A3 | MAJOR | main 同步 verifying→ready 覆盖 renderer 瞬时 verifying → renderer 握手/AC-6 冒烟大概率不执行、per-host client 不建立 |
| A4 | MAJOR | in-flight guard：connect 被在途 test 吞掉 + connect 无条件 delete 误删 test 槽位（违互斥不变量 · 爆炸半径有限） |
| A5 | MINOR | 部署锁 mkdir 与 writeLockMeta 之间竞态 → 并发首装锁失效（rename 兜底自愈但冗余全量上传） |
| A6 | MINOR | TERMPRO_ALLOWED_ORIGINS 注入未实现 → dev WS 直连回归 + 打包 Origin 前提未实证（ARCH-B11 未勾） |
| A7 | MINOR | 远端路径 shell 命令未加引号（远端 $HOME 含空格即破） |
| A8 | MINOR | isEexist 过宽吞掉一切 sftp mkdir 错误（放大 A1 静默失败） |
| A9 | MINOR | safeStorage 不可用时 config 落盘带 has* 旗标但无密文（旗实不符） |
| A14 | MINOR | 部署路径 probe `!ok` 与 `compatible===false` 合并误判 incompatible（QA AC-6 P0 边 · 无测试驱动） |
| A10 | NIT | disconnect 重复 emit disconnected |
| A11 | NIT | waitForReady 用 Date.now 非注入 now |
| A12 | NIT | decideResidency docstring 滞后 + void prefixes 死代码 |
| A13 | NIT | execDetached token-EOF 时序（A0 spike 未勾） |

---

## VERIFY 复核（fix 轮 · commit 36cdb0a）

**范围**：只验前述 A1–A14 是否有效消解 + 是否引入新问题（不重开全面评审）。逐条回读真实 diff，
并在本 worktree 跑 `vitest run src/main/remote src/host/__tests__/portFile.test.ts RemoteHostsPage.test.tsx`
→ **102 passed · 1 skipped（sshd 集成环境门），本机复跑与门禁 539 passed 一致**。

### 逐条处置核验
| id | 修复 | 复核结论 |
|----|------|---------|
| A1 (BLOCKER) | `deployBundle` 取锁前 `mkdir -p "${dataDir}/bundle"`（`deploy.ts:176`），锁 mkdir 仍非递归保原子 | **RESOLVED**。deploy.test.ts:203 有状态桩复现「父目录不存在 → lock mkdir ENOENT 落 EXISTS」并断言 `mkdir -p` 序号早于取锁（`:252-253`）——无 fix 必红。首装 happy-path 真通。 |
| A2 (MAJOR) | `SshConnectionLike.onClose`（`ssh.ts:274-277` client close+error）→ orchestrator `wireSshDisconnectWatcher`（连接成功后即挂 `:492`）汇入 `handleTransportDown`（`:416-424` 守 stage∈{ready,verifying}，关本地资源+emit disconnected） | **RESOLVED**。本地 server 与 ssh 层双入口收口；intentional close 因 failSession 先转 stage 天然幂等；runTest 不挂 onClose 故无 test 误触。旧/新 ssh 无跨代误杀（旧 ssh 在 disconnect 时已 close）。 |
| A3 (MAJOR) | renderer 握手改由 `onEvent` 回调**逐条事件**驱动：`e.stage==='verifying'&&e.tunnel → beginHandshake`（`RemoteHostsPage.tsx`），不再采样被 React 批处理覆盖的当前 stage | **RESOLVED**。verifying 事件到达即同步发起 `connect({wsUrl})`+`fs.readdir` 冒烟，不受同栈 ready 覆盖影响 → AC-6 端到端确定执行、per-host client 确定建立。附 `abandonedRef` 过滤在途 disconnect 后残余事件（防 UI 复活/重握手）。RemoteHostsPage.test.tsx 21 测覆盖。 |
| A4 (MAJOR) | 拆 `connectInflight`（仅 connect 去重）+ `mutex`（connect/test 串行）双表；身份守卫 delete；connect 命中在途 test 会 `priorMutex.then(runConnect)` 真进编排 | **RESOLVED**。connect 不再被 test 静默吞；guard delete 不误删他人槽位；并发 connect 仍复用同一 Promise。disconnect 改 `Promise.race([pending, sleep(5s)])` 有界（E9），不长阻塞 IPC。 |
| A14/A5 相关 | A14：`ok&&compatible===false→incompatible`；`!ok→startFailed`（`orchestrator.ts:630-649`）。A5：`mkdir&&printf meta` 合并单 exec + 缺 meta 判 age=0 宽限 + 去通配 rm | **RESOLVED**（A14）：orchestrator.test.ts:399/419 两支真测试驱动，闭合 QA AC-6 P0。A5 见下残留 R1。 |
| A6/A7/A8/A9 | A6：main `computeRemoteHostAllowedOrigins`→注入 `TERMPRO_ALLOWED_ORIGINS`，host.ts:61-72 解析；A7：全远端路径引号；A8：isEexist 收窄至真 EEXIST；A9：save 前置 `isAvailable()` 拒绝 | **RESOLVED**。另确认相关红线未破：`protocol.ts` 仍零改、host 仍零 Electron、SSH 仍全在 main、AC-3 无 get-secret 通道不变。附带 F8（token 事件只推主窗口非广播）、F19（驻留态恒不打印 token）为额外纵深收敛，方向正确。 |

### 残留（均非阻断 · 建议登记跟进，不拦本轮）
- **R1 · MINOR（A5 修复引入的窄新边）**：`age = ts===null ? 0 : now-ts`（`deploy.ts:88`）——「meta 缺失恒判 age=0」意味着**一个存在但无 meta.json 的锁目录永不被判陈旧**（age 恒 0 ≤ staleMs → 永远 waitForPeer）。触发面很窄：合并 exec 的 `mkdir && printf` 之间若 SSH 恰在亚毫秒窗断开、或 printf 失败，会留下 meta-less 锁。此时 `acquireLock` 文档所称「下次尝试 meta 已正常写入可判陈旧」**推理有误**——下次 `tryMkdirWithMeta` 的 mkdir 因目录已存在即 EEXIST 短路，printf 永不执行，meta 永不补写 → 该 appVersion 首装**永久 wedge**（需人工 `rm -rf ~/.termpro-host/bundle/.deploying-<v>`）。建议：meta 缺失时按「锁目录 mtime 年龄」做兜底陈旧判定，或 meta 用 temp+rename 与 mkdir 解耦补写。概率极低（旧 A5 的击穿更常见且已修好），故仅登记不拦。
- **R2 · 观察（E9 引入）**：disconnect 的 5s 强制超时后 `closeSessionTransport`，若在途 runConnect 恰在超时后瞬时 completes 到 ready，存在极窄竞态（隧道泄漏 / ready-with-closed-ssh）。BL-005 重连时会重访，非本轮阻断。
- **R3 · 观察（A6 残留）**：注入链已通，但打包态白名单硬编码 `null,file://`（`main.ts computeRemoteHostAllowedOrigins`）仍依赖「打包 renderer Origin ∈ {null,file://}」的假设——A0/ARCH-B11 打包 Origin 实证仍应在真机打包包上抽验一次坐实（若实际是别的值则 renderer 直连仍会被拒）。

### VERIFY VERDICT：**APPROVE**
原 1 BLOCKER（A1）+ 3 MAJOR（A2/A3/A4）+ 相关 MINOR（A5/A6/A7/A8/A9/A14）全部有效消解，实现正确且有真测试驱动（非幽灵门禁）；无 open BLOCKER/MAJOR。残留 R1/R2/R3 均 MINOR/观察级，建议登记（R1 优先，虽窄但后果为永久 wedge），不拦本轮进 QA。
