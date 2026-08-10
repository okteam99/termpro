---
feature_id: OKWORK-F260810151932-Browser-Profile-Login-Continuity
reviewers: [fast]
verdicts:
  fast: APPROVE
review_round: 2
overall_verdict: APPROVE
next_round_required: false
round_2_verified_at: "2026-08-10T15:39:40Z"
user_confirmed_at: "2026-08-10T16:06:22Z"
confirmed_decisions: [D-1-A, D-2-B, D-3-A]
code_context_read: true
reviews:
  - role: fast
    review_scope: prd
    coverage: [可实现, 可验证, 数据一致性, 安全与兼容]
    execution: subagent
    verdict: APPROVE
    reviewed_at: 2026-08-10T15:39:40Z
    files_read:
      - docs/features/OKWORK-F260810151932-Browser-Profile-Login-Continuity/PRD.md
      - product-overview/workstream/WS-02-browser-profile-login-continuity.md
      - docs/ROADMAP.md
      - docs/adr/ADR-0003-remote-profile-authority-and-migration.md
      - project-specs/KNOWLEDGE.md
      - project-specs/GLOSSARY.md
      - src/shared/remoteProfileStore.ts
      - src/shared/browserProfile.ts
      - src/main/profileCatalogStore.ts
      - src/main/profileAuthorityService.ts
      - src/main/profileMigrationCoordinator.ts
      - src/main/remoteProfileProvider.ts
      - src/main/remote/orchestrator.ts
      - src/main/remote/ssh.ts
      - src/host/remoteProfileStore.ts
      - src/host/profileStoreRpc.ts
      - src/main/browserProfileDeletion.ts
      - src/main/browserPartitionPolicy.ts
      - src/main/browserNetwork.ts
      - src/main/main.ts
      - src/renderer/components/BrowserPanel.tsx
      - src/renderer/components/settings/BrowserProfilesSection.tsx
    findings:
      - id: FAST-001
        severity: high
        description: "D-1 跨出口共享与 D-2 session-only 持久化仍是待决策，却分别决定 AC-2/3/4/8 的同步集合、冲突面和安全语义；当前无法形成唯一可验收产品合同。"
        suggestion: "PRD 进入 Blueprint 前必须拍板并回填两项决策，然后将选中语义直接改写进 AC；若沿用建议，明确为 Profile 级跨出口共享，session-only 仅本设备保留并计入策略跳过。"
        category: product-direction
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是：D-1/D-2 作为显式待决策项已经足够，Goal 终确认前保留候选分支反而能避免 PM 越权替用户选择。回读 PRD v0.1 的 AC-2/3/4/8 后确认，这两个分支会改变同步集合、凭据寿命、冲突键空间与跳过统计，若 AC 仍同时容纳 A/B，Blueprint 确实无法形成唯一候选合同；因此反方只适用于“最终状态仍待用户确认”，不适用于“送验证的 AC 仍分叉”。
          rationale: "采纳。PRD v0.2 在 §待决策项保留 D-1/D-2 给用户终确认，同时将推荐候选 A/B 直接写进 AC-2、AC-4、AC-8 与 §开工前必须想清的：Profile 级跨出口对账；session-only 仅留本机并计入策略跳过。这样验证的是一套明确候选语义，用户仍保有最终拍板权。"
          responded_at: "2026-08-10T15:38:10Z"
        verification_status: fixed
        verification_evidence: "PRD v0.2 §待决策项的 D-1 推荐 A、D-2 推荐 B 已逐字落实到 AC-2：Profile 级跨出口对账且 session-only 留在当前设备并计入策略跳过；AC-4/AC-8 与 §开工前必须想清的保持同一候选合同。两项仍待 Goal 用户终确认，但候选 AC 不再分叉。"
      - id: FAST-002
        severity: high
        description: "AC-1/10 引入 Host 发现/加入和‘任一设备迁移或删除都全局生效’，但未定义 Host 端全局目录、删除 tombstone/迁移重定向、设备成员与加入状态。尤其 Remote→This device 后，其他设备无法访问新本机权威；旧 Host 若按现有 cleanup 删掉源数据，也无持久事实阻止旧设备重建。因此 AC-10 当前既不可实现也不可验收。"
        suggestion: "拆开‘共享 Profile 删除’与‘Remote→Local 迁移’两个产品语义并拍板。最小方案是：Host 只发现 active 项，但持久不可被旧客户端穿透的 delete/move epoch；Remote→Local 明确为终止共享并定义其他设备所见结果，不要隐式引入设备间新协调器。在 AC 中补充发现去重、同名/同 ID、旧客户端重连和清理失败的结果。"
        category: technical-consistency
        code_evidence:
          - "src/main/profileCatalogStore.ts:304-326,560-584：当前 catalog/clientId 是每设备本地文件，仅从本机 Profile bootstrap，无 Host 全局目录。"
          - "src/main/profileMigrationCoordinator.ts:299-307：迁移提交后会删除 source Profile，目前不留 redirect/tombstone。"
          - "src/main/browserProfileDeletion.ts:193-231 与 src/main/main.ts:426-437：当前删除只清发起设备所知的本地 Chromium 分区。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是：Host 发现目录、成员关系和重定向属于 Blueprint 技术设计，不应把实现结构焊死在 PRD；现有迁移协调器也可能仅靠客户端 catalog 扩展完成。回读 profileCatalogStore、profileMigrationCoordinator 与 browserProfileDeletion 的现状后确认，若 PRD 不先定义其他设备在 delete/move/Remote→Local 后看到什么，客户端扩展会在“保留副本、失去 Profile、继续共享”三种互斥产品结果间无从选择；但 reviewer 提出的通用成员协调器确实不是最小必要范围。
          rationale: "采纳产品语义、收窄实现承诺。PRD v0.2 新增 D-3，并在 AC-1/AC-10 明确 Host 仅发现 active 摘要、显式加入、同名不同 ID/同 ID 冲突结果，以及旧 Host 先持久化不可被旧目录或 journal 穿透的 delete/move epoch。Remote→Local 的候选语义为终止共享，仅发起设备留本机副本；§Out of Scope 明确不建设通用跨设备协调服务。"
          responded_at: "2026-08-10T15:38:10Z"
        verification_status: fixed
        verification_evidence: "PRD v0.2 的 D-3 推荐 A 与 AC-10 明确 Remote→Local 为终止共享、仅发起设备保留、其他设备移除；AC-1 定义 active 摘要、显式加入及同名不同 ID/同 ID/删除或移走等固定加入结果；AC-10 要求物理清理前持久化 delete/move epoch，并阻止陈旧目录或 journal 穿透。"
      - id: FAST-003
        severity: high
        description: "AC-3/4/6 没有闭合离线变更模型。仅在重连时扫当前 Cookie 无法区分‘离线期间删除’与‘本来就不存在’；如果不持久化 journal，应用重启后删除意图必丢。同时‘所有受支持客户端都不再可能提交更旧版本’没有成员、lease/ack 或 full-resync floor，tombstone GC 条件不可达也不可测。"
        suggestion: "在 PRD 锁定设备端持久离线 journal（它是待确认操作日志，不是第二权威）、重启/断线语义、基础 revision 和幂等 operation ID；定义 Cookie identity key 与并发裁决规则。tombstone 选一个可证明策略：设备 ack/lease + compaction floor，或保留 tombstone 并在超界时强制全量重建；给出可控时钟的验收例。"
        category: data-consistency
        code_evidence:
          - "src/shared/remoteProfileStore.ts:12-16：现有权威 bundle 仅有 profile + credentials，没有 Cookie revision、客户端游标、journal 或 tombstone。"
          - "src/shared/browserProfile.ts:108-111：现有持久权威只表达 local 或单一 Remote Host，离线运维状态需明确不是新权威。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是：Cookie 可在重连时以当前 Chromium 状态做全量对账，另加持久 journal 和 tombstone 会提高复杂度并形成事实上的第二权威。回读 AC 的离线删除场景与现有仅含 profile/credentials 的 bundle 后确认，重启后的“缺失”无法区分明确删除与从未存在，仅扫当前值会丢失删除意图；同时把 journal 定义为带 baseRevision 的待确认操作而非可读快照，能够保持 Host 为唯一裁决权威。
          rationale: "采纳。PRD v0.2 的 AC-3 定义规范化 identity、稳定 deviceId+operationId+baseRevision、Host 原子接受顺序与幂等重试；AC-4 定义 delete/expire tombstone、evicted 与覆盖事件例外，并明确 BL-008 不删除最新 tombstone；AC-6 要求加密且跨重启的待确认 journal。通过常驻最新 tombstone 删除了不可证明的 GC 前提。"
          responded_at: "2026-08-10T15:38:10Z"
        verification_status: fixed
        verification_evidence: "PRD v0.2 AC-3 锁定 identity、deviceId + operationId + baseRevision、Host 单调 revision 与幂等重试；AC-4 保留每 identity 的最新 tombstone 并规定 evicted/覆盖例外；AC-6 要求跨重启加密待确认 journal。tombstone 不再依赖不可证明的 GC 前提。"
      - id: FAST-004
        severity: high
        description: "PRD 要求旧 bundle 升级、Cookie 初始导入、全量迁移和长期 tombstone，但没有对齐现有 Profile RPC 的 8 MiB 请求/响应上限与 30 s 超时，也没有定义 bundle v1 与v2 的双向兼容。把 Cookie 数据直接塞入现有整包导出/迁移会产生确定性容量失败，并使旧 Host 被简化成不可用而无可验收降级语义。"
        suggestion: "在 AC-5/6/8 增加协议边界：保留 8 MiB/30 s 时，Cookie 快照/变更须分页或分块、每页可重试并有游标，单项超限记固定跳过原因而不阻断其他项；定义 v1 读取为‘无 Cookie 状态’的单向升级、v2 的 describe 能力探测和旧客户端禁止覆盖新数据的规则。"
        category: technical-consistency
        code_evidence:
          - "src/shared/remoteProfileStore.ts:4-16：RPC/bundle 版本均固定为 1，ProfileBundleV1 无 Cookie 字段，RPC 最大 8 MiB。"
          - "src/main/remote/orchestrator.ts:57,653-672：Profile RPC 请求和 stdout 均限 8 MiB，单次 SSH stdio RPC 超时 30 s。"
          - "src/host/profileStoreRpc.ts:144-151：Host 入口同样在 JSON 解析前拒绝超过 8 MiB 的请求。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是：8 MiB/30 秒属于传输实现约束，应由 TECH 选择分页、压缩或新 RPC，PRD 只需要求“大数据也能同步”。回读严格 v1 parser 与两端硬上限后确认，直接扩展整包会使兼容与容量失败成为确定性用户行为，产品层必须锁定“旧能力继续可用、Cookie 能力显式探测、单项失败不拖垮其余项、可续传”这些结果；具体 page size 与 wire schema 仍留给 Blueprint。
          rationale: "采纳。PRD v0.2 背景显式记录 8 MiB/30 秒边界；AC-5 要求 v1 配置/密码继续可用、旧客户端不得覆盖 Cookie plane、能力探测、低于上限的有界分页/游标、幂等重试和超时续传；AC-8 增加单项超限固定跳过且不阻断其他项。"
          responded_at: "2026-08-10T15:38:10Z"
        verification_status: fixed
        verification_evidence: "PRD v0.2 背景与 AC-5 明确 8 MiB/30 秒边界、v1 解释为无 Cookie 权威、能力探测、旧客户端保护、有界分页/游标、幂等重试与超时续传；AC-8 规定单项超限固定跳过且不阻断后续项。"
      - id: FAST-005
        severity: medium
        description: "AC-1 说首个网站请求必须等 Cookie hydration，但没有定义门的粒度与状态：是每 Profile×出口分区、每连接代还是每次启动；已恢复的常驻标签、新建标签、跳过项、超过 30 s 和用户重试各自何时可放行。这会让‘零请求抢跑’无法稳定地做集成验收。"
        suggestion: "在 AC-1/6/9 定义一个可观测的 per-profile/per-partition hydration gate：按当前 Host generation 完成初始快照应用后才创建/导航 webview；部分跳过可放行，离线/不兼容/超时保持尚未发请求并提供就地重试。覆盖启动恢复 URL 与加入后立即导航两条测试。"
        category: verifiability
        code_evidence:
          - "src/renderer/components/BrowserPanel.tsx:138-156,249-255：当前 webview 拿到 URL 就直接以 src 创建，无 Cookie hydration gate。"
          - "src/renderer/components/BrowserPanel.tsx:1027-1064：现有渲染门只等 browserProfilesLoaded，不等 Cookie 同步就绪。"
          - "src/main/main.ts:1962-2000：attach 门只校验分区、当前代 Profile 配置和 UA。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是：要求所有页面都等待远端 hydration 会放大启动延迟，且 BrowserPanel 现有 Profile loaded 门可能已足以避免明显竞态。回读 BrowserPanel 直接用 src 创建 webview 的路径后确认，现有门只保证 Profile 元数据存在，并不能保证 Cookie 已写入目标 partition；若不定义代际与分区粒度，“首次请求前”无法被网络计数器稳定证明。部分跳过可放行也避免一条不兼容 Cookie 无限阻塞。
          rationale: "采纳。PRD v0.2 的 AC-1 把 gate 明确为每个 Profile × 网络出口 partition × 当前 Host generation，初始快照应用完成后才创建或导航新 webview；部分跳过记录后放行，离线/不兼容/超时保持零网站请求并可重试。AC-6 将新建、重载与恢复 URL 全部纳入同一 gate。"
          responded_at: "2026-08-10T15:38:10Z"
        verification_status: fixed
        verification_evidence: "PRD v0.2 AC-1 定义 Profile × 网络出口 partition × 当前 Host generation 的 hydration gate、放行条件、零网站请求与重试语义；AC-6 将新建、重载、恢复 URL 纳入同一 gate，已覆盖所需可观测粒度与状态。"
      - id: FAST-006
        severity: medium
        description: "AC-7 对 renderer/日志脱敏的边界正确，但新增的离线 journal、初始快照、跳过/冲突报告和 Host 发现索引尚未纳入敏感数据边界。Cookie 名、domain/path、值和变更 payload 都可成为新的本机明文或错误日志泄露面。"
        suggestion: "在 AC-7 明确：journal 与 Host 权威数据使用与现有 Vault 等价的私有落盘/加密和原子写边界；ordinary renderer 只获得固定原因类别及数量；日志/错误/截图不包含 Cookie name、domain/path、value 或原始 payload；发现只回传用户选择所需的 Profile 摘要。"
        category: security-compatibility
        code_evidence:
          - "src/host/remoteProfileStore.ts:738-744：现有 Remote Profile bundle 经加密后原子私有落盘，新 Cookie/journal 路径需继承同级边界。"
          - "docs/adr/ADR-0003-remote-profile-authority-and-migration.md §决策 2-3：main-only 仅是应用接口隔离，Remote Host 管理员与同 SSH UID 仍在可解密信任边界。"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是：Cookie 值加密且 renderer 不接触值已经覆盖主要风险，name/domain/path 通常不是秘密；继续禁止这些字段进入报告可能降低排障能力。回读现有 Vault 私有落盘边界和 ADR-0003 的真实信任模型后确认，domain/path/name 会直接泄露访问站点、账号用途与 identity，journal/发现索引/错误路径又是本 Feature 新增的持久与展示面；以固定原因类别和计数排障足以满足本 Feature 的 UI 目标。
          rationale: "采纳。PRD v0.2 的 AC-7 将 Host 权威数据与本机 journal 纳入等价加密、私有权限、原子写边界，并禁止普通 renderer、DTO、日志、错误和截图包含 Cookie name、domain/host、path、value 或原始 payload；发现仅返回 Profile 摘要。AC-8 的跳过/冲突报告只保留固定类别和去重计数。"
          responded_at: "2026-08-10T15:38:10Z"
        verification_status: fixed
        verification_evidence: "PRD v0.2 AC-7 将 Host 权威记录及本机 journal 纳入加密、私有权限和原子写边界，并禁止 renderer/DTO/日志/错误/截图泄露 Cookie identity 或 payload；AC-8 仅允许固定原因类别与去重计数。"
