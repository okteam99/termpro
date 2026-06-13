---
feature_id: "TERMPRO-F260613152432-Terminal-File-Link-Open"
status: draft
requires_ui: false
business_direction_locked: false
acceptance_criteria:
  - id: AC-1
    description: "Given a terminal fs link that resolves to a directory, when it is activated, then the existing File-Panel-first behavior is preserved unchanged: an in-root/in-worktree directory is located and expanded in the owning tab File Panel, and a directory that cannot be located internally (outside both roots, no handler, or locate fails) falls back to the existing system opener."
    category: functional
    priority: P0
    test_refs: []
    ui_refs: []
  - id: AC-2
    description: "Given a terminal fs link that resolves to an existing single file, when it is activated, then TermPro opens it directly instead of first attempting File Panel location, with the open target chosen by the existing SYSTEM_OPEN_EXT set: a file whose extension is in SYSTEM_OPEN_EXT (icns/pdf/zip/gz/tgz/tar/7z/dmg/app/mp4/mov/avi/mkv/mp3/wav/flac/woff(2)/ttf/otf/eot) opens via the system opener (openPath); every other file (text, and non-listed images such as png/jpg/svg) opens in the TermPro viewer window (openViewerWindow). SYSTEM_OPEN_EXT is the authoritative set defined in src/renderer/terminal/terminalLinks.ts — tests should import that constant rather than hardcode the list."
    category: functional
    priority: P0
    test_refs: []
    ui_refs: []
  - id: AC-3
    description: "Given a file target lies inside the owning tab's effective Root or WorkTree, when it is activated, then it still opens directly (same as an out-of-root file) and is NOT downgraded to location-only; the previous behavior where in-root files performed location-only (including media/system-open extensions) is reverted, and the existing tests asserting that old location-only behavior (e.g. 'keeps repository system-open extensions location-only when locate succeeds') are updated to assert direct open."
    category: functional
    priority: P0
    test_refs: []
    ui_refs: []
  - id: AC-4
    description: "Given existing terminal link parsing supports file://, absolute, home (~), relative, and :line:col forms, when this change is delivered, then those forms keep resolving and the existence/kind (file vs dir) check still drives routing; a file with a :line:col suffix opens using the stripped file path and does not claim line/column navigation (unchanged from current viewer behavior)."
    category: functional
    priority: P1
    test_refs: []
    ui_refs: []
  - id: AC-5
    description: "Given an http/https web link in terminal output, when it is activated, then it continues to open in the system browser, unaffected by this change."
    category: functional
    priority: P1
    test_refs: []
    ui_refs: []
revision_history:
  - version: v0.1
    date: 2026-06-13
    changes: "Initial PRD: split terminal link activation routing by kind — directories keep File-Panel locate-first, single existing files open directly; revert F260613053134 AC-6 location-only-for-files."
  - version: v0.2
    date: 2026-06-13
    changes: "Adopted Round-1 cold review: AC-2 pins open-target boundary to SYSTEM_OPEN_EXT (QA-3); AC-3 requires updating the old location-only tests (QA-1); flowchart corrected to hover-resolved kind / no activation re-stat (ARCH-2); added Out-of-Scope notes for no-re-stat stale-kind and symlink handling (QA-2/QA-8); DEC-1 held at option A as recommended, no dual-action plumbing (ARCH-3)."
  - version: v0.3
    date: 2026-06-13
    changes: "Adopted Round-2 QA verification (both verdicts APPROVE): AC-2 now names SYSTEM_OPEN_EXT's source location so tests import the constant (QA-R2-2); DEC-1 given a deterministic default (A unless user specifies otherwise, locked before blueprint_lite kickoff) (QA-R2-1)."
---

# Terminal 文件链接点击直接打开(目录仍定位)

## 状态
草稿

## 背景

