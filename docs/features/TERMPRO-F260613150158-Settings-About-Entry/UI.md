---
pages:
  - {id: sidebar-settings-about, title: "Sidebar 用户信息入口(Settings / About)"}
panorama_medium: same-stack
panorama_path: docs/design
pages_changed:
  - page_id: sidebar-settings-about
    route_path: /sidebar/settings-about-entry
    panorama_file: docs/design/preview-project/src/main.jsx
    change_range: "Sidebar 左下角 footer 新增用户信息入口行(头像占位 + Settings)+ 上弹菜单(仅 About)+ About 版本弹窗"
    acceptance_criteria_refs: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9]
---
# 左下角用户信息入口(Settings / About) - UI 设计意图 & 追溯

> 🔴 全景宿主:TERMPRO(单子项目)
> 🔴 panorama_path: `docs/design` · 全景权威根
> 🔴 panorama_medium: **same-stack**(`docs/design/preview-project` 同栈 React19+Vite 独立项目 · 源即全景权威 · 真实组件渲染 · 不污染真实工程)· 验证:`bash docs/design/preview-project/preview.sh` → 读 `PREVIEW_URL=` → browse `PREVIEW_URL` + `/sidebar/settings-about-entry`
> 🟢 全景为唯一权威:本 Feature 不存 preview/*.html 副本 · 直接在 `preview-project/src/main.jsx` 增量扩 Sidebar footer · `pages_changed[]` 声明本 Feature 新增的预览页。
> 🔴 分层同构(same-stack):基建层(app-shell / sidebar / 主题 token)沿用既有 preview-project 同一份;本 Feature 仅在页面层新增 SidebarFooter 意图四要素(布局/交互流/状态/字段)· 设计权威至该入口 ship 止。

## 状态
待评审

## 页面与交互意图(视觉真相以 preview-project 实时渲染为准)

### 入口行(常驻 · sidebar-footer)
- 位置:侧栏最底部 footer,垂直栈。自上而下:`[升级胶囊(仅有更新时)] → [用户信息入口行]`。
- 入口行内容(从左到右):**头像占位**(26px 圆形,中性 person 图标占位,无真实账户)→ **「Settings」** 文案(14px/600)→ (dev 构建时)**DEV 徽标** → **chevron ⌄**。
- 交互:hover 高亮(`--bg-active`);点击 → toggle 菜单;菜单打开时 chevron 旋转 180°。
- 复用 design token:`--bg-panel / --bg-active / --border / --fg / --fg-dim / --accent / --red`。

### 菜单(上弹 · 仅 About)
- 锚定入口**上方**(`bottom: 100% + 6px`),深色圆角面板(`--bg-panel` + `--border` + 阴影),与参考截图风格一致。
- 仅一个菜单项:`[info 图标] About`,hover 高亮。**字面一项 · 非数据驱动菜单框架**(对齐 PRD 实现约束)。
- 关闭:点击菜单外区域 / Esc(对齐通知中心交互)。

### About 版本弹窗
- 居中模态(遮罩 + 圆角卡片,参考 RenameModal 模式),覆盖全屏遮罩。
- 内容:应用 logo(圆角「T」)+ **TermPro** + **版本 {当前版本号}**(取自 `app.getVersion`,空 → 「版本未知」)+ 右上角 × 关闭。
- 关闭:× / 点遮罩 / Esc → 焦点回到先前聚焦元素。
- **交互单层**:点 About 时菜单先关、弹窗后开,两态不共存(对齐 PRD 交互细节约束)。

## 状态覆盖(4 态)
| 态 | 表现 |
|----|------|
| normal | 入口行常驻;菜单/弹窗关闭 |
| 菜单 open | 上弹菜单显示 About 一项;chevron 翻转 |
| 弹窗 open | About 版本弹窗显示;菜单已关 |
| error(版本读取失败) | 弹窗显示「版本未知」占位,不崩溃(AC-8) |
| (无 loading 态) | 版本同步可得 · 无异步加载态 |

## UI-AC-COVERAGE(PRD AC 覆盖声明 · 必填)

| AC.id | 描述摘要 | 对应页面 / 区块 | 覆盖状态 |
|-------|---------|----------------|---------|
| AC-1 | 入口行(头像占位 + Settings) | `.sidebar-footer .settings-entry` | ✅ 预览已渲染 |
| AC-2 | 点击展开菜单(仅 About)+ toggle | `.settings-menu` / `.settings-entry` onClick | ✅ |
| AC-3 | 点外部 / Esc 关闭菜单 | SidebarFooter useEffect(mousedown/Esc) | ✅ |
| AC-4 | 点 About 弹版本 + 关菜单 | `.settings-menu-item` onClick → AboutModal | ✅ |
| AC-5 | 版本取自真实版本(同步暴露) | AboutModal version prop(预览 mock 0.3.12) | ⚠️ 真实取值由 dev 接 preload `version` 实现 |
| AC-6 | 弹窗可关 + 焦点返还 | `.about-close` / 遮罩 / Esc | ✅(焦点返还由 dev 实现) |
| AC-7 | 入口 + DEV 徽标 + 升级胶囊共存不重叠 | `.sidebar-footer` 同级兄弟 | ✅ 预览三者同屏 |
| AC-8 | 版本读取失败 → 「版本未知」 | AboutModal `version ? ... : '版本未知'` | ✅ |
| AC-9 | 复用 design token + 风格一致 | styles.css 全用 `--*` token | ✅ |

## 变更记录
| 日期 | 变更 | 影响文件 |
|------|------|----------|
| 2026-06-13 | 新增 Sidebar footer 用户信息入口 + About 菜单 + 版本弹窗预览 | `docs/design/preview-project/src/main.jsx` · `styles.css` |

---

## Designer 自查报告

### 检查结果汇总
| 维度 | 检查项 | 通过 | 备注 |
|------|------|----|----|
| 1. 全景对齐 | 4 | 4/4 | panorama_path = docs/design · 宿主 = TERMPRO · 在既有 preview-project 上增量扩 |
| 2. 状态覆盖 | 4 | 4/4 | normal / 菜单 open / 弹窗 open / error(版本未知)· 无 loading(同步) |
| 3. PRD AC 覆盖 | 9 | 9/9 | 详 UI-AC-COVERAGE(AC-5/AC-6 真实取值与焦点返还归 dev 实现) |
| 4. 全景增量同步 | — | 🟡 增量 | 新增预览路由节点 `/sidebar/settings-about-entry` → sitemap 需登记(panorama_sync 处理) |
| 5. 结构性变更红线 | 3 | 3/3 | 未改既有路由 / 未顶掉首页 / router 保留(KNOWN_ROUTES 新增叶子节点) |
| 6. 框架基线唯一性 | 1 | 1/1 | framework_source = 既有 `docs/design/preview-project`(同栈)· 非历史 Feature 副本 |

### 全景对齐证据
- panorama_path: `docs/design`
- 全景宿主:TERMPRO(单子项目)
- 风格对照(read sitemap.md + 既有 preview-project 后摘录):
  1. 真实产品是 single-window Electron workbench(Sidebar / TabBar / Terminal / File Panel)· 本入口挂 Sidebar footer,符合工作台结构。
  2. 全部复用既有 design token(`--bg-panel/--bg-active/--border/--fg/--fg-dim/--accent`),与 workbench 暗色一致。
  3. 新预览节点登记 route + page id + owner feature(sitemap IA Notes 要求)。
- 导航位置:preview-project 新增叶子路由 `/sidebar/settings-about-entry`(`/` 与既有 file-panel 路由不变)。
- 全景变更类型:🟡 增量(新增可预览叶子节点)。

### 自查结论
✅ 自查通过 · 可进入 ⏸️ 用户确认设计稿(预览实时渲染三态已 browse 截图核对:入口 / 菜单 / About 弹窗均符合参考截图风格)
