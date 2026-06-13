---
feature_id: "TERMPRO-F260613150158-Settings-About-Entry"
status: pending_review # draft | pending_review | confirmed
requires_ui: true
business_direction_locked: false
acceptance_criteria:
  - id: AC-1
    description: "侧栏左下角 sidebar-footer 渲染用户信息入口行:默认头像占位 + 文字「Settings」(DOM 可断言存在)"
    category: functional
    priority: P0
    test_refs: []
    ui_refs: []
  - id: AC-2
    description: "点击入口在其上方弹出菜单卡片,仅含一个菜单项「About」;再次点击入口(菜单已开)则关闭菜单(toggle 语义,对齐通知中心)"
    category: functional
    priority: P0
    test_refs: []
    ui_refs: []
  - id: AC-3
    description: "菜单展开后,点击菜单外区域或按 Esc 键关闭菜单"
    category: functional
    priority: P0
    test_refs: []
    ui_refs: []
  - id: AC-4
    description: "点击「About」后弹出当前版本信息(应用名 TermPro + 当前版本号),同时菜单关闭"
    category: functional
    priority: P0
    test_refs: []
    ui_refs: []
  - id: AC-5
    description: "About 弹窗显示的版本号取自应用真实版本(app.getVersion),经壳层桥同步暴露给 renderer,非硬编码"
    category: functional
    priority: P0
    test_refs: []
    ui_refs: []
  - id: AC-6
    description: "版本信息弹窗可关闭(关闭按钮 / 点击遮罩 / Esc),关闭后键盘焦点回到先前聚焦元素(终端/侧栏),不影响后续终端输入"
    category: functional
    priority: P1
    test_refs: []
    ui_refs: []
  - id: AC-7
    description: "升级胶囊与用户信息入口行为 sidebar-footer 内同级(竖向栈);DEV 徽标位于入口行内;devChannel=true 且有更新事件时三者可同时渲染且互不重叠遮挡"
    category: ux
    priority: P1
    test_refs: []
    ui_refs: []
  - id: AC-8
    description: "版本号读取失败(壳层桥返回空 / 异常)时,About 弹窗显示友好占位「版本未知」,不抛错不崩溃"
    category: functional
    priority: P1
    test_refs: []
    ui_refs: []
  - id: AC-9
    description: "入口与菜单视觉复用现有 design token(--bg-panel/--bg-active/--border/--fg/--fg-dim 等),整体风格与参考截图一致(Designer 在 ui_design 签核)"
    category: ux
    priority: P1
    test_refs: []
    ui_refs: []
revision_history:
  - version: v0.1
    date: "2026-06-13"
    changes: "初稿:左下角用户信息入口(头像占位 + Settings)+ About 菜单项 + 版本信息弹窗"
  - version: v0.2
    date: "2026-06-13"
    changes: "整合 Round 1 冷审:① 据用户确认明确『脚手架』前提(PL-4)② AC-1 拆出纯功能项、视觉移至 AC-9(QA-8)③ AC-2 补 toggle 语义(QA-2)④ AC-7 改结构可测(QA-5)⑤ 新增 AC-8 版本读取失败 fallback(QA-1)⑥ AC-5 改为壳层同步暴露(ARCH-2/QA-6)⑦ DEC-1 用户定为『仅版本号』已闭合⑧ 补菜单/弹窗交互细节约束(QA-3/QA-4)"
  - version: v0.3
    date: "2026-06-13"
    changes: "Round 2 收敛(QA/Architect/PL 全 APPROVE)后并入 advisory:AC-6 补焦点返还(QA-R2-11)、AC-7 表项收紧 devChannel 前置(ARCH-R2-7)、补冒烟门禁 + test_refs 回填说明(QA-R2-7/R2-10)"
  - version: v0.4
    date: "2026-06-14"
    changes: "review 阶段调和 AC-7 措辞与已确认设计:DEV 徽标位于入口行内(非 footer 三同级),升级胶囊与入口行为 footer 同级竖向栈;语义(共存不重叠)不变(code review ARCH-1/CR-2)"
---

# 左下角用户信息入口(Settings · About)

## 状态
待评审

## 背景

侧栏左下角(`sidebar-footer`)目前只承载 DEV 渠道徽标与升级胶囊,缺少一个常驻的「用户区入口」。