---

# PRD 冷审结论（fast · Round 1）

**Verdict: NEEDS_REVISION**

PRD 准确承接了 WS-02 的 3A 范围、ADR-0003 的单一权威与同 UID 信任边界，也保住了 LocalStorage / IndexedDB / Service Worker / Cache 不上传和不拷贝 Cookie DB 的边界。但 D-1/D-2 尚未决策，且离线删除、tombstone GC、全局迁移/删除和现有 8 MiB/30 s 协议限制尚未形成可实现、可证明的合同。

## PL 六问

1. **用户问题是否真实且与上游一致？** 是。换设备后的登录连续性与 Host 发现/加入是 3A 价值成立的必要条件。
2. **最小交付是否足够简单？** 核心 Cookie 对账范围合理；AC-10 将共享删除与 Remote→Local 全局迁移捆绑，已超出一个简单语义，应拆开。
3. **产品决策是否已锁定？** 否。D-1/D-2 直接改变 P0 AC，不能留给实现阶段默选。
4. **既有行为、升级与回滚是否清楚？** 部分清楚。回滚保留设备 Chromium 会话很好，但 bundle v1→v2、旧 Host/旧客户端及全局 move/delete 仍缺失。
5. **端点与失败是否可闭合？** 否。离线删除跨重启、无限期离线设备、tombstone GC 和超限/超时都没有确定结果。
6. **是否可用稳定自动化证明？** 尚不能。需要可控时钟/多客户端 fixture、hydration 前零网站请求的观测点，以及分页/重试/游标的确定断言；‘常见网站仍认可会话’只能作冒烟，不能作唯一验收信号。

