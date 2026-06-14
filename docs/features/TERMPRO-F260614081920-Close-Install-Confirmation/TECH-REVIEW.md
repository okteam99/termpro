---
feature_id: "TERMPRO-F260614081920-Close-Install-Confirmation"
reviewers: [qa, architect, external]
verdict: APPROVE
reviewed_at: "2026-06-14"
---

# Close / Install Confirmation - 技术方案评审

## 状态
已合并 external cross-review 结果并修订 TECH / TC。

## QA Review

| ID | 结论 | 说明 | 处理 |
|----|------|------|------|
| QA-1 | APPROVE | TC frontmatter 覆盖 AC-1..AC-8，`verify-ac.py` 可机读校验。 | 保留。 |
| QA-2 | APPROVE | updater 取消安装恢复拆成 T-003，覆盖不 restarting、不 quitAndInstall、watchdog 清理、artifacts 清理、`installing=false`、available 广播。 | 保留。 |
| QA-3 | APPROVE | `TERMPRO_SMOKE` bypass 单列 T-007，可防无头冒烟卡住。 | 保留。 |

QA 结论: APPROVE。

## Architect Review

| ID | 结论 | 说明 | 处理 |
|----|------|------|------|
| ARCH-1 | APPROVE | 方案把原生窗口/quit/updater 行为保持在 `src/main`，不触碰 Host、shared protocol 或 renderer 工程数据边界，符合 ARCHITECTURE/DEV-RULES。 | 保留。 |
| ARCH-2 | APPROVE | 新增 helper 是 lifecycle 状态机与确认锁的最小封装，解决 main.ts 直接堆 flags 难测的问题；没有引入新依赖或跨层抽象。 | 保留。 |
| ARCH-3 | APPROVE | updater 只在 `update-downloaded` 后插入确认分支，保留既有下载、本地 feed 和 Squirrel.Mac 校验流程，符合 Out of Scope。 | 保留。 |
| ARCH-4 | APPROVE | 明确无数据库 schema 变更，跳过 DB schema 暂停点合理。 | 保留。 |

Architect 简洁性 counter-lens:

- 不新增 renderer modal，因为关闭/退出/安装重启都是 Electron native lifecycle，native dialog 更直接且无需扩展 preload IPC。
- 不新增用户偏好项或“下次不提醒”，符合 PRD Out of Scope。
- 不改 `UpdateEvent` 枚举，取消安装复用 `available`，避免为了“retryable”引入新 renderer 状态。

Architect 结论: APPROVE。

## External Review

external artifact: `external-cross-review/blueprint-claude.md`

| ID | Severity | 裁决 | 处理 |
|----|----------|------|------|
| CR-1 | high | ADOPT | App Quit 确认后 `app.quit()` 会触发窗口 close，确实需要 `isQuittingConfirmed` 串联；已写入 TECH 架构/关键边界。 |
| CR-2 | high | ADOPT | 原 TC 独立测 close/quit，漏掉 quit->close 串扰；新增 T-008。 |
| CR-3 | high | ADOPT | `false` 同时表达用户取消和锁忙会误清 updater artifacts；TECH 改为 `confirmed/canceled/busy`，update install 使用等待式确认；新增 T-009。 |
| CR-4 | low | ADOPT | T-006 扩展为 available + downloading 两态文案断言。 |
| CR-5 | low | ADOPT | UpdatePill 测试改放 `SidebarUpdatePill.test.tsx`，避免组件名错位。 |
| CR-6 | low | ADOPT | T-004 增加 quitAndInstall 内部 before-quit 不再弹确认断言。 |
| CR-7 | low | ADOPT | 新增 T-010 覆盖非 macOS `window-all-closed` 触发 app quit 的二次确认规避。 |

External 结论: findings 已处理，修订后 APPROVE。

## PM 收敛

- ADOPT: 用户补充的文案风险“关闭后再打开，Tab 内容可能丢失”已进入 UI.md、TC T-001/T-002 和 TECH dialog copy。
- ADOPT: 更新安装取消恢复被列为 P0 测试，不作为实现细节遗漏。
- REJECT: 不把文件查看窗口、diff 窗口、Tab 关闭、Workspace 删除纳入统一确认，原因是 PRD Out of Scope 且会扩大行为变更面。

## 结论

APPROVE。TECH 可进入 dev。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-06-14 | 完成 QA + Architect 技术评审初版。 |
| 2026-06-14 | 合并 external review 7 条 finding，修订 TC/TECH 后重新给出 APPROVE。 |
