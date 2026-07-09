---
feature_id: "TERMPRO-F260709092258-Workspace-Registry-Host"
status: draft
tests:
  - id: REG-001
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_create_returns_record_with_id_name_root
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: REG-002
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_create_with_supplied_id_is_idempotent_for_migration
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: REG-003
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_list_has_no_registry_side_sorting_ordering_is_ui_concern
    covers_ac: ["AC-5"]
    level: unit
    priority: P2
  - id: REG-004
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_update_only_touches_name_root_fields
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: REG-005
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_remove_excludes_id_from_subsequent_list
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: REG-006
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_persists_across_registry_reinstantiation_same_data_dir
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: REG-007
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_data_dir_injectable_via_constructor_not_electron_api
    covers_ac: ["AC-1", "AC-2"]
    level: unit
    priority: P1
  - id: REG-008
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_concurrent_create_same_id_yields_single_record_no_throw
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: REG-009
    file: src/host/__tests__/workspaceRegistry.test.ts
    function: test_corrupt_registry_file_initializes_empty_without_crash
    covers_ac: ["AC-4"]
    level: unit
    priority: P1
  - id: RPC-001
    file: src/renderer/state/__tests__/workspaceCrud.test.ts
    function: test_create_workspace_updates_list_only_after_rpc_success
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: RPC-002
    file: src/renderer/state/__tests__/workspaceCrud.test.ts
    function: test_create_workspace_rpc_failure_leaves_list_unchanged_and_prompts
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: RPC-003
    file: src/renderer/state/__tests__/workspaceCrud.test.ts
    function: test_pending_rpc_disables_or_dedupes_repeat_submit
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: RPC-004
    file: src/renderer/state/__tests__/workspaceCrud.test.ts
    function: test_rename_workspace_rpc_failure_leaves_name_unchanged
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: RPC-005
    file: src/renderer/state/__tests__/workspaceCrud.test.ts
    function: test_remove_workspace_rpc_failure_leaves_workspace_present
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: COORD-001
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_snapshot_new_id_synthesizes_default_single_tab_view
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: COORD-002
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_snapshot_new_id_does_not_change_local_active_workspace
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: COORD-003
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_snapshot_new_id_appended_to_sort_order_tail
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: COORD-004
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_snapshot_missing_id_disposes_tabs_and_removes_view
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: COORD-005
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_snapshot_common_id_syncs_only_name_and_root
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: COORD-006
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_snapshot_common_id_preserves_local_tabs_active_tab_and_order
    covers_ac: ["AC-3", "AC-5"]
    level: unit
    priority: P0
  - id: COORD-007
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_mixed_add_remove_snapshot_converges_existence_both_sides
    covers_ac: ["AC-3"]
    level: unit
    priority: P0
  - id: COORD-008
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_active_workspace_removed_remotely_switches_to_first_remaining
    covers_ac: ["AC-6"]
    level: unit
    priority: P1
  - id: COORD-009
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_inactive_workspace_removed_remotely_keeps_active_unchanged
    covers_ac: ["AC-6"]
    level: unit
    priority: P1
  - id: COORD-010
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_remote_removal_disposes_all_ptys_of_that_workspace_no_orphan
    covers_ac: ["AC-6"]
    level: unit
    priority: P0
  - id: COORD-011
    file: src/renderer/state/__tests__/workspaceSync.test.ts
    function: test_own_echo_push_for_just_created_id_merges_as_existing_not_new
    covers_ac: ["AC-3"]
    level: unit
    priority: P1
  - id: MIG-001
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_n_zero_marks_migrated_with_empty_registry_no_error
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: MIG-002
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_no_v1_file_fresh_install_treated_as_migrated_no_retry
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: MIG-003
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_n_gt_zero_each_workspace_created_with_original_id_preserved
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: MIG-004
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_successful_migration_backs_up_original_v1_file
    covers_ac: ["AC-1"]
    level: unit
    priority: P1
  - id: MIG-005
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_second_launch_after_success_does_not_recreate_entries
    covers_ac: ["AC-1"]
    level: unit
    priority: P0
  - id: MIG-006
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_partial_create_failure_leaves_v1_file_intact_and_unmarked
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: MIG-007
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_failed_migration_falls_back_to_full_v1_mode_name_root_writable
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: MIG-008
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_failed_migration_retries_automatically_on_next_launch
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: MIG-009
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_three_consecutive_failures_trigger_single_lightweight_prompt_no_flood
    covers_ac: ["AC-4"]
    level: unit
    priority: P1
  - id: MIG-010
    file: src/main/__tests__/workspaceMigration.test.ts
    function: test_eventual_success_after_retries_marks_idempotent_no_duplicate_records
    covers_ac: ["AC-1", "AC-4"]
    level: unit
    priority: P1
  - id: INT-001
    file: src/host/__tests__/workspaceMultiClient.integration.test.ts
    function: test_client_a_create_pushes_snapshot_client_b_synthesizes_default_view
    covers_ac: ["AC-3"]
    level: integration
    priority: P1
  - id: INT-002
    file: src/host/__tests__/workspaceMultiClient.integration.test.ts
    function: test_client_a_rename_client_b_syncs_name_only_keeps_local_view_state
    covers_ac: ["AC-3"]
    level: integration
    priority: P1
  - id: INT-003
    file: src/host/__tests__/workspaceMultiClient.integration.test.ts
    function: test_client_b_removes_workspace_active_on_client_a_disposes_and_switches
    covers_ac: ["AC-6"]
    level: integration
    priority: P1
  - id: INT-004
    file: src/host/__tests__/workspaceMultiClient.integration.test.ts
    function: test_failed_create_rpc_on_client_a_does_not_push_to_client_b
    covers_ac: ["AC-2"]
    level: integration
    priority: P1
  - id: REGR-001
    file: src/renderer/state/__tests__/workspaceHydrate.test.ts
    function: test_hydrate_v2_preserves_tabs_active_tab_and_file_panel_state
    covers_ac: ["AC-5"]
    level: unit
    priority: P1
  - id: REGR-002
    file: src/renderer/state/__tests__/workspaceHydrate.test.ts
    function: test_hydrate_drops_orphan_workspace_ref_not_in_host_registry_silently
    covers_ac: ["AC-5"]
    level: unit
    priority: P1
  - id: REGR-003
    file: src/renderer/state/__tests__/workspaceUpgrade.integration.test.ts
    function: test_post_migration_existing_tab_panel_sort_features_unchanged
    covers_ac: ["AC-5"]
    level: integration
    priority: P1
  - id: REGR-004
    file: src/main/main.ts
    function: test_smoke_boot_lists_workspaces_from_host_registry_smoke_ok
    covers_ac: ["AC-1"]
    level: fe-e2e
    priority: P0
  - id: REGR-005
    file: src/renderer/state/__tests__/workspaceUpgrade.integration.test.ts
    function: test_upgrade_from_v1_store_end_to_end_sidebar_matches_pre_migration
    covers_ac: ["AC-1"]
    level: integration
    priority: P1