**PL-CHALLENGE:** 如果 Remote Profile 被从 Host A 迁到设备 A 的 `This device`，设备 B 究竟应当（1）全局丢失该 Profile 并清除本地会话，（2）保留一份独立本地副本，还是（3）跨设备继续访问设备 A？当前 AC-10 同时暗示“唯一权威迁移”与“其他设备收敛”，但三个结果的产品价值、风险和实现都完全不同。这项必须由 PL 拍板，不应由 TECH 以“实现方便”代选。

## 可实现

- FAST-002：现有每设备 catalog 无法直接承担 Host 发现与全局 move/delete。
- FAST-004：Cookie 数据面必须正面处理 8 MiB/30 s，不能继续整包扩展。
- FAST-005：现有 webview 会立即带 `src` 创建，需要产品可观测的 hydration gate。

## 可验证

- FAST-003：tombstone 清理条件当前是不可证明的全称命题。
- FAST-005：应将“首请求之前”改为有 gate 状态和网络计数器的确定测试。
- 其余 AC 的 BDD 结构、固定跳过原因类别与 UI 计数为 Blueprint 留出了良好测试接缝。

## 数据一致性

- FAST-003：需补齐 offline journal、Cookie identity/base revision、确定冲突裁决和 tombstone compaction floor。
- FAST-002：需有 Host 端持久的全局 delete/move epoch，否则旧设备可重建已删除数据。

