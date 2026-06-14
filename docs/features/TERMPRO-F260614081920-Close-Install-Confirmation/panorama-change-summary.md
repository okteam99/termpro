---
reviewers: [pm, architect]
conclusion: passed
change_level: L2
reviewed_at: "2026-06-14T09:31:00Z"
---

# Panorama Change Summary

## 变更摘要

本 Feature 在 `docs/design/preview-project` same-stack 全景中新增 `/shell/close-install-confirmation` 设计预览路由，页面 ID 为 `shell-close-install-confirmation`。
该路由用于审阅主窗口关闭、App Quit、升级安装确认，以及取消安装后可重试状态。

涉及文件：
- `docs/design/preview-project/src/main.jsx`：新增 route、confirmation scenarios、确认弹窗、状态卡和升级胶囊状态。
- `docs/design/preview-project/src/styles.css`：新增确认弹窗、状态卡、retryable/ready 升级胶囊样式。
- `docs/design/sitemap.md`：登记新增设计预览节点和 sync log。

## 受影响 Features

扫描结果：当前仓库 `docs/features` 下仅发现本 Feature 的 active `state.json`，未发现其他 in-flight Feature。
仓库根未发现 `ROADMAP.md` / `PROJECT.md`，因此没有 planned Feature 清单需要协调。

潜在影响面限定在设计全景：
- 不改变真实 Electron 产品路由或导航。
- 不改变设计 token 或共享视觉基线。
- 不修改既有 `/terminal/file-panel-path-location` 与 `/sidebar/settings-about-entry` 预览路由的语义。

## 协调结论

PM review：新增预览节点直接对应 PRD AC-1..AC-8，覆盖关闭确认、退出确认、安装确认、安装取消恢复、确认锁、升级胶囊文案与 `TERMPRO_SMOKE` bypass。新增路由仅为设计审阅入口，不引入用户可见导航承诺。

Architect review：preview-project 仍复用既有 workbench shell、Sidebar、TabBar、Terminal、FilePanel 基线；本变更没有新增外部依赖，没有改设计 token，没有改真实应用架构。新增状态均在 preview-project 内以 mock scenario 表达，后续实现仍应在 Electron main/updater 层完成。

判级依据：
- 判据 1（sitemap 节点增删移 / 路由变化）：不满足 L1。新增 `/shell/close-install-confirmation` 设计预览路由，因此按规范判为 L2。
- 判据 2（设计 token / 共享视觉基线变更）：满足 L1。没有修改 token，只复用现有色彩变量并新增局部 class。
- 判据 3（受影响 Features 扫描零命中）：满足 L1。未发现其他 active/planned Feature 需要 owner 协调。

结论：L2 结构变更成立，原因仅为新增设计预览 sitemap 节点；reviewers 认为变更可接受，建议通过并进入 blueprint。
