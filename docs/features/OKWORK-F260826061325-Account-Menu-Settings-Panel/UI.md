---
pages:
  - {id: sidebar-settings-about, title: "Sidebar Account Entry (Login)"}
panorama_medium: same-stack
panorama_path: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260826061325-Account-Menu-Settings-Panel/docs/design
pages_changed:
  - page_id: sidebar-settings-about
    route_path: /sidebar/settings-about-entry
    panorama_file: docs/design/preview-project/src/main.jsx
    change_range: "左下角入口 Settings→Login；账号菜单 Settings/About/Logout；Settings 打开左分类+右内容的全局面板；现有配置项迁入分类"
    acceptance_criteria_refs: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8]
---
# 账号菜单 + 全局 Settings 面板 - UI 设计意图 & 追溯

> 🔴 全景宿主：OKWORK（当前子项目）
> 🔴 panorama_path: `/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260826061325-Account-Menu-Settings-Panel/docs/design`
> 🔴 panorama_medium: same-stack（`docs/design/preview-project` · 跑 `preview.sh`）

## 状态
已确认

## UI-AC-COVERAGE（PRD AC 覆盖声明 · 必填）

| AC.id | 描述摘要 | 对应页面 / 区块 | 覆盖状态 |
|-------|---------|---------------------|---------|
| AC-1 | 入口文案 Login，点击只开菜单 | `/sidebar/settings-about-entry` `.settings-entry` `data-ac="AC-1 AC-2"` | ✅ |
| AC-2 | 菜单仅 Settings / About / Log out | 同上 `.settings-menu` | ✅ |
| AC-3 | Settings 打开两栏全局面板，内容在右栏 | `.settings-panel` `data-ac="AC-3 AC-4 AC-8"` | ✅ |
| AC-4 | 分类含 General/Language/Browser/Passwords/Remote Hosts；互跳切分类 | 面板左导航 + 右栏；Browser → Passwords、Hosts → Browser | ✅ |
| AC-5 | About 仍是独立版本卡 | `.about-card` | ✅ |
| AC-6 | Logout 显示 Not signed in，菜单保持打开 | `.settings-menu-hint` `data-ac="AC-6"` | ✅ |
| AC-7 | 深链打开面板并定位 Remote Hosts | 预览顶栏「深链 → Remote Hosts」 | ✅ |
| AC-8 | 菜单 / 面板 / About 互斥；关闭归入口 | SidebarFooter 单层状态 | ✅ |
| AC-9 | 文案不再写「Settings → Remote Hosts」 | ⚠️ 需 RD 实现 · 非本预览页（preview/openPreview/terminalRegistry 字符串） | ⚠️ 需 RD 实现 · 非 UI 预览页 |

## 变更记录
| 日期 | 变更 | 影响的 HTML 文件 |
|------|------|----------------|
| 2026-08-26 | 账号入口 Login + 全局两栏 Settings 面板 | preview-project `src/main.jsx` · `src/account-settings-panel.css` |

## 全景变更判级

- 级别：**L1**
- ① sitemap 无节点增删移、无新路由：只更新既有 `/sidebar/settings-about-entry` 的 Title/Notes；`/settings/*` 内容预览路由保留。
- ② 无设计 token / 共享视觉基线变更：沿用现有 `--bg-panel` / `--border` / `--accent`；新面板是壳层，不是新色板。
- ③ 受影响 Features 扫描：入口原 owner `OKWORK-F260613150158` 已归档；`/settings/remote-hosts|browser-profiles|passwords` 仍是已交付 BL 的内容预览。无其他 in-flight Feature 改同一入口。
- 结论：节点内增量 · 出口 `add-concern WARN` 留痕后直进（本 Feature 跳 blueprint，下一 stage 为 dev）。

---

## Designer 自查报告

### 检查结果汇总
| 维度 | 检查项 | 通过 | 备注 |
|------|------|----|----|
| 1. 全景对齐 | 4 | 4/4 | panorama_path = docs/design · 宿主 = OKWORK |
| 2. 状态覆盖 | 4×1页 | 4/4 | 1 个页面 · 入口/菜单/面板/About 可点；Logout 未登录与深链走 **dev 悬浮工具顶栏** |
| 3. PRD AC 覆盖 | 9 | 8/9 | AC-9 文案替换归 RD · 见 UI-AC-COVERAGE |
| 4. 全景增量同步 | 4 | 4/4 | 类型：🟡 增量（更新既有节点描述，不增删路由） |
| 5. 结构性变更红线 | 3 | 3/3 | 不删页、不重构主导航、不改业务流程状态机 |
| 6. 框架基线唯一性| 1 | 1/1 | framework_source = preview-project 当前 shell（Sidebar.css + index.css 从 renderer 导入）|

### 全景对齐证据
- panorama_path: `/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260826061325-Account-Menu-Settings-Panel/docs/design`
- 全景宿主：OKWORK
- 风格对照：
  1. 侧栏 footer 头像 26px 圆 + 入口 hover `--bg-active`（沿用 SettingsEntry）
  2. 上弹菜单 `bottom: calc(100% + 6px)`、圆角 10px、外点/Esc 关闭（对齐通知中心）
  3. 设置 overlay `rgba(0,0,0,0.5)` + 12px 圆角面板 + 即时生效无 Save（沿用 SettingsModal 关闭模型，尺寸改为两栏全局壳）
- 导航位置：Workbench → Sidebar footer（所有工作台页可见）→ 账号菜单 / 全局 Settings 面板
- 全景变更类型：🟡 增量

#### 🔴 全景对齐校验（same-stack · verify-panorama.py skip HTML）

```bash
python3 /Users/liam/.agents/skills/teamwork/tools/verify-panorama.py --feature /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260826061325-Account-Menu-Settings-Panel/docs/features/OKWORK-F260826061325-Account-Menu-Settings-Panel
```

- verdict: OK（same-stack · HTML 检查 skip）

### 全景增量 diff（🟡 增量）

```diff
sitemap.md 变更：
~ 修改 /sidebar/settings-about-entry（Title: Settings/About → Login 账号入口；Notes: 菜单三项 + 全局两栏面板）

preview-project：
+ GlobalSettingsPanel（左分类 + 右内容，无套娃 backdrop）
~ SidebarFooter 文案 Login；菜单 Settings / About / Log out
```

### 自查结论
✅ 自查通过 · 可进入 ⏸️ 用户确认设计稿