---

# Workspace 注册表驻留 Host（模型 A 地基 · 本地先行） - 测试用例

## 状态
草稿

---

## Feature: Workspace 注册表驻留 Host

作为 TermPro 用户
我希望「我的项目列表」归属机器本身而不是某个 UI 实例
以便将来任何设备连接这台机器都能看到一致的项目与会话（价值由下游 BL-004/mobile 兑现；本 Feature 交付地基，用户当下感知 = 升级无感 + 行为零回归）

---

## 需求覆盖矩阵

> 反查 PRD.md frontmatter 的 `acceptance_criteria[]`；机器校验：`python3 ~/.claude/skills/teamwork/templates/verify-ac.py {Feature 目录}`

| AC ID（PRD）| 需求描述 | 优先级 | 覆盖测试（对应 frontmatter `tests[].id`）| 状态 |
|-------------|---------|--------|------------------------------------------|------|
| AC-1 | 迁移：v1→Host 注册表，保留原 id，N=0/无存档，幂等 | P0 | REG-002, REG-007, REG-008, MIG-001, MIG-002, MIG-003, MIG-004, MIG-005, MIG-010, REGR-004, REGR-005 | ✅ |
| AC-2 | 增删改经协议写 Host；等待确认语义；防重复提交；重启一致 | P0 | REG-001, REG-004, REG-005, REG-006, REG-007, RPC-001, RPC-002, RPC-003, RPC-004, RPC-005, INT-004 | ✅ |
| AC-3 | `workspace:changed` 全量快照，收端按 id 协调（增/删/存三分支，不抢激活） | P0 | COORD-001, COORD-002, COORD-003, COORD-004, COORD-005, COORD-006, COORD-007, COORD-011, INT-001, INT-002 | ✅ |
| AC-4 | 迁移失败→v1 全功能 fallback，自动重试，连续 3 次轻量提示 | P0 | REG-009, MIG-006, MIG-007, MIG-008, MIG-009, MIG-010 | ✅ |
| AC-5 | 视图态（tab/宽度/排序/activeWorkspaceId）留 UI 不丢；v2 去 name/root；孤儿引用丢弃 | P1 | REG-003, COORD-006, REGR-001, REGR-002, REGR-003 | ✅ |
| AC-6 | 远端删除→本地释放 tab/PTY+视图移除，活跃则切换 | P1 | COORD-008, COORD-009, COORD-010, INT-003 | ✅ |

