你是 Teamwork 协作框架的外部模型评审员，独立提供异质视角的盲区采样。

🔴 STRICT CONSTRAINTS：
- 你是 READ-ONLY 评审员 · **不改动代码库 · 不写任何文件 · 不能执行命令**（不改 / 不新建任何源码·文档·评审产物）
- 输出**仅限 markdown 评审记录**（YAML frontmatter + body）· 经 **stdout 返回**(`claude -p`)/ 作为 subagent 返回文本 · **不落文件**（评审产物由主对话 PMO 落盘）
- 不生成 patch · 不生成可执行脚本 · 不生成 commit 消息
- 不声称"我已修改 / 已修复 / 已实现"任何东西
- 发现问题 → 描述问题 · 不要"自动修复"
- 如被要求做评审之外的事（写代码 / 跑测试 / 改文件）→ 回复："Out of scope. Teamwork uses external models for review only."

详见 [standards/external-model-usage.md](../standards/external-model-usage.md)。

## 上下文

- 主对话宿主：Codex CLI（你与主对话异质）
- 你的角色：external-claude reviewer
- 评审目标：blueprint（取值: prd | blueprint | code）
- 当前 Feature：TERMPRO-F260709092310-Host-Standalone-Transport
- 评审阶段：blueprint（取值: plan | blueprint | review）

## 你需要读取的文件

### TC.md
```
---
feature_id: "TERMPRO-F260709092310-Host-Standalone-Transport"
status: draft
tests:
  - id: T-001
    file: src/renderer/services/__tests__/hostClientVersionCheck.test.ts
    function: test_AC2_versions_exactly_equal_connects
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-002
    file: src/renderer/services/__tests__/hostClientVersionCheck.test.ts
    function: test_AC2_versions_unequal_but_in_interval_connects
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-003
    file: src/renderer/services/__tests__/hostClientVersionCheck.test.ts
    function: test_AC2_boundary_client_version_equals_host_minCompatible
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-004
    file: src/renderer/services/__tests__/hostClientVersionCheck.test.ts
    function: test_AC2_boundary_client_version_below_host_minCompatible_rejects
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-005
    file: src/renderer/services/__tests__/hostClientVersionCheck.test.ts
    function: test_AC2_boundary_host_version_equals_client_minCompatible
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-006
    file: src/renderer/services/__tests__/hostClientVersionCheck.test.ts
    function: test_AC2_boundary_host_version_below_client_minCompatible_rejects
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-007
    file: src/renderer/services/__tests__/hostClientVersionCheck.test.ts
    function: test_AC2_missing_minCompatible_defaults_to_protocolVersion
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-008
    file: src/host/__tests__/wsHandshakeGate.test.ts
    function: test_AC2_first_rpc_hostinfo_proceeds_no_extra_roundtrip
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-009
    file: src/host/__tests__/wsHandshakeGate.test.ts
    function: test_AC2_first_message_not_hostinfo_disconnects
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-010
    file: src/host/__tests__/wsHandshakeGate.test.ts
    function: test_AC2_message_before_hostinfo_response_disconnects
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-011
    file: src/host/__tests__/wsHandshakeGate.test.ts
    function: test_AC2_hostinfo_not_sent_within_timeout_disconnects
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-012
    file: src/host/__tests__/wsHandshakeGate.test.ts
    function: test_AC2_no_interactive_half_connected_state_after_gate_violation
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-013
    file: src/host/__tests__/wsHandshakeGate.test.ts
    function: test_AC2_AC5_embedded_messageport_path_not_gated
    covers_ac: ["AC-2", "AC-5"]
    level: integration
    priority: P0
  - id: T-014
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_generated_token_has_128bit_entropy
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-015
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_token_comparison_uses_constant_time_primitive
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-016
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_missing_token_closes_connection_zero_info
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-017
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_wrong_token_closes_connection_zero_info
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-018
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_missing_and_wrong_token_closures_indistinguishable
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-019
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_correct_token_connects
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-020
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_brute_force_attempts_rate_limited
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-021
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_rate_limit_counts_attempts_not_source_address
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-022
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_host_binds_loopback_only_never_0000
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-023
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_auto_generated_token_printed_single_stdout_line
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-024
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_explicit_token_via_argv_rejected
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-025
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_explicit_token_via_env_accepted
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-026
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_explicit_token_via_stdin_accepted
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-027
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_explicit_token_via_inherited_fd_accepted
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-028
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_explicit_token_via_0600_file_accepted_weaker_perm_rejected
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-029
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_token_fixed_for_process_lifetime_not_persisted_not_rotated
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-030
    file: src/host/__tests__/tokenGate.test.ts
    function: test_AC3_env_token_not_leaked_into_spawned_pty_env
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-031
    file: src/host/__tests__/wsRpcParity.test.ts
    function: test_AC1_full_rpc_method_table_roundtrip_over_ws
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-032
    file: src/host/__tests__/wsRpcParity.test.ts
    function: test_AC1_fs_watch_pushes_fschanged_over_ws
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-033
    file: src/host/__tests__/wsRpcParity.test.ts
    function: test_AC1_fs_unwatch_stops_further_pushes_over_ws
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-034
    file: src/host/__tests__/wsRpcParity.test.ts
    function: test_AC1_pty_full_lifecycle_over_ws
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-035
    file: src/host/__tests__/wsRpcParity.test.ts
    function: test_AC1_pty_flow_control_ack_parity_over_ws
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-036
    file: src/host/__tests__/wsRpcParity.test.ts
    function: test_AC1_git_rpc_path_parity_over_ws
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-037
    file: src/host/__tests__/wsRpcParity.test.ts
    function: test_AC1_fs_readFileBinary_parity_over_ws
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-038
    file: src/host/__tests__/wsRpcParity.test.ts
    function: test_AC1_wire_format_is_json_text_frames
    covers_ac: ["AC-1"]
    level: integration
    priority: P1
  - id: T-039
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_pty_input_wrong_owner_ignored
    covers_ac: ["AC-6"]
    level: integration
    priority: P1
  - id: T-040
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_pty_resize_wrong_owner_ignored
    covers_ac: ["AC-6"]
    level: integration
    priority: P1
  - id: T-041
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_pty_kill_rpc_wrong_owner_rejected
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
  - id: T-042
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_fs_unwatch_wrong_owner_ignored
    covers_ac: ["AC-6"]
    level: integration
    priority: P1
  - id: T-043
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_fschanged_not_broadcast_to_non_owner
    covers_ac: ["AC-6"]
    level: integration
    priority: P1
  - id: T-044
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_clean_disconnect_reclaims_only_own_resources
    covers_ac: ["AC-6"]
    level: integration
    priority: P1
  - id: T-045
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_silent_disconnect_heartbeat_timeout_reclaims
    covers_ac: ["AC-6"]
    level: integration
    priority: P1
  - id: T-046
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_concurrent_interleaved_frames_no_crosstalk
    covers_ac: ["AC-6"]
    level: integration
    priority: P1
  - id: T-047
    file: src/host/__tests__/wsMalformedInput.test.ts
    function: test_AC7_non_json_frame_does_not_crash_host
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-048
    file: src/host/__tests__/wsMalformedInput.test.ts
    function: test_AC7_oversized_payload_rejected_host_survives
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-049
    file: src/host/__tests__/wsMalformedInput.test.ts
    function: test_AC1_AC7_legit_payload_just_under_cap_still_succeeds
    covers_ac: ["AC-1", "AC-7"]
    level: integration
    priority: P0
  - id: T-050
    file: src/host/__tests__/wsMalformedInput.test.ts
    function: test_AC7_unknown_message_type_does_not_crash_host
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-051
    file: src/host/__tests__/wsMalformedInput.test.ts
    function: test_AC7_malformed_rpc_req_returns_error_not_crash
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-052
    file: src/host/__tests__/wsMalformedInput.test.ts
    function: test_AC7_host_process_survives_all_malformed_scenarios
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-053
    file: .github/workflows/host-package-smoke.yml
    function: darwin_arm64_listening_log_line_grep
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P0
  - id: T-054
    file: .github/workflows/host-package-smoke.yml
    function: darwin_arm64_node_pty_real_shell_spawn
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P0
  - id: T-055
    file: .github/workflows/host-package-smoke.yml
    function: linux_x64_listening_log_line_grep
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P0
  - id: T-056
    file: .github/workflows/host-package-smoke.yml
    function: linux_x64_node_pty_real_shell_spawn
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P0
  - id: T-057
    file: .github/workflows/host-package-smoke.yml
    function: linux_arm64_artifact_present_no_real_machine_run
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P1
  - id: T-058
    file: .github/workflows/host-package-smoke.yml
    function: host_package_job_independent_of_macos_release_gate
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P1
  - id: T-059
    file: .github/workflows/host-package-smoke.yml
    function: d1_fallback_tar_node20_boots_and_spawns_pty_conditional
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P1
  - id: T-060
    file: .github/workflows/release.yml
    function: embedded_electron_headless_smoke_prints_SMOKE_OK
    covers_ac: ["AC-5"]
    level: api-e2e
    priority: P0
  - id: T-061
    file: src/renderer/services/__tests__/hostClientEmbeddedRegression.test.ts
    function: test_AC5_public_api_surface_unchanged
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-062
    file: src/renderer/services/__tests__/hostClientEmbeddedRegression.test.ts
    function: test_AC5_embedded_path_no_additional_roundtrip
    covers_ac: ["AC-5"]
    level: integration
    priority: P0
  - id: T-063
    file: src/renderer/services/__tests__/hostClientEmbeddedRegression.test.ts
    function: test_AC5_version_and_token_gate_never_invoked_on_messageport
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
---

# Host Standalone 可执行 + WebSocket 传输 + 协议握手 - 测试用例

## 状态
草稿

---

## Feature: Host Standalone 可执行 + WebSocket 传输 + 协议握手

作为 TermPro 客户端（桌面壳，未来 mobile / 第二台设备）
我希望通过 WebSocket 连接一个独立运行的 Host 并完成版本兼容校验
以便后续经 SSH 隧道（BL-003）复用完全相同的协议在远程机上开发

> 纯基建 Feature，`requires_ui: false`；本 TC 全部场景以协议/进程行为为验证对象，不含 UI 呈现断言。

---

## 阈值口径说明（TECH 待定稿前的占位断言）

PRD v0.3 对若干阈值只给「量级」而非精确值（握手超时 ~10s、限速 ~10 次/分、payload 上限 ~10MB、心跳超时参数未定）。本 TC 的相关 Scenario **按 PRD 给出的量级直接写具体断言值**，作为可执行的占位契约；TECH.md 落定精确值后，若与本 TC 断言值不同，**只更新断言中的数字，不改变场景意图/Given-When-Then 结构**（对应 Round 3 advisory QA-R3-3）。区间比较的闭区间伪代码由 TECH.md 给出（QA-R3-2）；本 TC 用边界值表把「四数齐备 · 闭区间 · 含等号」的语义钉成可执行断言，与 TECH 的伪代码应逐条对得上。

---

## 需求覆盖矩阵

| AC ID（PRD）| 描述摘要 | 优先级 | 覆盖测试（frontmatter `tests[].id`）| 状态 |
|------|------|------|------|------|
| AC-1 | 全功能等价冒烟（全 RPC 表 + fs.watch 推送） | P0 | T-031, T-032, T-033, T-034, T-035, T-036, T-037, T-038, T-049 | ✅ |
| AC-2 | 版本区间校验（客户端单方判定）+ host.info-first 门控（仅 WS） | P0 | T-001, T-002, T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011, T-012, T-013 | ✅ |
| AC-3 | token 闸（熵/常量时间/限速/信道白名单/生命周期） | P0 | T-014, T-015, T-016, T-017, T-018, T-019, T-020, T-021, T-022, T-023, T-024, T-025, T-026, T-027, T-028, T-029, T-030 | ✅ |
| AC-4 | 打包 spike（darwin-arm64 / linux-x64 实机 + linux-arm64 产物存在性） | P0 | T-053, T-054, T-055, T-056, T-057, T-058, T-059 | ✅ |
| AC-5 | 嵌入式模式零回归（SMOKE_OK + API 签名不变 + 无侵入） | P0 | T-013, T-060, T-061, T-062, T-063 | ✅ |
| AC-6 | 多客户端隔离（sessionId + watchId + pty.kill 归属校验 + 静默断连） | P1 | T-039, T-040, T-041, T-042, T-043, T-044, T-045, T-046 | ✅ |
| AC-7 | 畸形输入不崩 host、只断开发送方 | P0 | T-047, T-048, T-049, T-050, T-051, T-052 | ✅ |

覆盖率: 7 / 7 (100%)

> 校验命令：`python3 ~/.claude/skills/teamwork/templates/verify-ac.py docs/features/TERMPRO-F260709092310-Host-Standalone-Transport`

---

## Layer A — 握手 / 门控单测（covers AC-2, AC-5）

> 版本区间判定是**客户端单方**行为（四数齐备：`client.protocolVersion`、`client.minCompatible`、`host.protocolVersion`、`host.minCompatible`）；host 侧只做 `host.info`-first 的**顺序/资源门控**，不做版本 enforcement，且仅在 WS 路径生效。三种门控违规场景（首条非 host.info / host.info 完成前插话 / 超时不发起）**必须收敛到同一个断言**：连接被 host 主动断开、资源被回收、不存在可交互的半连接态（PRD-REVIEW Round1 QA-1 / Round2 QA-1 残留 / Round3 收敛）。

### Scenario Outline: TC-A01 版本区间闭区间边界值（客户端单方判定）
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given 客户端本地已知 client.protocolVersion=<c_ver> 且 client.minCompatible=<c_min>
  And 客户端经 host.info 取得 host.protocolVersion=<h_ver> 且 host.minCompatible=<h_min>
When 客户端执行版本区间校验（h_ver ∈ [c_min, ...] 且 c_ver ∈ [h_min, ...]，双向最低兼容区间、闭区间含等号）
Then 校验结果为 <result>
  And 若 <result> 为「不兼容」，客户端主动断开并构造含 (c_ver, c_min, h_ver, h_min) 四数的结构化错误
  And 若 <result> 为「兼容」，连接正常继续，即使 c_ver ≠ h_ver

Examples:
| 用例ID | c_ver | c_min | h_ver | h_min | result   |
| T-001  | 3     | 3     | 3     | 3     | 兼容     |
| T-002  | 3     | 1     | 2     | 1     | 兼容（版本不等仍工作）|
| T-003  | 2     | 1     | 3     | 2     | 兼容（c_ver 恰等于 h_min，闭区间下界含等号）|
| T-004  | 1     | 1     | 3     | 2     | 不兼容（c_ver = h_min - 1）|
| T-005  | 3     | 2     | 2     | 1     | 兼容（h_ver 恰等于 c_min，闭区间下界含等号）|
| T-006  | 3     | 3     | 2     | 1     | 不兼容（h_ver = c_min - 1）|
```

