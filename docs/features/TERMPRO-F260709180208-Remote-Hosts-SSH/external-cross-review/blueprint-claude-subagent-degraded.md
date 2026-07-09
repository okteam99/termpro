---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "localconfig disable_external_review 缺省/worktree 无配置(单模型 · 异质降级为同模型隔离冷审)"
review_via: subagent
verdict: NEEDS_REVISION
---

# BL-003 Blueprint 隔离冷审（第三视角 · 独立采样）

target: blueprint · feature: TERMPRO-F260709180208-Remote-Hosts-SSH
findings_summary: blocker 0 · high 3 · low 5 · info 1 · total 9

评审方式：独立通读 TECH.md + TC.md 全文，并逐一回真实源码核验被引接缝（token.ts / host.ts /
wsServer.ts / hostClient.ts / main.ts / forge.config.ts / release.yml / host-package.yml /
package-host.mjs / versionCompat.ts）。未参考任何其他角色评审草稿。

结论：**架构骨架成立**（红线守护到位、复用点真实、token 不落远端的四前提经代码核验为真），
但 blueprint 被要求强制拍板的两个 must-resolve（ARCH-11 认领-或-回收、R2-N2 CI 三架构接线）
在**并发正确性**与**发布管线可落地性**两处留有实质缺口，且 UI 工作量被误标。故 NEEDS_REVISION。

---

## Findings

### EXT-1 · high · 全局共享 `bundle/` 无部署锁，并发首次部署 / 混版本会损坏产物或永久互踢
- location: TECH.md SSH-4/SSH-5（`~/.termpro-host/bundle/` 布局 L246、幂等重部署 L824-826「sftp 先删 bundle/ 再全量上传」）
- description: 端口文件的 `O_EXCL` 保护是**按 configId** 的（`hosts/<configId>/host.port`），但 `bundle/` 是**全局单份**、跨所有 config 共享。两个 App 实例（两台机器 / 两用户），或**同一 App 里两个指向同一主机的 config**，若同时命中「无产物」或「版本不符」分支，都会执行「先删 bundle/ 再全量上传」，且彼此无互斥、无原子换入。交错的 delete/upload 会写出半份混合产物；若两端 App 版本不同（v1.2 vs v1.3），会各自把 bundle/ 覆盖成自家版本并因 `bundleVersion!=appVersion` 反复回收对方驻留进程，形成**永久 redeploy+reap 抖动**。同版本稳态不受影响，但首次并发部署与混版本场景真实存在。
- suggestion: 部署做成原子：上传到 `bundle.<appVersion>.<rand>.tmp/` → sftp `rename` 到版本化目录 → 原子切换 `.version`（或 symlink `current`）；或在 `bundle/.deploy.lock` 上用 sftp `O_EXCL` 取部署锁、失败者退避重试/走认领。至少在 TECH 显式声明「同一主机的并发部署互斥策略」，不能默认单写者。

### EXT-2 · high · 回收（step 4）身份核验非进程唯一 → 跨 config 误杀健康的兄弟 host
- location: TECH.md SSH-4 认领/回收算法 L289-291（`ps -o command= -p <pid>` / `/proc/<pid>/cmdline`，判据「ident 含 'host.js' 且含 '--listen 127.0.0.1'」）+ 启动命令 L309
- description: 「双因子（存活 + cmdline 签名）不误杀」只对**无关进程**成立。签名 `host.js` + `--listen 127.0.0.1` 对**任意** TermPro 驻留 host 都命中：`--listen` 端口是 `:0`（不进 cmdline），区分 config 的 `TERMPRO_HOST_PORT_FILE=hosts/<id>/host.port` 走 `env`（在 environ 而非 argv，`ps -o command=` 看不到）。因此若某 config 的**陈旧** host.port 记录的 pid 被复用为、或恰好等于另一 config 的**在世** host 进程 pid，step 4 会 `kill <pid>` 掉一个健康的兄弟 host（认领路径有 token 闸兜底，但**回收路径的 `kill` 先于任何 token 校验**）。这正好击穿「PID 复用不误杀」的核心安全性质。
- suggestion: 让身份核验**进程唯一**：host 把 `configId`（或端口文件绝对路径）写进自身 argv（如 `--host-id <configId>`，随 cmdline 可见），回收前要求 cmdline 同时匹配本 config 的 id；或 kill 前先核验「该 pid 实际监听的端口 == 记录端口」（`lsof -p`/`ss -ltnp`）。签名匹配即 kill 不安全。

