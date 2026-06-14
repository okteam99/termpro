# TEST-REPORT · TERMPRO-B260614065346 · 通知角标递减

## 结论:✅ PASS

复现 bug 的关键路径修复后转绿,既有套件保持全绿,无回归。

## 复现用例 → 修复后结果

| 路径 | 触发 bug 的关键路径 | 修复前 | 修复后 |
|------|------|--------|--------|
| A 切 tab | 后台 tab 出通知 → 切到该 tab | 角标不减(bug) | ✅ 角标 −1 + 通知标已读 |
| B 切工作区 | 后台工作区 active tab 出通知 → 切到该工作区 | 角标不减(external 补出) | ✅ 角标 −1 + 注意力清除 |
| C 既有路径 | 全部已读 / 清空 / 点击通知条 | 正常 | ✅ 不回归 |

复现路径详见 `e2e/notification-badge-decrement.repro.md`(语言无关 · A/B/C 三路径 + 边界)。

## 自动化套件结果

- **regression(直驱 store · 等价 UI action 调用)**:`src/renderer/state/__tests__/notificationBadge.test.ts` · **11 例全绿**
  - 覆盖:切 tab 递减 / 多 tab 只减对应 / 同 tab 多条全清 / 源 B 不回归 / 幂等不为负 / 切工作区递减 / 多工作区隔离 / 全部已读 / 清空 / 点击通知条流程。
- **既有全量套件**:`npx vitest run` → **16 files · 154 tests 全绿** · exit 0(日志 `test-stdout.log`)。
- **类型**:`tsc --noEmit` ✅。
- **无头冒烟**:`TERMPRO_SMOKE=1 npx electron-forge start` → **SMOKE_OK**(同一 src 树 · review fix 后已验)。

## 关联
- 规格依据:`bugfix/BUG-TERMPRO-B260614065346-001.md` §回归测试(Bug 无 PRD/TC · verify-ac N/A)。
- 评审:`REVIEW.md`(arch/qa APPROVE · external medium 已修)。

## 周边回归
- 源 B(`waiting/unseenDone`)清除逻辑字节级未变 → tab 状态点 / 工作区 attention pill / Dock 角标不受影响(已加断言)。
- `markAllNotificationsRead` / `clearNotifications` / `markNotificationRead` 未改 → 🔔 面板既有交互正常(已加回归用例)。
