# Blueprint 评审 · Architect（BL-003 · TERMPRO-F260709180208-Remote-Hosts-SSH）

- reviewer: architect
- review_scope: blueprint (TECH.md + TC.md)
- execution: subagent（隔离冷审）
- verdict: **NEEDS_REVISION**
- reviewed_at: 2026-07-10

## files_read

真实代码核验（逐文件已读，用于校验 TECH「现状基线」line 引用与自洽性）：

- src/host/host.ts、src/host/token.ts、src/host/wsServer.ts、src/host/hostCore.ts、src/host/ptyPool.ts
- src/main/main.ts、src/main/externalUrlPolicy.ts
- src/renderer/services/hostClient.ts、src/renderer/components/SettingsEntry.tsx
- src/shared/protocol.ts、src/shared/versionCompat.ts（存在性 + 导出核验）
- scripts/package-host.mjs、forge.config.ts、vite.main.config.ts、package.json、package-lock.json（ssh2 0 命中）
- .github/workflows/host-package.yml、.github/workflows/release.yml
- project-specs/DEV-RULES.md
- docs/design/preview-project/src/main.jsx（RemoteHostsPage/hostRuntime/FAIL_REASONS 真实所在地）

评审对象 + 上下文：

- TECH.md、TC.md
- PRD.md（v0.3 · AC-1..14 · D-1~D-7）、PRD-REVIEW.md（ARCH-11 / R2-N2 / QA-R2-1 must-resolve）、adrs/ADR-001、UI.md

## 总评

TECH 的 grounding 纪律扎实：抽查约 30 处 line 引用（token.ts 四信道、wsServer loopback+门控+节流点、host.ts standalone 分流、main.ts ensureHost、hostClient connectViaWebSocket、FLOW 水位、host-package.yml matrix）**全部属实**；`protocol.ts 零改动`、`safeStorage/ssh2 全仓 0 命中`、token-stdin/loopback/背压复用**均与现实自洽**；「拒绝的更复杂方案」诚实、无过度设计。

但 **PRD 明确移交 blueprint 的最高风险处（ARCH-11 认领-或-确定性回收）存在真实的闭环缺口与竞态**，不是措辞问题而是控制流不可实现：认领失败的回退回收路径在当前 main/renderer 职责划分下**无法触发**（潜在 livelock），且「双因子身份核验」对**同机多配置的兄弟 host 进程不具区分度**（configId 只在 env 不在 argv）。叠加 RemoteHostsPage 的 grounding 错误、共享 bundle 目录的跨实例版本抖动、CI tag 触发的版本偏斜、以及 residency 决策核心属性在 TC 无可执行断言——需一轮修订。多数为有界可改，但 ARCH-B1 改动 main↔renderer 契约，故 NEEDS_REVISION。

---

## findings

### ARCH-B1 · 认领失败→回退回收的闭环在当前控制流不可实现（潜在 livelock）· severity: **high** · category: concurrency-race

**description**：residency.ts 步骤 3（SSH-4）声称「认领分支若握手失败(token 陈旧/进程非我方) → 回退到步骤 4 回收」，但握手实际发生在 **renderer**（TECH §前端：`hostRegistry.getOrCreateRemote(...).connect({wsUrl})`；SSH-1 主流程亦注明「ready / failed·incompatible 由 renderer 握手结果产出」）。main 的 residency 函数在 emit `verifying` 后即返回，此后 main 不再等待任何信号。IPC 面（§接口）只有 `remoteHost:event` 的 **main→renderer** 单向通道，**没有 renderer→main「认领失败请回收重部署」的反馈信道**；状态机也只有 `verifying→failed(incompatible)`，无 `verifying→deploying`（回收重部署）边。

后果链：一个 resident 进程若同时满足「存活 + cmdline 匹配 + bundleVersion==appVersion」但 token 不匹配（如 main 侧 storedToken 损坏、或认领到兄弟进程见 ARCH-B2），则**每次 connect 都走认领分支**（步骤 4 永不进入，因其前置条件是认领条件失败），renderer 握手每次因 token 被 `socket.destroy()` 而失败。且此失败是通用 ws 失败（非 `ProtocolIncompatibleError`），§前端只映射了 `ProtocolIncompatibleError→failed·incompatible`，通用 ws 失败**无归宿**。用户点重试 → 再次认领同一进程 → 再次失败 = **livelock，永远到不了「回收+重部署」**。