覆盖率：6 / 6（100%）

---

## 测试场景

### 分层 1：Host 注册表单测（CRUD / 持久化 / 幂等 / 临时目录）

> 目标模块：Host 侧新增的纯 Node workspace 注册表实现（无 Electron import，数据目录经构造参数/env 注入，单测用 `mkdtemp(tmpdir())` 与既有 `fsService.test.ts` 同款临时目录模式）。文件路径为 QA 依现有 `src/host/__tests__/` 组织惯例给出的目标路径，实际模块拆分以 blueprint TECH 为准。

#### Scenario: REG-001 create 返回完整记录
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一个指向空临时目录的 Host workspace 注册表
When 调用 create 写入 name="proj" root="/tmp/proj"
Then 返回记录包含系统生成的 id、name="proj"、root="/tmp/proj"
 And 该 id 出现在后续 list 结果中
```

#### Scenario: REG-002 create 携带调用方指定 id 时幂等（迁移场景）
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 一个空注册表
When 迁移流程以指定 id="orig-id-1" 调用 create 两次（模拟迁移中断后重跑同一条）
Then 注册表内 id="orig-id-1" 只存在一条记录
 And 第二次调用不抛错、不产生第二条记录
```

#### Scenario: REG-003 list 不做排序，排序是 UI 视图态职责
**优先级**: P2 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 注册表按 create 调用顺序写入 3 个 workspace
When 调用 list
Then 返回顺序即插入顺序（注册表不持有/不响应任何"排序"请求）
```

#### Scenario: REG-004 update 只改 name/root，不产生其他副作用字段
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 注册表中存在 id="w1" name="old" root="/a"
When 调用 update(id="w1", { name: "new" })
Then id="w1" 的 name 变为 "new"，root 仍为 "/a"
 And 记录不出现视图态字段（无 tabs/activeTabId 等，注册表 schema 天然不含）
```

#### Scenario: REG-005 remove 后不再出现在 list
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 注册表中存在 id="w1"
When 调用 remove("w1")
Then list 结果不再包含 id="w1"
 And 对已删除 id 再次 remove 不抛错（幂等删除）
```

#### Scenario: REG-006 持久化跨重启存活
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 一个指向临时目录 D 的注册表实例，已 create 两个 workspace
When 销毁该实例，用同一目录 D 重新构造一个新注册表实例（模拟进程重启）
Then 新实例 list 返回与重启前一致的两个 workspace（id/name/root 全部保留）
```

#### Scenario: REG-007 数据目录可注入，不依赖 Electron API
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 注册表构造函数/工厂接受显式数据目录参数（fork 参数或 env，非 app.getPath）
When 以临时目录路径构造两个并行实例（模拟多组单测并行跑）
Then 两个实例各自读写互不干扰
 And 构造过程不触发任何 Electron 模块（保持 Host 零 Electron 红线可单测验证）
```

#### Scenario: REG-008 并发 create 同一 id 只留一条且不抛错
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 一个空注册表
When 并发（Promise.all）以相同 id="race-1" 调用 create 两次
Then 两次调用均 resolve（不抛错）
 And 最终 list 中 id="race-1" 只有一条记录
```

#### Scenario: REG-009 注册表文件损坏时初始化不崩溃
**优先级**: P1 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 数据目录下的注册表文件内容被替换为非法 JSON
When 构造注册表实例并调用 list
Then 不抛出未捕获异常，list 返回空数组
 And 之后调用 create 可正常写入并被后续 list 看到（自愈，不产生二次故障扩散到迁移重试）
```

---

### 分层 2：客户端 RPC 语义单测（等待确认 / 防重复提交）

> 覆盖 D-1 裁决（等待确认式：RPC 成功才更新列表）与 PL-CHALLENGE-R2-2（等待期防重复提交）。目标模块：renderer store 中把 `addWorkspace`/`updateWorkspace`/`removeWorkspace` 从同步本地写改为等待 `workspace.create/update/remove` RPC 结果的包装层。

#### Scenario: RPC-001 create 仅在 RPC 成功后更新列表
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 用户在 Sidebar 触发新增 workspace，对应 RPC 尚未返回
When RPC 返回成功（含 Host 分配的 id/name/root）
Then 本地 workspace 列表新增一条，字段与 RPC 结果一致
 And 新 workspace 成为激活 workspace（创建方"新建即选中"）
```