### EXT-3 · high · R2-N2 CI 三架构接线只解一半，且提出的机制事实有误
- location: TECH.md SSH-5「CI 接线」L830-833 + 待决策 L1140；.github/workflows/host-package.yml:20-24（触发器）；.github/workflows/release.yml:11-14；scripts/package-host.mjs:15
- description: R2-N2 是 blueprint-must-resolve。运行时**来源**（extraResource 携三架构 + `detectArch` + linux-arm64 降级阀）已定，但把 bundle 喂进 `resources/host-bundles/` 的**发布管线**留成 待决策，且含事实错误：(1) `host-package.yml` 只在 `push:main` / `pull_request` / `workflow_dispatch` 触发，**无 `tags: v*`** —— 打 release tag 时它根本不为该 commit 产出三架构产物；(2) TECH 说「`workflow_run`/`needs` 依赖 host-package job」，但 `needs` **不能**跨 workflow 文件引用 job，跨 workflow 复用 artifact 必须 `workflow_run` + 按 run-id `download-artifact`（或第三方 action），复杂度与所述不同。而 `package-host.mjs:15` 明确「不驱动交叉编译」，macOS-only 的 release.yml **无法**本机产 linux 产物 → artifact 下载路径是**必选而非可选**。故 R2-N2 的「CI 三架构」半边实际未拍板。
- suggestion: 具体定死一种可跑管线，二选一：① 给 host-package.yml 加 `tags: v*` 触发 + release.yml 用 `workflow_run`/`dawidd6/action-download-artifact` 按 run 拉三架构 tar 解到 `resources/host-bundles/<arch>/` 再 `npm run make`；② 把三架构 matrix 并进 release.yml 作上游 job，经 upload/download-artifact 把产物交给 macOS make job。并在 TECH 明确「tag 触发链」与「bundle 缺位 → 降级阀」的 CI 实现位。

### EXT-4 · low · `connect(configId)` 无重入护栏，快速二次触发会双拉起/泄漏进程
- location: TECH.md SSH-1（`RemoteHostOrchestrator` 持 `Map<configId, RemoteHostSession>`，`connect()` 无幂等/互斥说明）L642-648、L766-790
- description: 同一 configId 若并发进入 `connect()`（用户连点「连接」、或事件重放），两条流程都会 `rm host.port` 并 `execDetached` 拉起；host 侧 `O_EXCL` 让后者 EEXIST fail-closed（host.ts 设计的 `wx`），但可能留下一个半启动进程 / 已生成但未认领的 token，且两次 connect 都在改同一 session 态。O_EXCL 兜住了端口文件损坏，兜不住重复 spawn 与状态竞争。
- suggestion: `connect()` 幂等化：`session.stage ∉ {idle, failed, disconnected}` 时直接返回在途 promise（no-op），确保每 configId 同时至多一条编排流程。

