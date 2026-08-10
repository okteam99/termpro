---
prd_feature_id: OKWORK-F260810051623-Remote-Profile-Authority
review_round: 2
review_started_at: "2026-08-10T05:53:30Z"
review_completed_at: "2026-08-10T06:04:04Z"
reviewers: [fast]
verdicts: {fast: APPROVE}
reviews:
  - role: fast
    review_scope: prd
    execution: subagent
    coverage: [可实现, 可验证, 安全, 数据一致性]
    verdict: APPROVE
    started_at: "2026-08-10T05:53:30Z"
    completed_at: "2026-08-10T06:04:04Z"
    files_read:
      - docs/features/OKWORK-F260810051623-Remote-Profile-Authority/PRD.md
      - product-overview/workstream/WS-02-browser-profile-login-continuity.md
      - docs/adr/ADR-0002-profile-password-vault-trust-boundaries.md
      - project-specs/KNOWLEDGE.md
      - project-specs/GLOSSARY.md
      - project-specs/ARCHITECTURE.md
      - src/shared/browserProfile.ts
      - src/main/browserProfileStore.ts
      - src/main/localPasswordVault.ts
      - src/main/passwordVaultController.ts
      - src/main/passwordVaultIpc.ts
      - src/main/browserProfileDeletion.ts
      - src/main/remote/remoteHostIpc.ts
      - src/main/remote/orchestrator.ts
      - src/host/hostCore.ts
      - src/host/wsServer.ts
      - src/shared/protocol.ts
      - src/renderer/components/settings/BrowserProfilesSection.tsx
      - src/renderer/components/settings/SavedPasswordsPage.tsx
      - src/renderer/components/browser/PasswordStatusBar.tsx
      - src/renderer/components/passwords/TrustedPasswordWindow.tsx
      - src/renderer/components/settings/RemoteHostsPage.tsx
    findings:
      - id: PL-CHALLENGE-001
        severity: high
        description: "迁移成功的定义自相矛盾：AC-5 把‘源清理失败’列为必须保持或恢复原 authority 的失败，而状态图把同一分支定义为 TargetAuthoritative 并保留源清理重试。两种语义会分别要求回滚目标或保留目标，无法为用户、崩溃恢复和验收测试给出唯一正确结果。"
        suggestion: "把切换前失败与切换后源清理失败分开写：复制、校验和切换前检查失败时仍由源 authority 服务；切换提交后源清理失败时目标仍是唯一 authority，UI 明示‘源清理待重试’，且绝不回切或读取源副本。同步修正 AC-5、状态图和成功/错误提示。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是 AC-5 的“保持或恢复原位置”可以只解释为 authority 提交前，而源清理失败自然由状态图补足，因此无需改文档。我重新对照 PRD v0.1 的 AC-5 与状态图，确认 AC 明确把“源清理”列入任一步失败且承诺恢复原位置，测试无法靠图猜出另一套优先级，所以该反方不成立。
          rationale: "我先质疑 finding 是否只是文字边界可由状态图消歧；回读 PRD v0.1 AC-5 与 CleaningSource 分支后确认两处给出相反结果，故采纳。PRD v0.2 已把 AC-5、时序图与 Host 删除依赖统一为：提交前失败保留源；提交后清理失败保持目标、旧源只作待清理副本。"
          responded_at: "2026-08-10T05:51:46Z"
      - id: FAST-001
        severity: high
        description: "AC-3 要求普通 renderer、Agent 与现有通用 Host RPC token 都不能调用远程 Vault，但 PRD 没把这一条细化成可验证的授权边界。现状是 renderer 在收到 verifying 事件中的 tunnel token 后直接建 WebSocket，而 Host 只以该 bearer token 放行整套 RpcMethods；若把 profile/vault RPC 添入这条现有通道，普通 renderer 即可调用它。仅写‘专用 main-only 能力’不足以判定实现是否真的与通用 token 隔离。"
        suggestion: "在 AC-3/AC-9 明确结果契约与负向验收：持有现有 renderer Host token 的客户端，对任何 profile/vault 读写、迁移、解密或 capability 枚举一律被拒且不返回敏感存在性；main 使用与通用 Host RPC 独立、不可转交 renderer 的授权路径。TECH 可选择具体传输/密钥设计，但必须证明两类 token 不能互换，并覆盖恶意/普通 renderer、Agent、过期或错 Host/Profile token。"
        category: technical-consistency
        code_evidence:
          file_path: src/renderer/components/settings/RemoteHostsPage.tsx
          line_range: "230-240"
          snippet: "const wsUrl = `ws://127.0.0.1:${localPort}?token=${encodeURIComponent(token)}`; const client = hostRegistry.getOrCreateRemote(configId, wsUrl);"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是 PRD 已写“专用 main-only 能力”，具体 token 隔离属于 TECH，实现审查再验证即可。我回读 RemoteHostsPage.tsx:230-240 与 PRD v0.1 AC-3，确认 renderer 当前确实拿到可连接整套 Host RPC 的 bearer token，而 AC 没有要求独立授权或负向拒绝矩阵；仅靠“专用”命名不能阻止把敏感方法挂到现有通道，因此反方不成立。
          rationale: "我先质疑 finding 是否把传输设计过早推入 PRD；回读现有 renderer token 流和 ADR-0002 的最小权限约束后，确认需要写的是可观察安全结果而非具体协议。PRD v0.2 AC-3 已要求独立且不转交 renderer 的授权路径，并明确通用、过期、错 Host/错 Profile 凭据对读取/写入/迁移/解密/枚举一律拒绝且不泄露存在性；TECH 仍可自由选择具体传输。"
          responded_at: "2026-08-10T05:51:46Z"
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-08-10T06:04:04Z"
---

