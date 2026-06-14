---
reviewers: [architect, qa, external]
verdict: NEEDS_REVISION
stage: review
feature_id: TERMPRO-B260614065346-Notification-Badge-Count-Decrement
target_commit: de1de39
base: origin/main
external_review_files:
  - external-cross-review/review-codex.md
---

# REVIEW · 通知角标递减修复 · 代码评审整合

三视角独立评审:**Architect(opus)** + **QA(opus)** + **External(codex 异质模型)**。
细节见 `REVIEW-arch.md` / `REVIEW-qa.md` / `external-cross-review/review-codex.md`。

## Round 1 · verdict = NEEDS_REVISION

| 视角 | 结论 | 关键 finding |
|------|------|------|
| Architect (opus) | APPROVE | 正确性/不可变/红线/性能/UUID 全 reject(无问题);P3 指出"setActiveTab 之外仍有查看入口残留 drift" |
| QA (opus) | APPROVE | 修复正确无回归;5 条附加测试缺口(P2/P3) |
| **External (codex)** | **NEEDS_REVISION** | **medium:`setActiveWorkspace` 绕过新增清理路径,角标对目标工作区 active tab 残留** |

### 整合判定:NEEDS_REVISION
External 异质评审独立锁定一个**确为真**的同类缺陷(architect 的 P3-A7 是其模糊形态),初版 fix 漏掉。**采纳 → 修复**。

### 逐条 finding 处置(默认姿态=质疑 · 两向均给实证)

**EXT-1【medium · CONFIRMED · ADOPTED】** `store.ts:271` setActiveWorkspace 残留
- 质疑→回读真实代码确认:`setActiveWorkspace`(store.ts:202)仅 `set({activeWorkspaceId:id})`;`isCurrentTab`(sessionEvents.ts:54-55)= active 工作区 **且** active tab,故后台工作区的 active tab **会**累计通知;点工作区行(Sidebar.tsx:260)→ setActiveWorkspace → 该 tab 可见却不清 → 角标残留。**确为真**(同 bug 类、不同入口)。
- 修复:抽 `markTabViewed(workspaceId, tabId)` helper(清源 B + 按 tabId 标源 A),`setActiveTab` 与 `setActiveWorkspace` 共用。为何这样改对:统一所有"使 tab 可见 = 查看"入口,杜绝同类不对称复发。

**QA-Q3/Q4/Q5【P2 · ADOPTED】** 缺 handleItemClick 流程 / 多工作区隔离 / 全部已读·清空 回归 → 已加测(5 → 11 例)。

**ARCH-A7b / QA-Q2【P3 · REJECTED(留 follow-up)】**
- window `focus`(未切 tab)不清源 A:refocus ≠ 主动查看某 tab(与 diagnose 决策一致)· 行为合理 · 非本 bug 范围。
- 通知到达当前 active tab:`sessionEvents` 对 isCurrentTab 全面抑制 push,生产不产生 · 属 sessionEvents 不变式 · 留观察。
- 实证:`clearAttention`(sessionEvents.ts:31-38)只删 `waitingNotified` latch,不动 `notifications[].read` → 无 focus 误清。

**ARCH-A1~A6 / QA-Q1,Q6~Q8【REJECTED】** 均回读真实代码给实证(详分视角文件):zustand 顶层合并正确 / 不可变到位 / 红线合规 / tabId 全局唯一 / 不持久化 / 性能可忽略 / 测试隔离干净 / 源 B 无回归。

## Round 2 · verdict = APPROVE(见下方更新)

修复 commit:`56c99d5`(markTabViewed helper + setActiveWorkspace 对齐 + 回归测试 11 例)。
re-verify:tsc ✅ · vitest 154/154 ✅ · 冒烟 SMOKE_OK ✅。
