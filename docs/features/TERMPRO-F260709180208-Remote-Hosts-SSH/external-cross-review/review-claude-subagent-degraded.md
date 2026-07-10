---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "worktree 无 localconfig · 异质降级为同模型隔离冷审"
review_via: subagent
verdict: NEEDS_REVISION
---

# BL-003 第三视角冷审（独立采样 · 同模型隔离）

评审真实代码：`src/main/remote/{residency,deploy,orchestrator,ssh,probeHostInfo,hostBundle,credentialStore,remoteHostIpc}.ts` · `src/host/{host,wsServer,token}.ts` · `src/renderer/{services/hostClient.ts,services/hostRegistry.ts,components/settings/RemoteHostsPage.tsx}` · `src/preload/preload.ts` · `src/shared/remoteHost.ts` · 对照 `TECH.md` + `protocol.ts` 红线。默认姿态=质疑。

> 说明：本 slot 已有上一轮同 reviewer 落盘的评审。本轮为独立重采样，结论**独立复现**了其 E1（BLOCKER）与锁/meta 竞态，并**新增**了 Origin dev 假绿、token 日志脆弱、connect/test 合流、重复 disconnected 事件等条目。本文件为**合并后的收敛版**，未丢弃前轮有效发现。

## 结论

**NEEDS_REVISION**。安全面扎实、红线守住（token 零明文落盘/日志、常量时间校验、`--host-tag` 不入端口闸、Origin 纵深、IPC 无 get-secret、`protocol.ts` 零改、host 零 Electron、hostClient 本地路径零变化——见文末实证清单）。但**并发/边界**有一条 ship 前必解的 BLOCKER（首装主机 happy-path 必败，且被桩测掩盖）与两条 MAJOR（并发锁被击穿、mkdir 错误吞没）。

## Findings

### E1 · BLOCKER · 首次连接全新主机：部署锁 mkdir 的父目录 `${dataDir}/bundle` 从未被创建 → 首装必败（桩测掩盖）
- status: open
- file: `src/main/remote/deploy.ts:97-100`（`tryMkdir` 非递归 mkdir）· `src/main/remote/deploy.ts:143-165`（`acquireLock` 首步）· `src/main/remote/orchestrator.ts:498-533`（runConnect 部署分支，前无 dataDir/bundle 预建）· `src/main/remote/__tests__/testKit.ts:73-75`（桩）
- 证据：全新主机 `~/.termpro-host/bundle` 不存在。runConnect 部署前只 `echo $HOME` + `resolveResidency`（纯 sftp 读，缺失返回 null，无副作用），**无人 `mkdir -p ${dataDir}/bundle`**（唯一的 `mkdir -p` 在 orchestrator.ts:524，是部署**之后**为 `hosts/<id>` 建目录）。于是 `tryMkdir` 的 `mkdir "${dataDir}/bundle/.deploying-<v>"` 因父目录 ENOENT 落 `|| echo EXISTS` → false → 读 meta=null → `age=Infinity`→判陈旧 → `rm -rf`(no-op) → 重试 mkdir 仍 ENOENT → 返回 `waitForPeer` → `waitForReady` 轮询永不出现的 `.ready` → **默认 120s 后抛 `deployFailed: timeout`**。即便越过锁，`sftpWriteDir` 的 `mkdirRemote(tmpDir)` 也因父目录缺失失败（又被 E3 吞掉）→ `fastPut` ENOENT。**"添加主机→连接"是本 Feature 主 AC，首装 100% 失败且伴 120s 挂起。**
- 桩测为何绿：`testKit.ts:73-75` 对任何 `mkdir…LOCKED` **无条件返回 LOCKED**，从不建模"父目录缺失即失败"；唯一真机 `sshLocalhost.integration.test.ts` 只测裸 `connect/exec/sftpWriteDir/forwardOut`（且 remoteBase 由 `mkdtempSync` 预建父级），**从不经过 `deployBundle`/orchestrator**，且 `it.skipIf` 无 sshd 即跳过。此路径无任何真实覆盖 → 典型绿测红产。
- TECH 边界：TECH.md:390 原设计 `sftp openSync('bundle/.deploying-<v>','wx')` **有同样父目录缺口**（wx open 父目录不存在同样 ENOENT）。这是 **TECH 未覆盖的边界**，实现忠实继承，非单方偏离。
- 建议：`acquireLock` 前显式 `ssh.exec('mkdir -p ${dataDir}/bundle')`（锁目录本身仍用非递归 mkdir 保原子）；`testKit` 加"父目录缺失时 mkdir 非 LOCKED"分支或补一条空 dataDir 首装用例，钉死回归。

