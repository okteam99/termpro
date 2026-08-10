---
pages:
  - {id: settings-browser-profiles, title: "Browser Settings & Profiles"}
  - {id: browser-password-save-fill, title: "Password Auto-save, Fill & Login Continuity"}
panorama_medium: same-stack
panorama_path: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/docs/design
pages_changed:
  - page_id: settings-browser-profiles
    route_path: /settings/browser-profiles
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/docs/design/preview-project/src/main.jsx
    change_range: "在最新 520px 单列 Browser Settings 整页内增加远端 Profile 发现/加入、Storage location、登录连续性状态/脱敏报告及全局迁移删除确认"
    acceptance_criteria_refs: [AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10]
  - page_id: browser-password-save-fill
    route_path: /browser/password-save-fill
    panorama_file: /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/docs/design/preview-project/src/main.jsx
    change_range: "在既有独立 OkBrowser 整页内增加 hydration 等待/失败、登录状态已恢复及远程同步暂停的短反馈"
    acceptance_criteria_refs: [AC-1, AC-6, AC-9]
---

# Browser Profile 登录连续性 - UI 设计意图 & 追溯

> 🔴 全景宿主：OkWork
> 🔴 panorama_path: `/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/docs/design` · 全景权威根
> 🔴 panorama_medium: `same-stack` · `docs/design/preview-project` 与真实 renderer 使用同一 React/Vite 技术栈，并直接导入真实 shell 样式；运行 `preview.sh` 查看动态预览。
> 🟢 全景为唯一权威：本 Feature 不保存 preview 副本，页面布局、交互、状态与字段映射均以 preview-project 源为准。

## 状态

已确认（2026-08-11）

## UI-AC-COVERAGE（PRD AC 覆盖声明）

| AC.id | 描述摘要 | 对应页面 / same-stack 区块 | 覆盖状态 |
|-------|---------|---------------------------|---------|
| AC-1 | 发现并显式加入远端 Profile；首请求等待 hydration | `/settings/browser-profiles` `.browser-profile__available[data-ac]`；`/browser/password-save-fill` `.password-flow__hydration-gate[data-ac]` | ✅ UI 完整；协议需 RD 实现 |
| AC-2 | Profile 级持久 Cookie 跨出口对账，session-only 跳过 | Browser Profiles 登录连续性状态与跳过报告 | ⚠️ 后端规则需 RD 实现，UI 结果已覆盖 |
| AC-3 | 并发冲突确定裁决并显示脱敏结果 | Browser Profiles preset `冲突已处理` | ✅ UI 结果；裁决需 RD 实现 |
| AC-4 | 删除 tombstone 防旧值复活，允许更高 revision 重建 | 无新增用户操作面 | ⚠️ 纯一致性合同，需 RD/QA 实现验证 |
| AC-5 | v1/旧 Host、分页续传与超限兼容 | Browser Profiles preset `Host 需升级` 与 `Cookie 跳过项` | ✅ 用户降级体验；协议需 RD 实现 |
| AC-6 | 离线 journal、待同步数量与 hydration gate | 两页 `data-ac="AC-6"` 状态；Browser Profiles 离线态含待同步数量 | ✅ UI 完整；journal 需 RD 实现 |
| AC-7 | Cookie/journal/报告秘密边界 | `.browser-profile__sync-report[data-ac]` 只显示固定类别和数量 | ✅ UI 不含 Cookie identity/value；存储需 RD 实现 |
| AC-8 | 单项跳过、游标重试与计数去重 | Browser Profiles `Cookie 跳过项` 的可展开脱敏报告 | ✅ UI 完整；重试幂等需 RD/QA 验证 |
| AC-9 | Browser Profiles 主状态面；OkBrowser 短反馈；无气泡/AUTHORITY | 两个 pages_changed 页面 | ✅ |
| AC-10 | 全局 delete/move epoch 与 Remote→Local 终止共享 | 存储位置迁移对话框 `.authority-dialog__global-impact[data-ac]`；远端删除确认 | ✅ UI 完整；epoch 需 RD 实现 |

## 变更记录