**suggestion**：把认领的**验证前移到 main**：main 建隧道后，用 storedToken 自建一条 ws（Node `ws` 客户端，无 Origin 头→天然放行）对 `127.0.0.1:localPort` 做 host.info 探测，确认「进程确为我方 + 版本兼容」后**才** emit `verifying` 交 renderer；探测失败则 main 在**同一 connect() 调用栈内**同步走步骤 4（回收+清陈旧+重部署）。这样回退闭环全在 main、无需新增 renderer→main 信道，renderer 侧握手退化为版本二次确认（近必成功）。此改动同时消解 ARCH-B2 的认领误命中。若坚持 renderer 侧握手为唯一验证点，则必须新增 renderer→main 的「认领失效」RPC + `verifying→deploying` 状态边，并在 §前端把通用 ws 失败纳入映射——成本更高且状态机更复杂。

---

### ARCH-B2 · 「双因子身份核验」对同机兄弟 host 进程不具区分度 → reap 路径误杀 · severity: **high** · category: concurrency-race

**description**：SSH-4 身份核验 = `kill -0 <pid>` + cmdline 含 `'host.js'` 且含 `'--listen 127.0.0.1'`。但启动命令为 `env TERMPRO_HOST_DATA_DIR=… TERMPRO_HOST_PORT_FILE=hosts/<id>/host.port node bundle/host.js --listen 127.0.0.1:0 --token-stdin`——**configId 只在环境变量里，不在 argv**。`ps -o command=` / `/proc/<pid>/cmdline` 只反映 argv（`env VAR=val node …` 经 execvp 后进程 argv = `node bundle/host.js --listen 127.0.0.1:0 --token-stdin`，环境变量在 `/proc/pid/environ` 不在 cmdline），且 `bundle/` 是**全局单份共享**（远端布局 line 244-248），脚本路径亦全配置一致。**结论：所有配置的 host 进程 cmdline 签名完全相同，双因子无法区分 configId。**

后果：步骤 4 的 reap `kill <portFileRaw.pid>` 只凭 pid + 非区分性 cmdline。若 configA 的旧 host 死亡、pid 被 configB 的**存活 host** 复用，则 configA 的 port 文件仍存旧 pid（=现 configB 的 pid），cmdline 匹配 → main `kill` 之 → **误杀 configB 的合法 host**。TECH「关键安全性质①：PID 复用不误杀无关进程」对**无关**进程成立（cmdline 不含 host.js），但对**兄弟 host** 不成立。认领路径虽有 token 闸兜底（认领到兄弟 → token 不符 → 失败），但 reap 路径**无 token 闸**，是纯误杀。「同一远程机被添加两次 / dev+prod 同机 / 两台 App 实例连同一机」均是现实场景。

**code_evidence**：src/host/host.ts:36-49（standalone 分流只解析 `--listen` / token 信道，无配置标识入 argv）；TECH SSH-4 line 291-298（reap 仅凭 pid+cmdline）。

**suggestion**：把 configId（或一次性 nonce）作为**显式 argv** 注入 host，如 `node bundle/host.js --listen 127.0.0.1:0 --token-stdin --host-tag <configId>`（host 侧解析后仅用于日志/自证，不影响端口闸），使 cmdline 身份核验对 configId 真正可区分；reap 前额外断言 cmdline 含本配置 `--host-tag <configId>`。配合 ARCH-B1 的 main 侧 token 验证，双路径（claim/reap）都获得强区分。

---

### ARCH-B3 · connect() 缺 per-configId 在途互斥 → 并发编排竞态 · severity: **medium** · category: concurrency-race

**description**：`RemoteHostOrchestrator` 持 `Map<configId, RemoteHostSession>`，但 TECH 未定义对同一 configId 的**并发 connect 守卫**。`remoteHost:connect` 是 `send`（fire-and-forget），`remoteHost:test` 是 `invoke`——两者可并发；失败重试与断线重连亦可与既有流程叠加。两个并发 connect(configId) 会各自 residency→各自 execDetached 拉起→**竞争 host.port 的 O_EXCL**，其一 host `openSync('wx')` EEXIST fail-closed exit(1) → 该 flow startFailed（UX 混乱，且 host.log 留半成品）。UI.md「忙碌态不渲染按钮」只是 UI 层缓解，编排器自身应自洽。

