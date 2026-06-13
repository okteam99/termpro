---
pages:
  - {id: terminal-file-panel-location, title: "Terminal Path Links Locate In File Panel"}
panorama_medium: same-stack
panorama_path: docs/design
pages_changed:
  - page_id: terminal-file-panel-location
    route_path: /terminal/file-panel-path-location
    panorama_file: docs/design/preview-project/src/main.jsx
    change_range: "Terminal fs link activation updates the active tab File Panel mode, expansion chain, scroll target, and transient row highlight."
    acceptance_criteria_refs: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10]
---
# Terminal Path Links Locate In File Panel - UI Design

> 全景宿主: TERMPRO
> panorama_path: `docs/design`
> panorama_medium: `same-stack`

## 状态
待用户预览确认

## 页面列表

| Page ID | Title | Route | Preview Source |
|---------|-------|-------|----------------|
| terminal-file-panel-location | Terminal Path Links Locate In File Panel | `/terminal/file-panel-path-location` | `docs/design/preview-project/src/main.jsx` |

## 交互流

1. 用户在当前 active tab 的 Terminal 中点击文件路径链接。
2. Terminal 保持当前会话上下文不跳外部窗口，先把已解析路径交给当前 tab 的 File Panel 定位逻辑。
3. 若当前 File Panel mode 能容纳目标路径，mode 不变，只展开 ancestor chain 并滚动到目标。
4. 若当前 mode 不能容纳目标路径，File Panel 按 WorkTree -> Root 的内部优先级切换到可容纳 mode。
5. 文件目标行进入视口后显示 transient highlight；目录目标展开自身；target 等于 effective root 时不制造 row highlight。
6. 若内部定位失败，File Panel 不改变 mode、root/worktree binding 或 expanded state，回到既有 viewer/system fallback。

## 视觉规范

| 区域 | 设计决策 |
|------|----------|
| Terminal link | 延续 xterm 链接外观：路径用 accent 色和下划线表达可点击，不新增 agent 专属解析 UI。 |
| File Panel mode | 使用既有 Root / WorkTree segmented control；内部 fallback 切换 mode 时只改变 active segment，不新增弹窗。 |
| Expansion | 使用既有 tree arrow、indent、git status color。祖先链展开后保持原树密度。 |
| Target row | 目标文件行使用 1px accent inset + 低饱和蓝色背景，避免遮盖 git status 颜色；highlight 为 transient 状态。 |
| Failure fallback | 不新增错误 toast；外部/viewer fallback 走既有行为，File Panel 视觉保持不变。 |

## 字段映射

| UI 状态 | 数据来源 / 实现对象 |
|---------|---------------------|
| Active workspace/tab | `selectActiveWorkspace` + `workspace.activeTabId` |
| File Panel mode | `TabFilePanelState.mode` |
| Root binding | `TabFilePanelState.rootPath` or `autoRoot` |
| WorkTree binding | `TabFilePanelState.worktreePath` or `autoWorktree` |
| Expanded rows | `TabFilePanelState.expanded` applied under the effective root |
| Target highlight | New transient locate target state, cleared by interaction, refresh, tab switch, or newer locate request |
| Fallback unchanged | Existing `openViewerWindow`, `openPath`, `openInBrowser`, and related system fallback paths |

## UI-AC-COVERAGE

