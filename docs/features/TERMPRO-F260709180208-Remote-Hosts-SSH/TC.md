---
tc_feature_id: TERMPRO-F260709180208-Remote-Hosts-SSH
tc_version: "0.2"
tc_author: qa
tc_date: "2026-07-10"
# 机读契约:verify-ac.py 解析本 tests[] × PRD.acceptance_criteria 校验覆盖。
# 每条 test:id / file(遵循既有 __tests__ 组织)/ function(test_ACx_… 命名)/
# covers_ac / level(unit|integration|api-e2e|fe-e2e)/ priority。
# v0.2 对齐 TECH Round 2:模块目录 src/main/remote/(非 remoteHosts);connectSsh DI 工厂注入;
#   shouldAlert 纯函数(AC-9);端口文件 {port,pid,hostTag} + 'wx'(O_EXCL) + --host-tag 自证不入闸;
#   residency.ts P0 决策表(ARCH-B8);版本隔离部署 .deploying O_EXCL 锁 + 原子 rename(ARCH-B4)。
tests:
  - id: T-001
    file: src/main/remote/__tests__/hostConfigStore.test.ts
    function: test_AC1_crud_updates_list
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-002
    file: src/main/remote/__tests__/hostConfigStore.test.ts
    function: test_AC1_persists_across_restart
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-003
    file: src/renderer/components/settings/__tests__/RemoteHostsPage.test.tsx
    function: test_AC1_settings_list_live_update
    covers_ac: ["AC-1"]
    level: fe-e2e
    priority: P1
  - id: T-004
    file: src/main/remote/__tests__/failClassification.test.ts
    function: test_AC2_failure_taxonomy_shared_single_source
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-005
    file: src/main/remote/__tests__/orchestrator.test.ts
    function: test_AC2_test_connection_no_deploy
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-006
    file: src/main/remote/__tests__/credentialStore.test.ts
    function: test_AC3_safeStorage_no_plaintext
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-007
    file: src/main/remote/__tests__/credentialStore.test.ts
    function: test_AC3_private_key_path_only_and_no_get_secret_channel
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-008
    file: src/main/remote/__tests__/deploy.test.ts
    function: test_AC4_first_deploy_three_stage_progress
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
  - id: T-009
    file: src/main/remote/__tests__/deploy.test.ts
    function: test_AC4_redeploy_idempotent_version_isolated
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
  - id: T-010
    file: src/main/remote/__tests__/orchestrator.test.ts
    function: test_AC5_state_machine_transitions
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-011
    file: src/main/remote/__tests__/orchestrator.test.ts
    function: test_AC5_state_events_broadcast_ordered
    covers_ac: ["AC-5"]
    level: integration
    priority: P0
  - id: T-012
    file: src/host/__tests__/remoteHandshakeSmoke.integration.test.ts
    function: test_AC6_compatible_ready_protocol_smoke
    covers_ac: ["AC-6"]
    level: api-e2e
    priority: P0
  - id: T-013
    file: src/host/__tests__/remoteHandshakeSmoke.integration.test.ts
    function: test_AC6_incompatible_version_disconnect
    covers_ac: ["AC-6"]
    level: api-e2e
    priority: P0
  - id: T-014
    file: src/main/remote/__tests__/hostConfigStore.test.ts
    function: test_AC7_recent_sorted_reverse_time_relative
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-015
    file: src/renderer/components/settings/__tests__/RemoteHostsPage.test.tsx
    function: test_AC7_recent_area_one_click_connect
    covers_ac: ["AC-7"]
    level: fe-e2e
    priority: P2
  - id: T-016
    file: src/host/__tests__/portFile.test.ts
    function: test_AC8_portfile_wx_o_excl_0600_with_hosttag
    covers_ac: ["AC-8"]
    level: unit
    priority: P1
  - id: T-017
    file: src/host/__tests__/portFile.test.ts
    function: test_AC8_portfile_stale_eexist_fail_closed_no_toctou
    covers_ac: ["AC-8"]
    level: unit
    priority: P1
  - id: T-018
    file: src/main/remote/__tests__/tokenStdinInjection.test.ts
    function: test_AC8_token_stdin_never_persisted_remote
    covers_ac: ["AC-8"]
    level: integration
    priority: P1
  - id: T-019
    file: src/host/__tests__/wsAuthThrottle.test.ts
    function: test_AC9_shouldAlert_pure_function_cross_window
    covers_ac: ["AC-9"]
    level: unit
    priority: P1
  - id: T-020
    file: src/host/__tests__/wsAuthThrottle.test.ts
    function: test_AC9_single_window_emits_at_most_once
    covers_ac: ["AC-9"]
    level: integration
    priority: P1
  - id: T-021
    file: src/host/__tests__/wsOriginGate.test.ts
    function: test_AC10_checkOrigin_allowlist_matrix
    covers_ac: ["AC-10"]
    level: unit
    priority: P2
  - id: T-022
    file: src/host/__tests__/wsOriginGate.test.ts
    function: test_AC10_upgrade_rejects_foreign_origin_allows_file_null
    covers_ac: ["AC-10"]
    level: integration
    priority: P2
  - id: T-023
    file: src/main/remote/__tests__/deploy.test.ts
    function: test_AC11_no_node_aborts_with_guidance
    covers_ac: ["AC-11"]
    level: integration
    priority: P1
  - id: T-024
    file: src/main/remote/__tests__/deploy.test.ts
    function: test_AC11_node18_aborts_no_half_state
    covers_ac: ["AC-11"]
    level: integration
    priority: P1
  - id: T-025
    file: src/main/remote/__tests__/orchestrator.test.ts
    function: test_AC12_retry_after_auth_fail_reaches_ready
    covers_ac: ["AC-12"]
    level: integration
    priority: P0
  - id: T-026
    file: src/main/remote/__tests__/orchestrator.test.ts
    function: test_AC12_manual_reconnect_after_disconnect
    covers_ac: ["AC-12"]
    level: integration
    priority: P0
  - id: T-027
    file: src/main/remote/__tests__/deploy.test.ts
    function: test_AC13_skip_upload_fast_path_observable
    covers_ac: ["AC-13"]
    level: integration
    priority: P1
  - id: T-028
    file: src/main/remote/__tests__/orchestrator.test.ts
    function: test_AC13_claim_residing_process_no_restart
    covers_ac: ["AC-13"]
    level: integration
    priority: P1
  - id: T-029
    file: src/main/remote/__tests__/credentialStore.test.ts
    function: test_AC14_delete_clears_credential_no_orphan
    covers_ac: ["AC-14"]
    level: unit
    priority: P1
  - id: T-030
    file: src/main/remote/__tests__/orchestrator.test.ts
    function: test_AC14_delete_disconnects_active_then_removes
    covers_ac: ["AC-14"]
    level: integration
    priority: P1
  - id: T-031
    file: src/main/remote/__tests__/sshLocalhost.integration.test.ts
    function: test_AC4_ssh_localhost_connect_forward_sftp_roundtrip
    covers_ac: ["AC-4"]
    level: integration
    priority: P2
  - id: T-032
    file: src/main/remote/__tests__/residency.test.ts
    function: test_AC13_residency_claim_hit
    covers_ac: ["AC-13"]
    level: unit
    priority: P0
  - id: T-033
    file: src/main/remote/__tests__/residency.test.ts
    function: test_AC13_residency_stale_token_no_livelock
    covers_ac: ["AC-13"]
    level: unit
    priority: P0
  - id: T-034
    file: src/main/remote/__tests__/residency.test.ts
    function: test_AC13_residency_sibling_never_killed
    covers_ac: ["AC-13"]
    level: unit
    priority: P0
  - id: T-035
    file: src/main/remote/__tests__/residency.test.ts
    function: test_AC4_residency_reap_matching_tag_then_deploy
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: T-036
    file: src/main/remote/__tests__/residency.test.ts
    function: test_AC8_residency_dead_pid_clean_stale_only
    covers_ac: ["AC-8"]
    level: unit
    priority: P0
  - id: T-037
    file: src/main/remote/__tests__/residency.test.ts
    function: test_AC4_residency_no_bundle_fresh_deploy
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: T-038
    file: src/host/__tests__/portFile.test.ts
    function: test_AC8_host_tag_self_attestation_not_in_gate
    covers_ac: ["AC-8"]
    level: unit
    priority: P1
  - id: T-039
    file: src/main/remote/__tests__/deploy.test.ts
    function: test_AC4_concurrent_deploy_lock_o_excl_wait_ready
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
---

