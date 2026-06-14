---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: review
target_commit: 9b2ae7f
target_base: d42ccee
title: "TERMPRO-F260614081920-Close-Install-Confirmation · review stage external review"
generated_at: "2026-06-14T10:16:42Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
I have enough to complete the review. Here is my independent assessment.

```yaml
---
perspective: external-claude
target: code
generated_at: "2026-06-14T10:13:20Z"
files_read:
  - src/main/exitConfirmation.ts
  - src/main/updateInstallDecision.ts
  - src/main/updater.ts
  - src/main/main.ts
  - src/renderer/components/Sidebar.tsx
  - src/main/__tests__/exitConfirmation.test.ts
  - src/main/__tests__/updaterInstallConfirmation.test.ts
  - src/renderer/components/__tests__/SidebarUpdatePill.test.tsx
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TECH.md
  - package.json
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C1
    severity: high
    location: "src/main/main.ts:84 (powerMonitor.on('shutdown'))"
    issue: "powerMonitor.on('shutdown', ...) 在模块顶层执行(line 80-99 同 registerAppStore/initUpdater 同级),早于 app.on('ready')(line 441)。Electron 文档明确 powerMonitor 只能在 ready 之后使用。"
    rationale: "顶层求值发生在 app ready 之前，违反 powerMonitor 的 'after ready' 契约；历史上(尤其 Linux/dbus)pre-ready 访问会抛错导致主进程启动崩溃。即便 Electron 42 当前容忍，也属未文档化的偶然行为，升级即可能回归。冒烟若未跑到该行/未在打包态验证则无法暴露。"
    suggestion: "把 powerMonitor.on('shutdown', ...)(连同对系统退出的标记)移入 app.on('ready') 或 app.whenReady().then(...) 内，与文档契约对齐。"
  - id: CR-2
    checklist: C3
    severity: high
    location: "src/main/main.ts:81-86 (before-quit + powerMonitor.shutdown)"
    issue: "before-quit 现在会 preventDefault() 弹确认框；macOS 在用户注销/重启/关机时会向 App 发退出事件并触发 before-quit，确认框会中断/取消 OS 注销流程。"
    rationale: "powerMonitor 'shutdown' 仅覆盖关机/重启、不覆盖注销(logout)，且与 before-quit 的触发先后无保证；本 Feature 之前没有 before-quit 拦截，App 在 OS 退出时是干净退出。现改为可能阻塞 OS 注销/关机，属行为回归(系统会提示 “TermPro 阻止了注销”)。"
    suggestion: "区分 OS 发起的退出(在 powerMonitor shutdown/可检测的 logout 路径里先 markQuitting，且让 before-quit 在系统退出场景跳过确认)；或为 before-quit 增加来源判断，OS 退出不弹确认。建议补一条对应 TC/手测项。"
  - id: CR-3
    checklist: C1
    severity: high
    location: "src/main/updateInstallDecision.ts:33-39 (cancel 分支) + src/main/updater.ts:47-54 (cleanupInstallArtifacts)"
    issue: "用户在已 update-downloaded 后选择“稍后”：取消分支会 cleanupInstallArtifacts()(关本地 feed server + 删 zip)并 installing=false，但 Squirrel.Mac 此时已在内部 stage 了该更新。再次点击安装会重跑 download→setFeedURL→checkForUpdates 全流程，与 Squirrel 已 staged 的更新如何交互未验证。"
    rationale: "本 Feature 的核心价值就是“可取消后重试”。若 Squirrel 对同版本返回 update-not-available(→fallbackToReleasePage 打开发布页)或重复 staging，则‘稍后→再安装’这条主路径会破。纯函数单测只覆盖 broadcast/状态，触及不到真实 Squirrel.Mac 行为。"
    suggestion: "在真实打包构建上端到端验证‘稍后→再次点击安装→确认重启’闭环；如发现 Squirrel staged 状态冲突，考虑取消时不清 artifacts 而保留可直接 quitAndInstall，或显式 reset Squirrel 状态。"
  - id: CR-4
    checklist: C2
    severity: low
    location: "src/main/exitConfirmation.ts:485-487 (markQuitting) ↔ src/main/updateInstallDecision.ts:42-45 (prepareToQuitAndInstall→quitAndInstall)"
    issue: "确认安装时先 prepareToQuitAndInstall()(markQuitting，isQuittingConfirmed=true)再 quitAndInstall()。若 quitAndInstall() 在生产里静默失败/抛错(catch→fallbackToReleasePage)，isQuittingConfirmed 仍永久为 true。"
    rationale: "isQuittingConfirmed 无重置点，一旦锁死，本会话后续所有 close/before-quit 都走早退分支(不再弹确认)。属降级而非阻塞(关闭/退出仍可用，只是丢失确认能力)，但与设计意图不符。"
    suggestion: "quitAndInstall 失败兜底(fallbackToReleasePage)时一并复位 isQuittingConfirmed；或在 quitAndInstall 之后短延时确认未退出再回滚标记。"
  - id: CR-5
    checklist: C6
    severity: low
    location: "src/main/exitConfirmation.ts:493-521 (handleWindowClose / handleAppBeforeQuit 取消分支)"
    issue: "lifecycle controller 在用户取消 close/quit 时无任何日志；updater 决策函数日志完善，但 close/quit 路径静默。"
    rationale: "线上若出现“App 关不掉/退出无反应/确认框没出来”的反馈，缺少可定位日志(是被 busy 锁挡、被 isQuittingConfirmed 早退、还是 bypass)，排障困难。"
    suggestion: "在 confirmExit 结果为 canceled/busy、以及 isQuittingConfirmed/bypass 早退分支补一条 debug 日志(含 kind)。"
  - id: CR-6
    checklist: C5
    severity: info
    location: "docs/.../TECH.md:211 (T-004 名) + src/main/__tests__/*"
    issue: "TC T-004 名 updater_downloaded_update_confirm_broadcasts_restarting_and_quits 与实现的 ..._and_bypasses_quit_dialog 不一致；main.ts 集成接线(coordinator showMessageBox、powerMonitor 注册、before-quit 注册)无测试覆盖。"
    rationale: "纯函数/组件单测完备，但 CR-1(pre-ready 顺序)与 CR-2(OS 退出)正落在未被测试覆盖的 main.ts wiring 层，使这类回归无自动化护栏。"
    suggestion: "对齐 TC 名称；对 main wiring 增加一条最小集成测试或显式手测清单项(尤其 OS 注销/关机与 pre-ready 启动)。"
findings_summary:
  blocker: 0
  high: 3
  low: 2
  info: 1
  total: 6
---
```

