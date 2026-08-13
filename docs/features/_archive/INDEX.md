# Feature 归档索引

> teamwork ship-finalize 自动维护 · 每个交付 Feature 的**过程层**产物归档为 `<id>.zip`(含 state.json / 各 stage 产物)· **代码是唯一真相** · 此处仅留可追溯快照。
> 需要历史细节时 `unzip <id>.zip`。

| Feature | 描述 | 交付归档时间 | 归档物 |
| --- | --- | --- | --- |
| OKWORK-F260613041948-quiet-notify | 收紧 M3「运行中静默1分钟→可能在等输入」:后台 tab 仅在离开后有新输出再停住才提示,离开后无新增不提示。渲染层 lastOutputAt>deactivatedAt 同源时钟判据(弃脆弱的时间差推断),不改协议/host。 | 2026-06-13T05:09:52Z | `OKWORK-F260613041948-quiet-notify.zip` |
| OKWORK-F260613053134-Terminal-Path-FilePanel | 终端文件路径链接优先在当前 WorkTree/Root File Panel 定位并展开，内部失败或外部路径才走原 fallback。 | 2026-06-13T11:05:16Z | `OKWORK-F260613053134-Terminal-Path-FilePanel.zip` |
| OKWORK-F260613152432-Terminal-File-Link-Open | 终端可点击链接按 kind 分流:文件直接打开(文本/图片进 OkWork 窗口·媒体走系统),目录仍 File Panel 定位。还原 F260613053134 把根内文件焊成只定位的过度收敛。renderer 单点路由(openTarget),7 单测+冒烟绿,三审 APPROVE。 | 2026-06-13T16:12:57Z | `OKWORK-F260613152432-Terminal-File-Link-Open.zip` |
| OKWORK-F260613150158-Settings-About-Entry | 侧栏左下角新增用户信息入口:默认头像占位 + 「Settings」入口行,点击展开仅含 About 的菜单,About 弹出当前应用版本(经壳层同步暴露 app 版本号)。作为未来用户/设置区入口的脚手架第一步。 | 2026-06-14T07:20:42Z | `OKWORK-F260613150158-Settings-About-Entry.zip` |
| OKWORK-B260614065346-Notification-Badge-Count-Decrement | 修复工作区顶部通知铃铛角标不递减:查看 tab(setActiveTab)与切换工作区(setActiveWorkspace)使其 active tab 可见时,统一经 markTabViewed 把该 tab 未读通知标已读,角标随之递减;不影响 tab 状态点/attention pill/Dock 角标。 | 2026-06-14T07:45:11Z | `OKWORK-B260614065346-Notification-Badge-Count-Decrement.zip` |
| OKWORK-B260614085337-Osc8-Link-Open-Browser | 修复终端点击 OSC 8 超链接弹「危险链接」安全确认框的问题 · 现可与纯文本链接一致 · 点击直接用系统默认浏览器打开。 | 2026-06-14T11:07:14Z | `OKWORK-B260614085337-Osc8-Link-Open-Browser.zip` |
| OKWORK-F260614081920-Close-Install-Confirmation | 主窗口关闭、App Quit 和更新安装重启前增加 native 确认；取消后保留工作现场并恢复升级可重试，确认后继续原关闭/退出/Squirrel 安装流程。 | 2026-06-14T11:10:42Z | `OKWORK-F260614081920-Close-Install-Confirmation.zip` |
| OKWORK-B260615152207 | 修复终端中文(CJK)渲染乱码:WebGL 字形图集分页合并会重排字形纹理页索引、已绘制单元格未同步导致错位/串字。订阅图集变更事件→微任务去抖整屏重绘重同步。对外:终端中文显示恢复正确。 | 2026-06-15T18:14:47Z | `OKWORK-B260615152207.zip` |
| OKWORK-F260709092258-Workspace-Registry-Host | Workspace 注册表驻留 Host(本地先行):workspace.* 协议 + Host 侧 workspaces.json 持久化(原子写+串行 mutation 队列)+ 变更全量广播多客户端一致 + renderer 按 host 发现按 id 协调 + 旧存档 v1→v2 无损迁移(保 id/备份/幂等/失败回退)。BL-004 多机 Sidebar 的注册表地基 | 2026-07-09T17:15:54Z | `OKWORK-F260709092258-Workspace-Registry-Host.zip` |
| OKWORK-F260709092310-Host-Standalone-Transport | Host standalone + WS 传输 + 握手:host 独立入口(--listen loopback + token 闸 fail-closed)+ 全协议 WS 等价服务 + 版本区间握手双端拒绝不兼容 + 多客户端归属隔离 + 产物三平台实机可运行 + CI 矩阵。BL-003 远程连接的传输地基 | 2026-07-09T17:18:28Z | `OKWORK-F260709092310-Host-Standalone-Transport.zip` |
| OKWORK-F260709180208-Remote-Hosts-SSH | 远程机管理与 SSH 连接编排(M5 Wave2)：Settings→Remote Hosts 管理远程机(CRUD+safeStorage 凭据)，一键连接经 ssh2 隧道自动部署远程 host、协议握手、连接生命周期可视；per-host HostClient 结构就绪供 BL-004 消费。 | 2026-07-10T01:09:45Z | `OKWORK-F260709180208-Remote-Hosts-SSH.zip` |
| OKWORK-F260710011342-Sidebar-Machine-Groups | 机器分组 Sidebar + 添加项目流程(M5 Wave3)：Sidebar 按机器分组(本机+远程机·连接即发现该机 workspace+会话徽标)，添加项目=选机器→远程目录浏览器→落对应 Host 注册表，主窗口远程 workspace 终端/文件树/git 全链路走该机 host。53 处 hostClient 消费点迁 per-host 注册表·本机零回归。 | 2026-07-10T04:25:02Z | `OKWORK-F260710011342-Sidebar-Machine-Groups.zip` |
| OKWORK-F260710042746-Reconnect-Continuity | M5 远程 Host 收官:远程机 UI 断开(合盖/断网/切网)后会话在远端续跑不被杀,重连后回放屏幕+收养既有会话+对账状态徽标+断线期跑完的 build 也能看到最终输出与退出码——远程开发像本地一样『合上笔记本回来接着干』。 | 2026-07-10T08:17:03Z | `OKWORK-F260710042746-Reconnect-Continuity.zip` |
| OKWORK-B260710093647-Wrap-Indent-Path-Link | 终端折行路径链接修复:Ink/Claude Code 硬折行+悬挂缩进把长路径切成两段,此前只有前缀目录可点。现跨缩进拼接为一条完整链接(hover+常驻高亮),点击打开最终目标;续段无斜杠(basename 内折行)、gutter 竖线缝隙均覆盖;拼接不存在时回退原行为不误链。 | 2026-07-10T12:33:03Z | `OKWORK-B260710093647-Wrap-Indent-Path-Link.zip` |
| OKWORK-F260805033051-Remote-Connection-Controls | 远程机组头连接控件重构:侧栏可直接断开已连接的远程机、连接进行中可取消(此前只能进设置页);连接控件全部图标化(链条=连接/断链=断开/×=取消/循环箭头=立即重试);连接失败改为一次性全局 toast + 组头回落待连接,不再常驻红叉;断开在途时连接钮显忙碌转圈、点击排队兑现有 8 秒上界。 | 2026-08-06T06:33:48Z | `OKWORK-F260805033051-Remote-Connection-Controls.zip` |
| OKWORK-F260807022801-Profile-Password-Vault | 为 OkBrowser Profile 增加本机加密密码 Vault，在可确认登录成功后按 Profile 与 exact origin 自动保存、更新和静默填充，提供脱敏管理、可信显隐复制及一致删除语义；为后续远程权威存储保留领域边界。 | 2026-08-10T03:21:39Z | `OKWORK-F260807022801-Profile-Password-Vault.zip` |
| OKWORK-F260810051623-Remote-Profile-Authority | 为每个 Browser Profile 提供本机或 Remote Host 唯一权威存储，远端加密保存配置与密码，支持可恢复迁移、断线 fail-closed、兼容性校验与 Host 删除依赖保护。 | 2026-08-10T14:51:59Z | `OKWORK-F260810051623-Remote-Profile-Authority.zip` |
| OKWORK-F260810151932-Browser-Profile-Login-Continuity | Browser Profile 登录连续性漫游:同一 Profile 的登录 Cookie 以 Profile 级权威在多设备与多网络出口间对账,换设备连接同一 Remote Host 即可延续常见站点登录;session-only Cookie 留在本机,LocalStorage/IndexedDB/Cache 不上传。 | 2026-08-13T03:01:17Z | `OKWORK-F260810151932-Browser-Profile-Login-Continuity.zip` |
