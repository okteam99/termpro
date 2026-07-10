---
feature_id: "TERMPRO-F260710042746-Reconnect-Continuity"
status: draft
tests:
  - id: T-001
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: standalone_session_survives_client_disconnect_proc_keeps_running
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-002
    file: src/host/__tests__/ptyPoolDetach.test.ts
    function: detached_session_bypasses_flowcontrol_proc_not_paused_ring_fills
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-003
    file: src/host/__tests__/ptyPoolDetach.test.ts
    function: embedded_mode_client_close_kills_session_zero_regression
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-004
    file: src/host/__tests__/ptyPoolDetach.test.ts
    function: embedded_mode_allocates_no_scrollback_ring_memory_purity
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-005
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: reconnect_incremental_replay_gap_only_no_double_write
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-006
    file: src/host/__tests__/ringBuffer.test.ts
    function: sliceFrom_absolute_offset_returns_incremental_gap
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-007
    file: src/host/__tests__/ringBuffer.test.ts
    function: gap_exceeds_buffer_falls_back_to_full_replay_flag
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-008
    file: src/host/__tests__/ringBuffer.test.ts
    function: eviction_and_slice_align_to_utf8_boundary_no_split_sequence
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-009
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: session_list_discovers_existing_sessions_after_reconnect
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
  - id: T-010
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: session_attach_adopts_same_pid_no_respawn_io_restored
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
  - id: T-011
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: session_list_snapshot_reconciles_badge_running_to_idle
    covers_ac: ["AC-5"]
    level: integration
    priority: P0
  - id: T-012
    file: src/host/__tests__/sessionTrackerSnapshot.test.ts
    function: snapshot_getter_exposes_state_quiet_altscreen_exitcode_no_unread_count
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-013
    file: src/renderer/services/__tests__/reconnectBackoff.test.ts
    function: exponential_backoff_auto_reconnect_and_manual_retry_resets
    covers_ac: ["AC-6"]
    level: unit
    priority: P1
  - id: T-014
    file: src/renderer/services/__tests__/reconnectBackoff.test.ts
    function: reconnect_failure_keeps_banner_and_continues_backoff
    covers_ac: ["AC-6"]
    level: unit
    priority: P1
  - id: T-015
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: attach_without_token_rejected_at_ws_gate
    covers_ac: ["AC-8"]
    level: integration
    priority: P0
  - id: T-016
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: new_client_empty_set_can_attach_existing_session_by_sessionid
    covers_ac: ["AC-8"]
    level: integration
    priority: P0
  - id: T-017
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: session_count_cap_rejects_new_spawn_never_evicts_running
    covers_ac: ["AC-9"]
    level: integration
    priority: P1
  - id: T-018
    file: src/host/__tests__/ringBuffer.test.ts
    function: per_session_ring_byte_cap_bounded_evicts_oldest_bytes
    covers_ac: ["AC-9"]
    level: unit
    priority: P1
  - id: T-019
    file: src/renderer/services/__tests__/hostClientReconnect.test.ts
    function: reconnect_resets_down_and_connectpromise_preserves_perhost_structure
    covers_ac: ["AC-10"]
    level: unit
    priority: P0
  - id: T-020
    file: src/renderer/services/__tests__/hostClientReconnect.test.ts
    function: markdown_fork_local_terminal_vs_remote_triggers_reconnect
    covers_ac: ["AC-10"]
    level: unit
    priority: P0
  - id: T-021
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: idempotent_adoption_existing_sessionid_hit_no_double_spawn
    covers_ac: ["AC-11"]
    level: integration
    priority: P0
  - id: T-022
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: adoption_reattach_resize_reconciles_terminal_dimensions
    covers_ac: ["AC-11"]
    level: integration
    priority: P0
  - id: T-023
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: session_exit_during_disconnect_retained_exited_with_scrollback_and_exitcode
    covers_ac: ["AC-12"]
    level: integration
    priority: P0
  - id: T-024
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: exited_session_listed_and_replays_final_output_and_completed_badge
    covers_ac: ["AC-12"]
    level: integration
    priority: P0
  - id: T-025
    file: src/host/__tests__/ptyPoolDetach.test.ts
    function: exited_residency_same_lifetime_no_short_timer_only_pressure_evicts
    covers_ac: ["AC-12"]
    level: integration
    priority: P0
  - id: T-026
    file: src/renderer/services/__tests__/heartbeatDetect.test.ts
    function: app_heartbeat_timeout_detects_disconnect_within_bounded_T
    covers_ac: ["AC-13"]
    level: unit
    priority: P1
  - id: T-027
    file: src/renderer/services/__tests__/heartbeatDetect.test.ts
    function: heartbeat_interval_timeout_env_injectable
    covers_ac: ["AC-13"]
    level: unit
    priority: P1
  - id: T-028
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: last_attach_wins_ownership_transfer_output_routes_to_new_owner
    covers_ac: ["AC-14"]
    level: integration
    priority: P0
  - id: T-029
    file: src/host/__tests__/reconnectContinuity.integration.test.ts
    function: prior_owner_input_rejected_after_ownership_transfer
    covers_ac: ["AC-14"]
    level: integration
    priority: P0
  - id: T-030
    file: src/renderer/services/__tests__/reconnectSuppressDrop.test.ts
    function: transient_disconnect_suppresses_full_drop_keeps_terminal_and_workspace
    covers_ac: ["AC-15"]
    level: unit
    priority: P0
  - id: T-031
    file: src/renderer/services/__tests__/reconnectSuppressDrop.test.ts
    function: definite_disconnect_over_budget_triggers_bl004_full_drop
    covers_ac: ["AC-15"]
    level: unit
    priority: P0
  - id: T-032
    file: src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts
    function: readopt_full_resets_incremental_no_reset_renderedbytes_by_host_bytes_no_double_write
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-033
    file: src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts
    function: readopt_found_false_falls_back_to_new_spawn
    covers_ac: ["AC-11"]
    level: unit
    priority: P0
  - id: T-034
    file: src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts
    function: readopt_snapshot_reconciles_badge_running_to_idle
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-035
    file: src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts
    function: readopt_exited_snapshot_renders_completed_badge_no_double_write
    covers_ac: ["AC-12"]
    level: unit
    priority: P0
  - id: T-036
    file: src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts
    function: readopt_rebuilds_tab_from_session_list_when_local_instance_gone
    covers_ac: ["AC-4"]
    level: unit
    priority: P1
  - id: T-037
    file: src/host/__tests__/ptyPoolDetach.test.ts
    function: session_cap_evicts_oldest_exited_by_exit_time_live_survive
    covers_ac: ["AC-9"]
    level: integration
    priority: P1
  - id: T-038
    file: src/renderer/services/__tests__/hostClientReconnect.test.ts
    function: missing_capabilities_skips_list_attach_falls_back_new_spawn
    covers_ac: ["AC-8"]
    level: unit
    priority: P1
  - id: T-039
    file: src/main/remote/__tests__/residency.test.ts
    function: reconnect_claim_transient_probe_failure_retries_reuses_alive_host_no_reap
    covers_ac: ["AC-12"]
    level: unit
    priority: P1
