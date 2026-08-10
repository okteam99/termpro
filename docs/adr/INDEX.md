# ADR 索引

> 架构决策记录(Architecture Decision Record)· 记录**跨 Feature 影响 / 反悔成本高 / 选哪个不显然**的决策。
> 🔴 ADR 的唯一落点是本目录 —— 不落 Feature 目录(Feature 目录交付即归档,决策理由会随之消失)。
> 命名 `ADR-NNNN` 四位数字 · 全局递增 · 永不复用。

| ID | 标题 | 状态 | 日期 | tags |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-remote-connection-orchestration-gates.md) | 远程机连接编排用「两道闸 + 意图与弃用标记分家」,状态收进 store 模块级单源 | accepted | 2026-08-05 | remote, concurrency, renderer-state |
| [ADR-0002](ADR-0002-profile-password-vault-trust-boundaries.md) | Profile 密码库采用 main 权威与 guest/ordinary/trusted 三层最小权限边界 | accepted | 2026-08-10 | browser, password-vault, security, electron |
| [ADR-0003](ADR-0003-remote-profile-authority-and-migration.md) | Remote Profile 采用单一权威、显式迁移与 Remote Host 同 UID 信任边界 | accepted | 2026-08-10 | browser, remote-host, profile, migration, security |