#### Scenario: RPC-002 create 的 RPC 失败时列表不变且明确提示
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 用户在 Sidebar 触发新增 workspace
When RPC 返回失败（如注册表写入异常）
Then 本地 workspace 列表不发生任何变化
 And 触发一条非 tab 级的轻量一次性提示（不进通知历史、无点击导航）
```

#### Scenario: RPC-003 等待期间操作入口防重复提交
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 用户触发新增 workspace 的 RPC 尚未返回（in-flight）
When 用户在此期间再次触发同一操作入口（如连续点击"新增"）
Then 第二次触发被禁用或被去重（不产生第二个并发 RPC / 不产生重复 workspace）
 And RPC 结果返回后，操作入口恢复可用
```

#### Scenario: RPC-004 rename 的 RPC 失败时名称不变
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given workspace id="w1" 当前 name="old"
When 用户重命名为 "new" 但对应 RPC 返回失败
Then 本地 id="w1" 的 name 仍为 "old"
 And 触发失败提示（同 RPC-002 提示路径）
```

#### Scenario: RPC-005 remove 的 RPC 失败时 workspace 仍存在
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given workspace id="w1" 存在于本地列表且含运行中 tab
When 用户删除该 workspace 但对应 RPC 返回失败
Then 本地列表仍包含 id="w1"，其 tab/终端实例未被释放
 And 触发失败提示
```

---

### 分层 3：协调算法单测（增 / 删 / 存三分支 + 不抢激活）

> 覆盖 AC-3 收端协调契约与 AC-6 远端删除回收。目标模块：renderer 侧收到 `workspace:changed` 全量快照后按 id 协调本地 `WorkspaceState[]` 的纯函数（输入：本地状态 + 快照，输出：新状态 + 副作用指令，如需 dispose 的 tab 列表），便于脱离真实 host 做纯单测。

#### Scenario: COORD-001 快照新增 id → 合成默认视图
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 本地 workspace 列表为 [w1]，本端 activeWorkspaceId=w1
When 收到全量快照 [w1, w2]（w2 为本地未知的新 id）
Then 本地列表新增 w2，其视图态为单个 root tab（cwd=w2.root）
```

#### Scenario: COORD-002 快照新增 id 不抢占本端激活态
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 本地 activeWorkspaceId=w1
When 收到全量快照新增 w2
Then 协调后 activeWorkspaceId 仍为 w1（不因新增而改变本端焦点）
```

#### Scenario: COORD-003 快照新增 id 追加到排序末尾
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 本地排序为 [w1, w3]
When 收到全量快照新增 w2
Then 协调后本地排序为 [w1, w3, w2]（新条目在末尾，不打乱既有顺序）
```

#### Scenario: COORD-004 快照缺失 id → 回收视图并从列表移除
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 本地 workspace 列表为 [w1, w2]，w2 含 2 个 tab（各对应一个终端实例）
When 收到全量快照 [w1]（w2 缺失，代表远端已删除）
Then 本地列表移除 w2
 And w2 的全部 tab 与终端实例被释放（dispose，不留悬空引用）
```

#### Scenario: COORD-005 两侧都有的 id → 仅同步 name/root
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 本地 w1 = { name: "old", root: "/a", tabs: [t1, t2], activeTabId: t2 }
When 收到全量快照，w1 的 name 变为 "new"、root 变为 "/b"
Then 本地 w1.name="new"、w1.root="/b"
 And w1.tabs 与 activeTabId 与协调前完全一致（不重建/不清空）
```

#### Scenario: COORD-006 两侧都有的 id 不受推送影响：tabs/activeTabId/排序位置均保持
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 本地 w1 排在第 2 位，activeTabId=t2，且本端 activeWorkspaceId=w1
When 收到只含 name/root 变化、workspace 存在性不变的全量快照
Then 本地排序位置、activeTabId、本端 activeWorkspaceId 三者均不变
 And 视图态（tab 数组引用意义上的语义）未被替换/未丢失
```

#### Scenario: COORD-007 增删混合快照单次应用后两端存在性一致
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given 本地列表为 [w1, w2, w3]
When 收到全量快照 [w1, w3, w4]（w2 被删、w4 新增）
Then 协调后本地列表 id 集合为 {w1, w3, w4}
 And w2 被回收（同 COORD-004），w4 被合成默认视图（同 COORD-001），w1/w3 视图态不动
```

#### Scenario: COORD-008 远端删除本端正激活的 workspace → 切换到剩余首个
**优先级**: P1 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 本地列表 [w1, w2]，本端 activeWorkspaceId=w1
When 收到全量快照 [w2]（w1 被远端删除）
Then 本端 activeWorkspaceId 切换为 w2（剩余首个 workspace）
```

