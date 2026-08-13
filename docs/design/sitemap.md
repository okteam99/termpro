# OkWork Design Sitemap

> 全景首次 seed 于 `OKWORK-F260613053134-Terminal-Path-FilePanel`。本文件描述设计全景中的可预览节点；OkWork 真实产品当前是 Electron 单窗口工作台，不引入 Web 产品导航。

## Routes

| Route | Page ID | Title | Type | Owner Feature | Notes |
|-------|---------|-------|------|---------------|-------|
| `/terminal/file-panel-path-location` | `terminal-file-panel-location` | Terminal Path Links Locate In File Panel | Workbench interaction preview | `OKWORK-F260613053134-Terminal-Path-FilePanel` | 设计预览路由，用于审阅 Terminal fs link 点击后 File Panel mode 切换、祖先展开、滚动定位和 transient highlight。 |
| `/sidebar/settings-about-entry` | `sidebar-settings-about` | Sidebar User Info Entry (Settings / About) | Workbench interaction preview | `OKWORK-F260613150158-Settings-About-Entry` | 设计预览路由，审阅侧栏左下角用户信息入口（头像占位 + Settings）→ 上弹菜单（仅 About）→ About 版本弹窗；入口为侧栏 footer 常驻元素，在所有工作台路由可见。 |
| `/shell/close-install-confirmation` | `shell-close-install-confirmation` | Shell Close / Install Confirmation | Workbench interaction preview | `OKWORK-F260614081920-Close-Install-Confirmation` | 设计预览路由，审阅主窗口关闭、App Quit、升级安装确认与取消安装后可重试状态；不定义真实 Web navigation。 |
| `/workspace/add-workspace` | `workspace-add-workspace` | Add Workspace (Local / Remote) | Workbench interaction preview | `planning/remote-host · WS-01`（BL 启动后认领） | 设计预览路由（模型 A · 远程机为中心）：Sidebar 按机器分组（本机 + 各远程机，未连接机器点「连接」即发现其上全部 workspace 与活跃会话徽标）；「+」添加项目 = 选择机器（本机 / 最近使用 / 手动添加 + 认证徽标）→ 远程目录浏览器 → 「在 {alias} 上创建项目」落入对应机器组；含连接中/首次部署 Host/连接失败/远程断线注入态。 |
| `/settings/remote-hosts` | `settings-remote-hosts` | Remote Hosts Management | Workbench interaction preview | `OKWORK-F260709180208`（BL-003）· `OKWORK-F260810051623-Remote-Profile-Authority`（BL-007 增量） | Settings → Remote Hosts 的既有最近使用、手动 CRUD、认证、测试与连接生命周期保持不变；BL-007 增加 Profile 数据依赖删除拦截，列出依赖 Profile/类型并引导先完成迁移或清理，不自动迁回本机；无依赖 Host 仍走原断连、删除配置与 SSH 凭据流程。 |
| `/settings/browser-profiles` | `settings-browser-profiles` | Browser Settings & Profiles | Settings interaction preview | `OKWORK-F260807022801-Profile-Password-Vault`（BL-006）· `OKWORK-F260810051623-Remote-Profile-Authority`（BL-007 增量）· `OKWORK-F260810151932-Browser-Profile-Login-Continuity`（BL-008 增量） | 真实 520px Browser Settings 单列弹窗：保留 Profile CRUD、普通 `Storage location` 与 Copy→Verify→Switch 迁移；BL-008 增加 Remote Host active Profile 发现与显式“在此设备使用”、登录连续性同步/暂停/跳过/冲突/Host 升级/已移走状态及只含数量和固定原因的脱敏报告。共享 Profile 删除或迁移明确全局影响；不增加说明气泡或面向用户的 `AUTHORITY` 标识。 |
| `/settings/browser-passwords` | `settings-browser-passwords` | Saved Passwords | Settings interaction preview | `OKWORK-F260807022801-Profile-Password-Vault`（BL-006）· `OKWORK-F260810051623-Remote-Profile-Authority`（BL-007 增量） | 脱敏密码管理保留搜索、Profile 筛选、显示/复制/删除及可信窗口；条目从 Profile 当前存储位置读取，远端离线时不显示陈旧列表并暂停全部密码动作，可信窗口若中途断线立即清除展示状态；保留 10 秒重遮罩与 60 秒条件清除剪贴板。 |
| `/browser/password-save-fill` | `browser-password-save-fill` | Password Auto-save & Silent Fill | OkBrowser interaction preview | `OKWORK-F260807022801-Profile-Password-Vault`（BL-006）· `OKWORK-F260810051623-Remote-Profile-Authority`（BL-007 增量）· `OKWORK-F260810151932-Browser-Profile-Login-Continuity`（BL-008 增量） | 真实独立 OkBrowser 壳保留静默填充、保存/更新、多账号、Profile/exact-origin 隔离、网络出口与存储位置分离；BL-008 增加网站请求前的登录状态 hydration 等待/失败（明确零请求）、登录状态已恢复及远程同步暂停短反馈，详细报告仍回到 Browser Profiles。已打开页面离线时可能继续，本机影子存储仍禁止。 |
| `/sidebar/machine-groups` | `sidebar-machine-groups` | Sidebar Machine Groups | Workbench interaction preview | `OKWORK-F260710011342-Sidebar-Machine-Groups` | 设计预览路由，审阅 Sidebar 机器分组主视图（本机组置顶 + 远程机组·未连接=别名+连接入口·已连=展开 workspace + 会话徽标〔本客户端活跃 tab 数·可为 0〕）+ 组头连接生命周期（连接中/部署中%/失败原因+重试，复用 Remote Hosts 事件面）+ 断线确定性回落（该 workspace 面板断线态→activeWorkspaceId 回落本机首个 workspace→组头折叠）+ 远程 workspace 文件区（树浏览 + git 着色在范围；文件内容/Diff 禁用 + 「远程文件独立窗口暂不支持」提示，非静默失败）；M=0 纯本机退化态（单「本机」组头·无空远程占位）。默认态可真实点「连接」跑完整连接编排；dev 顶栏 preset 仅覆盖页面难自然触达的态（M=0/部署中%快照/连接失败/断线回落）。 |

