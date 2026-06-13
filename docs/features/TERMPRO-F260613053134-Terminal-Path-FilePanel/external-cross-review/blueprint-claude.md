---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: blueprint
target_commit: 40bf4239a2ff9148cfb8c9e0b9757447d0df8765
target_base: main
title: "TERMPRO-F260613053134-Terminal-Path-FilePanel · blueprint stage external review"
generated_at: "2026-06-13T06:51:49Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
I've grounded my review against the actual reducer (`core.ts`) and controller (`controller.ts`) the plan modifies. Producing the review record now.

---

REVIEW-ACK blueprint-claude-20260613T064557Z

```yaml
---
perspective: external-claude
target: blueprint
generated_at: "2026-06-13T06:50:00Z"
files_read:
  - docs/features/TERMPRO-F260613053134-Terminal-Path-FilePanel/TC.md
  - docs/features/TERMPRO-F260613053134-Terminal-Path-FilePanel/TECH.md
  - src/renderer/filepanel/core.ts
  - src/renderer/filepanel/controller.ts
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C3
    severity: high
    location: "TECH.md §Last-click-wins / §Locate commit transaction #1; core.ts:373-399 (pollTick), 336-371 (resolveDone→applyRootChange)"
    issue: "locate 的 stale 触发集只列了 new-request / refresh / tab-switch / user-toggle，遗漏了 controller 自主的 cwd 漂移路径：2 秒 pollTick 与 resolveDone 会经 applyRootChange 重置树并改 effectiveRoot/generation。locateCommit 的过期闸只比对 targetId === activeLocateRequestId，不比对 generation/effectiveRoot。"
    rationale: "深层路径 locate 是串行 readdir RPC，期间一次后台 `cd`（poll 命中）会 bump generation 并 applyRootChange 重建新根的树；随后 locateTarget 仍以旧快照 dispatch locateCommit，targetId 未被任何人清掉 → 闸通过 → 强行把面板拉回 locate 目标并丢弃刚解析的新 git 根。TC 无任何 poll/cwd-drift 并发用例。"
    suggestion: "locateTarget 起始捕获 generation，locateCommit 增加 `gen === activeLocateGen`（或 effectiveRoot 一致性）双闸；并补一条 integration TC：locate 串行加载途中 pollTick/resolveDone 改根 → locate 丢弃、不回写、不残留 highlight。"
  - id: CR-2
    checklist: C2
    severity: high
    location: "TECH.md §数据结构 FilePanel locate view state（locateScrollPath 备注「scrollIntoView 后清理或保留同 highlight」）；TC.md T-019 / T-024"
    issue: "scroll 生命周期写成「清理或保留」二选一未定，且 T-019/T-024 只断言 scrollIntoView 被调用一次，未断言不在后续无关 re-render 上重复触发。"
    rationale: "FilePanel 经 useSyncExternalStore 订阅 controller，watcher debounce(250ms)→refresh→childDone/topDone/statusDone 每次都改 state 触发 re-render（controller.ts:129-133, 46-54）。若 locateScrollPath 持久且渲染时见非空即 scrollIntoView，highlight 存活期间每次 fs 活动都会把视口猛拉回目标，劫持用户滚动。"
    suggestion: "把 scroll 明确为 one-shot（首次滚动后清 locateScrollPath，或用 last-scrolled-id ref 守卫），highlight 与 scroll 解耦；新增 TC：highlight 仍在时一次 watcher 驱动 re-render 不得再次调用 scrollIntoView。"
  - id: CR-3
    checklist: C6
    severity: low
    location: "TECH.md §Locate commit transaction #1-#2；core.ts:245-257（过期闸 2）"
    issue: "locateCommit 是故意改 effectiveRoot 的跨 mode 事件，但现有 reducer 全局过期闸 2 会丢弃任何 `ev.root !== state.effectiveRoot` 的带 root 事件。TECH 的过期闸描述未把新事件纳入考量。"
    rationale: "cross-mode 场景下 locateCommit 携带的新根天然 !== 当前 effectiveRoot；若实现时让它走 payload 的 root/effectiveRoot 字段又未显式豁免闸 2，会在恰好是本 feature 目标的跨 mode 路径上被静默丢弃。"
    suggestion: "在 TECH 与实现里显式标注 locateCommit 绕过 root-equality 闸、仅由 targetId(+gen) 守卫，并在 reduce 入口顺序上把它排在闸 2 之前。"
  - id: CR-4
    checklist: C1
    severity: low
    location: "TC.md §UI 还原检查（Terminal link: Accent color + underline）vs §需求覆盖矩阵 AC-1..AC-10"
    issue: "终端链接视觉（accent 色 + 下划线、无 agent 专属装饰）只出现在手工 UI 还原表，AC 矩阵无对应可验证条目，也无自动/手工 TC 锁定。"
    rationale: "若它属于验收要求，则缺一条可测 AC；当前仅靠人眼勾选，回归时易漂移（例如未来给 agent 输出加专属装饰）。"
    suggestion: "要么补一条 AC + 组件级 TC 断言 link 行的样式 class，要么在 TC 中明确标注为纯手工还原项并写入 E2E 手工清单。"
  - id: CR-5
    checklist: C5
    severity: low
    location: "TECH.md §Path segment matching #2（用 canonicalDisplayPath 分解 relative segments）"
    issue: "canonicalDisplayPath = displayRoot + (targetRealpath 相对 rootRealpath)。当 root 内存在「不逃逸」的中间 symlink（指向仍在 root 下的另一处）时，realpath 段与显示树段不同。"
    rationale: "例如 `/repo/link`→`/repo/real`，点击文本是 `/repo/link/file.ts`，realpath 映射出 `/repo/real/file.ts`；定位会在 `real` 下展开高亮，而非用户点击的 `link` 路径，定位行与链接文本不一致（功能找到同一文件但显示位置错位）。"
    suggestion: "明确该分支的期望行为（按显示段定位 vs 按真实段定位），并补一条 TC 锁定；若按显示段，则 realpath 仅作 trust 门、段分解仍用 display path。"
  - id: CR-6
    checklist: C4
    severity: info
    location: "TECH.md §Locate commit transaction #5-#6（post-commit inputs echo 显式 guard）；core.ts:274-283（全等短路）"
    issue: "TECH 新增的 post-commit inputs 回灌显式 guard，在 locateCommit 已更新 state.inputs.mode 的前提下，与现有 inputs 全等短路（line 275-282 比对 tabId/mode/rootPath/worktreePath/fallbackCwd）功能重叠。"
    rationale: "只要 locateCommit 真正写回 inputs.mode 且不动 binding，store 回灌的 {mode:'worktree', 同 binding} 会在 line 275 全等短路返回，永不到达 applyRootChange；再加一条语义略异的 guard 反而增加两处判定漂移的风险。"
    suggestion: "评估是否复用既有全等短路而非新增 guard；若保留新 guard，确保其判定条件与 line 275 一致，避免双守卫语义分叉。"
findings_summary:
  blocker: 0
  high: 2
  low: 3
  info: 1
  total: 6
---
```