### E2 · MAJOR · 部署锁 mkdir 与 writeLockMeta 非原子 → 并发第二实例把"缺失 meta"读成无限陈旧，击穿锁 + `rm -rf .tmp-*` 删掉赢家在传产物
- status: open
- file: `src/main/remote/deploy.ts:60-95`（`acquireLock`：`await tryMkdir` 成功后**才** `await writeLockMeta`）· `src/main/remote/deploy.ts:77-94`（等待方把 `ts===null` 当 `age=Infinity` 判陈旧并 `rm -rf ${dir}` + `rm -rf .tmp-<v>-*`）
- 证据：实例 A `await tryMkdir`(赢) → 控制权回事件循环 → `await writeLockMeta`。跨 App 实例用**独立 ssh 连接**（无 `SshConnection.serialize` 跨实例串行），实例 B 的 `sftpReadFile(meta)` 可精确落在 A 的 mkdir 与 meta 写之间 → 读到 null → `Infinity>staleMs` → 判陈旧 → `rm -rf` A 刚建的锁目录**和** `rm -rf ${dataDir}/bundle/.tmp-<v>-*`（A 正在上传的临时目录）→ B 重取锁、双双部署。A 若正 `sftpWriteDir`，putFile 命中被删目录 ENOENT → 在 rename try/catch **之外**抛出 → A 报 `deployFailed`。根因：**未写的 meta 被解读为"最陈旧"而非"刚获取"**，与"锁刚被占用应等待"语义相反。两 App 实例并发是本锁存在的全部理由，故此缺口直接否定其价值。
- 建议：meta 与锁获取原子化（同一 exec 内 `mkdir dir && printf … > meta`，或锁目录内先写 meta 再暴露）；等待方对"锁目录存在但 meta 缺失"给短 grace（视作 age=0 等待，而非 Infinity 破锁）；`rm -rf .tmp-<v>-*` 收窄到仅删本次 suffix。

### E3 · MAJOR · `mkdirRemote` 把所有 sftp.mkdir 错误（含 ENOENT/EACCES/EPERM）当 EEXIST 吞掉 → 真失败延后成难懂的 putFile 报错
- status: open
- file: `src/main/remote/ssh.ts:290-304`（`mkdirRemote` + `isEexist` 返回 `code !== undefined`）
- 证据：`isEexist` 对**任何**有 code 的错误返回 true（注释自承"按幂等放行"）。但 ENOENT（父目录缺失，见 E1）、EACCES/EPERM（权限）、只读盘同样被吞，直到后续 `fastPut` 才以更不透明错误暴露，把"权限不足"伪装成 `deployFailed`，并放大 E1 的定位链。ssh2 SFTP 状态码语义（数字 vs 字符串）不稳，用"有 code 即 exists"过宽。
- 建议：仅对真正"已存在目录"放行（匹配 EEXIST/ssh2 FAILURE 且先 `stat` 确认是目录），ENOENT/EACCES 等一律上抛。

