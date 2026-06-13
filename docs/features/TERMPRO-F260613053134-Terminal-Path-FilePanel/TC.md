---
feature_id: "TERMPRO-F260613053134-Terminal-Path-FilePanel"
status: pending_review
tests:
  - id: T-001
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: routes_active_tab_fs_link_to_file_panel_before_fallback
    covers_ac: ["AC-1", "AC-6"]
    level: unit
    priority: P0
  - id: T-002
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: locates_file_inside_current_worktree_without_switching_mode
    covers_ac: ["AC-2", "AC-5", "AC-6"]
    level: unit
    priority: P0
  - id: T-003
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: locates_file_inside_current_root_without_switching_mode
    covers_ac: ["AC-3", "AC-5", "AC-6"]
    level: unit
    priority: P0
  - id: T-004
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: switches_to_worktree_before_root_when_current_mode_cannot_contain_target
    covers_ac: ["AC-4", "AC-6"]
    level: unit
    priority: P0
  - id: T-005
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: expands_directory_target_itself_and_treats_effective_root_as_located
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-006
    file: src/renderer/terminal/__tests__/terminalLinkParse.test.ts
    function: keeps_existing_file_url_absolute_home_relative_and_line_col_resolution
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-007
    file: src/renderer/filepanel/__tests__/pathContainment.test.ts
    function: rejects_untrusted_or_unmappable_containment
    covers_ac: ["AC-8", "AC-9"]
    level: unit
    priority: P0
  - id: T-008
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: falls_back_without_mutating_mode_bindings_or_expansion_when_locate_cannot_complete
    covers_ac: ["AC-9"]
    level: unit
    priority: P0
  - id: T-009
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: newer_locate_request_wins_and_clears_stale_highlight
    covers_ac: ["AC-10"]
    level: unit
    priority: P1
  - id: T-010
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: falls_back_transactionally_when_mid_chain_readdir_fails
    covers_ac: ["AC-9"]
    level: unit
    priority: P0
  - id: T-011
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: switches_from_worktree_to_root_when_target_is_only_in_root
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: T-012
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: locate_view_state_is_runtime_only_and_not_serialized
    covers_ac: ["AC-10"]
    level: unit
    priority: P1
  - id: T-013
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: inactive_tab_link_uses_existing_fallback_without_mutating_active_panel
    covers_ac: ["AC-1", "AC-9"]
    level: unit
    priority: P0
  - id: T-014
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: target_equal_effective_root_succeeds_without_row_highlight
    covers_ac: ["AC-5"]
    level: unit
    priority: P0
  - id: T-015
    file: src/host/__tests__/fsService.test.ts
    function: realpath_returns_null_on_missing_or_unreadable_path
    covers_ac: ["AC-8", "AC-9"]
    level: unit
    priority: P0
  - id: T-016
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: locate_false_uses_terminal_fallback_opener_context
    covers_ac: ["AC-6", "AC-9"]
    level: unit
    priority: P0
  - id: T-017
    file: src/renderer/filepanel/__tests__/locateTarget.integration.test.ts
    function: cross_mode_locate_commits_tree_watch_status_and_mode_atomically
    covers_ac: ["AC-4", "AC-5", "AC-10"]
    level: integration
    priority: P0
  - id: T-018
    file: src/renderer/filepanel/__tests__/locateTarget.integration.test.ts
    function: cross_mode_locate_failure_preserves_mode_tree_watch_status_and_expansion
    covers_ac: ["AC-4", "AC-9"]
    level: integration
    priority: P0
  - id: T-019
    file: src/renderer/components/__tests__/FilePanel.locate.test.tsx
    function: file_panel_renders_locate_highlight_scrolls_and_clears_on_interaction
    covers_ac: ["AC-5", "AC-10"]
    level: component
    priority: P1
  - id: T-020
    file: src/renderer/filepanel/__tests__/pathContainment.test.ts
    function: display_path_inside_root_but_realpath_escape_is_rejected
    covers_ac: ["AC-8", "AC-9"]
    level: unit
    priority: P0
  - id: T-021
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: repository_system_open_extension_locates_without_opener_when_handler_succeeds
    covers_ac: ["AC-1", "AC-6"]
    level: unit
    priority: P0
  - id: T-022
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: missing_target_row_returns_false_without_mutating_panel
    covers_ac: ["AC-9"]
    level: unit
    priority: P0
  - id: T-023
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: macos_case_and_unicode_segments_match_readdir_entries
    covers_ac: ["AC-5", "AC-8"]
    level: unit
    priority: P0
  - id: T-024
    file: src/renderer/components/__tests__/FilePanel.locate.test.tsx
    function: offscreen_locate_row_scrolls_into_view_without_virtualization
    covers_ac: ["AC-5"]
    level: component
    priority: P0
  - id: T-025
    file: src/renderer/filepanel/__tests__/locateTarget.integration.test.ts
    function: locate_commit_preserves_live_cache_updates_from_watcher
    covers_ac: ["AC-10"]
    level: integration
    priority: P1
  - id: T-026
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: worktree_locate_reuses_partial_cache_without_switching_mode
    covers_ac: ["AC-2", "AC-5"]
    level: unit
    priority: P1
  - id: T-027
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: root_locate_reuses_partial_cache_without_switching_mode
    covers_ac: ["AC-3", "AC-5"]
    level: unit
    priority: P1
  - id: T-028
    file: src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
    function: locate_handler_reject_uses_terminal_fallback_without_mutating_panel
    covers_ac: ["AC-9"]
    level: unit
    priority: P0
  - id: T-029
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: non_current_linked_worktree_under_root_locates_in_root_mode
    covers_ac: ["AC-4"]
    level: unit
    priority: P0
  - id: T-030
    file: src/renderer/terminal/__tests__/terminalLinkParse.test.ts
    function: file_url_path_form_resolves_for_file_panel_location
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-031
    file: src/renderer/terminal/__tests__/terminalLinkParse.test.ts
    function: absolute_path_form_resolves_for_file_panel_location
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-032
    file: src/renderer/terminal/__tests__/terminalLinkParse.test.ts
    function: home_path_form_resolves_for_file_panel_location
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-033
    file: src/renderer/terminal/__tests__/terminalLinkParse.test.ts
    function: relative_path_form_resolves_for_file_panel_location
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-034
    file: src/renderer/terminal/__tests__/terminalLinkParse.test.ts
    function: line_col_suffix_is_stripped_without_line_navigation
    covers_ac: ["AC-7"]
    level: unit
    priority: P1
  - id: T-035
    file: src/renderer/filepanel/__tests__/locateTarget.integration.test.ts
    function: cwd_drift_during_locate_stales_request_and_preserves_new_root
    covers_ac: ["AC-10"]
    level: integration
    priority: P0
  - id: T-036
    file: src/renderer/components/__tests__/FilePanel.locate.test.tsx
    function: watcher_rerender_does_not_repeat_scroll_while_highlight_remains
    covers_ac: ["AC-5", "AC-10"]
    level: component
    priority: P0
  - id: T-037
    file: src/renderer/filepanel/__tests__/locateTarget.test.ts
    function: in_root_symlink_uses_display_segments_not_realpath_sibling
    covers_ac: ["AC-8"]
    level: unit
    priority: P1
