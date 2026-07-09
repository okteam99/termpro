# 待规划需求池(PENDING)

> 跨 Feature/session 的"范围外但要做"项 · 等用户拍板启动 · 只留 active(📝/🔄)· 转化即从表删。

| ID | 标题 | 来源 | 目标项目 | 背景(1-3 句) | 状态 | 加入日期 |
|---|---|---|---|---|---|---|
| PENDING-001 | 迁移边界健壮性组(BL-001 F4/F8) | BL-001 review defer | TERMPRO | 部分迁移+fallback 删除+重试的已删复活;畸形 v1 存档(非数组/单条坏条目)致 hydrate 崩溃或永卡 v1 无诊断。低概率窄触发,一组做:数组守卫+单条容错跳过+坏条目上报 | 📝 | 2026-07-10 |
| PENDING-002 | Workspace 注册表周边小项组(BL-001 F6/F9/F10/F11/F13) | BL-001 review defer | TERMPRO | 备份内容断言缺失;remove/update no-op 仍广播(churn);service 边界 params 运行时校验(BL-004 远程面);viewer 广播冗余;注册表重试耗尽提示措辞。均 MINOR/NIT,BL-004 开工前顺路清 | 📝 | 2026-07-10 |
