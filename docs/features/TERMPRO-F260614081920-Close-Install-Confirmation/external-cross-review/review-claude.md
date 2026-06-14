---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: review
target_commit: 0be91c1
target_base: d42ccee
title: "TERMPRO-F260614081920-Close-Install-Confirmation · review stage external review"
generated_at: "2026-06-14T10:03:18Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
REVIEW-ACK review-claude-20260614T095712Z

```yaml
---
perspective: external-claude
target: code
generated_at: "2026-06-14T10:06:30Z"
files_read:
  - src/main/exitConfirmation.ts
  - src/main/updateInstallDecision.ts
  - src/main/updater.ts
  - src/main/main.ts
  - src/main/appStore.ts
  - src/main/__tests__/exitConfirmation.test.ts
  - src/main/__tests__/updaterInstallConfirmation.test.ts
  - src/renderer/components/Sidebar.tsx
  - src/renderer/components/__tests__/SidebarUpdatePill.test.tsx
  - src/renderer/state/__tests__/notificationBadge.test.ts
  - src/preload/preload.ts
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TECH.md
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TC.md
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/PRD.md
  - project-specs/KNOWLEDGE.md
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C3
    severity: high
    location: "src/main/exitConfirmation.ts:171-184 (handleAppBeforeQuit) + src/main/main.ts:80-82"
    issue: "before-quit 处理器无条件 preventDefault() 并弹确认,但 before-quit 不仅由用户 Cmd+Q 触发——macOS 系统重启/注销/关机同样发 before-quit。该路径会用模态 dialog 阻断系统关机/注销。"
    rationale: "PRD 仅把范围限定在『用户通过 App Quit/Cmd+Q』(PRD AC-2),但代码对所有 before-quit 来源一视同仁;系统关机时弹模态会让 macOS 报『TermPro 阻止了关机』,且无任何测试或 PRD 条款覆盖非用户发起的 quit。"
    suggestion: "区分用户发起与系统发起的退出(例如监听 powerMonitor 'shutdown'/'suspend' 或在系统关机窗口内临时 allowNextQuitWithoutConfirmation),系统关机/注销时放行 quit 不弹确认;并在 TC 补一条对应边界用例。"
  - id: CR-2
    checklist: C3
    severity: low
    location: "src/main/exitConfirmation.ts:133-136 (confirmWhenIdle) + src/main/updateInstallDecision.ts:24-40"
    issue: "安装确认走 confirmWhenIdle,但其在显示 dialog 前不检查 isQuittingConfirmed。若 update-downloaded 恰在关闭/退出确认显示时触发,而用户随后『确认退出』(app.quit + isQuittingConfirmed=true),install 的 waitUntilIdle 会在退出确认释放后继续弹出安装 dialog,并在 app.quit() 拆除进程的同时调用 quitAndInstall()。"
    rationale: "lifecycle controller 的 isQuittingConfirmed 只放行 close/quit,coordinator 与 install 决策对其无感知;两条退出路径(app.quit 与 quitAndInstall)可能并发,且会在退出过程中弹出已无意义的安装确认。"
    suggestion: "让 coordinator/confirmWhenIdle 感知『正在退出』状态(注入一个 isQuitting() 判定),退出已确认时安装确认直接返回 canceled/short-circuit,不再显示 dialog、不再 quitAndInstall。"
  - id: CR-3
    checklist: C2
    severity: low
    location: "src/main/updater.ts:332-357 (update-downloaded) + 362-366 (error) + src/main/updateInstallDecision.ts:24-40"
    issue: "handleDownloadedUpdateForInstall 起手即 clearWatchdog 并 await 用户确认,期间 installing 仍为 true。若此窗口内 autoUpdater 'error'/'update-not-available' 触发,fallbackToReleasePage 会清产物、installing=false、broadcast error、打开发布页;而用户随后点『安装并重启』时,决策函数不重新校验 installing/aborted,仍会 broadcast restarting 并 quitAndInstall。"
    rationale: "决策函数与 updater 全局状态解耦后,二者对『是否仍在安装』的判断会分叉;确认等待期是一个无 watchdog 且 installing=true 的活动窗口,error 与用户确认可竞态产生 restarting 覆盖 error、对已清理产物执行 quitAndInstall。"
    suggestion: "向 handleDownloadedUpdateForInstall 注入 isStillInstalling()/isAborted() 判定,确认返回后先复检;若期间已 fallback 则不再 broadcast restarting / quitAndInstall。"
  - id: CR-4
    checklist: C5
    severity: low
    location: "src/main/main.ts:62-92, 426-449 (wiring) vs 所有现有单测"
    issue: "全部自动化测试(T-001..T-010)只覆盖隔离的 helper(exitConfirmation/updateInstallDecision/UpdatePill),main.ts 里的接线无任何覆盖:before-quit 监听注册、confirmInstallWhenIdle→confirmWhenIdle 的映射(而非误用即时 confirm)、menu Close Window(role:'close')经 close 事件、window-all-closed 的 allowNextQuitWithoutConfirmation。"
    rationale: "本 Feature 的核心风险(TECH 自述为 lifecycle 防重入与取消恢复)恰在接线层;helper 全绿但 main.ts 若误接(如把 install 接成即时 confirm)单测无法发现,且 Browser/E2E 已跳过。"
    suggestion: "至少补一条对 main wiring 的轻量验证(可对 createExitConfirmationCoordinator/initUpdater 注入点做契约测试,或在 review-log/TC 记录已手工冒烟验证的具体路径与结论),避免接线回归静默通过。"
  - id: CR-5
    checklist: C1
    severity: low
    location: "src/main/exitConfirmation.ts:152-154 (allowNextQuitWithoutConfirmation) + 140-142 (isQuittingConfirmed)"
    issue: "方法名 allowNextQuitWithoutConfirmation 暗示一次性放行,但实现是把 isQuittingConfirmed 永久置 true 且永不复位;此后所有 close/quit 确认被永久绕过。"
    rationale: "当前三处调用方(install 确认、app-quit 确认、window-all-closed)调用后应用都在终止,故无活线 bug;但命名与语义不符,未来若有非终止场景(如程序化 quit 又取消)按字面调用会静默关掉所有确认。"
    suggestion: "改名为反映永久语义(如 markQuitting()),或真正实现 one-shot(放行一次后复位 isQuittingConfirmed)。"
  - id: CR-6
    checklist: C2
    severity: info
    location: "src/main/updateInstallDecision.ts:25-27 (while busy 重试循环)"
    issue: "while (result.status === 'busy') 无退避、无次数上限,正确性依赖注入的 confirmInstallWhenIdle 必为 confirmWhenIdle(其内部 waitUntilIdle 自节流)。"
    rationale: "现行接线安全,但该不变量是隐式的;若未来误接为即时 confirm(其在锁忙时立即返回 busy),此循环将退化为紧致无限自旋。"
    suggestion: "加注释固化『必须传 idle-waiting 变体』的不变量,或加入有界重试/微小退避作为防御。"
  - id: CR-7
    checklist: C6
    severity: info
    location: "src/main/exitConfirmation.ts:102-108 (waitUntilIdle) + src/main/updateInstallDecision.ts:20-27"
    issue: "安装确认在锁忙等待(被关闭/退出确认阻塞)期间无任何日志;仅在 postponed/confirmed 终态打印。"
    rationale: "若安装确认长时间卡在 waitUntilIdle 或反复 busy 重试,线上(TERMPRO_DEBUG)无诊断信息可定位『为什么升级胶囊迟迟不弹确认』。"
    suggestion: "在进入等待/每次 busy 重试时补一条 debug 级日志(含 version),便于定位锁竞争。"
findings_summary:
  blocker: 0
  high: 1
  low: 4
  info: 2
  total: 7
---
```

