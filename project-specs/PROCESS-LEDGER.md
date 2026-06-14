# 流程价值台账

> 一行一 feature 的 teamwork **流程仪式价值**数据 · 给「该不该砍某环节」提供查表依据。
> 消费方:流程审视 + 年检 kill criteria(详 `~/.claude/skills/teamwork/stages/ship-stage.md §16`)。
> 🔴 区别 `docs/retros/`(业务/工程复盘);本表只度量 teamwork 流程本身。单元格 ≤1 行 · 机器字段照实抄不美化。
> 查询示例:external confirmed 率 = Σ采/Σ总;暂停点 all-default 率 = Σ默/Σ(改+默)。

| Feature | flow | 实走 stages | 时长 | review/test 轮 | external 总/采/驳 | 角色真 finding | 暂停点 改:默 | bypass/WARN | 反思摘要(≤1 行) |
|---|---|---|---|---|---|---|---|---|---|
| TERMPRO-F260613041948-quiet-notify | 敏捷 | goal→blueprint_lite→dev→review→test→pm_acceptance→ship | ~0.8h | 1/1 | 0/0/0(运行1次·0 finding) | PRD评审 arch7+qa8(驱动 v0.2);code arch-adv+qa2(P2) ext0 | 1:2 | 0/0 | 评审证伪初稿时间差判据(ARCH-1)→ 同源时间戳比较;external 此类小改 0 finding |
| TERMPRO-F260613053134-Terminal-Path-FilePanel | Feature | goal→ui_design→panorama_sync→blueprint→dev→review→test→pm_acceptance→ship | ~5.5h | 2/1 | 52/48/4(defer) | PL1; blueprint ext46; code arch3+qa1+ext3 | 0:4 | 0/0 | external 连续压出 Root/WorkTree 优先级、事务定位、case/symlink/DOM gap;DOM 留 browser/manual |
| TERMPRO-F260613150158-Settings-About-Entry | Feature | goal→ui_design→panorama_sync→blueprint→dev→review→test→pm_acceptance→ship | ~2.5h | 1/1 | 6/6/0(blueprint4+review2) | PRD qa9+arch5+pl5→v0.2; BP arch(ARCH2)+qa7+ext4; code arch(tooltip回归)+qa2+ext(lint真违规) | 1:6 | 0/0 | external 抓 AC-5 注入侧测试盲区(CR-1 high)+ lint 真违规;code review 抓 DEV tooltip 回归;PL 质疑收敛为「脚手架」前提;首次引入 jsdom 组件测试 harness |
| TERMPRO-B260614065346-Notification-Badge-Count-Decrement | Bug | diagnose→dev→review→test→pm_acceptance→ship | ~0.6h | 2/1 | 1/1/0 | arch0真(全reject); qa0真(均测试缺口·采3); ext1真(medium) | 1:2 | 0/0 | external 独家锁定 setActiveWorkspace 同类入口(opus 双评审仅模糊提及)· 异质评审直接拦下复发缺陷 |