# TC · 远程机管理与 SSH 连接编排（BL-003 · TERMPRO-F260709180208-Remote-Hosts-SSH）

> 覆盖 PRD AC-1..AC-14。测试框架 = vitest（照既有 `src/**/__tests__` 组织、`describe('AC-N …')` 分组、
> `it('T-NNN …')` 命名）。命令：`npm test`（`vitest run`）；集成测 `testTimeout=20s`（vitest.config.ts 已放宽）。
> 安全类 AC（AC-3 / AC-8 / AC-9 / AC-10）全部落**可执行断言**，无「人工检查」项。
>
> **v0.2 已对齐 TECH Round 2**（$WT/docs/features/…/TECH.md）：
> - 模块目录 = `src/main/remote/`（TECH §改动文件清单：`orchestrator.ts` / `ssh.ts` / `credentialStore.ts` /
>   `hostBundle.ts` / `residency.ts` / `probeHostInfo.ts` / `remoteHostIpc.ts`）；host 侧改 `host.ts` / `wsServer.ts`；
>   跨层枚举/文案单源 = `src/shared/remoteHost.ts`（EXT-6）。
> - **DI 接缝（ARCH-B10）**：orchestrator 构造注入 `connectSsh:(opts)=>Promise<SshConnectionLike>` 工厂；
>   所有 orchestrator/deploy 集成测**注入桩 connectSsh**（覆盖 exec/execDetached/sftp*/forwardOut），**不 mock static**。
> - **residency.ts P0 决策表（ARCH-B8）**：认领-或-确定性回收为纯决策函数，T-032..T-037 穷举六分支。
> - `hostConfigStore` 为提议命名——配置数组（`remote-hosts.json`）读写在 TECH 中与 `credentialStore`/`remoteHostIpc`
>   同域，blueprint 可折叠；测试文件名可微调，`__tests__` 组织与命名节奏不变。

