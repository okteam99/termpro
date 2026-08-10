# BL-008 开发视觉验收

日期：2026-08-11

## 对照对象

- 真实应用：[real-app-browser-settings.png](./real-app-browser-settings.png)
- 已确认全景：[panorama-browser-profiles.png](./panorama-browser-profiles.png)
- 全景路由：`/settings/browser-profiles`

真实应用以隔离的临时 `userData` 启动，因此只展示本机 built-in Profile；全景稿展示 Remote Profile、可加入 Profile 与登录连续性状态，用于核对新增状态的完整布局。

## 核对结论

| 项目 | 结果 | 证据 |
|------|------|------|
| 设置弹窗与 Browser Profiles 所在位置 | 通过 | 两者沿用同一 520px 单列设置弹窗、标题层级和底部主操作 |
| Profile 行密度与操作区 | 通过 | `Storage location`、密码数量和按钮保持同一行级结构，新增连续性状态放在 Profile 行下方 |
| 状态与恢复信息 | 通过 | 全景中的已同步/离线/跳过信息使用普通行内文本和固定状态色，不使用说明气泡 |
| 用户可见命名 | 通过 | UI 使用 `Storage location` / `登录连续性`，没有用户可见 `AUTHORITY` 标识 |
| 真实应用启动 | 通过 | Electron dev app 从当前 worktree 编译并启动，Browser Settings 可正常打开 |

## 范围说明

该次视觉核对验证实际壳层、设置弹窗和本机 Profile 行，并以已确认全景覆盖 Remote Profile 的数据状态。Remote 数据一致性、加入、hydration、迁移和删除由 T-001～T-017 的 Host/main/renderer 契约测试验证。
