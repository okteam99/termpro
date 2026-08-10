---
feature_id: "OKWORK-F260810051623-Remote-Profile-Authority"
status: confirmed
tests:
  - id: TC-001
    file: src/main/__tests__/remoteProfileAuthority.test.ts
    function: test_AC1_persists_one_authority_for_default_and_custom_profiles
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: TC-002
    file: src/renderer/components/settings/__tests__/BrowserProfilesSection.test.tsx
    function: test_AC1_AC2_shows_storage_location_and_requires_eligible_target_confirmation
    covers_ac: ["AC-1", "AC-2"]
    level: fe-e2e
    priority: P0
  - id: TC-003
    file: src/main/__tests__/remoteProfileAuthoritySecurity.test.ts
    function: test_AC3_rejects_renderer_and_invalid_main_only_capabilities_without_enumeration
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "普通 Host token 或错配专用凭据能够读取、写入或枚举远端 Profile/Vault，会突破密码明文的 main-only 安全边界。"
  - id: TC-004
    file: src/main/__tests__/remoteProfileAuthority.test.ts
    function: test_AC4_migration_locks_mutations_and_reads_only_from_source_until_verified_switch
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "迁移期双写、零权威或写入离线队列会造成 Profile 配置与 Vault 数据损坏。"
  - id: TC-005
    file: src/main/__tests__/remoteProfileMigration.test.ts
    function: test_AC4_recovers_after_restart_and_ignores_late_precommit_responses
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
  - id: TC-006
    file: src/main/__tests__/remoteProfileMigration.test.ts
    function: test_AC5_keeps_exactly_one_authority_on_pre_and_post_commit_failures
    covers_ac: ["AC-5"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "提交边界被破坏会让不完整副本被读取、旧源回切，或使唯一权威丢失。"
  - id: TC-007
    file: src/main/__tests__/remoteProfileMigration.test.ts
    function: test_AC5_keeps_cleanup_pending_source_blocked_until_idempotent_retry_succeeds
    covers_ac: ["AC-5", "AC-8"]
    level: integration
    priority: P0
  - id: TC-008
    file: src/main/__tests__/remoteProfileAuthority.test.ts
    function: test_AC6_fails_closed_for_all_password_and_profile_mutations_until_current_generation_revalidates
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "远端断线后读取陈旧条目、落入本机影子 Vault 或排队写入会泄露或损坏密码权威数据。"
  - id: TC-009
    file: src/main/__tests__/browserProfileDeletion.test.ts
    function: test_AC7_remote_authority_profile_deletion_revokes_access_and_resumes_after_restart
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: TC-010
    file: src/main/remote/__tests__/remoteProfileDependencies.test.ts
    function: test_AC8_blocks_host_delete_for_authority_migration_and_cleanup_dependencies
    covers_ac: ["AC-8"]
    level: integration
    priority: P0
  - id: TC-011
    file: src/main/__tests__/remoteProfileAuthoritySecurity.test.ts
    function: test_AC9_redacts_secrets_and_reports_only_stable_non_sensitive_failures
    covers_ac: ["AC-9"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "日志、错误或远端磁盘泄露密码、解密材料或专用 capability 是直接的凭据泄露事故。"
  - id: TC-012
    file: src/renderer/components/settings/__tests__/SavedPasswordsPage.test.tsx
    function: test_AC6_AC9_remote_authority_offline_shows_no_stale_metadata_and_safe_alert
    covers_ac: ["AC-6", "AC-9"]
    level: fe-e2e
    priority: P0
  - id: TC-013
    file: src/renderer/components/settings/__tests__/RemoteHostsPage.test.tsx
    function: test_AC8_dependency_blocked_delete_lists_profiles_and_recovery_action
    covers_ac: ["AC-8"]
    level: fe-e2e
    priority: P0
---

# Remote Host Profile 权威存储与迁移 - 测试用例

## 状态

已确认

## 需求覆盖矩阵

| AC ID | 需求描述 | 优先级 | 覆盖测试 | 状态 |
|---|---|---|---|---|
| AC-1 | Profile 的唯一、持久化 authority 与 Default 规则 | P0 | TC-001, TC-002 | ✅ |
| AC-2 | 可用目标、信任披露与二次确认 | P0 | TC-002 | ✅ |
| AC-3 | 远端 Vault 的 main-only 授权与拒绝 | P0 | TC-003 | ✅ |
| AC-4 | copy → verify → switch 的可恢复迁移 | P0 | TC-004, TC-005 | ✅ |
| AC-5 | 提交边界、cleanup pending 与重试 | P0 | TC-006, TC-007 | ✅ |
| AC-6 | Remote authority 断线 fail-closed | P0 | TC-008, TC-012 | ✅ |
| AC-7 | Profile 删除撤权、持久失败和重试 | P0 | TC-009 | ✅ |
| AC-8 | Host 删除依赖拦截 | P0 | TC-007, TC-010, TC-013 | ✅ |
| AC-9 | 磁盘/日志/错误/截图零秘密 | P0 | TC-011, TC-012 | ✅ |

覆盖率: 9 / 9 (100%)

## 测试场景

### Scenario: TC-001 持久 authority 对每个 Profile 唯一且不受网络出口影响
**优先级**: P0  
**类型**: 功能、边界  
**测试层级**: integration

```gherkin
Given Default Profile 和一个自定义 Profile 都可用，且各自有独立网络出口设置
When 用户把两者分别选择为 This device 或一个 ready 的 Remote Host，并重启应用或改变网络出口
Then main 与 UI 读取到每个 Profile 相同且唯一的持久化 authority
And Default Profile 可以迁移 authority，但仍没有改名或删除操作
And 网络出口改变不会改变 authority
```

### Scenario: TC-002 只允许已连接且兼容的存储目标在确认后开始迁移
**优先级**: P0  
**类型**: 功能、异常  
**测试层级**: fe-e2e

```gherkin
Given 用户在 Settings → Browser Settings → Browser Profiles 打开一个 Profile 的存储位置操作，页面没有说明气泡或 AUTHORITY 标识
When 目标列表包含 ready 兼容、断线、不兼容和正在迁移的 Remote Host
Then 仅 ready 且兼容的 Host 可以提交
And 界面显示目标别名、Host 可解密的信任披露、Copying → Verifying → Switching 与失败保留原位置的说明
When 用户未作二次确认，或选择不可用目标
Then 迁移不开始，并给出可行动原因
```

### Scenario: TC-003 普通 Host 授权与所有错配专用凭据均不能探测远端 Vault
**优先级**: P0  
**类型**: 安全、异常  
**测试层级**: integration

```gherkin
Given 某 Profile 的 authority 是 Remote Host，且该 Host 有一个已保存的 exact-origin 密码
When 普通或恶意 renderer、Agent 持现有通用 Host token，或调用方持过期、错 Host、错 Profile 的专用凭据
Then 对 Profile 配置和 Vault 的读取、保存、迁移、解密与 capability 枚举全部被拒绝
And 响应不包含条目、密码、能力是否存在或可据以推断它们的信息
And 密码明文只在 main、既有可信 guest/trusted surface 与 Host 专用 main-only 通路中可达
```

### Scenario: TC-004 迁移在切换前始终只读源并锁住所有变更
**优先级**: P0  
**类型**: 功能、边界  
**测试层级**: integration

```gherkin
Given 源 authority 与目标 authority 可用，源含 Profile 配置和多个 exact-origin Vault 条目
When 用户确认本机到 Remote Host 或 Remote Host A 到 B 的迁移，并进入 Copying 与 Verifying
Then 新增、更新、删除配置或 Vault 的请求被拒绝且不会离线排队
And metadata/list、显示、复制与填充仍仅从源返回
When 目标副本完成且完整性校验通过
Then authority 原子切换到目标，之后读取仅从目标返回，并延迟清理源
```

### Scenario: TC-005 重启或迟到响应不会造成双写或零权威
**优先级**: P0  
**类型**: 异常、恢复  
**测试层级**: integration

```gherkin
Given 迁移记录已持久化且处于 Copying、Verifying 或提交前 Switching
When 进程重启、连接代切换，或旧连接的复制/校验响应迟到
Then 恢复后源仍是唯一 authority，不读取未完成目标
And 迟到响应不能提交 authority、写入第二处权威或恢复 mutation
```

### Scenario: TC-006 提交前后失败遵守唯一 authority 分界
**优先级**: P0  
**类型**: 异常、恢复  
**测试层级**: integration

```gherkin
Given 一次迁移在复制、校验或提交边界发生错误、崩溃或连接切代
When 持久恢复记录表明 authority 尚未原子提交
Then 源保持唯一 authority，源数据不减少，未完成目标永不被读取
And UI 用 role=alert 显示失败阶段、原 authority 仍有效与 Retry
When 记录表明已提交且目标先前已通过完整性校验
Then 目标保持唯一 authority；即使目标立刻离线，也不会读取或自动回切旧源
```

### Scenario: TC-007 cleanup pending 可重试且持续阻止删除旧 Host
**优先级**: P0  
**类型**: 异常、恢复  
**测试层级**: integration

```gherkin
Given authority 已提交到目标且源清理失败
When 用户重启应用、查看旧 Host 或重复执行清理
Then UI 显示 cleanup pending 警告和可幂等 Retry，目标仍是唯一 authority
And 删除旧源 Host 被阻止，直到清理成功
And 清理重试不会恢复旧源读取或改变已提交的 authority
```

### Scenario: TC-008 远端 authority 不可用时密码和 Profile 操作全部 fail-closed
**优先级**: P0  
**类型**: 安全、异常  
**测试层级**: integration

```gherkin
Given Remote Host 是当前 authority
When Host 断线、超时、重启、睡眠恢复切代，或远端加密材料/文档为不可用、损坏或版本不兼容
Then metadata/list、显示、复制、删除、保存、更新和填充均以稳定的非敏感分类拒绝
And 系统不显示陈旧条目、不读写本机影子 Vault，也不排队写入
And Profile 修改与 authority 迁移暂停
When Host 以当前连接代重新连接并校验成功
Then 才恢复这些能力
```

### Scenario: TC-009 删除远端 authority Profile 先撤权，失败跨重启可见且可重试
**优先级**: P0  
**类型**: 异常、恢复  
**测试层级**: integration

```gherkin
Given 用户删除一个 authority 为 Remote Host 的 Profile
When 远端配置、Vault 或本机 Chromium 分区任一清理失败
Then 保存、填充、显示与复制立即撤权，Profile 维持 deleting 或 delete_failed 并跨重启可见
And 用户可重试；只有所有清理成功后才移除 Profile 元数据
When Profile 正在迁移
Then 删除请求被拒绝且不启动并行清理
```

### Scenario: TC-010 所有 Host 依赖均阻止删除，无依赖保持既有删除行为
**优先级**: P0  
**类型**: 功能、边界  
**测试层级**: integration

```gherkin
Given Remote Host 被当前 authority、在途迁移源或目标、删除待清理位置或 cleanup pending 源引用
When 用户在 Settings → Remote Hosts 尝试 Delete
Then 删除被阻止，列出依赖 Profile、依赖类型以及先完成迁移/清理或删除 Profile 的入口
And 不调用 Host 删除动作，也不会自动迁回 This device
When Host 没有这些依赖
Then 保持既有断连并删除 Host 配置和 SSH 凭据的行为
```

### Scenario: TC-011 远端成功与失败路径均不泄露秘密
**优先级**: P0  
**类型**: 安全、异常  
**测试层级**: integration

```gherkin
Given 远端 Vault 操作分别成功、offline、timeout、migration、encryption unavailable、corrupt、wrong profile 与 incompatible version
When 检查远端 Vault 文件及权限、Host/main/renderer 日志、错误详情、调试输出和为验收生成的截图
Then 不出现密码明文、解密材料或专用 capability，Vault 路径与文件仅授予最小权限
And 错误只使用稳定、非敏感的分类，所有坏输入都 fail-closed
```

### Scenario: TC-012 真实密码管理界面在断线时隐藏陈旧 metadata 并明确 Cookie 例外
**优先级**: P0  
**类型**: 安全、异常  
**测试层级**: fe-e2e

```gherkin
Given Remote Host 是 Profile authority，且用户已打开 Settings → Browser Settings → Saved Passwords 或 OkBrowser
When authority 变为 offline 或不兼容
Then Saved Passwords 不渲染陈旧条目，trusted password surface 拒绝显示/复制，并呈现脱敏 alert 与 Retry/Host 引导
And OkBrowser 明确说明页面 Chromium Cookie 会话可能继续，但密码能力已暂停
```

### Scenario: TC-013 真实 Remote Hosts 界面展示依赖而不执行删除
**优先级**: P0  
**类型**: 功能、异常  
**测试层级**: fe-e2e

```gherkin
Given 一个 Remote Host 仍被 Profile authority 或 cleanup pending 引用
When 用户在 Settings → Remote Hosts 打开 Delete
Then 页面显示依赖 Profile 和依赖类型、迁移/清理入口
And 删除确认动作不可到达现有 Host 删除调用
```

## E2E 端到端验收

### API E2E 判断

| 项目 | 内容 |
|---|---|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | 本 Feature 没有对外 HTTP API；业务链路是 Electron main 与受认证 Remote Host 的内部协议。协议的真实跨边界行为由 Vitest integration（TC-003 至 TC-011）覆盖，不能用虚构的 HTTP/curl 用例替代。 |

### Browser E2E 判断

| 项目 | 内容 |
|---|---|
| 是否需要 Browser E2E | ✅ 需要 |
| 用户是否可选择跳过 | 是（PMO 在执行前询问） |

### Browser E2E 前置条件

| 条件类型 | 具体内容 | 获取方式 |
|---|---|---|
| 应用 | 本地 Electron 开发构建，包含真实 Settings 与 OkBrowser | `npm start` |
| Remote Host | 一台 ready 且支持 Profile 存储的测试 Host，及一台断线/不兼容 Host | 测试环境配置或受控 mock Host |
| Browser Profile | Default Profile 与一个含测试 credential 的自定义 Profile | 测试数据自动创建 |
| 截图位置 | Feature 交付证据目录 | `<feature>/screenshots/`，截图仅用哨兵测试值 |

### Browser E2E Scenarios

#### FE-E2E-001: 从真实 Browser Profiles 路径完成迁移确认并观察安全状态
**执行方式**: browser（AI 浏览器操作）

```gherkin
Given 已启动真实 Electron 应用，Default Profile 和自定义 Profile 均可见
When 用户进入 Settings → Browser Settings → Browser Profiles，选择 ready Host 并完成二次确认
Then 页面依次显示 Copying、Verifying、Switching 与目标存储位置
And 断线与不兼容 Host 保持不可提交并说明原因
When 在迁移中尝试保存或删除密码
Then 操作被拒绝，读取仍来自源
```

#### FE-E2E-002: Remote authority 断线和 Host 依赖删除的真实 UI 路径
**执行方式**: browser（AI 浏览器操作）

```gherkin
Given 当前 Profile authority 是 Remote Host
When Host 断线后用户分别打开 Settings → Browser Settings → Saved Passwords、OkBrowser 密码状态条和 Settings → Remote Hosts → Delete
Then 密码页面不显示陈旧 metadata，页面说明 Cookie 会话与密码暂停的差异
And Host 删除显示依赖与恢复入口，不执行删除或自动迁回本机
```

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-10 | 初稿：覆盖 authority、main-only 授权、迁移恢复、fail-closed、删除依赖与零秘密验收。 |