## 1. 覆盖矩阵（人读视图）

| AC | 优先级 | 类别 | 测试 | 层级 | 关键断言（一句话） |
|----|--------|------|------|------|--------------------|
| AC-1 | P0 | functional | T-001 / T-002 / T-003 | unit×2 + fe-e2e | CRUD 改列表；持久化跨重启；Settings 列表实时更新 |
| AC-2 | P0 | functional | T-004 / T-005 | unit + integration | 失败分类从 `shared/remoteHost.ts` 单源派生；测试连接=认证+可达**不部署**（注入 connectSsh 桩） |
| AC-3 | P0 | security | T-006 / T-007 | unit×2 | safeStorage 密文≠明文·磁盘零明文；私钥仅存路径·无 get-secret 通道 |
| AC-4 | P0 | functional | T-008 / T-009 / T-031 / T-035 / T-037 / T-039 | integration×3 + unit×3 | 三段进度有序；版本隔离幂等覆盖；ssh localhost 兜底；reap→部署；无 bundle→部署；并发 .deploying O_EXCL 锁 |
| AC-5 | P0 | functional | T-010 / T-011 | unit + integration | 状态机全转移合法；状态事件有序广播可订阅 |
| AC-6 | P0 | functional | T-012 / T-013 | api-e2e×2 | 兼容→ready+协议冒烟；不兼容→failed(incompatible)+断开（main 前移探测 + renderer 二次确认共享 checkHostInfoCompatible） |
| AC-7 | P1 | functional | T-014 / T-015 | unit + fe-e2e | 最近区按 lastUsed 倒序+相对时间；一键连接 |
| AC-8 | P1 | security | T-016 / T-017 / T-018 / T-036 / T-038 | unit×4 + integration | 端口文件 'wx'(O_EXCL)\|0600 含 {port,pid,hostTag}；陈旧 EEXIST fail-closed 无 TOCTOU；token-stdin 零落盘/零日志；死 pid 仅清陈旧；--host-tag 自证不入闸 |
| AC-9 | P1 | security | T-019 / T-020 | unit + integration | `shouldAlert` 纯函数跨窗口；真 ws 单窗口 emit≤1 |
| AC-10 | P2 | security | T-021 / T-022 | unit + integration | `checkOrigin` 白名单矩阵；异源拒绝·file://null/无头放行 |
| AC-11 | P1 | functional | T-023 / T-024 | integration×2 | 无 node / node18 皆中止+引导·无半成品（exec 桩） |
| AC-12 | P0 | functional | T-025 / T-026 | integration×2 | 认证失败改配置后重试至 ready；断开后手动重连至 ready |
| AC-13 | P1 | functional | T-027 / T-028 / T-032 / T-033 / T-034 | integration×2 + unit×3 | 快路径跳过上传可观测；认领驻留进程不重启；residency 认领命中 / token 陈旧不 livelock / 兄弟永不误杀 |
| AC-14 | P1 | functional | T-029 / T-030 | unit + integration | 删机随删清凭据无孤儿密文；活跃连接先 best-effort 断开 |

分层统计：**unit 20 · integration 15 · api-e2e 2 · fe-e2e 2 · 合计 39**。安全断言集中在 AC-3×2 / AC-8×5 / AC-9×2 / AC-10×2 + residency 守门断言（T-033/T-034/T-036），全可执行。

## 2. residency.ts 决策表（🔴 P0 · ARCH-B8 最高风险处）