TermPro 终端已把输出里的文件路径识别为可点击链接(`src/renderer/terminal/terminalLinks.ts`)。链接激活逻辑在上一个 Feature `TERMPRO-F260613053134-Terminal-Path-FilePanel` 中被改为「File Panel 定位优先」:`activate` 回调统一调 `openTargetInFilePanelFirst(tabId, absPath, kind)`,**不区分文件还是目录**,只要路径落在当前 tab 的 Root/WorkTree 内就先在 File Panel 内定位展开,只有定位失败(根外 / 无 handler)才回退到 `openTargetFallback`(目录/媒体扩展名→系统打开 `openPath`;文本/图片文件→TermPro 文件窗口 `openViewerWindow`)。

代码证据:`terminalLinks.ts:279-281` activate 直接 `void openTargetInFilePanelFirst(this.tabId, hit.abs, hit.kind)`;`terminalLinks.ts:36-48` `openTargetInFilePanelFirst` 先 `tryLocateInFilePanel`,`located` 为假才 `openTargetFallback`。

该 Feature 的 PRD(AC-6 +「既有行为取舍」段)**有意**把根内文件(含媒体/系统扩展名)也改成 location-only,理由是「上下文与 git 状态优先于一键系统打开」。但这把「目录定位」与「文件打开」两种本应不同的意图揉成同一条规则:用户实际期望是**目录**点击回到 File Panel 定位(认可),**单个明确存在的文件**点击应当**直接打开**看内容(被过度收敛成只定位,体验割裂)。

本次按链接解析出的目标**类型**分流激活行为,只改文件分支,目录与 web 链接行为保持不变。

## 用户故事

作为在终端里跑 CLI / agent 的开发者,我希望点击终端输出里**单个文件**的路径链接时直接打开该文件(文本/图片在 TermPro 窗口、媒体走系统打开),而点击**目录**链接时仍在右侧 File Panel 定位展开,这样查看文件内容与浏览目录结构两种诉求各走各的最短路径,不再被「文件也只定位」打断。

## 交付预期(用户视角)

| 变化 | 验证方式 |
|------|----------|
| 点击终端里的**文件**路径(在 worktree/root 内)→ 直接打开(文本/图片进 TermPro 文件窗口) | 在工程内输出/点击 `src/renderer/App.tsx` 这类文件路径,出现文件窗口而非仅高亮定位 |
| 点击终端里的**媒体/系统扩展名文件**(pdf/zip/dmg/视频等)→ 系统打开 | 输出/点击 `xxx.pdf`、`xxx.zip` 等,交系统程序打开 |
| 点击终端里的**目录**路径 → 仍在 File Panel 内定位展开(行为不变) | 在 WorkTree/Root 模式输出/点击目录路径,File Panel 逐级展开并定位该目录 |
| 根外文件 / web 链接行为不回退 | 点击 `/tmp/x.txt`(打开)、`https://...`(系统浏览器) |

## 验收标准

