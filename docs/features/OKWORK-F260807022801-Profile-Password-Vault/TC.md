---
feature_id: "OKWORK-F260807022801-Profile-Password-Vault"
status: pending_review
tests:
  - id: T-001
    file: src/main/__tests__/browserPasswordFlow.test.ts
    function: test_AC1_auto_saves_only_confirmed_login
    covers_ac: ["AC-1"]
    level: integration
    priority: P0
  - id: T-002
    file: src/main/__tests__/browserPasswordFlow.test.ts
    function: test_AC2_limits_candidates_to_profile_exact_origin_and_safe_origins
    covers_ac: ["AC-2"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "Profile 或 exact-origin 边界失效会把凭据提供给错误站点或错误身份，是直接的秘密泄露边界。"
  - id: T-003
    file: src/main/__tests__/browserPasswordFlow.test.ts
    function: test_AC3_fills_deterministically_without_replacing_non_empty_fields
    covers_ac: ["AC-3"]
    level: integration
    priority: P0
  - id: T-004
    file: src/main/__tests__/browserPasswordFlow.test.ts
    function: test_AC4_updates_only_successful_matching_account
    covers_ac: ["AC-4"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "失败或不确定登录若覆盖最后一个可用密码，会造成核心身份数据损坏并阻断登录连续性。"
  - id: T-005
    file: src/main/__tests__/passwordVault.test.ts
    function: test_AC5_persists_encrypted_credentials_and_fails_closed
    covers_ac: ["AC-5"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "明文持久化、密钥不可用时继续操作或解密失败伪成功都会突破密码库的核心安全承诺。"
  - id: T-006
    file: src/renderer/components/settings/__tests__/SavedPasswordsPage.test.tsx
    function: test_AC6_renders_masked_metadata_states_and_filters
    covers_ac: ["AC-6"]
    level: unit
    priority: P0
  - id: T-007
    file: src/main/__tests__/browserPasswordIpc.test.ts
    function: test_AC6_copy_requires_isolated_user_action_and_conditionally_clears_clipboard
    covers_ac: ["AC-6"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "错误清空用户后来写入的剪贴板会造成用户数据损失；绕过隔离可信面复制会泄露密码。"
  - id: T-008
    file: src/main/__tests__/browserProfileDeletion.test.ts
    function: test_AC7_profile_delete_stays_blocked_and_retryable_after_partial_failure_and_restart
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "部分删除后恢复可用会继续暴露本应删除的凭据；重启后丢失删除中状态会破坏删除承诺。"
  - id: T-009
    file: src/main/__tests__/browserPasswordFlow.test.ts
    function: test_AC7_deletes_only_selected_account_and_preserves_other_accounts
    covers_ac: ["AC-7"]
    level: integration
    priority: P0
  - id: T-010
    file: src/main/__tests__/browserPasswordSecurity.test.ts
    function: test_AC8_rejects_untrusted_vault_access_while_disclosing_dom_and_clipboard_exports
    covers_ac: ["AC-8"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "任意网页、普通或受篡改 renderer、Agent 获得通用列举或解密能力会直接泄露全部保存密码。"
  - id: T-011
    file: src/main/__tests__/browserPasswordLogRedaction.test.ts
    function: test_AC9_redacts_password_material_from_diagnostics_and_events
    covers_ac: ["AC-9"]
    level: integration
    priority: P0
    ci: true
    ci_reason: "诊断、错误或事件中的密码泄露可被长期保存或外传，属于不可接受的安全边界回归。"
  - id: T-012
    file: e2e/password-vault.e2e.cjs
    function: run_password_vault_browser_journeys
    covers_ac: ["AC-1", "AC-3", "AC-6", "AC-8"]
    level: fe-e2e
    priority: P0
---

# BL-006 Profile 密码库与静默保存/填充 - 测试用例

## 状态

待评审

---

## Feature: Profile 密码库与静默保存/填充

作为使用 OkWork 内置浏览器且管理多个身份的用户，
我希望凭据只在当前 Profile 与完全相同的安全站点中被保存、填充和管理，
以便获得登录连续性而不把密码交给错误的站点、身份或不可信代码。

---

## 需求覆盖矩阵

| AC ID（PRD） | 需求描述 | 优先级 | 覆盖测试（对应 frontmatter `tests[].id`） | 状态 |
|---|---|---|---|---|
| AC-1 | 可观察登录成功才自动保存；失败或无法确认不修改 | P0 | T-001, T-012 | ✅ |
| AC-2 | Profile、exact origin 与安全 origin 隔离 | P0 | T-002 | ✅ |
| AC-3 | 单账号静默填充、多账号确定选择且不覆盖已有值 | P0 | T-003, T-012 | ✅ |
| AC-4 | 成功才更新同一用户名的保存项 | P0 | T-004 | ✅ |
| AC-5 | 加密持久化、重启可用、不可用时 fail-closed | P0 | T-005 | ✅ |
| AC-6 | 脱敏管理列表、可信显隐/复制、条件剪贴板清理 | P0 | T-006, T-007, T-012 | ✅ |
| AC-7 | Profile 与单账号删除、部分失败和重试 | P0 | T-008, T-009 | ✅ |
| AC-8 | 不可信调用方不可读 Vault；暴露面有披露 | P0 | T-010, T-012 | ✅ |
| AC-9 | 日志、错误和事件不泄露秘密 | P0 | T-011 | ✅ |

覆盖率: 9 / 9 (100%)

---

## 测试场景

### Scenario: TC-001 可观察成功后自动保存，失败和不确定结果绝不修改

**关联测试**: T-001  
**优先级**: P0  
**类型**: 功能、异常  
**测试层级**: integration

```gherkin
Given 当前 Profile 正在允许的 exact origin 打开标准账号/密码登录表单
  And 密码库中该用户名已有一个已知旧密码，另一个用户名也已有保存项
When 用户提交新密码，且页面出现顶层跳转、登录表单消失或已登录状态之一，并且没有失败提示
Then 系统无需二次确认地保存或更新当前 Profile、当前 exact origin 和该用户名的凭据
  And 浏览器 chrome 显示不含密码的“已保存”或“已更新”状态
  And 重启应用后，该项仍可作为同一 Profile 和 origin 的候选项
When 页面明确显示登录失败，或提交后既无成功信号也无失败信号
Then 系统不新增也不覆盖任何保存项
  And chrome 分别显示失败或“无法确认，未保存”的不含秘密状态
  And 原有两个账号的保存项保持不变
```

**验证重点**:

- 成功判定以页面可观察结果为准，不能把“已提交”当作成功。
- “无法确认”必须与“失败”一样保全旧凭据，且不能伪报已保存。

### Scenario: TC-002 只在同一 Profile、exact origin 和允许 origin 内给出候选项

**关联测试**: T-002  
**优先级**: P0  
**类型**: 安全、边界  
**测试层级**: integration（L1 CI）

```gherkin
Given Profile A 在 https://app.example.test:443 保存了账号
  And Profile B 在相同 origin 及 Profile A 在不同子域、端口和协议页面均没有该账号
When 分别在 Profile B、https://api.example.test:443、https://app.example.test:8443、http://app.example.test:80 请求保存或填充
Then 该保存项不被填入，也不出现在账号选择中，且普通 HTTP 不会保存或填充
When 在 Profile A 访问 https://app.example.test:443
Then 该项可作为候选项
When 在 http://localhost 或 http://127.0.0.1 的完全匹配 loopback origin 重复该流程
Then loopback HTTP 按同样的 Profile + exact-origin 规则允许保存和填充
```

**验证重点**:

- `scheme`、`host`、`port` 任一变化均是不同 origin；不同 Profile 亦不可共享。
- 不以“同一注册域”或“页面相似”放宽边界。

### Scenario: TC-003 填充遵循确定规则且不抢占已有字段值

**关联测试**: T-003  
**优先级**: P0  
**类型**: 功能、边界  
**测试层级**: integration

```gherkin
Given 当前 Profile 和 exact origin 只有一个保存账号，且登录表单的可识别字段均为空
When 登录页可用
Then 系统静默填入该账号和密码，并在浏览器 chrome 显示不含密码的填充状态
Given 同一范围有多个账号
  And 页面账号字段预先给出了其中一个用户名
When 登录页可用
Then 系统选择该用户名对应的账号
Given 页面未给出用户名
When 登录页可用
Then 系统选择最近一次成功使用的账号，并提供 chrome 内账号切换入口
When 用户或站点已在任一账号/密码字段填入非空值
Then 系统不改写该字段，直到用户在 chrome 明确选择其他账号
```

**验证重点**:

- 多账号默认选择必须可重复、可解释；账号切换只能影响当前受限页面。
- 非空字段是用户或站点所有的输入，静默填充不得覆盖。

### Scenario: TC-004 同用户名仅在可确认成功后更新，账号之间互不覆盖

**关联测试**: T-004  
**优先级**: P0  
**类型**: 功能、异常  
**测试层级**: integration（L1 CI）

```gherkin
Given 当前 Profile、exact origin 和用户名 alice 已保存旧密码
  And 同一范围用户名 bob 已保存独立密码
When alice 用不同密码完成一次可观察的成功登录
Then alice 的保存密码变为新密码且最近成功使用时间刷新
  And bob 的保存项保持不变
When alice 的后续登录明确失败或无法确认
Then alice 最近一次已确认成功保存的密码与使用时间均不被修改
  And 不新增重复的 alice 保存项
```

**验证重点**:

- 更新键是 Profile、exact origin、用户名的组合；不同用户名始终独立。
- 测试需断言失败/不确定分支完成后状态稳定，而不是只断言没有“成功”提示。

### Scenario: TC-005 加密持久化与不可用/损坏时的 fail-closed 行为

**关联测试**: T-005  
**优先级**: P0  
**类型**: 安全、异常  
**测试层级**: integration（L1 CI）

```gherkin
Given 系统加密能力可用且用户保存了一条已知测试密码
When 重启应用后在匹配的登录页填充、在可信面显示或复制该项
Then 操作可用
  And 应用数据中的持久化内容不包含该测试密码的明文
Given 系统加密能力不可用，或某条保存项无法解密
When 任意页面请求保存、填充、显示或复制密码
Then 所有上述动作均被拒绝
  And UI 显示可操作且不含秘密的说明
  And 系统既不写入明文，也不以空密码或成功状态伪装结果
```

**验证重点**:

- 解密失败与“没有保存项”不能混为一谈。
- 测试密码使用唯一哨兵值，并检查该值不出现在任何持久化文本或可见错误中。

### Scenario: TC-006 Saved passwords 仅展示脱敏元数据，并提供可判定的页面状态和筛选

**关联测试**: T-006  
**优先级**: P0  
**类型**: 功能、异常  
**测试层级**: unit

```gherkin
Given 用户打开 Browser Settings → Saved passwords
When 密码库依次为空、加载中、加载失败和包含多条不同 Profile/origin/用户名的保存项
Then 页面分别显示可辨认的 empty、loading、error 和 normal 状态
  And normal 列表默认遮罩密码，只展示可搜索的脱敏元数据
When 用户按 Profile、origin 或用户名搜索
Then 列表仅保留匹配项，未匹配时显示空结果而非历史条目
When 普通 Settings 页面请求单条明文
Then 页面不能自行得到或显示明文，只能进入独立的可信呈现面
```

**验证重点**:

- 列表加载失败不可退化为“空列表”。
- 测试通过页面可观察内容确认没有密码哨兵值，而不依赖某种内部存储形态。

### Scenario: TC-007 显示/复制必须由可信面真实用户动作触发，60 秒仅条件清理剪贴板

**关联测试**: T-007  
**优先级**: P0  
**类型**: 安全、边界、异常  
**测试层级**: integration（L1 CI）

```gherkin
Given 普通 renderer 已显示脱敏密码列表
  And 用户尚未在独立可信面作出动作
When 普通 renderer、网页脚本或合成的非用户请求尝试显示、解密或复制某一项
Then 请求被拒绝，普通页面仍看不到明文
When 用户在独立可信面明确选择显示或复制
Then 可信面在短时显示后自动重新遮罩
  And 复制前提示系统剪贴板可被本机应用读取
  And 复制后显示 60 秒自动清除倒计时
When 60 秒到期且剪贴板仍是本次复制的值
Then 系统清除该剪贴板值
When 用户在 60 秒内把剪贴板改为其他内容
Then 到期时系统保留用户后来写入的内容
```

**验证重点**:

- 必须分别证明“未改写则清理”和“被改写则不清理”；后者防止破坏用户数据。
- 所有失败提示、可信面快照和倒计时 UI 均不得包含密码明文。

### Scenario: TC-008 删除 Profile 部分失败后保持不可用，并跨重启可重试

**关联测试**: T-008  
**优先级**: P0  
**类型**: 异常、安全  
**测试层级**: integration（L1 CI）

```gherkin
Given 自定义 Profile A 含保存密码及既有浏览数据
  And Profile B 含独立保存密码
When 用户确认删除 Profile A
Then Profile A 立即显示为删除中且不可用于保存、填充、显示或复制
When Profile A 的密码、Cookie、站点存储和缓存清理全部成功
Then 系统才报告删除成功并移除 Profile A
  And Profile B 的数据与能力不受影响
Given Profile A 的任一清理步骤失败
When 删除过程结束并重启应用
Then 系统不报告删除成功
  And Profile A 仍保持不可使用、显示不含秘密的失败原因和重试入口
When 用户重试且全部清理成功
Then Profile A 才被最终移除
```

**验证重点**:

- 故障注入覆盖至少一个清理步骤失败，且要验证重启后的状态，而非仅验证本次 Promise 拒绝。
- 删除成功是所有承诺数据都清理完成的结果；不允许后台“尽力清理”后先报成功。

### Scenario: TC-009 删除一个保存账号不影响其他账号，失败可重试

**关联测试**: T-009  
**优先级**: P0  
**类型**: 功能、异常  
**测试层级**: integration

```gherkin
Given 同一 Profile 和 exact origin 保存了 alice 与 bob 两个账号
When 用户删除 alice
Then alice 从列表移除，重访登录页时不再自动填充或提供 alice
  And bob 仍可正常填充和管理
Given alice 的删除动作失败
Then alice 不被误报为已删除
  And UI 显示不含秘密的可重试提示，bob 不受影响
```

**验证重点**:

- 删除目标由可见的脱敏账号标识确定，不删除相同站点的其他账号。

### Scenario: TC-010 不可信调用方没有通用 Vault 通道，已导出的暴露面必须被诚实披露

**关联测试**: T-010  
**优先级**: P0  
**类型**: 安全  
**测试层级**: integration（L1 CI）

```gherkin
Given 网站脚本、普通 renderer、被篡改 renderer 和连接 OkBrowser 的 Agent 都可尝试调用公开能力
When 它们尝试列出保存项、读取 Vault 明文、请求任意一项解密，或为网页附带自定义 preload
Then 请求不存在或被拒绝，且网页自带 preload 仍被拒绝
When 固定可信网页桥为当前受限页面请求保存或填充
Then 只允许该页面所需的受限动作，不提供通用列举或单条解密能力
When 用户已选择将密码填入网页 DOM，或在可信面显式复制到系统剪贴板
Then 页面/Agent 或本机应用可能观察到相应导出值
  And Profile 设置、Saved passwords 页面和浏览器 chrome 均持续披露这两种暴露面
```

**验证重点**:

- “可观察已导出值”不等同于“可读取 Vault”；测试必须同时断言这两个边界。
- 可信面权限不可被普通 renderer 代理、放大或复用。

### Scenario: TC-011 诊断、状态和产品事件均不含秘密且不新增远程凭据埋点

**关联测试**: T-011  
**优先级**: P0  
**类型**: 安全、异常  
**测试层级**: integration（L1 CI）

```gherkin
Given 用唯一密码哨兵值依次触发保存、填充、解密失败、删除和账号切换
When 系统产生本地诊断、可见状态、错误或产品事件
Then 每一条记录和展示均不包含密码、密码字段值、加密载荷或剪贴板内容
  And 仅保留排障所需的不含秘密上下文
  And 不产生新的远程凭据埋点或上传请求
```

**验证重点**:

- 搜索哨兵值应覆盖成功与失败路径，特别是格式化错误和异常对象路径。
- 不把“记录了掩码”误判为泄露；判定对象是可还原的秘密材料。

---

## E2E 端到端验收

### API E2E 判断

| 项目 | 内容 |
|---|---|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | 本 Feature 没有对外 HTTP API；能力仅通过 Electron 本地 main/preload/renderer IPC 链路提供，不能用 curl/httpie 验证。该真实本地链路由 T-007、T-010 的 integration 测试覆盖，并以 Browser E2E 验收用户路径。 |

### Browser E2E 判断

| 项目 | 内容 |
|---|---|
| 是否需要 Browser E2E | ✅ 需要 |
| 原因 | 自动保存/填充、Profile 切换、隔离可信面与常驻暴露披露都是跨 Electron 窗口、webview 和真实用户手势的高风险交互，组件测试无法单独证明接线有效。 |
| 用户是否可选择跳过 | 是（PMO 在执行前询问；跳过时应明确记录未验证的真实交互边界）。 |

### Browser E2E 前置条件

| 条件类型 | 具体内容 | 获取方式 |
|---|---|---|
| 应用 | 可启动的本地 OkWork Electron 测试构建 | 测试脚本启动，并使用临时 `userData` 目录 |
| 测试站点 | 可控的登录页，提供成功、明确失败及无法确认三种结果 | E2E harness 本地启动；使用 `http://localhost:<port>` 以符合 D-1 的 loopback 例外 |
| 测试 Profile | 两个自定义 Profile 与默认 Profile | Browser E2E 前通过 UI 创建；不依赖已有用户数据 |
| 加密能力 | 可用的测试钥匙串或等价受控测试环境 | 测试运行环境提供；不可用分支仍由 T-005 的可注入集成测试覆盖 |
| 剪贴板 | 可读写且可在测试结束后恢复的临时系统剪贴板状态 | harness 在每个场景前后设置、断言并清理 |

### Browser E2E Scenarios

#### FE-E2E-001: 真实登录成功保存、重开后静默填充与多账号切换

**执行方式**: browser（真实 Electron 窗口与内置浏览器操作）  
**关联测试**: T-012

```gherkin
Given 用户在 Profile A 的 loopback 登录页成功登录 alice
When 用户关闭并重新打开该页面
Then 空账号/密码字段被静默填充，chrome 显示不含密码的填充状态
When 用户再成功登录 bob 并重开页面
Then chrome 默认选择最近成功使用的 bob，且用户可在 chrome 切换到 alice
```

**验证点**:

| 验证类型 | 验证内容 | 预期值 |
|---|---|---|
| 页面 | 登录成功、重开后的字段值 | 仅匹配的 Profile + exact origin 得到候选或填充 |
| chrome | 保存、填充和账号切换状态 | 无密码明文，切换由用户明确操作触发 |
| 隔离 | 将同页改用 Profile B 后重开 | 不出现 Profile A 的账号 |

#### FE-E2E-002: Saved passwords 搜索、可信显示/复制与剪贴板条件清理

**执行方式**: browser（真实 Settings 页面、隔离可信窗口及系统剪贴板）  
**关联测试**: T-012

```gherkin
Given Profile A 已有两个保存账号且用户打开 Saved passwords
When 用户按 Profile、origin 和用户名筛选
Then 只显示匹配的脱敏条目
When 用户从普通列表进入可信面并明确点击显示和复制
Then 页面先提示剪贴板暴露面，可信面短时显示后重新遮罩，并显示 60 秒倒计时
When 用户先改写系统剪贴板并等待倒计时结束
Then 用户改写的内容仍保留
```

**验证点**:

| 验证类型 | 验证内容 | 预期值 |
|---|---|---|
| 页面 | empty/loading/error/normal 与搜索结果 | 状态可区分，列表不显示密码 |
| 隔离可信面 | 显示和复制入口 | 真实用户点击才可用，普通列表没有明文 |
| 剪贴板 | 60 秒到期后的内容 | 仅在内容未被改写时被清除 |

#### FE-E2E-003: Profile 删除失败重试与暴露面披露

**执行方式**: browser（真实 Settings/Profile 交互；清理失败由受控 harness 注入）  
**关联测试**: T-012

```gherkin
Given Profile A 有保存账号，且 harness 使一次删除清理失败
When 用户在 Browser profiles 中确认删除 Profile A
Then Profile A 进入不可使用的失败状态，展示可重试入口但不报告成功
When 用户重试且清理成功
Then Profile A 被移除，Profile B 保持可用
When 用户查看 Profile 设置、Saved passwords 和浏览器 chrome
Then 三处均可见页面/Agent 读取已填入值及剪贴板导出风险的披露
```

**验证点**:

| 验证类型 | 验证内容 | 预期值 |
|---|---|---|
| 交互状态 | 删除中、失败、重试成功 | 删除中/失败期间 Profile A 不能再参与密码操作 |
| 隔离 | 另一 Profile 的账号与填充 | 不受删除失败或重试影响 |
| 披露 | 三个用户可见入口 | 均说明 DOM/Agent 与剪贴板导出的实际边界，且不展示密码 |

---

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-09 | 首版：覆盖 AC-1 至 AC-9，定义 L1/L2 分层、Electron IPC 的 API E2E 不适用原因及三条真实 Browser E2E 交互路径。 |
