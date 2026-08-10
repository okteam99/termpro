---
reviewers: [fast]
verdict: NEEDS_REVISION
coverage:
  fast: "Architect: PRD/TECH/UI and production wiring; QA: TC realism, boundary/error/reconnect cases; independent: generic Host-token security boundary, migration generation/atomicity, and UI no-bubble/no-AUTHORITY checks."
findings:
  - id: F1
    severity: BLOCKER
    status: open
    title: "持有既有通用 Host WebSocket token 的客户端仍可直接读取或篡改远端 profile-store 密钥与密文"
    source: arch
  - id: F2
    severity: MAJOR
    status: open
    title: "迁移目标选择器仅按 Host ready 放行，未在提交前排除不兼容的远端 Host"
    source: qa
---

# Remote Profile Authority — 快速独立复核

审阅范围：`f568fac..524aec1`，以及本功能 PRD、TECH、TC、UI、DEV-RULES 与 KNOWLEDGE。按 fast review 只做静态冷审；未运行测试、打包或 lint，也未改动产品代码。

## 结论

**NEEDS_REVISION**。目录、迁移状态机、专属 SSH stdio RPC、Host 端加密与 UI 的主路径接线整体完整，但 F1 使“旧通用 Host token 绝不能读取 profile/vault”的安全承诺不成立，可直接恢复远端密码数据，必须在合入前修复。F2 是确定的提交前 UX/兼容性缺陷；虽然后端会拒绝且不会切换存储，仍应补齐选择器判断与测试。

## Findings

### F1 — BLOCKER：通用 Host token 可绕过专属 RPC capability，读取或篡改 profile-store

**挑战 / 可能误报：** 专属 `host.js --profile-store-rpc` 的确要求 capability，且私钥/密文以 `0600` 保存。若通用 Host WebSocket 客户端是不同 OS 身份、或其文件与 PTY 能力被 profile-store 隔离，这个问题不会成立。

**实际证据：** 代码显示现有通用 Host token 所连接的正是同一 SSH 用户下的 `HostCore`，没有 profile-store 路径或命令限制：

- `src/host/hostCore.ts:195-214` 的 `host.info` 暴露 home；`:248-313` 将通用 token 的 `fs.readdir`、`fs.readFile`、`fs.readFileBinary`、`fs.writeFile` 直接交给通用文件服务。
- `src/host/fsService.ts:85-124` 可读取任意传入路径（二进制也可）；`:172-180` 可写入任意已存在普通文件。`HostCore` 的数据目录是 `OKWORK_HOST_DATA_DIR` 或同一用户的 `~/.termpro-host`（`src/host/hostCore.ts:98-104`）。
- profile-store 明确放在该 data dir 的 `profile-store` 下（`src/host/remoteProfileStore.ts:344-358`）。密钥文件是 `profile-store/master.key`，仅以同一用户可读的 `0600` 保护（`src/host/remoteProfileCrypto.ts:323-340`）；这不会限制同一 Host 进程所代表的 SSH 用户。
- 因而持有既有通用 token 的客户端可先取 home，再用 `fs.readFileBinary` 取得 `profile-store/master.key`，并用 `fs.readFile`/`fs.readFileBinary` 取得 profile 密文和 staging 文件；AES-GCM 的 key、nonce、AAD 所需 profile id 都已可得，客户端可离线解密或以 `fs.writeFile` 篡改数据。即使只封锁这些文件，通用 `pty.spawn`/`pty.input` 仍允许任意 shell（`src/shared/protocol.ts:42-48`、`src/host/hostCore.ts:218-226`、`src/host/ptyPool.ts:152-171`），可运行同一用户可运行的命令。
- `remoteProfileAuthoritySecurity.test.ts:106-162` 只把错误 capability 直接传入 `handleRemoteProfileRpc`，并未用已存在的通用 WS token 走 `HostCore` 的 FS/PTY 路径；这是 seam 测试通过但生产可达路径未受测，并不反驳上述绕过。

**判定：确认，BLOCKER。** 这直接违反 AC-3/安全设计的“既有 general Host token（包含恶意 renderer/Agent）拒绝 profile/vault 读写、迁移、解密、capability 枚举”要求，后果是远端保存密码的读取和破坏。修复必须建立通用 Host token 不可穿透的实际隔离边界：仅在 profile-store 路径上加简单 FS deny 仍不足以抵御任意 PTY shell；应将 profile-store/RPC 放到不同 OS 凭据或同时收紧通用 Host 的 FS 与可执行命令能力，并以真实通用-token 客户端做端到端负向测试（读取密钥、列目录、写入、PTY 均被拒绝）。

### F2 — MAJOR：不兼容 Host 在迁移对话框中被当作可提交目标

