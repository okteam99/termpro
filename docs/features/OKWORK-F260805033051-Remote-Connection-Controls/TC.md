---
feature_id: "OKWORK-F260805033051-Remote-Connection-Controls"
status: draft
tests:
  - id: T-001
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC1_connected_shows_disconnect_icon_button
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-002
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC1_disconnect_icon_click_calls_ondisconnect
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: T-003
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC2_disconnect_click_reverts_next_render_no_panel
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-004
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC2_disconnect_does_not_call_window_confirm
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
  - id: T-005
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC2_AC6_late_disconnected_event_never_enters_panel_stage
    covers_ac: ["AC-2", "AC-6"]
    level: integration
    priority: P0
  - id: T-006
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC3_never_connected_shows_connect_icon_no_visible_text
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-007
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC3_folded_lost_shows_reconnect_icon_no_visible_text
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: T-008
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC4_active_stages_show_spinner_label_and_cancel_icon
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: T-009
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC5_cancel_click_reverts_synchronously_without_waiting_for_event
    covers_ac: ["AC-5"]
    level: integration
    priority: P0
  - id: T-010
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC6a_residual_lifecycle_events_after_cancel_do_not_revive_group
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
  - id: T-011
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC6c_residual_verifying_after_cancel_does_not_trigger_new_handshake
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
  - id: T-012
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC6b_inflight_handshake_resolve_after_cancel_does_not_adopt
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
  - id: T-013
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC6b_inflight_handshake_reject_after_cancel_does_not_toast_failed
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
  - id: T-014
    file: src/renderer/terminal/__tests__/terminalRegistryReadopt.test.ts
    function: test_AC6_readopt_noop_when_default_getclient_returns_null_after_drop
    covers_ac: ["AC-6"]
    level: unit
    priority: P2
  - id: T-015
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC7a_main_pushed_failed_event_shows_toast_and_group_falls_back
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-016
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC7b_local_handshake_catch_failed_shows_toast_and_group_falls_back
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-017
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC7_failed_runtime_no_longer_renders_reason_or_retry_button
    covers_ac: ["AC-7"]
    level: unit
    priority: P0
  - id: T-018
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC7_reconnect_backoff_period_failed_event_does_not_toast
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-019
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC8_disconnect_routes_through_stopsync_and_reconnect_triggers_readopt
    covers_ac: ["AC-8"]
    level: integration
    priority: P1
  - id: T-020
    file: src/renderer/services/__tests__/reconnectSuppressDrop.test.ts
    function: existing_cancel_clears_backoff_no_auto_retry(L157-172，已存在，非本次新增)
    covers_ac: ["AC-9"]
    level: unit
    priority: P1
  - id: T-021
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC9_disconnect_click_on_connected_calls_reconnectcontroller_cancel
    covers_ac: ["AC-9"]
    level: integration
    priority: P1
  - id: T-022
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC9_gate4_onreconnectneeded_blocked_when_abandoned
    covers_ac: ["AC-9"]
    level: integration
    priority: P1
  - id: T-023
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC10_reconnecting_shows_retry_now_icon_and_disconnect_icon
    covers_ac: ["AC-10"]
    level: unit
    priority: P1
  - id: T-024
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC9_AC10_AC12_disconnect_click_during_reconnecting_terminates_and_falls_back
    covers_ac: ["AC-9", "AC-10", "AC-12"]
    level: integration
    priority: P0
  - id: T-025
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC11_new_connection_icon_buttons_are_tab_focusable
    covers_ac: ["AC-11"]
    level: unit
    priority: P2
  - id: T-026
    file: src/renderer/components/__tests__/sidebarCssInvariants.test.ts
    function: test_AC11_sidebar_css_has_focus_visible_rule_for_connection_icons
    covers_ac: ["AC-11"]
    level: unit
    priority: P2
  - id: T-027
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC11_local_group_never_renders_connection_icons
    covers_ac: ["AC-11"]
    level: unit
    priority: P2
  - id: T-028
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC12_disconnect_connected_active_machine_calls_stopsync_for_fallback
    covers_ac: ["AC-12"]
    level: integration
    priority: P0
  - id: T-029
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC13_busy_state_click_is_queued_not_immediately_fired
    covers_ac: ["AC-13"]
    level: integration
    priority: P0
  - id: T-030
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC13_pending_disconnect_resolves_fires_queued_connect_exactly_once
    covers_ac: ["AC-13"]
    level: integration
    priority: P0
  - id: T-031
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC13_eight_second_upper_bound_fires_connect_even_if_disconnect_hangs
    covers_ac: ["AC-13"]
    level: integration
    priority: P0
  - id: T-032
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC14_abandoned_machine_reconnect_clears_flag_lifecycle_renders_normally
    covers_ac: ["AC-14"]
    level: integration
    priority: P0
  - id: T-033
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC15_six_states_plus_stays_rightmost_no_gap_no_overlap
    covers_ac: ["AC-15"]
    level: unit
    priority: P1
  - id: T-034
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC15_same_state_rerender_no_jitter_in_header_child_order
    covers_ac: ["AC-15"]
    level: unit
    priority: P1
  - id: T-035
    file: src/renderer/components/__tests__/MachineGroup.test.tsx
    function: test_AC15_state_transition_no_duplicate_or_orphan_control_nodes
    covers_ac: ["AC-15"]
    level: unit
    priority: P1
  - id: T-036
    file: src/renderer/components/__tests__/sidebarCssInvariants.test.ts
    function: test_AC15_css_single_auto_margin_no_double_gap_in_connected_run
    covers_ac: ["AC-15"]
    level: unit
    priority: P1
  - id: T-037
    file: src/renderer/state/__tests__/remoteHostStoreAbandonGate.test.ts
    function: test_AC2_AC9_setreconnecting_write_gate_blocks_set_true_but_allows_clear_when_abandoned
    covers_ac: ["AC-2", "AC-9"]
    level: unit
    priority: P0
  - id: T-038
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: test_AC9_queued_connect_rechecks_abandoned_before_firing_ipc
    covers_ac: ["AC-9", "AC-13"]
    level: integration
    priority: P0
---

# 远程机组头连接控件重构 - 测试用例

## 状态
草稿（v0.2 · 已按 TECH v0.2 两道闸架构重新对齐，见文末变更记录）

---

## Feature: 远程机组头连接控件重构(断开 / 图标化 / 取消 / 失败 toast)

作为同时管着本机和多台远程开发机的用户
我希望在侧栏组头就能连接、断开、以及中止一次连接
以便不用为了断开跑去设置页，也不用在连错机器时干等十几秒超时，且取消/断开之后界面不会诡异复活

---

## 需求覆盖矩阵