## 安全与兼容

- FAST-001：session-only 是凭据寿命决策，未拍板前不能验收。
- FAST-004：需定义 bundle/protocol 版本升级、旧端保护与容量边界。
- FAST-006：现有 main-only 与同 UID 信任描述正确；新 journal/索引/报告也必须纳入同级私有落盘与脱敏边界。

## 简洁性 counter-lens

建议保留一个 Host 权威 Cookie log + 每设备游标/有界 journal + Profile×分区 hydration gate 三个核心概念。不要在本 Feature 另建跨设备协调服务、通用 Cookie 管理器或第二套 authority catalog。AC-10 应先收敛产品语义，再决定是延续 Host tombstone，还是把 Remote→Local 定义为“终止共享 + 创建本机副本”。

## 修订门槛

1. 拍板 D-1/D-2 并改写受影响 AC。
2. 拍板 Remote→Local 对其他设备的结果，定义 Host 发现/加入及全局 delete/move epoch。
3. 补充可跨重启的离线 journal、revision/冲突键、tombstone GC 或 full-resync floor。
4. 补充 8 MiB/30 s 下的分页/分块、超限跳过、超时重试和 v1→v2 兼容。
5. 将初始 hydration 放行规则写成可观测、可测试的 gate，并把 journal/索引/报告纳入秘密脱敏边界。