---

# 断线重连与会话连续性（BL-005） - 测试用例

## 状态
草稿

---

## Feature: 断线重连与会话连续性

作为**用远程机跑长任务（build/agent/训练）的用户**
我希望**合盖/断网/切网导致 UI 断开时远端会话继续运行，重连后自动回到断开前的屏幕与状态**
以便**远程开发像本地一样连续，不用担心一断线就前功尽弃**

---

## 需求覆盖矩阵

> 反查 PRD frontmatter `acceptance_criteria[]`（14 条·AC-7 已折入 AC-6）。verify-ac.py 机器校验。

| AC ID | 需求描述 | 优先级 | 层级 | 覆盖测试 | 状态 |
|-------|---------|--------|------|----------|------|
| AC-1 | detached 会话不被 kill·旁路流控续跑·环形缓冲填充 | P0 | integration | T-001, T-002 | ✅ |
| AC-2 | 本地嵌入式零回归（close 仍 kill·不分配缓冲） | P0 | integration/unit | T-003, T-004 | ✅ |
| AC-3 | 增量回放 gap·不双写·安全边界不切序列 | P0 | integration/unit | T-005, T-006, T-007, T-008, **T-032** | ✅ |
| AC-4 | session.list 发现 + attach 收养（非新 spawn·含重建 tab） | P0 | integration/unit | T-009, T-010, **T-036** | ✅ |
| AC-5 | session.list 状态快照对账徽标 | P0 | integration/unit | T-011, T-012, **T-034** | ✅ |
| AC-6 | 重连横幅 + 指数退避 + 手动重试·失败保持横幅（含原 AC-7） | P1 | unit | T-013, T-014 | ✅ |
| AC-8 | authz=token 闸 + 跨重连 sessionId 重绑（非 per-client Set）+ 旧 host 能力位退化 | P0 | integration/unit | T-015, T-016, **T-038** | ✅ |
| AC-9 | 字节上限 + 会话数上限·溢出拒新建不逐运行·逐最旧 exited | P1 | integration/unit | T-017, T-018, **T-037** | ✅ |
| AC-10 | 显式 reconnect 路径·markDown 本地/远程分叉 | P0 | unit | T-019, T-020 | ✅ |
| AC-11 | 幂等收养防双 spawn + reattach resize 对账 | P0 | integration/unit | T-021, T-022, **T-033** | ✅ |
| AC-12 | 断线期退出留存（exited 态·同存活寿命·北极星） | P0 | integration/unit | T-023, T-024, T-025, **T-035, T-039** | ✅ |
| AC-13 | 断线检测有界时延 T≤10s·心跳 env 可注入 | P1 | unit | T-026, T-027 | ✅ |
| AC-14 | 多端 last-attach-wins 单所有者转移 | P0 | integration | T-028, T-029 | ✅ |
| AC-15 | 瞬时断线抑制 BL-004 full drop·确定才 drop | P0 | unit | T-030, T-031 | ✅ |