| AC ID（PRD）| 需求描述 | 优先级 | 覆盖测试 | 状态 |
|---|---|---|---|---|
| AC-1 | 已连接组头 `+` 左显示断开图标钮（可访问名称 Disconnect） | P0 | T-001, T-002 | ✅ |
| AC-2 | 点断开立即回未连接态，不弹确认框，不经 900ms 过渡态 | P0 | T-003, T-004, T-005, T-037 | ✅ |
| AC-3 | Connect / Reconnect 由文字按钮改纯图标 | P0 | T-006, T-007 | ✅ |
| AC-4 | 连接中显示阶段文案 + spinner + 取消图标钮 | P0 | T-008 | ✅ |
| AC-5 | 点取消立即回未连接态，不等主进程事件 | P0 | T-009 | ✅ |
| AC-6 | 取消后残余写入（残余事件 + 残余 verifying 建连 + 在途握手续体）不得复活组头/不得建连/不得弹 toast | P0 | T-005, T-010, T-011, T-012, T-013, T-014 | ✅ |
| AC-7 | 失败弹全局 toast，组头回落待连接（不再常驻 ✗ 原因 + Retry）；自动重连退避期不重复弹 | P0 | T-015, T-016, T-017, T-018 | ✅ |
| AC-8 | 断开重连后终端会话被收养回放 | P1 | T-019 | ✅ |
| AC-9 | 手动断开/取消后不发生自动重连（含 client 层信号通道 + store 写入闸） | P1 | T-020, T-021, T-022, T-024, T-037, T-038 | ✅ |
| AC-10 | 自动重连中「立即重试」图标化 + 断开钮可用并终止编排 | P1 | T-023, T-024 | ✅ |
| AC-11 | 新增连接类图标钮可 Tab 聚焦 + focus-visible；本机组无连接控件 | P2 | T-025, T-026, T-027 | ✅ |
| AC-12 | 断开已连接/自动重连中的机器 → 激活项目回落本机 | P0 | T-024, T-028 | ✅ |
| AC-13 | 取消后再点连接不得静默无反应；忙碌态不用禁用，点击排队兑现，8 秒上界 | P0 | T-029, T-030, T-031, T-038 | ✅ |
| AC-14 | 曾取消/断开的机器再点连接，弃用标记随连接意图解除 | P0 | T-032 | ✅ |
| AC-15 | 断线过渡态控件槽位无空洞、`+` 恒最右、同态内不抖动、connected 态三元素连排无双重间隙 | P1 | T-033, T-034, T-035, T-036 | ✅ |

🔴 **本表是「规格覆盖率」，不是「已实现覆盖率」** —— 下表的 ✅ 表示「该 AC 已有对应测试用例**被规格出来**」，不表示测试代码已存在。
截至 review round 1 收敛：**规格 38 条，已实现 1 条**（T-038 的 store 层部分落在 `remoteHostStoreAbandonGate.test.ts`），其余 37 条是 **test stage 的欠账**。
不加这行区分，后来者会以为 AC-13/AC-9 已有 P0 测试兜底 —— 而实际上删掉守卫，其余用例全绿（REVIEW F7）。

规格覆盖率: 15 / 15（100%）· 规格用例总数 38

> T-020 是**已存在**的测试（`reconnectSuppressDrop.test.ts:157-172`「用户主动断开 cancel:清退避计时器与 reconnecting 态,退避到点不再拉起(保持断开)」），本次不新增只引用；其余 36 条为本次新增（较 v0.1 的 31 条新增：新补 T-011/T-018/T-022/T-036/T-037 共 5 条，对应 TECH v0.2 点名的 3 条硬缺口 + AC-15 判据加固 + `setReconnecting` 写入闸独立单测；另有 T-012/T-014/T-024/T-029~T-031/T-033 等多条因架构改判据/流程改序而重写）。

---

## 🔴 v0.2 架构变化对本文件的影响（先读，再看下面逐条场景）

TECH v0.2 被两路冷审推翻了 v0.1 的核心论断——**「gate 放 `applyEvent` 一处就够」是错的**。真实架构是**两道闸**：

- **状态写入闸**：`applyEvent` / `setRtt` / `setReconnecting`（v0.1 只提了第一个，`setRtt`/`setReconnecting` 是另两条独立 `set(`，不经 `applyEvent`）。
- **副作用闸**（v0.1 完全没有，这是本次改判最大的一块）：① 订阅回调首行 `isAbandoned` 早退（`Sidebar.tsx:283` 附近）；② `beginHandshake` 入口同款守卫；③ 握手续体 `.then`/`.catch` 写入前再查一次；④ `onReconnectNeeded` 接线处的守卫（`Sidebar.tsx:321-325`）——**这是 AC-9 的真实触发源，不是 main 事件**。

新增两个 store 字段与五个 action（`remoteHostStore.ts`）：`abandoned`/`settling` 表，`abandon`/`resume`/`isAbandoned`/`setSettling`/`forget` 五个 action。本文件下方场景直接引用这些具体名字（v0.1 因为架构未定只能含糊带过，现在 TECH 已锁定，测试可以精确挂上去）。

断开/取消统一走 `handleDisconnect(id)` 四步同步序列：`abandon(id) → reconnectController.cancel(id) → clear(id) → stopRemoteWorkspaceSync(id)`，**全部同 tick 完成**，之后才是不 await 的 `disconnectAwait` 收尾（只用来清 `settling`，不承载"已断开"语义）。AC-13 不再用禁用态——按钮忙碌期用 `aria-busy`，**仍可点**，点击被排队，兑现有 8 秒上界。

---

## 🔴 测试基础设施前置说明（影响本文件几乎全部 integration 级用例）

`SidebarMachineGroups.test.tsx` 现有 `installOkwork()` 与 hoisted `makeClient()` 需要四处扩展才能挂住本 Feature 的真实竞态（这些是**测试基础设施**改造，不是产品代码变更）：

1. `installOkwork()` 的 `remoteHost.onEvent` 改为捕获注册的回调（模块级 `let emitRemoteEvent: (e: RemoteEvent) => void`），供用例手动 `act(() => emitRemoteEvent({ configId, stage: ... }))` 模拟 main 推事件。**现状是 `vi.fn(() => () => undefined)`，完全不捕获**，现有全部测试都绕开了这条真实订阅路径。
2. hoisted `makeClient()` 需新增 `reconnect: vi.fn()`（现有只有立即 resolve 的 `connect`），且要能按用例控制其返回的 Promise 何时 resolve/reject（可控 deferred）——否则测不出 AC-6(b)/(c) 的竞态窗口。
3. hoisted `makeClient()` 需新增 `onReconnectNeeded: vi.fn((cb) => { ...capture cb by configId...; return () => {}; })`（现状**完全没有这个字段**）——`Sidebar.tsx:321-325` 是 `client.onReconnectNeeded?.(...)` 可选链调用，mock 缺这个字段时该行直接静默 no-op，AC-9 的闸 4（T-022）测不出来。
4. `installOkwork()` 的 `remoteHost` 需新增 `disconnectAwait: vi.fn()`（TECH v0.2 新增的 IPC，`disconnect` 保留原样、仍是裸 `ipcRenderer.send` 供 `reconnectController` 的 disconnect-first 使用，两者不是同一个 mock）——AC-13（T-029~031）需要按用例控制这个 Promise 何时 resolve，模拟排队等待与 8 秒上界。

---

## 测试场景

### AC-1：已连接组头显示断开图标钮

#### Scenario: TC-001（T-001）已连接态渲染断开图标钮
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一台状态为 connected 的远程机（MachineInfo.status='connected'）
When 渲染 MachineGroup
Then `+` 钮左侧存在一个 <button>，其可访问名称（aria-label/accessible name）为 "Disconnect"
 And 该按钮不含可见文本节点 "Disconnect"（图标钮，非文字胶囊）
```

#### Scenario: TC-002（T-002）点击断开图标钮回调
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 已连接远程机渲染出的断开图标钮
When 点击该钮
Then 组件层面注入的断开回调以 machineId 为唯一参数被调用一次
 And 事件不冒泡触发组头折叠切换（stopPropagation，比照 onAddWorkspace 现有惯例）
```

---

### AC-2：点断开立即回未连接态