## Round 2 验证

**验证时间：** 2026-08-10T15:39:40Z

**范围锁定：** 仅逐条核验 Round 1 的 FAST-001..006 及其 PM 已声明的 v0.2 修订；未进行开放式全量重扫。未发现由这些修订引入的 high/medium 回归。

**总体裁决：** APPROVE

**是否需要下一轮：** 否（fast 最后一轮）。

| Finding | 裁决 | 验证结论 |
|---|---|---|
| FAST-001 | fixed | D-1/D-2 虽保留给 Goal 用户终确认，但推荐候选已经直接收敛为 AC-2 的 Profile 级跨出口持久 Cookie 对账、session-only 本机策略跳过；候选 AC 自洽，不以未终确认重复报问题。 |
| FAST-002 | fixed | D-3、AC-1 与 AC-10 已定义发现/显式加入、固定冲突结果、delete/move epoch 及 Remote→Local 的终止共享结果；不再隐含要求通用跨设备协调服务。 |
| FAST-003 | fixed | AC-3/4/6 已定义持久待确认 journal、操作幂等与 base revision、Host 顺序裁决、最新 tombstone 常驻和跨重启恢复。 |
| FAST-004 | fixed | AC-5/8 已将 v1 安全降级、能力探测、8 MiB/30 秒下的分页游标、续传及单项超限跳过写成验收合同。 |
| FAST-005 | fixed | AC-1/6 已将 hydration gate 固定为 Profile × partition × Host generation，并覆盖部分跳过、离线/超时、重试、新建/重载/恢复 URL。 |
| FAST-006 | fixed | AC-7/8 已将 Host 记录、journal、发现及报告纳入加密/私有/原子落盘与 identity/payload 脱敏边界。 |

Round 1 的 **PL-CHALLENGE** 保留作为 D-3 用户终确认时的决策上下文；v0.2 的推荐候选 A 已给出一致、可验收的答案。Round 1 frontmatter 中的 coverage 申报（可实现、可验证、数据一致性、安全与兼容）保持不变，并已按该范围完成上述复核。

## 用户终确认

2026-08-11，用户确认 PRD v0.3，并采用 D-1 A、D-2 B、D-3 A。PRD 已将状态更新为 `confirmed`、锁定业务方向，Round 2 的 APPROVE 结论保持有效。