`residency.ts` 为**纯决策函数**（`connectSsh` 注入 · TECH SSH-4）。输入组合喂
`{ portRaw:{port,pid,hostTag}|null, storedToken, bundleReady, probeResult, killAliveResult, cmdlineResult }`，
断言输出决策 ∈ `{ claim, reap+deploy, cleanStaleOnly+deploy, freshDeploy }`。六分支穷举：

| # | test | 输入要点 | 期望决策 | 守门性质 |
|---|------|---------|---------|---------|
| T-032 | claim 命中 | portRaw 有效 + storedToken 非空 + bundleReady + probe.ok + probe.hostTag==configId + compatible | **claim** | AC-13 认领快路径 |
| T-033 | token 陈旧不 livelock | 同上但 probe 失败（token 不符 / hostTag 不符 / 不兼容） | **reap+deploy**（同栈回收，非反复 claim） | 🔴 消 ARCH-B1 livelock |
| T-034 | 兄弟永不误杀 | portRaw.pid **存活** 但 cmdline **不含**本 configId 的 `--host-tag`（含别 tag / 无 tag） | **cleanStaleOnly+deploy**（绝不 kill） | 🔴 消 ARCH-B2 兄弟误杀 |
| T-035 | reap 放行 | alive==Y 且 cmdline 含 `--host-tag <本configId>` | **reap+deploy**（kill→部署） | 确定性回收 |
| T-036 | pid 已死 | portRaw.pid 存在但 kill -0 失败（进程已退） | **cleanStaleOnly+deploy**（仅清陈旧端口文件·不 kill） | AC-8 陈旧清理 |
| T-037 | 无 bundle | bundleReady=false（无论端口文件如何） | **freshDeploy**（部署分支） | AC-4 首装 |

> 断言手段：residency 决策函数返回结构化决策对象（含 `action` + 是否 `kill` + 是否 `cleanStale`），
> 桩注入 `cmdlineResult`（模拟 darwin `ps -o command=` / linux `/proc/<pid>/cmdline` 输出）、`killAliveResult`（`kill -0`）、
> `probeResult`（main 侧 Node-ws host.info 前移探测结果）。**关键**：T-034 断言 `kill` **从未**出现在决策里（只 `cleanStale`），
> T-033 断言 probe 失败后决策转 reap/deploy 而非再次 claim（无 renderer→main 回馈信道 · 全 main 同栈）。

## 3. 安全类 AC 的测试手段（可执行·非人工检查）

| AC | 被测接缝（对齐 TECH） | 手段 | 关键断言 |
|----|----------------------|------|----------|
| AC-3 safeStorage | `src/main/remote/credentialStore.ts` 依赖 `electron.safeStorage`；两文件 `remote-hosts.json`(明文配置) + `remote-hosts.secrets.json`(密文) | `vi.mock('electron')` 注入桩 `safeStorage`（`isEncryptionAvailable→true`、`encryptString`/`decryptString` 可逆桩带前缀标记）；持久化写临时 `userData`（`os.tmpdir()`） | secrets 文件字节不含任何明文子串（密码/passphrase）；`getSecret` 经 decrypt 回原文；私钥字段存路径非内容；IPC 面无 get-secret 通道（结构断言：preload 只暴露 list/save/delete/test/connect/disconnect/onEvent）；`isAvailable()=false` → setSecret 抛错·不明文落盘 |
| AC-8 token-stdin | `token.ts::resolveToken('--token-stdin')`（已存）+ `host.ts` 端口文件写（新）+ orchestrator `execDetached` 注入 | 端口文件用临时目录（`fs.mkdtempSync`）实测 `openSync(portFile,'wx',0o600)`；TOCTOU 用「先建同名文件 → 'wx' openSync 抛 EEXIST」；token 非持久化用 spy 捕获 `execDetached` 命令 + stdin 内容 + 扫描模拟远端 `${dataDir}` 落盘文件/host.log | 端口文件 `mode&0o777===0o600`、内容 `{port,pid,hostTag}`；已存在文件 'wx' 抛 EEXIST（host fail-closed exit 1·证无覆盖窗口）；`--host-tag` 仅写入端口文件/日志、**不进** token 端口闸（T-038：喂错 token+对的 host-tag 仍拒连）；启动命令 argv 含 `--token-stdin --host-tag <id>` 且不含 `--token <明文>`；token 明文不出现在任何 `${dataDir}` 文件/host.log；main 侧 `hosttoken:<id>` 密文留存不算泄露（ADR-001 合规） |
| AC-9 节流 | `wsServer.ts::shouldAlert(now,lastAlertAt,countInWindow,threshold,cooldownMs)` 纯函数（EXT-7 新抽）+ `recordAuthFailure` 闭包 | 纯函数直接单测（注入时钟组合，无 IO）；集成用 `startTestHost({onAuthAlert})` 突发 ≥ 阈值次错误 token 连接 | 纯函数：`count>=threshold && now-lastAlertAt>=cooldownMs` → true，否则 false；同窗内二次调用（now-lastAlertAt<cooldownMs）→ false；跨窗口（≥cooldownMs）→ true（证节流非静音）。集成：单窗口 `onAuthAlert` emit **≤1**（现状每次超阈值都 emit=刷屏 → 本测捕获回归）；阈值后合法连接仍成功（不阻断） |
| AC-10 Origin | `wsServer.ts` upgrade（verifyToken 通过后追加 `checkOrigin`）+ `startWsServer({allowedOrigins})` | `checkOrigin(origin, allowlist)` 纯函数矩阵单测；集成用 `ws` 客户端 `{ origin }` 选项发真实 Origin 头 | 异源（`http://evil.com`）→ upgrade 拒绝、`waitOpen` 失败；`file://`、`null`、**无 Origin 头**（origin===undefined）、dev vite origin → 放行不误杀、握手可完成；Origin 合法但 token 错 → 仍拒（token 为主屏障，Origin 为纵深） |