---
# Terminal Path Links Open In File Panel - Test Cases

## 状态
待评审

## Feature

作为同时运行多个 CLI agent 的开发者，
我希望终端输出里的本项目文件路径点击后直接定位到右侧 File Panel，
以便在同一个 TermPro 工作面里查看目录上下文、git 状态和后续 diff。

## 需求覆盖矩阵

| AC ID | 需求描述 | 优先级 | 覆盖测试 | 状态 |
|-------|----------|--------|----------|------|
| AC-1 | active tab fs link 先尝试内部 File Panel handling | P0 | T-001, T-013, T-021 | ✅ |
| AC-2 | WorkTree mode 命中 current WorkTree root 时保持 mode 并展开定位 | P0 | T-002, T-026 | ✅ |
| AC-3 | Root mode 命中 current Root 且无更具体 WorkTree 时保持 mode 并展开定位 | P0 | T-003, T-027 | ✅ |
| AC-4 | 嵌套命中时选最具体 root / WorkTree 优先；必要时 WorkTree <-> Root 切换 | P0 | T-004, T-011, T-017, T-018, T-029 | ✅ |
| AC-5 | 目录展开自身，文件滚动/高亮，target=root 不高亮 | P0 | T-002, T-003, T-005, T-014, T-017, T-019, T-023, T-024, T-026, T-027, T-036 | ✅ |
| AC-6 | 内部定位为 location-only，不自动打开 viewer/system opener | P0 | T-001, T-002, T-003, T-004, T-016, T-021 | ✅ |
| AC-7 | file:// / abs / home / relative / :line:col 解析不回退 | P1 | T-006, T-030, T-031, T-032, T-033, T-034 | ✅ |
| AC-8 | containment 使用一致显示路径表示，untrusted realpath fallback | P0 | T-007, T-015, T-020, T-023, T-037 | ✅ |
| AC-9 | 内部定位失败时走既有 fallback 且不改 File Panel | P0 | T-007, T-008, T-010, T-013, T-015, T-016, T-018, T-020, T-022, T-028 | ✅ |
| AC-10 | newer activation wins，stale expansion/highlight ignored；runtime locate view 不持久化重放 | P1 | T-009, T-012, T-017, T-019, T-025, T-035, T-036 | ✅ |