### E4 · MINOR · `test()` 在途时发起 `connect()` 被静默吞掉（返回 test 的完成态，从不连接）
- status: open
- file: `src/main/remote/orchestrator.ts:222-224`（`connect` 首行 `if (existing) return existing.then(...)`）· 对比 `test` L255-265 会 chain 到 connect 之后
- 证据：inflight 被 connect/test 共享。`test()` 在途（慢/超时机可达 10s）用户点 connect → 命中 existing → **直接返回 test 的 promise（no-op）并以 undefined 表观成功返回**，未安排任何真实连接。用户以为在连、实则什么都没发生，须再点一次。反向（connect 在途发 test）会正确 chain。
- 建议：connect 命中 existing 时若 existing 属 test（给 inflight 打 kind 标），应 chain 到其后再 runConnect，而非当作已完成的 connect 复用。

### E5 · MINOR · Origin 纵深闸拒绝 vite dev-server 源；host 从不注入 dev 源，而测试注入了它（green测红产 软形态）
- status: open
- file: `src/host/host.ts:61-66`（`startWsServer` **未传** `allowedOrigins`）· `src/host/wsServer.ts:216,258-264`（默认 `DEFAULT_ALLOWED_ORIGINS={'null','file://'}`）· `src/host/__tests__/wsOriginGate.test.ts:16`
- 证据：接线的 host 用默认白名单（仅 null/file://）。生产 renderer `loadFile`（origin=file://或 null）→ 放行，OK。但 `npm start`（vite dev server）下 renderer 第二次握手 `ws://127.0.0.1:localPort`（RemoteHostsPage.tsx:185-189）会带 `Origin: http://localhost:5173` → 被 host **拒绝** → 远程连接卡在 verifying→failed（main 侧 node-ws probe 无 Origin 故权威探测能过，但 renderer 二次确认挂）。`wsOriginGate.test.ts:16` 断言 dev 源"放行"**仅因用例把它注入了自定义 allow 集**——而接线的 host 永不注入，测试给出虚假信心。生产不受影响故 MINOR，但恰是本 Feature dev 主流程受损。
- 建议：dev（存在 `MAIN_WINDOW_VITE_DEV_SERVER_URL`）时把该 origin 注入 `allowedOrigins`；测试改用 host 真实默认集断言，消除误导。

### E6 · MINOR · 在途连接期 `disconnect()` 不中断、阻塞至整个部署/启动超时（最长约 135s），且本地清态与仍在流动的事件竞争
- status: open
- file: `src/main/remote/orchestrator.ts:240-253`（`await existing.catch(...)`）· `src/renderer/components/settings/RemoteHostsPage.tsx:250-254`（`handleDisconnect` 立即 `clearRuntime` + `hostRegistry.drop`）
- 证据：disconnect 对在途编排"best-effort 等它自然结束"，而 connect 在途可达 connectTimeout+deploy(120s)+start(15s)。renderer 已**立即**清运行态并 drop 客户端，但 main 仍继续 deploy/start 并沿途 emit `deploying/starting/verifying/ready` → 经 `onEvent→applyEvent` 把已清空 runtime **瞬时复活到 ready** 再被最终 disconnected 覆盖（UI 抖动 + 一次完整部署白跑即杀）。
- 建议：置 per-configId "abandoned" 标记，emit 前检查静默 / renderer 忽略已 drop 的 configId 事件；或给部署/启动加协作式取消点，disconnect 立即翻乐观 UI 态。

### E7 · MINOR · exec 命令串对 `dataDir`/`appVersion`/路径多处未加引号（注入面 · 纵深）
- status: open
- file: `src/main/remote/orchestrator.ts:164-178`（`buildStartCommand` 全程未引号）· `src/main/remote/residency.ts:221`（`rm -f ${portFilePath}`）· `src/main/remote/deploy.ts:86-87,169,193`（`rm -rf ${dir}` / `.tmp-${appVersion}-*` / tmpDir）
- 证据：`${dataDir}` 源自远端 `echo $HOME`、`${appVersion}` 应用可控，均未引号插入 exec 串（`configId` 恒 base64url 安全）。威胁模型是"用户自己的远端账号"故非跨租户注入，但 $HOME 含空格/元字符即破命令（轻则失败、重则误删）。锁目录 `mkdir "${dir}"` 已加引号，rm/start 却没有，风格不一致。
- 建议：统一对远端路径插值加引号（token 走 stdin 不受影响）；对 dataDir 做一次断言（非空且以 `/` 开头，呼应 ARCH-B9）。

