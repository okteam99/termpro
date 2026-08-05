---
review_model: fable
review_via: subagent
target_commit: dcf6689599ddf6580f5ae607c1024c1d81a44364
review_stage: blueprint
reviewed_artifact_version: "TECH.md v0.1"
coverage: [可实现, 可验证, 并发与生命周期]
verdict_at_review: NEEDS_REVISION
disposition: 全部 ADOPT · TECH 已据此重写为 v0.2
files_read:
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/TECH.md
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/PRD.md
  - src/renderer/state/remoteHostStore.ts
  - src/renderer/components/Sidebar.tsx
  - src/renderer/components/MachineGroup.tsx
  - src/renderer/components/settings/RemoteHostsPage.tsx
  - src/main/remote/orchestrator.ts
  - src/main/remote/remoteHostIpc.ts
  - src/preload/preload.ts
  - src/renderer/types.d.ts
  - src/shared/remoteHost.ts
  - src/renderer/services/reconnectController.ts
  - src/renderer/services/reconnectWiring.ts
  - src/renderer/services/remoteWorkspaceSync.ts
  - src/renderer/services/hostRegistry.ts
  - src/renderer/services/hostClient.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/renderer/state/store.ts
  - src/shared/i18n.zh.ts
  - src/main/remote/deploy.ts
  - src/main/remote/credentialStore.ts
  - src/renderer/App.tsx
procedural_note: |
  🔴 如实记录一处与配方的差异:本次冷审是在 `state.py external-review` 生成 prompt doc
  **之前**派发的,subagent 收到的是 PMO 手写的等价评审指令(同样规定了隔离、模型错开、
  覆盖方向制、禁编造行号、以及两个点名必答的独立判断题)。实质满足第三视角要求:
  独立 subagent context · 模型 fable ≠ 会话主模型 opus · 真读代码(见 files_read)·
  未被喂主对话起草心路。本文件是对该次真实评审的如实转录,非事后补写。
---

# 第三视角冷审(blueprint)· model=fable

被审对象:`TECH.md` v0.1。基线核对:worktree HEAD,`git diff 0fa8e29..HEAD -- src/` 为空(三个新 commit 全在 `docs/`),TECH 全部行号引用有效。TECH「decisive 前提核验」表 6 项与现状基线表逐条核过,**全部属实**。

verdict(评审当时):**NEEDS_REVISION**

## 方向:可实现

### EXT-1(high)· 已 ADOPT

**描述**:`applyEvent` gate 挡不住 AC-6 最危险的那半 —— 残余 `verifying{tunnel}` 触发 `beginHandshake` 把连接真的建成。gate 拦的是「store 写入」,但握手触发是订阅回调里的**副作用**,不经 store。

**证据**:`Sidebar.tsx:283-287` 的 onEvent 回调先 `applyRuntimeEvent(e)`(被 gate 吞),随后 `if (e.stage === 'verifying' && e.tunnel) beginHandshake(...)` **无条件执行**。可达路径:取消 claim 快路径连接时,main 侧 `orchestrator.disconnect` 有 mutex pending 时等最多 5 秒(`orchestrator.ts:421`),窗口内在途 `runConnect` 的 session 仍当值,`verifying` 照常 emit 送达。renderer 侧 `beginHandshake` → `getOrCreateRemote`(**把 client 重新插回 registry**,`hostRegistry.ts:24-34`)→ `client.reconnect` 真开 ws → `.then` 调 `onReconnected` → readopt(`Sidebar.tsx:254-265`)。此时 `readoptHost` 的实时查表(`terminalRegistry.ts:949`)**命中的是刚被重建的 client**,TECH R1 引以为据的「drop 同步删表」防线被 `getOrCreateRemote` 反向击穿。后果 =「界面已断开、后台却连上了 + 收养跑了」。

另:TECH 把设置页订阅内过滤「整段删除」,而现存 `abandonedRef` 过滤(`RemoteHostsPage.tsx:263-268`)是**先于** `beginHandshake` 的、今天恰好挡住重新握手 —— 删掉后设置页在这一点上是**净回归**。

**建议**:`beginHandshake` 入口第一行查 `isAbandoned`(Sidebar 与 RemoteHostsPage 两处);AC-6 落法须把「订阅副作用 gate」与「store 写入 gate」列为两道并存的闸,不能声称一道覆盖。

### EXT-4(medium)· 已 ADOPT

**描述**:AC-2 落法顺序(`abandon → cancel → disconnectAwait → clear + stopRemoteWorkspaceSync`)与 AC-2/AC-5 判据**自相矛盾**:`abandon` 只挡新写入、不清既有状态,`runtime[id]='ready'` 留到 `clear` 才消 —— 照字面实现,断开后组头保持「已连接」最长 5-8 秒。