覆盖率: 14 / 14 (100%)·39 test（v0.2 补 8·冷审收口）

> 🔴 **非 UI 表征的 AC**（AC-8 authz / AC-9 资源上限 / AC-11 幂等收养 / AC-14 多端）均用 **host 集成测（wsTestHarness 真 pty/ws 可真跑）** 或单测覆盖·非「无法测」。

---

## 测试场景

### Scenario: TC-001 detached 会话断开期续跑（AC-1）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given standalone host（mode='standalone'·harness startTestHost({mode:'standalone'})）有一个活跃会话正在跑长任务（持续输出）
When 该会话的客户端连接断开（ws close·模拟合盖/断网）
Then 会话不被 kill（core.pool.pid(sid) 仍非空·白盒经 HostCore.pool 观测）
 And 断开期产出的新字节**可经重连 attach 回放**（协议侧可证「续跑 + 入 ring」——重连 attach 看到断开期字节）
```

> 🔴 **「不 proc.pause 憋停」判据不在此**（协议侧「不 pause」与「ring 有界驱逐」难区分·QA-B-9）→ 归 TC-002 行为断言（onData 越水位持续发射）。本 TC 只留协议侧可证的「断开期字节可回放」。

---

### Scenario: TC-002 detached 旁路流控·进程不被憋停（AC-1）
**优先级**: P0 | **类型**: 边界 | **测试层级**: integration

```gherkin
Given standalone 会话 detached（attached=false）
When 断开期输出累计远超 FLOW.highWatermark（512KiB·无客户端 ack）
Then proc.onData **持续发射越过水位**（🔴 行为断言·非白盒读私有 paused——现码 ptyPool:88-91 paused 即 proc.pause() 停 onData·故 onData 持续发射 ⇔ 未 pause·QA-B-2）
 And （对照组）embedded/attached 会话同灌 ~512KiB 后 onData 停顿（证旁路流控确实分叉）
 And 环形缓冲作消费端吸收输出（超容量按字节从头驱逐·有界·startOffset 单调前移）
 And 进程 pid 全程存活
```

> 🔴 **可观测量钉死为行为**（QA-B-2）：`paused` 是 ptyPool 私有字段无 getter·白盒断言无路可断·且偷懒实现可置假标志骗过白盒而真调 proc.pause()。行为断言（onData 越水位续发）天然防幽灵。若仍要白盒须加 PtyPool test seam（`isPaused(sid)`）并在此明写。**另断言 detach-已-paused 复活**：先灌 >512KiB 不 ack 把会话打到 paused → 再 detach → 断言 onData 恢复发射（`proc.resume()` 生效·ARCH-B-3）。

---

### Scenario: TC-003 本地嵌入式零回归·close 仍 kill（AC-2）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 本地嵌入式 host（mode='embedded'·显式形态标志）有活跃会话
When 客户端端口 close（窗口关/⌘R 重载）
Then 会话照常被 kill 回收（pool.pid 变 null·与改造前一致）
 And onExit 立即 delete 会话（不转 exited 态）
```

---

### Scenario: TC-004 本地嵌入式不分配 scrollback 缓冲（AC-2·内存纯度）
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given PtyPool 以 mode='embedded' 构造
When spawn 一个会话
Then 该会话不分配环形缓冲（ring===null）
 And 该会话不进 session.list 快照（嵌入式无重连语义）
```

---

### Scenario: TC-005 重连增量回放 gap·不双写（AC-3）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 远程会话闪断（本地已渲染绝对偏移 = renderedBytes·断开期又产出新字节）
When 客户端 reconnect 并 session.attach（携 resumeOffset=renderedBytes）
Then host 只回放 [resumeOffset, absoluteOffset) 的 gap（full=false）
 And baseOffset === resumeOffset·nextOffset === absoluteOffset（host 契约侧·gap 起点/终点对）
```