| ID | 描述 | 优先级 | 覆盖测试 |
|----|------|--------|----------|
| AC-1 | 目录链接:维持现有 File-Panel-first 定位(根内定位展开;根外/无 handler/定位失败→系统打开),行为不变。 | P0 | |
| AC-2 | 文件链接:直接打开,不先尝试定位;按既有 `SYSTEM_OPEN_EXT` 分流——命中扩展名(icns/pdf/压缩包/dmg/app/音视频/字体)→系统打开 `openPath`;其余文件(文本 + png/jpg/svg 等未列图片)→TermPro 文件窗口 `openViewerWindow`。 | P0 | |
| AC-3 | 根内文件同样直接打开(与根外文件一致),不再 location-only;还原 F260613053134「根内文件含媒体只定位」,并同步更新断言旧只定位行为的既有测试。 | P0 | |
| AC-4 | 既有路径解析形态(file://、绝对、home、相对、:line:col)不回退;存在性 + 类型(file/dir)校验仍驱动分流;:line:col 文件用 stripped 路径打开,不声明行跳转。 | P1 | |
| AC-5 | http/https web 链接仍走系统浏览器,不受影响。 | P1 | |

## 业务流程图

```mermaid
flowchart TD
  A[激活终端 fs 链接] --> B[使用 hover 解析的 kind · statCache ≤5s · 激活不重新 stat]
  B --> C{kind?}
  C -->|dir| D[openTargetInFilePanelFirst<br/>(定位优先 · 现状不变)]
  D -->|located=false| E[openTargetFallback → 系统打开目录]
  C -->|file| F[直接 openTargetFallback]
  F --> G{媒体/系统扩展名?}
  G -->|是| H[openPath 系统打开]
  G -->|否| I[openViewerWindow TermPro 文件窗口]
```

## 埋点需求

不适用。本地桌面交互调整,产品无埋点系统,不引入上报。

## Out of Scope

- 不改终端路径解析规则:候选识别、存在性校验、相对路径 cwd 解析、宽字符列映射全部不动(只要求不回退)。
- 不改目录的 File Panel 定位逻辑:locate 机制、根选择、展开/高亮、并发 last-click-wins 等原样保留(F260613053134 的目录能力全保留)。
- 不新增「打开文件后跳转到 line/col」能力:viewer 仍不做行定位,沿用现状。
- 不改 web(http/https)链接行为。
- 不引入用户可配置开关(文件「打开 vs 定位」不做设置项):本次是默认行为修正,加配置项属过度设计;若后续有需要再单独立项。
- 不在激活时重新 stat:沿用 hover 解析时缓存的 kind(≤5s · 与现状一致)。文件若在 hover 后、点击前被删除,由 viewer / 系统程序按现状处理(不新增激活时重校验)。
- symlink 无特殊处理:`fs.stat` 跟随符号链接(链到文件→走文件分支打开 · 链到目录→走目录分支定位);断链 stat 返回 null → 链接根本不激活。

## 待决策项

| ID | 问题 | 选项 | 决策 |
|----|------|------|------|
| DEC-1 | 文件点击直接打开后,是否**同时**在 File Panel 定位高亮? | A. 纯打开(还原旧行为 · 不定位)💡 推荐 / B. 打开 + 同时在面板定位高亮 | 在本 stage 用户最终确认(§8)闭合;**用户未另指定则默认 A**,不预建 B 的双动作管线(blueprint_lite kickoff 前必锁定) |

## PM 自查

- 产品目标:让终端文件链接点击「直接打开看内容」、目录链接「定位浏览」各归其位,修正 F260613053134 把文件强制只定位的过度收敛。
- 代码现状已读:true(`terminalLinks.ts` activate / openTargetFallback / openTargetInFilePanelFirst、locateRegistry、preload openViewerWindow/openPath)。
- 影响范围:Terminal fs link activation 路由分叉(renderer · `terminalLinks.ts`),不触及 host / 协议 / File Panel 定位内核。
- 上游对齐:承接 product-overview Line 3 文件与 Git 工作面 / Line 4 文件查看;为 F260613053134(PENDING-001 派生)的行为修正。
- 规模反压:5 条 AC,围绕同一路由分叉行为,无需拆分。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-06-13 | v0.1 初稿:按 kind 分流激活——目录保留定位优先、文件直接打开;还原 AC-6 根内文件只定位 |
| 2026-06-13 | v0.2 采纳 Round-1 冷审:AC-2 锚定 SYSTEM_OPEN_EXT 边界、AC-3 要求更新旧只定位测试、flowchart 改 hover kind 不重 stat、补 OoS(不重 stat / symlink)、DEC-1 守在 A |
| 2026-06-13 | v0.3 采纳 Round-2 QA 验证(全 APPROVE):AC-2 标注 SYSTEM_OPEN_EXT 出处供测试 import、DEC-1 给确定性默认(未指定即 A · blueprint_lite 前锁定) |
