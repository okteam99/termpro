---
tc_feature_id: TERMPRO-F260709180208-Remote-Hosts-SSH
tc_version: "0.1"
tc_author: qa
tc_date: "2026-07-10"
# 机读契约:verify-ac.py 解析本 tests[] × PRD.acceptance_criteria 校验覆盖。
# 每条 test:id / file(遵循既有 __tests__ 组织)/ function(test_ACx_… 命名)/
# covers_ac / level(unit|integration|api-e2e|fe-e2e)/ priority。
# 模块路径为提议(blueprint/TECH 可微调命名),但目录组织严格照既有 src/**/__tests__ 约定。
tests:
  - id: T-001
    file: src/main/remoteHosts/__tests__/hostConfigStore.test.ts
    function: test_AC1_crud_updates_list
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-002
    file: src/main/remoteHosts/__tests__/hostConfigStore.test.ts
    function: test_AC1_persists_across_restart
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-003
    file: src/renderer/components/__tests__/RemoteHostsPage.test.tsx
    function: test_AC1_settings_list_live_update
    covers_ac: ["AC-1"]
    level: fe-e2e
    priority: P1
  - id: T-004
    file: src/main/remoteHosts/__tests__/failClassification.test.ts
    function: test_AC2_failure_taxonomy_shared
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-005
    file: src/main/remoteHosts/__tests__/connectionOrchestrator.test.ts
    function: test_AC2_test_connection_no_deploy
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-006
    file: src/main/remoteHosts/__tests__/credentialStore.test.ts
    function: test_AC3_safeStorage_no_plaintext
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-007
    file: src/main/remoteHosts/__tests__/credentialStore.test.ts
    function: test_AC3_private_key_path_only_and_not_in_renderer
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-008
    file: src/main/remoteHosts/__tests__/deployService.test.ts
    function: test_AC4_first_deploy_three_stage_progress
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
  - id: T-009
    file: src/main/remoteHosts/__tests__/deployService.test.ts
    function: test_AC4_redeploy_idempotent_overwrite
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
  - id: T-010
    file: src/main/remoteHosts/__tests__/connectionState.test.ts
    function: test_AC5_state_machine_transitions
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-011
    file: src/main/remoteHosts/__tests__/connectionEvents.test.ts
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
    file: src/main/remoteHosts/__tests__/recentHosts.test.ts
    function: test_AC7_recent_sorted_reverse_time_relative
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-015
    file: src/renderer/components/__tests__/RemoteHostsPage.test.tsx
    function: test_AC7_recent_area_one_click_connect
    covers_ac: ["AC-7"]
    level: fe-e2e
    priority: P2
  - id: T-016
    file: src/host/__tests__/portFile.test.ts
    function: test_AC8_portfile_o_excl_0600_mode
    covers_ac: ["AC-8"]
    level: unit
    priority: P1
  - id: T-017
    file: src/host/__tests__/portFile.test.ts
    function: test_AC8_portfile_stale_cleanup_no_toctou
    covers_ac: ["AC-8"]
    level: unit
    priority: P1
  - id: T-018
    file: src/main/remoteHosts/__tests__/tokenStdinInjection.test.ts
    function: test_AC8_token_stdin_never_persisted
    covers_ac: ["AC-8"]
    level: integration
    priority: P1
  - id: T-019
    file: src/host/__tests__/wsAuthThrottle.test.ts
    function: test_AC9_alert_throttle_decision
    covers_ac: ["AC-9"]
    level: unit
    priority: P1
  - id: T-020
    file: src/host/__tests__/wsAuthThrottle.test.ts
    function: test_AC9_burst_emits_single_alert_per_window
    covers_ac: ["AC-9"]
    level: integration
    priority: P1
  - id: T-021
    file: src/host/__tests__/wsOriginGate.test.ts
    function: test_AC10_origin_allowlist_matrix
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
    file: src/main/remoteHosts/__tests__/deployService.test.ts
    function: test_AC11_no_node_aborts_with_guidance
    covers_ac: ["AC-11"]
    level: integration
    priority: P1
  - id: T-024
    file: src/main/remoteHosts/__tests__/deployService.test.ts
    function: test_AC11_node18_aborts_no_half_state
    covers_ac: ["AC-11"]
    level: integration
    priority: P1
  - id: T-025
    file: src/main/remoteHosts/__tests__/connectionOrchestrator.test.ts
    function: test_AC12_retry_after_auth_fail_reaches_ready
    covers_ac: ["AC-12"]
    level: integration
    priority: P0
  - id: T-026
    file: src/main/remoteHosts/__tests__/connectionOrchestrator.test.ts
    function: test_AC12_manual_reconnect_after_disconnect
    covers_ac: ["AC-12"]
    level: integration
    priority: P0
  - id: T-027
    file: src/main/remoteHosts/__tests__/deployService.test.ts
    function: test_AC13_skip_upload_fast_path_observable
    covers_ac: ["AC-13"]
    level: integration
    priority: P1
  - id: T-028
    file: src/main/remoteHosts/__tests__/connectionOrchestrator.test.ts
    function: test_AC13_claim_residing_process_no_restart
    covers_ac: ["AC-13"]
    level: integration
    priority: P1
  - id: T-029
    file: src/main/remoteHosts/__tests__/credentialStore.test.ts
    function: test_AC14_delete_clears_credential_no_orphan
    covers_ac: ["AC-14"]
    level: unit
    priority: P1
  - id: T-030
    file: src/main/remoteHosts/__tests__/connectionOrchestrator.test.ts
    function: test_AC14_delete_disconnects_active_then_removes
    covers_ac: ["AC-14"]
    level: integration
    priority: P1
  - id: T-031
    file: src/main/remoteHosts/__tests__/deployService.integration.test.ts
    function: test_AC4_ssh_localhost_connect_forward_sftp_roundtrip
    covers_ac: ["AC-4"]
    level: integration
    priority: P2