> 🔴 **按层拆（QA-B-1）**：本集成测 TestClient 非 xterm·只证 **host 发的 gap 契约对**（baseOffset/nextOffset/full）·**证不了 renderer 不双写**。「本地已有 scrollback 不被重写·无双写」的渲染半侧断言在 **T-032 渲染层单测**（reset-vs-增量 + bytes 记账·含 CJK）。

---

### Scenario: TC-006 环形缓冲绝对偏移增量切片（AC-3）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given RingBuffer 已 push 若干字节·absoluteOffset=N·startOffset=S
When sliceFrom(offset)（S ≤ offset ≤ N）
Then 返回 {full:false, baseOffset:offset, data:缓冲[offset-S ..]}
```

---

### Scenario: TC-007 gap 超缓冲回退全量清屏（AC-3）
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given RingBuffer 最旧字节已被挤出（startOffset > 0）
When sliceFrom(offset) 且 offset < startOffset（游标不在缓冲内）
Then 返回 {full:true, baseOffset:startOffset, data:整缓冲}（renderer 须先 term.reset 清屏）
```

---

### Scenario: TC-008 安全边界截断不切坏 UTF-8 码点（AC-3·QA-6·收窄）
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 环形缓冲驱逐点 / 回放切片点落在**多字节 UTF-8 码点**中段
When 计算驱逐点 / 切片起点
Then 边界前移到下一个完整码点起点（无状态·看高位 bit·不产生半个码点）
```

> 🔴 **收窄到 RingBuffer 真正实现的性质（ARCH-B-7/QA-B-3）**：ring 只存字节·**不解析 CSI/OSC 转义语法**（跨 chunk 转义态拿不到·内建 parser 是 YAGNI）。故 CSI/OSC 完整性**不**由本单测背——改由 **full 回退路径**兜底：驱逐落在 CSI/OSC 中段 → 判据「游标不在缓冲内」→ `full=true` 清屏全量 + `proc.resize` 逼重绘。TC-007 已覆盖 full 回退契约；CSI/OSC 例断言改为「**full 回退不产生持续错乱**」（顶部残序列经 term.reset 后仅影响最旧一行·altscreen 由 resize 重绘覆盖）·可在集成测（chunk 边界 attach 走 full 路径）验证·不要求 ring 内建 parser。

---

### Scenario: TC-009 session.list 发现现存会话（AC-4）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 远程 host 有 2 个现存会话（断开前 spawn）
When 客户端重连后调 session.list
Then 返回 2 个 SessionSnapshot（含 sessionId/cwd/title/status/state）
```

---

### Scenario: TC-010 session.attach 收养同 pid 非重 spawn（AC-4）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 现存会话 sid（pid=P）
When 客户端 session.attach(sid, resumeOffset, cols, rows)
Then found=true·不新起 PTY（pool.pid(sid) 仍 === P·非重 spawn）
 And ptyPool.reattach 重绑 send 到新客户端·输入输出恢复双向
```

---

### Scenario: TC-011 状态快照对账徽标 running→idle（AC-5）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 断开期间会话任务完成（tracker state running→idle）
When 重连调 session.list
Then 快照 state='idle'（当前态·非事件流补发·host 契约侧）
 And 快照不含未读 bell/notify 累积字段（sessionTracker 无计数器）
```

> 🔴 **按层拆（QA-B-1）**：集成测只证 `snapshot.state==='idle'`（host 契约）·**证不了徽标对账**。「renderer 据快照消除过期 running 残留」的渲染断言在 **T-034 渲染层单测**。

---

### Scenario: TC-012 tracker 快照 getter 暴露当前态（AC-5·VERIFY-4）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given SessionTracker 收到 osc133 running / quiet / altscreen on / cmd-done exitCode 序列
When 调 snapshot()
Then 返回 {state, quiet, altscreen, exitCode}（altscreen/quiet 现被存储可查询）
 And 快照不含任何未读计数字段（M-1）
```

> 🔴 **exitCode 双源歧义（QA-B-7·别接错线）**：`tracker.snapshot().exitCode` = **最近一条命令**退出码（OSC133 D·`sessionTracker.ts:97`）·**不是** `SessionSnapshot.exitCode` 的来源。AC-12「✓ exit N」徽标的 `SessionSnapshot.exitCode` 来自**进程 onExit**（`ptyPool.ts:95`）——见 TC-023/024 的独立进程退出码断言。dev 勿把 `SessionSnapshot.exitCode` 从 tracker 取。

---

### Scenario: TC-013 指数退避自动重连 + 手动重试（AC-6）
**优先级**: P1 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 断线判定触发（reconnectController 进 reconnecting 态）
When 自动重连连续失败
Then 退避间隔按 base×2^n 增长（cap 30s）·横幅呈现「第 n 次·Xs 后重试」
 And 手动「立即重试」复位退避计数并立即触发一次
```