### E8 · MINOR · 双实例并发为同一 configId 拉起新 host，败者把竞态误分类为 `incompatible`（含可达性说明）
- status: open
- file: `src/main/remote/orchestrator.ts:549-562`（build tunnel + probe 用本实例 newToken）· `src/host/host.ts:82-91`（端口文件 O_EXCL 'wx'，第二个 host 撞 EEXIST 自杀）
- 证据：两 start 都走部署+启动 → 两个新 host 各以各自 token 起；端口文件 `openSync(...,'wx')` 只允一个赢，败者 host EEXIST 退出。败者 orchestrator `pollPortFile` 读到**赢家**写的端口文件却用**自己的** newToken probe → verifyToken 失败 → `failSession('incompatible')`（竞态被误报为版本不兼容，误导排障）。
- 可达性：单实例内 per-configId `inflight` 互斥 + residency reap 已序列化同 configId；跨 App 实例 configId 因 userData 不同而各异（单实例锁 main.ts:52 按 userData 隔离），故"同 configId 双 host"实际路径窄。O_EXCL 自杀本身是好的防御属性。因此列 MINOR 并附此caveat。
- 建议：probe 失败且端口文件 hostTag/pid 非本次启动时，归类 `internal`/`startFailed`（或新增 `raced`），文案区分"并发抢占"。

### E9 · NIT · claim 探测期 candidateTunnel 本地 `net.Server` 泄漏窗口
- status: open
- file: `src/main/remote/residency.ts:174-178,213-215`
- 证据：candidateTunnel 关闭只在"未认领"分支（L213）或认领成功保留；若 `probeHostInfo` 抛（契约上"永不 reject"，窗口窄）或 buildTunnel resolve 后有后续 await 抛错，异常越过两处 close → orchestrator catch 的 `ssh.close()` 关不掉这个 loopback 监听 server → fd/端口泄漏。
- 建议：`resolveResidency` 顶层 try/finally 兜底关闭尚未移交的 candidateTunnel。

### E10 · NIT · 承载 token 的 verifying 事件被广播到所有 BrowserWindow 并落 renderer store
- status: open
- file: `src/main/remote/remoteHostIpc.ts:23-29`（`for (const win of getAllWindows()) win.webContents.send(event)`）· `src/renderer/components/settings/RemoteHostsPage.tsx:184-185`
- 证据：`verifying` 事件带 `tunnel.token`，无差别广播给所有窗口并进 renderer 运行时态。单窗口下无实质影响，但相较"定向下发给发起窗口"扩大了明文 token 暴露面（devtools/多窗口）。符合 ADR-001"token 一次性经 ws URL 出 main"，粒度偏宽。
- 建议：多窗口引入后把带 token 的事件定向到发起 webContents，或改传一次性握手 ticket 而非长效 token。

### E11 · NIT · `wireDisconnectWatcher` 同挂 close+error → 重复 emit `disconnected`
- status: open
- file: `src/main/remote/orchestrator.ts:372-382`
- 证据：`server.on('close')` 与 `server.on('error')` 都指向 `handleDown`；error 常先于 close，触发两次。首次 `ready→disconnected` 合法，第二次 `disconnected→disconnected`（`from===to` 合法）再向 renderer 推一条 disconnected。幂等无害但冗余。
- 建议：`handleDown` 触发后 `server.off`（once 语义），或只监听 close。