#### Scenario: TC-003（T-003）点击断开 → 下一次渲染即回未连接态，不经过渡态
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given Sidebar 渲染出一台 connected 远程机（组头显示 RTT 延迟 + 断开图标钮）
When 用户点击断开图标钮
Then 同一渲染周期内该机组头不再显示延迟毫秒数，workspace 行收起（workspaces 变 null）
 And 组头出现连接图标钮（未连接态外观）
 And 不出现任何确认弹窗
```

**挂点/构造要点**：这条验证的是 `handleDisconnect` 四步同步序列（`abandon → cancel → clear → stopRemoteWorkspaceSync`）里第 3-4 步落地后的可观测结果——点击后**不 `waitFor`**（同步断言），证明是本地立即复位而非等待 `disconnectAwait` 落地（第 5-6 步是不 await 的收尾，只清 `settling`，不应挡住 UI 复位）。第 2 步 `reconnectController.cancel` 的调用另在 T-021 里独立验证，本用例不重复断言。

#### Scenario: TC-004（T-004）点断开不弹确认框
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given 同 TC-003 的已连接远程机
When 用户点击断开图标钮
Then window.confirm 全程未被调用（D-3：断开不设二次确认）
```

**挂点/构造要点**：`vi.spyOn(window, 'confirm')`，断言 `.not.toHaveBeenCalled()`。

#### Scenario: TC-005（T-005）迟到的 disconnected 事件不触发 900ms 断线过渡态
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given 用户已点击断开图标钮，组头已同步回落未连接态（同 TC-003），该 configId 已被置为 abandoned
When main 侧编排收尾后迟到推送一条该 configId 的 disconnected 事件（经捕获的 onEvent 回调手动触发）
 And 时间推进超过 900ms（DISCONNECT_PANEL_MS）
Then 该事件在订阅回调**首行**即被 `isAbandoned` 早退挡下（闸①），从未走到 `applyEvent` 与 900ms panel effect
 And 组头全程不出现 "Disconnected" 行内标签（不进入 panel 阶段）
 And 全程不触发 selectionLocked（其它 workspace 行点击不受锁定）
 And workspaces 保持 null / 折叠外观不回跳
```

**挂点/构造要点**：用 `vi.useFakeTimers()`；断言的是「全程」而非「900ms 后」——用 `vi.advanceTimersByTime` 分段推进并在每一步都查询 DOM，防止只在终态查一次而漏掉中途闪现的 panel 态。本用例同时覆盖 AC-6 的残余事件通道（deploying/starting/verifying/ready/failed 的批量场景见 T-010，本用例单独锚定 `disconnected` 这一支，因为它与 AC-2 的「不经 900ms 过渡态」直接相关）。

---

### AC-3：Connect / Reconnect 改纯图标

#### Scenario: TC-006（T-006）从未连接态显示连接图标钮
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一台从未连接（status='disconnected', foldedLost 未设）的远程机
When 渲染 MachineGroup
Then 存在一个可访问名称为 "Connect" 的 <button>
 And 该按钮 textContent 不含明文 "Connect"（无可见文字，靠 title/aria-label 双写）
```

#### Scenario: TC-007（T-007）已断开折叠态显示重连图标钮
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一台 foldedLost=true 的远程机（曾连接，已折叠回未连接外观）
When 渲染 MachineGroup
Then 存在一个可访问名称为 "Reconnect" 的 <button>
 And 该按钮 textContent 不含明文 "Reconnect"
```

---

### AC-4：连接中显示阶段文案 + spinner + 取消图标钮

#### Scenario Outline: TC-008（T-008）五个 active 阶段均显示取消图标钮
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一台远程机 runtime.stage 为 "<stage>"
When 渲染 MachineGroup
Then 显示对应阶段文案与 spinner（沿用现有 connectStageLabel 文案单源）
 And 存在一个可访问名称为 "Cancel" 的 <button>，位于阶段文案之后
```

**Examples**:
| stage |
|---|
| connecting |
| deploying |
| starting |
| claiming |
| verifying |

**说明**：TECH v0.2 会顺手删掉 `MachineGroup.tsx:286-288` 那支从未被 Sidebar 真实派生过的死分支（直接传 `status==='connecting'` 而非经 `runtime`）。已核实现有 `MachineGroup.test.tsx`/`SidebarMachineGroups.test.tsx` 均无用例直接构造 `status: 'connecting'`（全部走 `runtime.stage`），本条及其余用例均已锚定在**存活**分支上，删除死分支不会打红任何现有或本文件新增的测试。

---

### AC-5：点取消立即回未连接态，不等主进程事件

#### Scenario: TC-009（T-009）点取消同步回落，不依赖任何事件到达
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given Sidebar 渲染出一台 runtime.stage='connecting' 的远程机（显示取消图标钮）
When 用户点击取消图标钮
Then window.okwork.remoteHost.disconnect 被以该 configId 调用（`handleDisconnect` 四步序列的一部分）
 And 在不派发任何 onEvent 回调、不推进任何计时器的前提下，同一渲染周期内组头已显示连接图标钮（未连接态）
```

**挂点/构造要点**：这是本 Feature 唯一的 P0 异步正确性核心断言之一——刻意**不**触发 mocked onEvent 回调、**不** `waitFor`，证明 UI 复位是 `handleDisconnect` 第 3-4 步（`clear` + `stopRemoteWorkspaceSync`）的同步本地写入，不是等 `disconnectAwait`（第 6 步，fire-and-forget）落地后才复位。若实现依赖任何 await/事件回调才复位，本用例会因同步断言查不到目标节点而失败。

---

### AC-6：取消后三条残余写入通道均不得复活组头（含新发现的「残余 verifying 建连」子情形）

#### Scenario Outline: TC-010（T-010）残余生命周期事件（闸①覆盖）不复活组头
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given Sidebar 渲染出一台 runtime.stage='connecting' 的远程机
 And 用户已点击取消图标钮（该 configId 已 abandoned，组头已回落未连接态，见 TC-009）
When main 迟到推送一条该 configId 的残余事件 stage="<stage>"（经捕获的 onEvent 回调手动触发）
Then 该事件在订阅回调首行即被 isAbandoned 早退挡下，组头仍显示连接图标钮，未被复活为任何 active/connected 展示
 And <额外断言>
```

**Examples**:
| stage | 额外断言 |
|---|---|
| deploying | 组头不出现 spinner/阶段文案 |
| starting | 组头不出现 spinner/阶段文案 |
| ready | 组头不展开 workspace 行，不显示 RTT |
| failed（reason='unreachable'） | useAppStore.getState().transientNotice 保持 null（不弹全局 toast） |

> `verifying` 已从本表拆出，独立成 TC-011（AC-6(c)）——它不只是「组头别复活」这么简单，是 PRD 点名「AC-6 最尖的一颗牙」：残余 `verifying` 真的会驱动 `beginHandshake` 打开一条新 ws、把连接建成，混在批量 Examples 里容易被随手带过，必须单独一条重笔断言。

#### Scenario: TC-011（T-011）🔴 残余 verifying 不得触发新握手（AC-6(c)，闸①+闸②）
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given Sidebar 渲染出一台 runtime.stage='connecting' 的远程机
 And 用户已点击取消图标钮（该 configId 已 abandoned）
When main 迟到推送一条该 configId 的残余事件 stage='verifying'（附带 tunnel: {localPort, token}）
Then hostRegistry.getOrCreateRemote **未被以该 configId 调用**（闸①在订阅回调首行拦下，从未进入 beginHandshake）
 And mock client 的 reconnect 方法未被调用（没有新 ws 被打开）
 And 组头仍显示连接图标钮，未展开 workspace、未显示 RTT
