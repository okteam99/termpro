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
  - id: T-041b
    file: src/host/__tests__/wsMultiClientIsolation.test.ts
    function: test_AC6_pty_cwd_rpc_wrong_owner_rejected
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
    file: .github/workflows/host-package.yml
    function: darwin_arm64_listening_log_line_grep
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P0
  - id: T-054
    file: .github/workflows/host-package.yml
    function: darwin_arm64_node_pty_real_shell_spawn
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P0
  - id: T-055
    file: .github/workflows/host-package.yml
    function: linux_x64_listening_log_line_grep
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P0
  - id: T-056
    file: .github/workflows/host-package.yml
    function: linux_x64_node_pty_real_shell_spawn
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P0
  - id: T-057
    file: .github/workflows/host-package.yml
    function: linux_arm64_artifact_present_no_real_machine_run
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P1
  - id: T-058
    file: .github/workflows/host-package.yml
    function: host_package_job_independent_of_macos_release_gate
    covers_ac: ["AC-4"]
    level: api-e2e
    priority: P1
  - id: T-059
    file: .github/workflows/host-package.yml
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
| AC-6 | 多客户端隔离（sessionId + watchId + pty.kill/pty.cwd 归属校验 + 静默断连） | P1 | T-039, T-040, T-041, T-041b, T-042, T-043, T-044, T-045, T-046 | ✅ |
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

### Scenario: TC-D03b（T-041b）pty.cwd RPC 越权读取必须被拒绝 — 现代码同类漏洞
**优先级**: P0（同 TC-D03，已核实的现网信息泄露路径）
**类型**: 安全 / 回归

```gherkin
Given 同 TC-D01 前置：A、B 各自拥有 sessionA / sessionB
When A 发起 rpc:req { method: 'pty.cwd', params: { sessionId: sessionB } }
Then host 必须拒绝该请求：不返回 sessionB 的 cwd（返回 null 或忽略），不泄露 B 的工作目录
  And 【回归门】对照 TECH §接口（本 RD 追加发现）：当前 src/host/host.ts 的 `case 'pty.cwd'` 分支直接 `pool.pid(sid)`→`processCwd` 无 `client.sessions.has(sid)` 校验，
    与 pty.kill 同源缺口 —— 本用例在修复前必须失败（A 能读到 B 的 cwd），dev 阶段与 pty.kill 归属守卫一并闭合
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
Given payload 上限为 32MiB（TECH 已落定：readFileBinary 20MB 二进制转 base64 约 27MB，须容纳，故上修 PRD 的 ~10MB 量级占位）
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