## 4. 集成测试策略（DI 桩 × 真机 ssh × loopback 降级）

- **DI 桩为默认（ARCH-B10）**：AC-2/4/5/11/12/13/14 的编排/部署集成测通过**注入 `connectSsh` 工厂桩**跑——
  桩返回实现 `SshConnectionLike`（`exec`/`execDetached`/`sftpReadFile`/`sftpWriteDir`/`sftpRename`/`forwardOut`/`close`）的对象，
  确定性、不触网、不需凭据、**不 mock static 方法**。失败分支（不可达/认证/超时/无 node/node18/版本不兼容/上传失败/启动失败）
  由桩返回受控结果模拟，**不依赖真实无 node 机器**（遵 PRD-REVIEW QA-3）。
- **ssh localhost 兜底（T-031）**：探测本机 sshd 可达（`ssh -o BatchMode=yes -o ConnectTimeout=2 localhost true`）。
  可达 → 用真实 `SshConnection.connect('localhost')` 实做 connect + `forwardOut` + `sftp` 往返，验证打包环境三能力
  （对应 TECH A0 spike 的自动化回归）。**不可达 → `it.skip` 并在 skip 原因注明**「no local sshd; 编排逻辑已由 DI 桩集成测
  T-005/T-008/… 覆盖」（如实标注，不伪绿）。
- **host ws 集成（T-012/013/020/022）**：复用既有 `src/host/__tests__/wsTestHarness.ts`（真实 ws server + 真实 hostCore），
  loopback 上跑，无需 ssh——host.info 握手 / 告警节流 / Origin 校验都在 ws 传输层，可脱离 SSH 独立验证。
- **AC-6 双探测同源**：main 侧前移探测（`probeHostInfo.ts` · Node-ws）与 renderer 二次确认都复用 shared 纯函数
  `checkHostInfoCompatible`（已有单测）；T-012/T-013 在 ws 层验证该判定的兼容/不兼容两态，覆盖两处调用点的共同契约。
- **AC-11 exec 桩 / PATH shim**：主路径 = 注入 `exec` 桩令 `node -v` 返回「command not found」(无 node) 与 `v18.19.0`(node18)
  两态；ssh localhost 可用时可选加强 = PATH shim（临时目录放假 `node` 脚本前置 PATH）在真 exec 通道复现降版态。
- **residency（T-032..037）**：纯决策函数，无需 ws/ssh，注入组合即断言（见 §2）。

## 5. 关键 BDD 场景（Given / When / Then）

### 5.1 连接生命周期全状态流转（AC-5 · T-010 / T-011）

```gherkin
Scenario: 首次连接走全链路到 ready（状态机合法转移）
  Given 一台配置 id=vps-hk 的远程机、无既有 host 产物、注入 connectSsh 桩
  When 用户点「连接」，编排器依次推进
  Then 状态严格按 idle→connecting→deploying→starting→verifying→ready 转移
  And 非法边（如 idle→ready、deploying→ready）被状态机拒绝
  And 订阅方（模拟 BL-004 Sidebar 经 orchestrator.onEvent）按序收到同一串状态事件，无乱序/跳段/重复 ready

Scenario: 认领驻留进程走快链路（跳过 deploying）
  Given 远端已部署同版本产物 + 驻留进程在 + storedToken 有效
  When 连接
  Then 状态走 connecting→claiming→verifying→ready（无 deploying 段·fastPath=true）
```