---

### Scenario: TC-014 重连失败保持横幅继续退避（AC-6·原 AC-7）
**优先级**: P1 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 远程 host 仍不可达
When 重连尝试失败
Then 横幅保持（不消失）·继续退避/手动重试
 And 超重连预算（默认 8 次/~2min）→ 判「确定断线」→ 触发 full drop
```

---

### Scenario: TC-015 无 token attach 被 ws 闸拒（AC-8·安全）
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given standalone host 有现存会话
When 客户端不带 token（或错误 token）尝试连接并 attach
Then ws upgrade 层 socket.destroy（零信息·到不了 attach handler）
 And 现存会话不受影响
```

---

### Scenario: TC-016 新 client 空 Set 可按 sessionId 重绑（AC-8·QA-2）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 会话 sid 由旧 client 断开（新重连 client 的 sessions Set 为空）
When 新 client（过 token 闸）session.attach(sid)
Then 收养成功（归属守卫改按 sessionId 跨重连重绑·非 per-client Set 拦死）
 And attach 后新 client 拥有 sid·可 input/resize/ack
```

---

### Scenario: TC-017 会话数上限拒新建不逐运行（AC-9·QA-7）
**优先级**: P1 | **类型**: 边界 | **测试层级**: integration

```gherkin
Given 会话数已达上限（TERMPRO_MAX_SESSIONS·env 注入调小）且无 exited 可逐
When 再 spawn 新会话
Then 拒绝新建（rpc:res ok:false + WARN 日志）
 And 绝不逐出任何运行中会话（既有 live 会话 pid 全存活）
 And 用户手动 kill 腾位后可再新建
```

---

### Scenario: TC-018 每 session 环形缓冲字节上限有界（AC-9）
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given RingBuffer capacityBytes=C（env 可注入）
When push 累计远超 C
Then 缓冲字节数始终 ≤ C（超限从头驱逐最旧·防泄漏）
 And startOffset 随驱逐单调前移
```

---

### Scenario: TC-019 显式 reconnect 复位并保 per-host 结构（AC-10·ARCH-2）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given hostClient 曾 connect 成功后断线（down 或 connectPromise 陈旧）
When 调 reconnect({wsUrl})
Then down 复位 false·connectPromise 复位·关旧 transport·重开新 transport
 And per-host 结构保留（sessionListeners/workspaceListeners/fsListeners 不被清·区别 dispose）
```

---

### Scenario: TC-020 markDown 本地终结 vs 远程触发重连分叉（AC-10）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 本地嵌入式 client（reconnectable=false）与远程 client（reconnectable=true）
When transport onClose 触发
Then 本地：markDown 终结（进程真死·down=true·拒 rpc·现语义）
 And 远程：进 reconnecting 态触发重连（非终结·不永久拒 rpc）
```

---

### Scenario: TC-021 幂等收养防双 spawn（AC-11·ARCH-9）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 心跳假死窗口（旧连接未 reap）·renderer 记住 sessionId sid
When 重连先 session.attach(sid)
Then found=true 即收养（不 new spawn·不重复起 PTY）
 And host 侧该 sid 仍是同一 PTY（无第二个 pid）
```

---

### Scenario: TC-022 收养后 resize 对账尺寸（AC-11·QA-12）
**优先级**: P0 | **类型**: 边界 | **测试层级**: integration

```gherkin
Given 断开期终端尺寸变化（新 cols/rows ≠ spawn 时）
When session.attach(sid, resumeOffset, newCols, newRows)
Then reattach 内对该 PTY 执行 proc.resize(newCols,newRows)
 And 逼 TUI 按新尺寸重绘（回放错行被纠正）
```

---

### Scenario: TC-023 断线期退出留存 exited 态（AC-12·北极星·QA-1 BLOCKER）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given standalone 会话在断线期间以 exit 3 退出（build 跑完/崩溃·harness startTestHost({mode:'standalone'})）
When onExit 触发（客户端已断开）
Then 会话未当场蒸发——转 exited 态保留最终 scrollback + 退出码
 And 会话仍在 pool（未 delete·session.list 仍列出 status=exited）
 And 🔴 snapshot.exitCode===3 来自**进程 onExit**（ptyPool:95·与任何 cmd-done exitCode 无关·QA-B-7）
 And 本机嵌入式同场景仍立即回收（mode 分叉·零回归）
```