### E12 · NIT · `host.ts` 的 `token=%s` 打印是脆弱红线（当前安全，一处改动即落盘 host.log）
- status: open
- file: `src/host/host.ts:69-71`
- 证据：`if (source === 'generated') console.log('[host] token=%s', token)`。远程流程走 `--token-stdin`（`resolveToken` 返回 `source:'stdin'`，token.ts:111-116）故此行**不触发**，grep 实证 host.log(`> host.log 2>&1`) 无 token——当前合规。但这是靠"调用方永远传 --token-stdin"维持的隐性契约：任何未来让远程 host 以 generated 起或调试改动，都会把 128-bit token 明文写进落盘 host.log。
- 建议：把该打印限制到"确非驻留模式"（如无 `TERMPRO_HOST_PORT_FILE` 时才允许），结构上杜绝落盘。

## 实证：已验证合规（逐项声明）

- **凭据/token 零明文落盘**：secrets 文件存 `base64(safeStorage.encryptString(明文))`（credentialStore.ts:76-79）；`setSecret` 在 `!isEncryptionAvailable` 时**抛错拒存、绝不明文兜底**（AC-3；credentialStore.test 有 `toThrow`）；`getSecret` 瞬时解密不缓存。
- **token 零日志**：`grep console/logger … token` 全仓仅命中 host.ts:70（generated 路径，远程不触发，见 E12）；password/passphrase 无任何日志命中。
- **`--host-tag` 不入端口闸**：host.ts:48 hostTag 只写端口文件/日志供 reap 双验，token 校验（wsServer verifyToken 常量时间 sha256+timingSafeEqual）只认 token；residency reap 决策表安全（residency.ts:49-89）——T-034 兄弟/无关/前缀碰撞三态 kill 恒不出现，argv 分词全等非 substring。
- **IPC 无 get-secret**：remoteHostIpc.ts 仅 list/save(单向写)/delete/test/connect/disconnect + event；preload.ts:124-155 同样无读密文通道。
- **Origin 门 + 节流**：checkOrigin 纵深 + token 主屏障；节流为 alert-only 不阻断（wsServer.ts:221-240，有意——阻断给同机攻击者 DoS 杠杆），冷却窗节流；wsAuthThrottle/wsOriginGate 为真 upgrade 实测（evil origin 即便 token 正确也拒 / 20 次错 token 恰 1 次告警且合法连接仍成功），非空壳（唯 dev 源注入见 E5）。
- **架构红线**：SSH 全在 `src/main/remote/*`（renderer 只经 IPC event 拿 `tunnel{localPort,token}`，RemoteHostsPage 无 fs/ssh/electron import）；host/{host,wsServer,token}.ts 纯 Node 零 Electron（ssh2 仅在 main）；`src/shared/protocol.ts` **未改**（diff 确认）；`hostClient` 本地路径**零变化**（`connect()` 无参→`readRemoteWsEnv()` 兜底→MessagePort，diff 确认，40+ 消费方兼容）。
- **两 App 实例并发**：不同 userData → 同物理机得不同 configId → 远端各自独立 host 目录/进程、reap 只杀本 tag，无跨实例误杀；共享 `bundle/` 本应由部署锁串行——但该锁被 E2 击穿，E1 首装缺陷对两实例同等生效。
- **probe/verifying 有界超时**：probeHostInfo.ts 10s 超时 + 无论成败必 `ws.close()`，永不 reject 归一 `{ok:false}`；main 前移探测为 ready 的权威判据。

## 最该 ship 前解决（1–2 点）

1. **E1（BLOCKER）**：首装缺 `mkdir -p ${dataDir}/bundle`，"添加新主机→首次连接"主路径必败且被桩测完全掩盖。修：部署前递归建 bundle 父目录（锁目录仍非递归 mkdir 保原子）+ 补空 dataDir 首装回归。
2. **E2（MAJOR）**：部署锁 mkdir 与 meta 写非原子，并发第二实例把"缺失 meta"读成无限陈旧从而破锁并删掉赢家在传的 `.tmp-*`。修：meta 与锁获取原子化 / 对"锁存在但 meta 缺失"给短 grace 而非直接 break；`rm -rf .tmp-*` 收窄到自身 suffix。顺带把 E3（isEexist 过宽）一并收紧——它掩盖 E1 真因。

---

