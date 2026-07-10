---
tc_feature_id: TERMPRO-F260710011342-Sidebar-Machine-Groups
prd_version: "0.3"
harness: "vitest + @testing-library/react (jsdom) · 无独立 Playwright/e2e · 真机走手动 spike"
tests:
  - id: BL004-U-hr-local
    file: src/renderer/services/__tests__/hostRegistry.test.ts
    function: "forWorkspace hostId=local 返回既有 hostClient 单例"
    covers_ac: [AC-7]
    level: unit
    priority: P0
  - id: BL004-U-hr-remote
    file: src/renderer/services/__tests__/hostRegistry.test.ts
    function: "forWorkspace hostId=configId 返回该远程 client 非本地单例"
    covers_ac: [AC-5, AC-7]
    level: unit
    priority: P0
  - id: BL004-U-hr-nomisroute
    file: src/renderer/services/__tests__/hostRegistry.test.ts
    function: "forWorkspace 未连接 configId 不静默回落本地单例"
    covers_ac: [AC-5]
    level: unit
    priority: P0
  - id: BL004-U-hr-key-authority
    file: src/renderer/services/__tests__/hostRegistry.test.ts
    function: "路由权威键=hostRegistry map 键 · host.info.hostId 不参与"
    covers_ac: [AC-7]
    level: unit
    priority: P0
  - id: BL004-C-sidebar-groups
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: "本机组置顶 + M 个远程机组未连接态显别名+连接入口不展开"
    covers_ac: [AC-1]
    level: component
    priority: P0
  - id: BL004-C-sidebar-m0
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: "M=0 只渲染单本机组头 · 无远程组无空占位"
    covers_ac: [AC-10]
    level: component
    priority: P1
  - id: BL004-C-sidebar-connect-expand
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: "连接远程机 → 展开该机 workspace.list + 会话徽标 · 断开回折叠"
    covers_ac: [AC-2]
    level: component
    priority: P0
  - id: BL004-U-badge-zero
    file: src/renderer/state/__tests__/tabBadge.test.ts
    function: "formatTabBadge(0) 显式渲染 0 + zero 修饰符 · 不被 falsy 吞"
    covers_ac: [AC-2]
    level: unit
    priority: P0
  - id: BL004-U-badge-semantic
    file: src/renderer/state/__tests__/tabBadge.test.ts
    function: "徽标=本客户端活跃 tab 数 · 忽略主机侧非本客户端会话"
    covers_ac: [AC-2]
    level: unit
    priority: P1
  - id: BL004-C-adddir-loading
    file: src/renderer/components/__tests__/AddWorkspaceRemoteDir.test.tsx
    function: "选远程机 → fs.readdir 加载态转圈 · Create 禁用"
    covers_ac: [AC-3]
    level: component
    priority: P0
  - id: BL004-C-adddir-empty
    file: src/renderer/components/__tests__/AddWorkspaceRemoteDir.test.tsx
    function: "远程空目录 → 空态提示 · 非报错"
    covers_ac: [AC-3]
    level: component
    priority: P1
  - id: BL004-C-adddir-error
    file: src/renderer/components/__tests__/AddWorkspaceRemoteDir.test.tsx
    function: "远程目录 EACCES → 错误块+重试 · Create 禁用"
    covers_ac: [AC-3]
    level: component
    priority: P0
  - id: BL004-C-create-remote
    file: src/renderer/components/__tests__/AddWorkspaceRemoteDir.test.tsx
    function: "确认创建 → workspace.create on 该远程 client · 落该机组 · 主窗口即时可见"
    covers_ac: [AC-4]
    level: component
    priority: P0
  - id: BL004-I-route-terminal
    file: src/renderer/services/__tests__/remoteWorkspaceRouting.test.ts
    function: "远程 workspace 终端 pty.spawn 走该机 client 非本地"
    covers_ac: [AC-5]
    level: integration
    priority: P0
  - id: BL004-I-route-fs
    file: src/renderer/services/__tests__/remoteWorkspaceRouting.test.ts
    function: "远程 workspace FilePanel fs.readdir/watch/realpath 走该机 client"
    covers_ac: [AC-5]
    level: integration
    priority: P0
  - id: BL004-I-route-git
    file: src/renderer/services/__tests__/remoteWorkspaceRouting.test.ts
    function: "App.tsx 分支刷新 git.info + terminalLinks fs.stat 走该机 client"
    covers_ac: [AC-5]
    level: integration
    priority: P0
  - id: BL004-U-grepgate
    file: src/renderer/services/__tests__/hostConsumerGrepGate.test.ts
    function: "src/renderer 无残留裸 hostClient. 消费 · 除豁免清单"
    covers_ac: [AC-5]
    level: unit
    priority: P0
  - id: BL004-U-composite-route
    file: src/renderer/terminal/__tests__/sessionRouteCompositeKey.test.ts
    function: "会话路由键=(hostId,sessionId) 复合 · findTabByHostSession"
    covers_ac: [AC-5, AC-6]
    level: unit
    priority: P0
  - id: BL004-U-composite-nocross
    file: src/renderer/terminal/__tests__/sessionRouteCompositeKey.test.ts
    function: "本机+远程同名 sessionId 不串 tab"
    covers_ac: [AC-6]
    level: unit
    priority: P0
  - id: BL004-U-local-baseline
    file: src/renderer/state/__tests__/localRegressionBaseline.test.ts
    function: "本机路径 host 调用序列与改造前基线等价 · 0 新增"
    covers_ac: [AC-6]
    level: unit
    priority: P0
  - id: BL004-U-session-local-equiv
    file: src/renderer/services/__tests__/sessionEventsComposite.test.ts
    function: "sessionEvents 复合键后本机通知/角标序列不变"
    covers_ac: [AC-6]
    level: unit
    priority: P0
  - id: BL004-C-grouphead-connecting
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: "组头连接中/部署中% → 复用 BL-003 CONNECT_STAGE_LABEL"
    covers_ac: [AC-8]
    level: component
    priority: P1
  - id: BL004-C-grouphead-failed
    file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
    function: "组头失败原因 + 重试入口 · 复用 remoteHost 事件面"
    covers_ac: [AC-8]
    level: component
    priority: P1
  - id: BL004-U-params-valid
    file: src/host/__tests__/workspaceServiceParamsValidation.test.ts
    function: "workspace create/update/remove 合法 params 通过"
    covers_ac: [AC-9]
    level: unit
    priority: P1
  - id: BL004-U-params-reject
    file: src/host/__tests__/workspaceServiceParamsValidation.test.ts
    function: "缺字段/类型错/越界 params 拒绝 · 不落坏数据"
    covers_ac: [AC-9]
    level: unit
    priority: P1
  - id: BL004-C-disconnect-fallback
    file: src/renderer/state/__tests__/remoteDisconnectFallback.test.ts
    function: "远程断线时其 ws active → activeWorkspaceId 回落本机首个 + 组折叠"
    covers_ac: [AC-11]
    level: unit
    priority: P1
  - id: BL004-U-disconnect-empty
    file: src/renderer/state/__tests__/remoteDisconnectFallback.test.ts
    function: "断线且无本机 workspace → 回落空态"
    covers_ac: [AC-11]
    level: unit
    priority: P1
  - id: BL004-C-remotefile-disabled
    file: src/renderer/components/__tests__/FilePanelRemoteDisabled.test.tsx
    function: "远程 ws 点文件/Diff → aria-disabled+提示 · 不 openViewerWindow"
    covers_ac: [AC-5]
    level: component
    priority: P0
  - id: BL004-C-remotefile-tree-ok
    file: src/renderer/components/__tests__/FilePanelRemoteDisabled.test.tsx
    function: "远程 ws 目录树浏览 + git 着色照常可用"
    covers_ac: [AC-5]
    level: component
    priority: P1