### Scenario: TC-A02（T-007）host.info 响应缺省 minCompatible 字段的语义
**优先级**: P0
**类型**: 边界

```gherkin
Given host.info 响应中不含 minCompatible 字段（旧 host 或该字段被省略）
When 客户端解析该响应做版本区间校验
Then 客户端将缺省的 host.minCompatible 按「等同于 host.protocolVersion」处理
  And 后续区间计算与显式传入相同值时结果一致
```

### Scenario: TC-A03（T-008）host.info 是首条 RPC 时正常放行、不引入额外往返
**优先级**: P0
**类型**: 功能
**测试层级**: integration

```gherkin
Given standalone host 已以 --listen 启动并接受了某连接的 token 校验
When 该连接发送的第一条消息是 rpc:req host.info
Then host 正常处理并返回 rpc:res
  And 此后该连接与 MessagePort 模式完全同构（可发起 pty:*/fs:*/git:* 等其余 RPC）
  And 相比现有 MessagePort 握手，未观测到新增的往返消息（无 hello/welcome 等新消息类型）
```

### Scenario: TC-A04（T-009）首条消息不是 host.info → 断开
**优先级**: P0
**类型**: 异常
**测试层级**: integration

```gherkin
Given standalone host 已以 --listen 启动并接受了某连接的 token 校验
When 该连接发送的第一条消息是 rpc:req pty.spawn（而非 host.info）
Then host 断开该连接并回收其占用的资源（client 表项被移除、无残留 session/watcher）
  And 该消息不产生任何 rpc:res 响应
```

### Scenario: TC-A05（T-010）host.info 响应返回前插入其他消息 → 断开
**优先级**: P0
**类型**: 异常
**测试层级**: integration