#### Scenario: COORD-009 远端删除非激活 workspace → 激活态不变
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 本地列表 [w1, w2]，本端 activeWorkspaceId=w1
When 收到全量快照 [w1]（w2 被远端删除，w2 非激活）
Then 本端 activeWorkspaceId 仍为 w1
```

#### Scenario: COORD-010 远端删除释放该 workspace 全部 PTY，无孤儿实例
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given workspace w1 含 3 个 tab，均绑定运行中终端实例
When 收到全量快照缺失 w1
Then 3 个终端实例全部被 dispose（无孤儿 PTY / 无悬空 terminalRegistry 引用）
 And 全局终端实例注册表中不再能查到这 3 个 tabId
```

#### Scenario: COORD-011 自发起变更的回声推送按"已存在 id"合并，不重复合成
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

> 背景（PL-R3-1 advisory · 未在 PRD 锁定，留待 blueprint TECH 显式界定时序契约）：创建方经 RPC 成功路径（RPC-001）已将新 workspace 计入本地列表并设为激活；随后同一变更触发的 `workspace:changed` 回声推送到达。本用例验证协调算法本身对"id 已存在于本地"的处理与来源（本端触发 vs 他端触发）无关——不应二次合成默认视图，也不应覆盖已由 RPC 成功路径设定的 activeWorkspaceId/tabs。若 blueprint 最终选择"RPC 成功前先屏蔽同 id 回声推送"等不同时序方案，本用例的合并语义仍应作为兜底不变式保留。

```gherkin
Given 本端刚通过 RPC 成功创建 w5 并已激活（tabs=[t1]，activeWorkspaceId=w5）
When 收到该操作触发的 workspace:changed 全量快照（其中包含 w5，name/root 与本地一致）
Then 协调算法按"两侧都有的 id"分支处理 w5（仅同步 name/root）
 And 本地 w5 的 tabs/activeTabId 与本端 activeWorkspaceId 均不被覆盖
```

---

### 分层 4：迁移单测（N=0 / N>0 / 失败回退 / 重试 / 备份 / id 保留）

> 目标模块：壳层（`src/main/`）驱动的迁移流程——读 v1 存档、逐条经 `workspace.create` 写入 Host、成功后备份原文件并写幂等标记；失败则保持 v1 全功能、下次启动重试。测试通过注入假的 `createHostWorkspace`/文件系统依赖驱动，不需要真实 Host 进程。

#### Scenario: MIG-001 N=0（v1 存档存在但 workspaces 为空数组）
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given v1 存档文件存在，其中 workspaces=[]
When 应用启动执行迁移
Then 迁移标记为已完成，Host 注册表为空列表
 And 迁移过程不抛错、不产生任何 create 调用
```

#### Scenario: MIG-002 无存档（全新安装）等价于已迁移
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given v1 存档文件不存在（全新安装）
When 应用启动检测迁移状态
Then 直接标记为已迁移，不进入重试轮询
 And 不产生任何 create 调用
```

#### Scenario: MIG-003 N>0 逐条写入且保留原 id
**优先级**: P0 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given v1 存档含 2 个 workspace（id="v1-a"、id="v1-b"）
When 执行迁移
Then Host 注册表中出现 id="v1-a" 与 id="v1-b" 两条记录（id 与 v1 存档一致，未被重新生成）
 And name/root 与 v1 存档条目一致
```

#### Scenario: MIG-004 迁移成功后原 v1 存档被备份
**优先级**: P1 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given v1 存档含至少 1 个 workspace
When 迁移全部写入成功
Then 存在一份备份文件，内容与迁移前的原始 v1 存档一致
 And 原 v1 存档路径的文件仍可读（未被直接删除/清空）
```

#### Scenario: MIG-005 二次启动不重复迁移
**优先级**: P0 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 上一次启动已成功迁移（幂等标记已写入）
When 应用再次启动
Then 不再对 Host 注册表发起任何 create 调用
 And Host 注册表内容与首次迁移后一致
```

#### Scenario: MIG-006 部分条目写入失败时 v1 存档保持完好且不打迁移标记
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given v1 存档含 3 个 workspace，第 2 条的 create 调用被注入为失败
When 执行迁移
Then v1 存档文件内容不变、未被删除或截断
 And 迁移完成标记未被写入（不产生"部分迁移"的中间态）
```

#### Scenario: MIG-007 迁移失败后应用以 v1 存档全功能工作
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 上次启动迁移失败
When 应用本次启动检测到未迁移状态且迁移标记为 fallback
Then persistence 层进入完整 v1 模式：workspace 的 name/root 读写均经 v1 存档路径完成
 And 不存在任何只读限制（增/删/改在 v1 模式下与迁移前行为一致）
