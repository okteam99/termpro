# TermPro Design Sitemap

> 全景首次 seed 于 `TERMPRO-F260613053134-Terminal-Path-FilePanel`。本文件描述设计全景中的可预览节点；TermPro 真实产品当前是 Electron 单窗口工作台，不引入 Web 产品导航。

## Routes

| Route | Page ID | Title | Type | Owner Feature | Notes |
|-------|---------|-------|------|---------------|-------|
| `/terminal/file-panel-path-location` | `terminal-file-panel-location` | Terminal Path Links Locate In File Panel | Workbench interaction preview | `TERMPRO-F260613053134-Terminal-Path-FilePanel` | 设计预览路由，用于审阅 Terminal fs link 点击后 File Panel mode 切换、祖先展开、滚动定位和 transient highlight。 |
| `/sidebar/settings-about-entry` | `sidebar-settings-about` | Sidebar User Info Entry (Settings / About) | Workbench interaction preview | `TERMPRO-F260613150158-Settings-About-Entry` | 设计预览路由，审阅侧栏左下角用户信息入口（头像占位 + Settings）→ 上弹菜单（仅 About）→ About 版本弹窗；入口为侧栏 footer 常驻元素，在所有工作台路由可见。 |
| `/shell/close-install-confirmation` | `shell-close-install-confirmation` | Shell Close / Install Confirmation | Workbench interaction preview | `TERMPRO-F260614081920-Close-Install-Confirmation` | 设计预览路由，审阅主窗口关闭、App Quit、升级安装确认与取消安装后可重试状态；不定义真实 Web navigation。 |

## IA Notes

- `/` 在 preview-project 中保留为设计预览入口；当前会重定向到本 Feature 的工作台局部交互预览。
- 本 sitemap 不定义真实 Web navigation。真实产品仍是 single-window Electron workbench: Sidebar / TabBar / Terminal / File Panel。
- 后续 UI Feature 若新增可预览节点，应在本表登记 route、page id、owner feature 和交互范围。