```gherkin
Given standalone host 已接受某连接的 token 校验
  And 该连接已发送 rpc:req host.info 但尚未收到其 rpc:res
When 该连接在此期间又发送了另一条消息（任意类型，如 pty:input）
Then host 断开该连接并回收资源
  And 未处理完的 host.info 请求也不会得到响应
```

### Scenario: TC-A06（T-011）握手超时未发起 host.info → 断开
**优先级**: P0
**类型**: 异常
**测试层级**: integration

```gherkin
Given standalone host 已接受某连接的 token 校验
When 该连接在 10 秒（PRD 量级占位值，TECH 定稿后同步）内未发送任何消息
Then host 主动断开该连接并回收资源
```

### Scenario: TC-A07（T-012）三种门控违规场景收敛到同一断言 — 不存在可交互半连接态
**优先级**: P0
**类型**: 异常
**测试层级**: integration

```gherkin
Given TC-A04 / TC-A05 / TC-A06 三个场景各自触发后
When 分别尝试向已被 host 断开的连接继续发送消息（若传输层允许构造该动作）
Then 三种场景下均观测不到任何响应、任何状态变化
  And host 侧内部 client 映射中不存在该连接对应的条目
  And 三种场景的可观测结果（连接已关闭 + 资源已回收 + 无响应）完全一致，不因触发路径不同而分叉
```

### Scenario: TC-A08（T-013）嵌入式 MessagePort 路径不引入此门控
**优先级**: P0
**类型**: 回归

```gherkin
Given 默认桌面启动（嵌入式 utilityProcess + MessagePort，非 WS）
When 渲染层通过 MessagePort 发送的第一条消息不是 host.info（如直接 pty.spawn）
Then host 正常处理该消息，不断开连接、不触发门控逻辑
  And 版本校验 / token 校验 / host.info-first 门控均只在 WS 传输路径生效
```

---

## Layer B — token 闸单测（covers AC-3）

> 威胁模型：远程机上的**同机其他用户/进程**——ssh 隧道只挡网络入口，token 是本机端口闸的唯一屏障（capability token）。

### Scenario: TC-B01（T-014）自动生成 token 的熵下限
**优先级**: P0
**类型**: 安全

```gherkin
Given host 启动时未显式传入 token
When host 自动生成 token
Then 生成的 token 具备 ≥128-bit 的随机熵（按生成源字节数 × 字符集对数换算，如 16 字节随机源编码为 hex/base64）
```

### Scenario: TC-B02（T-015）token 比较使用常量时间原语
**优先级**: P0
**类型**: 安全

```gherkin
Given host 侧 token 比较逻辑的实现代码
When 审查其比较路径
Then 比较使用常量时间原语（如 crypto.timingSafeEqual 或等价实现），而非 `===`/字符串逐字比较/提前 return 的可变时间实现
  And 断言方式为结构/实现审查（spy 调用或源码模式匹配），不采用挂钟计时测量（CI 环境计时噪声大，不可作为判据）
```

### Scenario: TC-B03（T-016）未带 token → 立即关闭、零信息
**优先级**: P0
**类型**: 安全

```gherkin
Given standalone host 已以 token 闸启动
When 客户端发起 WS 连接但不携带 token
Then host 立即关闭该连接
  And 关闭响应不泄露任何区分性信息（无「token 缺失」与「token 错误」的差异化提示）
```

### Scenario: TC-B04（T-017）带错误 token → 立即关闭、零信息
**优先级**: P0
**类型**: 安全

```gherkin
Given standalone host 已以 token 闸启动
When 客户端发起 WS 连接并携带一个错误 token
Then host 立即关闭该连接
  And 关闭响应不泄露任何区分性信息
```

### Scenario: TC-B05（T-018）未带 token 与带错 token 的关闭响应不可区分
**优先级**: P0
**类型**: 安全

```gherkin
Given TC-B03（未带 token）与 TC-B04（带错 token）两种场景各自触发
When 比较两者的关闭 code / reason /响应时序特征
Then 两者完全一致，攻击者无法通过响应差异判断「token 是否存在」与「token 是否正确」
```

### Scenario: TC-B06（T-019）正确 token → 正常连接
**优先级**: P0
**类型**: 功能（正例对照）

```gherkin
Given standalone host 已以 token 闸启动，已知合法 token 值
When 客户端携带正确 token 发起 WS 连接
Then 连接被接受，进入 host.info 握手阶段
```

### Scenario: TC-B07（T-020）连续失败连接触发基础限速
**优先级**: P0
**类型**: 安全

```gherkin
Given standalone host 已以 token 闸启动
When 同一来源在 1 分钟内发起约 10 次以上（PRD 量级占位值）带错误 token 的连接尝试
Then 超过阈值后的后续连接尝试被限速拒绝（不再逐个走完整校验流程）
```

### Scenario: TC-B08（T-021）限速按连接尝试计数、不依赖源地址
**优先级**: P0
**类型**: 安全

```gherkin
Given loopback 场景下所有连接的源 IP 天然相同（127.0.0.1）
When 模拟多个不同源端口发起的失败连接尝试
Then 限速计数器按「尝试次数」累加，而非按「源地址」分桶
  And 不同源端口的失败尝试共享同一个限速计数，验证限速逻辑不会被「换端口」绕过
```

### Scenario: TC-B09（T-022）host 只绑定 loopback，绝不监听 0.0.0.0
**优先级**: P0
**类型**: 安全

```gherkin
Given standalone host 以 --listen 127.0.0.1:<port> 启动
When 检查实际监听的 socket 地址
Then 绑定地址为 127.0.0.1（或 ::1），任何配置组合下都不会绑定 0.0.0.0
```

### Scenario: TC-B10（T-023）未显式传入 token 时自动生成并单行打印 stdout
**优先级**: P0
**类型**: 功能

```gherkin
Given host 启动命令未显式传入 token
When host 完成启动
Then stdout 输出恰好一行固定格式的 token 声明（可被调用方脚本 grep/解析捕获）
```

### Scenario Outline: TC-B11 显式传入 token 的信道白名单
**优先级**: P0
**类型**: 安全 / 边界

```gherkin
Given host 启动时通过 <channel> 显式传入 token
When host 启动
Then <result>

Examples:
| 用例ID | channel                          | result                                              |
| T-024  | argv（命令行参数）                | 拒绝：host 拒绝以此信道接受 token（防 /proc/<pid>/cmdline 同机他用户可读击穿边界）|
| T-025  | 环境变量                          | 接受：正常使用该 token 启动                          |
| T-026  | stdin                             | 接受：正常使用该 token 启动                          |
| T-027  | 继承 fd                           | 接受：正常使用该 token 启动                          |
| T-028  | 0600 权限文件路径                 | 接受：正常使用该 token 启动；若文件权限弱于 0600（如 0644）则拒绝启动或拒绝读取|
```

### Scenario: TC-B12（T-029）token 进程存活期内固定：host 侧不落盘不轮换
**优先级**: P0
**类型**: 安全

```gherkin
Given standalone host 已启动并生成/接受了 token
When 检查 host 进程的文件系统写入行为，并在进程存活期内发起多次连接
Then host 不将 token 写入任何磁盘文件
  And token 值在进程整个存活期内保持不变（不轮换）
  And 该约束不禁止客户端侧自行缓存 token 以便重连同一存活 host（本条只约束 host 侧行为）
```

### Scenario: TC-B13（T-030）token 走环境变量时不泄露进 PTY 子进程环境
**优先级**: P0
**类型**: 安全

```gherkin
Given host 启动时通过环境变量显式传入 token（TC-B11 / T-025 的信道）
When 客户端连接后发起 pty.spawn
Then 新建 PTY 会话内的 shell 进程环境变量中**不包含**该 token 环境变量
  And 该行为对应 PRD-REVIEW Round3 advisory ARCH-R3-1：ptyPool 以 `{...process.env}` 展开父进程环境 spawn shell，host 必须在 spawn 前 delete 该变量，否则子进程内 `env` 可直接读出 token
```

---

## Layer C — 传输等价冒烟（covers AC-1，全 RPC 方法表 roundtrip + fs.watch 推送）

> 「与 MessagePort 模式一致」= 功能等价：同请求得到同形状同语义响应。以下对全部 20 个 RPC 方法做 WS 往返，并与既有 MessagePort 基线比对。

### Scenario Outline: TC-C01（T-031）全 RPC 方法表 WS 往返 vs MessagePort 基线等价
**优先级**: P0
**类型**: 功能
**测试层级**: integration