---

# TC · 远程机管理与 SSH 连接编排（BL-003 · TERMPRO-F260709180208-Remote-Hosts-SSH）

> 覆盖 PRD AC-1..AC-14。测试框架 = vitest（照既有 `src/**/__tests__` 组织、`describe('AC-N …')` 分组、
> `it('T-NNN …')` 命名）。命令：`npm test`（`vitest run`）；集成测 `testTimeout=20s`（vitest.config.ts 已放宽）。
> 安全类 AC（AC-3 / AC-8 / AC-9 / AC-10）全部落**可执行断言**，无「人工检查」项。
>
> **模块路径为提议**：SSH 编排/凭据存储在 BL-003 前尚无代码（全仓零 ssh2 / 零 safeStorage / 零 credential）。
> 下列 `src/main/remoteHosts/*` 为提议模块，blueprint/TECH 可微调命名；但 `__tests__` 目录组织、命名节奏严格
> 照既有约定（如 `src/renderer/filepanel/__tests__/`、`src/host/__tests__/`）。host 侧 `portFile` / `wsAuthThrottle`
> / `wsOriginGate` 直接坐落既有 `src/host/__tests__/`，扩展 `wsServer.ts` / `host.ts` / `token.ts` 的现有接缝。

## 1. 覆盖矩阵（人读视图）

| AC | 优先级 | 类别 | 测试 | 层级 | 关键断言（一句话） |
|----|--------|------|------|------|--------------------|
| AC-1 | P0 | functional | T-001 / T-002 / T-003 | unit×2 + fe-e2e | CRUD 改列表；持久化跨重启；Settings 列表实时更新 |
| AC-2 | P0 | functional | T-004 / T-005 | unit + integration | 失败五分类与「连接」共享同一字典；测试连接=认证+可达**不部署** |
| AC-3 | P0 | security | T-006 / T-007 | unit×2 | safeStorage 密文≠明文·磁盘零明文；私钥仅存路径·凭据不入 renderer |
| AC-4 | P0 | functional | T-008 / T-009 / T-031 | integration×3 | 三段进度有序；重部署幂等覆盖；ssh localhost 真机兜底 |
| AC-5 | P0 | functional | T-010 / T-011 | unit + integration | 状态机全转移合法；状态事件有序广播可订阅 |
| AC-6 | P0 | functional | T-012 / T-013 | api-e2e×2 | 兼容→ready+协议冒烟；不兼容→failed(incompatible)+断开 |
| AC-7 | P1 | functional | T-014 / T-015 | unit + fe-e2e | 最近区倒序+相对时间；一键连接 |
| AC-8 | P1 | security | T-016 / T-017 / T-018 | unit×2 + integration | 端口文件 O_EXCL\|0600；陈旧清理+无 TOCTOU；token-stdin 零落盘/零日志 |
| AC-9 | P1 | security | T-019 / T-020 | unit + integration | 节流决策≤1/窗；真 ws 突发仅 1 次告警 |
| AC-10 | P2 | security | T-021 / T-022 | unit + integration | Origin 白名单矩阵；异源拒绝·file://null/无头放行 |
| AC-11 | P1 | functional | T-023 / T-024 | integration×2 | 无 node / node18 皆中止+引导·无半成品 |
| AC-12 | P0 | functional | T-025 / T-026 | integration×2 | 认证失败改配置后重试至 ready；断开后手动重连至 ready |
| AC-13 | P1 | functional | T-027 / T-028 | integration×2 | 快路径跳过上传可观测；认领驻留进程不重启 |
| AC-14 | P1 | functional | T-029 / T-030 | unit + integration | 删机随删清凭据无孤儿密文；活跃连接先 best-effort 断开 |