## IA Notes

- `/` 在 preview-project 中保留为设计预览入口；当前重定向到 `/workspace/add-workspace`（本轮规划全景入口）。
- 本 sitemap 不定义真实 Web navigation。真实产品仍是 single-window Electron workbench: Sidebar / TabBar / Terminal / File Panel。
- 全景共享视觉基线跟随当前 renderer：中性黑灰 + 暖橙 token、52px/32px 胶囊 TabBar、Local/Remote 机器分组 Sidebar、互斥右侧面板槽 + 44px SideRail、统一 40px PanelHeader；Settings 与独立 OkBrowser 使用各自真实壳层。Feature 语义在该基线上做增量，不复制旧主题。
- 后续 UI Feature 若新增可预览节点，应在本表登记 route、page id、owner feature 和交互范围。

## Sync Log

- 2026-06-14 · `OKWORK-F260614081920-Close-Install-Confirmation` · 新增 `/shell/close-install-confirmation` 设计预览节点；仅影响 preview-project 全景，不改变真实产品导航。
- 2026-07-09 · `planning/remote-host`（M5 远程 Host 规划轮） · 新增 `/workspace/add-workspace` 与 `/settings/remote-hosts` 两个设计预览节点；`/` 重定向指向 `/workspace/add-workspace`。BL 拆定后由对应 Feature 认领 Owner。
- 2026-07-09 · `planning/remote-host` · 按产品决策 Q-002 改为模型 A（远程机为中心）：Sidebar 按机器分组、连接即发现该机 workspace、添加项目第一步为「选择机器」；Q-003 远程机自管（最近使用 + 手动添加，SSH 密钥/密码，无 ~/.ssh/config 导入）。
- 2026-07-10 · `OKWORK-F260710011342-Sidebar-Machine-Groups`（BL-004）· 新增 `/sidebar/machine-groups` 设计预览节点（Sidebar 机器分组主视图 + 组头连接生命周期 + 断线确定性回落 + 远程文件禁用提示）；`/workspace/add-workspace` 增量补齐远程目录浏览器的加载中/错误态（`fs.readdir` 权限拒绝 mock）。均为在既有 `/workspace/add-workspace` 全景上的增量细化，未推倒重画。
- 2026-08-05 · `planning/browser-profile-password-vault` · 用户确认登录连续性漫游（Profile 配置 + 远程密码 Vault + best-effort Cookie）、静默自动填充且 Agent 可读、Remote Host 可解密；新增 Browser Profiles、Saved Passwords 与 OkBrowser Save / Fill 三个全景节点，承接 Line 0 / 1 / 5，不新增执行线。
- 2026-08-05 · `OKWORK-F260805033051-Remote-Connection-Controls` · **不新增 route**，在既有 `/sidebar/machine-groups` 上增量：组头连接控件由文字按钮（连接/重连/重试/连接中…）改为纯图标钮（链条＝连接 / 断链＝断开 / ×＝取消 / 循环箭头＝立即重试），新增**断开**与**取消**两个入口；补齐「断线过渡（0–900ms）」此前未定义的控件态；确立「`+` 恒最右、连接控件紧靠其左、状态切换不横向跳变」的位置不变式；连接失败改由全局 toast 呈现、组头不再常驻失败文案。属增量细化，未推倒重画、未改 IA 层级与导航模型。
- 2026-08-09 · `OKWORK-F260807022801-Profile-Password-Vault`（BL-006）· 三个 WS-02 既有节点由规划态交给首个执行 Feature：内容收敛为本机加密 Vault、可信显示/复制面和静默保存/填充，明确 BL-007/BL-008 继续承接远程权威与 Cookie 漫游；路由和 IA 层级不变。全景壳层同时从当前 renderer 反向同步为最新共享视觉基线，因此按 L2 评审。
- 2026-08-10 · `OKWORK-F260810051623-Remote-Profile-Authority`（BL-007）· **不新增 route**，在 Browser Profiles、Saved Passwords、OkBrowser Save/Fill 与 Remote Hosts 四个既有节点内增量补齐 Profile 远程存储位置、Copy→Verify→Switch 迁移、远端离线 fail-closed 和 Host 删除依赖保护；按用户反馈去掉说明气泡与面向用户的 Authority 标识，使用普通“存储位置/密码存储”文本。未改 IA、路由、设计 token 或共享壳层基线，BL-008 的 Cookie 漫游边界保持不变。
- 2026-08-11 · `OKWORK-F260810151932-Browser-Profile-Login-Continuity`（BL-008）· **不新增 route**，在 Browser Profiles 与 OkBrowser Save/Fill 两个既有节点内增量补齐远端 Profile 发现/加入、Profile 级持久 Cookie 登录连续性状态、脱敏统计、hydration gate、恢复/暂停反馈及共享 Profile 全局迁移删除确认；Saved Passwords 不变。未改 IA、路由、设计 token 或共享壳层基线，冲突扫描未命中其他 in-flight/planned Feature，判定 L1。