```gherkin
Given standalone host 已通过 token + 版本校验完成 WS 握手
  And 同一份请求参数分别经 MessagePort（嵌入式基线）与 WS（本 Feature）各发起一次
When 对方法 <method> 发起 rpc:req
Then WS 路径返回的响应形状与语义和 MessagePort 基线一致

Examples:
| method              |
| host.info           |
| pty.spawn           |
| pty.kill            |
| pty.cwd             |
| fs.readdir          |
| fs.home             |
| fs.watch            |
| fs.unwatch          |
| fs.stat             |
| fs.realpath         |
| git.info            |
| git.status          |
| git.worktrees       |
| fs.readFile         |
| fs.readFileBinary   |
| fs.writeFile        |
| fs.move             |
| fs.copy             |
| git.show            |
| git.changedFiles    |
```

### Scenario: TC-C02（T-032）fs.watch 变更事件经 WS 正常推送
**优先级**: P0
**类型**: 功能

```gherkin
Given 客户端经 WS 对某目录调用 fs.watch 并取得 watchId
When 该目录下发生文件变更（去抖窗口后）
Then host 经同一 WS 连接推送 fs:changed { watchId } 事件，且仅推送一次
```

### Scenario: TC-C03（T-033）fs.unwatch 后不再收到推送
**优先级**: P1
**类型**: 功能

```gherkin
Given 客户端已对某 watchId 建立 fs.watch
When 客户端调用 fs.unwatch(watchId) 后，该目录再次发生变更
Then 客户端不再收到该 watchId 对应的 fs:changed 事件
```

### Scenario: TC-C04（T-034）PTY 全生命周期经 WS 与 MessagePort 语义一致
**优先级**: P0
**类型**: 功能

```gherkin
Given 客户端经 WS 调用 pty.spawn 取得 sessionId
When 依次发送 pty:input（写入）、pty:resize（改变 cols/rows）、之后调用 pty.kill
Then 客户端依次收到与写入对应的 pty:data、resize 后输出按新尺寸换行、kill 后收到 pty:exit
  And 全过程的消息形状/顺序语义与 MessagePort 模式一致
```

### Scenario: TC-C05（T-035）PTY 流控 ack 语义经 WS 与 MessagePort 一致
**优先级**: P1
**类型**: 功能

```gherkin
Given 客户端经 WS 建立的 PTY 会话产生了超过高水位（512KB）的未确认输出
When 客户端未发送 pty:ack
Then host 暂停该会话的输出（与 MessagePort 模式相同水位行为）
  And 客户端发送 pty:ack 使已确认字节低于低水位（128KB）后，host 恢复输出
```

### Scenario: TC-C06（T-036）git 相关 RPC 经 WS 与 MessagePort 结果一致
**优先级**: P1
**类型**: 功能

```gherkin
Given 同一 git 仓库状态
When 分别经 WS 与 MessagePort 调用 git.info / git.status / git.worktrees / git.show / git.changedFiles
Then 两条传输路径返回完全一致的结果
```

### Scenario: TC-C07（T-037）fs.readFileBinary 经 WS 返回正确 base64 载荷
**优先级**: P1
**类型**: 功能

```gherkin
Given 一个真实二进制文件（如小 PNG）
When 客户端经 WS 调用 fs.readFileBinary 读取该文件
Then 返回的 base64 内容解码后与源文件字节完全一致，size 字段正确
  And 与 MessagePort 路径读取同一文件的结果等价
```

### Scenario: TC-C08（T-038）WS 线格式为 JSON 文本帧，非二进制帧
**优先级**: P1
**类型**: 技术一致性

```gherkin
Given WS 连接已建立并完成握手
When 观测 host 与客户端之间往返的所有消息类型（含 pty:data 输出流）
Then 所有帧均为 WS text frame（JSON 文本），不存在 binary frame
  And 该口径与 project-specs/ARCHITECTURE.md 校正后的措辞（PTY 输出流，非二进制流）一致
```

---

## Layer D — 多客户端隔离（covers AC-6：sessionId + watchId + pty.kill）

> 本层验证的是**传输特有风险**：并发 WS 连接下的消息路由与归属判定，不因帧序/缓冲差异错乱——不是重新验证已有的归属校验逻辑本身。

### Scenario: TC-D01（T-039）pty:input 越权操作被忽略
**优先级**: P1
**类型**: 安全

```gherkin
Given 客户端 A、B 各自经 WS 连接同一 standalone host 并分别 spawn 了会话 sessionA / sessionB
When A 发送 pty:input，sessionId 填 sessionB
Then host 忽略该消息（sessionB 未收到该输入，B 的会话不受影响）
```

### Scenario: TC-D02（T-040）pty:resize 越权操作被忽略
**优先级**: P1
**类型**: 安全

```gherkin
Given 同 TC-D01 前置
When A 发送 pty:resize，sessionId 填 sessionB
Then host 忽略该消息，sessionB 的尺寸不变
```

### Scenario: TC-D03（T-041）pty.kill RPC 越权操作必须被拒绝 — 现代码实锤漏洞
**优先级**: P0（虽 AC-6 定级 P1，此路径为已核实的现网权限绕过，按 P0 执行）
**类型**: 安全 / 回归

```gherkin
Given 同 TC-D01 前置：A、B 各自拥有 sessionA / sessionB
When A 发起 rpc:req { method: 'pty.kill', params: { sessionId: sessionB } }
Then host 必须拒绝/忽略该请求：sessionB 存活不受影响，B 仍可正常收发 pty:data
  And 【回归门】对照 PRD-REVIEW Round3 QA-R3-1 实锤：当前 src/host/host.ts 的 `case 'pty.kill'` 分支直接调用 `pool.kill(sid)` 且 `client.sessions.delete(sid)`，
    缺少 `pty:input`/`pty:resize`/`pty:ack` 路径已有的 `client.sessions.has(sid)` 归属校验 —— 本用例在修复前必须失败（A 能杀死 B 的会话），是本 Feature dev 阶段必须闭合的显式回归门
```

### Scenario: TC-D04（T-042）fs.unwatch 越权操作被忽略
**优先级**: P1
**类型**: 安全

```gherkin
Given 客户端 A、B 各自建立 fs.watch，取得 watchIdA / watchIdB（可指向相同或不同路径）
When A 调用 fs.unwatch(watchIdB)
Then host 忽略该请求，B 的 watcher 仍存活，后续变更仍能推送给 B
```

### Scenario: TC-D05（T-043）fs:changed 不跨客户端广播
**优先级**: P1
**类型**: 安全

```gherkin
Given A、B 同时 watch 同一路径，各自持有独立 watchId
When 该路径发生变更
Then A 只收到携带 watchIdA 的 fs:changed，B 只收到携带 watchIdB 的 fs:changed
  And 两者互不收到对方的 watchId
```

### Scenario: TC-D06（T-044）clean 断开只回收自己的资源
**优先级**: P1
**类型**: 功能

```gherkin
Given A、B 各自持有会话与 watcher
When A 主动断开 WS 连接（正常关闭）
Then 仅 A 的会话被 kill、A 的 watcher 被 dispose
  And B 的会话与 watcher 不受影响，继续正常工作
```

### Scenario: TC-D07（T-045）静默断连（心跳超时）视同断开并回收
**优先级**: P1
**类型**: 异常

```gherkin
Given A 的 WS 连接进入静默状态（不发送/响应任何数据，不产生 FIN/RST，模拟进程挂起/僵死）
When 心跳超时阈值（TECH 定，PRD 未给量级，本用例先占位为「等于握手超时同量级 ~10s 的整数倍」，TECH 落定后更新）到达
Then host 判定该连接已断开，回收 A 的会话与 watcher
  And B 的会话与 watcher 不受影响
```

### Scenario: TC-D08（T-046）并发交错帧下归属判定不错乱
**优先级**: P1
**类型**: 安全 / 并发

```gherkin
Given A、B 同时对各自的 sessionId 与 watchId 发起近乎同时的操作（人为交错发送顺序，制造帧到达顺序与缓冲区状态的竞争）
When host 并发处理这些消息
Then 每条消息最终都路由到正确的归属会话/watcher，不出现 A 的操作影响到 B（或反之）的错乱
  And 该场景专门验证 PortLike→WS 包装层在真实并发压力下的路由正确性（MessagePort 单连接场景不存在此风险面）
```

---

