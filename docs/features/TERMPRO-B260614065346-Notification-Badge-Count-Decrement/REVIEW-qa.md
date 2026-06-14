# REVIEW-qa · QA 视角(opus 子代理)

**目标 commit**:de1de39(初版 fix)
**base**:origin/main

## 结论:APPROVE

根因修复正确、对相邻功能无回归、无误清向量(refocus / 当前 tab 路径均已验证安全);新增测试准确,缺口均为附加覆盖(P2/P3),无阻塞。

## findings(均为测试覆盖缺口 · 行为已验证正确)

| # | 级别 | 内容 | 判定 / 处置 |
|---|------|------|------|
| Q1 | P2 | 测试用 helper 复刻 `Sidebar.tsx:120` 选择器,非直接走生产组件 | rejected as bug(store 单测合理)· 已在测试注释锚定 Sidebar 选择器即契约 |
| Q2 | P2 | 缺:通知到达**当前 active tab** 的用例 | confirmed test gap;**已评估**:`sessionEvents` 对 `isCurrentTab` 全面抑制 push(:75/:104/:120 + quietGate:70)→ 生产不产生;属 sessionEvents 不变式,留 follow-up(本 store 测试不强测) |
| **Q3** | **P2** | 缺:NotificationCenter.handleItemClick 流程 | **adopted** → 已加"点击通知条流程"用例(markNotificationRead+setActiveTab+clearTabAttention → 该 tab 全清) |
| **Q4** | **P2** | 缺:多工作区隔离 | **adopted** → 已加多工作区 seed + 隔离用例 |
| **Q5** | **P2** | 缺:"全部已读"/"清空" 回归 | **adopted** → 已加两条按钮回归用例(角标归零 / 列表清空) |
| Q6 | P3 | 测试隔离:`beforeEach(seed)` 用 setState 全覆盖三个 key,其余字段不重置 | rejected:被测逻辑不读其余字段,无泄漏;`vi.mock(terminalRegistry)` 正确切断 @xterm 链 |
| Q7 | P3 | window focus 误清(false clear) | rejected:`clearAttention` 只删 `waitingNotified` latch,不动 `notifications[].read`,无 focus 误清 |
| Q8 | P3 | 相邻功能(状态点/attention pill/Dock 角标)回归 | rejected:源 B 清除逻辑字节级未变;已加"源 B 不回归"断言 |

## 采纳汇总
Q3 / Q4 / Q5 已采纳并加测(测试从 5 → 11 例)。Q2 评估为 sessionEvents 不变式 · 留 follow-up。其余 reject 均有实证。