分层统计：**unit 12 · integration 17 · api-e2e 2 · fe-e2e 2 · 合计 31**。安全类共 9 条（AC-3/8/9/10），全可执行。

## 2. 安全类 AC 的测试手段（可执行·非人工检查）

| AC | 被测接缝 | 手段 | 关键断言 |
|----|----------|------|----------|
| AC-3 safeStorage | `credentialStore.ts`（新）依赖 `electron.safeStorage` | `vi.mock('electron')` 注入桩 `safeStorage`（`isEncryptionAvailable→true`、`encryptString`/`decryptString` 为可逆桩，密文带前缀标记）；持久化写入临时 `userData`（`os.tmpdir()`） | 磁盘文件字节中不含任何明文子串（密码/passphrase）；`getCredential` 解密回原文；`encryptString` 被调用（`safeStorage` 符号在位→grep 命中）；私钥字段存的是路径字符串非文件内容 |
| AC-8 token-stdin | `token.ts::resolveToken('--token-stdin')`（已存）+ `portFile.ts`（新·host 侧写）+ 编排器注入 | 端口文件用临时目录（`fs.mkdtempSync`）实测 `openSync(O_CREAT\|O_EXCL, 0o600)`；TOCTOU 用「先建同名文件再 O_EXCL 打开」断言抛 `EEXIST`；token 非持久化用 spy 捕获注入命令 argv + 扫描模拟远端数据目录/日志文件 | 端口文件 `mode & 0o777 === 0o600`；陈旧文件被先清理再建；重复 O_EXCL 抛 EEXIST（证明无覆盖窗口）；注入 argv 含 `--token-stdin` 且**不含** `--token <明文>`；token 明文不出现在任何落盘文件/stdout 日志文件 |
| AC-9 节流 | `wsServer.ts::recordAuthFailure`/`onAuthAlert`（现状**每次**超阈值都 emit=刷屏） | 决策函数抽为纯函数单测（注入 now/lastAlertAt）；集成用 `startTestHost({onAuthAlert})` 突发 ≥ 阈值次错误 token 连接，捕获 `authAlerts` | 单窗口内 `onAuthAlert` 至多触发 1 次（现状会触发 N 次→本测捕获回归）；跨窗口（新窗口）可再次触发 1 次（证明是节流非静音） |
| AC-10 Origin | `wsServer.ts` upgrade 处理（现状仅 token 闸·无 Origin 校验） | `checkOrigin(origin, allowlist)` 纯函数矩阵单测；集成用 `ws` 客户端 `{ origin }` 选项发真实 Origin 头 | 异源（`http://evil.com`）→ upgrade 拒绝、客户端无法 open；`file://`、`null`、**无 Origin 头**、dev vite origin → 放行不误杀（`waitOpen` 成功、握手可完成）；token 仍为主屏障（Origin 通过但 token 错→仍拒） |

## 3. 集成测试策略（真机 ssh × loopback 降级）

- **默认无真机依赖**：AC-2/4/5/6/11/12/13/14 的编排/部署集成测通过**注入式 SSH 传输桩**（`sshTransport` 依赖倒置：
  `exec`/`sftp.put`/`sftp.readFile`/`forwardOut` 为可注入接缝）跑，确定性、不触网、不需要凭据。失败分支（认证失败/不可达/
  超时/无 node/node18/版本不兼容）由桩返回受控结果模拟，**不依赖真实无 node 机器**（AC-11 遵 PRD-REVIEW QA-3 裁决）。