| 日期 | 变更 | 影响的全景文件 |
|------|------|----------------|
| 2026-08-11 | v0.1：在 BL-007 最新全景上增量加入 BL-008 的发现/加入、登录连续性状态、脱敏报告、hydration gate 与全局迁移删除确认 | `docs/design/preview-project/src/main.jsx`、`src/latest-ui-sync.css` |
| 2026-08-11 | v0.2：用户确认两个预览页面；设计状态锁定，进入 L1 panorama_sync | 无视觉改动 |

---

## Designer 自查报告

### 检查结果汇总

| 维度 | 检查项 | 通过 | 备注 |
|------|------|----|----|
| 1. 全景对齐 | 4 | 4/4 | panorama_path 为 OkWork 全景；复用既有两个 route 与完整页面壳；未新增 IA |
| 2. 状态覆盖 | 4×2页 | 8/8 | Browser Profiles 覆盖 normal/loading/empty/error 及同步边缘态；OkBrowser 覆盖 normal/hydrating/restored/error/offline；难自然触达状态仅放右下角 dev 工具面板 |
| 3. PRD AC 覆盖 | 10 | 10/10 | 全部 AC 已声明；纯协议/一致性 AC 标注由 RD/QA 实现验证 |
| 4. 全景增量同步 | 4 | 4/4 | 类型：🟡 增量；两条既有 route 的内容变化将交 panorama_sync 更新 sitemap 描述与 Sync Log |
| 5. 结构性变更红线 | 3 | 3/3 | 未新增/删除/移动页面，未改路由层级，未改共享 token 或 shell |
| 6. 框架基线唯一性 | 1 | 1/1 | framework_source = `docs/design/preview-project/src/main.jsx` + `src/latest-ui-sync.css`；shell 样式直接导入 `src/renderer` 当前源 |

### 全景对齐证据

- panorama_path: `/Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260810151932-Browser-Profile-Login-Continuity/docs/design`
- 全景宿主：OkWork 当前 renderer / 独立 preview-project
- 风格对照：
  1. 保持最新 520px Browser Settings 单列弹窗，不恢复旧 850px 双列稿；新增内容落在既有 Profile row/detail 结构内。
  2. 保持中性黑灰 + 暖橙 token、真实 Workbench shell 与独立 OkBrowser 34/30/34 几何，不新增 accent、字体或共享 token。
  3. 保持网络出口与数据存储位置分离；Saved Passwords 仍是密码元数据页，不承担 Cookie 管理。
  4. 继续使用普通文本与行内状态，不增加说明气泡，不显示面向用户的 `AUTHORITY` 标识。
- 导航位置：`Settings → Browser Settings → Browser Profiles`；`OkBrowser → 当前 Profile 的运行时反馈`
- 全景变更类型：🟡 增量

#### 全景对齐校验

- medium: `same-stack`，HTML 校验按规范跳过。
- `npm run build`: PASS（Vite production build）。
- 浏览器自动视觉检查：当前浏览器控制连接不可用；same-stack 预览服务器仍可由用户直接打开，最终视觉确认保留在本 stage 授权暂停点。

### 全景增量 diff

```diff
sitemap.md（由 panorama_sync stage 处理）：
~ /settings/browser-profiles：从“Cookie 漫游留给 BL-008”更新为发现/加入、同步状态/报告与全局迁移删除结果
~ /browser/password-save-fill：从“兼容 Cookie 漫游留给 BL-008”更新为 hydration、恢复与暂停反馈

preview-project：
~ src/main.jsx：两张既有整页增加 BL-008 的真实可点交互和状态 presets
~ src/latest-ui-sync.css：复用现有 token 增加行内同步状态、脱敏报告和 hydration gate 样式
```

### 自查结论

✅ 自查通过 · 可进入用户确认设计稿

用户已于 2026-08-11 确认该设计稿。

## 🧩 补充洞察

登录连续性报告必须保持“数量 + 固定原因类别”层级。即使后续排障希望显示站点，也不能把 Cookie name、domain/path 或 value 送入普通 renderer；更深排障应通过不含秘密的固定错误码完成。