```

**挂点/构造要点**：这是 v0.1 完全没覆盖到的口子——四个副作用闸里只有它同时验证「订阅回调没把事件传下去」**和**「没有第二道防线兜底」两件事都成立。断言必须钉在 `hostRegistry.getOrCreateRemote` 的调用次数上（而不是只看组头 DOM），因为 `hostRegistry.ts:24-34` 的 `getOrCreateRemote` 一旦被调用就会把新 client `set` 回注册表——这正是 TECH v0.2 指出的「`readoptHost` 实时查表拿 null 短路」这条防线在残余握手路径上**不成立**的原因（该防线依赖 client 不在表里，但 `getOrCreateRemote` 一旦跑起来就会重新把它塞回去）。真正兜底残余 verifying 的只有闸①（订阅首行）和闸②（`beginHandshake` 自身入口的同款守卫，防其它调用路径），本用例直接验证闸①在这条路径上确实生效。

#### Scenario: TC-012（T-012）取消时已在途握手 resolve（闸③）不写入、不收养
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given Sidebar 在取消发生**之前**已收到 verifying{tunnel} 事件并进入 beginHandshake（client.reconnect() 返回一个仍处 pending 的可控 Promise，这条 ws 已经真实打开）
When 用户点击取消图标钮（该 configId 置为 abandoned）
 And 随后该 Promise resolve（模拟 ws 迟迟才真正握手成功）
Then 组头不被写入 ready（不展开 workspace、不显示 RTT）
 And session.list / session.attach 两个 RPC 均未被 mock client 的 rpc 发出（不是断言 `readoptHost`/`onReconnected` 有没有被调用——TECH v0.2 明确指出 readoptHost 本身**会**被调用后在其内部早退，断言这一层内部调没调没有意义，唯一可靠的是它对外发的 RPC 有没有真的打出去）
 And hostRegistry.drop 被以该 configId 调用（闸③收尾这条已经真实打开的 ws，防止留一条无人管理的活连接 + 心跳）
```

**挂点/构造要点**：这是 PRD §核心风险模型标注的「今天不确定能否堵干净」的一条，必须用可控 deferred Promise 构造竞态时序（先 pending → 取消 → 再 resolve），不能用 `async () => ({})` 立即 resolve 的旧 mock（会永远赶不上取消动作）。🔴 断言措辞已按 TECH v0.2 更正：**不再断言「readoptHost/onReconnected 未被调用」**（那是实现内部的调用图，TECH 明确说它可能被调用后自行早退），改为断言其**外部可观测的 RPC 效果**（`session.list`/`session.attach` 未发出）与**清理副作用**（`hostRegistry.drop` 被调用），这样即使内部调用链细节变化，断言依然成立。

#### Scenario: TC-013（T-013）取消时已在途握手 reject（闸③）不弹 failed toast
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given 同 TC-012 的 pending 握手 Promise（取消前已打开的 ws）
When 用户点击取消图标钮
 And 随后该 Promise reject（模拟 ws 打不开 / 协议不兼容）
Then useAppStore.getState().transientNotice 保持 null（不因这次迟到的失败弹 toast）
 And 组头保持未连接态展示，不被复活进 reconnecting 编排
```

**说明**：reject 分支不涉及 readoptHost（只有 resolve/`onReconnected` 路径才会走收养），故不需要 TC-012 那条 RPC 级断言；本场景保持原有断言形态即可，只补充：即便这台机从未进入过 reconnecting（`isReconnecting` 本就是 false），`reconnectController.onAttemptFailed` 自身也带 `if (!deps.isReconnecting(configId)) return` 的既有 no-op 守卫——闸③与这条既有守卫是两层独立防御，缺其中任一层都不会导致本场景失败，测试只断言外部可观测结果（toast 未弹、组头未复活）。

#### Scenario: TC-014（T-014）readoptHost 自身的 null-getClient 防御性回归测试（次级、独立不变式）
**优先级**: P2 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 已通过 hostRegistry.getOrCreateRemote('cfg-1', wsUrl) 建立过一个远程 client
 And 该 client 已被 hostRegistry.drop('cfg-1') 释放（同步 dispose + 从 map 删除）
When 以**不覆盖 getClient**（即走真实默认值 hostRegistry.forHostId）的方式调用 readoptHost('cfg-1', { listInstances: () => [持有该 hostId 的若干假 inst], getOrCreateInst, spawnNew, wireLiveSession })
Then getOrCreateInst / spawnNew / wireLiveSession 均未被调用（函数在 `hostRegistry.forHostId(id)` 查到 null 后于早期直接 return）
```

**🔴 定位已按 TECH v0.2 降级/改口**：v0.1 曾把这条当成「通道②收养半侧天然被挡住」的**主证据**——TECH v0.2 证伪了这个结论：`hostRegistry.getOrCreateRemote` 一旦被调用就会把 client 重新塞回注册表（`hostRegistry.ts:24-34`），而残余 `verifying` 路径一旦闸①/闸②失守就正是会调用它，届时 `forHostId` 查到的就不是 null。**AC-6(c) 真正的防线是 TC-011 验证的闸①/②（不让 beginHandshake 跑起来），不是本条的 null 短路**。本条降级为一条**独立、次级**的防御性单测——保护的是"万一 getClient 就是拿不到 client"这个更窄的场景（例如其它未来调用方直接传入 null），优先级也相应从 P0 降到 P2，且不再声称它是 AC-6(b)/(c) 的主证明。落点仍建议挂在 `terminalRegistryReadopt.test.ts`（复用其 `makeFakeInst`）。

---

### AC-7：失败弹全局 toast，组头回落待连接（含自动重连退避期不重复弹）

#### Scenario: TC-015（T-015）main 推送的 failed 事件 → toast + 组头回落
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given Sidebar 渲染出一台远程机，**不处于 reconnecting**、未被取消/弃用（首次连接失败的典型场景）
When main 推送 stage='failed', reason='unreachable' 事件
Then useAppStore.getState().transientNotice 命中 failReasonCopy('unreachable').label（"Unreachable"）
 And 页面上出现 role="status" 的提示节点，文本含 "Unreachable"
 And 该机组头不再渲染 "✗" 文本与 "Retry" 按钮，转而渲染可访问名称为 "Connect" 的连接图标钮
```

**挂点/构造要点**：toast effect 判据是三合一（`stage==='failed' && prev!=='failed' && !isReconnecting(id) && !isAbandoned(id)`），本场景显式构造 `isReconnecting=false`、`isAbandoned=false` 两个前提均成立，与 TC-018（reconnecting 期不弹）形成边界对照。

#### Scenario: TC-016（T-016）渲染层握手本地 catch 合成的 failed → 同样 toast + 回落
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given Sidebar 收到 verifying{tunnel} 并进入 beginHandshake，client.reconnect() 返回的 Promise 将 reject（ProtocolIncompatibleError）
When 该 Promise reject
Then useAppStore.getState().transientNotice 命中 failReasonCopy('incompatible').label
 And 该机组头回落为连接图标钮（不常驻错误文案）
```

**说明**：TC-015/TC-016 分别对应 AC-7 描述里「不论来自 main 事件推送、还是渲染层握手失败本地合成」的两个来源，同一后果，独立场景验证两条代码路径都接到同一落点。

#### Scenario: TC-017（T-017）MachineGroup 组件级：failed runtime 不再渲染错误文案/重试按钮
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一台远程机 runtime.stage='failed', reason='unreachable'
When 渲染 MachineGroup
Then 不出现文本 "Unreachable"（不再渲染 ✗ 原因）
 And 不存在可访问名称为 "Retry" 的按钮
 And 存在可访问名称为 "Connect" 的图标钮