---

# TC.md — BL-004 机器分组 Sidebar + 添加项目流程（WS-01-S4）

> 权威 AC 源 = `PRD.md` v0.3（AC-1~AC-11）· UI 呈现映射 = `UI.md`。本文件是 QA 契约单源，
> RD 实现前先读此文件对齐测试形状；`function` 列 = 目标 `describe/it` 名（RD 可微调措辞，
> 但 `covers_ac` 绑定不可漂移）。共 28 条 · 13 unit / 12 component / 3 integration。

## 0. 测试分层与手段（哪些 AC 靠 unit、哪些靠集成 / 真机）

| 层 | 手段 | 覆盖 AC | 说明 |
|----|------|---------|------|
| **unit** | 纯逻辑 · mock `hostClient`/`hostRegistry`/`window.termpro` | AC-7（forWorkspace 键解析）· AC-6（复合键路由 + 本机基线 + sessionEvents 等价）· AC-2（`formatTabBadge`）· AC-9（host 侧 params 校验）· AC-11（回落 reducer）· AC-5（grep 门禁扫源码） | 不渲染 DOM · 直接断言函数契约 |
| **component** | `@testing-library/react` render（jsdom）· mock `hostRegistry` + `window.termpro.remoteHost` 内存假桥 | AC-1 / AC-2 / AC-3 / AC-4 / AC-8 / AC-10 / D-7 远程文件禁用 | 复刻 `RemoteHostsPage.test.tsx` 的 `vi.hoisted` + 内存假桥模式 |
| **integration** | 多模块接线 · **注入 per-host client 桩** 到 `hostRegistry` · 驱动 store + terminalRegistry + sessionEvents | AC-5（终端/fs/git 路由全链路） | 沙箱无真机 sshd · 用桩替 WebSocket；断言 RPC 落在**远程桩** vs **本地桩** |
| **manual / 真机 spike**（不入 CI） | 发版前真机 sshd 连一台机跑终端/浏览目录/建 workspace | AC-4 真机建 workspace · AC-5 真链路 | 承接 BL-003 同类 concern（PRD §开工前必须想清 ❓）· 记入发版 checklist · **非自动化** |