覆盖率: 10 / 10 (100%)

## 测试场景

### Scenario: T-001 active terminal fs link first attempts File Panel location
**优先级**: P0
**类型**: 功能
**测试层级**: unit

```gherkin
Given the active workspace has active tab "t1"
 And terminal link resolution returns existing file "/repo/src/renderer/App.tsx"
When the fs link is activated from tab "t1"
Then TermPro calls the File Panel locate handler for tab "t1" before fallback
 And TermPro does not call openViewerWindow
 And TermPro does not call openPath
```

### Scenario: T-002 locate file inside current WorkTree mode
**优先级**: P0
**类型**: 功能
**测试层级**: unit

```gherkin
Given File Panel mode is "worktree"
 And effective WorkTree root is "/repo/.worktree/feature-a"
 And target file is "/repo/.worktree/feature-a/src/renderer/components/FilePanel.tsx"
When the locate request is processed
Then File Panel remains in "worktree" mode
 And it loads "src", "src/renderer", and "src/renderer/components" in order
 And it expands the parent chain
 And it marks "FilePanel.tsx" as the transient locate target
 And openViewerWindow is not called
 And openPath is not called
```

### Scenario: T-003 locate file inside current Root mode
**优先级**: P0
**类型**: 功能
**测试层级**: unit

```gherkin
Given File Panel mode is "root"
 And effective Root path is "/repo"
 And target file is "/repo/project-specs/GLOSSARY.md"
 And the target is not inside a more specific effective WorkTree root
When the locate request is processed
Then File Panel remains in "root" mode
 And it expands "/repo/project-specs"
 And it marks "GLOSSARY.md" as the transient locate target
 And openViewerWindow is not called
 And openPath is not called
```

### Scenario: T-004 nested WorkTree is more specific than enclosing Root
**优先级**: P0
**类型**: 功能
**测试层级**: unit

```gherkin
Given File Panel mode is "root"
 And effective Root path is "/repo"
 And effective WorkTree root is "/repo/.worktree/feature-a"
 And target file is "/repo/.worktree/feature-a/src/index.ts"
When the locate request is processed
Then File Panel mode switches to "worktree"
 And rootPath and worktreePath bindings are not overwritten by auto-derived roots
 And expansion state is applied under "/repo/.worktree/feature-a"
 And openViewerWindow is not called
 And openPath is not called
```

### Scenario: T-005 directory target expands itself
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given target path is an internal directory "/repo/src/renderer"
When the locate request is processed
Then the ancestor chain is expanded
 And "/repo/src/renderer" itself is expanded
 And "/repo/src/renderer" is marked as the transient locate target
 And "/repo/src/renderer" is scrolled into view
```

### Scenario: T-006 existing terminal path parsing stays compatible
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given terminal output contains file://, absolute, home, relative, and :line:col path forms
When candidates are extracted and resolved
Then the existing supported forms still resolve to the same stripped file paths
 And :line:col suffixes are not reported as editor navigation behavior
```

Implementation note: keep T-006 as the compatibility umbrella, and implement T-030 through T-034 as independent path-form subcases so failures identify the exact path form.

### Scenario: T-007 containment rejects untrusted display path mapping
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given target path and candidate roots have normalized display paths
When exact separator-aware containment succeeds
Then the candidate root can be used for File Panel location
When realpath proves a path is inside a root but cannot map back to the displayed tree path
Then internal location is rejected
 And the File Panel locate handler returns false
When fs.realpath returns null for target or root
Then internal location is rejected
 And the File Panel locate handler returns false