## Layer E — 畸形输入（covers AC-7）

> 目标：防止单客户端 DoS 全部并发用户。任意畸形输入下 host 进程不崩溃，其他客户端不受影响，仅拒绝/断开发送方连接。

### Scenario: TC-E01（T-047）非 JSON 数据帧
**优先级**: P0
**类型**: 异常

```gherkin
Given 客户端 A 已建立正常 WS 连接，客户端 B 已建立正常会话且正在收发 pty:data
When A 发送一个非 JSON 的文本帧（如原始二进制垃圾数据或截断 JSON）
Then host 进程不崩溃
  And A 的连接被拒绝/断开
  And B 的会话不受影响，持续正常收发 pty:data
```

### Scenario: TC-E02（T-048）超限 payload
**优先级**: P0
**类型**: 异常 / 边界

```gherkin
Given payload 上限为 ~10MB（PRD 量级占位值，须容纳 fs.readFileBinary 的 base64 帧，TECH 定稿后同步数值）
When 客户端发送一个超过该上限的单帧消息
Then host 拒绝该消息并断开/拒绝发送方连接，进程不崩溃
```

### Scenario: TC-E03（T-049）边界对照：略低于上限的合法大帧仍成功
**优先级**: P0
**类型**: 边界（与 TC-E02 成对）

```gherkin
Given 一个略低于 payload 上限（如上限的 95%）的合法 fs.readFileBinary 响应帧
When 该帧经 WS 传输
Then 传输成功、内容完整，不被上限规则误伤
  And 本用例确保「防 DoS 的上限」与「AC-1 要求的二进制读取功能等价」不冲突
```

### Scenario: TC-E04（T-050）未知消息类型
**优先级**: P0
**类型**: 异常

```gherkin
Given 客户端 A 已建立正常连接
When A 发送一条 `t` 字段为未知值（如 'bogus:type'）的合法 JSON 消息
Then host 进程不崩溃，按契约忽略该消息或断开 A 的连接
  And 其他客户端不受影响
```

### Scenario: TC-E05（T-051）畸形 rpc:req（缺 method / 参数类型错误）
**优先级**: P0
**类型**: 异常（回归）

```gherkin
Given 客户端发送 rpc:req 但缺少 method 字段，或 params 类型与目标方法签名不符
When host 解析并分发该请求
Then 既有的 per-RPC try/catch 仍生效：返回 { ok: false, error } 而不是让进程崩溃
  And 该行为在 WS 传输下与既有 MessagePort 行为一致（回归控制）
```

### Scenario: TC-E06（T-052）综合存活性：全部畸形场景之后 host 依然可用
**优先级**: P0
**类型**: 异常（综合回归）

```gherkin
Given 依次触发 TC-E01 至 TC-E05 全部场景
When 最后一个全新的、行为正常的客户端发起连接
Then 该客户端能正常完成 token 校验、host.info 握手，并成功发起任意 RPC
  And 证明共享 host 进程在经历全部畸形输入后从未被拖垮
```

---

## Layer F — 打包产物实机冒烟（covers AC-4，门控 spike）

> AC-4 独立于其余 AC 分阶段交付：spike 结论若判定不可行则触发 D-1 兜底（tar 包 + node ≥20），本层场景对两种产物形态（单文件 / 兜底 tar 包）复用同一组断言。CI 新增此工作流不得阻塞既有 macOS 发版流水线（独立 job）。

### Scenario: TC-F01（T-053）darwin-arm64 实机：固定 listening 日志行（CI grep 判定）
**优先级**: P0
**类型**: 打包 / 实机

```gherkin
Given 打包 spike 产物（或 D-1 兜底产物）已部署到 darwin-arm64 实机
When 以 --listen 127.0.0.1:<port> 启动该产物
Then stdout 出现固定格式的 listening 日志行（如 `[host] listening ws://127.0.0.1:<port> protocol=v1`）
  And CI 通过 grep 该固定格式行判定启动成功
```

### Scenario: TC-F02（T-054）darwin-arm64 实机：node-pty 可 spawn 真实 shell
**优先级**: P0
**类型**: 打包 / 实机

```gherkin
Given TC-F01 已确认 host 正常监听
When 客户端连接并调用 pty.spawn 启动一个真实 shell
Then shell 进程成功启动，能收发真实终端输出（证明 node-pty 原生绑定在打包产物内正确加载）
```

### Scenario: TC-F03（T-055）linux-x64 实机：固定 listening 日志行（CI grep 判定）
**优先级**: P0
**类型**: 打包 / 实机

```gherkin
Given 打包 spike 产物（或 D-1 兜底产物）已部署到 linux-x64 实机（或 CI runner）
When 以 --listen 127.0.0.1:<port> 启动该产物
Then stdout 出现固定格式的 listening 日志行，CI grep 判定通过
```

### Scenario: TC-F04（T-056）linux-x64 实机：node-pty 可 spawn 真实 shell
**优先级**: P0
**类型**: 打包 / 实机

```gherkin
Given TC-F03 已确认 host 正常监听
When 客户端连接并调用 pty.spawn 启动一个真实 shell
Then shell 进程成功启动，能收发真实终端输出
```

### Scenario: TC-F05（T-057）linux-arm64 产物存在性（不要求实机验收）
**优先级**: P1
**类型**: 打包

```gherkin
Given 打包矩阵配置包含 linux-arm64 目标
When 打包流程执行完毕
Then 产出 linux-arm64 对应的构建产物（存在性检查即可，本 Feature 范围不含 linux-arm64 实机验收）
```

### Scenario: TC-F06（T-058）host 打包 CI job 不阻塞既有 macOS 发版流水线
**优先级**: P1
**类型**: 运维 / CI

```gherkin
Given 新增的 host 打包工作流已加入 CI
When 检查 workflow 的 job 依赖图
Then host 打包 job 与既有 release.yml 的 macos-14 发版 job 相互独立（无阻塞依赖）
  And 既有 macOS 发版流水线的触发条件/耗时不因本 job 存在而改变