# PRD-REVIEW（OKWORK-F260810051623-Remote-Profile-Authority）Round 1

### fast 评审段（execution: subagent）

verdict: NEEDS_REVISION

## PL 对抗质疑

已按六问检查价值前提、最小范围、成功定义、隐藏前提、替代/降级与既有行为变化。

### PL-CHALLENGE-001（severity: high）

迁移的成功定义在 AC-5 与状态图之间冲突，导致用户无法判断源清理失败后应继续使用哪一权威，也无法安全恢复。详见 frontmatter finding；这是成功定义与降级路径的实质质疑。

其余 PL 检查无新增 finding：单 authority、断线 fail-closed、Host 删除拦截及 BL-008 排除均与 WS-02-S2 的边界一致；D-1/D-2 是已明确列出的用户决策，未被伪装为既定事实。

## external 覆盖

### 可实现

发现 FAST-001。现有 renderer 可取得并使用通用 Host bearer token；PRD 必须先把 main-only Remote Vault 授权的可观测边界写清，才能避免 TECH 将敏感方法接入既有通用 RPC。

### 可验证

发现 PL-CHALLENGE-001。源清理失败没有唯一的预期 authority，无法写出确定的重启恢复、Retry 和 UI 验收断言。修正后需分别覆盖切换前失败与切换后清理失败。

### 安全

发现 FAST-001。通用 renderer token 当前足以开启 Host WebSocket；远程 Vault 的授权不能只依赖‘新增方法未被 UI 调用’这一实现约定。专用能力必须有可执行的拒绝式验收。

### 数据一致性

发现 PL-CHALLENGE-001。若同一次源清理失败既要求回切又要求目标已权威，崩溃恢复会出现可读源/目标不一致或不确定的 cleanup 重试行为。

## 整合结论

- overall_verdict: NEEDS_REVISION
- next_round_required: true
- 下一步：修正上述两项 PRD 结果契约后进行 Round 2 验证冷审。

---

# PRD-REVIEW（OKWORK-F260810051623-Remote-Profile-Authority）Round 2

### fast 验证段（execution: subagent）

verdict: APPROVE

本轮仅复核 Round 1 的两项已采纳 finding，并对其相邻的迁移、安全与数据一致性契约做窄幅回归；未发现新的 high 或 medium finding。

## 逐项验证

### PL-CHALLENGE-001 — PASS

- AC-5 以“持久化恢复记录中的 authority 原子提交是否已完成”为唯一分界：提交前失败、崩溃或连接切代仍由源服务且不读取不完整目标；提交后目标始终是唯一 authority。
- 提交后目标随即离线明确转入 AC-6 的 fail-closed，而非读取或回切旧源；源清理失败则为 `cleanup pending`，可幂等重试，旧源不再读取。
- 两个 Mermaid 图与 AC-5 一致：状态图在 `Switching` 的提交前失败回到 `SourceAuthoritative`，而 `CleaningSource` 失败回到 `TargetAuthoritative`；时序图也只在提交前走失败分支，提交后清理失败保持新 authority。
- AC-8 将当前 authority、在途迁移源/目标、删除待清理位置及 `cleanup pending` 源均列为阻止 Host 删除的可测试依赖，未形成删除后失去唯一 authority 的缺口。

### FAST-001 — PASS

- AC-3 将 main-only 规定为与现有通用 Host RPC **独立授权**、不经 preload / renderer 事件 / renderer token 转交的授权契约。
- AC-3 还定义可观察的负向拒绝矩阵：通用 Host token 的普通或恶意 renderer、Agent，以及过期、错 Host 或错 Profile 的专用凭据，对 Profile/Vault 读取、写入、迁移、解密与 capability 枚举均被拒绝，响应也不得泄露条目或 capability 的存在性。
- PRD 未规定具体传输、令牌格式、密钥算法或存储 schema；这些实现选择仍留给 Blueprint/TECH，同时 AC-9 约束最小权限、脱敏与 fail-closed 的安全结果。

## 窄幅回归结论

迁移语义仍符合 WS-02-S2 的单一 authority、复制—校验—切换—延迟清理及离线不回退边界；远程明文权限仍符合 ADR-0002 的 main 权威与最小权限原则。未发现新的业务目标偏移、不可测试矛盾、安全或数据一致性 high/medium finding。

## 整合结论

- fast: APPROVE
- overall_verdict: APPROVE
- next_round_required: false

## 用户决策落盘校验 — PASS

- D-1A：已将 Default Profile 的 authority 从条件式决策落为确定行为。`status=confirmed`、`business_direction_locked=true` 与 AC-1 一致规定其可迁移 authority、但仍不可改名或删除；这严格等于 Round 2 已批准的 A 推荐方向，未扩大 Profile 身份编辑范围。
- D-2A：已将受 Profile 引用的 Remote Host 删除规则从条件式决策落为确定行为。AC-8 明确必须阻止删除、列出依赖并引导先完成迁移/清理或删除 Profile，且不得自动迁回本机；这严格等于 Round 2 已批准的 A 推荐方向，保持单一 authority 与 `cleanup pending` 保护。