```

### Scenario: T-008 locate failure preserves File Panel state
**优先级**: P0
**类型**: 异常
**测试层级**: unit

```gherkin
Given File Panel mode is "worktree"
 And worktreePath is "/repo/.worktree/feature-a"
 And expanded contains "/repo/.worktree/feature-a/src"
When locating "/tmp/build-report.html" cannot be handled internally
Then mode remains "worktree"
 And worktreePath remains "/repo/.worktree/feature-a"
 And expanded remains unchanged
 And the File Panel locate handler returns false so terminalLinks can invoke existing fallback
```

### Scenario: T-009 newer locate request wins
**优先级**: P1
**类型**: 并发
**测试层级**: unit

```gherkin
Given locate request A is loading ancestor directories
When locate request B starts before A finishes
Then stale effects from A are ignored
 And only B can set the final expanded chain and transient highlight
When the user toggles a directory, refreshes, switches tab, or starts request C
Then B's transient highlight is cleared
```

Implementation note: implement the second half as parameterized subcases for each clear trigger.

| trigger | expected |
|---------|----------|
| user toggles a directory | highlight clears and request B becomes stale |
| user refreshes File Panel | highlight clears and request B becomes stale |
| user switches tab | highlight clears and request B becomes stale |
| locate request C starts | highlight clears and request B becomes stale |

### Scenario: T-010 mid-chain directory load failure is transactional
**优先级**: P0
**类型**: 异常
**测试层级**: unit

```gherkin
Given File Panel mode is "worktree"
 And effective WorkTree root is "/repo/.worktree/feature-a"
 And expanded initially contains "/repo/.worktree/feature-a/src"
When locating "/repo/.worktree/feature-a/src/deep/file.ts" loads "src" successfully
 And loading "src/deep" fails
Then File Panel returns false
 And mode remains "worktree"
 And worktreePath remains unchanged
 And expanded is exactly the original set
 And directory cache is exactly the original cache
 And no locate highlight is set
```

### Scenario: T-011 target only in Root switches from WorkTree to Root
**优先级**: P0
**类型**: 功能
**测试层级**: unit

```gherkin
Given File Panel mode is "worktree"
 And effective WorkTree root is "/repo/.worktree/feature-a"
 And effective Root path is "/repo"
 And target file is "/repo/docs/DEV.md"
When the locate request is processed
Then File Panel mode switches to "root"
 And rootPath and worktreePath bindings are not overwritten by auto-derived roots
 And expansion state is applied under "/repo"
 And "DEV.md" is marked as the transient locate target
```

### Scenario: T-012 locate view state is runtime-only
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given FilePanelController has activeLocateRequestId 42
 And locateHighlightPath is "/repo/src/App.tsx"
 And locateScrollPath is "/repo/src/App.tsx"
When the app state is converted to PersistedState
Then PersistedTab for "t1" does not contain activeLocateRequestId
 And it does not contain locateHighlightPath
 And it does not contain locateScrollPath
When the persisted state is hydrated
Then no stale locate highlight is replayed
```

### Scenario: T-013 inactive tab link does not mutate active File Panel
**优先级**: P0
**类型**: 异常
**测试层级**: unit

```gherkin
Given workspace "w1" has active tab "t1"
 And hidden tab "t2" owns a terminal instance
When a fs link is activated from tab "t2"
Then no File Panel locate handler is called
 And the active tab File Panel state is unchanged
 And terminalLinks invokes existing fallback handling for the target path
```

### Scenario: T-014 target equal to effective root has no row highlight
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given File Panel mode is "root"
 And effective Root path is "/repo"
When locating target path "/repo"
Then the request succeeds
 And no row is highlighted
 And no scroll target is set
```

### Scenario: T-015 host realpath is safe-null on failure
**优先级**: P0
**类型**: 异常
**测试层级**: unit

```gherkin
Given fsService.realpath is called for a missing path
Then it returns { path: null }
When pathContainment receives a null realpath for target or root
Then internal location is rejected
 And the File Panel locate handler returns false so terminalLinks can use existing fallback
```

### Scenario: T-016 terminal owns fallback when File Panel cannot locate
**优先级**: P0
**类型**: 异常
**测试层级**: unit

```gherkin
Given terminalLinks resolved "/repo/archive.zip" as an existing file
 And the registered File Panel locate handler returns false
When the fs link is activated
Then terminalLinks calls the original fallback opener for "/repo/archive.zip"
 And FilePanel does not reconstruct fallback behavior from a reduced locate request