```

**这条直接替换现有会变红的用例**：`MachineGroup.test.tsx` 现有 `describe('MachineGroup · 连接生命周期(AC-8)')` 内 `it('failed → 失败原因(FAIL_REASON_COPY 单源)+ 重试按钮', …)`（现文件 L212-225）断言 `getByText(/Unreachable/)` 与 `getByRole('button', {name:'Retry'})` 存在——两条断言在本 Feature 落地后都会变红，需按 TC-017 整体重写，而不是修修补补。

#### Scenario: TC-018（T-018）🔴 自动重连退避期内的 failed 事件不重复弹 toast
**优先级**: P0 | **类型**: 边界 | **测试层级**: integration

```gherkin
Given 一台远程机正处于 reconnecting（isReconnecting(configId)===true，已进入自动重连编排的退避重试循环）
When main 为这次重试尝试 emit 一条 stage='failed' 事件（自动重连每次尝试失败 main 都会 emit 并落库 runtime）
Then useAppStore.getState().transientNotice 不因这条事件被写入（toast 判据里的 `!isReconnecting(id)` 排除项生效，不会每个退避周期弹一条）
 And 组头仍展示「重连中…」的琥珀脉冲态，不回落为待连接图标钮
```

**挂点/构造要点**：TECH v0.2 点名的第三个必补缺口。构造方式：先用 `reconnectController.onDisconnected(configId)`（或等价的触发 `client.onReconnectNeeded` 回调）让该机进入 reconnecting，再经捕获的 onEvent 回调推送一条 `failed` 事件，断言 toast 未弹。🔴 实现侧提示（供理解测试意图，非本文件要测的内容）：toast effect 必须用**独立 ref**（如 `noticedFailRef`）做边沿检测，不能复用 `prevStages`（后者在先声明的 900ms panel effect 末尾已被更新，若两个 effect 共用一份 ref，后声明的 effect 会永远读到新值导致边沿检测失效）——测试不断言这个实现细节，只断言最终的 toast-未弹这个可观测结果。

---

### AC-8：断开重连后终端会话被收养回放

#### Scenario: TC-019（T-019）断开走完整 stopRemoteWorkspaceSync 链路，重连触发收养编排
**优先级**: P1 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given Sidebar 渲染出一台 connected 远程机，有一个跑着的 workspace/终端会话
When 用户点击断开图标钮
Then stopRemoteWorkspaceSync 被以该 configId 调用（`handleDisconnect` 第 4 步；而非照抄 RemoteHostsPage.handleDisconnect 的不完整流程——那个不调 stopRemoteWorkspaceSync/dropHostWorkspaces）
When 用户点击连接图标钮重新连接（`handleConnect` 第 1 步 `resume(id)` 解除弃用标记）
 And 该机推进到 verifying{tunnel} → client.reconnect() resolve
Then reconnectController.onReconnected（进而驱动 readoptHost 收养回放）被以该 configId 调用一次
```

**挂点/构造要点**：不在本用例里重复断言"回放字节是否正确"——那已由 `terminalRegistryReadopt.test.ts` 的 T-032~038 系列穷尽覆盖。本用例只证明**这个 Feature 新增的侧栏断开入口走的是正确的完整链路**，且重连前必须先经过 `resume(id)` 解除弃用（否则闸①/②会挡住这次重连，见 AC-14）。`stopRemoteWorkspaceSync`/`hostRegistry` 在本测试文件里已是 mock，直接断言调用参数即可，无需拆穿其内部实现。

---

### AC-9：手动断开/取消后不发生自动重连（含 client 层信号通道）

#### Scenario: TC-020（T-020，已有测试，非本次新增）
**优先级**: P1 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given reconnectController 正在为某 configId 编排重连（已过至少一次失败重试，排了退避计时器）
When 调用 controller.cancel(configId)
Then isReconnecting(configId) 变为 false，controller.isActive(configId) 变为 false
 And 推进计时器远超全部退避档位，connect/disconnect 均无新增调用（不再自动拉起）
```

**说明**：此场景已由 `src/renderer/services/__tests__/reconnectSuppressDrop.test.ts:157-172`「用户主动断开 cancel:清退避计时器与 reconnecting 态,退避到点不再拉起(保持断开)」完整覆盖且当前为绿，本次**不重复新增**，仅在 frontmatter 里挂靠 covers_ac 引用，满足 AC-9 在 reconnectController 纯逻辑层的证明。本条只证明「已经在重连编排中的机器，取消能让它停下来」；下面 TC-022 证明的是完全不同的另一件事——「已被放弃的机器，压根不该被拉进重连编排」。

#### Scenario: TC-021（T-021）已连接态点断开 → 调用 reconnectController.cancel
**优先级**: P1 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given Sidebar 渲染出一台 connected 远程机
When 用户点击断开图标钮
Then reconnectController.cancel 被以该 configId 调用一次（`handleDisconnect` 第 2 步，真实单例上 spy，验证生产接线而非只验证 IPC 调用）
```

#### Scenario: TC-022（T-022）🔴 闸④：弃用后 client 层 onReconnectNeeded 信号不得拉起重连编排
**优先级**: P1 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given 一台远程机曾连接成功（runtime ready），随后用户点击断开或取消（该 configId 已 abandoned）
When 该机底层 HostClient 的 transport 关闭 / 心跳判死，触发其 onReconnectNeeded 回调（Sidebar.tsx:321-325 唯一接线点：`client.onReconnectNeeded?.(() => reconnectController.onDisconnected(configId))`）
Then reconnectController.onDisconnected 未被以该 configId 调用
 And useRemoteHostRuntimeStore.getState().isReconnecting(configId) 保持 false（未被拉入自动重连编排）
```

**挂点/构造要点**：TECH v0.2 点名的第二个必补缺口，也是本次判定 v0.1 机理错误最大的一条——v0.1 以为「abandon 能挡住残余 disconnected 事件」就等于「挡住了自动重连」，但 `reconnectController.onDisconnected` 的真实触发源根本**不经 main 事件、不经 store**，而是 `client.onReconnectNeeded` 这个 client 层回调（心跳判死或 WebSocket transport close 直接触发）。必须依赖「测试基础设施前置说明」第 3 条新增的 `onReconnectNeeded` mock 捕获能力，手动调用捕获到的回调模拟"心跳判死"，而不能通过派发 main 事件来间接触发（那测的是另一条完全不相关的路径）。

#### Scenario: TC-037（T-037）🔴 store 写入闸第六条：弃用后 `setReconnecting(id, true)` 必须被挡，但清假必须永远放行
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given remoteHostStore 状态里某 configId 已 abandoned（abandoned[configId]=true）
When 调用 setReconnecting(configId, true)
Then isReconnecting(configId) 保持 false（置真被写入闸挡下——这条闸不经 applyEvent，是独立的第三个状态写入闸）
```

```gherkin
Given remoteHostStore 状态里某 configId 已 abandoned 且此刻 reconnecting[configId] 已经是 true（构造一个"清理前"的既有状态，不经由 abandon 之后再置真——那条路径已被上面的场景挡住，这里单独验证"清"这个方向）
When 调用 setReconnecting(configId, false)
Then isReconnecting(configId) 变为 false（清假不受 abandoned 影响，恒放行——否则一旦某机被判为 abandoned，谁都清不掉它的 reconnecting 标记，会把它永久卡在"重连中"展示）
```

