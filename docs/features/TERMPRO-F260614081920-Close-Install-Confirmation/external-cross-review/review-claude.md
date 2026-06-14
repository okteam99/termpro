---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: review
target_commit: 91731ee
target_base: d42ccee
title: "TERMPRO-F260614081920-Close-Install-Confirmation · review stage external review"
generated_at: "2026-06-14T10:39:25Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
Analysis complete. Below is my independent external review record.

```yaml
---
perspective: external-claude
target: code
generated_at: "2026-06-14T10:42:00Z"
files_read:
  - src/main/exitConfirmation.ts
  - src/main/updateInstallDecision.ts
  - src/main/updateInstallSession.ts
  - src/main/updater.ts
  - src/main/main.ts
  - src/main/__tests__/exitConfirmation.test.ts
  - src/main/__tests__/updaterInstallConfirmation.test.ts
  - src/main/__tests__/updateInstallSession.test.ts
  - src/renderer/components/Sidebar.tsx (via diff)
  - src/renderer/types.d.ts (via diff)
  - src/preload/preload.ts (via diff)
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TECH.md
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C3
    severity: low
    location: "src/main/updateInstallDecision.ts:48-56 + src/main/updater.ts:312-315 (reuse-staged confirm path)"
    issue: "reuse-staged 确认分支无条件信任 Squirrel 内部 staged 副本：先 broadcast 'restarting' + markQuitting + clearReadyToInstall，再调用 autoUpdater.quitAndInstall()。若 ShipIt 缓存已被清理/失效，quitAndInstall() 可能既不抛错也不真正重启（静默 no-op）。"
    rationale: "此时 installing 仍为 true（confirm 分支不调用 setInstalling(false)）、readyToInstallVersion 已清、isQuittingConfirmed 已置 true，但进程未退出——胶囊永久停在 '即将重启完成升级…'，且本会话后续 close/quit 确认被静默绕过，用户无重试出口。download 路径有 watchdog/STALL 兜底，唯独 reuse-staged 路径无任何 no-op 兜底。"
    suggestion: "reuse-staged 确认后加宽限超时：若 quitAndInstall() 后进程在数百毫秒内仍存活，视为 staged 失效 → resetQuitting() + setInstalling(false) + 回退 download 路径或 broadcast available/error；或将 clearReadyToInstall 推迟到确认真正重启之后，保留一次重试机会。"
  - id: CR-2
    checklist: C5
    severity: low
    location: "src/main/main.ts:62-99,355-376,453-476 (initUpdater 回调 / before-quit / window-all-closed / 菜单 Quit / role:'close' 接线)"
    issue: "全部 19 条 TC 与现有单测只覆盖纯 helper（exitConfirmation / updateInstallDecision / updateInstallSession），main.ts 的实际接线零测试。confirmInstallWhenIdle↔isQuitting 的双重 gate、confirmationParentWindow 选择、Close Window 菜单经 role:'close'→handleWindowClose 的路由、markQuitting 与 quitAndInstall 的时序，均无回归保护。"
    rationale: "本 Feature 最高风险恰在 lifecycle 接线（漏传 shouldCancel、回调顺序错、before-quit/window-all-closed 误标记 quitting 等）。这些都在 main.ts 而非被测 helper 里；'cancel→reuse-staged→confirm' 端到端链路也被拆散在两个测试文件、从未作为一条流贯穿 updater.ts 跑通。"
    suggestion: "补一个不依赖 Electron 的薄集成测：用真实 ExitLifecycleController + createExitConfirmationCoordinator 注入到 initUpdater 形态的回调中，断言 isQuitting=true 时 confirmInstallWhenIdle 返回 canceled、确认安装后 close 不二次弹窗、staged 取消后重点击同版本走 reuse-staged→confirm→quitAndInstall。"
  - id: CR-3
    checklist: C3
    severity: low
    location: "src/main/main.ts:76-78,84-92 (confirmationParentWindow 用于 install 确认)"
    issue: "安装确认父窗口固定优先 mainWin（confirmationParentWindow 先返回 mainWin 再 getFocusedWindow）。当 diffWin（modal: true，parent=mainWin）正打开时，安装确认会作为 sheet 挂到处于其模态子窗口背后的 mainWin。"
    rationale: "确认锁（active）与 modal 窗口是两套机制：confirmWhenIdle 只等 exit-dialog 空闲，不感知已打开的 modal 查看窗口。sheet 挂在被 modal 子窗口遮挡的父窗口上，在 macOS 下可能不可见/不可达，用户需先关 diff 才能处理，体验割裂。"
    suggestion: "install 确认优先选 topmost/focused 窗口为 parent（或在存在 modal 查看窗口时延后安装确认直至其关闭），避免把 sheet 钉在被模态子窗遮挡的窗口上。"
  - id: CR-4
    checklist: C6
    severity: info
    location: "src/main/updater.ts:330-335,291-323 (reuse-staged 日志) + updateInstallDecision.ts:48-56"
    issue: "reuse-staged 与首次 download 两条安装路径在确认/重启阶段共用同一组日志，无法从日志区分本次 quitAndInstall 走的是新下载还是复用 staged，也无 quitAndInstall 结果（是否真重启）的可观测信号。"
    rationale: "结合 CR-1，staged 复用是最易出现'看似成功实则未升级'的路径，却恰恰缺少能事后定位的日志；readyToInstallVersion 在 quitAndInstall 前即清，进一步抹掉了'本次消费了哪个 staged 版本'的痕迹。"
    suggestion: "在 reuse-staged 分支与 quitAndInstall 注入函数中各加一行带 version 与 path（download|reuse-staged）的日志，便于线上排查升级未生效问题。"
findings_summary:
  blocker: 0
  high: 0
  low: 3
  info: 1
  total: 4
---

# 详情

## 总体评价

实现质量较高，分层干净：`exitConfirmation.ts` / `updateInstallDecision.ts` / `updateInstallSession.ts` 全部做成无 Electron 依赖、可注入的纯逻辑，符合项目"main 可用 Electron、核心逻辑零 Electron import 便于单测"的取向。确认锁的 `confirmed | canceled | busy` 三态区分、`WeakSet` per-window 放行、`isQuittingConfirmed` 对 quit→close 串扰的封堵、quitAndInstall 同步失败的 rollback、安装版本快照（installingVersion）防 latest 漂移——这些此前 review 轮次暴露的竞态都已被针对性覆盖。happy path 与多数边界（busy 重试、isStillInstalling 失效忽略、staged 重试/版本漂移）都有对应单测。

## 未发现 blocker/high 的理由（自检）

- **二次弹窗**：confirm 即时锁 busy + isQuittingConfirmed 放行 + allowedWindowCloses 一次性放行，T-005/T-008/T-010 覆盖，逻辑闭合。
- **取消不退出/不重启**：cancel 分支不调 quitAndInstall、不 markQuitting、保留 readyToInstallVersion，setInstalling(false)+broadcast available，胶囊恢复可点，闭合。
- **cleanup 早于 quitAndInstall**：TECH §70-74 已论证 update-downloaded 后 Squirrel 已内部 staged，本地 feed/zip 不再需要，顺序正确。
- **fallback 幂等**：autoUpdater.on('error') 与 catch 均经 `!installing` gate，resetUpdateInstallSession 后二次进入早退，重复 openExternal 仅边角。

## findings 聚焦

四条均为 low/info 级的健壮性与可测性缺口，集中在两个主题：(1) **reuse-staged 路径**缺少对 Squirrel staged 副本失效的兜底与可观测性（CR-1/CR-4，CR-1 是其中最值得处理的——会留下不可恢复的 stuck 状态）；(2) **main.ts 接线**与端到端 staged-retry 链路无测试覆盖（CR-2）。CR-3 是 modal 查看窗口与安装确认父窗口选择的交互体验问题。建议主对话优先评估 CR-1 的兜底，其余按成本酌情。
```
