# 左下角用户信息入口(Settings · About) - 技术方案

## 状态
待评审

## 复杂度评估
- [x] 修改文件数: ~7 个(main / preload / 新 helper / types / Sidebar / Sidebar.css / 新组件)+ 2 测试 + package.json
- [x] 涉及多模块: 是(renderer + preload + Electron main)
- [x] 数据库变更: **否**(无 schema · 无持久化)
- [x] 影响现有功能: 否(纯增量;仅在既有 `sidebar-footer` 内追加元素)
- [x] 新技术栈/依赖: 是(仅新增 **devDep**:`jsdom` + `@testing-library/react` 用于组件测试 · 运行时零新依赖)

**结论**: 简单方案(单子项目 · 跨进程薄管道 · 无 DB · 无运行时新依赖)。

## 技术方案

### 架构

版本号数据流(遵守架构红线:app/OS 级信息走 preload+IPC · **不经 HostService**):

```
Electron main(app.getVersion())
   └─ createWindow webPreferences.additionalArguments 注入 '--termpro-version=<v>'
        └─ preload 读 process.argv → parseVersionArg() → contextBridge 暴露 window.termpro.version: string
             └─ renderer Sidebar footer → AboutModal 显示 `版本 ${version}`(空 → 「版本未知」)
```

- 与既有 `--termpro-smoke` / `--termpro-dev`(main.ts:362 `additionalArguments`)**完全同款**:沙箱 preload 无 `process.env`(KNOWLEDGE GO-003),壳层常量经 argv 同步传递。
- 版本是进程常量 → **同步暴露**(不用 `ipcRenderer.invoke`)→ 无 Promise / 无 loading 态 / 失败面收敛为「arg 缺失」(冷审 ARCH-2 采纳)。

### 数据结构

| 载体 | 类型 | 说明 |
|------|------|------|
| `window.termpro.version` | `string` | preload 同步暴露的应用版本号(如 `"0.3.12"`)· arg 缺失时为 `""` |
| 组件 local state `menuOpen` | `boolean` | 菜单展开态(useState) |
| 组件 local state `aboutOpen` | `boolean` | About 弹窗态(useState) |

无 DTO / DB / 持久化。

### 接口

| 接口 | 类型 | 说明 |
|------|------|------|
| `window.termpro.version` | preload 同步字段 | 只读 · 无参 · 不新增 HostService RPC(`src/shared/protocol.ts` 不动) |

## 实现思路

版本号从 main 经 argv 同步透传到 renderer;Sidebar footer 在既有升级胶囊/DEV 徽标基础上追加用户信息入口行,点击 toggle 上弹菜单(仅 About),点 About 弹版本模态。交互模式复用既有 `NotificationCenter`(外点+Esc 关)与 `RenameModal`(遮罩+卡片)。

### 改动文件清单

```
src/
├── main/
│   └── main.ts                              # createWindow additionalArguments 追加 `--termpro-version=${app.getVersion()}`
├── preload/
│   ├── parseVersionArg.ts                   # 新增:纯函数 parseVersionArg(argv: string[]): string(无 electron import · 可单测)
│   ├── preload.ts                           # import parseVersionArg · 暴露 version: parseVersionArg(process.argv)
│   └── __tests__/
│       └── parseVersionArg.test.ts          # 新增:单测(node env)· 覆盖 AC-5 / AC-8
└── renderer/
    ├── types.d.ts                           # window.termpro 接口加 version: string
    └── components/
        ├── Sidebar.tsx                       # footer 改为竖向栈:升级胶囊 + <SettingsEntry/>
        ├── Sidebar.css                       # 🔴 改既有重复 .sidebar-footer 规则(L254+L303)为 column(改 L303 那条 · 非追加第三条)+ 入口/菜单/弹窗样式
        ├── SettingsEntry.tsx                 # 新增:头像占位+Settings 入口 + 上弹菜单(仅 About)+ AboutModal
        └── __tests__/
            └── SettingsEntry.test.tsx        # 新增:组件测试(// @vitest-environment jsdom)· 覆盖 AC-1/2/3/4/6/7
```

> 📎 测试 harness:新增 test 用 per-file `// @vitest-environment jsdom` docblock + `@testing-library/react`,**不改全局 vitest 环境**(项目无 vitest config · 默认 node env · 既有 15 个 node 逻辑测试零影响 · 最小爆炸半径)。`AboutModal` 作为 `SettingsEntry.tsx` 内同文件导出组件,供测试断言。

### parseVersionArg 契约(冷审 QA-2 / ARCH-5)

`parseVersionArg(argv: string[]): string` —— 找首个以 `--termpro-version=` 开头的 arg,取 `slice(prefix.length)` 后 `trim`;**穷举失败态全部回退 `""`(绝不抛错)**:

| 输入 argv 含 | 输出 |
|---|---|
| `--termpro-version=0.3.12` | `"0.3.12"` |
| `--termpro-version=`(值空) | `""` |
| `--termpro-version`(无 `=`) | `""`(不可 `split('=')[1]` 否则 undefined 链式报错) |
| 完全无该 arg | `""` |
| `--termpro-version=   `(纯空格) | `""`(trim 后空) |

renderer 侧 `version ? \`版本 ${version}\` : '版本未知'`(AC-8)。

### 前端技术方案

