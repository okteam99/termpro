---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: blueprint
target_commit: 04e6edee50d8c220cdde59603ae4bad46d9fd50d
target_base: main
title: "TERMPRO-F260614081920-Close-Install-Confirmation · blueprint stage external review"
generated_at: "2026-06-14T09:40:38Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
REVIEW-ACK blueprint-claude-20260614T093745Z

---
perspective: external-claude
target: blueprint
generated_at: "2026-06-14T09:37:45Z"
files_read:
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TC.md
  - docs/features/TERMPRO-F260614081920-Close-Install-Confirmation/TECH.md
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C5
    severity: high
    location: "TECH.md 关键边界 / 实现思路（handleWindowClose + handleAppBeforeQuit lifecycle controller）"
    issue: "App Quit 确认与主窗口 close 确认各自独立拦截，但方案未描述 quit 流程内部触发 mainWin.close() 时让 close handler 放行的 isQuitting 守卫。"
    rationale: "Electron 中 app.quit() 会向每个窗口派发 close 事件；若 handleWindowClose 仍 preventDefault 并弹确认，将出现二次弹窗或退出卡死，实质破坏 AC-2。这是 Electron 关闭/退出共存的经典 footgun，方案中的 per-action allow flag 未覆盖该跨 handler 串扰。"
    suggestion: "在 lifecycle controller 增加全局 quitting 标记：before-quit 确认通过后置位，handleWindowClose 在 quitting=true 时直接放行原 close；并以 TC 固化此交互。"
  - id: CR-2
    checklist: C3
    severity: high
    location: "TC.md 测试场景 T-001 / T-002"
    issue: "没有任何 TC 覆盖 Cmd+Q/before-quit 确认通过后由 quit 流程引发的主窗口 close 事件只弹一次确认的交互。"
    rationale: "T-001、T-002 各自独立运行，掩盖了 close 与 quit handler 共存时的真实串扰，而这恰是本 feature 最易回归的边界（对应 CR-1 风险）。"
    suggestion: "新增 TC：before-quit 确认通过后，应用关闭主窗口不再触发 close 确认，原退出流程一次性完成且不再调用 showMessageBox。"
  - id: CR-3
    checklist: C4
    severity: high
    location: "TECH.md 实现思路/关键边界（单实例确认锁 + confirmInstall）与 TC.md T-005"
    issue: "全局确认锁让 confirmInstall 在锁占用时返回 false，与用户主动取消的 false 不可区分；updater 取消分支会清理 artifacts、复位 available，导致已下载更新在用户仅仅开着 close/quit 确认时被静默丢弃。"
    rationale: "update-downloaded 是 Squirrel.Mac 一次性事件，方案又已先清 watchdog；锁竞争下直接走取消分支会白白丢弃下载结果，且该路径行为未在任何 TC 中定义（T-005 仅说 install 动作不执行，未界定 installing/artifacts 状态归宿）。"
    suggestion: "区分『锁占用拒绝』与『用户取消』：锁忙时排队/延后 confirmInstall，或保留 installing 状态不清理 artifacts；并补 TC 明确锁忙 + install 触发时的状态归宿。"
  - id: CR-4
    checklist: C6
    severity: low
    location: "TECH.md 前端技术方案（『仅调整下载态、available title 的文本』）vs TC.md T-006"
    issue: "TECH 声明同时调整下载态与 available title 文案，但 T-006 仅断言 downloading 态文案与按钮 title，available 态标题文案无测试覆盖。"
    rationale: "AC-7 关注『不再承诺完成后自动重启』，available 态正是用户取消安装后回落的状态；未测则该文案回归无守护。"
    suggestion: "在 T-006 或新增用例中补 available 态 title 文案断言，使 TECH 声称的两处文案改动都有对应测试。"
  - id: CR-5
    checklist: C2
    severity: low
    location: "TC.md T-006 file: src/renderer/components/__tests__/SettingsEntry.test.tsx"
    issue: "被测组件是 Sidebar.tsx 内 UpdatePill，测试却落在 SettingsEntry.test.tsx，文件名与被测单元不一致。"
    rationale: "命名错位降低可追溯性，后续维护者按组件名（Sidebar/UpdatePill）检索测试会漏掉该用例。"
    suggestion: "将用例移入 Sidebar/UpdatePill 对应测试文件，或在 TC 显式说明复用 SettingsEntry 套件的原因。"
  - id: CR-6
    checklist: C6
    severity: low
    location: "TC.md T-004 / TECH.md initUpdater options（prepareToQuitAndInstall）"
    issue: "T-004 仅断言『标记 quitAndInstall 可绕过 App Quit 确认』的 flag 被置位，未端到端验证 quitAndInstall 内部触发的 before-quit 确实不弹确认。"
    rationale: "bypass 的价值在于实际跳过弹窗；仅断言 flag 置位无法防止 wiring 退化（如 flag 读取时机错位）导致安装时仍被 App Quit 确认拦截。"
    suggestion: "增补断言：确认安装后 before-quit 不调用 showMessageBox，autoUpdater.quitAndInstall 一次性放行。"
  - id: CR-7
    checklist: C3
    severity: low
    location: "TECH.md main.ts wiring（window-all-closed 非 macOS 分支）"
    issue: "非 macOS 下 window-all-closed → app.quit() 前置 bypass flag 的路径无 TC 覆盖。"
    rationale: "虽主平台为 Squirrel.Mac，但该分支改变退出行为；无测试则跨平台回归无守护，且与确认锁/allow flag 交互未验证。"
    suggestion: "补一条非 macOS bypass TC，或在 TC 中显式声明该路径不在自动化范围及原因。"
findings_summary:
  blocker: 0
  high: 3
  low: 4
  info: 0
  total: 7
---

# 详情（人读补充）

蓝图整体结构扎实：AC↔TC 映射 8/8 完整（CR 未发现悬空或越界引用），取消/失败路径占比健康（T-001/T-002/T-003/T-005 均含非成功分支，远超 30%），分层与 README §五架构红线一致，未引入新依赖。

风险集中在 **Electron lifecycle 的跨 handler 交互**，这也是本 feature 真正的难点：

1. **最该补的设计缺口（CR-1/CR-2）**：close 确认与 quit 确认被当作两条独立链路设计与测试，但 `app.quit()` 会反向触发 `mainWin.close()`。没有 `isQuitting` 串联，确认后退出会二次弹窗或卡死——独立的 T-001/T-002 正好测不出这种串扰。建议把这条交互升级为显式设计约束 + 专门 TC。

2. **锁语义二义性（CR-3）**：全局锁用同一个 `false` 同时表达『用户取消』和『锁占用拒绝』，叠加『已先清 watchdog』，会让一次已下载更新在用户碰巧开着别的确认时被静默清理。建议在 updater 侧区分这两种 false 的归宿。

3. 其余四条为测试覆盖与可追溯性的收口项（available 文案、测试文件命名、bypass 端到端、跨平台分支），不阻塞但建议补齐以避免回归裸奔。

（findings 非空，按协议交主对话裁决，不自判『通过』。）