| AC.id | 描述摘要 | 对应页面 / 区块 | 覆盖状态 |
|-------|---------|----------------|----------|
| AC-1 | Terminal fs link 先尝试内部 File Panel handling | `/terminal/file-panel-path-location` Terminal link -> File Panel locate flow | ✅ |
| AC-2 | WorkTree mode 内部命中时保持 WorkTree 并展开定位 | WorkTree scenario, active segment and highlighted `FilePanel.tsx` row | ✅ |
| AC-3 | Root mode 内部命中时保持 Root 并展开定位 | Root scenario, path input and highlighted `GLOSSARY.md` row | ✅ |
| AC-4 | 当前 mode 不可容纳时 WorkTree -> Root 优先切换 | Scenario controls and preview state variants | ✅ |
| AC-5 | 目录展开自身，文件滚动/高亮，root target 不高亮 | Tree row states and design notes | ✅ |
| AC-6 | 内部定位为 location-only，不打开 viewer/system opener | Preview has no auto-open content pane after click | ✅ |
| AC-7 | file:// / relative / line-col 保持解析，line-col 只用于 stripped path | Terminal link examples include `:81:5` display with row location only | ✅ |
| AC-8 | containment 与 displayed tree path 使用一致表示 | UI notes constrain display path and tree expansion state | ✅ |
| AC-9 | 内部失败后不改变 File Panel，走既有 fallback | External fallback scenario keeps previous File Panel state | ✅ |
| AC-10 | newer activation wins, stale highlight ignored and transient clear | Preview state model exposes last selected scenario and transient target styling | ✅ |

## 变更记录

| 日期 | 变更 | 影响的预览源 |
|------|------|--------------|
| 2026-06-13 | 首版 UI 设计：same-stack preview-project seed + Terminal link -> File Panel locate 可见状态 | `docs/design/preview-project/src/main.jsx`, `docs/design/preview-project/src/styles.css` |

---

## Designer 自查报告

### 检查结果汇总

| 维度 | 检查项 | 通过 | 备注 |
|------|--------|------|------|
| 1. 全景对齐 | same-stack preview-project, route, root entry, visual tokens | 4/4 | `docs/design/preview-project` 首次 seed；使用 React + Vite，与真实渲染层同栈。 |
| 2. 状态覆盖 | normal, WorkTree hit, Root hit, external fallback | 4/4 | 本 Feature 不是独立页面，而是工作台局部交互；四态覆盖 PRD 关键路径。 |
| 3. PRD AC 覆盖 | AC-1..AC-10 | 10/10 | 详 UI-AC-COVERAGE。 |
| 4. 全景增量同步 | route, preview source, UI.md pages_changed, no sitemap mutation | 4/4 | 首次 seed panorama，未直接改 sitemap。 |
| 5. 结构性变更红线 | 无新增产品导航、无新编辑器、无 agent 绑定 | 3/3 | 仅定义现有 Terminal + File Panel 的定位状态。 |
| 6. 框架基线唯一性 | framework_source = `docs/design/preview-project` | 1/1 | 无历史 Feature preview 副本。 |

### 全景对齐证据

- panorama_path: `docs/design`
- 全景宿主: TERMPRO
- 风格对照:
  1. 三栏 app shell: Sidebar / Terminal / File Panel，沿用 `src/renderer/App.tsx`。
  2. File Panel Root / WorkTree segmented control、path input、worktree select 和 dense tree row 密度，沿用 `src/renderer/components/FilePanel.tsx` 与 `FilePanel.css`。
  3. 主题 token: `--bg`, `--bg-panel`, `--bg-active`, `--fg`, `--fg-dim`, `--accent`, `--border`，沿用 `src/renderer/index.css`。
- 导航位置: 单窗口工作台局部交互；预览路由 `/terminal/file-panel-path-location`。
- 全景变更类型: 🟡 增量。首次创建 `docs/design/preview-project` 作为后续 UI 全景权威。

### same-stack 预览校验

```bash
bash docs/design/preview-project/preview.sh
```

- verdict: OK
- PREVIEW_URL: `http://localhost:64956/terminal/file-panel-path-location`
- build: `npm run build` PASS
- screenshot: `/tmp/teamwork/TERMPRO-F260613053134-Terminal-Path-FilePanel/screenshots/terminal-file-panel-location.png`
- notes: Chrome headless captured the route at 1440x900. The app shell, Terminal link, active WorkTree segment, expanded ancestor chain, and target row highlight rendered without blank canvas or visible overlap.

### 自查结论

✅ 自查通过，可进入用户预览确认。
