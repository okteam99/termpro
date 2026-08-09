---
pages:
  - {id: settings-browser-profiles, title: "Browser Settings & Profiles"}
  - {id: settings-browser-passwords, title: "Saved Passwords"}
  - {id: browser-password-save-fill, title: "Password Auto-save & Silent Fill"}
panorama_medium: same-stack
panorama_path: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260807022801-Profile-Password-Vault/docs/design
pages_changed:
  - page_id: settings-browser-profiles
    route_path: /settings/browser-profiles
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260807022801-Profile-Password-Vault/docs/design/preview-project/src/main.jsx
    change_range: "复现完整 Browser Settings 现状，在既有 Profile 区整合本机加密 Vault、密码数量、管理入口、删除中/失败与 Agent 可读披露；移除属于 BL-007/BL-008 的远程迁移和 Cookie 同步状态"
    acceptance_criteria_refs: [AC-2, AC-5, AC-7, AC-8]
  - page_id: settings-browser-passwords
    route_path: /settings/browser-passwords
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260807022801-Profile-Password-Vault/docs/design/preview-project/src/main.jsx
    change_range: "脱敏密码列表、搜索与 Profile 筛选、empty/loading/error/encryption-unavailable 四态、删除确认，以及独立隔离可信显示/复制窗口和剪贴板 60 秒条件清除披露"
    acceptance_criteria_refs: [AC-5, AC-6, AC-7, AC-8, AC-9]
  - page_id: browser-password-save-fill
    route_path: /browser/password-save-fill
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260807022801-Profile-Password-Vault/docs/design/preview-project/src/main.jsx
    change_range: "OkBrowser chrome 中的本机静默填充、保存/更新、多账号切换、无匹配、Profile 隔离、无法确认/登录失败、系统加密不可用与普通 HTTP 停用状态；常驻 Agent 可读提示"
    acceptance_criteria_refs: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-8]
---

# BL-006 Profile 密码库 - UI 设计意图 & 追溯

> 🔴 全景宿主：OKWORK
> 🔴 panorama_path：`/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260807022801-Profile-Password-Vault/docs/design`
> 🔴 panorama_medium：same-stack；全景权威为 `docs/design/preview-project/` 源码，运行 `preview.sh` 查看，Feature 不保存静态 HTML 副本。
> 🟢 设计权威有效期：上述三个页面 ship 前；ship 后真实产品代码成为唯一真相。

## 状态

待用户确认

## UI-AC-COVERAGE

| AC.id | 描述摘要 | 对应页面 / same-stack 区块 | 覆盖状态 |
|-------|---------|---------------------------|---------|
| AC-1 | 成功可确认才自动保存；失败/不确定不覆盖 | `/browser/password-save-fill` 的 saved、auth-failed、uncertain 状态 | ✅ |
| AC-2 | Profile + exact origin + 安全 origin 隔离 | `/browser/password-save-fill` 的 other-profile、insecure-origin；`/settings/browser-profiles` 本机归属 | ✅ |
| AC-3 | 单账号静默填充、多账号确定选择、不覆盖非空字段 | `/browser/password-save-fill` 的 autofilled、multi 与真实账号选择菜单 | ✅ |
| AC-4 | 成功更新；失败保留旧密码 | `/browser/password-save-fill` 的 updated、auth-failed | ✅ |
| AC-5 | 本机加密、重启可用、加密不可用 fail-closed | `/settings/browser-profiles` 与 `/settings/browser-passwords` 的 encryption-unavailable；浏览器同名状态 | ✅ |
| AC-6 | 密码列表四态、搜索、显隐、复制、删除 | `/settings/browser-passwords` 的真实搜索/筛选/删除与隔离可信窗口；dev 面板覆盖 loading/empty/error | ✅ |
| AC-7 | Profile/账号删除成功与失败、重试 | `/settings/browser-profiles` 的删除确认与 delete-failed；`/settings/browser-passwords` 的单账号删除 | ✅ |
| AC-8 | 无普通 Vault 明文通道；DOM/剪贴板暴露面常驻披露 | 三页常驻披露；`/settings/browser-passwords` 隔离可信窗口 | ✅ |
| AC-9 | 状态与错误不显示秘密 | 所有 error/disabled/delete 状态只展示脱敏 origin、用户名和动作结果 | ✅ |