**关键取舍**：本仓无独立 e2e runner（全部 vitest）。AC-5「全链路走该机 host」在沙箱内**只能靠桩注入 + grep 门禁**双保险——桩注入证明*路由到*远程 client（运行时），grep 门禁证明*没有旁路*（静态·防新增裸消费）。真链路留真机 spike。

---

## 1. Per-AC BDD 场景 + 可执行断言

### AC-1 · Sidebar 分组结构（本机组置顶 + 远程机组未连接态）—— `BL004-C-sidebar-groups`

```gherkin
Given 本机有 N=2 个 workspace（store.workspaces，hostId='local'）
  And 已配置 M=2 台远程机（remoteHost.list = [mini-pc(cfg-1), dev-server(cfg-2)]）
  And 两台远程机均未连接（useRemoteHostRuntimeStore.runtime 无对应 key）
When 渲染 Sidebar
Then DOM 首个 .sidebar-machine-group 是「本机」组头，且其下渲染 2 个 workspace 行
  And 存在 2 个远程机组头，文案含别名 'mini-pc' / 'dev-server'
  And 每个远程机组头渲染「连接」入口按钮（getByRole('button', {name: /连接/})）
  And 远程机组**未展开** workspace（其 machine.workspaces === null 分支 · 组内无 MachineWorkspaceRow）
```
断言要点：`queryAllByTestId('machine-group')[0]` 命中本机组；远程组 workspace 行数 = 0。

### AC-10 · M=0 纯本机退化态 —— `BL004-C-sidebar-m0`

```gherkin
Given 本机有 1 个 workspace
  And remoteHost.list 返回 []（M=0，现有 100% 用户形态）
When 渲染 Sidebar
Then 恰好渲染 1 个 .sidebar-machine-group（本机组头）
  And 无任何远程机组头、无「暂无远程机」空占位元素
  And 组头走的是与多机场景**同一套** MachineGroup 渲染路径（非 M=0 特判分支）
```
断言要点：`queryAllByTestId('machine-group')` 长度 === 1；`queryByText(/远程/) === null`。组结构恒显。

### AC-2 · 连接后展开 workspace + 会话徽标 —— `BL004-C-sidebar-connect-expand` / `BL004-U-badge-zero` / `BL004-U-badge-semantic`

```gherkin
# component（BL004-C-sidebar-connect-expand）
Given mini-pc(cfg-1) 组头处于未连接态
  And 注入 hostRegistry.getOrCreateRemote('cfg-1') 桩，其 rpc('workspace.list') resolve
      { workspaces: [aon-edge, ml-lab] }
When 点击 mini-pc 组头「连接」并等待连接就绪事件（runtime.stage='ready'）
Then mini-pc 组展开渲染 2 个 MachineWorkspaceRow（aon-edge / ml-lab）
  And 每行渲染会话徽标；首连 tabCount=0 时徽标显式渲染「0」（.sidebar-machine-sessions--zero 灰色）
When 断开（runtime.stage='disconnected' 或 clear）
Then 该组回折叠态（workspace 行数归 0）
```

