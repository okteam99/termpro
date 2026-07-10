---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "worktree 无 localconfig · 异质降级为同模型隔离冷审"
review_via: subagent
verdict: NEEDS_REVISION
---

# BL-004 第三视角冷审 · 机器分组 Sidebar + 添加项目流程

独立采样，默认姿态=质疑。逐场景推演真实代码（未参考其它角色评审草稿）。

## 作用域隔离闭环 — 已验证成立

按团队 lead 三场景逐条推演 `reconcileWorkspaces` + `store.applyWorkspaceSnapshot/setHostWorkspaces`：

- **本机加项目不清远程组**：`applyWorkspaceSnapshot` scopeHostId='local' → `inScope=filter(hostId==='local')`，远程 ws 走 merge-back 的 `else workspaces.push(w)` 原位透传，三分支协调只在 inScope 子集内跑。✓
- **远程 active 不被抢**：active 守卫 `activeWasInScope = inScopeIds.has(activeWorkspaceId)`；本机快照到来时若 active 是远程 ws → `activeWasInScope=false` → active 原样不动。✓
- **远程快照不动本机**：`setHostWorkspaces(configId)` scopeHostId=configId，本机 ws 全部落 merge-back 透传分支。✓
- **forWorkspace/forHostId 分流**：读兜底 local + 恒 WARN（hostRegistry.ts:46），写 `forHostId` 未命中→null、`addWorkspace` v2 拿 null 即拒绝（store.ts:375-380）——create 绝不落本机。✓
- **serialize v1+v2 双过滤**：`localWorkspaces=filter(hostId==='local')` 在 v1/v2 两分支之前统一过滤，active 亦从 localWorkspaces 重算（persistence.ts:116-121）——远程 ws + 远程 active 均不写盘。✓
- **复合键 (hostId,sessionId)**：`findTab` 双字段匹配（terminalRegistry.ts:221），本机+远程同名 sessionId 不串 tab。✓
- **订阅生命周期**：`stopRemoteWorkspaceSync` 三步序正确（退订→dropHostWorkspaces→drop client），`sessionEvents.subscribe` 按 liveTabs 剪 `waitingNotified/lastExit`，无泄漏。✓
- **protocol.ts 零改**：`git diff main...HEAD -- src/shared/protocol.ts` 空。✓
- **53 消费点迁移**：renderer 非 test 无 `hostClient` 单例残留（viewer/* 仍用单例，但远程文件禁用后只走本机路径，属预期——见 E2）。✓

未发现 blocker 级作用域漏洞。下列为 open findings。

## Findings

### E1 · high · open · 拖拽重排把「本机子集下标」当「全量数组下标」传给 moveWorkspace
- **file:line**: `src/renderer/components/Sidebar.tsx:350-373`（handleDragOver）+ `src/renderer/state/store.ts:551-562`（moveWorkspace）
- **问题**: `handleDragOver` 用 `localWorkspaces`（已 filter 的本机子集）算 `srcIndex`/`dest`，但 `moveWorkspace(id, toIndex)` 的 `from` 用 `s.workspaces.findIndex`（全量数组）、`to` 直接当全量下标 splice。子集下标 ≠ 全量下标时错位。
- **触发路径**（BL-004 头号多机场景，可日常复现）：连一台远程机 → 远程 ws 追加到数组尾（reconcile step② + store.addWorkspace 均 append 到全量末尾）→ 再本机新增一个项目 → 新本机 ws 落在**远程 ws 之后**（store.ts:393 `[...s.workspaces, buildDefaultWorkspace]`）。此时本机 ws 在全量数组中不再连续（如 `[L0,L1,R0,L2]`）。把 L0 拖到本机组末尾：dest(子集)=2 被当全量 index 2（=R0 槽位）→ 结果 `[L1,R0,L0,L2]`，本机组渲染成 `[L1,L0,L2]` 而非期望 `[L1,L2,L0]`。
- **证据**: 代码注释（Sidebar.tsx:371）自述「本机 workspace 常态下连续排在数组前部」——但该假设被 store.addWorkspace「远程连上后新建本机项目 append 到末尾」当场证伪；错序还随 serialize 落盘（保留数组相对序），重启后持久错位。
- **建议**: 把 dest 从子集坐标翻译成全量坐标再传（取「当前处在该子集槽位的本机 ws 的全量 index」），或让 addWorkspace 把本机 ws 插到首个远程 ws 之前以维持连续前缀不变式；两者择一并补一条「远程已连 + 本机 ws 非前缀连续」的重排单测。

### E2 · medium · open · 远程 workspace 的三个「系统打开」按钮未随 D-7 禁用，把远程路径漏给本机 shell
- **file:line**: `src/renderer/components/FilePanel.tsx:650`（isHtml → openInBrowser）、`:668`（isFile → showItemInFolder）、`:680`（isDir → openPath）
- **问题**: D-7 远程文件禁用只覆盖了「文件内容」入口（顶部 Diff / 文件行点击 / 行内 diff，均 `aria-disabled`+提示，做得对）。但文件行的「浏览器打开」globe、文件行「Finder 显示」、目录行「Finder 打开」三按钮无 `isRemote` 门控。远程 ws 的文件树经 `forWorkspace` deps 真实拉取远程目录 → 这三按钮照常渲染，点击把**远程绝对路径**交给 `window.termpro.openInBrowser/showItemInFolder/openPath`（均在本机执行）。
- **证据**: 远程本机路径同名巧合时会静默打开**错误的本机文件**（无任何反馈），与 D-7「点击必须给确定性反馈」直接冲突；viewer/* 仍硬编码本机 `hostClient` 单例，正是靠这层禁用兜底，缺口即真漏。
- **建议**: 三按钮同样按 `isRemote` 走 `aria-disabled` + `showRemoteFileHint()`（与已改造的 Diff/文件行同一套），或直接不渲染。补 FilePanelRemoteDisabled 测试覆盖这三个入口。

### E3 · low · open · 每个被发现的远程 workspace 都被合成一个默认 tab，徽标恒非 0（与 AC-2/D-9「首连远程机可为 0」矛盾）
- **file:line**: `src/renderer/state/workspaceSync.ts:71-82`（reconcile 合成默认视图）+ `src/renderer/components/MachineWorkspaceRow.tsx:24-31`（formatTabBadge zero 分支）
- **问题**: `reconcileWorkspaces` 对快照新增 id 一律 `makeTab` 合成单 tab（与本机 buildDefaultWorkspace 对称）。故 `setHostWorkspaces` 注入的远程 ws 恒有 `tabs.length>=1`，`toRowData` 的 `tabCount=ws.tabs.length` 永不为 0——`formatTabBadge` 显式处理的 `zero` 分支经发现路径不可达。
- **证据**: 设计明写「首连远程机可为 0」并特意在 formatTabBadge 里防 `{tabCount && ...}` 吞 0，但实现让它成死分支；副作用是首次点开任一远程 ws 即在远程机 auto-spawn 一个 PTY（每台机每个 ws）。
- **建议**: 明确取舍——若徽标语义=「本客户端已开 tab 数」，远程发现应合成**空 tabs 视图**（tabCount=0，点开再懒建 tab）；若接受「发现即预置 1 tab」的本机对称语义，则更新 AC-2/D-9 文案去掉「可为 0」，避免规格与实现互相打脸。

### E4 · low · open · Sidebar remoteConfigs 仅挂载时拉一次，会话中增删远程机不刷新
- **file:line**: `src/renderer/components/Sidebar.tsx:182-190`
- **问题**: `remoteHost.list()` 在 `useEffect(…, [])` 里只调一次，`remoteConfigs` 驱动整个远程机分组列表。会话中在 RemoteHostsPage 新增/删除远程机后，Sidebar 不重拉 → 新机器不出现、已删机器组仍在（其 sync 也无对应 stop 触发）。
- **证据**: 组件只订阅 `remoteHost.onEvent`（runtime 事件），从不回拉 list；新增但尚未连接的机器无任何事件 → 组头不渲染。
- **建议**: 若属里程碑可接受（用户 ⌘R 重载即恢复）请在 known-constraints 显式记；否则在 `onEvent` 或专门的 config-changed 信号上 re-fetch `remoteHost.list()`。

### E5 · info · open · ensureSession 经 forWorkspace 兜底 local，断线竞态可能给远程 tab 起一个本机 PTY
- **file:line**: `src/renderer/terminal/terminalRegistry.ts:158`（`hostRegistry.forWorkspace({ hostId })`）+ `src/renderer/services/hostRegistry.ts:46-57`
- **问题**: spawn 是唯一带真实副作用（起真 shell 进程）的读路径，却走「未命中兜底 local」的 forWorkspace。远程 client 在选 ws 与 spawn 之间被 drop 时，会在**本机**起一个 PTY。
- **证据**: 自愈存在（drop 会 disposeTerminal 该 tab，spawn 后 `inst.disposed` 检查即 kill 掉误起的本机 PTY，terminalRegistry.ts:167），窗口很窄；仅记为需知边界，非缺陷。
- **建议**: 可接受现状；若想更稳，spawn 路径改用「未命中→抛错在终端里说话」而非静默兜底本机（与 forHostId 写路径同姿态）。

### E6 · info · open · Sidebar beginHandshake 镜像 RemoteHostsPage 握手编排，省略 E6「断开在途」过滤
- **file:line**: `src/renderer/components/Sidebar.tsx:192-237`
- **问题**: Sidebar 常驻挂载独立跑一套 `beginHandshake`（connect→冒烟→合成 ready），代码注释已自认与 RemoteHostsPage.tsx 的 beginHandshake 重复、且**未复制**其 E6 断开在途过滤。
- **证据**: 去重靠 HostClient.connect() 的 connectPromise 缓存，功能上不双连；但用户在 RemoteHostsPage 手动断开的同时若有 stale `verifying` 事件到达，Sidebar 会照常 beginHandshake 反连（窄竞态）。
- **建议**: 按注释所述把握手编排整体收敛进 `remoteWorkspaceSync.ts` 单源，消解两处重复面与语义漂移风险（文案常量 CONNECT_STAGE_LABEL 亦是手工镜像，同属漂移点）。

---

## 结论

**verdict: NEEDS_REVISION**（1 high + 1 medium 值得 ship 前处理；作用域隔离核心闭环成立，无 blocker）。

**最该 ship 前解决**：
1. **E1（high）**——拖拽重排的子集/全量下标错位，是 BL-004 自己的头号多机场景（连远程机后新增本机项目再拖拽）里可日常复现的静默错序，且随存档持久化。修下标翻译或 addWorkspace 插入位不变式，并补对应单测。
2. **E2（medium）**——远程 workspace 的 globe/Finder×2 三个系统打开按钮未随 D-7 禁用，把远程路径漏给本机 shell（同名巧合时静默开错本机文件）。按已有 aria-disabled+提示同款补齐，并加测试。