## VERIFY 复核（fix commit 36cdb0a · degraded 同模型隔离）

复核范围：仅验 E1–E12 是否真消解 + 有无新问题。逐条查真实 diff/代码（deploy.ts / ssh.ts / orchestrator.ts / residency.ts / remoteHostIpc.ts / host.ts / main.ts / RemoteHostsPage.tsx），并独立跑 `npx vitest run src/main/remote src/host` → **201 passed / 1 skipped（skip=localhost sshd 缺省的真机集成测，如实标注非伪绿）**。

**verify verdict: APPROVE（残留 1 条 MINOR · 非阻塞 · 见 R1）**

### 逐条消解确认

| 原 finding | 状态 | 证据 |
|---|---|---|
| **E1 BLOCKER** 首装必败 | ✅ 真消解 | deploy.ts:176 取锁前 `mkdir -p "${dataDir}/bundle"`（锁目录仍非递归 `mkdir "${dir}"` 保原子）。**回归测非空壳**：deploy.test 新用例桩把「父目录未由 mkdir -p 建好时的锁 mkdir」建模为 `EXISTS`（复现真实 ENOENT→‖echo EXISTS 语义），并断言 `mkdir -p` 顺序先于取锁——删掉修复即红。绿测红产缺口已闭。 |
| **E2 MAJOR** 锁被击穿 | ✅ 消解（引入 R1） | mkdir+meta 合并单 exec（tryMkdirWithMeta，deploy.ts:111-122，窗口收窄到远端本地 shell 执行）；缺 meta 判 `age=0` 宽限（deploy.ts:93）不再无限陈旧；`rm -rf .tmp-*` 通配已删（仅 `rm -rf "${dir}"`）。回归测断言缺 meta 竞态窗口 `rmLockCalled===false`（不误破活跃锁）。 |
| **E3 MAJOR** isEexist 过宽 | ✅ 真消解 | ssh.ts:isEexist 收窄为只放行 `code==='EEXIST'` 或 message 含 file/already exists，ENOENT/EACCES 一律上抛。实际仅用于 sftpWriteDir 建全新唯一 tmp 子目录，不误伤幂等。 |
| **E4 MINOR** connect 被 test 吞 | ✅ 真消解 | 拆 `connectInflight`（仅 connect 去重）/`mutex`（connect+test 串行化），身份守卫 delete。connect 命中在途 test 时经 mutex chain 到其后再真进 runConnect，不再静默返回 test 的 Promise。 |
| **E5 MINOR** Origin dev 假绿 | ✅ 真消解 | main.ts computeRemoteHostAllowedOrigins dev 态追加 `new URL(VITE_DEV_SERVER_URL).origin` → orchestrator → buildStartCommand 注入 `TERMPRO_ALLOWED_ORIGINS`；host.ts:61-72 读 env 解析成 allowedOrigins Set 传 startWsServer。dev 下 vite origin 真放行、非仅测试注入。 |
| **E6 MINOR** disconnect 残余复活 | ✅ 真消解 | main disconnect 5s 有界 `Promise.race`（E9）；renderer abandonedRef 过滤已 drop configId 的非终态事件（只放行 disconnected/idle），handleConnect 解除。 |
| **E7 MINOR** exec 路径未引号 | ✅ 真消解 | buildStartCommand 全路径双引号；residency `kill "${pid}"`/`rm -f "…"`/cmdline、deploy `rm -rf "${dir}"`/`mkdir -p "…"`/`touch "…"` 均加引号。 |
| **E8 MINOR** 竞态误分类 incompatible | ✅ 消解且分类正确 | orchestrator:636-649 拆两支——`ok && compatible===false`→incompatible（真版本不符，probeHostInfo 仅在拿到 host.info 后才置 compatible）；`!ok`（传输/超时/token 拒→ws 未拿到 host.info）→startFailed（可重试）。语义正确：真不兼容恒 ok=true，!ok 恒传输失败，无反向误标。 |
| **E9 NIT** candidateTunnel 泄漏 | ✅ 真消解 | residency:174-187 probeHostInfo 包 try/catch，抛出即 `candidateTunnel.server.close()` + 归一探测失败。 |
| **E10 NIT** token 广播全窗口 | ✅ 真消解 | remoteHostIpc 改 `getMainWindow()` getter，event 只推主窗口；main.ts 传 `() => mainWin`（getter 非固定引用，规避注册早于 createWindow）。 |
| **E11 NIT** 重复 disconnected | ✅ 真消解 | 收口 handleTransportDown，stage 守卫（仅 ready/verifying 才 emit）天然幂等；net.Server close/error 与 ssh.onClose 二次触发命中已 disconnected → no-op。 |
| **E12 NIT** token 打印脆弱 | ✅ 真消解 | host.ts 加 `isResident = Boolean(TERMPRO_HOST_PORT_FILE)`，驻留态恒不打印 token（即便 source 意外为 generated 也不落盘）——从隐性契约升级为结构约束。 |