```gherkin
# unit 徽标语义（BL004-U-badge-zero / BL004-U-badge-semantic）
Given formatTabBadge 输入本客户端在该 workspace 的活跃 tab 数
When 输入 0
Then 返回可见的「0 个标签」结构（不是 null / 不被 `{n && ...}` 吞掉）—— 这是 D-9「首连徽标可为 0」的硬断言
When 主机侧存在 3 个非本客户端起的会话，而本客户端在该 ws 有 0 个 tab
Then 徽标仍显 0（语义 = 本客户端 tab 数 · **非**「主机侧会话数」· 对齐协议现实 session:event 无 workspace 归属）
```
> ⚠️ 断言必须显式验证「非主机侧会话」：桩把 host 侧 sessionTracker 塞满，本客户端 store 无对应 tab，徽标恒 0。防止 RD 误接主机侧会话计数。

### AC-3 · 远程目录浏览器（加载 / 空 / 错误态）—— `BL004-C-adddir-*`

```gherkin
Given 「+ 添加项目」已选定远程机 mini-pc（进入 dir 步骤）
  And 注入远程 client 桩，rpc('fs.readdir', {path}) 可控 resolve/reject/delay

# BL004-C-adddir-loading
When 进入某目录，readdir 延迟 350ms
Then 期间渲染 .add-ws__dirlist--loading 转圈 +「正在读取目录…」
  And 「创建项目」按钮此时 disabled（不能对未读到的目录发起创建）

# BL004-C-adddir-empty
When readdir resolve { entries: [] }
Then 渲染既有「(空目录)」空态 · 非错误块

# BL004-C-adddir-error
When readdir reject（EACCES / 权限拒绝）
Then 渲染 .add-ws__dir-error 红块（含 EACCES 文案）+「重试」按钮
  And 不渲染目录列表 · 「创建项目」disabled
```

### AC-4 · 远程 workspace.create 落该机组 + 主窗口可见 —— `BL004-C-create-remote`

```gherkin
Given 远程目录浏览器已选定 /home/liam/proj（mini-pc）
  And 注入 mini-pc client 桩，rpc('workspace.create') resolve
      { id:'srv-ae', name:'proj', root:'/home/liam/proj' }
When 点「确认创建」
Then 调用发生在**该远程 client 桩** 上（expect(remoteStub.rpc).toHaveBeenCalledWith('workspace.create', {name,root})）
  And **未**在本地 hostClient 上调用（expect(localStub.rpc).not.toHaveBeenCalledWith('workspace.create', ...)）
  And 新 workspace 带 hostId='cfg-1' 入该机组视图态（不写 v2 持久化存档 · D-6）
  And 主窗口经 workspace:changed（该 host 作用域）后 Sidebar mini-pc 组出现 'proj' 行
```

### AC-5 · 全链路走该机 host（最高风险 · 穷举门禁）

**运行时路由（integration · 桩注入）** —— `BL004-I-route-terminal` / `-fs` / `-git`

```gherkin
Given active workspace = 远程 ws（hostId='cfg-1'）
  And hostRegistry.forWorkspace(ws) 返回 remoteStub；forWorkspace(localWs) 返回 localStub
When 该 workspace 触发终端 spawn
Then pty.spawn 落 remoteStub（非 localStub）
When FilePanel 加载该 ws 文件树
Then fs.readdir / fs.watch / fs.realpath 落 remoteStub
When App.tsx 分支刷新 / terminalLinks 校验路径
Then git.info / fs.stat 落 remoteStub
And 对每一个消费点断言：localStub 上**零调用**该 ws 的 RPC（不误走本机）
```
> 穷举消费点清单（逐项各一断言 · 对齐 PRD AC-5 + 路由门禁图）：
> ① 终端 PTY（pty.spawn/kill/input/resize/cwd）② terminalLinks（fs.stat/realpath）
> ③ FilePanel（fs.readdir/watch/unwatch + git.info/status/worktrees）④ App.tsx 分支刷新（git.info）
> ⑤ sessionEvents 订阅（(hostId,sessionId) 复合键）。

