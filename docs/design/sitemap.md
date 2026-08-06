# OkWork Design Sitemap

> 全景首次 seed 于 `OKWORK-F260613053134-Terminal-Path-FilePanel`。本文件描述设计全景中的可预览节点；OkWork 真实产品当前是 Electron 单窗口工作台，不引入 Web 产品导航。

## Routes

| Route | Page ID | Title | Type | Owner Feature | Notes |
|-------|---------|-------|------|---------------|-------|
| `/terminal/file-panel-path-location` | `terminal-file-panel-location` | Terminal Path Links Locate In File Panel | Workbench interaction preview | `OKWORK-F260613053134-Terminal-Path-FilePanel` | 设计预览路由，用于审阅 Terminal fs link 点击后 File Panel mode 切换、祖先展开、滚动定位和 transient highlight。 |
| `/sidebar/settings-about-entry` | `sidebar-settings-about` | Sidebar User Info Entry (Settings / About) | Workbench interaction preview | `OKWORK-F260613150158-Settings-About-Entry` | 设计预览路由，审阅侧栏左下角用户信息入口（头像占位 + Settings）→ 上弹菜单（仅 About）→ About 版本弹窗；入口为侧栏 footer 常驻元素，在所有工作台路由可见。 |
| `/shell/close-install-confirmation` | `shell-close-install-confirmation` | Shell Close / Install Confirmation | Workbench interaction preview | `OKWORK-F260614081920-Close-Install-Confirmation` | 设计预览路由，审阅主窗口关闭、App Quit、升级安装确认与取消安装后可重试状态；不定义真实 Web navigation。 |
| `/workspace/add-workspace` | `workspace-add-workspace` | Add Workspace (Local / Remote) | Workbench interaction preview | `planning/remote-host · WS-01`（BL 启动后认领） | 设计预览路由（模型 A · 远程机为中心）：Sidebar 按机器分组（本机 + 各远程机，未连接机器点「连接」即发现其上全部 workspace 与活跃会话徽标）；「+」添加项目 = 选择机器（本机 / 最近使用 / 手动添加 + 认证徽标）→ 远程目录浏览器 → 「在 {alias} 上创建项目」落入对应机器组；含连接中/首次部署 Host/连接失败/远程断线注入态。 |
| `/settings/remote-hosts` | `settings-remote-hosts` | Remote Hosts Management | Workbench interaction preview | `planning/remote-host · WS-01`（BL 启动后认领） | 设计预览路由，审阅 Settings → Remote Hosts 管理：最近使用（只读快捷区，含相对时间）+ 手动添加（增/改/删，认证方式：SSH 密钥〔路径引用〕/ 密码，密码凭据 safeStorage 加密存储〔密钥在系统钥匙串·BL-003 ADR-001〕）+ 测试连接；远程机全部由 OkWork 自管，不做 ~/.ssh/config 导入；含空态与测试失败注入态。 |
| `/settings/browser-profiles` | `settings-browser-profiles` | Browser Profiles & Login Continuity | Settings interaction preview | `planning/browser-profile-password-vault · WS-02` | Profile 列表、登录数据位置（本机或单一 Remote Host）、迁移进度、断线 fail-closed、Cookie 部分同步与安全边界；明确只漫游 Profile 配置、密码和兼容 Cookie，网站 LocalStorage / IndexedDB / Service Worker / Cache 保持设备本地。 |
| `/settings/browser-passwords` | `settings-browser-passwords` | Saved Passwords | Settings interaction preview | `planning/browser-profile-password-vault · WS-02` | 当前 Profile 的站点密码管理：搜索、显示、复制、删除、空态和远程 Host 断线态；密码权威位置与 Host 可解密边界常驻可见。 |
| `/browser/password-save-fill` | `browser-password-save-fill` | Password Auto-save & Silent Fill | OkBrowser interaction preview | `planning/browser-profile-password-vault · WS-02` | OkBrowser chrome 中的静默自动填充、自动保存/更新、多账号、无匹配、Host 断线与 Profile 隔离；常驻提示 Agent 可读取已经填入页面的值，页面网站自身不能伪造宿主提示。 |
| `/sidebar/machine-groups` | `sidebar-machine-groups` | Sidebar Machine Groups | Workbench interaction preview | `OKWORK-F260710011342-Sidebar-Machine-Groups` | 设计预览路由，审阅 Sidebar 机器分组主视图（本机组置顶 + 远程机组·未连接=别名+连接入口·已连=展开 workspace + 会话徽标〔本客户端活跃 tab 数·可为 0〕）+ 组头连接生命周期（连接中/部署中%/失败原因+重试，复用 Remote Hosts 事件面）+ 断线确定性回落（该 workspace 面板断线态→activeWorkspaceId 回落本机首个 workspace→组头折叠）+ 远程 workspace 文件区（树浏览 + git 着色在范围；文件内容/Diff 禁用 + 「远程文件独立窗口暂不支持」提示，非静默失败）；M=0 纯本机退化态（单「本机」组头·无空远程占位）。默认态可真实点「连接」跑完整连接编排；dev 顶栏 preset 仅覆盖页面难自然触达的态（M=0/部署中%快照/连接失败/断线回落）。 |

## IA Notes

- `/` 在 preview-project 中保留为设计预览入口；当前重定向到 `/workspace/add-workspace`（本轮规划全景入口）。
- 本 sitemap 不定义真实 Web navigation。真实产品仍是 single-window Electron workbench: Sidebar / TabBar / Terminal / File Panel。
- 后续 UI Feature 若新增可预览节点，应在本表登记 route、page id、owner feature 和交互范围。

## Sync Log

- 2026-06-14 · `OKWORK-F260614081920-Close-Install-Confirmation` · 新增 `/shell/close-install-confirmation` 设计预览节点；仅影响 preview-project 全景，不改变真实产品导航。
- 2026-07-09 · `planning/remote-host`（M5 远程 Host 规划轮） · 新增 `/workspace/add-workspace` 与 `/settings/remote-hosts` 两个设计预览节点；`/` 重定向指向 `/workspace/add-workspace`。BL 拆定后由对应 Feature 认领 Owner。
- 2026-07-09 · `planning/remote-host` · 按产品决策 Q-002 改为模型 A（远程机为中心）：Sidebar 按机器分组、连接即发现该机 workspace、添加项目第一步为「选择机器」；Q-003 远程机自管（最近使用 + 手动添加，SSH 密钥/密码，无 ~/.ssh/config 导入）。
- 2026-07-10 · `OKWORK-F260710011342-Sidebar-Machine-Groups`（BL-004）· 新增 `/sidebar/machine-groups` 设计预览节点（Sidebar 机器分组主视图 + 组头连接生命周期 + 断线确定性回落 + 远程文件禁用提示）；`/workspace/add-workspace` 增量补齐远程目录浏览器的加载中/错误态（`fs.readdir` 权限拒绝 mock）。均为在既有 `/workspace/add-workspace` 全景上的增量细化，未推倒重画。
- 2026-08-05 · `planning/browser-profile-password-vault` · 用户确认登录连续性漫游（Profile 配置 + 远程密码 Vault + best-effort Cookie）、静默自动填充且 Agent 可读、Remote Host 可解密；新增 Browser Profiles、Saved Passwords 与 OkBrowser Save / Fill 三个全景节点，承接 Line 0 / 1 / 5，不新增执行线。
