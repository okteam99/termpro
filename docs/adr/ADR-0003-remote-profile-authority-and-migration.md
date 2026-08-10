---
id: ADR-0003
title: Remote Profile 采用单一权威、显式迁移与 Remote Host 同 UID 信任边界
status: accepted
date: 2026-08-10
tags: [browser, remote-host, profile, migration, security]
triggered_by: "OKWORK-F260810051623-Remote-Profile-Authority"
supersedes: []
---

## 背景

BL-006 已建立本机 Browser Profile 密码 Vault，但 Profile 配置与密码仍只有本机存储。BL-007 需要允许用户把
一个 Profile 的配置和密码存到指定 Remote Host，同时保持跨重启可恢复、断线 fail-closed，并避免迁移期间出现
双权威、数据回滚或 renderer 获得通用解密能力。

Remote Host 现有通用 WebSocket token 代表配置的 SSH OS 用户，并提供任意文件与 PTY 能力。因此，专用 RPC
可以隔离应用调用面，但不能在同一 OS 用户内部形成对终端 Agent 或管理员的安全边界。

## 决策

1. **每个 Profile 恰有一个持久权威。** `ProfileCatalogStore` 只记录 `local` 或一个 Remote Host；
   `ProfileAuthorityService` 按目录路由 provider。Remote Host 离线时所有需要权威数据的密码操作 fail-closed，
   不读写本机影子 Vault，也不排队“稍后上传”。
2. **远端 Profile/Vault 使用 main-only 专用 SSH RPC。** main 通过固定 `host.js --profile-store-rpc` stdin/stdout
   请求 `RemoteProfileProvider`；ordinary renderer 与通用 Host WebSocket 协议不暴露专用方法或 capability。
   请求绑定 client、Profile、connection generation，并以固定错误码拒绝错配，不提供枚举 oracle。
3. **远端加密落盘，但 Remote Host 同 UID 属可信边界。** Host 以 AES-256-GCM 和 Profile AAD 加密 bundle，
   私有目录/文件使用 `0700/0600` 与原子写。Remote Host 管理员、配置的 SSH OS 用户及以该用户运行的 FS/PTY
   进程或 Agent 都可解密；main-only 只承诺应用接口隔离，不承诺同 UID shell 沙箱。
4. **迁移采用 stage/verify/switch/cleanup。** target 先 stage 完整快照，source/target 以 HMAC nonce 验证，
   然后原子切换 catalog；提交前失败保持 source 权威，提交后 source cleanup 失败记录为可幂等重试状态。
   迁移锁住相关 mutation，所有 late response 同时校验 operation 和 source/target generation。
5. **目标资格绑定当前连接代。** UI 只允许 `ready + compatible` Host；兼容性由当前 generation 的 `describe`
   得出，断连/重连先清缓存再复查，main 在签迁移计划前再次复验。
6. **删除先计算依赖。** 被当前 authority、在途 migration 或 cleanup pending 引用的 Remote Host 不可删除；
   UI 列出依赖并要求先迁移或完成清理，不自动迁回本机。

## 理由

- 单一 catalog 提供一个可审计的提交边界，避免 local/remote 双写后无法判断哪份更新。
- 专用 main-only RPC 防止 ordinary renderer 获得批量 Profile/Vault 能力，同时复用已交付的 SSH 编排。
- copy/verify/switch/cleanup 把“数据已复制”和“权威已切换”分开，提交前后失败语义确定且可恢复。
- 诚实披露同 SSH UID 的真实权限模型，比用 capability 或文件模式承诺不存在的隔离更安全。
- generation-scoped compatibility 把确定性不兼容挡在选择阶段，main 复验保留最终权威门。

## 备选方案（考虑过，拒绝）

| 方案 | 拒绝理由 |
|---|---|
| local 与 remote 持续双写 | 断线、乱序和部分失败会产生双权威与密码回滚，且无法给出清晰提交边界 |
| 断线时自动回退本机 Vault | 会静默建立影子数据，恢复后无法确定哪份更新，违反每 Profile 唯一权威 |
| 把专用方法加入通用 Host WebSocket 协议 | renderer/Agent 会直接获得敏感接口，扩大 capability 分发与审计面 |
| 只靠 `0700/0600` 或路径 deny 隔离终端 Agent | 同 SSH UID 的任意 FS/PTY 能力可以读取文件或运行 shell，隔离承诺不成立 |
| 为 Profile Store 增加第二 SSH 用户 | 能形成更强 OS 边界，但增加凭据、部署和运维模型；当前用户选择沿用 WS-02 的同 UID 信任边界 |
| 客户端端到端加密且 Host 不持钥 | Host 无法服务跨设备读取/写入与未来 Cookie 对账；属于不同产品信任模型 |

## 后果

- **正面**：Profile 位置、迁移提交、断线和删除依赖都有唯一来源；普通 renderer 无专用解密接口；远端数据加密落盘。
- **负面**：Remote Host 与同 SSH UID 进程进入解密信任边界；迁移需持久 operation、generation 与 cleanup 状态。
- **约束**：以后新增 Cookie 漫游必须复用 catalog/provider/迁移提交边界，不得另建 local fallback 或第二位置台账。
- **约束**：安全文案不得把 main-only、capability 或文件权限描述成同 UID OS 隔离。
- **演进**：若产品将同 UID Agent 改为不可信，必须另立 ADR 选择独立 OS principal/第二 SSH 身份或 E2EE。

## 相关

- 代码：`src/main/profileCatalogStore.ts`、`src/main/profileAuthorityService.ts`、
  `src/main/profileMigrationCoordinator.ts`、`src/main/remoteProfileProvider.ts`、
  `src/host/remoteProfileStore.ts`、`src/host/profileStoreRpc.ts`
- 回归：`src/main/__tests__/remoteProfileAuthority*.test.ts`、
  `src/main/__tests__/remoteProfileMigration.test.ts`、
  `src/renderer/components/settings/__tests__/BrowserProfilesSection.test.tsx`
- 过程快照：`features/_archive/OKWORK-F260810051623-Remote-Profile-Authority.zip`