**suggestion**：orchestrator 对每个 configId 维护在途 Promise（in-flight guard）：connect/test 命中在途则复用或拒绝二次进入；O_EXCL fail-closed 保留为最后防线（防跨实例，见 ARCH-B4）而非常态路径。

---

### ARCH-B4 · 全局共享 bundle/ + 按 appVersion 整体覆盖 → 跨实例版本抖动 + 非原子删改 · severity: **medium** · category: concurrency-race

**description**：远端布局用**单份全局** `~/.termpro-host/bundle/`（含 `.version`），而回收/版本判定是**按 configId**。幂等重部署 = 「sftp 先删 `bundle/` 再全量上传」（SSH-5）。两个问题：① **跨实例版本抖动**：用户在两台 App（如 v0.3.27 与已升级的 v0.3.28）连同一远程机，各自把共享 `bundle/` 覆盖回**自己的** appVersion，互相判定对方留下的 `.version` 为「不符 → 重部署」→ 版本反复 flap，且每次 flap 触发对方 resident 的确定性回收重启；② **非原子**：`删 bundle/` 与「有 resident 正从 bundle 版本探测/另一并发 start 正 spawn」交错时，probe 读到半删状态或 spawn 读到不完整 host.js。

**suggestion**：bundle 路径**按版本隔离**（`~/.termpro-host/bundle/<appVersion>/`，多版本并存、启动命令指向对应版本目录），或至少按 configId 隔离；杜绝「删共享目录再上传」的破坏性覆盖，改为「上传到版本化新目录 + 原子切换符号链接/指针」。这样跨实例/跨配置各取所需版本，无 flap、无半删窗口。

---

### ARCH-B5 · execDetached token 注入 × setsid 后台 channel 拆除时序（EPIPE/EOF）· severity: **medium** · category: completeness

**description**：TECH 已诚实标记此处需 blueprint spike（good），但失败模式要点化以便 spike 可证否。启动命令 `setsid nohup env … node … --token-stdin > host.log 2>&1 < /dev/stdin &` 经**单条** `ssh.exec(cmd)` 下发：shell 后台化 node 后立即到达命令末尾并退出→关闭 exec channel。风险时序：`execDetached` 若在 shell 退出、channel 拆除**之后**才写 token，则写入落到已关闭的 pipe → EPIPE，token 永不达 → host `requireNonEmptyToken` 抛错 exit(1)（token.ts:37-45/113）→ startFailed。必须保证「token 全量写入 channel stdin 并被 node（`< /dev/stdin` 绑定同一 channel 读端）读取」**先于** channel 拆除；half-close(`stream.end()`) 仅负责 EOF，不解决「写在拆除之前」的顺序。

**suggestion**：spike 显式覆盖三点时序断言：(a) token 写入完成 → (b) host `readFileSync(0)` 读到非空 token（source=stdin，无回显，host.log 不含 token）→ (c) host.port 生成。若 `< /dev/stdin` + 后台化的 fd 继承不稳，退化方案：`--token-fd` 经 here-string / 独立 channel，或先 exec 一个「读 N 字节 token 再 setsid 拉起」的最小 shell wrapper，把 token 交接与后台化解耦。

---

### ARCH-B6 · RemoteHostsPage.tsx 标为「改（现为 mock）」但 src/ 内不存在 · severity: **medium** · category: technical-consistency

**description**：TECH 改动文件清单（line 541）列 `src/renderer/components/settings/RemoteHostsPage.tsx # 改：接线真实 IPC（现为 mock hostRuntime → orchestrator 事件驱动）`，§前端亦称「沿用既有 RemoteHostsPage」。但 `find src -iname '*RemoteHost*'` **0 命中**，`grep -rn 'RemoteHosts\|hostRuntime\|remoteHost' src` **0 命中**，`src/renderer/components/settings/` 目录不存在；renderer 现有唯一 settings 面是 `SettingsEntry.tsx`（账户/About 类）。`RemoteHostsPage`/`hostRuntime`/`FAIL_REASONS` 只存在于**设计预览工程** `docs/design/preview-project/src/main.jsx`（JSX 原型，UI.md line 17 已明示）。TECH 把设计原型误当作生产代码「改」，导致：新增/改动计数错（应 新增 7 / 改动 8）；实现步骤 H2「RemoteHostsPage 接线真实事件」标 🟢 严重低估——实际是把整套连接生命周期 UI（FAIL_REASONS 字典 + 三段 stepper + 徽标 + passphrase 表单 + 最近使用区 + 删除确认）从 JSX 预览**移植**为生产 TSX 再接线，RD 会去找一个不存在的文件。