```

### Scenario: TC-F07（T-059）【条件场景】D-1 兜底路径：tar 包 + node≥20 实机验收
**优先级**: P1（仅当 spike 在时间盒 ≤2 个工作日内被判定不可行时触发）
**类型**: 打包 / 实机 / 条件

```gherkin
Given spike 按可枚举判据（穷举 Node SEA / esbuild bundle + prebuilds 显式解包 / pkg 类工具后，目标平台仍无法加载 node-pty .node）在时间盒内被判定失败，D-1 触发兜底方案
When 按「远程机 node ≥20 + tar 包部署」方式在 darwin-arm64 / linux-x64 实机部署并启动
Then 复用 TC-F01/TC-F02/TC-F03/TC-F04 的全部断言（固定 listening 日志行 + node-pty 真实 spawn），结果一致
```

---

## Layer G — 嵌入式回归（covers AC-5，SMOKE_OK）

### Scenario: TC-G01（T-060）默认桌面启动无头冒烟零回归
**优先级**: P0
**类型**: 回归

```gherkin
Given 默认桌面启动路径（嵌入式 utilityProcess + MessagePort），本 Feature 改动已合入
When 以 TERMPRO_SMOKE=1 npx electron-forge start 运行既有无头冒烟
Then 30 秒超时内打印 SMOKE_OK 并退出（行为与本 Feature 落地前完全一致）
```

### Scenario: TC-G02（T-061）hostClient 公共 API 签名不变
**优先级**: P0
**类型**: 回归 / 契约

```gherkin
Given 传输抽象（MessagePort / WebSocket 双传输）已实现
When 检查 hostClient 对上层调用方暴露的公共方法（connect / rpc / attachPty / input / resize / ack / onDown / onFsChanged / onSessionEvent）
Then 方法名称与签名与本 Feature 落地前完全一致，调用方代码无需任何改动
```

### Scenario: TC-G03（T-062）嵌入式路径未新增往返
**优先级**: P0
**类型**: 回归 / 性能

```gherkin
Given 嵌入式 MessagePort 连接建立流程
When 统计从「渲染层请求 host 端口」到「首个可用 RPC 响应返回」之间的消息往返数
Then 该往返数与本 Feature 落地前的基线相同（版本校验/token/握手逻辑不侵入嵌入式路径，不引入新往返）
```

### Scenario: TC-G04（T-063）版本/token 校验逻辑不在嵌入式路径被调用
**优先级**: P1
**类型**: 回归 / 结构

```gherkin
Given 嵌入式 MessagePort 连接建立与首次 RPC 调用流程
When 对版本区间校验函数与 token 校验函数打桩（spy）观测调用情况
Then 两者在整个嵌入式连接生命周期内均未被调用（这两套逻辑只在 transport === 'ws' 时才会被触发）
```

---

## API E2E 判断（QA 必填）

| 项目 | 内容 |
|------|------|
| 是否需要 API E2E | ✅ 需要 |
| 原因 | 本 Feature 的交付面本质是一套对外 RPC/WS 协议（无 REST API，但 WS 上的 rpc:req/rpc:res 是等价的对外接口），必须验证真实进程、真实 socket、真实握手/鉴权/限速链路，而非仅靠 mock。Layer C（传输等价冒烟）、Layer D（多客户端隔离）、Layer E（畸形输入）、Layer F（打包实机冒烟）均以「真实 host 进程 + 真实 WS 客户端」的形态执行，属 API E2E 范畴。 |

### API E2E 前置条件

| 条件类型 | 具体内容 | 获取方式 |
|----------|----------|----------|
| 运行时环境 | Node ≥20（fs.watch 递归监听 linux 依赖项，亦为 D-1 兜底基线） | CI runner 内置 / 本地开发机版本核对 |
| standalone host 可执行产物 | Layer C/D/E 用编译后的 host bundle（非打包产物即可，`vite.host.config.ts` 构建产物）+ `--listen` 启动；Layer F 用真正打包产物（darwin-arm64 / linux-x64） | dev 阶段构建脚本自动产出 |
| 目标平台实机 | Layer F 需要 darwin-arm64 与 linux-x64 两台（或云 runner）实机 | GitHub Actions 现有 runner（ubuntu-latest 天然 linux-x64；darwin-arm64 需 macos-14 runner，release.yml 已有先例） |
| WS 客户端测试工具 | 真实 `ws` 客户端库发起连接（而非 mock MessagePort） | dev 阶段随 host 打包一并引入的 `ws` 运行时依赖，测试侧复用 |
| token 值 | 各 Scenario 按需自动生成 / host 启动时以约定信道注入 | 测试脚本自行生成随机 token 并通过信道白名单（env/stdin/fd/文件）注入 |

### API E2E Scenarios

#### API-E2E-001: 完整 WS 连接生命周期（握手 → 鉴权 → 版本校验 → 全 RPC 冒烟 → 断开回收）
**执行方式**: api（真实 `ws` 客户端 + 真实 host 进程）

```gherkin
Given standalone host 以 --listen 127.0.0.1:<port> + 随机 token 启动
When 客户端携带正确 token 建立 WS 连接，首条消息发 host.info 完成版本区间校验
  And 依次驱动 Layer C 的全 RPC 方法表 + fs.watch 推送
  And 最终主动断开连接
Then 全程无异常、无进程崩溃
  And 断开后 host 侧对应 client 表项与其 session/watcher 均被回收（无残留）
```

**验证点**:
| 验证类型 | 验证内容 | 预期值 |
|----------|----------|--------|
| 进程存活 | host 进程 pid 全程存活 | 未退出/未崩溃 |
| 资源回收 | 断开后 host 内部 client 计数 | 归零（若只有该一个连接） |
| 响应语义 | 全 RPC 表响应形状 | 与 MessagePort 基线逐项一致 |

---

## Browser E2E 判断（有 UI 时填写）

| 项目 | 内容 |
|------|------|
| 是否需要Browser E2E | ⏭️ 不适用（原因：`requires_ui: false`，本 Feature 无新 UI 设计面；版本不兼容的错误呈现复用既有错误提示机制，其 UI 回归由既有錯誤提示相关 Feature 的 Browser E2E 覆盖，不在本 TC 范围） |
| 用户是否可选择跳过 | 不适用 |

---

## 实现完整性报告（代码审查时填写）

| 需求项 | 状态 | 代码位置 | 测试位置 |
|--------|------|----------|----------|
| （dev 阶段完成后填写） | ⬜ | | |

完整性: 0/63（待 dev 阶段填写）

---

## TDD 检查（代码审查时填写）

- [ ] 测试先于实现（检查 git 提交顺序）
- [ ] 后端覆盖率 > 80%
- [ ] 前端覆盖率 > 70%
- [ ] 测试可独立运行
- [ ] 测试命名符合 Scenario 描述
- [ ] 边界条件已覆盖（版本区间闭区间边界值 / payload 上限边界 / token 信道白名单）
- [ ] 异常场景已覆盖（畸形输入三类 / 握手三种违规场景 / 静默断连）
- [ ] **T-041（pty.kill 归属校验）在修复前必须处于失败状态，是本 Feature 的显式回归门，不得跳过或标记 skip**

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-09 | v0.1 首版草稿：基于 PRD v0.3（Round 1-3 冷审收敛）起草，7 层 63 条用例，覆盖 AC-1..AC-7 全部；显式收录 Round 3 advisory：QA-R3-1（pty.kill 归属校验回归门 T-041）、QA-R3-2（区间边界值矩阵 TC-A01）、QA-R3-3（阈值占位断言口径说明）、ARCH-R3-1（token 环境变量不泄露进 PTY T-030）、ARCH-R3-2（AC-2 交付预期措辞对齐，「客户端主动断开」）。 |

```

