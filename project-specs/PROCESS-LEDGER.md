# 流程价值台账

> 一行一 feature 的 teamwork **流程仪式价值**数据 · 给「该不该砍某环节」提供查表依据。
> 消费方:流程审视 + 年检 kill criteria(详 `~/.claude/skills/teamwork/stages/ship-stage.md §16`)。
> 🔴 区别 `docs/retros/`(业务/工程复盘);本表只度量 teamwork 流程本身。单元格 ≤1 行 · 机器字段照实抄不美化。
> 查询示例:external confirmed 率 = Σ采/Σ总;暂停点 all-default 率 = Σ默/Σ(改+默)。

| Feature | flow | 实走 stages | 时长(总·AI自主·待用户) | review/test 轮 | external 总/采/驳 | 角色真 finding | 暂停点 改:默 | bypass/WARN | 反思摘要(≤1 行) | 各阶段耗时 | 用户邮箱 | 宿主 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OKWORK-F260613041948-quiet-notify | 敏捷 | goal→blueprint_lite→dev→review→test→pm_acceptance→ship | ~0.8h | 1/1 | 0/0/0(运行1次·0 finding) | PRD评审 arch7+qa8(驱动 v0.2);code arch-adv+qa2(P2) ext0 | 1:2 | 0/0 | 评审证伪初稿时间差判据(ARCH-1)→ 同源时间戳比较;external 此类小改 0 finding |
| OKWORK-F260613053134-Terminal-Path-FilePanel | Feature | goal→ui_design→panorama_sync→blueprint→dev→review→test→pm_acceptance→ship | ~5.5h | 2/1 | 52/48/4(defer) | PL1; blueprint ext46; code arch3+qa1+ext3 | 0:4 | 0/0 | external 连续压出 Root/WorkTree 优先级、事务定位、case/symlink/DOM gap;DOM 留 browser/manual |
| OKWORK-F260613150158-Settings-About-Entry | Feature | goal→ui_design→panorama_sync→blueprint→dev→review→test→pm_acceptance→ship | ~2.5h | 1/1 | 6/6/0(blueprint4+review2) | PRD qa9+arch5+pl5→v0.2; BP arch(ARCH2)+qa7+ext4; code arch(tooltip回归)+qa2+ext(lint真违规) | 1:6 | 0/0 | external 抓 AC-5 注入侧测试盲区(CR-1 high)+ lint 真违规;code review 抓 DEV tooltip 回归;PL 质疑收敛为「脚手架」前提;首次引入 jsdom 组件测试 harness |
| OKWORK-B260614065346-Notification-Badge-Count-Decrement | Bug | diagnose→dev→review→test→pm_acceptance→ship | ~0.6h | 2/1 | 1/1/0 | arch0真(全reject); qa0真(均测试缺口·采3); ext1真(medium) | 1:2 | 0/0 | external 独家锁定 setActiveWorkspace 同类入口(opus 双评审仅模糊提及)· 异质评审直接拦下复发缺陷 |
| OKWORK-F260614081920-Close-Install-Confirmation | Feature | goal→ui_design→panorama_sync→blueprint→dev→review→test→pm_acceptance→ship | ~2.8h | 5/1 | 11/7/0(+4 defer) | BP ext7; code review 多轮拦 close/quit/updater race、OS logout、staged retry、dialog reject | 1:5 | 0/0 | external blueprint 3 high 直接改确认状态机;code review 连续压出 before-quit/quitAndInstall/确认锁竞态,测试扩到 198 |
| OKWORK-F260709092258-Workspace-Registry-Host | Feature | goal→blueprint→dev→review→test→pm_acceptance→ship | ~7.7h(跨 session 续跑·含等待) | 2/1 | 6/3/0(+3 defer) | arch1真MAJOR(A1 hydrate 读失败·独家)+5; qa1真MAJOR(Q1 并发写分叉·probe 实证)+5; ext CR-1 与 A1 同源互证 | 0:1 | 0/0 | 三视角交叉命中 2 MAJOR;修复采整条 mutation 串行队列(A5 简洁性方向)一并消解 F2/F3/F5;e2e 首创伪造 parentPort 驱动真实 host bundle 跨进程验证 |
| OKWORK-F260709092310-Host-Standalone-Transport | Feature | goal→blueprint→dev→review→test→pm_acceptance→ship | ~7.9h(跨 session 续跑·含等待) | 2/1 | 6/1/0(+5 defer) | qa2真MAJOR(Q1 闪断满负载复现定位 T-032 · Q2 linux-arm64 AC 缺口);arch0 MAJOR(安全路径逐条实证+简洁性);ext1真MAJOR(CR-1 token 空值 fail-open 独家) | 0:1 | 0/1(dev 闪断 WARN 后续被 QA 定位) | 修复轮 PMO 复核证伪 8s 预算方案→根因重判 FSEvents 死窗口→poke 循环 6 轮全量绿;external 独家安全 finding 再次证值 |
| OKWORK-B260615152207-Terminal-Garbled-Text | Bug | diagnose→dev→review→test→pm_acceptance→ship | ~1.4h | 1/1 | 1/0/0(运行1次·0 finding) | arch1(P2-1 采)+qa1(P2-1 采) ext0 | 0:3 | 0/0 | external 零 finding(渲染/编码盲点未额外暴露)· 真值在 architect 深核 addon 源确认机制 + 真实 WebGL e2e 实证图集溢出→resync + diagnose 双路调查排除数据通路 |
| OKWORK-B260710093647-Wrap-Indent-Path-Link | Bug | diagnose→dev→review→test→pm_acceptance→ship | ~2.7h·~2.6h·~0.1h | 1/1 | 3/2/1(E2采MAJOR·E3降级后采·E1驳回记限制) | qa2真MAJOR(Q1高亮零覆盖+Q2 gutter分支未执行);arch0 MAJOR(13项不变式实证+A1/A2 MINOR采);ext1真MAJOR独家(E2 无斜杠续段=原bug变体) | 0:3 | 0/0 | external 独家 E2 证值(basename 内折行变体);codex exec 首跑挂死98m杀掉重试8m出果;QA 抓「宣称行为零覆盖」类 gap 两条 | dg24m·dev10m·rev120m(含codex卡死重试)·test4m·pm2m | surongrongzz@gmail.com | claude-code |