## 变更记录

| 日期 | 变更 | 影响的全景源 |
|------|------|--------------|
| 2026-08-09 | BL-006 UI 首版：将 WS-02 规划态的远程/Cookie 全景收敛为本机 Vault 范围，补齐真实 Browser Settings 整页、隔离可信密码窗口与所有失败态 | `preview-project/src/main.jsx`、`preview-project/src/styles.css` |

## Designer 自查报告

### 检查结果汇总

| 维度 | 检查项 | 通过 | 备注 |
|------|--------|------|------|
| 1. 全景对齐 | 4 | 4/4 | panorama_path=`docs/design`；宿主=OKWORK；沿用既有路由、shell 与 tokens |
| 2. 状态覆盖 | 4×3 页 | 12/12 | 三页均有 normal / empty / loading / error 或等价 fail-closed 状态；页面不可自然触达状态只放 dev 悬浮面板 |
| 3. PRD AC 覆盖 | 9 | 9/9 | 详 UI-AC-COVERAGE |
| 4. 全景增量同步 | 4 | 4/4 | 🟡 增量；路由不变，内容由 WS-02 规划态收敛到 BL-006 执行态 |
| 5. 结构性变更红线 | 3 | 3/3 | 未新增导航层级、未改根路由、未移除其他 Feature 页面 |
| 6. 框架基线唯一性 | 1 | 1/1 | framework_source=`docs/design/preview-project/src/main.jsx` + `src/styles.css`；未读取历史 Feature preview 副本 |

### 全景对齐证据

- panorama_path：`/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260807022801-Profile-Password-Vault/docs/design`
- 全景宿主：OKWORK
- 风格与交互对照：
  1. `sitemap.md` 明确真实产品是 Electron 单窗口工作台；三个 Settings/OkBrowser 页面继续在既有工作台 shell 与 modal/window 中呈现，没有改成 Web 导航页。
  2. 三个 route 已由 WS-02 规划注册；本 Feature 只认领并收敛内容，不新增 IA 层级，也保持 `/` 的既有全景入口不变。
  3. 真实 `BrowserSettingsPage` 仍包含链接打开方式、内置浏览器承载方式和 Browser Profiles；全景先复现整页再加入 Vault，不画孤立 Profile 概念页。
  4. same-stack 交互遵守阶段规则：新建 Profile、搜索、筛选、删除、可信显示/复制和多账号切换均为页面内真实可点；dev 面板只切换 loading/error/empty 等难自然触达状态。
- 导航位置：Settings → Browser Settings → Browser Profiles / Saved Passwords；OkBrowser chrome → Password save/fill 状态。
- 全景变更类型：🟡 增量。

### 全景增量 diff

```diff
sitemap.md（由后续 panorama_sync 处理，本 Stage 不直接编辑）：
~ 三个既有 WS-02 route 的 Owner 从 planning 更新为 BL-006 Feature
~ Notes 从“远程权威/Cookie 漫游”收敛为“本机 Vault”；远程能力继续保留给 BL-007/BL-008

preview-project：
~ /settings/browser-profiles：复现完整 Browser Settings，并加入本机 Vault 与删除失败语义
~ /settings/browser-passwords：普通页面仅脱敏元数据；显示/复制进入隔离可信窗口
~ /browser/password-save-fill：移除 Host/Cookie 状态，补齐本机保存、填充、隔离和 fail-closed 状态
```

### 自查结论

✅ 自查通过；same-stack 构建成功，可进入用户预览确认。

## 补充洞察

- `project-specs/UI-RULES.md` 仍是未填充模板，因此本轮一致性依据采用真实页面源码、现有 preview-project shell/tokens 与 sitemap 约束；不在 Feature 内擅自定义新的 workspace 级视觉策略。
- “受信任密码窗口”是安全边界的产品表达，不是普通 Settings modal 的视觉变体。Blueprint 必须证明普通 main renderer 只能请求打开该窗口，不能直接触发单条解密或复制。