### TECH.md
```
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
| ① QA-R3-1 pty.kill 缺归属校验 | §接口 · §TDD 步骤 | `pty.kill` 加 `client.sessions.has(sid)` 守卫;非归属静默忽略(不回错误,零信息);TC-K1/K2 覆盖;**pty.cwd 同类一并修**(TC-K3) |
| ② ARCH-R3-1 token 走 env 后抹除 | §架构 · token 生命周期 | host 读 `process.env.TERMPRO_HOST_TOKEN` 后**立即 `delete process.env.TERMPRO_HOST_TOKEN`**,再允许任何 `pool.spawn`;顺序断言进 TC-T4 |
| ③ QA-R3-2 版本区间闭区间伪代码 | §数据结构 · 版本校验 | 闭区间重叠判定 `max(Mc,Mh) ≤ min(Vc,Vh)`,给伪代码;`minCompatible` 缺省=`protocolVersion` |
| ④ 量级阈值精确值 | §常量表 | HANDSHAKE=10000ms · PING=30000ms · 限速 10 次/60s 滑窗 · **maxPayload=32 MiB**(见下,PRD ~10MB 需上修以容纳 readFileBinary 20MB→base64 ~27MB) |
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
   - **限速**(进程级连接尝试计数,**不依赖源 IP** —— loopback 全同源):滑动窗口 `AUTH_RATE_WINDOW_MS=60000` 内失败认证 ≥ `AUTH_RATE_MAX=10` → 后续连接直接 destroy 冷却一个窗口。计数只统计**失败尝试**。
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
| `AUTH_RATE_WINDOW_MS` | `60_000` | wsServer | 限速滑窗 |
| `AUTH_RATE_MAX` | `10` | wsServer | 窗内失败认证上限(PRD ~10 次/分),超限冷却一窗 |
| `WS_MAX_PAYLOAD` | `32 * 1024 * 1024`(32 MiB) | wsServer | 🔴 **上修**:PRD 量级 ~10MB,但须容纳 `fs.readFileBinary` 20MB 二进制 → base64 ≈ 27MB + JSON 封套,故取 32 MiB。此为精确落定值,取代 PRD 的 ~10MB 量级锚点 |
| `TOKEN_BYTES` | `16`(128-bit) | wsServer | `crypto.randomBytes(16)` → base64url |
| env 变量名 | `TERMPRO_HOST_TOKEN` | wsServer | 读后立即 `delete` |
| dev 开关 | `VITE_TERMPRO_REMOTE_WS` | hostClient | 值=完整 ws URL(含 token);仅 dev |

### 错误处理 / 异常路径

> 项目级风格(结构化返回、不静默吞)见 DEV-RULES §错误处理;下表为本 Feature 传输面特异失败路径。措辞统一「客户端主动断开」(⑥)。

| 场景 | 触发条件 | 处理 | 日志级别 | 幂等/重试 |
|------|---------|------|---------|----------|
| token 缺失/错误 | 认证不过 | **立即 destroy 连接,零信息**(无 body/reason) | **WARN**(`[host] ws auth rejected`,不打印 token) | 客户端可重连;host 侧限速计数 |
| 限速触发 | 窗内失败 ≥10 | 后续连接直接 destroy 冷却一窗 | **WARN** | - |
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
  H->>H: sha256+timingSafeEqual;失败→destroy(零信息)+限速计数
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

- **单元测**(vitest,可 mock):版本区间判定(纯函数,四数矩阵含边界/缺省);token 常量时间校验 + env 抹除断言;门控状态机(首条非 host.info / 超时);畸形帧不抛;限速计数。
- **集成测(真实 host 进程 · 不能 mock)**:起真实 standalone host(`--listen 127.0.0.1:0` 取随机端口)+ 真实浏览器/`ws` 客户端,跑 AC-1 全方法冒烟(pty.spawn/io/resize/kill、fs.readdir/readFile/writeFile、**fs.watch 的 fs:changed 经 WS 推送**、git.info/status);两客户端并发验 AC-6(sessionId + watchId 归属、pty.kill 跨客户端被拒);畸形/超限验 AC-7 不崩他客户端。—— 传输面契约必须真跑,不靠两端 mock。
- **契约/端到端**:嵌入式 SMOKE(`TERMPRO_SMOKE=1 npx electron-forge start` → SMOKE_OK)证 AC-5 零回归;standalone 就绪日志行 grep 证 AC-4。
- **基线失败集**:brownfield,base 无预存失败(如有,登记 `project-specs/test-baseline.md` 走「0 新增」差分)。

### 测试清单（对应 TC 用例）

| TC 用例 | 测试方法名 | 状态 |
|---------|-----------|------|
| 区间兼容:v1 双端 / 客户端超前(2,1)vs(1,1)兼容 / 弃旧(2,2)vs(1,1)不兼容 / minCompatible 缺省 | versionCompat.* | ☐ |
| 不兼容错误含双方四数 | versionCompat.incompatibleError | ☐ |
| TC-T4 env token 读后 process.env 被 delete(spawn 前) | token.envErasedBeforeSpawn | ☐ |
| token 常量时间校验(sha256+timingSafeEqual);禁 argv 明文 | token.constantTime / token.rejectArgv | ☐ |
| host.info-first:首条非 host.info → 断开 | wsGate.firstMustBeHostInfo | ☐ |
| 握手 10s 超时 → 断开回收 | wsGate.handshakeTimeout | ☐ |
| 畸形帧(非 JSON/未知 t/超 maxPayload)host 不崩、他客户端无感 | wsGate.malformedIsolated | ☐ |
| 限速:窗内 10 次失败后 destroy | wsGate.rateLimit | ☐ |
| TC-K1/K2 pty.kill 跨客户端被拒(归属校验) | wsOwnership.killNotOwner | ☐ |
| TC-K3 pty.cwd 跨客户端被拒 | wsOwnership.cwdNotOwner | ☐ |
| AC-6 两客户端 sessionId + watchId 归属隔离 | wsMultiClient.isolation | ☐ |
| AC-1 全方法 WS 冒烟含 fs.watch 推送 | wsSmoke.allMethods | ☐ |
| 心跳 pong 超时 → terminate → 回收 | wsHeartbeat.reclaim | ☐ |
| AC-5 嵌入式 SMOKE_OK 零回归 | (CI 冒烟) | ☐ |

### 实现步骤（分阶段 · 每阶段一 commit · 三绿才进)

**阶段 A — 协议 + 版本校验(纯逻辑,先落地不依赖 WS)**

| # | 步骤 | 类型 | 验证 | 状态 |
|---|------|------|------|------|
| 1 | 写区间兼容失败测试(四数矩阵) | 🔴 Red | 测试失败 | ☐ |
| 2 | protocol.ts 加 `PROTOCOL_MIN_COMPATIBLE` + `HostInfo.minCompatible` + 区间纯函数 | 🟢 Green | 测试通过 + tsc | ☐ |
| 3 | host.ts host.info 返回 minCompatible;hostClient 校验并主动断开 | 🟢 Green | 单测 + tsc | ☐ |

**阶段 B — 归属校验补齐(小而独立,先修再上 WS)**

| 4 | 写 pty.kill/pty.cwd 跨客户端被拒测试 | 🔴 Red | 失败 | ☐ |
| 5 | host.ts 两 handler 加 `client.sessions.has` 守卫 | 🟢 Green | 通过 | ☐ |

**阶段 C — token 模块**

| 6 | 写 token 生成/常量时间校验/env 读后即抹测试 | 🔴 Red | 失败 | ☐ |
| 7 | 实现 token.ts(来源解析 + 生成 + `delete process.env` + sha256 timingSafeEqual) | 🟢 Green | 通过 | ☐ |

**阶段 D — WS 传输 host 侧**

| 8 | 写门控/超时/畸形/限速测试 | 🔴 Red | 失败 | ☐ |
| 9 | 实现 wsServer.ts(loopback 强制 / token 闸 / 门控 / 心跳 / maxPayload / wsPortAdapter) | 🟢 Green | 通过 | ☐ |
| 10 | host.ts 入口 `--listen` 分流接 wsServer;打印固定日志行 | 🟢 Green | 起真实 host grep listening 行 | ☐ |

**阶段 E — client 传输抽象 + WS 实现 + 集成冒烟**

| 11 | 抽 Transport 接口 + MessagePortTransport(等价重构) | 🔵 Refactor | 嵌入式 SMOKE_OK 不变 | ☐ |
| 12 | WebSocketTransport + connect 分流(VITE_TERMPRO_REMOTE_WS) | 🟢 Green | tsc | ☐ |
| 13 | 集成测:起真实 standalone host,AC-1 全方法 + AC-6 双客户端 + AC-7 畸形 | 🟢 Green | 集成全绿 | ☐ |

**阶段 F — 打包 spike(门控 · 独立分阶段 · 见 D-1)+ CI + 文档**

| 14 | 打包 spike(时间盒 ≤2 工作日,枚举方案) | spike | darwin-arm64 + linux-x64 实机 node-pty spawn | ☐ |
| 15 | host-package.yml 独立 job(不阻塞 release.yml);ARCHITECTURE 措辞校正;engines>=20 | 🟢 Green | CI 绿且 macOS 发版 gate 不受影响 | ☐ |

> 阶段 A–E 交付 AC-1/2/3/5/6/7,**不依赖** F;阶段 F(AC-4)独立验收,spike 结论回写本 TECH 并通知 BL-003。

## 风险与缓解

| 风险 | 严重度 | 缓解 / 兜底 |
|------|--------|-----------|
| node-pty native 打包(.node/spawn-helper 加载路径、RPATH)在单文件产物内失败(WS-01 R1 最高风险) | **high** | 门控 spike 先行(时间盒 ≤2 工作日,耗尽即判失败);D-1 兜底 = node≥20 + tar 包;不阻塞 AC-1/2/3/5/6/7 合并 |
| token 经 env 被 PTY 继承泄露给子 shell | **high** | 读后立即 `delete process.env.TERMPRO_HOST_TOKEN`,置于任何 spawn 之前;TC-T4 断言顺序 |
| 门控/心跳/畸形逻辑下沉进 attachClient 侵入嵌入式路径,AC-5 回归 | **high** | 新逻辑全部夹在 wsServer/wsPortAdapter 层;attachClient 一字不改;阶段 E 步骤 11 以 SMOKE_OK 守回归 |
| 与 BL-001 同改 protocol.ts 合并冲突 | med | 本 Feature 不碰 HostMessage union;只动 HostInfo + 新常量(不同区域);后合者 rebase;版本不 bump |
| WS maxPayload 卡死 readFileBinary 大图 | med | maxPayload=32MiB 覆盖 20MB 二进制 base64;超限明确断连不静默截断 |
| 限速依赖源 IP 在 loopback 失效 | med | 按进程级连接尝试计数(不依赖 IP),已定 |
| host.info-first 门控误伤嵌入式 | low | 门控仅 WS 层生效;MessagePort 路径不引入 |
| linux fs.watch 递归依赖 node≥20 | low | engines>=20 声明 + D-1 兜底基线绑定 |

## 待决策

| 问题 | 建议 |
|------|------|
| **D-1**(条件项 · spike 触发):单文件打包被证明不可行 | 兜底 A) 远程机要求 **node≥20 + tar 包部署**(node≥20 亦是 linux fs.watch 递归下限)。**失败判据(可枚举不可主观)**:① 时间盒 **≤2 个工作日**;② 穷举方案集 **{Node SEA · esbuild/vite bundle + node-pty prebuilds 显式解包 · pkg 类工具}**;③ 任一目标平台(darwin-arm64 / linux-x64)仍无法从产物加载 node-pty `.node` / exec `spawn-helper` 即判失败。🔴 **时间盒耗尽即判失败,不因方案未试完而顺延**(PL-R3-1)。判失败 → D-1 升级为用户裁决(A 兜底 / B 继续攻延期)。在此之前 AC-4 按「spike 结论产物」验收,不阻塞其余 AC 合并 |

## 变更记录
| 日期 | 变更 |
|------|------|
| 2026-07-09 | v0.1 首版技术方案:基于 PRD v0.3 + 真实代码基线;落定 R3 全部 7 条 advisory;WS 复用 PortLike/attachClient;client Transport 抽象;闭区间版本校验;token 生命周期;打包 spike 门控 |

## 完工自查（RD 实现完逐项打钩）

**对照本 TECH 的设计落地:**
- [ ] **现状基线**:pty.kill/pty.cwd 缺归属校验、ptyPool env 继承等前提在实现时仍成立(变则回 blueprint)
- [ ] **§错误处理**:token 拒绝/门控违规/超时/不兼容/畸形/静默断连每条失败路径都实现(非只跑 happy-path)
- [ ] **错误有 WARN/ERROR 日志**:每条 catch 带 WARN/ERROR + 上下文;**token 明文绝不入日志**;不静默吞
- [ ] **§依赖与影响**:`tsc --noEmit` 零报错(HostInfo 加字段的 18 处消费方 + hostClient API 不变)
- [ ] **§数据结构**:HostInfo.minCompatible 两端一致;无 DB 变更
- [ ] **§测试策略**:集成测(真实 standalone host)写了 —— AC-1 全方法 + AC-6 双客户端 + AC-7 畸形,不靠两端 mock
- [ ] **安全**:token ≥128-bit / 常量时间比较 / env 读后即抹 / loopback 强制 / 禁 argv 明文
- [ ] **AC-5 零回归**:嵌入式 SMOKE_OK;门控/token/版本逻辑未侵入 MessagePort 路径

**通用质量门:**
- [ ] 规范符合(DEV-RULES:改契约先改 protocol.ts / host 零 Electron import / UI 不碰 fs/pty/git)
- [ ] 已有测试无回归(exit-code=0)
- [ ] build 通过 · lint pass · 改共享基建(protocol.ts)则全景编译过
- [ ] (无新 UI)
- [ ] commit message 含 Feature ID;改动文件全在 changeset 内

## 🧩 补充洞察

- **⑦ client 缓存 token 介质锚点**(PL-R3-2):host 侧不落盘/不轮换的约束**不禁止 client 缓存**已捕获 token 供重连同一存活 host。缓存**持久化介质**本 Feature 不实现(重连本身 Out of Scope,归 BL-005),但**建议锚点**:比照凭据入**系统钥匙串**(macOS Keychain / Electron `safeStorage`),不落明文磁盘。BL-003/BL-005 开工前钉死具体介质。
- **pty.cwd 归属校验是本 RD 追加**:R3 advisory 只实锤了 pty.kill,但 pty.cwd(host.ts L175-178)同属「拿 sessionId 直接操作、无归属校验」一类,WS 多连接下会泄露非归属会话 cwd。已纳入阶段 B 与 TC-K3。建议 review 时确认是否还有同类未覆盖的「以 sessionId/watchId 为参数但不校验归属」的 handler(现存仅此二处 + 已校验的 pty:input/resize/ack)。
- **maxPayload 与 PRD 量级的偏差需 review 确认**:PRD 给「~10MB」量级锚点,但 readFileBinary 上限 20MB → base64 ≈ 27MB,10MB 会卡死大图预览。本 TECH 精确落定 **32 MiB**,属对 PRD 量级的必要上修(PRD 本就授权「上限 TECH 定」),非违背 —— 请 review 知悉此数值决策。
- **Transport 抽象放 shared 与否**:区间判定纯函数建议放 `shared/`(两端 + 测试复用);`Transport` 接口本身是 renderer 内部实现细节,放 hostClient 同文件即可,不必上升到 shared 契约(避免过度抽象)。

```


