---
pages:
  - {id: shell-close-install-confirmation, title: "Shell Close / Install Confirmation"}
panorama_medium: same-stack
panorama_path: docs/design
pages_changed:
  - page_id: shell-close-install-confirmation
    route_path: /shell/close-install-confirmation
    panorama_file: docs/design/preview-project/src/main.jsx
    change_range: "新增主窗口关闭、App Quit、升级安装确认与取消安装后可重试状态预览"
    acceptance_criteria_refs: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8]
---

# Close / Install Confirmation - UI 设计意图 & 追溯

> 全景宿主：TERMPRO
> panorama_path: docs/design
> panorama_medium: same-stack
> 直达预览路由：`/shell/close-install-confirmation`

## 状态
待确认

## 页面列表

| 页面 ID | 标题 | 路由 | 说明 |
|---------|------|------|------|
| shell-close-install-confirmation | Shell Close / Install Confirmation | `/shell/close-install-confirmation` | 在真实 workbench 壳中预览关闭确认、退出确认、安装确认、取消安装后可重试状态。 |

## 交互流

| 场景 | 用户触发 | UI 状态 | 结果 |
|------|----------|---------|------|
| Close Window | 红色关闭按钮、Close Window 或等价入口 | 居中确认弹窗；主工作台背景压暗但仍可识别；正文提示“关闭后再打开，Tab 内容可能丢失” | Cancel 保持窗口；Confirm 继续关闭窗口 |
| App Quit | App Quit / `Cmd+Q` | 同款确认弹窗；确认按钮使用危险色；正文提示“退出后再打开，Tab 内容可能丢失” | Cancel 保持应用；Confirm 继续退出 |
| Install Ready | 升级下载完成 | 安装确认弹窗；升级胶囊文案不再承诺自动重启 | Later 保持运行；Confirm 安装并重启 |
| Install Canceled | 安装确认取消后 | 无弹窗；底部状态卡和升级胶囊均表示可重试 | 用户可稍后重新点击升级 |

## 视觉规范

- 复用 TermPro 深色 token：`--bg`、`--bg-panel`、`--bg-active`、`--fg`、`--fg-dim`、`--accent`、`--amber`、`--red`、`--green`。
- 确认弹窗沿用 About 弹窗的 overlay/card 层级，但半径收敛到 8px，符合工具型界面密度。
- Close Window / App Quit 的正文必须明确提示关闭或退出后重新打开时 Tab 内容可能丢失，避免只写“窗口会关闭”导致风险感不足。
- 关闭确认与安装确认使用蓝色主操作；App Quit 使用红色确认按钮，突出退出应用的破坏性。
- 升级胶囊文案改为“下载后确认安装 / 可重新安装”，避免继续表达“完成后自动重启”。

## 字段映射

| PRD AC | UI 对应 |
|--------|---------|
| AC-1 | `Close Window` scenario + `.confirm-dialog` cancel/confirm buttons |
| AC-2 | `App Quit` scenario + danger confirm button |
| AC-3 | `Install Ready` scenario + install confirmation text |
| AC-4 | `Install Canceled` scenario + retryable update pill + status card |
| AC-5 | `Install Ready` scenario + “安装并重启” confirm path |
| AC-6 | Single overlay model; repeated triggers focus/retain current confirmation, not stack |
| AC-7 | Sidebar update pill copy in ready/retryable states |
| AC-8 | Terminal preview line documents `TERMPRO_SMOKE` bypass; no modal state for automation |

## UI-AC-COVERAGE

| AC.id | 描述摘要 | 对应页面 / HTML 区块 | 覆盖状态 |
|-------|---------|---------------------|---------|
| AC-1 | 主窗口关闭前确认，取消保持窗口 | `/shell/close-install-confirmation` close scenario `.confirm-dialog` | ✅ |
| AC-2 | App Quit 前确认，取消保持应用 | `/shell/close-install-confirmation` quit scenario `.confirm-dialog__button--danger` | ✅ |
| AC-3 | 安装重启前确认，取消不 quitAndInstall | `/shell/close-install-confirmation` install scenario | ✅ |
| AC-4 | 取消安装后恢复可重试 | `/shell/close-install-confirmation` retry scenario `.confirmation-status` + `.sidebar-update-pill--retryable` | ✅ |
| AC-5 | 确认安装后继续重启安装 | `/shell/close-install-confirmation` install scenario confirm button | ✅ |
| AC-6 | 不堆叠确认弹窗 | `/shell/close-install-confirmation` single overlay model | ✅ |
| AC-7 | 升级胶囊文案不承诺自动重启 | `/shell/close-install-confirmation` Sidebar update pill text | ✅ |
| AC-8 | `TERMPRO_SMOKE` 自动化绕过 | `/shell/close-install-confirmation` terminal smoke line | ✅ |

## 变更记录

| 日期 | 变更 | 影响的文件 |
|------|------|------------|
| 2026-06-14 | 新增 Close / Quit / Install confirmation same-stack preview route and sitemap entry | `docs/design/preview-project/src/main.jsx`, `docs/design/preview-project/src/styles.css`, `docs/design/sitemap.md` |

---

## Designer 自查报告

### 检查结果汇总

| 维度 | 检查项 | 通过 | 备注 |
|------|--------|------|------|
| 1. 全景对齐 | route / sitemap / shell / token | 4/4 | `docs/design/sitemap.md` 已登记 `/shell/close-install-confirmation` |
| 2. 状态覆盖 | close / quit / install / retry | 4/4 | same-stack scenario chips 可切换 4 态 |
| 3. PRD AC 覆盖 | AC-1..AC-8 | 8/8 | 见 UI-AC-COVERAGE |
| 4. 全景增量同步 | preview source / style / sitemap / UI.md | 4/4 | 类型：增量 |
| 5. 结构性变更红线 | 无导航重构 / 无新 shell / 无真实产品路由 | 3/3 | 仅设计预览路由 |
| 6. 框架基线唯一性 | preview-project 源 | 1/1 | framework_source = `docs/design/preview-project/src/main.jsx` |

### 全景对齐证据

- panorama_path: `docs/design`
- 全景宿主：TERMPRO
- 风格对照：
  1. 复用现有 workbench shell：Sidebar + TabBar + Terminal + FilePanel 未改变结构。
  2. 复用现有弹窗 overlay/card 语言：与 About 弹窗同层级，但按钮区更适合确认流。
  3. 复用现有升级胶囊位置：仍在 sidebar footer，不引入新导航入口。
- 导航位置：Design preview routes → `/shell/close-install-confirmation`
- 全景变更类型：增量

### 自查结论

✅ 自查通过，可进入用户确认设计稿。