# 详情（人读补充）

## 总体评价

实现与 TECH 高度一致:三类确认文案、`confirmed|canceled|busy` 三态锁、`confirmWhenIdle` 等待式安装确认、取消恢复(clearWatchdog / cleanupInstallArtifacts / installing 复位 / 广播同版本 available)、`installingVersion` 版本快照、`WeakSet` 绑定 per-window 放行、smoke bypass——均按方案落地,AC-1..AC-8 都有对应单测,preload 契约无漂移,KNOWLEDGE 约束(GO-003 smoke 经 main 进程 env、GO-017 store 测试 mock terminalRegistry、PR-001 不替用户安装)均被遵守。`appStore` 的 before-quit 刷盘(`appStore.ts:45`)在被 preventDefault 的首次 quit 上也会执行,反而保证了取消退出时状态不丢——已验证非缺陷。

## 重点关注

- **CR-1 是最值得主对话决策的一条**:`before-quit` 是系统关机/注销的共用入口,无条件弹模态确认会影响 OS 关机流程,而 PRD 把范围限定在用户主动退出——这是范围与代码的实质偏差,建议用户决策是否要区分系统发起的退出。
- **CR-2 / CR-3** 是 updater↔lifecycle 交界处的并发边界(正是 TECH 自评的主风险区):概率低但状态后果明确(退出期弹安装框 / error 与 restarting 竞态)。建议给安装决策注入 `isQuitting()` / `isStillInstalling()` 复检。
- **CR-4** 提示纯函数化带来的覆盖盲区:helper 全绿不等于接线正确,建议至少留下接线层的契约测试或手工冒烟记录。

(findings 非空,无系统性 blocker;CR-1 建议主对话与用户确认系统退出场景的取舍。)