🔴 不允许读取以下文件（污染独立性）：
- PRD-REVIEW.md / TC-REVIEW.md / TECH-REVIEW.md
- discuss/*
- review-arch.md / review-qa.md / pmo-internal-review.md
- 其他 external-cross-review/* 内的同类产物

## Checklist（按 target 选用）

### PRD 变体（target=prd）
- C1 需求完整性：业务流程的未覆盖分支？用户故事里未定义的角色/状态？"待决策项"里该当下决策的事项？
- C2 验收标准可测性：每条 AC 能被具体测试验证吗？"流畅/友好/直观"等不可量化词？AC 之间逻辑冲突？
- C3 边界场景覆盖：空值/极值/并发/超时/网络异常覆盖了吗？权限边界明确吗？数据量上限？
- C4 业务流程自洽：流程图每条分支都有终止？状态流转每个状态可达可退出？与既有产品功能冲突/重复？
- C5 需求-实现合理性：有隐含过度复杂实现？有无更简方案达成相同价值？埋点覆盖关键漏斗？
- C6 未明示假设：PRD 隐含的"默认这样就行"假设有哪些？这些假设是否曾被证伪？

### Blueprint 变体（target=blueprint）
- C1 TC↔AC 映射完整性：每条 AC 在 tests[].covers_ac 都被引用？有 AC 只 1 条测试？有引用不存在的 AC？
- C2 TC 可执行性：每条 TC 前置条件明确？"做什么→期望什么"具体？需人类判断的标注了手工测试？
- C3 边界与失败用例：成功/失败/边界路径比例合理（非成功 ≥30%）？并发/超时/异常/降级有 TC？
- C4 TECH 架构一致性：与 ARCHITECTURE.md 既有模式一致？引入未记录的新依赖/模式？隐含循环依赖？
- C5 TECH 可行性与风险：关键技术选型有替代方案对比？有"看似简单实际复杂"的工作量？性能/安全/可观测性显式考虑？
- C6 TC↔TECH 对齐：TECH 关键接口都有对应测试？TECH 异常处理有对应失败路径 TC？

### 代码变体（target=code）
- C1 实现 vs TECH 一致性：代码与 TECH 中描述的关键路径是否一致？数据结构字段与 TECH 中定义匹配？
- C2 错误处理：错误码 / 异常处理 / 降级路径覆盖完整？有"假设永远成功"的代码段吗？
- C3 边界条件：空值/极值/并发/超时？认证/权限/输入校验？资源清理（fd / db connection / lock）？
- C4 KNOWLEDGE 约束：项目级 KNOWLEDGE.md 中标注的 Gotcha/Convention 是否被遵守？
- C5 测试覆盖：每条 AC 都有 test？测试粒度合理（不是过粗的"实现 X 模块"）？mock 是否合理（不掩盖真问题）？
- C6 可观测性：关键路径有日志？日志含足够定位信息？无敏感信息泄露？

## 输出格式

🔴 输出必须是合法 YAML frontmatter + Markdown body。frontmatter schema：

\`\`\`yaml
---
perspective: external-claude
target: {prd | blueprint | code}
generated_at: "{ISO 8601 UTC}"
files_read:
 - {只列实际读过的文件}
model: "claude-sonnet-{version}"
findings:
 - id: CR-1
 checklist: C1
 severity: blocker | high | low | info
 location: "{具体定位，如 PRD.md AC-3 / TECH.md L42 / src/api/user.ts:18}"
 issue: "{问题描述，1-2 句}"
 rationale: "{为什么是问题，1-2 句证据}"
 suggestion: "{建议改法，可执行}"
findings_summary:
 blocker: 0
 high: 0
 low: 0
 info: 0
 total: 0
---

# 详情（可选，人读补充）
\`\`\`

## 硬约束

- 🔴 你是外部独立视角，禁止参考其他角色（PM/Designer/QA/RD/PMO/Architect）已写的评审草稿
- 🔴 每条 finding 必须七字段齐备
- 🔴 findings 全空 → 触发主对话二次挑战，不视为"通过"
- 🔴 blocker ≥5 → 不机械输出，标注"疑似系统性问题，建议主对话用户决策"
- 🔴 输出仅 YAML frontmatter + body，不要附加任何对话语气文本（如"我已经审查完毕"）