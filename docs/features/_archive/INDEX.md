# Feature 归档索引

> teamwork ship-finalize 自动维护 · 每个交付 Feature 的**过程层**产物归档为 `<id>.zip`(含 state.json / 各 stage 产物)· **代码是唯一真相** · 此处仅留可追溯快照。
> 需要历史细节时 `unzip <id>.zip`。

| Feature | 描述 | 交付归档时间 | 归档物 |
| --- | --- | --- | --- |
| TERMPRO-F260613041948-quiet-notify | 收紧 M3「运行中静默1分钟→可能在等输入」:后台 tab 仅在离开后有新输出再停住才提示,离开后无新增不提示。渲染层 lastOutputAt>deactivatedAt 同源时钟判据(弃脆弱的时间差推断),不改协议/host。 | 2026-06-13T05:09:52Z | `TERMPRO-F260613041948-quiet-notify.zip` |
| TERMPRO-F260613053134-Terminal-Path-FilePanel | 终端文件路径链接优先在当前 WorkTree/Root File Panel 定位并展开，内部失败或外部路径才走原 fallback。 | 2026-06-13T11:05:16Z | `TERMPRO-F260613053134-Terminal-Path-FilePanel.zip` |
| TERMPRO-F260613152432-Terminal-File-Link-Open | 终端可点击链接按 kind 分流:文件直接打开(文本/图片进 TermPro 窗口·媒体走系统),目录仍 File Panel 定位。还原 F260613053134 把根内文件焊成只定位的过度收敛。renderer 单点路由(openTarget),7 单测+冒烟绿,三审 APPROVE。 | 2026-06-13T16:12:57Z | `TERMPRO-F260613152432-Terminal-File-Link-Open.zip` |
| TERMPRO-F260613150158-Settings-About-Entry | 侧栏左下角新增用户信息入口:默认头像占位 + 「Settings」入口行,点击展开仅含 About 的菜单,About 弹出当前应用版本(经壳层同步暴露 app 版本号)。作为未来用户/设置区入口的脚手架第一步。 | 2026-06-14T07:20:42Z | `TERMPRO-F260613150158-Settings-About-Entry.zip` |
| TERMPRO-B260614065346-Notification-Badge-Count-Decrement | 修复工作区顶部通知铃铛角标不递减:查看 tab(setActiveTab)与切换工作区(setActiveWorkspace)使其 active tab 可见时,统一经 markTabViewed 把该 tab 未读通知标已读,角标随之递减;不影响 tab 状态点/attention pill/Dock 角标。 | 2026-06-14T07:45:11Z | `TERMPRO-B260614065346-Notification-Badge-Count-Decrement.zip` |