**静态门禁（unit · 扫源码）** —— `BL004-U-grepgate`

```gherkin
Given 扫描 src/renderer/**/*.{ts,tsx}（排除 __tests__）
When 匹配裸成员消费 /\bhostClient\./ 与 `import { hostClient }`
Then 命中文件集 ⊆ 豁免清单
```
豁免清单（ARCH-10 · D-7 · 写进测试常量，任何新增裸消费即红）：
- `services/hostClient.ts`（定义本身）
- `services/hostRegistry.ts`（内部持有 'local' 单例）
- `components/viewer/*`（FileView / MarkdownPreview / DiffPanel / FilesWindow / ViewerWindow / DirListing —— 独立查看器窗口 · 各持本窗口单例 · D-7 出范围）
- `components/FilePanel.tsx` 中**仅** `openViewerWindow` 入口的本地保留（D-7）——门禁需精确到「非 openViewerWindow 的 fs/git 消费必须走注入 deps」；实现上 FilePanel 的 fs/git 经 `makeHostDeps(client)` 注入，故 FilePanel 内不应再有裸 `hostClient.readdir/git` 调用，只余 viewer 窗口入口。

> ⚠️ FileView/MarkdownPreview/DiffPanel **不在**迁移清单——只在查看器窗口跑，随 D-7 保持本地。

**远程文件禁用（component · D-7）** —— `BL004-C-remotefile-disabled` / `BL004-C-remotefile-tree-ok`

```gherkin
Given active workspace = 远程 ws · FilePanel remote={true}
When 点顶部 Diff 按钮 / 某文件行内 diff 按钮 / 文件行本身
Then 三入口均触发确定性行内提示「远程文件独立窗口暂不支持」（.file-panel__remote-hint · 1.8s 自动消失）
  And 按钮为 aria-disabled（**非** 原生 disabled · 否则 click 不派发 = 静默失败）
  And **不**调用 window.termpro.openViewerWindow / 不拉起本地查看器窗口（expect(openViewer).not.toHaveBeenCalled()）
When 点目录行 / 观察 git 着色
Then 目录正常展开收起 · file-panel__row--git-* 着色类照常生效（树浏览+着色在范围）
```

### AC-6 · 本机零回归（硬约束）—— `BL004-U-local-baseline` / `BL004-U-session-local-equiv` / `BL004-U-composite-nocross`