**code_evidence**：docs/design/preview-project/src/main.jsx（RemoteHostsPage 真实所在）；src/renderer/components/SettingsEntry.tsx（现有唯一 settings 组件，无 remote hosts）。

**suggestion**：改标为 `# 新`（从预览工程移植），修正复杂度评估的新增/改动计数，把 H2 拆为「移植 RemoteHostsPage 生产组件」+「接线 remoteHost 事件」两步并调整工作量与验证口径（移植后需补 renderer 测，非纯 wiring）。

---

### ARCH-B7 · CI tag 触发的 bundle 版本偏斜（R2-N2 未闭合的核心）· severity: **medium** · category: ci

**description**：R2-N2 must-resolve = CI 三架构 + linux-arm64 降级阀。降级阀部分（detectArch 命中但 resources 缺 → archUnsupported + npm 手装）方案可落地 ✓。但**主 happy-path 接线**存在版本一致性洞：`host-package.yml` 触发器为 `push:[main] / pull_request / workflow_dispatch`，**不含 tag**；`release.yml` 由 `push: tags:['v*']` 触发并 `npm run make`。TECH SSH-5 推荐「release.yml 下载三架构 artifact 再 make」，但 tag 推送时 host-package.yml **不运行**，release 只能下载**此前 main run** 的 artifact——其 `bundle/.version`（=打包时 rootPkg.version，见 package-host.mjs writeArtifactMeta:139-156）可能 ≠ 本 tag 的 appVersion。结果：内置 bundle 版本与应用版本不符 → 运行时 residency 恒判「版本不符」→ 永不 fast-path（AC-13 退化），甚至内置陈旧 host 代码。

**suggestion**：三架构 bundle 构建须并入 **tag 流水线**：release 增加 `needs:` 的三架构 matrix job（darwin-arm64 on macos-14 / linux-x64 on ubuntu-latest / linux-arm64 on ubuntu-24.04-arm，复用 package-host.mjs），在同一 tag commit 上产出 → 落 `resources/host-bundles/<arch>/` → 再 make。保证 `bundle.version == release version`。「下载 prior-run artifact」因版本偏斜不可取，应从 待决策 中排除。

---

### ARCH-B8 · residency 决策核心属性在 TC 无可执行断言 · severity: **medium** · category: testability

**description**：ARCH-11 的最高风险属性 =「认领 vs kill vs 仅清陈旧 vs fresh-start 的决策 + 双因子（PID 复用/兄弟 cmdline 不误杀）」。TECH §测试策略明列了 `residency` 纯逻辑单测（喂 `{portFile,killAlive,cmdline,storedToken,bundleVersion}` 组合），但 **TC.md 的 tests[] 未枚举任何 residency 决策测试文件**（最接近的 T-028 是 integration「claim 不重启」、T-010 是 state machine transitions）。即 blueprint 承诺的、也是 architect 最需守住的决策表断言，在机读 TC 契约里缺失。结合 ARCH-B2，「兄弟 cmdline 碰撞 → 不误杀」这条尤其必须有可执行断言。

**suggestion**：TC 增补 `residency.test.ts`（unit · P0）决策表：认领/回收/仅清陈旧/fresh-start 全组合 + 「pid 复用但 cmdline 不含本配置 host-tag → 不 kill」+「存活+cmdline匹配+版本符+token 不符 → 不进 livelock（前提 ARCH-B1 修复后：main 探测失败→回收）」。与 T-010/T-028 互补。

---

### ARCH-B9 · 端口文件路径 relative/absolute 不一致 · severity: **low** · category: technical-consistency