```

### Scenario: T-017 cross-mode locate commits atomically
**优先级**: P0
**类型**: 集成
**测试层级**: integration

```gherkin
Given File Panel runtime mode is "root"
 And effective Root path is "/repo"
 And effective WorkTree root is "/repo/.worktree/feature-a"
 And target file is "/repo/.worktree/feature-a/src/index.ts"
 And a previous watcher and git status belong to "/repo"
When locateTarget preloads the full ancestor chain successfully
Then reducer receives one locateCommit transaction
 And runtime mode becomes "worktree"
 And topEntries, cache, expanded, locateHighlightPath, and locateScrollPath are committed together
 And store mode persistence happens after the runtime commit
 And the subsequent inputs echo from store does not trigger applyRootChange tree reset
 And old watch is stopped, new worktree watch is started, and git status is fetched for the worktree root
```

### Scenario: T-018 cross-mode locate failure preserves old tree
**优先级**: P0
**类型**: 异常
**测试层级**: integration

```gherkin
Given File Panel runtime mode is "root"
 And effective Root path is "/repo"
 And effective WorkTree root is "/repo/.worktree/feature-a"
 And expanded, cache, statusMap, dirtyDirs, and watchId belong to "/repo"
When locating "/repo/.worktree/feature-a/src/deep/file.ts" loads an ancestor then fails before locateCommit
Then runtime mode remains "root"
 And effectiveRoot remains "/repo"
 And expanded, cache, statusMap, dirtyDirs, and watchId are unchanged
 And store mode is not persisted as "worktree"
 And terminalLinks can invoke existing fallback
```

### Scenario: T-019 FilePanel renders and clears locate highlight
**优先级**: P1
**类型**: 组件
**测试层级**: component

```gherkin
Given Element.prototype.scrollIntoView is spied or stubbed
 And FilePanelView exposes locateHighlightPath and locateScrollPath for "/repo/src/App.tsx"
 And the target row is initially outside the visible scroll area but still rendered in the non-virtualized flattened tree
When FilePanel renders a row for "/repo/src/App.tsx"
Then that row has the locate target class
 And scrollIntoView is called for that row
When the user toggles a directory or refreshes the panel
Then clearLocateHighlight is called
 And the row no longer has the locate target class
```

### Scenario: T-020 realpath escape is rejected
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given displayed target path is "/repo/vendor/link/file.ts"
 And displayed containment says it is inside "/repo"
When fs.realpath resolves the target outside the root, such as "/private/tmp/file.ts"
Then internal location is rejected
 And the File Panel locate handler returns false
```

### Scenario: T-021 repository system-open extension remains location-only
**优先级**: P0
**类型**: 回归
**测试层级**: unit

```gherkin
Given terminalLinks resolved "/repo/archive.zip" as an existing file
 And "/repo/archive.zip" is inside the active File Panel root
 And the registered File Panel locate handler returns true
When the fs link is activated
Then terminalLinks does not call openPath
 And it does not call openViewerWindow
 And the result is only File Panel location
```

### Scenario: T-022 missing target row returns false without mutation
**优先级**: P0
**类型**: 异常
**测试层级**: unit

```gherkin
Given activation-time stat succeeded for "/repo/src/Gone.tsx"
 And File Panel mode is "root"
 And effective Root path is "/repo"
 And expanded and cache contain the original File Panel state
When locateTarget reads "/repo" and "/repo/src" successfully
 And the "Gone.tsx" row is absent from "/repo/src" entries
Then locateTarget returns false
 And mode, bindings, expanded, and cache remain unchanged
 And no locate highlight or scroll path is set
 And terminalLinks can invoke existing fallback
```

### Scenario: T-023 macOS case and Unicode normalized row matching
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given target path is "/repo/SRC/Café.tsx" in NFC form
 And host realpath maps it to "/repo/src/Café.tsx" under the same displayed root
 And readdir returns entries "src" and "Café.tsx" using disk casing / Unicode form
When locateTarget processes the request on darwin after stat/realpath trust succeeds
Then row matching uses the canonical display path plus NFC normalization
 And the file is located and highlighted without falling back
```

### Scenario: T-024 offscreen locate row scrolls into view
**优先级**: P0
**类型**: 组件
**测试层级**: component

```gherkin
Given Element.prototype.scrollIntoView is spied or stubbed
 And FilePanel renders a large non-virtualized flattened tree
 And locateScrollPath points to a rendered row below the initial scroll viewport