### EXT-5 · low · `RemoteHostsPage` 标为「改」但 src/ 中并不存在，UI 为 greenfield，被低估
- location: TECH.md §改动文件清单 L1027-1028（`RemoteHostsPage.tsx  # 改：接线真实 IPC（现为 mock hostRuntime→…）`）+ §前端 L1040 + 复杂度「改动 9」L515；实际：`src/renderer/components/settings/` 目录不存在，全仓 `RemoteHostsPage`/`hostRuntime` 仅见于 `docs/features/.../UI.md` 与设计原型 `docs/design/preview-project/src/main.jsx`
- description: TECH 多处把 RemoteHostsPage 描述为「替换既有 mock hostRuntime 时序驱动」的**增量接线**，并计入「改动 9」。但 `src/renderer/**` 无该组件，mock 只活在设计原型工程与 UI.md 规格里。这是一次**全新组件构建**（紧凑/完整双区、FAIL_REASONS、stepper、runtime 事件订阅），非「接线」小改。误标使复杂度估算与步骤 H2 偏乐观。
- suggestion: 重分类为「新增」，把 UI.md/preview 的设计落成真实 `src/renderer/components/settings/RemoteHostsPage.tsx`，据此修正文件数与工作量。TC 中 `src/renderer/components/__tests__/RemoteHostsPage.test.tsx`（T-003/T-015）作为 TDD 前置无碍，但需知其被测组件尚不存在。

### EXT-6 · low · FailReason / 文案「单一事实来源」跨 main↔renderer 未指定落点
- location: TECH.md §数据结构一致性注 L906 + 待决策 L1139；TC.md T-004（`failClassification.test.ts`「失败五分类与连接共享同一字典·单一事实来源」L461-464）
- description: FailReason 定义在 `orchestrator.ts`（main），renderer 的 `FAIL_REASONS` 文案在 UI 层；renderer 不能从 `main/` import。TECH 自认 UI.md 只列 5 类而 orchestrator 多出 `archUnsupported/deployFailed/startFailed/internal`，并把对齐推给 dev。全 Feature 又约束 `protocol.ts` 零改，故当前没有可被两端共享的字面量落点 —— T-004 的「单一事实来源·不各写字面量」在 main 内可满足（test 与 connect 共用 classifier），但 main↔renderer 仍是双份字面量、易漂移。
- suggestion: 把 `RemoteStage`/`FailReason`（及 reason→label 文案）放进新 `src/shared/remoteHost.ts`（非 protocol.ts，不触碰 HostService 契约），两端 import，机械杜绝漂移；同时把「UI 未列 4 类」的对齐从 待决策 提为 blueprint 内决议。

### EXT-7 · low · AC-9 节流：TECH 内联闭包实现 vs TC T-019 纯函数注入接缝不一致
- location: TECH.md §安全纵深 AC-9 L954-961（`recordAuthFailure` 内联 + 模块级 `let lastAlertAt`）；TC.md T-019「决策函数抽为纯函数单测（注入 now/lastAlertAt）」L261、L428-431；现码 wsServer.ts:191-201
- description: T-019 要求一个可注入时钟的纯决策函数，但 TECH 给的实现仍把逻辑内联在 `recordAuthFailure`、状态用闭包 `authFailures`/`lastAlertAt`，无抽出接缝。照 TECH 现状写不出 T-019 那种注入式单测（跨窗口断言只能真等或 mock 计时器）。TC 自评风险 #2 已点到，但 TECH 代码未反映该接缝。
- suggestion: TECH 显式抽 `shouldEmitAuthAlert(now, lastAlertAt, failuresInWindow): boolean` 纯函数，`recordAuthFailure` 调用它；T-019 单测该纯函数、T-020 集成只验单窗口 ≤1。

### EXT-8 · low · Origin 白名单为断言而非实测（对策已三重兜底，但零校验步骤）
- location: TECH.md §安全纵深 AC-10 L967-974（`ORIGIN_ALLOW = new Set(['null','file://'])` + dev vite origin，无 Origin→放行）；main.ts:305/489（prod 经 `loadFile` → `file://` 装载）；TC.md T-021/T-022
- description: 打包 renderer 经 `loadFile` 装载，源为 `file://`；Chromium/Electron 对 file 源 WS 的 `Origin` 头随版本可能是 `file://` 或 `null`，TECH 三重兜底（`null` / `file://` / 无头放行）覆盖了现实各态 —— 方向正确。但 allowlist 是**假设**出来的、无 A0-spike 实测步骤，而一旦猜错，`socket.destroy()` 会**整功能不可连**（所有远程连接被拒），且 T-022 只测 file://null/无头，猜错时「测试绿、生产红」。
- suggestion: A0 spike（或专测）**实测**打包 renderer 实际发出的 Origin，据实测收敛 allowlist；TECH 注明该值由观测而非假设得来。token 已是主屏障，Origin 只作纵深，宁可放行超集也别自伤可用性。