# 详情

整体实现质量较高：`exitConfirmation.ts` / `updateInstallDecision.ts` 做了干净的纯函数化与依赖注入，确认锁的 `confirmed | canceled | busy` 三态区分、`WeakSet` 绑定 per-window 放行、`installingVersion` 快照都到位，单测覆盖了取消/确认/锁忙/退出中绕过等关键路径，与 TECH.md 设计一致。

异质视角下最值得主对话与用户决策的三处盲区：

1. **CR-1（启动顺序）** — `powerMonitor.on` 在 `app.ready` 之前注册，违反 Electron 文档契约，是潜在启动崩溃/升级回归点；修复成本极低（移入 ready），收益明确，建议优先处理。
2. **CR-2（OS 退出回归）** — 新增的 `before-quit` 确认会拦截 macOS 注销/关机，这是本 Feature 引入的行为回归，`powerMonitor.shutdown` 的覆盖面与触发顺序都不足以兜住，建议补来源判断 + 对应验收项。
3. **CR-3（稍后→重试 闭环未验证）** — 取消分支清理本地 artifacts 但 Squirrel 已 staged，重试路径与 Squirrel.Mac 的真实交互纯函数测试触及不到，而这正是本 Feature 的核心价值路径，强烈建议在打包构建端到端实测。

CR-4/CR-5/CR-6 为加固项与可观测性/测试缺口，可酌情处理。

Out of scope reminder: 我仅描述问题，不改代码、不落文件、不跑测试。