# 详情（人读补充）

蓝图已历五轮外评，TC↔AC 映射完整（AC-1..AC-10 全覆盖且无单测 AC，非成功路径占比充足），事务式 `locateCommit`、runtime-only locate view、terminal-owned fallback、realpath trust 门等核心设计自洽。以下为本轮异质视角采到的剩余盲区，按信号强度排序：

**CR-1 / CR-2 是两处真实的、当前 TC 未覆盖的运行期缺陷**，建议作为进入实现前补齐的项：

- **CR-1（并发·根漂移）**：`controller.ts` 的 2s `pollTick` 与 `resolveDone` 会经 `applyRootChange`（`core.ts:195-232`）自主重置树并改 `effectiveRoot`/`generation`。这条自主路径不在 TECH 列举的 stale 触发集内，而 `locateCommit` 仅以 `targetId` 守卫——深路径串行 readdir 期间一次后台 `cd` 即可让旧 locate 覆盖刚解析的新根。把 locate 失效绑定到 `generation`（起始捕获、提交校验）可一并解决。

- **CR-2（UX·滚动重触发）**：FilePanel 经 `useSyncExternalStore` 在每次 `childDone/topDone/statusDone`（`controller.ts:129-133`）re-render，watcher 每 250ms 可触发一轮。`locateScrollPath` 若持久且渲染即滚动，会在 highlight 存活期反复 `scrollIntoView` 劫持视口。需把 scroll 明确为 one-shot 并补回归测试。

**CR-3** 是实现陷阱提示：现有 reduce 的过期闸 2（`core.ts:245-257`）会吞掉一切 `root !== effectiveRoot` 的带 root 事件，而跨 mode `locateCommit` 恰恰要改根；需显式豁免与排序，否则在目标场景静默失效。

**CR-4 / CR-5 / CR-6** 为低/信息级：分别是链接样式缺可测 AC、intra-root symlink 下定位行与点击文本错位的边界、以及与既有全等短路重叠的冗余 guard。可在实现中顺手收口，不阻塞蓝图通过。

无 blocker。findings 非空，且 CR-1/CR-2 建议主对话据此回写 TC/TECH 后再进实现。