**description**：SSH-4 正文称 `TERMPRO_HOST_PORT_FILE`（**绝对路径**）注入，但 execDetached 示例（line 309）、架构图（line 111）、reap 的 `rm -f hosts/<id>/host.port`、算法 step 4 均用**相对** `hosts/<id>/host.port`。启动命令 `cd <dataDir>` 后相对路径锚 dataDir；但 main 侧 sftp 回读/删除的 cwd 通常是 home（`~`），若 dataDir=`~/.termpro-host` 则 `hosts/<id>` 与 `.termpro-host/hosts/<id>` 不同基。host-write / main-sftp-read / main-rm 三处基准不统一会导致回读不到端口文件（伪 startFailed）或清不掉陈旧文件。

**suggestion**：全程钉死**绝对路径**（dataDir 锚定，如 `${dataDir}/hosts/<id>/host.port`），host env、main sftp、main rm 三处共用同一绝对路径常量；示例与正文对齐。

---

### ARCH-B10 · TC 依赖的可测接缝 TECH 未声明（DI/节流）· severity: **low** · category: testability

**description**：TC §3/§5 明确依赖三处接缝：sshTransport 依赖倒置（可注入 exec/sftp/forwardOut）、数据目录可注入、节流窗口可注入。数据目录注入已有（TERMPRO_HOST_DATA_DIR）✓。但 (a) TECH §SSH-1 的 `SshConnection.connect` 是 **static 方法**，orchestrator 如何注入假 SshConnection（TC T-005/008 需要）未声明——静态方法难 mock；(b) AC-9 节流 TECH 给的是 closure 内联 `let lastAlertAt`（§安全纵深 line 467-472），未提供 TC 风险#2 要求的纯决策函数/可注入时钟接缝。

**suggestion**：TECH 显式声明 orchestrator 的 ssh 工厂注入（构造参 `connectSsh: (opts)=>Promise<SshConnectionLike>`，生产传 `SshConnection.connect`，测试传桩）；把节流决策抽为纯函数 `shouldAlert(now, lastAlertAt, count, cooldownMs): boolean`（T-019 直接单测，集成 T-020 只验单窗口≤1）。

---

### ARCH-B11 · Origin 白名单值集正确，建议 spike 实测锚定 · severity: **low** · category: technical-consistency

**description**（确认为**正确**，附加验证建议）：`ORIGIN_ALLOW = {'null','file://'}` + dev vite origin 的锚定是对的——`loadFile`（main.ts:489）加载的 `file://` 页面，Chromium 在 WS 握手发 `Origin: null`（不透明源），少数版本发 `file://`，两者都在白名单，不误杀；dev `loadURL(vite)` 发 `http://localhost:5173` 经 env 追加 ✓；`origin===undefined→放行` 覆盖 Node 客户端/verify 脚本（也正好让 ARCH-B1 建议的 main 侧探测 ws 天然放行）✓。Origin 头经 ssh 隧道透传到远端 wsServer 完整保留 ✓。**唯一风险**是「误杀 = 连接全失败」，故值集必须实证而非假设。

**suggestion**：A0/打包 spike 顺带**抓取打包版 renderer 经隧道发给远端 wsServer 的真实 Origin 值**（'null' vs 'file://'），确认白名单命中；TC T-021 矩阵已断言两者，good，保留。

---

## 附：已核验为属实/自洽（供 PMO 快速采信）

- line 引用抽查约 30 处（token.ts 71-74/77-82/111-116/125-131、wsServer 100-113/170-176/191-201/203-222/235-256、host.ts 36-78/59-61/63-68、main.ts 117-137/141-145/125、hostClient 39-72/149-162/186-224/214-217/344、hostCore 85-140/156、protocol 4/11-14、ptyPool 82-116、host-package.yml 31-37、package.json 69-85）**全部准确**。
- `protocol.ts 零改动`承诺**成立**：remoteHost:* 全为 Electron IPC 壳层信道；隧道内跑的是既有 HostService 协议原样；hostId 恒 'local' 由 configId 键规避（ARCH-8 一致）。
- greenfield 声明属实：src 内 ssh2 / safeStorage / RemoteHosts 生产代码 0 命中；versionCompat.ts 存在且导出 checkHostInfoCompatible + ProtocolIncompatibleError。
- 复用面（WebSocketTransport / token-stdin / loopback 强制 / FLOW 背压 / O_EXCL|0600 单写者语义）设计合理，无过度设计；「拒绝的更复杂方案」诚实。
- AC-9 节流锚定现状缺口正确（wsServer.ts:195-199 达阈值后每次失败都 emit = 刷屏，属实）。

