---
feature_id: "OKWORK-F260810151932-Browser-Profile-Login-Continuity"
status: confirmed
tests:
  - id: T-001
    file: src/host/__tests__/remoteProfileRpc.test.ts
    function: test_AC1_catalog_lists_joinable_profiles_and_rejects_fixed_join_outcomes
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "新设备加入是登录连续性的入口；错误加入会暴露或覆盖另一 Profile 的受保护数据。"
  - id: T-002
    file: src/main/__tests__/remoteProfileAuthority.test.ts
    function: test_AC1_hydration_gate_blocks_navigation_until_current_generation_finishes
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "首个网站请求若绕过 hydration gate，会以错误登录态访问核心浏览器路径。"
  - id: T-003
    file: src/shared/__tests__/browserProfile.test.ts
    function: test_AC2_cookie_identity_is_stable_across_profile_partitions
    covers_ac: ["AC-2"]
    level: unit
    priority: P0
  - id: T-004
    file: src/main/__tests__/remoteProfileAuthority.test.ts
    function: test_AC2_applies_authoritative_persistent_cookie_once_and_skips_session_cookie
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "重复回声或 session Cookie 漫游会改变网站登录权限与会话寿命。"
  - id: T-005
    file: src/host/__tests__/remoteProfileStore.test.ts
    function: test_AC3_cookie_operations_are_idempotent_and_converge_by_host_revision
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "并发与重试的非确定结果会造成跨设备登录状态分叉。"
  - id: T-006
    file: src/host/__tests__/remoteProfileStore.test.ts
    function: test_AC4_tombstone_rejects_stale_cookie_without_treating_eviction_as_delete
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "陈旧 Cookie 复活是登录秘密与已登出状态的数据完整性事故。"
  - id: T-007
    file: src/host/__tests__/remoteProfileRpc.test.ts
    function: test_AC5_v1_bundle_remains_usable_and_cookie_capability_is_explicit
    covers_ac: ["AC-5"]
    level: integration
    priority: P0
  - id: T-008
    file: src/main/__tests__/remoteProfileMigration.test.ts
    function: test_AC5_cookie_seed_and_migration_resume_by_confirmed_cursor_under_payload_limit
    covers_ac: ["AC-5"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "分页续传或升级错误会造成配置、密码或 Cookie 数据丢失。"
  - id: T-009
    file: src/main/__tests__/remoteProfileAuthority.test.ts
    function: test_AC6_offline_cookie_changes_survive_restart_and_commit_after_reconnect
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "离线 journal 丢失会直接丢失用户刚完成的登录或登出操作。"
  - id: T-010
    file: src/main/__tests__/remoteProfileAuthority.test.ts
    function: test_AC6_late_generation_response_is_ignored_and_new_navigation_remains_gated
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
  - id: T-011
    file: src/main/__tests__/browserPasswordSecurity.test.ts
    function: test_AC7_cookie_payloads_are_redacted_from_renderer_dtos_and_logs
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "Cookie identity 或值进入普通 renderer、日志即构成登录秘密泄露。"
  - id: T-012
    file: src/host/__tests__/remoteProfileStore.test.ts
    function: test_AC7_cookie_authority_and_pending_journal_are_encrypted_with_private_permissions
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "未加密或宽权限落盘会泄露可用于网站认证的秘密。"
  - id: T-013
    file: src/main/__tests__/remoteProfileAuthority.test.ts
    function: test_AC8_invalid_or_oversize_cookie_is_skipped_without_rolling_back_confirmed_pages
    covers_ac: ["AC-8"]
    level: integration
    priority: P0
  - id: T-014
    file: src/renderer/components/settings/__tests__/BrowserProfilesSection.test.tsx
    function: test_AC9_renders_sanitized_login_continuity_summary_and_recovery_actions
    covers_ac: ["AC-9"]
    level: fe-e2e
    priority: P1
  - id: T-015
    file: src/renderer/components/__tests__/BrowserPanel.test.tsx
    function: test_AC9_browser_reports_restored_or_paused_without_cookie_details
    covers_ac: ["AC-9"]
    level: fe-e2e
    priority: P1
  - id: T-016
    file: src/main/__tests__/remoteProfileMigration.test.ts
    function: test_AC10_delete_move_epoch_prevents_stale_catalog_or_journal_revival
    covers_ac: ["AC-10"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "陈旧设备复活已删除或移走 Profile 会破坏全局删除与单一权威保证。"
  - id: T-017
    file: src/main/__tests__/browserProfileDeletion.test.ts
    function: test_AC10_remote_to_local_ends_sharing_and_cleanup_is_retryable_after_commit
    covers_ac: ["AC-10"]
    level: integration
    priority: P0
---

# Browser Profile 3A 登录连续性漫游 - 测试用例

## 状态

已确认（2026-08-11）

## 需求覆盖矩阵

| AC ID | 需求描述 | 优先级 | 覆盖测试 | 状态 |
|---|---|---|---|---|
| AC-1 | 发现、显式加入与 hydration gate | P0 | T-001, T-002 | ✅ |
| AC-2 | 持久 Cookie 跨分区对账与 session 跳过 | P0 | T-003, T-004 | ✅ |
| AC-3 | 并发操作的单调 revision 与幂等 | P0 | T-005 | ✅ |
| AC-4 | tombstone 防复活 | P0 | T-006 | ✅ |
| AC-5 | v1 兼容、能力探测、分页续传 | P0 | T-007, T-008 | ✅ |
| AC-6 | 离线 journal、generation 与恢复 | P0 | T-009, T-010 | ✅ |
| AC-7 | Cookie 秘密边界 | P0 | T-011, T-012 | ✅ |
| AC-8 | 单项跳过与脱敏计数 | P0 | T-013 | ✅ |
| AC-9 | Settings 总览与 OkBrowser 短反馈 | P1 | T-014, T-015 | ✅ |
| AC-10 | 全局删除/迁移 epoch | P0 | T-016, T-017 | ✅ |

覆盖率：10 / 10 (100%)

## 测试场景

### Scenario: TC-001 新设备只能显式加入可用的远端 Profile
**优先级**: P0  
**类型**: 功能 / 异常  
**测试层级**: integration

```gherkin
Given Host 上有一个 Remote Profile，设备 B 尚无该 profileId
When B 读取可加入摘要并确认“在此设备使用”
Then B 以 Host 返回的稳定 profileId 加入，并可读取最新 Profile 配置和密码能力
And 同名不同 ID 仍按 Host 区分
And 已绑定其他权威、已删除或移走、无权限及协议不兼容均以固定结果拒绝加入
And 本机权威 Profile 不出现在可加入结果中
```

### Scenario: TC-002 首次导航必须等待当前 generation 的 Cookie hydration
**优先级**: P0  
**类型**: 功能 / 异常  
**测试层级**: integration

```gherkin
Given 已加入的 Remote Profile 尚未完成当前 Host generation 的 hydration
When 创建 webview、导航或重载 URL
Then 不发出任何网站请求直到 hydration 完成
And 仅有可记录的部分跳过时可放行
And Host 离线、不兼容或超时时维持零网站请求并提供重试
```

### Scenario: TC-003 Cookie identity 在 Profile 级跨网络出口稳定
**优先级**: P0  
**类型**: 边界  
**测试层级**: unit

```gherkin
Given 同一 Remote Profile 存在本机直连及多个远程出口分区
When 为相同规范化 host-only/domain、path、name 的持久 Cookie 生成同步 identity
Then 各分区生成同一个 Profile 级 identity
And host-only 与 domain Cookie、不同 path 或不同 name 不互相覆盖
```

### Scenario: TC-004 权威 Cookie 应用不会回声，session Cookie 不漫游
**优先级**: P0  
**类型**: 功能 / 边界  
**测试层级**: integration

```gherkin
Given Host 返回一个已确认的持久 Cookie revision 和一个无到期时间的 Cookie
When 任意分区应用该批变化，随后再次收到相同 revision
Then 持久 Cookie 在各分区仅应用一次且不产生新的待上传变化或冲突
And session-only Cookie 保留在本设备并计入策略跳过
```

### Scenario: TC-005 并发 Cookie 修改按 Host 接受顺序收敛
**优先级**: P0  
**类型**: 并发 / 异常  
**测试层级**: integration

```gherkin
Given 两台设备从相同 base revision 修改相同 Cookie，另有一次已提交响应丢失
When Host 接收带 deviceId、operationId 与 baseRevision 的操作及其重试
Then 不同 identity 独立合并，同一 identity 由后接受的有效操作取得单调 revision
And 相同 operationId 重试返回原结果，不产生第二次写入
And 所有设备最终显示同一采用结果类别和冲突数量
```

### Scenario: TC-006 真删除 tombstone 阻止陈旧 Cookie 复活
**优先级**: P0  
**类型**: 数据完整性  
**测试层级**: integration

```gherkin
Given 一个 Cookie 已由显式删除或过期形成较高 revision tombstone
When 携带旧值的离线设备重新同步
Then Host 拒绝旧值，所有分区均不恢复该 Cookie
And 单设备容量 evicted 不创建全局 tombstone
And 完成 hydration 后网站写入更高 revision 的新 Cookie 可以生效
```

### Scenario: TC-007 旧协议安全保留 BL-007 能力
**优先级**: P0  
**类型**: 兼容性  
**测试层级**: integration

```gherkin
Given Host 仅保存严格 v1 Profile/密码数据或不声明 Cookie 漫游能力
When 客户端连接并执行配置、密码读写
Then BL-007 配置和密码能力继续可用
And 客户端明确显示 Host 需升级，不把空 Cookie 解释为全局删除或假称已支持漫游
And 旧客户端不能覆盖新 Host 的 Cookie 权威数据
```

### Scenario: TC-008 大量 Cookie 与中断迁移按确认游标续传
**优先级**: P0  
**类型**: 边界 / 异常  
**测试层级**: integration

```gherkin
Given Cookie 快照、变化或迁移数据超过单次安全载荷
When 首次 seed 或迁移在某已确认页之后超时并重试
Then 每个请求保持在协议载荷上限内，当前范围的兼容 Cookie 逐条 upsert
And 重试从已确认游标继续且不会重复已确认项
And 复制、验证、切换和清理的可观察提交结果保持一致
```

### Scenario: TC-009 离线期间的 Cookie 变化跨重启保留为待确认
**优先级**: P0  
**类型**: 异常 / 数据完整性  
**测试层级**: integration

```gherkin
Given 已打开页面的 Remote Host 离线
When 页面新增、更新或删除 Cookie 后应用重启，再恢复 Host
Then 已打开页面的既有 Cookie 可继续使用，变化显示为待同步而非已上传
And 待确认变化在重启后仍在，并以原 operationId 从权威游标提交
And 密码及 Profile 修改继续按既有 fail-closed 行为处理
```

### Scenario: TC-010 迟到 generation 不得改写当前同步状态
**优先级**: P0  
**类型**: 并发 / 异常  
**测试层级**: integration

```gherkin
Given Host connection generation 已变化且旧请求稍后返回
When 同步恢复并尝试新建、重载或恢复 URL 页面
Then 旧 generation 响应被忽略
And 新页面仍等待当前 generation hydration 后才请求网站
```

### Scenario: TC-011 普通 renderer 与日志不得获得 Cookie 秘密
**优先级**: P0  
**类型**: 安全  
**测试层级**: integration

```gherkin
Given 同步包含 Cookie name、domain、path、value 和原始 payload
When main 向 Settings/OkBrowser DTO 返回状态或记录错误
Then 普通 renderer DTO、日志和错误只含 Profile 摘要、数量与固定原因类别
And 不含 Cookie identity、value 或原始 payload
And LocalStorage、IndexedDB、Service Worker、Cache、Chromium Profile 目录与 Cookie DB 均不进入上传输入
```

### Scenario: TC-012 Host 权威与本机待确认数据受保护落盘
**优先级**: P0  
**类型**: 安全  
**测试层级**: integration

```gherkin
Given Host Cookie 权威记录和本机离线 journal 包含登录秘密
When 数据写入、重启后读取或原子写失败后重试
Then 文件内容不包含 Cookie 明文，文件及目录为私有权限
And 成功写入不会留下可读取的临时文件
And 不能解密或损坏时失败关闭且不返回部分秘密数据
```

### Scenario: TC-013 单项 Cookie 失败不阻断后续分页或重复计数
**优先级**: P0  
**类型**: 边界 / 异常  
**测试层级**: integration

```gherkin
Given 一页中含无效、无法重建、session-only、超限或 set/remove 失败的单项
When 同步该页并从游标重试
Then 每个失败项以固定原因类别跳过，其余项及后续页继续处理
And 已确认页不回滚
And 已同步、待同步、跳过和冲突数量不会因重试重复累计，且报告不含 Cookie 细节
```

### Scenario: TC-014 Browser Profiles 提供脱敏的连续性总览和恢复入口
**优先级**: P1  
**类型**: 功能  
**测试层级**: fe-e2e

```gherkin
Given Profile 分别处于首次同步、已同步、离线暂停、部分跳过和冲突已处理状态
When 用户打开 Settings → Browser Profiles
Then 每个既有 Profile 行以普通文本显示“Storage location”、登录连续性状态、脱敏数量与恢复入口
And 可加入 Profile 显示“在此设备使用”操作
And 页面不出现 Cookie 管理列表、说明气泡或面向用户的 AUTHORITY 标识
```

### Scenario: TC-015 OkBrowser 仅提供短反馈
**优先级**: P1  
**类型**: 功能  
**测试层级**: fe-e2e

```gherkin
Given 当前 Profile hydration 成功或因 Host 离线而暂停
When 用户查看 OkBrowser 状态区域
Then 分别显示“登录状态已恢复”或“同步已暂停”的短反馈
And 不显示 Cookie name、domain、path、value 或详细同步报告
```

### Scenario: TC-016 删除或迁移后的 epoch 拒绝陈旧设备复活
**优先级**: P0  
**类型**: 数据完整性 / 并发  
**测试层级**: integration

```gherkin
Given 多台设备已加入同一个 Remote Profile，旧设备保有陈旧 catalog 或 journal
When 任一设备删除该 Profile 或迁往另一 Host，旧设备随后对账
Then 旧 Host 的单调 delete/move epoch 使旧设备移除该 Profile 或显示“已移走”
And 旧设备不得继续写旧 Host，也不能借陈旧目录或 journal 重建数据
And 提交前失败保留原权威；提交后清理失败可重试但不恢复旧权威
```

### Scenario: TC-017 Remote → Local 迁移终止共享且保持可恢复清理
**优先级**: P0  
**类型**: 功能 / 异常  
**测试层级**: integration

```gherkin
Given 一个已被多设备加入的 Remote Profile
When 发起设备确认迁到 This device，或在提交后首次清理失败
Then 确认结果明确全局影响，发起设备保留本机副本
And 其他设备下次连接旧 Host 时移除 Profile 及相关分区
And 清理可重试，且不会恢复 Remote Host 为权威
```

## E2E 端到端验收

### API E2E 判断

| 项目 | 内容 |
|---|---|
| 是否需要 API E2E | ✅ 需要 |
| 原因 | Remote Profile RPC 是发现、加入、Cookie 变更、游标和迁移的实际跨进程协议，必须验证真实请求、权限与副作用。 |

### API E2E 前置条件

| 条件类型 | 具体内容 | 获取方式 |
|---|---|---|
| Remote Host | 支持 Cookie 漫游能力的测试 Host | 测试 harness 自动启动 |
| 两个客户端 | 独立 clientId、可控 connection generation 与隔离 userData | API E2E 脚本自动创建 |
| 测试网站 Cookie | 可通过 Electron 公开 Cookie API 写入的持久及 session Cookie | API E2E 脚本自动创建 |

#### API-E2E-001: 两设备发现、加入并延续持久登录状态
**执行方式**: API / Electron-host harness

```gherkin
Given 设备 A 已将 Remote Profile 与一个兼容持久 Cookie 同步到 Host
When 空 userData 的设备 B 发现该 Profile、确认加入并打开同一网站
Then B 在 hydration 后才发出首个网站请求，并得到该持久 Cookie
And session-only Cookie 不出现在 B 的分区或 Host 权威结果中
```

#### API-E2E-002: 离线删除在重启后收敛且不复活
**执行方式**: API / Electron-host harness

```gherkin
Given 两设备已从同一 revision 获得同一持久 Cookie
When A 离线删除 Cookie、重启并在 B 更新后重新连接
Then Host 按确定 revision 收敛，A 的待确认操作只确认一次
And 两设备最终均不含该 Cookie，陈旧值不能复活
```

### Browser E2E 判断

| 项目 | 内容 |
|---|---|
| 是否需要 Browser E2E | ✅ 需要 |
| 用户是否可选择跳过 | 是（PMO 在执行前询问） |

### Browser E2E 前置条件

| 条件类型 | 具体内容 | 获取方式 |
|---|---|---|
| 页面地址 | Settings → Browser Profiles 与 OkBrowser | 本地 Electron 测试构建 |
| Host 状态 | 可加入、已同步、离线暂停和部分跳过的可控 fixture | 测试 bridge/harness 自动注入 |

#### FE-E2E-001: 用户可见状态保持脱敏并可恢复
**执行方式**: browser

```gherkin
Given 已连接 Host 且存在可加入 Profile 与一个离线暂停的已加入 Profile
When 用户在 Browser Profiles 选择“在此设备使用”，再查看同步状态和 OkBrowser
Then Settings 行显示 Storage location、脱敏计数及恢复入口
And OkBrowser 仅显示登录恢复或暂停短反馈
And 页面上不出现 Cookie identity、Cookie value、AUTHORITY 或说明气泡
```

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-11 | 初稿：覆盖 AC-1 至 AC-10 的发现、协议、存储、并发、迁移、安全及 renderer 验收。 |