**挂点/构造要点**：TECH v0.2 在数据结构一节明确写了这条闸的非对称语义（`只挡置真 · 清假恒放行(否则清不掉)`），这行注释本身就是本用例要验的东西——两个方向都要单独测，因为它们要通过/不通过的方向是反的，混在一条用例里容易漏掉其中一半。这是纯 zustand store 单测，不需要经过 Sidebar/reconnectController，落点建议新开 `src/renderer/state/__tests__/remoteHostStoreAbandonGate.test.ts`（现有 `remoteHostStore.ts` 还没有专属测试文件）。**为什么这条值得单独测，而不是靠 TC-022 兜底**：TC-022 证的是"闸④挡住了 `onDisconnected` 这个调用本身不发生"；本条证的是纵深防御的下一层——**即便**闸④哪天被绕过（例如未来有人加了一条新的调用路径直接写 `setReconnecting(id, true)`，没有经过 `onDisconnected`），store 自己的写入闸依然能独立挡住这次污染。二者缺一，覆盖链就有一环脱节。而且 `reconnecting` 在 `Sidebar.tsx:521` 的组头派生优先级**高于** `ready`/`disconnected` 分支，一旦被置真且没人清得掉，组头会当场从"未连接"切成"重连中…"，直接打破 AC-2 的复位承诺，这也是本条同时标注 covers_ac 到 AC-2 的原因。

---

### AC-10：自动重连中「立即重试」图标化 + 断开钮可用

#### Scenario: TC-023（T-023）reconnecting 态同时渲染「立即重试」与断开两个图标钮
**优先级**: P1 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一台远程机 status='reconnecting'
When 渲染 MachineGroup
Then 存在一个可访问名称为 "Retry now" 的图标钮（不再是现有的文字按钮 "立即重试"）
 And 存在一个可访问名称为 "Disconnect" 的图标钮，且未被禁用
```

**这条会让 MachineGroup.test.tsx 现有 RTT 相关 describe 块下的隐含假设过期**：现有代码在 reconnecting 态渲染的是文字按钮 `{t('Retry now')}`（`MachineGroup.tsx:260-266`），本用例断言其变为图标钮，需要新写而非复用旧断言。

#### Scenario: TC-024（T-024）reconnecting 态点断开 → 终止编排 + 回落 + 激活项目回落本机
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given Sidebar 渲染出一台 reconnecting 态远程机，其 workspace 恰为当前 activeWorkspaceId
When 用户点击断开图标钮
Then reconnectController.cancel 被以该 configId 调用（终止自动重连编排，D-4）
 And stopRemoteWorkspaceSync 被以该 configId 调用（AC-12 回落链路的入口，回落结果本身已由 remoteDisconnectFallback.test.ts 的 store 层单测覆盖，此处只证"这个入口真的走到了"）
 And 组头不再是琥珀脉冲"重连中…"展示，回落为未连接态连接图标钮
```

---

### AC-11：新增图标钮可 Tab 聚焦 + focus-visible；本机组无连接控件

#### Scenario: TC-025（T-025）新增/改造图标钮均可被 Tab 聚焦
**优先级**: P2 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 分别渲染 Connect / Reconnect / Disconnect / Cancel / Retry now 五个图标钮各自所在的状态
When 对每个按钮元素调用 .focus()
Then document.activeElement 命中该按钮（原生 <button>，不带 tabIndex=-1，未设置 aria-hidden）
```

#### Scenario: TC-026（T-026）Sidebar.css 存在命中新按钮的 :focus-visible 规则
**优先级**: P2 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 读取 src/renderer/components/Sidebar.css 源文件内容
When 用正则匹配 :focus-visible 选择器块
Then 至少存在一条规则，其选择器命中本 Feature 新增/改造的连接类按钮 class `.sidebar-machine-ctl`（TECH v0.2 §AC-15 落法段落点名的类名，断开/取消/连接/重连/立即重试图标钮共用这一族 class）
 And 该规则声明 outline（不是空规则）
```

**挂点/构造要点**：jsdom 不跑真实 CSS 引擎，:focus-visible 伪类无法通过渲染断言，只能对源文件文本做正则/字符串包含断言。落点文件由 `sidebarFocusVisible.test.ts` 改名为 `sidebarCssInvariants.test.ts`（与 TC-036 的 auto-margin 判据共用同一个"读 CSS 源文件断言"的测试文件，不再各开一个）。

#### Scenario: TC-027（T-027）本机组头不渲染任何连接类图标钮
**优先级**: P2 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 渲染 MachineGroup(kind='local')，且同时传入 onConnect/onDisconnect/onCancel/onManualRetry 等全部连接类回调 props
When 查询组头内的 Connect/Reconnect/Disconnect/Cancel/"Retry now" 按钮
Then 均不存在（即便回调 props 都给了，本机分支也不渲染）
```

---

### AC-12：断开已连接/自动重连中的机器 → 激活项目回落本机

#### Scenario: TC-028（T-028）已连接机器是当前激活项目所在机 → 断开触发回落链路
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given activeWorkspaceId 指向一台 connected 远程机的某个 workspace
When 用户点击该机断开图标钮
Then stopRemoteWorkspaceSync 被以该 configId 调用（回落到本机 workspace 或 null 的具体结果已由 store 层 `remoteDisconnectFallback.test.ts` 的 `dropHostWorkspaces(AC-11)` 用例组穷尽覆盖，本用例只证新入口触达该链路）
```

**（reconnecting 态的等价场景见 TC-024，同一断开动作、同一回落保证，不重复拆分用例）**

---

### AC-13：取消后再点连接不得静默无反应（v0.2：忙碌态 + 排队兑现，不用禁用态）

> 🔴 **本节三条相对 v0.1 全部重写**。v0.1 假设的落法是「禁用态 + 必须 aria-disabled」，被 Architect/external 两路冷审裁定为**各取一半**：不用禁用态（点击恒被兑现，不拒绝）+ 保留忙碌指示与 8 秒排队上界（不能让用户点了看不到任何反馈）。原来那条「GO-030 硬约束：aria-disabled 而非原生 disabled」**不再适用**——因为压根没有禁用态了，点击行为本身在忙碌态和空闲态下完全一致（都真实派发、都会被处理，只是忙碌态下处理逻辑是"排队"而不是"立即发 IPC"）。两个按钮状态的差异 = `aria-busy` +**可见的** spinner（图标换成同尺寸转圈 + tooltip 变「正在断开…」）。🔴 **可见那半不是装饰**：AC-13 禁的是"点了没有任何状态变化"，而用户看的是像素不是 ARIA 树——dev 期实测发现只写 `aria-busy` 时忙碌态与常态像素级相同，等同无反馈。

#### Scenario: TC-029（T-029）忙碌态点击连接被排队，不立即发出 IPC
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given 用户刚点击断开/取消（该机进入 settling，disconnectAwait 的 Promise 处于可控 pending 状态）
When 用户在 settling 期间点击连接图标钮
Then 连接图标钮此刻具有 aria-busy="true"
 And 该钮内渲染出 .sidebar-machine-ctl__busy（图标被同尺寸 spinner 替换），且 title 为「正在断开…」
 And 该按钮不含原生 disabled 属性（点击必须真实派发，不能被浏览器语义拦截——否则退化回静默无反应）
 And window.okwork.remoteHost.connect 此刻**尚未**被调用（意图已被记录/排队，但要等 pendingDisconnect 结算）
```

#### Scenario: TC-030（T-030）pendingDisconnect resolve 后，排队的连接意图恰好兑现一次
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 同 TC-029 的排队状态（用户已点击连接图标钮，disconnectAwait 仍 pending）
When 该 disconnectAwait 的 Promise resolve
Then window.okwork.remoteHost.connect 被以该 configId 调用恰好一次（不多发、不遗漏）
 And 连接图标钮的 aria-busy 消失/变为 "false"，组头能继续推进展示新一轮的 connecting 阶段文案
```