```

#### Scenario: MIG-008 迁移失败后下次启动自动重试
**优先级**: P0 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 上次启动迁移失败（未打成功标记）
When 应用再次启动
Then 迁移流程被自动重新触发（无需用户手动操作）
```

#### Scenario: MIG-009 连续 3 次失败触发一次轻量提示且不刷屏
**优先级**: P1 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given 迁移已连续失败 2 次
When 第 3 次启动的迁移再次失败
Then 触发一次迁移失败提示钩子（跨越阈值那次触发，具体 UI 渲染形式归 blueprint TECH）
 And 若第 4、5 次仍失败，不因每次启动都重复触发提示（去重/节流，不刷屏）
```

#### Scenario: MIG-010 重试后最终成功不产生重复记录
**优先级**: P1 | **类型**: 边界 | **测试层级**: unit

```gherkin
Given 第一次迁移尝试中前 2 条已成功 create、第 3 条失败中断
When 下一次启动重试且这次全部成功
Then Host 注册表中前 2 条 id 各只出现一次（不因重试重复 create）
 And 迁移完成标记被正确写入
```

---

### 分层 5：集成（双客户端 harness）

> P1（AC-3 正文定档：单测锁协议契约为 P0，双客户端集成验证归 TC 层 P1 用例）。Harness 需实例化一个 Host（或 Host 核心逻辑）与两个模拟协议客户端（两条 MessagePort/内存双工通道），验证跨客户端的 `workspace:changed` 推送与协调收敛。若 host.ts 当前未导出可脱离 utilityProcess 复用的构造函数，需 blueprint/RD 补一个纯函数入口（如 `createWorkspaceHostCore()`）供 harness 调用，不改变生产路径行为。

#### Scenario: INT-001 客户端 A 新增 → 客户端 B 合成默认视图
**优先级**: P1 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 客户端 A、B 均已连接同一 Host，初始 workspace 列表为空
When 客户端 A 调用 workspace.create 成功
Then 客户端 B 收到 workspace:changed 全量快照并按协调算法合成默认视图（单 tab，不抢占 B 的 activeWorkspaceId）
 And A、B 的 workspace id 集合一致
```

#### Scenario: INT-002 客户端 A 重命名 → 客户端 B 仅同步 name，视图态不变
**优先级**: P1 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 客户端 A、B 均已连接同一 Host，双方已存在 workspace w1，B 端 w1 有 2 个 tab 且非默认排序位置
When 客户端 A 调用 workspace.update(w1, { name: "renamed" })
Then 客户端 B 收到推送后 w1.name 更新为 "renamed"
 And 客户端 B 的 w1.tabs 数量、排序位置均不变
```

#### Scenario: INT-003 客户端 B 删除激活中 workspace → 客户端 A 回收并切换
**优先级**: P1 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given 客户端 A 打开 workspace w1（含 1 个运行中 PTY tab）且 w1 为 A 的激活 workspace；A 还有另一 workspace w2
When 客户端 B 调用 workspace.remove(w1)
Then 客户端 A 收到推送后释放 w1 的全部 tab 与终端实例，w1 从 A 的视图移除
 And A 的 activeWorkspaceId 切换为 w2
```

#### Scenario: INT-004 客户端 A 的失败 RPC 不产生推送
**优先级**: P1 | **类型**: 异常 | **测试层级**: integration

```gherkin
Given 客户端 A、B 均已连接同一 Host；Host 注册表写入被注入为失败（如磁盘只读模拟）
When 客户端 A 调用 workspace.create
Then A 收到 RPC 失败响应，A 本地列表不变
 And 客户端 B 未收到任何 workspace:changed 推送（无变更未推送）
```

---

### 分层 6：回归（视图态不丢 / SMOKE）

#### Scenario: REGR-001 hydrate v2 存档保留 tab/面板视图态
**优先级**: P1 | **类型**: 功能 | **测试层级**: unit

```gherkin
Given v2 PersistedState 含 workspaceId 外键 + 2 个 tab（各带 customName、filePanel 绑定）+ activeTabId
When 调用 store.hydrate(persisted)
Then hydrate 后的 workspace 视图态（tabs 数量、customName、filePanel、activeTabId）与存档一致，无字段丢失
```

#### Scenario: REGR-002 hydrate 遇孤儿引用静默丢弃
**优先级**: P1 | **类型**: 异常 | **测试层级**: unit