When FilePanel receives the locate view state
Then the target row receives the locate target class
 And scrollIntoView is called on the target row
```

### Scenario: T-025 locate commit preserves live cache updates
**优先级**: P1
**类型**: 并发
**测试层级**: integration

```gherkin
Given locateTarget is loading a same-root ancestor chain
 And a watcher refresh updates cache for "/repo/src" before locateCommit
When locateCommit runs with its pending cache delta
Then the live watcher cache update is preserved
 And only missing ancestor entries from the locate transaction are merged
 And the locate highlight is applied for the target
```

### Scenario: T-026 WorkTree locate reuses partial cache without mode switch
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given File Panel mode is "worktree"
 And effective WorkTree root is "/repo/.worktree/feature-a"
 And cache already contains "/repo/.worktree/feature-a/src"
When locating "/repo/.worktree/feature-a/src/renderer/App.tsx"
Then File Panel remains in "worktree" mode
 And cached entries are reused without a mode switch
 And only missing ancestor levels are loaded
```

### Scenario: T-027 Root locate reuses partial cache without mode switch
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given File Panel mode is "root"
 And effective Root path is "/repo"
 And cache already contains "/repo/docs"
When locating "/repo/docs/PRD.md"
Then File Panel remains in "root" mode
 And cached entries are reused without a mode switch
 And only missing ancestor levels are loaded
```

### Scenario: T-028 locate handler reject falls back
**优先级**: P0
**类型**: 异常
**测试层级**: unit

```gherkin
Given terminalLinks resolved "/repo/src/App.tsx" as an existing file
 And the registered File Panel locate handler rejects its promise
When the fs link is activated
Then terminalLinks catches the rejection
 And terminalLinks calls the original fallback opener for "/repo/src/App.tsx"
 And File Panel mode, bindings, expanded, and cache are unchanged
```

### Scenario: T-029 non-current linked worktree under Root locates in Root mode
**优先级**: P0
**类型**: 边界
**测试层级**: unit

```gherkin
Given File Panel mode is "root"
 And effective Root path is "/repo"
 And current effective WorkTree root is "/repo/.worktree/feature-a"
 And another linked worktree path is "/repo/.worktree/feature-b"
 And Root mode does not filter ".worktree"
When locating "/repo/.worktree/feature-b/src/App.tsx"
Then File Panel remains in "root" mode
 And the tree expands ".worktree/feature-b/src"
 And "App.tsx" is marked as the transient locate target
```

### Scenario: T-030 file URL path form resolves
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given terminal output contains a file:// URL for an existing repo file
When candidates are extracted and resolved
Then the resolved path is the decoded absolute file path used for File Panel location
```

### Scenario: T-031 absolute path form resolves
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given terminal output contains an absolute path for an existing repo file
When candidates are extracted and resolved
Then the resolved path is the absolute file path used for File Panel location
```

### Scenario: T-032 home path form resolves
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given terminal output contains a "~/" path for an existing repo file under the home directory
When candidates are extracted and resolved
Then the resolved path expands "~" before File Panel location
```

### Scenario: T-033 relative path form resolves
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given terminal output contains a relative path
 And the terminal working directory is inside the repo
When candidates are extracted and resolved
Then the resolved path is joined against the terminal working directory before File Panel location
```

### Scenario: T-034 line/column suffix is stripped without navigation
**优先级**: P1
**类型**: 回归
**测试层级**: unit

```gherkin
Given terminal output contains "src/App.tsx:10:2"
When candidates are extracted and resolved
Then the resolved path is "src/App.tsx"
 And File Panel location receives only the stripped file path
 And no editor line navigation behavior is reported
```

### Scenario: T-035 cwd drift stales in-flight locate
**优先级**: P0
**类型**: 并发
**测试层级**: integration

```gherkin
Given locateTarget starts while File Panel generation is 7 and effectiveRoot is "/repo"
 And locateTarget is still loading ancestor directories
When pollTick observes cwd drift
 And resolveDone applies a new effectiveRoot "/other-repo"
Then activeLocateGeneration no longer matches the current generation
When the old locateTarget tries to dispatch locateCommit
Then locateCommit is ignored
 And effectiveRoot remains "/other-repo"
 And no stale expanded chain, cache, highlight, or scroll path from "/repo" is committed