### 5.2 首次部署三段进度 + 版本隔离幂等 + 并发锁（AC-4 · T-008 / T-009 / T-031 / T-035 / T-037 / T-039）

```gherkin
Scenario: 三段进度可视且有序（T-008）
  Given 远端可达、node≥20、无产物、uname=darwin-arm64、注入 connectSsh 桩
  When 首次连接
  Then 编排器探测架构=darwin-arm64 并选取 resources/host-bundles/darwin-arm64/ bundle
  And 依次 emit 进度 [upload(percent), start, handshake]（三段·顺序固定）
  And sftpWriteDir 目标与探测架构一致；sftp 回读 host.port 得端口 → 隧道 → 握手 → ready

Scenario: 版本隔离重部署幂等（T-009）
  Given 远端已存在旧版本 bundle/<oldVer>/
  When 以 appVersion=<newVer> 重连触发部署
  Then 上传进 bundle/.tmp-<newVer>-<rand>/ → 原子 rename → bundle/<newVer>/ → 写 .ready
  And 旧 bundle/<oldVer>/ 不被删（多版本并存·杜绝跨实例 flap）；再次以同版本部署走 skip（幂等）

Scenario: 并发首装取 .deploying O_EXCL 锁（T-039 · 可 mock sftp）
  Given 两个 flow 并发首装同一 bundle/<ver>/、mock sftp 建模 O_EXCL
  When flow-A openSync('bundle/<ver>/.deploying','wx') 成功、flow-B 得 EEXIST
  Then flow-B 不重复上传，轮询等 .ready 出现后复用（超时→deployFailed）
  And 最终该版本只被写入一次（无双写覆盖）

Scenario: reap 后部署 / 无 bundle 首装（residency T-035 / T-037）
  Given 存活且 cmdline 匹配本 --host-tag 的旧进程（T-035）/ bundleReady=false（T-037）
  When residency 决策
  Then T-035 → reap+deploy（kill 后走部署）；T-037 → freshDeploy

Scenario: ssh localhost 真机兜底（T-031，可达时）
  Given 本机 sshd 可达
  When 对 localhost 实做 connect+forwardOut+sftp 往返
  Then 三能力均成功；不可达则 it.skip 并注明原因
```

### 5.3 失败五分类 + 重试至 ready（AC-11 / AC-6 / AC-12 · T-023 / T-024 / T-013 / T-025 / T-026）

```gherkin
Scenario Outline: 失败分类口径统一（reason 取自 shared/remoteHost.ts 单源）
  Given connectSsh 桩被配置为 <inject>
  When 连接
  Then 状态落 failed 且 reason=<reason>，文案取自 shared FAIL_REASONS[<reason>]
  And 不留半成品（无残留隧道/进程/半传产物；deploying 前失败则 sftpWriteDir 从未调用）

  Examples:
    | inject                          | reason          |
    | connect ECONNREFUSED            | unreachable     |
    | auth All methods failed         | auth            |
    | connect readyTimeout 10s        | timeout         |
    | node -v command not found       | nodeMissing     |  # AC-11 · T-023
    | node -v v18.19.0                | nodeMissing     |  # AC-11 · T-024（node<20 · 同引导口径）
    | detectArch → null               | archUnsupported |
    | host.info 版本不兼容             | incompatible    |  # AC-6 · T-013（verifying 主动断开）

Scenario: 认证失败改配置后重试至 ready（AC-12 · T-025）
  Given 首次连接因错密码 failed(auth)
  When 用户改正凭据后点「重试」
  Then failed→connecting 重入，走完整链路至 ready

Scenario: ready 后断开 → 手动重连至 ready（AC-12 · T-026）
  Given ready 后隧道 error/close → disconnected
  When 用户点「重连」
  Then disconnected→connecting 重建连接成功至 ready（自动重连归 BL-005，本测只验手动）
```

### 5.4 快路径跳过上传 + 认领驻留进程 + residency 守门（AC-13 · T-027 / T-028 / T-032 / T-033 / T-034）

```gherkin
Scenario: 同版本 → 跳过上传（可观测·T-027）
  Given 远端已部署 bundle/<appVersion>/.ready 存在
  When 再次连接
  Then 进度事件不含 upload 段；日志出现可观测 skip 标记（如 "[deploy] skip: bundle/<v>/.ready present"）
  And sftpWriteDir 从未被调用

Scenario: 驻留进程在 → 认领不重启（T-028 · 编排层端到端）
  Given 远端驻留 host 进程存活、host.port 有效、storedToken 认领可用
  When 连接
  Then main 前移探测 host.info(storedToken) 通过 → 走认领分支，不 execDetached 新进程
  And 启动命令从未被调用；remotePid 不变

Scenario: residency 决策守门（纯函数·T-032/033/034）
  Given 见 §2 决策表六分支输入组合
  Then T-032 claim 命中；T-033 token 陈旧 → 同栈 reap+deploy（无 livelock）；
       T-034 兄弟存活但 tag 不符 → cleanStaleOnly+deploy（决策中 kill 从未出现）
```