```gherkin
Given v2 PersistedState 含 workspaceId="ghost"（对应 Host 注册表已不存在的 workspace）与另一条有效 workspaceId="w1"
When 调用 hydrate（Host 注册表当前只返回 w1）
Then hydrate 后的 workspace 列表只含 w1，"ghost" 条目被静默丢弃
 And 不抛错、不阻塞 w1 的正常渲染
```

#### Scenario: REGR-003 迁移完成后既有视图态功能行为不变
**优先级**: P1 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 应用已完成迁移，处于 v2 模式
When 用户依次执行：新增 tab、关闭 tab、调整面板宽度、拖拽排序 workspace、切换活跃 workspace
Then 上述操作的行为与迁移前完全一致
 And workspace 排序与 activeWorkspaceId 只写入 UI 存档（不触发任何 workspace.update RPC）
```

#### Scenario: REGR-004 SMOKE 冒烟：Sidebar 列表来自 Host 注册表
**优先级**: P0 | **类型**: 功能 | **测试层级**: fe-e2e

```gherkin
Given 以 TERMPRO_SMOKE=1 启动应用（既有 `npx electron-forge start` 冒烟路径，见 src/main/main.ts 冒烟分支）
When 渲染层完成 Host 握手并 hydrate
Then 冒烟输出 SMOKE_OK（不因本 Feature 的 workspace 注册表改动而超时/报错）
 And （若冒烟路径附带断言）Sidebar workspace 列表来源可追溯到 Host 注册表而非仅 UI 存档
```

#### Scenario: REGR-005 端到端升级：v1 存档启动新版本，Sidebar 与迁移前一致
**优先级**: P1 | **类型**: 功能 | **测试层级**: integration

```gherkin
Given 一份旧版本遗留的 v1 存档，含 3 个 workspace（各带若干 tab）
When 以新版本启动（触发迁移 → hydrate → 渲染 Sidebar 列表的完整链路，Node 层驱动，不要求真实 Electron 窗口）
Then Sidebar 应呈现的 workspace 列表（id/name/root/tab 数）与迁移前的 v1 存档完全一致
 And 该链路是 MIG-003（数据正确写入）与 REGR-001（视图态正确 hydrate）在真实调用顺序下的端到端复验