```

### Scenario: T-036 watcher re-render does not repeat scroll
**优先级**: P0
**类型**: 组件
**测试层级**: component

```gherkin
Given Element.prototype.scrollIntoView is spied or stubbed
 And FilePanelView contains locateHighlightPath and locateScrollPath for "/repo/src/App.tsx"
When FilePanel renders the target row for the first time
Then scrollIntoView is called once
 And clearLocateScrollPath is called while locateHighlightPath remains set
When a watcher-driven view update re-renders FilePanel while highlight still exists
Then scrollIntoView is not called again
 And the target row remains highlighted
```

### Scenario: T-037 in-root symlink uses display path segments
**优先级**: P1
**类型**: 边界
**测试层级**: unit

```gherkin
Given displayed target path is "/repo/link/file.ts"
 And "/repo/link" is a symlink to "/repo/real"
 And fs.realpath proves the target stays inside "/repo"
When locateTarget chooses row segments
Then it expands "link/file.ts" in the displayed tree
 And it does not jump to sibling path "real/file.ts"
```

## UI 还原检查

| 检查点 | 设计稿标准 | 状态 |
|--------|------------|------|
| Terminal link | Accent color + underline; no agent-specific decoration | ⬜ |
| Mode switch | Existing Root / WorkTree segmented control reflects target mode | ⬜ |
| Expansion | Existing tree density, arrows, indentation, and git status color preserved | ⬜ |
| Target highlight | Low-saturation accent background + left inset, transient only | ⬜ |

## E2E 端到端验收

### API E2E 判断

| 项目 | 内容 |
|------|------|
| 是否需要 API E2E | ⏭️ 不适用 |
| 原因 | 本 Feature 是本地 Electron renderer + Host RPC 交互，无 HTTP API 或数据库业务链路。 |

### Browser E2E 判断

| 项目 | 内容 |
|------|------|
| 是否需要 Browser E2E | ✅ 需要 |
| 用户是否可选择跳过 | 是 |

### Browser E2E Scenarios

#### FE-E2E-001: Terminal path click locates File Panel row
**执行方式**: browser / Electron smoke

```gherkin
Given TermPro is running with a workspace rooted at the repo
 And the active tab prints "src/renderer/components/FilePanel.tsx:10:2"
When the user clicks the terminal path link
Then the right File Panel shows the matching Root or WorkTree mode
 And the tree expands to "src/renderer/components"
 And the "FilePanel.tsx" row is visible and highlighted
```

#### FE-E2E-002: Root mode path click switches to WorkTree
**执行方式**: browser / Electron smoke

```gherkin
Given TermPro is running with a repository root and a linked worktree
 And File Panel is currently in Root mode
 And the active terminal tab is in the linked worktree
When the terminal prints and the user clicks a worktree file path
Then File Panel switches to WorkTree mode
 And the WorkTree segmented control is active
 And the tree expands under the worktree root
 And git status coloring is refreshed for the worktree
 And the target row is visible and highlighted
```

## TDD 检查

- [ ] 测试先于实现
- [ ] 每个 TC 用例都有对应测试
- [ ] 测试可独立运行
- [ ] 测试命名符合 Scenario 描述
- [ ] 边界条件已覆盖
- [ ] 异常场景已覆盖

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-06-13 | 首版 TC，覆盖 AC-1..AC-10 |
| 2026-06-13 | 采纳 blueprint external review，补 switch-to-Root、inactive tab、mid-chain failure、runtime-only request 测试 |
| 2026-06-13 | 采纳第二轮 blueprint external review，补 terminal-owned fallback、runtime-only locate view、host realpath safe-null、root target 独立测试 |
| 2026-06-13 | 采纳第三轮 blueprint external review，补跨 mode 单事务、UI 渲染清除、symlink escape 和系统打开扩展回归测试 |
| 2026-06-13 | 采纳第四轮 blueprint external review，补缺 row TOCTOU、macOS case/Unicode、离屏滚动、live cache merge 和跨 mode E2E |
| 2026-06-13 | 采纳第五轮 blueprint external review，补目录 target 高亮/滚动、handler reject fallback、Root 下非当前 linked worktree 和独立 path-form 测试 |
| 2026-06-13 | 采纳第六轮 blueprint external review，补 cwd drift stale gate、one-shot scroll 和 root 内 symlink display-path 测试 |