#### Scenario: TC-031（T-031）8 秒排队上界：disconnectAwait 长期不 resolve 也不会无限等
**优先级**: P0 | **类型**: 边界 | **测试层级**: integration

```gherkin
Given 用户点击连接图标钮时 disconnectAwait 的 Promise 永远不 resolve（模拟主进程异常悬挂）
When 时间推进 8000ms（Promise.race 的 sleep 分支胜出）
Then window.okwork.remoteHost.connect 仍然被调用（排队上界生效，不会因为断开异常挂起而让连接按钮永久失效）
```

#### Scenario: TC-038（T-038）排队中的连接在兑现前复查弃用标记 —— 用户改主意再点断开，那条排队的 connect 必须被吞掉
**优先级**: P0 | **类型**: 异常 | **测试层级**: integration

> 🔴 dev 期第三方核验补出的用例。四道副作用闸挡的都是「**进来的**事件与本地副作用」，而这条是**已经排上队、跨了 await 边界的出向 IPC**——闸一条都够不着它。不测这条，删掉 `handleConnectMachine` 里那行 `isAbandoned` 复查，其余 37 条全绿。

```gherkin
Given 用户点击断开（该机进入 settling，disconnectAwait 的 Promise 处于可控 pending 状态）
  And 用户在 settling 期间点击了连接图标钮（resume 已清弃用标记，连接意图已排队等待）
When 用户改主意，在该 Promise resolve **之前**再次点击断开（abandon 重新置标记 + 本地同步拆除）
  And 随后该 disconnectAwait 的 Promise resolve（排队的 .then 到点）
Then window.okwork.remoteHost.connect **不被调用**（排队的连接意图在兑现前被弃用标记吞掉）
 And 组头维持未连接外观（不出现 connecting 阶段文案）
```

**为什么这条是 P0**：若漏，主进程会照常建隧道、起远端 host —— 界面显示已断开、后台却连上了，正是本 Feature 要消灭症状的另一半；且用户此后再点连接会撞 `orchestrator` 的在途去重，退化成「点了没反应」（R2 同款症状）。窗口 = 一次 `disconnectAwait` 往返（≤5s）或 8s 上界。

**挂点/构造要点（TC-029~031 共用）**：这三条是同一个状态机（`settling` → 排队 → 兑现）的三个切片，必须用「测试基础设施前置说明」第 4 条新增的可控 `disconnectAwait` mock 逐条构造：TC-029 断言 resolve **之前**的中间态，TC-030 断言 resolve **之后**恰好触发一次，TC-031 断言即便**永不** resolve，8 秒上界这条兜底也会把连接意图放行。三条合起来才是 AC-13「要么真连、要么在编排彻底作废前保持忙碌，但绝不允许点了毫无反应」的完整证明；单独任何一条都只证明了状态机的一个切片。

---

### AC-14：曾取消/断开的机器再点连接，弃用标记随连接意图解除

#### Scenario: TC-032（T-032）弃用机器重新连接 → 生命周期事件正常呈现
**优先级**: P0 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 一台远程机此前被用户取消/断开（已带上弃用标记 abandoned[configId]=true）
When 用户点击其连接图标钮（`handleConnect` 第 1 步 `resume(id)` 解除弃用标记）
 And main 依次推送 connecting → deploying → verifying{tunnel} → ready 事件（经捕获的 onEvent 回调手动触发）
Then 组头逐阶段正常呈现对应文案/spinner，最终展示为 connected（RTT + 断开图标钮），不再被闸①/②吞掉
```

**挂点/构造要点**：与 TC-010/TC-011（同样形状的事件序列，但**未**重新点连接）形成对照组——那两条证明"不点连接，残余事件/verifying 必须被吞";本条证明"点了连接（resume 解除弃用）之后，同样形状的事件序列必须能正常穿透"。两组用例共用同一组 mock 事件构造工具，只是中间是否插入一次"点击连接"。

**范围说明**：`resume` 在 TECH v0.2 里有**三个**调用点——侧栏 `handleConnectMachine`、设置页 `handleConnect`、设置页 `handleUpgrade`（v0.1 漏掉了第三个，TECH 已在风险表 R2 里点名）。本条只覆盖侧栏这一个入口（本 Feature 的改动范围）；设置页两个入口的 `resume` 接线属于 Out of Scope 声明的"设置页布局不动，但事件过滤单源改写"那部分，其正确性建议由设置页自身的既有测试套件在改动落地后补一条轻量断言，不在本文件重复展开。

---

### AC-15：控件槽位无空洞、`+` 恒最右、同态内不抖动、connected 态三元素无双重间隙

#### Scenario Outline: TC-033（T-033）六态各自的组头控件槽位判据
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 按下表构造 MachineInfo 渲染出 "<状态>" 对应的 props
When 渲染 MachineGroup，取组头 header 元素的直接子元素列表
Then <断言>
```

**Examples**:
| 状态 | 断言 |
|---|---|
| 未连接（从未连接） | header 最后一个子元素是可访问名称 "Connect" 的按钮（无 `+`，因未连接不渲染 add 钮） |
| 连接中 | header 最后一个子元素是可访问名称 "Cancel" 的按钮 |
| 已连接 | header 最后**三个**子元素依次为：RTT 延迟元素（class 含 `sidebar-machine-rtt`）→ 可访问名称 "Disconnect" 的按钮 → class 含 `sidebar-machine-add` 的 `+` 钮，三者相邻无其它元素插在中间（🔴 只断言其中一两个测不出「双重 auto-margin 均分空隙」这类 bug，必须三元素整体连排一起验，见 TC-036 的 CSS 层配套判据） |
| 断线过渡（status='lost', foldedLost=false） | header 最后一个子元素是 `+`，其前一个兄弟元素是可访问名称 "Connect" 的按钮（UI.md 收紧后的判据：该态下 `+` 与连接图标钮同时渲染） |
| 自动重连中 | header 最后一个子元素是可访问名称 "Disconnect" 的按钮，其前一个兄弟元素是可访问名称 "Retry now" 的按钮（此态不渲染 `+`） |
| 已断开折叠 | header 最后一个子元素是可访问名称 "Reconnect" 的按钮 |

> 判据只用 DOM 顺序（`header.children` 数组下标）与 class/可访问名称断言，不断言任何 `getBoundingClientRect` 像素坐标——对齐 UI.md §3「实机走查后对 AC-15 的措辞收紧」：`+` 出现时恒贴最右、自身不移动；控件之间不重叠错位；同一状态内不抖动，而不是「控件绝对坐标恒定」。

#### Scenario: TC-034（T-034）同状态重复渲染不抖动
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 以某一状态（如 connected）渲染 MachineGroup 一次，记录 header.children 的 class 序列
When 用完全相同的 props rerender 一次
Then 两次的 header.children class 序列逐项相等（不因重渲染产生元素顺序抖动）
```

#### Scenario: TC-035（T-035）跨状态切换不留重复/孤儿控件节点
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 以「断线过渡」态渲染 MachineGroup（同时有连接图标钮与 `+`）
When rerender 为「已连接」态
Then 旧的连接图标钮从 DOM 移除，新的断开图标钮挂载，`+` 全程只有一份（querySelectorAll('.sidebar-machine-add').length === 1，不因切换产生第二份）
 And 组头内可点击的"连接类"按钮数量与该状态定义表一致（不多渲染、不留空按钮占位）
```