---

### Scenario: TC-024 exited 会话重连回放最终输出 + 已完成徽标（AC-12）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given exited 会话（保留了 build 完成日志 + exitCode=0）
When 客户端重连 session.list + session.attach
Then 快照 status='exited'·exitCode=0（host 契约侧）
 And attach 回放最终 scrollback（data 含完成日志字节·full/gap 契约对）
```

> 🔴 **按层拆（QA-B-1）**：集成测证 host 回放字节/快照·**证不到徽标**。「renderer 打『✓ exit 0 已完成』徽标（非空白/会话消失）」的渲染断言在 **T-035 渲染层单测**。

---

### Scenario: TC-025 exited 驻留寿命=与存活会话同·无短时窗（AC-12·H-1）
**优先级**: P0 | **类型**: 边界 | **测试层级**: integration

```gherkin
Given exited 会话已保留
When 时间流逝（无客户端 attach·模拟深夜 build 完成→早晨回来）
Then 该 exited 会话不因任何独立短时窗被删（无时间型 reap）
 And 仅在字节/会话数压力下才被逐（计数驱逐先逐最旧 exited·永不逐 live）
```

---

### Scenario: TC-026 app 层心跳有界时延判断线（AC-13·QA-5）
**优先级**: P1 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given renderer app 层心跳（remote client·周期 host.info 探活·🔴 走 transport 注入 seam·喂「静默不回」fake transport·QA-B-8）
When 传输挂起（模拟合盖·onclose 不及时）
Then 心跳超时在有界 T 秒内（目标 T≤10s）判定断线并触发横幅
 And 不等 TCP onclose（可数分钟）
```

> 🔴 **注入 seam（QA-B-8）**：`hostClient.connect()` 现自建 MessagePort/WebSocket 无注入点·要单测「host.info 探活超时→判断线」须把心跳逻辑抽成纯模块 / 注入「静默不回」fake transport·否则 TC-026/027 只能整成 integration（与 `level: unit` 矛盾）。TECH §测试策略已声明该 seam。

---

### Scenario: TC-027 心跳周期/超时 env 可注入（AC-13·M-3）
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 心跳 interval/timeout 经 env（照 wsServer pingIntervalMs 惯例）注入
When 测试注入极短周期
Then 断线检测按注入值加速·可 BDD 有界断言（非硬编码 10s 等不起）
```

> 🔴 **真机门禁**：合盖/断网/切网真机时序（隧道断恢复边界·30s 假死窗）沙箱测不了 → 见下 FE-E2E-001 **发版前真机 spike（manual）**。

---

### Scenario: TC-028 多端 last-attach-wins 输出转移（AC-14·QA-3）
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 会话 sid 已被客户端 A attach（A 是 owner）
When 客户端 B session.attach 同一 sid
Then send 转移到 B（B 成新 owner·last-attach-wins）
 And 会话后续输出路由到 B（B 的 ptyData[sid] 增长）
 And 🔴 **B attach 后 A 的 ptyData[sid] 不再增长**（否定断言·区分「转移」vs「被禁的扇出」——错误的扇出实现同时发 A+B 也能过「B 收到」·QA-B-6）
```

---

### Scenario: TC-029 转移后旧 owner 输入被拒（AC-14）
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given A attach sid 后 B attach 同 sid（所有权已转移到 B）
When A 再对 sid 发 pty:input
Then A 的 input 被归属守卫拒绝（A 的 sessions Set 已被移除 sid）
 And B 的 input 正常生效
```

---

### Scenario: TC-030 瞬时断线抑制 full drop（AC-15·QA-10·D-13·CR-1 接线层）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit（🔴 **接线层非纯 mock**·覆盖 disconnect-first 自发事件 × Sidebar 900ms 计时器两半接线·消 CR-1 测盲区）

```gherkin
Given 远程 host 瞬时断线（未超重连预算·非机器删除）
 And reconnectController 已同步先占 reconnecting 态（isReconnecting=true）再调 disconnect-first
When disconnect-first 致 orchestrator 自发广播 disconnected 事件
 And 时间推进超过 900ms（DISCONNECT_PANEL_MS·隧道重建耗时数秒）
Then Sidebar 900ms drop 计时器因 isReconnecting gate 不启动 → 不调 stopRemoteWorkspaceSync（抑制 full drop）
 And reconnectController 的 disconnected 订阅命中再入守卫（不 loop）
 And 该 host workspace 呈「重连中」态保留（非从 Sidebar 消失）·保活终端实例