## 结论

**NEEDS_REVISION**。ARCH-B1（认领回退闭环不可实现/livelock）+ ARCH-B2（兄弟进程误杀）是 PRD 指定 must-resolve（ARCH-11）里的真实架构缺口，须先修；建议以「main 侧认领验证 + configId 入 argv + 版本化 bundle 目录」一并收敛 ARCH-B1/B2/B4。B6（grounding 错误）、B7（R2-N2 CI 闭合）、B8（residency TC 覆盖）为 blueprint 交付前应补齐项。B3/B5/B9/B10 有界可改，B11 仅需 spike 实证。

---

## Round 2 Verify（architect · 2026-07-10）

- verify_scope: 仅复核 ARCH-B1~B11 是否有效消解 + B1/B2 收敛有无残留竞态 + 是否引入新矛盾（不重开全面评审）
- files_read: TECH.md（v0.2 全文 · SSH-1/SSH-4/SSH-5/实现步骤/风险/时序图）、TC.md（v0.2 全文 · tests[] T-001..039 + §2 决策表 + §4/§6）
- **verdict: APPROVE**（残留 3 条 low/low-med · 全非阻塞 · dev 阶段处理）

### 11 findings 逐条核销

| finding | 状态 | 落点核验 |
|---|---|---|
| ARCH-B1 livelock | ✅ 消解 | 认领验证前移 main（SSH-4「认领验证前移 main」段 · probe.ok+hostTag+compatible 才 emit verifying；失败**同栈**走 step4 回收，无 renderer→main 信道）；错误处理表新增「认领探测失败→同栈转回收·不 emit failed·不 livelock」行；T-033 断言 probe 失败转 reap 而非再 claim |
| ARCH-B2 兄弟误杀 | ✅ 消解 | `--host-tag <configId>` 显式 argv（SSH-4 启动命令 + host.ts 解析·仅自证不入闸）；端口文件加 `hostTag` 字段；reap 唯一放行 = cmdline 含【本 configId】`--host-tag`；T-034 断言 `kill` 从不出现于兄弟分支；T-038 断言 host-tag 不入端口闸 |
| ARCH-B3 并发 connect | ✅ 消解 | orchestrator `private inflight = Map<string,Promise>`（SSH-1）+ 错误处理「并发 connect→guard 复用/拒绝」行 + F1 测 |
| ARCH-B4 版本 flap | ✅ 消解 | `bundle/<appVersion>/` 版本隔离 + `.deploying` O_EXCL 锁 + `.tmp-…`→原子 `sftpRename`→`.ready`（SSH-5）；多版本并存杜绝删共享目录；T-039 并发锁测 |
| ARCH-B5 EPIPE 时序 | ✅ 消解（spike 化） | A0 步骤补「token-stdin EOF 时序三点(a/b/c)」+ 退化 `--token-fd`/wrapper；风险表 med 行 |
| ARCH-B6 RemoteHostsPage | ✅ 消解 | 改标「新·从预览工程移植生产 TSX」；复杂度 新增9/改动10；真缺口#6 登记；改动文件清单 `components/settings/RemoteHostsPage.tsx # 新`；H2/H3 拆两步 |
| ARCH-B7 CI 版本偏斜 | ✅ 消解 | release.yml 增 `build-host-bundles` 三架构 matrix（tag 流水线同 commit 现产）+ `build-macos needs` 下载→make；保证 bundle.version==release version；「下载 prior artifact」排除；J1 步骤 |
| ARCH-B8 residency TC | ✅ 消解 | T-032~037 六分支决策表（§2）+ T-038/T-039；T-033/T-034/T-036 为守门可执行断言 |
| ARCH-B9 路径绝对化 | ✅ 消解 | 全程 `${dataDir}/hosts/<id>/host.port`（host env/main sftp/main rm 三处共用绝对常量） |
| ARCH-B10 DI 接缝 | ✅ 消解 | `ConnectSsh` 工厂注入 + `SshConnectionLike` 接口（生产=SshConnection.connect·测试注桩）；`shouldAlert` 纯函数；TC §4「注入 connectSsh 桩·不 mock static」 |
| ARCH-B11 Origin 实证 | ✅ 消解 | 白名单 `{'null','file://'}`+dev 保留 + A0 步骤「抓打包版真实 Origin 值命中白名单」 |