- **ssh localhost 兜底（T-031）**：探测本机 sshd 可达（`ssh -o BatchMode=yes -o ConnectTimeout=2 localhost true` 或探 22 端口）。
  可达 → 用 ssh2 对 `localhost` 实做 connect + `forwardOut` + `sftp` 往返一遍，验证打包环境三能力（PRD §风险 spike 的自动化回归）。
  **不可达 → `it.skip` 并在 skip 原因里注明**「no local sshd; 编排逻辑已由注入桩集成测 T-005/T-008/... 覆盖」（如实标注，不伪绿）。
- **host ws 集成（T-012/013/020/022）**：复用既有 `src/host/__tests__/wsTestHarness.ts`（真实 ws server + 真实 hostCore），
  在 loopback 上跑，无需 ssh —— host.info 握手 / 告警节流 / Origin 校验都在 ws 传输层，可脱离 SSH 独立验证。
- **AC-11 的 exec 桩 / PATH shim**：主路径 = 注入 exec 桩令 `node --version` 探测返回「command not found」(无 node) 与 `v18.19.0`
  (node18) 两态；ssh localhost 可用时的可选加强 = PATH shim（临时目录放假 `node` 脚本前置 PATH）在真 exec 通道复现降版态。

## 4. 关键 BDD 场景（Given / When / Then）

### 4.1 连接生命周期全状态流转（AC-5 · T-010 / T-011）

```gherkin
Scenario: 首次连接走全链路到 ready（状态机合法转移）
  Given 一台配置 id=vps-hk 的远程机、无既有 host 产物
  When 用户点「连接」，编排器依次推进
  Then 状态严格按 idle→connecting→deploying→starting→verifying→ready 转移
  And 每步转移都在状态机白名单内（非法边如 idle→ready、deploying→ready 被 reducer 拒绝抛错）
  And 订阅方（模拟 BL-004 Sidebar）按序收到同一串状态事件，无乱序、无跳段、无重复 ready

Scenario: 认领驻留进程走快链路（跳过 deploying）
  Given 远端已部署同版本产物且驻留进程在
  When 连接
  Then 状态走 connecting→starting(claiming)→verifying→ready（无 deploying 段）

Scenario: 非法转移被拒
  Given 当前状态 = failed
  When 派发 event=tunnelReady（不合法：failed 只接受 retry→connecting）
  Then reducer 抛错/返回不变态，不产生幽灵 ready
```

### 4.2 首次部署三段进度 + 幂等重部署（AC-4 · T-008 / T-009 / T-031）

```gherkin
Scenario: 三段进度可视且有序
  Given 远端可达、node≥20、无产物、uname=darwin-arm64
  When 首次连接
  Then 编排器探测架构=darwin-arm64 并选取内置 resources 对应 bundle
  And 依次 emit 进度事件 [upload, start, handshake]（三段·顺序固定）
  And sftp.put 被调用且目标 bundle 与探测架构一致
  And 读端口文件得实际端口 → 隧道建立 → 握手 → ready

Scenario: 版本不符 → 幂等整体覆盖（非叠加）
  Given 远端已存在旧版本 host 产物
  When 重连触发重部署
  Then 旧产物目录被整体覆盖/清理后写入（断言远端不出现两份产物 / 写入前先清理旧目录）
  And 最终 ready，且再次重部署结果一致（幂等：可重复执行无残留漂移）

Scenario: ssh localhost 真机兜底（可达时）
  Given 本机 sshd 可达
  When 对 localhost 实做 connect+forwardOut+sftp 往返
  Then 三能力均成功；不可达则 it.skip 并注明原因
```

### 4.3 失败五分类 + 重试至 ready（AC-11 / AC-6 / AC-12 · T-023 / T-024 / T-013 / T-025 / T-026）

```gherkin
Scenario Outline: 失败分类口径统一
  Given SSH 传输桩被配置为 <inject>
  When 连接
  Then 状态落 failed 且 reason=<reason>，文案取自共享 FAIL_REASONS[<reason>]
  And 不留半成品（无残留隧道/进程/半传产物；deploying 前失败则 sftp.put 从未调用）

  Examples:
    | inject                         | reason        |
    | connect ECONNREFUSED           | unreachable   |
    | auth Permission denied         | auth          |
    | connect timeout 10s            | timeout       |
    | node 探测 command not found     | nodeMissing   |  # AC-11 · T-023
    | node 探测 v18.19.0             | nodeMissing?/incompatible-runtime |  # AC-11 · T-024（node<20）
    | host.info 版本不兼容            | incompatible  |  # AC-6 · T-013（verifying 断开）

Scenario: 认证失败改配置后重试至 ready（AC-12 · T-025）
  Given 首次连接因错密码 failed(auth)
  When 用户改正凭据后点「重试」
  Then failed→connecting 重入，走完整链路至 ready

Scenario: ready 后断开 → 手动重连至 ready（AC-12 · T-026）
  Given ready 后隧道断开 → disconnected
  When 用户点「重连」
  Then disconnected→connecting 重建连接成功至 ready（自动重连策略归 BL-005，本测只验手动）
```