```

---

## UI 还原检查（如有 UI）

不适用（`requires_ui: false`；PRD Out of Scope 明确 Sidebar 外观与交互不变，无新组件/新页面设计面）。

---

## E2E 端到端验收（QA Write Cases 阶段必须填写此章节）

### API E2E 判断（QA 必填，默认必须执行）

| 项目 | 内容 |
|------|------|
| 是否需要 API E2E | ⏭️ 不适用（原因见下） |
| 原因 | 本 Feature 新增的对外协议方法（`workspace.create`/`update`/`remove` RPC + `workspace:changed` 推送）走的是 HostService 协议（本地 MessagePort，远程 WebSocket 传输不在本 Feature 范围内——见 PRD Out of Scope），**没有 HTTP 端点**，curl/httpie 无法驱动。这不是"纯前端改动"式豁免，而是传输层不匹配：该协议契约的端到端验证（真实请求链路、响应、副作用）由分层 4「集成（双客户端 harness）」（INT-001..INT-004，vitest 直接实例化 Host 核心逻辑 + 两个模拟协议客户端）等效承担，执行工具是 vitest 而非 curl，验收强度不打折。 |

### API E2E 前置条件

不适用（无 HTTP 端点，见上）。

### API E2E Scenarios

不适用。协议契约验证见分层 4 INT-001..INT-004。

---

### Browser E2E 判断（有 UI 时填写）

| 项目 | 内容 |
|------|------|
| 是否需要Browser E2E | ⏭️ 可跳过（原因见下） |
| 用户是否可选择跳过 | 是（PMO 在执行前询问） |

> 原因：`requires_ui: false`，PRD Out of Scope 明确本 Feature 的 Sidebar 外观与操作完全不变、无新组件；已有的 Sidebar workspace CRUD 交互不因本次改动而产生新的可视行为。唯一潜在的新可视面是 AC-4 的迁移失败一次性轻量提示，其最终 UI 形式（是否复用/最小扩展既有 NotificationItem，或独立提示路径）由 blueprint TECH 设计（ARCH-R3-1 advisory：TECH 定提示路径时确认是否需 Designer 过目）。**若 blueprint 最终确定该提示是可见新组件而非纯复用**，应在 blueprint/dev 阶段回补至少 1 条 Browser E2E 用例（观察点：提示出现、不进通知历史、无点击导航、自动消失/无需用户手动关闭的具体交互），并同步更新本节判断为「需要」。

### Browser E2E 前置条件

暂不适用（见上，留待 blueprint 确认提示路径后按需回补）。

### Browser E2E Scenarios

暂无（见上）。

---

## 实现完整性报告（代码审查时填写）

| 需求项 | 状态 | 代码位置 | 测试位置 |
|--------|------|----------|----------|
| Host workspace 注册表（CRUD/持久化/幂等） | ⬜ 待实现 | src/host/（模块拆分待 blueprint TECH） | src/host/__tests__/workspaceRegistry.test.ts |
| 客户端 RPC 等待确认 + 防重复提交 | ⬜ 待实现 | src/renderer/state/store.ts（workspace CRUD action 改造） | src/renderer/state/__tests__/workspaceCrud.test.ts |
| 收端协调算法（增/删/存三分支） | ⬜ 待实现 | src/renderer/state/（新模块，暂命名 workspaceSync.ts） | src/renderer/state/__tests__/workspaceSync.test.ts |
| 壳层驱动迁移（v1→Host，备份，幂等标记，失败 fallback） | ⬜ 待实现 | src/main/（新模块，暂命名 workspaceMigration.ts） | src/main/__tests__/workspaceMigration.test.ts |
| v2 PersistedWorkspace（去 name/root，孤儿引用丢弃） | ⬜ 待实现 | src/renderer/state/store.ts, persistence.ts | src/renderer/state/__tests__/workspaceHydrate.test.ts |
| 协议新增 workspace.* RPC + workspace:changed | ⬜ 待实现 | src/shared/protocol.ts | 随各分层单测覆盖 |
| 双客户端集成 harness | ⬜ 待实现 | 测试基建（可能需 host.ts 补可复用构造函数） | src/host/__tests__/workspaceMultiClient.integration.test.ts |

完整性: 0/7（0%）— 本文档为 blueprint 阶段 QA 起草的 TC，实现尚未开始。

---

## TDD 检查（代码审查时填写）

- [ ] 测试先于实现（检查 git 提交顺序）
- [ ] 后端（Host + 壳层迁移）覆盖率 > 80%
- [ ] 前端（renderer 协调/hydrate/RPC 封装）覆盖率 > 70%
- [ ] 测试可独立运行（`npm test`，不依赖真实 Electron 窗口）
- [ ] 测试命名符合 Scenario 描述
- [ ] 边界条件已覆盖（N=0/无存档/并发 create/损坏文件/等待期重复提交）
- [ ] 异常场景已覆盖（迁移部分失败/RPC 失败/远端删除回收/孤儿引用）

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-09 | v1 首版：基于 PRD v0.3（Round 3 全 APPROVE）起草，44 条测试用例，6/6 AC 覆盖 |

---

## 🧩 补充洞察（AI 自由发挥 · 可留空）

- **PL-R3-1（advisory，未决）**：自发起变更的回声推送 vs 他端推送的时序契约（创建方"新建即选中"如何与 `workspace:changed` 回声共存）PRD 未锁定，本 TC 的 COORD-011 按"协调算法对 id 已存在的合并语义与来源无关"这一保守不变式落笔，作为 blueprint 最终设计的兜底验收；若 blueprint 选择"RPC in-flight 期间本地屏蔽同源回声推送"等更精细方案，COORD-011 的断言仍应成立（合并不重建），可直接复用不必重写。
- **ARCH-R3-2（advisory，未决）**：迁移完成标记的落点（v1 存档内 vs Host 注册表内）未定，本 TC 的 MIG-001/002/005/008 只按行为断言"是否重复迁移/是否自动重试"，不假设标记的物理存储位置，故不受 blueprint 具体选型影响。
- **测试基建缺口**：分层 5（双客户端 harness）依赖 host 核心逻辑能脱离 `utilityProcess`/`parentPort` 被纯函数式实例化两条模拟通道；当前 `src/host/host.ts` 是顶层脚本式实现（无导出的可复用入口），blueprint TECH 阶段需评估是否值得为此新增一个 `createWorkspaceHostCore()` 之类的入口，或改用更轻量的"直接测协调算法 + 直接测注册表"分离方式并把 INT-001..004 降级为对两者的组合调用（而非真跨 MessagePort）——两种做法都满足 AC-3 对集成信心的要求，具体取舍留给 RD，不影响本 TC 的场景断言本身。
- **REG-009 与 AC-4 的间接关联**：损坏注册表文件不崩溃这条本质是"注册表自身的健壮性"，不是 AC-4 定义的迁移失败路径，但如果注册表初始化本身会因脏数据抛错，会把迁移失败的重试循环拖入二次故障（重试→注册表初始化崩溃→应用启动失败，比"v1 全功能 fallback"更糟），故归入支撑 AC-4 的底线保护，供 code review 阶段核对因果链是否成立。