**顺带确认的 bonus 修复（非我 findings，均成立）**：F2 AC-12 真断链检测（ssh.onClose→handleTransportDown，此前 ready 后真实断线永不可探测——是个实打实的独立 bug，已补）；F3 verifying→ready 竞态（renderer 握手改 onEvent 逐条事件驱动，规避 React 批处理把背靠背 verifying+ready 采样成只见 ready → per-host client 永不建立）；A9 safeStorage 旗标前置校验（加密不可用时整单 save 拒绝，不落半成品 `hasPassword:true` 误导配置）。

### 新问题（fix 引入的残留）

**R1 · MINOR（新 · E2 修复副作用）· status: open**
`file: src/main/remote/deploy.ts:60-108`（acquireLock：缺 meta → age=0 宽限 + 只按 meta.ts 判陈旧）
E2 修复把「缺 meta」从 age=Infinity（旧：会 break-and-reacquire）改成 age=0（新：恒 waitForPeer），代价是**引入一条永久 wedge 路径**：若持锁实例的远端 shell 在单条 `mkdir "${dir}" && printf …meta…` 的 mkdir 已成功、printf 未执行的微秒窗口内被杀（SSH 通道掉线触发 SIGHUP / 远端断电 / 该 exec 未 nohup），锁目录残留且 meta **永久缺失**。此后该 appVersion 的每次 connect：mkdir 失败→读 meta=null→age=0→waitForPeer→轮询永不出现的 `.ready`→`waitReadyTimeoutMs`(默认=staleMs=120s) 超时 deployFailed。orchestrator 无自动重试，**每次连接 120s 后失败、永不自愈，须人工 `rm -rf ~/.termpro-host/bundle/.deploying-<v>` 才能恢复**。
🔴 acquireLock 头注 deploy.ts:72-74 明确声称「有界…不会永久 wedge」，该断言**不成立**——后续尝试都不持有锁（mkdir 失败走读 meta 分支），永不补写 meta，故 meta 永久缺失、宽限永不转陈旧。概率极低（微秒窗口内崩溃），但后果不可自愈 + 注释误导后人，值得记一条。
- 建议（不重开 E2）：陈旧判定除读 meta.ts 外，补一条「lock **目录** mtime（sftp stat）> staleMs 且 meta 缺失 → 判为崩溃孤儿 → break-and-reacquire」。正常持锁方微秒内即有 meta，只有真崩溃孤儿才既缺 meta 又目录老，二者可区分，自愈能力与 E2 互斥性可兼得。或把该永久 wedge 老实写进注释（撤掉「不会永久 wedge」），列为已知 YAGNI。

### 结论
E1–E12 **全部真消解**（非改测试掩盖：E1/E2 回归测桩已建模真实失败语义，删修复即红；201 remote/host 测独立复跑绿）。唯一新增 R1 为 E2 修复的低概率副作用（永久 wedge on crash + 注释误导），MINOR 非阻塞，建议 ship 后补目录-mtime 兜底或据实修注释。**放行。**