### B1/B2 收敛的残留竞态核查（重点）

**逐场景推演均闭环**：
- **认领到兄弟进程**：probe.hostTag≠configId → probe 失败 → step4 → reap 检 `portRaw.pid` 的 cmdline 不含本 tag → 不 kill，仅清陈旧 → fresh deploy 到**新随机端口**，不碰兄弟。兄弟存活。✅
- **PID 被兄弟复用**（旧进程死、pid 被兄弟占）：reap 基于 `portRaw.pid` + cmdline tag 双验，兄弟 cmdline 含**别的** tag → 不 kill。✅（reap 只认 pid+tag，不认端口，故端口复用也不误伤）
- **storedToken 损坏但进程确为我方**：probe 失败 → step4 → cmdline 含本 tag → reap 自身 → 重部署新 token。确定性恢复，无 livelock。✅
- **两 App 实例并发连同一远程机**：各实例 configId 独立（per-userData nanoid）→ `hosts/<A>/` vs `hosts/<B>/` 端口文件隔离、驻留进程各一；唯一共享态 = `bundle/<appVersion>/`，已由**版本隔离 + `.deploying` O_EXCL 锁 + tmp+原子 rename** 保护（不同版本各取目录互不覆盖；同版本首装靠锁串行）。**并发安全**。✅

**未见新硬矛盾**。protocol.ts 零改承诺仍成立；grounding line 引用未变仍准；main 侧 probe 用 Node-ws 无 Origin 头 → 正好命中「undefined 放行」，与 AC-10 自洽。

### 残留（3 条 · 非阻塞 · dev 阶段处理）

- **R2V-1 · low-med · concurrency-race** — `.deploying` O_EXCL 锁**无陈旧回收**（B4 补丁引入的新面）。若持锁 flow 在「取锁后、写 `.ready` 前」崩溃/断连，`.deploying` 残留且无自愈（sftp 文件不随 SSH 断开清理），后续 flow/实例轮询 `.ready` 恒超时→deployFailed→重试仍 EEXIST = **该 appVersion 首装永久 wedge**（须手动 `rm bundle/<v>/.deploying`）。窗口窄（仅某版本首装），但后果非显然。**建议**：`.deploying` 写入 pid+timestamp，等待方超时后对「age > 部署超时」的陈旧锁 break-and-reacquire（类比端口文件的陈旧 reap），或直接 rm 陈旧锁重试。
- **R2V-2 · low · completeness** — 状态机合法边需**显式补 `claiming→deploying`（及 `claiming→failed`）**：B1 的 main 侧 probe 在 emit `claiming` 后失败 → 同栈转 deploying（reap+重部署），此边 PRD 状态图未列（PRD 只有 connecting→starting 认领 + starting→failed）。T-010 明确测「非法边被拒」，若该 fallback 边未纳入合法集，会与 B1 回退路径**自相矛盾**。**建议**：TECH/reducer 合法转移表登记 claiming→deploying / claiming→failed，T-010 覆盖之。
- **R2V-3 · low · robustness** — 两点收尾：① reap 的 `ident 含 --host-tag <configId>` 宜用**精确 token 匹配**（词界/结尾）而非裸子串——当前 nanoid/uuid 定长下无前缀碰撞（安全），但精确匹配可与 id 方案解耦更稳健；② main 侧 probe 需**有界超时**（复用 10s 握手超时口径）+ 用后 close probe ws，避免探测 hang 拖住 connect() 或残留客户端。

### 结论

11/11 finding 有效消解；ARCH-B1/B2 收敛**真闭环**（回退全在 main 同栈 · reap 双验不误杀兄弟）；两 App 实例并发连同一机**安全**（版本隔离 bundle + O_EXCL 端口文件 + per-config 目录）。3 条残留均为 dev 阶段有界处理项，不阻断进入实现。**APPROVE**。