```

---

### Scenario: TC-031 确定断线才走 BL-004 full drop（AC-15）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 重连预算耗尽（或机器被删除）判「确定断线」
When reconnectController 决策
Then 走 stopRemoteWorkspaceSync（dropHostWorkspaces + disposeTerminal + drop client）
 And 恢复 BL-004 既有 full-drop 行为（仅前移触发判据·不回归）
```

---

### Scenario: TC-032 readoptHost 渲染层不双写·reset-vs-增量·bytes 记账（AC-3·QA-B-1·北极星渲染半侧）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit
**文件**: `src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts`（🆕 dev 建真实文件·防幽灵覆盖）

```gherkin
Given test-double xterm（记录每次 write 的字节·可断言 reset 调用）+ fake client 返回 {found,full,baseOffset,nextOffset,data,snapshot}
When readoptHost 对一个持 sessionId 的 inst 收养
Then full=true → 先调 term.reset() 再写 data；full=false → **不**调 term.reset()·仅增量 write
 And renderedBytes 前进量 === host `bytes` 字段（喂一个 **bytes≠data.length 的 CJK/emoji chunk**·断言用 bytes 累加不用 data.length·否则 CJK 场景偏移错位）
 And renderedBytes 收养后 === result.nextOffset（权威赋值·非自算 byteLength·EXT-B-5）
 And 重连 attach 的 resumeOffset === 收养前 renderedBytes（host 只回放 gap·已有字节不重复渲染·无双写）
```

---

### Scenario: TC-033 readoptHost found=false 退化 new spawn（AC-11·幂等收养 miss）
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit
**文件**: `src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts`

```gherkin
Given fake client session.attach 返回 found=false（sessionId 已被逐出/从未有）
When readoptHost 处理该 inst
Then 走 ensureSession new spawn（不增量 write·记新 sessionId）
 And 不误把旧 scrollback 当 gap 追加
```

---

### Scenario: TC-034 readoptHost 据快照对账徽标 running→idle（AC-5·渲染半侧）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit
**文件**: `src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts`

```gherkin
Given fake client 返回 snapshot.state='idle'（断开期任务已完成）而本地 tab 徽标残留 running
When readoptHost 收养并应用快照
Then tab 徽标对账为 idle（消除过期 running 残留·formatTabBadge 据 running 计数）
 And 不依赖事件流补发（纯据快照当前态）
```

---

### Scenario: TC-035 readoptHost exited 快照渲染「已完成」徽标不双写（AC-12·渲染半侧）
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit
**文件**: `src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts`

```gherkin
Given fake client 返回 snapshot.status='exited'·exitCode=0 + 回放 data（完成日志）
When readoptHost 收养 exited 会话
Then 渲染「✓ exit 0 已完成」徽标（.tab-dot--exited）·inst 不 dispose
 And 回放最终 scrollback 无重复渲染（renderedBytes 按 nextOffset 推进）
```

---

### Scenario: TC-036 readoptHost 据 session.list 重建 tab 全量回放（AC-4·D-4 第二路径·EXT-B-3）
**优先级**: P1 | **类型**: 功能 | **测试层级**: unit
**文件**: `src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts`

```gherkin
Given session.list 返回一个会话·但本地无对应 inst（tab 已关 / BL-004 已 disposeTerminal）
When readoptHost 处理该 host
Then 据快照 {cwd,title,state} 重建 tab + session.attach(resumeOffset=0) 全量回放（full=true）
 And AC-4「发现」不退化为「只重连已知实例」
```

---

### Scenario: TC-037 会话数上限逐最旧 exited·live 全存活（AC-9·QA-B-4）
**优先级**: P1 | **类型**: 边界 | **测试层级**: integration
**文件**: `src/host/__tests__/ptyPoolDetach.test.ts`

```gherkin
Given cap 满·混合 live 与多个 exited 会话（各带不同 exit 时间）
When 再 spawn 新会话触发逐出
Then 被删的 sid 是**最旧 exited**（排序键=exit 时间·最近完成的最后逐·ARCH-B-8）
 And 全部 live 会话 pid 存活（绝不逐 live·QA-7）
 And 无 exited 可逐时才拒新建（承接 TC-017）
```

---

### Scenario: TC-038 旧 host 能力位缺失退化 new spawn（AC-8·QA-B-5·兼容）
**优先级**: P1 | **类型**: 异常 | **测试层级**: unit
**文件**: `src/renderer/services/__tests__/hostClientReconnect.test.ts`

```gherkin
Given 重连 host.info 的 capabilities 缺失（undefined·旧 host 无 session.resume）
When reconnect 后编排收养
Then **不**发 session.list/session.attach·每个记了 sessionId 的 inst 直接走 new spawn
 And （双保险·集成）旧 core 收到未知 method → rpc:res ok:false → renderer catch 后退化
```