**证据**:`remoteHostStore.ts:39-41`(gate 只拦写入);`orchestrator.ts:421`(等待窗口)。

**建议**:改序为 `abandon → cancel → clear + stopRemoteWorkspaceSync → setSettling → await` —— 即今天设置页的同步顺序(`RemoteHostsPage.tsx:322-328`)。这一改同时消灭 EXT-2 的竞态窗口,是比「到处补 isAbandoned 检查」**更省**的方案。

### EXT-5(medium)· 已 ADOPT

**描述**:§设置页收敛声称删「4 处引用」,但只给了 3 处替换写法;第 4 处 `handleUpgrade` 的 `abandonedRef.current.delete`(`RemoteHostsPage.tsx:339`)没有指定替换。漏改后果:断开后窗口内点升级 → 弃用标记未解除 → 升级沿途事件全被 gate 吞 →「点了升级毫无反应」,而 main 侧 forceRedeploy **真的在后台 reap 旧 host 并终止在跑会话**(`remoteHostIpc.ts:113-115`)。

### 简洁性 counter-lens 逐项结论

- `settling`:**留**。dedupe 竞态属实 —— 取消后 5 秒窗口内 `connect()` 命中 `connectInflight` 直接返回垂死 promise(`orchestrator.ts:376-377`),`disconnect` 让路判据(`:425-426`)为假、照常拆除。「点了没反应」是真实缺陷,无 settling 就无法呈现「在忙」。
- `disconnectAwait` 新通道:**留**。唯一的完成信号;轮询 `stages()` 更糟;main 侧让 connect 排队接续要动状态机(Out of Scope 明禁)。次优备选:把现有 `disconnect` 整体迁 invoke 并改掉全部调用点(全仓仅 3 处)可消 R3 双通道误用风险,成本相当,不作打回条件。
- 8 秒 `Promise.race`:**留**。`orchestrator.disconnect` 自身近必 resolve,race 防的是 IPC 层异常,一行成本合理。
- **更省方案**:有 —— EXT-4 的改序。不减少三件新增物,但把语义窗口缩到最小,免去为 EXT-2 单独加闸的必要。三件新增物没有一件是 AI 惯性,全过 ROI。

## 方向:可验证

### EXT-3(medium)· 已 ADOPT

**描述**:AC-7 落法漏了 PRD 判据里的「**且不处于自动重连编排中**」。自动重连每次尝试失败 main 都 emit `failed` 且被无条件写进 store(`Sidebar.tsx:284` + `:288-294`),照字面实现会在每个退避周期弹一条失败 toast。今天组头不显示这些 failed 是因为 reconnecting 分支屏蔽了 runtime 呈现(`Sidebar.tsx:521-530`、`MachineGroup.tsx:269`);新 toast effect 直接看 store,必须自带同款排除。

### EXT-8(low)· 已 ADOPT

**描述**:四个 seam 本身可测,但有三个缺口:① **没有任何 seam 覆盖「残余 verifying 不得触发新握手」** —— AC-6 判据最尖的一颗牙、EXT-1 的病灶;不补测试,EXT-1 修了也钉不住。② 没有 seam 覆盖 EXT-2 的重连再点火。③ seam 2 的断言「readoptHost 未被调用」措辞不成立 —— 它**会**被调用,靠 `terminalRegistry.ts:959-960` 早退;应断言 `session.list`/`attach` 未发出。另 AC-15 的位置不变式在 jsdom 无布局,只能降级为 DOM 顺序/类名断言。

## 方向:并发与生命周期(自选)

> 自选理由:本 Feature 自称的正确性要害即三条异步通道收口,对抗采样期望值最高。

### EXT-2(high)· 已 ADOPT

**描述**:**可等待断开的 await 间隙打开了一个 TECH 未识别的「第四通道」—— client 层 `reconnectNeeded` 再点火,击穿 AC-9/AC-2。** TECH AC-9 行说「abandon 进一步保证残余 disconnected 不会被 onDisconnected 重新拉起」—— 机理描述是**错的**:`onDisconnected` 的唯一触发源不是 main 事件,而是 `client.onReconnectNeeded`(全仓唯一接线点 `Sidebar.tsx:321-325`),由 transport 关闭/心跳判死驱动(`hostClient.ts:279-289`、`:306-309`),**完全不经 applyEvent,store gate 对它无效**;`setReconnecting` 也不在 gate 清单里。