**本 Feature 的真实前提是脚手架**(已与用户确认 · 2026-06-13):建立侧栏左下角的**用户区入口外壳**,为未来的账户 / 偏好设置等次级功能预留落点;本次先落地其**最小形态** —— 默认头像占位 + 文字「Settings」的入口行,点击展开一个**仅含「About」**的菜单,点 About 弹出**当前应用版本**。即:入口外壳是目标,About/版本是这个外壳承载的**第一个**具体项,而非本 Feature 的全部价值。

> 说明(对齐冷审 PL-2/PL-4):当前**无 ROADMAP/BL** 支撑"用户/设置区"这一产品方向,本 Feature 即为该方向的脚手架起点;价值不等同于"看版本号"(升级胶囊已能反映版本动态),而在于建立可扩展的用户区入口。标签沿用用户指定的「Settings」(用户在知悉"暂只有 About"后确认保留 · 见 §待决策项 DEC-2)。

技术上 renderer 当前无法读取应用版本(`app.getVersion()` 仅 main 进程可用,且 preload 无 `process.env` · 见 KNOWLEDGE GO-003),需按既有壳层模式新增一条只读的版本暴露通道;走 Electron preload 桥 + 主进程,**不经 HostService 协议**(该协议只承载 fs/pty/git 工程数据)。

## 用户故事

作为 TermPro 用户,我希望侧栏左下角有一个常驻的用户区入口,以便从这里查看应用信息(本次:当前版本),并作为后续账户 / 设置功能的统一入口。

## 交付预期(用户视角)

| 变化 | 验证方式 |
|------|----------|
| 侧栏左下角出现「Settings」用户区入口行(含默认头像占位) | 启动应用,看侧栏左下角 |
| 点击入口在其上方弹出一个仅含「About」的菜单卡片 | 点击该入口 |
| 点击「About」弹出当前版本信息(TermPro + 版本号) | 点击菜单中的 About |
| 版本号与应用实际版本一致 | 对照 `package.json` / 发布版本号 |

## 验收标准

| ID | 描述 | 优先级 | 覆盖测试 |
|----|------|--------|----------|
| AC-1 | 侧栏左下角 sidebar-footer 渲染用户信息入口行:默认头像占位 + 文字「Settings」(DOM 可断言存在) | P0 | |
| AC-2 | 点击入口在其上方弹出菜单卡片,仅含一个菜单项「About」;再次点击入口(菜单已开)则关闭菜单(toggle 语义) | P0 | |
| AC-3 | 菜单展开后,点击菜单外区域或按 Esc 键关闭菜单 | P0 | |
| AC-4 | 点击「About」后弹出当前版本信息(应用名 TermPro + 当前版本号),同时菜单关闭 | P0 | |
| AC-5 | About 弹窗显示的版本号取自应用真实版本(app.getVersion),经壳层桥同步暴露给 renderer,非硬编码 | P0 | |
| AC-6 | 版本信息弹窗可关闭(关闭按钮 / 遮罩 / Esc),关闭后键盘焦点回到先前聚焦元素(终端/侧栏) | P1 | |
| AC-7 | 升级胶囊与入口行为 sidebar-footer 同级(竖向栈)· DEV 徽标在入口行内 · 三者可同时渲染且互不重叠遮挡 | P1 | |
| AC-8 | 版本号读取失败时 About 弹窗显示「版本未知」,不抛错不崩溃 | P1 | |
| AC-9 | 入口/菜单视觉复用现有 design token,整体风格与参考截图一致(Designer 签核) | P1 | |

## UI 用户故事(PM 描述高层产品意图)

- **涉及组件**(高层):侧栏 `sidebar-footer`(新增入口行)、新增菜单弹层(承载 About)、新增版本信息弹窗。
- **交互改动**:新增「点击入口 → 展开菜单 → 点 About → 弹版本信息」一条**线性单层**交互链;入口常驻(无账户态)。
- **状态流**:
  - normal:入口行常驻显示(头像占位 + Settings)。
  - 菜单 open/closed 两态(toggle);版本弹窗 open/closed 两态。
  - **交互细节约束**(对齐冷审 QA-3/QA-4):菜单与版本弹窗**不同时存在** —— 点 About 时菜单先关、弹窗后开;弹窗以遮罩覆盖(参考 RenameModal),其打开期间入口不可点击,故不存在"菜单 Esc 监听"与"弹窗 Esc 监听"同时活跃的歧义。
  - **无加载态**:版本号在壳层初始化即同步可得(非异步拉取),故无 loading;读取失败仅退回「版本未知」占位(AC-8)。