- **组件结构**:`Sidebar` → `footer`(竖向栈)→ `<SettingsEntry/>`(内含入口 button + 条件 menu + 条件 AboutModal)。`AboutModal` 居中遮罩模态。
- **状态管理**:全部 local `useState`(menuOpen / aboutOpen)· 无 store / context · 无持久化。版本号一次性从 `window.termpro.version` 读取。
- **路由变更**:无(Electron 单窗口,无前端路由)。
- **样式方案**:plain CSS(`Sidebar.css`)· 复用 design token(`--bg-panel/--bg-active/--border/--fg/--fg-dim/--accent`)· 入口/菜单**不引入红色**(`#e06c75` 仅是既有 DEV 徽标的裸 hex 字面 · 非 token · 本 Feature 不复用)· 菜单 `position:absolute; bottom:100%+6px` 向上弹出。🔴 footer 竖向化须**改既有 `.sidebar-footer` 规则**(Sidebar.css 有两处定义 L254/L303 · 改 L303 那条为 `flex-direction:column; align-items:stretch` · 不追加第三条 · 防级联冲突致 DEV徽标/升级胶囊横排回归)。
- **交互细节**(对齐 PRD / 冷审):
  - 菜单:点击 toggle;外点(document mousedown)/ Esc 关闭(复用 NotificationCenter 模式)。
  - About:点 About 时先 `setMenuOpen(false)` 后 `setAboutOpen(true)`(两态不共存);遮罩 / × / Esc 关闭。
  - **焦点返还(AC-6)**:打开弹窗前记 `document.activeElement`,关闭时 `.focus()` 还原(防终端输入焦点丢失)。
  - **fallback(AC-8)**:`version ? \`版本 ${version}\` : '版本未知'`。

## TDD 开发计划

### 测试清单(对应 TC 用例)
| TC 用例 | 测试方法名 | 状态 |
|---------|-----------|------|
| T-001 | parseVersionArg_extracts_version_from_arg | ☐ |
| T-002 | parseVersionArg_returns_empty_when_missing | ☐ |
| T-003 | settingsEntry_renders_avatar_and_label | ☐ |
| T-004 | settingsEntry_toggles_menu_with_single_about_item | ☐ |
| T-005 | settingsEntry_menu_closes_on_outside_click_and_esc | ☐ |
| T-006 | settingsEntry_about_click_opens_modal_and_closes_menu | ☐ |
| T-007 | aboutModal_shows_version_and_fallback | ☐ |
| T-008 | aboutModal_closes_and_restores_focus | ☐ |
| T-009 | footer_renders_entry_devbadge_updatepill_siblings | ☐ |

### 实现步骤(TDD 红绿)
| # | 步骤 | 类型 | 验证方式 | 状态 |
|---|------|------|----------|------|
| 1 | 写 parseVersionArg 失败测试(有/无 arg) | 🔴 Red | vitest 失败 | ☐ |
| 2 | 实现 parseVersionArg 纯函数 | 🟢 Green | vitest 通过 | ☐ |
| 3 | preload 暴露 version + main 注入 arg + types.d.ts | 🟢 Green | tsc 通过 | ☐ |
| 4 | **前置门**:装 `jsdom` + `@testing-library/react@^16` + `@testing-library/dom`(devDep)· 验 `npx vitest run` 仍全绿 + 一个最小 `.test.tsx` 能跑(确认 TSX transform) | 🔵 | vitest 冒烟绿才进 step5 | ☐ |
| 5 | 写 SettingsEntry 渲染/交互失败测试 | 🔴 Red | vitest 失败 | ☐ |
| 6 | 实现 SettingsEntry + AboutModal + Sidebar footer 接线 | 🟢 Green | vitest 通过 | ☐ |
| 7 | 写 Sidebar.css 样式 | 🔵 Refactor | 冒烟渲染 | ☐ |
| 8 | 三绿门禁:tsc + vitest + TERMPRO_SMOKE 冒烟 | ✅ | 全绿 | ☐ |

## 风险与缓解
| 风险 | 缓解 |
|------|------|
| `additionalArguments` 仅注入主窗口;viewer/diff 窗口无 version | 入口只在主窗口 Sidebar,viewer 窗口无需 version,无影响 |
| dev/forge 下 `app.getVersion()` 取值 | electron-forge dev 下返回 package.json version;冒烟/打包一致 |
| jsdom env 误伤既有 node 测试 | per-file docblock 隔离,不改全局环境 |
| 焦点返还在 jsdom 下断言 | testing-library `document.activeElement` 断言;真实环境靠 RenameModal 同款模式 |
| `@testing-library/react` 与 React 版本兼容 | 用 v16+(React 19 兼容)+ 显式装 `@testing-library/dom`(peer)· dev 阶段按 app React 版本锁定(冷审 ARCH-4) |
| `Sidebar.css` 有两处 `.sidebar-footer`(L254/L303)· 竖向化漏改其一致级联冲突 | 改 L303 那条为 column · 不追加第三条 · 冒烟核对 DEV徽标/升级胶囊仍正确堆叠(冷审 ARCH-2) |
| parseVersionArg 对 `--termpro-version`(无 `=`)`split('=')[1]` 链式报错 | 用 `slice(prefix.length)`+`trim`,失败态全回退 `""`(契约表已固化 · 冷审 QA-2/ARCH-5) |

## 待决策
| 问题 | 建议 |
|------|------|
| 无 | DEC-1/DEC-2 已在 goal 闭合(About=仅版本号 · 标签保持 Settings) |

## 变更记录
| 日期 | 变更 |
|------|------|
| 2026-06-13 | v0.1 初稿(同步版本暴露 + SettingsEntry 组件 + jsdom 组件测试) |
| 2026-06-14 | v0.2 整合 blueprint 冷审:Sidebar.css 重复 footer 规则改法(ARCH-2)· 去 #e06c75 红色(ARCH-3)· parseVersionArg 契约表+slice/trim(QA-2/ARCH-5)· devDep 前置门+@testing-library/dom(QA-1/ARCH-4) |