### 5.5 凭据 safeStorage 加解密 + 零明文 + 随删清凭据（AC-3 · AC-14 · T-006 / T-007 / T-029 / T-030）

```gherkin
Scenario: 密码/passphrase 经 safeStorage 加密·磁盘零明文（AC-3 · T-006）
  Given safeStorage 桩可用（vi.mock('electron')）
  When 保存含密码 "hunter2-secret" 与 passphrase "pp-secret" 的机器配置
  Then remote-hosts.secrets.json 字节中不含 "hunter2-secret" / "pp-secret" 任一明文子串
  And encryptString 被调用（密文≠明文）；getSecret 经 decryptString 解回原文（往返一致）

Scenario: 私钥仅存路径·无 get-secret 通道（AC-3 · T-007）
  Given 认证方式=key、privateKeyPath="~/.ssh/id_ed25519"、私钥文件内容含 "PRIVATE KEY"
  When 保存并读取配置
  Then remote-hosts.json 存的是路径字符串，**不含**私钥文件内容
  And IPC 面（preload）无任何读回密码/passphrase 的 get-secret 通道（结构断言）

Scenario: 删机随删必清凭据（AC-14 · T-029）
  Given 机器 id=m1 已存 cred:m1:password + hosttoken:m1 密文
  When 删除 m1（deleteAllForConfig）
  Then getSecret('cred:m1:password')/getSecret('hosttoken:m1') 均 null
  And secrets 文件中 m1 相关密文条目全移除（无孤儿密文）

Scenario: 活跃连接先 best-effort 断开再删（AC-14 · T-030）
  Given m1 处于 ready（活跃连接）
  When 删除 m1
  Then 先调用 disconnect(m1)（best-effort，断开失败不阻断删除）
  And 随后凭据与配置均被清除
```

### 5.6 token-stdin 不落盘 + 端口文件 O_EXCL 无 TOCTOU + --host-tag 不入闸（AC-8 · T-016 / T-017 / T-018 / T-036 / T-038）

```gherkin
Scenario: 端口文件 'wx'(O_CREAT|O_EXCL)|0600 含 {port,pid,hostTag}（T-016）
  Given 临时数据目录（fs.mkdtempSync）、env TERMPRO_HOST_PORT_FILE 指向其内 host.port
  When host 侧 listening 后写端口文件
  Then 文件以 openSync(path,'wx',0o600) 创建、mode&0o777===0o600
  And 内容为 {port, pid, hostTag}（可被 main sftp 回读解析）

Scenario: 陈旧文件 EEXIST fail-closed·无覆盖窗口（T-017）
  Given host.port 已存在（模拟崩溃残留 / 并发第二进程）
  When host openSync(path,'wx',…)
  Then 抛 EEXIST → host console.error + process.exit(1)（fail-closed·不静默覆盖·无 TOCTOU）

Scenario: 死 pid 仅清陈旧不 kill（residency T-036）
  Given host.port.pid 存在但进程已退（kill -0 失败）
  When residency 决策
  Then cleanStaleOnly+deploy（rm 陈旧 host.port·不 kill 任何 pid）

Scenario: --host-tag 自证不入端口闸（T-038）
  Given host 以 --token-stdin <T> --host-tag <id> 启动
  When 客户端以正确 host-tag 但错误 token 连接
  Then 仍被端口闸拒（--host-tag 仅写端口文件/日志·不参与 verifyToken）

Scenario: token 经 --token-stdin 注入·零落盘零日志（T-018）
  Given 编排器 execDetached 写 token→stdin→half-close（loopback 模拟）
  When 启动远端 host
  Then 启动命令 argv 含 "--token-stdin" "--host-tag <id>" 且不含 "--token <明文>"
  And 扫描 ${dataDir} 内所有文件 + host.log：均不含 token 明文
  And （对照）main 侧 hosttoken:<id> 加密留存·合规（非泄露·ADR-001）
```

### 5.7 告警节流 + Origin 白名单不误杀（AC-9 · AC-10 · T-019 / T-020 / T-021 / T-022）