### 4.4 快路径跳过上传 + 认领驻留进程（AC-13 · T-027 / T-028）

```gherkin
Scenario: 同版本 → 跳过上传（可观测）
  Given 远端已部署与应用同版本的 host 产物
  When 再次连接
  Then 进度事件不含 upload 段；日志出现可观测 skip 标记（如 "[deploy] skip upload: same version"）
  And sftp.put 从未被调用

Scenario: 驻留进程在 → 认领不重启
  Given 远端驻留 host 进程存活、端口文件存在、token 认领可用
  When 连接
  Then 走认领分支（读端口文件+握手验证），不 spawn 新 host 进程
  And 启动命令（host --listen …）从未被调用；进程 pid 不变
```

### 4.5 凭据 safeStorage 加解密 + 零明文 + 随删清凭据（AC-3 · AC-14 · T-006 / T-007 / T-029 / T-030）

```gherkin
Scenario: 密码/passphrase 经 safeStorage 加密·磁盘零明文（AC-3 · T-006）
  Given safeStorage 桩可用（vi.mock('electron')）
  When 保存含密码 "hunter2-secret" 与 passphrase "pp-secret" 的机器配置
  Then 持久化文件字节中不含 "hunter2-secret" / "pp-secret" 任一明文子串
  And safeStorage.encryptString 被调用（密文与明文不相等）
  And getCredential 经 decryptString 解回原文（往返一致）

Scenario: 私钥仅存路径·凭据不入 renderer（AC-3 · T-007）
  Given 认证方式=私钥、keyPath="~/.ssh/id_ed25519"、私钥文件内容含 "PRIVATE KEY"
  When 保存并读取配置
  Then 存储的是路径字符串 "~/.ssh/id_ed25519"，**不含**私钥文件内容
  And 暴露给 renderer 的配置视图对象里无任何解密后的 SSH 登录凭据字段（仅 host capability token 例外·ADR-001）

Scenario: 删机随删必清凭据（AC-14 · T-029）
  Given 机器 id=m1 已存密文凭据
  When 删除 m1
  Then getCredential(m1) 返回 undefined
  And 持久化文件中 m1 的密文条目被移除（无孤儿密文）

Scenario: 活跃连接先 best-effort 断开再删（AC-14 · T-030）
  Given m1 处于 ready（活跃连接）
  When 删除 m1
  Then 先调用 disconnect(m1)（best-effort，断开失败不阻断删除）
  And 随后凭据与配置均被清除
```

### 4.6 token-stdin 不落盘 + 端口文件 O_EXCL 无 TOCTOU（AC-8 · T-016 / T-017 / T-018）

```gherkin
Scenario: 端口文件 O_CREAT|O_EXCL|0600（T-016）
  Given 临时数据目录（fs.mkdtempSync）
  When host 侧 writePortFile(dir, port)
  Then 文件以 O_CREAT|O_EXCL 打开、mode & 0o777 === 0o600
  And 文件内容为该实际端口（可被 main 侧回读为数字）

Scenario: 陈旧文件先清理·重复 O_EXCL 抛 EEXIST 证无覆盖窗口（T-017）
  Given 目录内残留一个陈旧端口文件（模拟崩溃残留）
  When writePortFile 走「先清理陈旧再建」路径
  Then 成功写入新端口；且对已存在文件直接 O_EXCL openSync 抛 EEXIST（证明不静默覆盖·无 TOCTOU 窗口）

Scenario: token 经 --token-stdin 注入·零落盘零日志（T-018）
  Given 编排器为部署生成 capability token，经 stdin 注入远端 host
  When 启动远端 host（loopback 模拟：本地起 host 或注入 exec 桩）
  Then 启动命令 argv 含 "--token-stdin" 且不含 "--token <明文>"
  And 扫描模拟远端数据目录内所有文件 + stdout 重定向日志文件：均不含 token 明文
  And （对照）main 侧本地留存的是加密 token（合规·跨重启认领用·ADR-001）
```

