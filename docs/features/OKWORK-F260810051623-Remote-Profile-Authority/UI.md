---
pages:
  - {id: settings-browser-profiles, title: "Browser Settings & Profiles"}
  - {id: settings-browser-passwords, title: "Saved Passwords"}
  - {id: browser-password-save-fill, title: "Password Save & Fill"}
  - {id: settings-remote-hosts, title: "Remote Hosts Management"}
panorama_medium: same-stack
panorama_path: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810051623-Remote-Profile-Authority/docs/design
pages_changed:
  - page_id: settings-browser-profiles
    route_path: /settings/browser-profiles
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810051623-Remote-Profile-Authority/docs/design/preview-project/src/main.jsx
    change_range: "在当前 520px Browser Settings 整页中增加每 Profile authority、可交互迁移确认/进度、离线与 cleanup pending 状态；Default Profile 同样可迁移但不可编辑或删除。"
    acceptance_criteria_refs: [AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-9]
  - page_id: settings-browser-passwords
    route_path: /settings/browser-passwords
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810051623-Remote-Profile-Authority/docs/design/preview-project/src/main.jsx
    change_range: "在现有 metadata-only 密码管理整页增加 Profile authority、远端离线空面、Retry/Host 引导，以及 trusted window 在 authority 失效后的安全错误态。"
    acceptance_criteria_refs: [AC-1, AC-3, AC-6, AC-9]
  - page_id: browser-password-save-fill
    route_path: /browser/password-save-fill
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810051623-Remote-Profile-Authority/docs/design/preview-project/src/main.jsx
    change_range: "在当前 OkBrowser 壳与 BL-006 保存/填充反馈中增加 Remote authority offline 状态，分开说明本机 Cookie 会话与密码能力。"
    acceptance_criteria_refs: [AC-1, AC-6, AC-9]
  - page_id: settings-remote-hosts
    route_path: /settings/remote-hosts
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810051623-Remote-Profile-Authority/docs/design/preview-project/src/main.jsx
    change_range: "在现有 Remote Hosts 整页中增加 authority 依赖删除拦截、依赖 Profile/类型清单与迁移入口；无依赖 Host 保持原删除确认。"
    acceptance_criteria_refs: [AC-2, AC-5, AC-8]
---

# Remote Host Profile Authority - UI 设计意图 & 追溯

> 🔴 全景宿主：OKWORK（单子项目）
> 🔴 panorama_path: `/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810051623-Remote-Profile-Authority/docs/design`
> 🔴 panorama_medium: `same-stack`；视觉与交互权威为 `docs/design/preview-project/` 源码，运行 `preview.sh` 查看实时预览。
> 🟢 本 Feature 不保存静态 HTML 副本；四个既有真实 route 的整页增量直接进入全景权威。

## 状态

待用户确认

## 全景增量声明

- 不新增 route、顶级设置页或真实 Web navigation；继续使用现有 Browser Settings、Saved Passwords、OkBrowser 与 Remote Hosts 入口。
- authority 是 Profile 配置/密码 Vault 的存储位置；网络出口继续使用既有独立控件与语义，二者不合并。
- `Default Profile` 仅新增 authority 操作，仍不可改名或删除。
- 用户能从真实页面按钮完成 authority 选择、风险确认和 Host 依赖查看；难以自然制造的 loading/offline/error/cleanup pending 由右下角 preview dev 面板注入。
- UI Design 不直接编辑 `sitemap.md`；本轮全景内容变更在 `panorama_sync` 记录 owner/Notes，IA 层级保持不变。

## UI-AC-COVERAGE（PRD AC 覆盖声明）

| AC.id | 描述摘要 | 对应页面 / 同栈区块 | 覆盖状态 |
|-------|----------|---------------------|----------|
| AC-1 | 每个 Profile（含 Default）明示唯一 authority，重启/出口切换不改变 | `/settings/browser-profiles` Profile rows；`/settings/browser-passwords` authority context；OkBrowser vault disclosure | ✅ 设计覆盖 |
| AC-2 | 仅 ready/兼容 Host 可提交，二次确认目标、信任边界和迁移后果 | `/settings/browser-profiles` Change authority → target picker → confirmation | ✅ 设计覆盖 |
| AC-3 | Remote Vault 的 main-only 独立授权与拒绝矩阵 | Profile 风险披露、metadata-only 页面、trusted surface 无通用明文入口 | ⚠️ UI 边界已覆盖；授权负测由 Blueprint/RD 实现 |
| AC-4 | copy→verify→switch；迁移期阻止 mutations、reads 仍走源 | `/settings/browser-profiles` migration progress 与 disabled mutation actions | ✅ 设计覆盖 |
| AC-5 | commit 前失败保留源；commit 后 cleanup pending 不回切 | `/settings/browser-profiles` migration error、success、cleanup pending；`/settings/remote-hosts` cleanup dependency | ✅ 设计覆盖 |
| AC-6 | Remote authority offline 时所有密码动作 fail-closed，Cookie 状态分开呈现 | Browser Profiles、Saved Passwords 空面、OkBrowser status、trusted authority-lost error | ✅ 设计覆盖 |
| AC-7 | Remote Profile 删除撤权、失败可重试、迁移中不可删 | `/settings/browser-profiles` deleting/delete-failed/migrating row states | ✅ 设计覆盖 |
| AC-8 | 被 authority/迁移/清理依赖的 Host 禁止删除且不自动迁本机 | `/settings/remote-hosts` Delete → dependency blocked surface → Browser Profiles | ✅ 设计覆盖 |
| AC-9 | UI/错误/截图不泄密，错误分类可行动 | 四 route 的脱敏 status/alert；preview 不展示真实 secret/capability | ⚠️ UI 已覆盖；日志、文件权限与协议负测由 Blueprint/RD 实现 |