**挑战 / 可能误报：** 后端在实际计划迁移前会调用 `RemoteProfileProvider.describe()`，所以不兼容 Host 不会进入 copy/verify/switch，也不会造成 profile 写错位置。

**实际证据：** `src/renderer/pages/BrowserProfilesSection.tsx:513-542` 对远端目标的唯一可选择条件是 `storageStages[host.id] === 'ready'`；它没有兼容性/`describe` 结果。任何已连上但缺少或不兼容专属 CLI 的 Host 因此会启用 radio 和 Continue。主进程随后才在计划阶段 describe 并返回通用“not available; reconnect or update”错误（`src/main/main.ts:781-784`，renderer 错误处理 `BrowserProfilesSection.tsx:208-225`）。这与 AC-2、TECH 的“只提供 ready/compatible 目标、不可提交目标应给可行动原因”不符。现有 BrowserProfiles 测试只覆盖 ready Host（`BrowserProfilesSection.test.tsx:251-328`），未覆盖不兼容但 ready 的场景。

**判定：确认，MAJOR。** 后端拒绝让其不升级为数据安全问题，但用户仍会在 Continue 后才失败，且看不到真实兼容性原因。应把 describe/compatibility 状态在展示目标前提供给 UI，禁用不兼容选项并显示可行动原因；补充该路径的 renderer 测试。

## 架构与实现核对

- **唯一目录权威与路由：** `ProfileCatalogStore` 是 profile 位置、storage、已提交迁移的唯一持久目录；`ProfileAuthorityService` 按目录路由 local/remote provider。`main.ts` 将 browser、trusted/password IPC、remote Host 生命周期、删除与迁移都接到这一 facade，未发现第二份可写的 local shadow 路由。
- **迁移边界：** `ProfileMigrationCoordinator` 执行 source read → target stage → HMAC nonce verify → switch/publish → `commitMigration`（目录和 storage 原子提交）→ cleanup；每个异步边界均检查 operation 和 source/target generation。最新修订也在 bind confirmation 时重新比对来源/目标 generation，late response 不会覆盖新连接。
- **断连、删除和依赖：** remote 失联会使该 Host profiles 不再可 attach/读写，已打开页面仅可继续现有页面 cookie；依赖计算涵盖 current、migration source/target 与待 cleanup，Host 配置/凭据删除由 IPC 阻挡，profile 删除与迁移互斥。该行为符合“无 local fallback、可恢复 cleanup”的设计。
- **SSH 分层：** `RemoteHostOrchestrator.profileTransportFor()` 使用固定 `host.js --profile-store-rpc` 的 SSH stdin/stdout，30 秒和大小限制；密码业务不经通用 WS 事件。`RemoteProfileProvider` capability 仅驻留进程内并被 profile/generation scope 约束。此分层本身正确，但 F1 说明旧通用 Host 的广泛 FS/PTY 权限仍从旁路越过了它。
- **加密与日志：** Host 端 AES-256-GCM 使用 12-byte nonce 和 profile-id bundle AAD；已有 ciphertext 而 key 遗失或坏格式会 fail closed，私有目录/原子写入均已实现。远端 provider 使用固定错误代码/审计摘要，未见把 password、capability 或原始 RPC 负载写入日志的路径。
- **复杂度：** 对于“跨 Host、可恢复迁移、重连代际”这个范围，catalog/provider/coordinator 的分工清晰，没有为了抽象而复制第二套数据源；真正缺失的是通用 Host 权限边界，而非再增加客户端状态机。

## QA、测试真实性与 UI

开发记录声明：TypeScript 通过、目标 63/63、全量 Vitest 1805 通过、打包、Electron T-012 与 smoke 均通过；本审未复跑。代码中的 TC 对应测试不是空壳：迁移测试确实驱动 stage/verify/switch/cleanup 与 generation，Host store/crypto 测试覆盖密文、篡改、AAD、key 丢失 fail-closed，provider 测试覆盖 capability/错误码。问题在于 F1 的安全测试只验证了 RPC handler seam，并未验证 production generic-token 旁路；F2 的 UI 测试未构造 ready-but-incompatible Host。

UI 与 UI.md 的可静态核对项通过：用户可见文案为 `Password storage`，未发现信息气泡，也未在产品 UI 输出 `AUTHORITY`；离线、迁移失败、cleanup retry、Host 依赖阻止均有相应界面状态。浏览器 connector 当时没有可用实例，故不能把截图缺失表述为已验证的浏览器视觉结论；已用组件结构、样式和 Electron 证据声明作替代静态核查。F2 是这部分的唯一确定缺口。

全仓 lint 既有 141 errors / 379 warnings；开发记录的功能作用域 lint 为 0 errors，且静态 diff 未显示本功能新增该基线问题，故不单独阻塞本 feature。