#### Scenario: TC-036（T-036）🔴 CSS 层：connected 态三元素只有一处 auto-margin，不产生双重间隙
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 读取 src/renderer/components/Sidebar.css 源文件内容
When 解析其中命中 `.sidebar-machine-rtt` / `.sidebar-machine-ctl` 的规则
Then `.sidebar-machine-rtt` 与 `.sidebar-machine-ctl` 均被纳入右推组（与既有的 `.sidebar-machine-status`/`.sidebar-machine-connect`/`.sidebar-machine-connecting` 同组，共享 `margin-left: auto`）
 And 存在一条覆盖规则，形如 `.sidebar-machine-header > :is(.sidebar-machine-rtt,.sidebar-machine-status,.sidebar-machine-connecting,.sidebar-machine-ctl) ~ :is(.sidebar-machine-ctl,.sidebar-machine-add) { margin-left: 0 }`（或等价选择器组合），确保 connected 态下 RTT/断开钮/`+` 这三个连排元素里**只有最靠左的那个**真正吃到 auto-margin，后面两个被钉为 0
```

**挂点/构造要点**：TECH v0.2 在 AC-15 落法段落明确点名的 bug——现有 `Sidebar.css:643-646` 的 auto 三件套不含 `.sidebar-machine-rtt`；如果实现只是简单地把 `.sidebar-machine-rtt` 和新的 `.sidebar-machine-ctl` 都加进 auto 组、却不补对应的 `margin-left: 0` 覆盖规则，connected 态会出现**两个 auto margin 均分空隙**（RTT 和断开钮之间凭空多一道间隙，`+` 又被推得更远）——`Sidebar.css:678-682` 现有注释本就是为了防这个模式（此前是 `.sidebar-machine-add` 单独防，现在要把 `.sidebar-machine-ctl` 也纳入同一套防御）。jsdom 无布局引擎测不出真实像素间隙，只能退化为 CSS 源文本的正则/字符串断言（与 TC-033 的 DOM 层三元素相邻断言互为补充：DOM 层证明"三个元素确实挨在一起渲染"，CSS 层证明"没有语义上会撑开间隙的双重 auto-margin"）。落点文件与 TC-026 共用 `sidebarCssInvariants.test.ts`。

---

## API E2E 判断

| 项目 | 内容 |
|---|---|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | OkWork 是本地 Electron 桌面应用，本 Feature 改动完全在渲染层（侧栏组头控件）与既有 IPC 语义的复用/受控扩展（新增的 `disconnectAwait` 是渲染层排队用的等待句柄，不改变 `orchestrator` 状态机本身，见 TECH Out of Scope）。无对外 HTTP/REST API；main 侧 `RemoteHostOrchestrator.connect/disconnect` 的状态机与超时行为已由 `src/main/remote/__tests__/orchestrator.test.ts`（含专门的「🔴 E9 disconnect() 有界超时」块）覆盖，本次不重复。 |

## Browser E2E 判断

| 项目 | 内容 |
|---|---|
| 是否需要 Browser E2E | ⏭️ 可跳过 |
| 用户是否可选择跳过 | 是（PMO 在执行前询问） |
| 原因 | 渲染进程依赖 `preload` 注入的 `window.okwork` IPC 桥与真实 Electron 主进程环境，脱离 Electron 宿主用通用 AI 浏览器工具直接打开页面无法复现（没有 IPC 桥，点击连接类按钮全部失效）。视觉设计已在 `docs/design`（same-stack 全景预览工程）由用户实机走查六态并确认（UI.md「✅ 用户确认预览」）；交互正确性由本文件 T-001~T-036 的组件/集成测试覆盖。若 dev 阶段希望在真实 app 里肉眼复核，建议用项目自带的 `run` 技能跑 `npm start` 手动走查，而非走浏览器 E2E 工具链。 |

---

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-05 | v0.1 首版草稿：32 条 TC（T-018 为既有测试引用，31 条新增），覆盖全部 15 条 AC；标注测试基础设施前置改造（onEvent 回调捕获 + reconnect 可控 deferred）；列出 MachineGroup.test.tsx/SidebarMachineGroups.test.tsx 中因 failed 态移出组头而必须重写的两组现有断言 |
| 2026-08-05 | v0.2 按 TECH v0.2（两道闸架构，两路冷审收敛后重写）对齐：① 架构从「一道闸」改叙为「状态写入闸 + 副作用闸」，各场景挂点相应更新；② 新增 4 条 TC 补齐 v0.1 完全没有 seam 覆盖的口子——T-011（AC-6(c) 残余 verifying 不得建连）、T-018（AC-7 自动重连退避期不重复弹 toast）、T-022（AC-9 闸④：`onReconnectNeeded` 被拦，真实触发源不是 main 事件）、T-036（AC-15 connected 态双重 auto-margin CSS 判据）；③ T-012（原 AC-6(b) resolve）断言措辞更正：不再断言 `readoptHost`/`onReconnected` 是否被调用（TECH 明确指出它会被调用后内部早退），改为断言 `session.list`/`session.attach` 未发出 + `hostRegistry.drop` 收尾；④ T-014（原「隐性不变式」）降级重述：不再是 AC-6(b)/(c) 的主证明（`getOrCreateRemote` 会把 client 塞回注册表，null 短路防线在残余握手路径上不成立），改为独立次级防御性单测，优先级 P0→P2；⑤ AC-2/AC-5 相关场景（T-003/T-009/T-019/T-021/T-028）补引用具体的四步同步序列 `abandon→cancel→clear→stopRemoteWorkspaceSync`；⑥ AC-13 三条（T-029~031）**全部重写**：删除原「aria-disabled 禁用态 + GO-030」的假设，改为「aria-busy 忙碌态 + 点击排队 + 8 秒上界」，三条分别覆盖排队中/结算后/上界兜底三个切片；⑦ T-033（AC-15 六态判据）connected 行加固为三元素连排整体断言（原只判两个元素）；⑧ 测试基础设施前置说明新增 2 条（`onReconnectNeeded` 捕获、`disconnectAwait` 可控 mock）；⑨ 新增 T-037：`setReconnecting` 写入闸（第六条独立写入路径）的纵深防御单测——`只挡置真·清假恒放行` 两个方向分别验证，挂靠 AC-2/AC-9，落新文件 `remoteHostStoreAbandonGate.test.ts`；⑩ 覆盖率仍 15/15，测试总数 32→37（新增 5，另有 T-011~014/024/029~031/033 等多条随架构与流程改序重写） |
| 2026-08-05 | v0.3 dev 收尾对齐:TC-029(AC-13)补一条断言 —— 忙碌态除 `aria-busy` 外还须渲染出 `.sidebar-machine-ctl__busy`(图标换同尺寸 spinner)且 `title` 为「正在断开…」。起因:dev 期真实组件逐态截图核对发现忙碌态与常态**像素级相同**,只写 ARIA 属性等于「点了看不到任何变化」,正是 AC-13 明令禁止的症状;同步订正本节前言里「两个按钮状态的差异只是 aria-busy 有没有」的表述 |
| 2026-08-05 | v0.4 新增 **T-038**(P0):排队中的连接在兑现前必须复查弃用标记。来源 = dev 期第三方核验发现 `handleConnectMachine` 的 `.then` 无条件发 IPC —— 四道副作用闸挡的是进来的事件,够不着这条已排队的出向 IPC;不补此用例则删掉那行守卫其余 37 条全绿。挂靠 AC-9 + AC-13 |
