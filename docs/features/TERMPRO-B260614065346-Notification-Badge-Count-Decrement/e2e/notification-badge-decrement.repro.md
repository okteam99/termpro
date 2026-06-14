# E2E 复现路径 · 通知角标递减(语言无关)

> 本 bug 为 renderer zustand 状态缺陷,关键路径 = 用户"查看 tab"的状态收口(`setActiveTab` / `setActiveWorkspace`)。
> 自动化复跑 = `src/renderer/state/__tests__/notificationBadge.test.ts`(直驱 store action,等价于 UI 点击触发的 action 调用),11 例全绿。
> 真机手测路径如下(交付前可由验收人按此核对)。

## 路径 A · 切 tab(原报告路径)
1. 开 ≥2 tab。
2. 让一个**后台** tab 产生通知(命令完成 / BEL / OSC 9·777 / quiet)→ 顶部 🔔 角标 +1。
3. 点该 tab(或 ⌘1-9)。
4. ✅ 期望:顶部 🔔 角标 −1;该通知在 🔔 中心显示已读(变灰)。
   - 自动化对应:`激活有未读通知的 tab → 该 tab 通知标已读 · 角标 -1`

## 路径 B · 切工作区(external 评审补出路径)
1. 开 ≥2 工作区(A 当前激活,B 后台)。
2. 让 B 的 active tab 在后台产生通知 → 顶部 🔔 角标 +1。
3. 点侧栏工作区 B 行(`setActiveWorkspace`)。
4. ✅ 期望:B 的 active tab 随之可见 = 视作查看;顶部 🔔 角标 −1 + 该 tab 注意力标记清除。
   - 自动化对应:`后台工作区 active tab 收到通知 → 切到该工作区 → 角标 -1 + 注意力清除`

## 路径 C · 既有路径不回归
- 🔔 面板「全部已读」→ 角标归零;「清空」→ 列表清空。
- 🔔 面板点击单条通知 → 跳到对应 tab + 该 tab 通知全清。
   - 自动化对应:`通知中心既有路径不回归` describe(3 例)

## 边界
- 多工作区隔离:切 B 不误清 A 的 tab 通知。
- 计数不为负:重复激活幂等。
- window refocus(未切 tab)**不**清角标(refocus ≠ 主动查看 · 设计如此 · 见 BUG 报告"未纳入")。