```gherkin
# 差分基线（BL004-U-local-baseline）
Given active workspace = 本机 ws（hostId='local'）
  And 全程经 hostRegistry.forWorkspace(ws)（改造后路径）
When 驱动本机 workspace 的终端 spawn + 文件树 + 分支刷新
Then forWorkspace('local') 返回的对象 === 既有 hostClient 单例（未新建连接）
  And 记录的 RPC 调用序列（方法名+参数+顺序）等于金标准基线数组（0 新增 · 0 缺失）

# sessionEvents 复合键后本机等价（BL004-U-session-local-equiv）
Given sessionEvents 路由改 (hostId,sessionId) 复合键
When 回放一组本机 session:event（state/bell/notify/quiet/cmd-done）序列
Then 产生的 updateTab / pushNotification / setDockBadge 调用序列与改造前**逐条等价**
  （复刻 notificationBadge.test.ts 断言口径 · 本机通知/角标行为不变）

# 复合键不串 tab（BL004-U-composite-nocross · ARCH-9）
Given 本机 tab T_local 持 sessionId='s1'（hostId='local')
  And 远程 tab T_remote 持 sessionId='s1'（hostId='cfg-1'，per-host 计数器碰撞）
When 远程 host 推 session:event(hostId='cfg-1', sessionId='s1')
Then 事件路由到 T_remote（非 T_local）· findTabByHostSession('cfg-1','s1') === T_remote
```
> 「既有套件不翻红」= 套件级门禁：改造后 `npm test` 全绿（workspaceCrud / notificationBadge / filepanel/* / terminalLink* / workspaceSync 等既有测试零改动仍通过）。这是 CI gate，不是单条 test，但 `BL004-U-local-baseline` 提供可回归的显式基线锚点。

### AC-7 · hostId='local' 恒解析既有单例 —— `BL004-U-hr-local` / `BL004-U-hr-remote` / `BL004-U-hr-key-authority`

```gherkin
Given HostRegistry 新增 forWorkspace(ws: {hostId})
When forWorkspace({hostId:'local'})
Then === hostClient 既有单例（=== registry.local()）
When forWorkspace({hostId:'cfg-1'})（cfg-1 已 getOrCreateRemote）
Then 返回该远程 client · !== hostClient
When ws.hostId='local' 但某桩 host.info.hostId 被设成 'cfg-9'（制造双源诱因）
Then 路由仍按 map 键 'local' 解析到本地单例（host.info.hostId 不参与 · 消除双源）
```

### AC-8 · 组头连接生命周期态 —— `BL004-C-grouphead-connecting` / `BL004-C-grouphead-failed`

```gherkin
Given mini-pc 组头 · useRemoteHostRuntimeStore.applyEvent 驱动
When runtime={stage:'connecting'} → {stage:'deploying', percent:47}
Then 组头渲染「连接中」转圈 → 「部署中… 47%」
  And 文案取自 BL-003 CONNECT_STAGE_LABEL 同一常量（非另起 · 与 Remote Hosts 页一致）
When runtime={stage:'failed', reason:'unreachable'}
Then 组头渲染失败原因（✗ 不可达）+「重试」入口
```
> 越界守卫：不测断线横幅 / 自动重连 / 状态对账（= BL-005 · PL-1 · 本 AC 不含）。

### AC-9 · workspace service 边界 params 校验（F10）—— `BL004-U-params-valid` / `BL004-U-params-reject`

```gherkin
Given host 侧 workspace service 收 create/update/remove params
When 合法 params（create {name,root} 齐全且类型正确）
Then 通过 · 正常落注册表
When 非法 params：缺 root / name 非 string / id 越界(空串) / update patch 含未知字段
Then 运行时校验拒绝（抛错或返回 error）· **不落坏数据**（注册表快照前后不变）
```
> 定位：host 侧（`src/host/**` workspace 注册/服务层 · 远程面正是消费点）。仅 F10；F6/F9/F11/F13 出范围（PENDING-002 单开）。

### AC-11 · 远程断线 → active workspace 回落本机首个 + 组折叠 —— `BL004-C-disconnect-fallback` / `BL004-U-disconnect-empty`

```gherkin
Given active workspace = 远程 ws（hostId='cfg-1'）· 本机有首个 ws L1
When 到达断线事件（remoteHost stage='disconnected'）
Then 面板先显断线态（panel 阶段）
  And activeWorkspaceId 回落到本机首个 workspace（L1）
  And 该远程机组折叠回未连接态（保留「已断开」措辞 · 与「从未连接」灰态区分）

Given active workspace = 远程 ws · 且**无**本机 workspace
When 断线
Then activeWorkspaceId 回落空态（null）· 不困在死 host workspace
```
> 只做「断线那一刻」的确定性回落（消费面职责 · D-8）· 不做重连恢复（BL-005）。

---

## 2. 桩 / Mock 基础设施（RD 复用）

- **hostRegistry mock**：复刻 `RemoteHostsPage.test.tsx` 的 `vi.hoisted` —— `{ local: () => localStub, getOrCreateRemote: () => remoteStub, forWorkspace: (ws) => ws.hostId==='local' ? localStub : remoteStub, drop }`。两桩各自独立 `rpc: vi.fn()`，AC-5 靠「落在哪个桩」判路由。
- **window.termpro.remoteHost 内存假桥**：复用 `RemoteHostsPage.test.tsx` `makeRemoteHostBridge`（list/save/delete 真 CRUD + onEvent 记监听者，`emit()` 驱动 runtime）。
- **session:event 回放**：`hostClient.onSessionEvent` mock 存 callback，测试内手动 `emit(hostId, sessionId, event)`，复合键版签名带 hostId。
- **store 直挂**：unit 层 `useAppStore.setState({...})` 直接种 workspaces（带 hostId 字段），复刻 `notificationBadge.test.ts` seed 模式。
- **grep 门禁**：Node fs 扫 `src/renderer`（`import.meta` 或 process.cwd 定位），正则 + 豁免 allowlist 常量；命中差集非空即 fail，报文件+行号。

## 3. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-10 | 首版：28 条 TC 覆盖 AC-1~AC-11 · unit/component/integration 三层 + 真机 spike 划出 CI |