---

### Scenario: TC-039 重连 claim 瞬时探测失败·重试后复用存活 host·不 reap（AC-12·EXT-B-2·北极星守门）
**优先级**: P1 | **类型**: 异常 | **测试层级**: unit
**文件**: `src/main/remote/__tests__/residency.test.ts`

```gherkin
Given tag-match 且 alive 的存活 host（正持 detached/exited 会话·带断线期跑完的 build）·claim 探测首次瞬时失败（假阴性）
When resolveResidency 走 claim 路径（探测有界重试·TERMPRO_CLAIM_PROBE_RETRIES 默 3）
Then 重试后 probe.ok → 判 claim（复用运行中 host + storedToken·非新 token）
 And **不**落 reapThenDeploy（活 host 不被 kill·断线期 build 连同退出码不销毁）
 And 仅重试 N 次仍失败才走确定性回收
```

---

## UI 还原检查（见 UI.md 6 态设计稿）

| 检查点 | 设计稿标准 | 状态 |
|--------|------------|------|
| 重连横幅 3 态（disconnected/reconnecting/retry-failed） | `.add-ws__reconnect-banner`(+`--failed`) | ⬜ |
| Sidebar「重连中」黄点脉冲 | `.sidebar-machine-dot--reconnecting` | ⬜ |
| tab「已完成」徽标 | `.tab-dot--exited` + `✓ exit N` | ⬜ |
| 增量回放分隔行 | `.rc-gap-divider`「补回断开期间 N 行」 | ⬜ |

---

## E2E 端到端验收

### API E2E 判断

| 项目 | 内容 |
|------|------|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | 桌面终端 app·无 HTTP API 层。对外契约 = HostService 协议（session.list/attach），已由 **host 集成测（真 hostCore + 真 ws + 真 node-pty·wsTestHarness）** 端到端真跑覆盖（等效协议 E2E）·非 curl/httpie 场景。 |

### Browser E2E 判断（有 UI）

| 项目 | 内容 |
|------|------|
| 是否需要 Browser E2E | ✅ 需要（部分·真机 spike 发版前 manual） |
| 用户是否可选择跳过 | 是（PMO 执行前询问） |

### Browser E2E 前置条件

| 条件类型 | 具体内容 | 获取方式 |
|----------|----------|----------|
| 真远程机 | 一台可 SSH 的远程机（跑 build/长任务） | 用户提供 |
| 断网手段 | 合盖 / 拔网 / 切网 | manual 手动 |
| 应用 | 打包/dev app 连上远程机·活跃会话 | 本地启动 |

### Browser E2E Scenarios

#### FE-E2E-001: 断线检测时延 + 重连连续性真机 spike（AC-13·发版前门禁·manual）
**执行方式**: manual（真机·沙箱不可测）

```gherkin
Given app 连上真远程机·某 workspace 跑一个 3 分钟 build
When 合盖/拔网 30 秒后恢复
Then 断线在 T≤10s 内出重连横幅（不等 TCP 超时数分钟）
 And 恢复后自动重连·收养会话·增量回放断开期输出·徽标对账
 And 若断开期 build 跑完：重连看到完成日志 + 退出码 + 「已完成」徽标（北极星·AC-12）
```

**验证点**:
| 验证类型 | 验证内容 | 预期值 |
|----------|----------|--------|
| 时延 | 合盖→横幅出现 | ≤ 10s |
| 连续性 | 重连后终端内容 | 断开前 + 断开期 gap 补齐·无乱码·无重复 |
| 北极星 | 断开期完成的 build | 完整完成日志 + exit code + 已完成徽标 |

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-10 | v0.1 首版（覆盖 PRD v0.4 全部 14 AC · 31 test · 8 硬门逐条落测） |
| 2026-07-10 | v0.2 blueprint 冷审收口（+8 test → 39）：新增 T-032~036 readoptHost 渲染层测（防幽灵覆盖·QA-B-1）· T-037 exited 逐出选择（QA-B-4）· T-038 旧 host 退化（QA-B-5）· T-039 residency claim 重试（EXT-B-2）；TC-001 收窄协议侧 / TC-002 改行为断言（QA-B-2）· TC-005/011/024 按层拆从句（QA-B-1）· TC-008 收窄 UTF-8（ARCH-B-7/QA-B-3）· TC-012 exitCode 双源 note（QA-B-7）· TC-023 进程 exitCode 独立断言 · TC-026 心跳注入 seam（QA-B-8）· TC-028 AC-14 否定断言（QA-B-6）· harness mode seam 声明 |