- **视觉参考**:用户提供的左下角用户区截图(深色圆角面板 + 头像圆 + 文字行;菜单项带图标 + hover 高亮)。具体视觉 token / 间距 / 图标 / 菜单向上弹出的定位由 UI Design Stage 细化。

## 影响范围

- **in scope**:侧栏左下角入口 UI、About 菜单、版本信息弹窗、暴露应用版本号的壳层通道。
- **out of scope**:见下方 Out of Scope。
- **高层模块影响**:
  - `src/renderer/components/`(Sidebar + 新菜单 / 弹窗组件)
  - `src/preload/preload.ts`(新增只读 `version` 暴露)
  - `src/main/`(将版本号同步注入壳层,推荐经 `additionalArguments` · 详见技术方向)
  - `src/renderer/types.d.ts`(`window.termpro` 类型补字段)
- **技术方向**(冷审 ARCH-2 采纳 · 细节归 Blueprint/TECH):版本是进程常量,优先**同步暴露**(像 `platform`/`devChannel` 那样经 `additionalArguments` 注入 `process.argv`,preload 以普通字段暴露 `version: string`),避免 async invoke 带来的 Promise / loading / 失败面;最终 sync-vs-invoke 由 Blueprint 定。
- **实现约束**(冷审 PL-3/ARCH-3 采纳):菜单是**字面一项 About**,不构建数据驱动的菜单框架 / 设置注册表;避免"为未来"过度抽象。
- **验证门禁**:须过项目既有三绿门禁(`tsc` + `vitest` + `TERMPRO_SMOKE=1` 冒烟 SMOKE_OK);冒烟覆盖 sidebar-footer 新增组件的启动渲染路径(冷审 QA-R2-7)。AC 的 `test_refs` 在 Blueprint Stage 由 QA 产出 TC 时回填(QA-R2-10)。
- **跨子项目依赖**:无(单子项目)。
- **关联 KNOWLEDGE**:GO-003(preload 无 `process.env`,壳层信息走 main);GLOSSARY「升级胶囊」(同区已有元素)。
- **业务/技术风险**:低。注意点:版本暴露必须遵守壳层架构红线(preload+IPC 而非 HostService)。ROLLBACK:纯增量 UI + 一条只读版本通道,回滚即移除新增组件与通道,不影响既有功能。

## Out of Scope

- 真实用户账户 / 登录 / 头像上传 —— 当前产品无账户体系,本次仅默认头像**占位**;**头像不得暗示已有账户能力**(冷审 PL-5)。
- 参考截图中的其他菜单项(Language / Get help / View plans / Log out 等)—— 本次菜单**仅 About**。
- 真正的「设置」页面或偏好配置项 —— 入口标签虽为「Settings」,本次只承载 About;设置功能后续 Feature 再做。
- 版本检查 / 下载 / 更新逻辑 —— 已由现有「升级胶囊」负责,About 仅**静态展示**当前版本。
- About 中的构建渠道(DEV)标识 / GitHub 链接 —— 本次只展示应用名 + 版本号(DEC-1 决策)。
- 主题切换 / 多语言 —— 不在本次范围。

## 待决策项

| ID | 问题 | 选项 | 决策 |
|----|------|------|------|
| DEC-1 | About 弹窗展示的信息范围 | A: 仅应用名 + 版本号 / B: 加 DEV 渠道标识 / GitHub 链接 | ✅ 用户定为 A(仅版本号 · 2026-06-13) |
| DEC-2 | 入口标签用「Settings」还是更诚实标签 | A: 保持「Settings」(脚手架) / B: 改 About/版本号 / C: 砍菜单直达 | ✅ 用户定为 A(保持原样 · 2026-06-13) |

## 变更记录
| 日期 | 变更 |
|------|------|
| 2026-06-13 | v0.1 初稿 |
| 2026-06-13 | v0.2 整合 Round 1 冷审 + 用户早问门决策(脚手架前提 / AC 重构 / 同步版本暴露 / DEC 闭合) |