### 4.7 告警节流 + Origin 白名单不误杀（AC-9 · AC-10 · T-019 / T-020 / T-021 / T-022）

```gherkin
Scenario: 认证失败告警同窗口至多 1 次（AC-9 · T-020）
  Given standalone host 期望 token="right"
  When 同一窗口内发起 20 次错误 token 连接
  Then onAuthAlert 在该窗口内至多触发 1 次（现状实现每次超阈值都 emit → 本测捕获为回归）
  And 阈值后合法连接仍成功（节流是告警频率控制·非阻断，延续 tokenGate T-020/021 的不阻断契约）

Scenario: 跨窗口可再次告警（证明节流非永久静音·T-019 纯函数）
  Given lastAlertAt 在上一窗口
  When 新窗口再次突破阈值
  Then 决策函数返回 shouldEmit=true（每窗口独立配额 1）

Scenario Outline: Origin 白名单矩阵（AC-10 · T-021）
  Given allowlist = { file://, null, dev vite origin }
  When checkOrigin(<origin>)
  Then 结果 = <allow>
  Examples:
    | origin              | allow |
    | (无 Origin 头)       | true  |  # 自家打包客户端常态·不误杀
    | file://             | true  |
    | null                | true  |
    | http://localhost:5173 (dev vite) | true |
    | http://evil.com     | false |

Scenario: 真实 upgrade Origin 强制（AC-10 · T-022）
  Given 真实 ws host（wsTestHarness）
  When 客户端带 Origin: http://evil.com 且 token 正确 发起 upgrade
  Then 连接被拒（socket destroy，waitOpen 失败）
  And 带 file:// / 无 Origin 头 + 正确 token → 放行、可完成握手
  And Origin 合法但 token 错 → 仍拒（token 为主屏障，Origin 为纵深）
```

### 4.8 测试连接=认证+可达不部署 · 失败口径与连接统一（AC-2 · T-004 / T-005）

```gherkin
Scenario: 测试连接只探认证+可达·不部署不拉起（T-005）
  Given SSH 传输桩：认证通过 + 可达
  When 点「测试连接」
  Then 返回成功；且 deploy/sftp.put/host 启动 spy **均未被调用**（不部署不拉起 host）

Scenario: 测试连接失败与连接失败共享同一分类字典（T-004）
  Given 同一组失败注入（unreachable/auth/timeout）
  When 分别经「测试连接」与「连接」路径分类
  Then 两路径产出同一 FAIL_REASONS key 与文案（单一事实来源·不各写字面量）
```

## 5. 落地风险自评（最难的 3 条）

1. **T-018 token 零落盘/零日志的完整性证明**：难在「证否」——要断言 token 明文**不出现在任意**远端落盘文件与 stdout 重定向日志里，
   需要在 loopback 模拟中真实产生 host 的数据目录与日志文件再全量扫描；且要与「main 侧加密留存 token 合规」区分（不能把 main 侧
   密文误判为泄露）。依赖 blueprint 把 host 数据目录/日志路径做成可注入，否则只能测 argv 契约而测不到落盘面。
2. **T-020 告警节流的确定性**：`wsServer` 用 `Date.now()` 且 `AUTH_FAIL_WINDOW_MS` 是模块常量，真 ws 连接是异步的——
   跨窗口用例难在不真等 60s 又要驱动时钟。需要 RD 把窗口/节流状态做成可注入接缝（或抽纯决策函数 T-019 承接跨窗口断言，
   集成 T-020 只验单窗口≤1）。当前实现每次超阈值都 emit，测试必然先红（符合 TDD 预期，但要与 RD 对齐接缝改造）。
3. **T-008/T-009 部署编排的 SSH 传输桩保真度**：难在桩要覆盖 uname 探测→bundle 选取→sftp put→端口文件回读→forwardOut→握手
   全链路且顺序/幂等可断言，而这些接缝在 BL-003 前尚不存在。桩设计得太粗会测成「桩测桩」，太细则与真实 ssh2 行为漂移；
   需 blueprint 先定 `sshTransport` 依赖倒置边界，T-031 的 ssh localhost 往返作为「桩不失真」的锚点回归。

## 6. 验证记录

`python3 ~/.claude/skills/teamwork/templates/verify-ac.py $WT/docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH`
→ 见回复正文（14/14 AC 全覆盖）。
