# REVIEW-arch · 架构视角(opus 子代理)

**目标 commit**:de1de39(初版 fix:setActiveTab 标记通知已读)
**base**:origin/main

## 结论:APPROVE

修复正确、不可变更新到位、遵守架构红线、位于正确的"查看 tab"收口、测试充分。

## findings

| # | 级别 | 位置 | 内容 | 判定 |
|---|------|------|------|------|
| A1 | P1 | store.ts setActiveTab | zustand `set` 返回的 `notifications` 是否在正确的顶层(非嵌套进 workspace) | **rejected**(已验证正确):`notifications` 与 `workspaces` 同为返回对象字面量的顶层 key,zustand 浅合并到 root,其它 root key 不受影响 |
| A2 | P2 | store.ts | 不可变性 | **rejected**:`map` 返新数组,命中项 `{...n, read:true}` 新对象,`&& !n.read` 守卫保持已读项引用稳定;与 `markNotificationRead` 既有模式一致 |
| A3 | P1 | 全局 | 架构红线(UI 不碰 fs/PTY/git · host 零 Electron import) | **rejected**:纯 renderer zustand state,无 hostClient/fs 调用,host 未动 · 合规 |
| A4 | P2 | tabId 匹配 | 跨工作区 tabId 匹配安全性 | **rejected**:`tabId`=`crypto.randomUUID()` 全局唯一;与 `clearTabAttention`/`updateTab` 既有按 tabId 匹配惯例一致 |
| A5 | P2 | persistence | `notifications` 是否进持久化 | **rejected**:不在 `PersistedState`/`serialize()`,`read` 仅内存态 · 无持久化影响 |
| A6 | NIT | 性能 | 每次激活 map notifications | **rejected**:`notifications` 上限 50 条,可忽略 |
| **A7** | **P3** | sessionEvents.ts:31-38 / setActiveWorkspace | **残留 源A/源B drift**:仍有"查看"入口不经 setActiveTab | **confirmed**(见下) |
| A8 | NIT | 设计 | 双 read 状态(源 A/B)本身是 root smell | confirmed(设计层 · 非本 bug 阻塞) |

### A7 说明(关键)
架构师指出 setActiveTab 之外仍存在使 tab 可见却不清源 A 的路径(window refocus / 工作区切换)。
→ **该方向被 external 评审独立锁定为具体的 `setActiveWorkspace` 入口(medium · 见 REVIEW.md 整合),已在 review 阶段修复**。
→ window `focus`(未切 tab)不清源 A:refocus ≠ 主动查看某 tab,与 diagnose 决策一致,判定行为合理 · 留观察(follow-up · 非本 bug 范围)。
