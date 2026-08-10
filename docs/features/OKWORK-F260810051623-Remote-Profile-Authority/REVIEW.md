---
reviewers: [fast]
verdict: APPROVE
coverage:
  fast: "Architect: PRD/TECH/UI and production wiring; QA: TC realism, boundary/error/reconnect cases; independent: generic Host-token security boundary, migration generation/atomicity, and UI no-bubble/no-AUTHORITY checks."
findings:
  - id: F1
    severity: BLOCKER
    status: fixed
    title: "持有既有通用 Host WebSocket token 的客户端仍可直接读取或篡改远端 profile-store 密钥与密文"
    source: arch
  - id: F2
    severity: MAJOR
    status: fixed
    title: "迁移目标选择器仅按 Host ready 放行，未在提交前排除不兼容的远端 Host"
    source: qa
---

# Remote Profile Authority — 快速独立复核

审阅范围：`f568fac..524aec1`，以及本功能 PRD、TECH、TC、UI、DEV-RULES 与 KNOWLEDGE。按 fast review 只做静态冷审；未运行测试、打包或 lint，也未改动产品代码。

## 结论

Round 1 结论为 **NEEDS_REVISION**；Round 2 在 `0f8f622..c8e973b` 范围内逐条验证后为 **APPROVE**。F1 已通过用户确认的 WS-02 信任边界校正产品契约、测试与确认披露；F2 已接入当前连接代兼容性探测并在提交前禁用不兼容目标。未发现修复 diff 引入的新 BLOCKER/MAJOR。

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

## Round 2 verification — `0f8f622..c8e973b`

本轮仅静态复核 Round 1 F1/F2 与直接修复 diff，未运行测试。

### F1 — fixed：产品契约、设计、测试、预览与生产确认一致

**质疑：** 仅把 PRD 改成“同 SSH 用户可信”不足以关闭 F1；若产品 UI、TECH、TC 或生产实现仍宣称通用终端 token 必须被 capability 阻止，就仍是自相矛盾的安全承诺。

**实际证据：**

- PRD v0.4 在背景、AC-3、隐藏前提和变更记录中统一明确：Host 管理员、配置 SSH OS 用户与以该用户执行任意 FS/PTY 的终端/Agent 是远端解密信任边界；main-only 是 API/interface 隔离，不是同 UID shell 沙箱。
- TECH 的架构第 5 点与“安全与信任边界”新增相同限定，并正确说明 `0700/0600` 只隔离其他 OS 用户；风险表也记录不得把 capability 误述为 OS 隔离。TC-003 收敛为普通 renderer 无专用方法/capability、错 Host/Profile/generation 凭据统一拒绝，而不再声称同 UID shell 会被拒绝。
- UI.md 的 AC-3 映射、全景预览 `docs/design/preview-project/src/main.jsx` 与真实确认面 `src/renderer/components/settings/BrowserProfilesSection.tsx:604-617` 都以普通文字披露“Remote Host、管理员及以配置 SSH 用户运行的进程可解密”；没有恢复气泡或 `AUTHORITY` 标识。
- 生产接口仍保持约定的 main-only 边界：`src/main/remote/orchestrator.ts:621-700` 使用不进入通用 WS 的 SSH stdin RPC，`src/preload/preload.ts` 只暴露迁移意图而不暴露 provider/capability；更新的 `remoteProfileAuthoritySecurity.test.ts:169-181` 静态断言 general Host protocol 不含 profile/vault/migration 方法，并继续覆盖错配 capability 的统一拒绝。

**裁决：fixed。** 同 UID 任意 FS/PTY 的可解密性不再与产品承诺冲突；保留的安全主张（普通 renderer 不获专用 Profile/Vault 接口、专用凭据错配 fail-closed）有对应生产边界和测试。按用户明确保留 WS-02 信任模型，本 finding 不应重开。

### F2 — fixed：当前连接代的 compatibility 已进入提交前 selector 闭环

**质疑：** 若 renderer 仅得到一次性的 ready 状态、缓存跨 generation 复用，或 Continue 未同时检查 status，ready 但旧 bundle 的 Host 仍可能“选了再失败”。

**实际证据：**

- `ProfileStorageTargetStatus` 与 `browserProfile:listStorageTargets` 定义在 `src/shared/browserProfile.ts:86-112`；`main.ts:662-680` 仅允许主窗口调用，并对每一已配置 Host 的同一 `RemoteProfileProvider` 查询 status。preload 和 renderer 类型均已接线，renderer 不可伪造 compatibility。
- `RemoteProfileProvider.storageTargetStatus()`（`src/main/remoteProfileProvider.ts:227-277`）通过当前 transport 的 `describe()` 验证版本/算法；compatible/incompatible cache 都以 generation 为键。transport 改代时旧值不会命中，异步 describe 返回后再次比对 generation；`invalidate()` 同时清理两类 cache（`:467-480`）。main 原有 plan handler 仍会在真正签 plan 前再次 `describe()` 和重验 generation，提供最终权威门。
- `BrowserProfilesSection` 打开 dialog 时并发拉 Host、stage 与 target status（`:193-219`），并在每个 remote lifecycle event 先清旧 status/plan 后重载（`:229-237`）。radio 与 Continue 都要求 `stage === ready && compatibility === compatible`（`:304-308`、`:558-597`、`:635-653`）；不兼容 Host 禁用并显示可行动的 Update 提示，无法调用 plan。
- 更新测试不是空断言：provider 测试验证同 generation 只 describe 一次、改 generation 或 invalidate 后重新 describe，以及 ready-but-incompatible 的稳定 status（`remoteProfileAuthoritySecurity.test.ts:106-167`）；renderer 测试验证不兼容 radio/Continue disabled、Update 文案且不发 plan，并验证 remote event 后旧 compatible 状态被清除重查（`BrowserProfilesSection.test.tsx:301-353`）。

**裁决：fixed。** status 的来源、generation 生命周期、IPC/preload/types、选择器禁用、可行动文案和 main 最终复核均已接通；Round 1 所述 ready-but-incompatible 确定性路径不再可提交。

### Round 2 verdict

**APPROVE**。两项 open finding 均已 fixed；本轮范围内未发现修复 diff 引入的 BLOCKER/MAJOR。测试通过情况沿用开发记录，本审只读测试代码与实现，未重复执行。