### EXT-9 · info · setsid+nohup+`< /dev/stdin`+`&` 的 token EOF 交付脆弱（spike 已列，补兜底）
- location: TECH.md SSH-4 不确定点③ L794-796（启动一行）；token.ts:37-45（空 token fail-closed）、token.ts:69/113（`readFileSync(0)`）
- description: 该一行依赖：远端 shell `&` 背景化 setsid 子进程后，ssh2 exec channel 的 stdin 仍是 node 的 fd 0，且 `stream.end()` 的 half-close 能穿过 setsid 继承把 EOF 交到孙进程。`nohup` + `&` + `< /dev/stdin` 交互微妙：若 shell 背景化时提前关闭 channel，`readFileSync(0)` 可能阻塞或拿到过早 EOF → 空 token → host 触 `requireNonEmptyToken` fail-closed 退出。TECH 已列为 spike（风险 med），此处只是强调**必须**在 Linux 与 macOS sshd 双平台实证「注入完成→EOF 到孙进程」，并备好回退。
- suggestion: spike 明确断言跨平台 EOF 交付；准备退路（专用 `--token-fd 3` 独立 channel，或极短命 0600 `--token-file` 用后立即 `unlink`），若 stdin 路径不稳可切换而不阻塞里程碑。

---

## 总评

**可通过的部分（核验为真）**：红线守护成立 —— SSH 编排全在 main、host 侧唯一新增是纯 Node 写端口文件、
`protocol.ts` 零改（新增皆 Electron IPC 壳层）。四个「decisive 前提」经源码核实为真：renderer 沙箱可直连
`ws://127.0.0.1`（hostClient.ts:186-224 已是生产路径）、`--token-stdin` 走 `readFileSync(0)` 读 EOF
（token.ts:111-116）、host 仅 `generated` 源回显 token（host.ts:59-61，stdin 注入恒不回显）、CI 三架构由原生
runner 预编译并实机 verify（host-package.yml:31-37）。复用点（WebSocketTransport / connectViaWebSocket /
versionCompat / startWsServer / copyModuleWithDeps）均真实存在、引用准确。TC↔AC 映射完整（14/14，每 AC ≥2 测），
非成功路径占比 ≥30%，安全类 AC 全落可执行断言。

**必须回炉的部分**：blueprint 被点名强制拍板的两块恰是缺口最深处 —— ARCH-11 的并发正确性（EXT-1 共享 bundle
无锁、EXT-2 回收身份非唯一致跨 config 误杀）和 R2-N2 的发布管线（EXT-3 CI 接线半解 + `needs` 机制事实错误 +
host-package 无 tag 触发）。这三条不是打磨项，是「按现状实现会在真实并发/发布场景出错」。故判 NEEDS_REVISION。

**dev 前最该先解决的 1-2 点**：
1. **EXT-2（回收身份唯一化）** —— 这是最锋利的一条：回收路径 `kill` 先于 token 校验，签名匹配即杀，能误杀健康的
   兄弟 host（同机多 config / PID 复用）。让 host 把 configId 写进自身 argv、回收前按 id + 实际监听端口双验，
   代价小、根除误杀。EXT-1 紧随其后（部署原子化）。
2. **EXT-3（CI 三架构接线拍板）** —— 没有可跑的发布管线，extraResource 依赖的三架构 bundle 根本进不了包，
   整个远程部署路径无从落地。需在 blueprint 就把 tag 触发链与 artifact 下载机制定死（并修正 `needs` 跨 workflow
   的错误认知），而非留作 dev 阶段 待决策。