**证据**:时序 —— 从 ready 断开:`await disconnectAwait` → main 关 forwardServer(`orchestrator.ts:431`)→ renderer ws 收到**对端**关闭(非 dispose 自关,`hostClient.ts:99-106` 只摘自己发起的 close)→ `reconnectNeeded` → `onDisconnected` → `isReconnecting` 为假(cancel 刚清过)→ **置 reconnecting=true + fireAttempt → disconnect+connect IPC**(`reconnectController.ts:107-113/88-99`、`reconnectWiring.ts:22-24`)→ 组头显示「重连中」且 main 真的重建隧道,到 verifying 再与 EXT-1 串成完整的后台复活链。

关键对照:**今天设置页没有这个洞** —— `RemoteHostsPage.tsx:322-328` 在同一同步 tick 内完成 send+clear+drop,close 事件下个宏任务派发时 client 已 dispose;是 TECH 新引入的 await 把 drop 推到异步之后才制造出窗口。

**建议**:双保险 —— ① 采纳 EXT-4 改序(drop 先于 await,窗口归零);② `Sidebar.tsx:322` 的 onReconnectNeeded 回调加 `isAbandoned` 守卫。AC-9 行的机理表述须改写。

### EXT-7(low)· 已 ADOPT(以裁决方式)

**描述**:`aria-disabled` **不阻止 click 派发**,真正防线必须是 click handler 内查 settling 并 no-op;TECH 只写了 ARIA 属性与 tooltip。

**处置**:PMO 裁决改用「忙碌指示 + 排队兑现」,不设禁用态,该问题从根上消失。

### EXT-6(low)· 已 ADOPT

**描述**:两条删除路径(`Sidebar.tsx:204-208` 轮询清理、`RemoteHostsPage.tsx:443-451` confirmDelete)都只调 `clear`,而 TECH 明确 clear 不删 abandoned → 条目**永久留存至进程退出**。后果小(config id 为 12 位 base64url 随机,`credentialStore.ts:217`,复用概率可忽略),属规格缺口。

## 两个点名必答的独立判断

**(a) 死锁风险** —— 结论:**TECH 设计内无死锁,且是刻意的**。`fireAttempt` 的 disconnect-first 走 `deps.disconnect` = 旧 fire-and-forget IPC(`reconnectWiring.ts:24`),直达 main,**不经任何会置 abandon 的 UI 流程**;TECH 明文保留原 disconnect 通道给 reconnectController 用,所以自动重连不可能给自己贴弃用标记。自触发的 disconnected 已有 CR-1 ③ 再入守卫(`reconnectController.ts:109`)。真正的缺口是**反方向**的(EXT-2)。建议 TECH 加一句钉死约束:reconnectController 的 `deps.disconnect` 永远不得改接到带 abandon 副作用的新断开流程。

**(b) 弃用标记泄漏面**:
- **删除远程机配置**:两条路径都只调 `clear` → 条目永久留存至进程退出。后果小但属规格缺口 → EXT-6。
- **应用重启**:renderer 内存态,自然清零,无泄漏。
- **连接失败后不再点连接**:标记留存且持续吞该机事件 —— 正是期望语义,非泄漏。
- **成对性核查**:全仓 `remoteHost.connect` 调用点仅 `Sidebar.tsx:451`、`RemoteHostsPage.tsx:311`、`reconnectWiring.ts:22` 三处 + upgrade 通道。前两处 TECH 已配 resume,第三处按 (a) 不应配,upgrade 即 EXT-5。枚举完备。

## 查过无发现

AC-8/AC-12「无需新代码」断言成立(`store.ts:1010-1016` 回落、`:1002-1007` 布局快照、`remoteWorkspaceSync.ts:81` 恢复挂点);toast 单源/挂载点属实;i18n 词条行号逐字命中;多机并发断开无共享状态冲突(`abandoned`/`settling` 均 per-configId);「resume 后在途残余事件写穿」窗口仅毫秒级 IPC 送达间隙,人手不可达,接受。

两条顺手 info:`MachineGroup.tsx:286-288` 的 `status==='connecting'` 分支是死代码(Sidebar 从不派生该值),AC-4 重构时宜一并清;`prevStages`(`Sidebar.tsx:350`)在 clear 后留陈旧条目,现无害。

## 总评

方案核心洞察(gate 放 store 写入收口)方向正确、前提核验全部属实、简洁性取舍质量高。但「一道 gate 覆盖三条通道」经不起对抗:**订阅副作用(EXT-1)与 client 层重连信号(EXT-2)都绕过 store**,且后者是本方案自己引入的 await 间隙制造的。两个 high 共享同一个最省修法 —— 把 `clear + stopRemoteWorkspaceSync` 提到 await 之前(镜像设置页现有同步顺序),再给 `beginHandshake` 与 `onReconnectNeeded` 接线各补一行 `isAbandoned` 守卫即可收敛,不需要新机制。