## 变更记录

| 日期 | 变更 | 影响的全景源码 |
|------|------|----------------|
| 2026-08-10 | BL-007 初稿：在四个既有 route 叠加 authority、迁移、断线与 Host 删除保护 | `preview-project/src/main.jsx`、`latest-ui-sync.css` |

## Designer 自查报告

### 检查结果汇总

| 维度 | 检查项 | 通过 | 备注 |
|------|--------|------|------|
| 1. 全景对齐 | 4 | 4/4 | 路由、Settings/OkBrowser 壳、真实 renderer tokens、现有交互模式均对齐 |
| 2. 状态覆盖 | 4×4 页 | 16/16 | 每页 normal/loading/empty-or-offline/error；另覆盖 migrating/success/cleanup pending |
| 3. PRD AC 覆盖 | 9 | 9/9 | 7 条完整 UI 覆盖；AC-3/AC-9 的非 UI 安全结果明确交给 Blueprint/RD |
| 4. 全景增量同步 | 4 | 4/4 | 类型：🟡 增量；四个既有 route 内容变化，无新增 IA |
| 5. 结构性变更红线 | 3 | 3/3 | 未新增页面层级、未改导航模型、未替换共享视觉基线 |
| 6. 框架基线唯一性 | 1 | 1/1 | framework_source = 当前 renderer CSS imports + `docs/design/preview-project/src/latest-ui-sync.css`，非历史 Feature preview |

### 全景对齐证据

- panorama_path: `/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810051623-Remote-Profile-Authority/docs/design`
- 全景宿主：OKWORK
- 风格与交互对照：
  1. 真实 Browser Settings 使用 520px `SettingsModal` 单列组与 `BrowserProfilesSection`；预览保留整页壳后再增加 authority，不把它拆成新页。
  2. 真实 Saved Passwords 的 ordinary renderer 只处理 metadata，reveal/copy 进入独立 trusted window；预览保持该边界，远端离线时不渲染陈旧 rows。
  3. 真实 Remote Hosts 使用行内确认、连接生命周期 badge 与可恢复错误；预览复用相同模式呈现“删除被 Profile 依赖阻止”。
  4. 全景共享壳直接导入当前 `index.css`、Sidebar/TabBar/SideRail/PanelHeader/FilePanel CSS，并由 `latest-ui-sync.css` 收敛 Settings/OkBrowser 视觉值。
- 导航位置：`Settings → Browser Settings → Browser profiles / Saved Passwords`；`Settings → Remote Hosts`；独立/面板 OkBrowser 的密码状态条。
- 全景变更类型：🟡 增量

### 全景增量 diff

```diff
sitemap.md：
~ 路由与 IA 不变；panorama_sync 仅更新四个既有节点的 Owner/Notes 与 Sync Log

preview-project：
~ /settings/browser-profiles 增加 authority 与迁移交互/状态
~ /settings/browser-passwords 增加 authority offline 与 trusted authority-lost
~ /browser/password-save-fill 增加 remote authority offline 与 Cookie/密码双状态
~ /settings/remote-hosts 增加 Profile dependency 删除拦截
```

### 自查结论

✅ 结构、状态与 AC 自查通过，`npm run build` 已通过。自动浏览器巡检因当前会话没有可用 Browser/Chrome 实例而未执行；保留为本次用户预览确认的显式检查项。

## 补充洞察

- Remote Host “Connected” 只代表通用 Host 会话 ready；authority selector 还需单独验证 Profile/Vault capability 兼容，UI 不应把两者合成一个绿色状态。
- `cleanup pending` 是“迁移已成功、旧源待清理”的 warning，不应复用 migration failed 的 danger 文案，否则用户会误以为已回切。