```gherkin
Scenario: shouldAlert 纯函数跨窗口（AC-9 · T-019）
  Given 纯函数 shouldAlert(now,lastAlertAt,countInWindow,threshold=10,cooldownMs=60000)
  Then count<threshold → false（未达阈值）
  And count>=threshold 且 now-lastAlertAt>=cooldownMs → true（首次/新窗口告警）
  And count>=threshold 且 now-lastAlertAt<cooldownMs → false（同窗口节流）

Scenario: 真 ws 突发单窗口 emit≤1（AC-9 · T-020）
  Given standalone host 期望 token="right"
  When 同一窗口内发起 20 次错误 token 连接
  Then onAuthAlert 在该窗口内 emit **≤1**（现状每次超阈值都 emit → 本测捕获为回归）
  And 阈值后合法连接仍成功（节流是告警频率控制·非阻断）

Scenario Outline: checkOrigin 白名单矩阵（AC-10 · T-021）
  Given allowlist = { "null", "file://", dev vite origin }
  When checkOrigin(<origin>, allowlist)
  Then 结果 = <allow>
  Examples:
    | origin                            | allow |
    | (undefined · 无 Origin 头)         | true  |
    | file://                           | true  |
    | null                              | true  |
    | http://localhost:5173 (dev vite)  | true  |
    | http://evil.com                   | false |

Scenario: 真实 upgrade Origin 强制（AC-10 · T-022）
  Given 真实 ws host（wsTestHarness · allowedOrigins 注入）
  When 客户端带 Origin: http://evil.com + 正确 token 发起 upgrade
  Then 连接被拒（socket destroy·waitOpen 失败）
  And 带 file:// / 无 Origin 头 + 正确 token → 放行·可完成握手
  And Origin 合法但 token 错 → 仍拒（token 主屏障·Origin 纵深）
```

### 5.8 测试连接=认证+可达不部署 · 失败口径与连接统一（AC-2 · T-004 / T-005）

```gherkin
Scenario: 测试连接只探认证+可达·不部署不拉起（T-005）
  Given connectSsh 桩：认证通过 + 可达
  When 点「测试连接」（remoteHost:test）
  Then 返回 { ok:true }；且 sftpWriteDir/execDetached/probe spy **均未被调用**（不部署不拉起）

Scenario: 测试连接失败与连接失败共享 shared 单源分类（T-004）
  Given 同一组失败注入（unreachable/auth/timeout）
  When 分别经 test() 与 connect() 路径分类
  Then 两路径产出同一 shared/remoteHost.ts FailReason key + 文案（不各写字面量·EXT-6）
```

## 6. 落地风险自评（最难的 3 条）

1. **residency 决策表的穷举保真（ARCH-B8 · 最高风险）**：难在两条安全守门断言的**真实性**——T-034「兄弟永不误杀」要求桩注入的
   `cmdlineResult` 忠实建模 darwin `ps -o command=` 与 linux `/proc/<pid>/cmdline`（`\0` 分隔）两种真实输出格式，且断言
   决策中 `kill` **从不出现**；T-033「token 陈旧不 livelock」要证 probe 失败后**同栈**转 reap 而非再 claim（无 renderer→main 信道）。
   桩建模若与真实 exec 输出漂移，单测全绿但真机误杀/livelock。缓解：T-031 ssh localhost 往返里对真实 `ps`/`/proc` 输出取一次快照做锚点。
2. **T-018 token 零落盘/零日志的「证否」**：要断言 token 明文**不出现在任意**远端落盘文件与 host.log，需在 loopback 模拟中真实产生
   `${dataDir}` 数据目录与日志文件再全量扫描；且要与「main 侧 `hosttoken:<id>` 加密留存合规」区分不误判为泄露。依赖 blueprint 把
   host 数据目录/日志路径做成可注入（TECH 已定 `TERMPRO_HOST_DATA_DIR`/`TERMPRO_HOST_PORT_FILE` env 注入，可用），否则只能测 argv 契约。
3. **T-008/T-009/T-039 版本隔离部署锁的 sftp 桩保真**：桩要建模 `.deploying` O_EXCL 锁（EEXIST 语义）+ `.tmp-<ver>-<rand>` 临时目录
   + 原子 `sftpRename` + `.ready` 标记 + 并发两 flow 竞争，且顺序/幂等可断言。桩太粗测成「桩测桩」、太细与真实 ssh2 sftp 漂移；
   需 blueprint 先定 `SshConnectionLike` 的 sftp 语义边界，T-031 真机往返作「桩不失真」锚点。

## 7. 验证记录

`python3 ~/.claude/skills/teamwork/templates/verify-ac.py $WT/docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH`
→ 见回复正文（14/14 AC 全覆盖 · 39 test）。
