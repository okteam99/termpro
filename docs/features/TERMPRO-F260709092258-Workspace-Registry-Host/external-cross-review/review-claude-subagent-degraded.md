---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "localconfig disable_external_review=true(单模型 · 异质评审降级为同模型 exec 自审 · 已 startup WARN)"
review_via: subagent
perspective: "external-claude (degraded · same-model subagent self-review)"
target: code
generated_at: "2026-07-10T04:20:00Z"
model: "claude-opus-4-8"
files_read:
  - "docs/features/TERMPRO-F260709092258-Workspace-Registry-Host/TECH.md"
  - "src/shared/protocol.ts"
  - "src/host/host.ts"
  - "src/host/workspaceService.ts"
  - "src/host/workspaceRegistry.ts"
  - "src/main/main.ts"
  - "src/main/appStore.ts"
  - "src/preload/preload.ts"
  - "src/renderer/types.d.ts"
  - "src/renderer/App.tsx"
  - "src/renderer/services/hostClient.ts"
  - "src/renderer/state/store.ts"
  - "src/renderer/state/persistence.ts"
  - "src/renderer/state/workspaceMigration.ts"
  - "src/renderer/state/workspaceSync.ts"
  - "src/renderer/components/Sidebar.tsx"
  - "src/renderer/components/TransientToast.tsx"
  - "src/host/__tests__/workspaceRegistry.test.ts"
  - "src/host/__tests__/workspaceMultiClient.integration.test.ts"
  - "src/renderer/state/__tests__/workspaceSync.test.ts"
  - "src/renderer/state/__tests__/workspaceUpgrade.integration.test.ts"
findings:
  - id: CR-1
    checklist: C2
    severity: high
    location: "src/renderer/state/persistence.ts:34-42 + src/renderer/state/store.ts:302-321 + src/renderer/state/persistence.ts:55-61,88-99"
    issue: "hydrate 期 workspace.list RPC 失败被 catch 吞成空数组 registry=[],v2 分支据此把所有 v2 存档条目当孤儿外键静默丢弃,随后首个 state 变更触发防抖 serialize 把空 workspaces 写回 v2 存档 —— 永久丢失 per-client 视图态(tabs/cwd/filePanel/排序)。"
    rationale: "persistence.ts:38-40 失败仅 warn 后 registry 保持 [];store.ts:309-310 v2 分支 `if(!entry)continue` 无条件丢孤儿;serialize v2(persistence.ts:88-99)写内存快照 = [],经 subscribe(persistence.ts:55-61)落盘覆盖磁盘 v2 条目。Host 15s RPC 超时(hostClient)/host 重启即可触发,workspace 本体存于 Host 不丢但用户 tab 布局全塌成单默认 tab,无任何提示。TECH 风险表只覆盖『注册表文件被删/损坏(真空)』,未覆盖『host 存活但 list 瞬时失败(假空)』。"
    suggestion: "区分『list 失败』与『list 真空』:workspace.list reject 时不进入破坏性 v2 hydrate —— 或保持 hydrated=false + 不订阅持久化 + 重试,或以 archive 视图态为准不丢弃(视为未知则保留),关键是禁止把源自失败 fetch 的空列表 serialize 落盘。补一条 list-reject 单测。"
  - id: CR-2
    checklist: C3
    severity: low
    location: "src/host/workspaceRegistry.ts:180-193(enqueueWrite 同步快照)+ :129-137(create rollback)"
    issue: "并发 mutation 下,失败写的内存回滚无法撤销一个『已在回滚前同步快照』的后续队列写;若该后续写成功,会把被回滚的条目落盘,使盘 ≠ 内存 ≠ 广播快照。"
    rationale: "enqueueWrite(L181-184)在调用时同步捕获 `this.workspaces` 快照。并发 create A/B(host.ts:117 `void handleRpc` fire-and-forget)时:A 同步 push→snapshotA=[a];B 同步 push→snapshotB=[a,b]。若 writeA([a]) 失败→A catch 回滚内存去 a(L134);但 writeB 的 snapshot 已含 a,writeB 成功则盘=[a,b]。A 已向客户端报失败、内存无 a,而盘上/重启后 a 复活,违反 TECH 自述不变式『广播出去的快照=已落盘状态』。触发需并发 + 写失败,概率低但正是 CR-2 并发序列化机制自身的漏洞。"
    suggestion: "回滚时同时使已入队但未落盘的写作废/重排队最新真相快照;或改为『每次落盘写当前权威内存』(队列尾读实时内存而非入队时快照)使回滚天然被后续写覆盖。补『并发 create + 首写失败』divergence 单测。"
  - id: CR-3
    checklist: C1
    severity: low
    location: "src/host/workspaceRegistry.ts:122-125(create 幂等返回既有,不更新字段)+ src/renderer/state/workspaceMigration.ts:87-89"
    issue: "workspace.create 的幂等是『存在即返回,不 upsert 字段』;若部分迁移已落一条,后续在 v1 fallback 期做的改名/改根会在下次迁移重跑完成时被静默丢弃。"
    rationale: "create(L122-125)命中既有 id 直接返回既有 entry,不应用入参 name/root。场景:首启迁移 partial(host 中途重启)落了 A={name:Alpha},v1 fallback 期用户改名 A→AlphaRenamed(写进 v1 存档 name);次启迁移重跑 create({id:A,name:AlphaRenamed}) 命中既有→返回 Alpha,翻 v2 后 hydrate 显示旧名 Alpha。TECH/完工自查称『以 id upsert 幂等』,实为 insert-if-absent,非字段 upsert。触发窄(partial 迁移 + fallback 改名 + 后续成功迁移),仅名/根丢失无崩溃。"
    suggestion: "明确迁移语义:create 命中既有时若 name/root 不同则更新(真 upsert),或迁移改用 create-then-update 兜住 fallback 期变更;文档纠正『upsert』措辞。"
  - id: CR-4
    checklist: C1
    severity: low
    location: "src/host/workspaceService.ts:63-67(remove no-op 仍广播)+ src/host/workspaceRegistry.ts:158-177(update 无同值检测)"
    issue: "workspace.remove 命中不存在 id(内存 no-op、不写盘)仍调用 broadcast();workspace.update 无『同值→no-op』检测,总是写盘+广播。与 TECH 接口表『不存在→no-op success』『同值→no-op』的语义有偏差。"
    rationale: "workspaceService.handle remove 分支(L63-67)无论 registry.remove 是否实际删都 broadcast();TECH L153/L154 标注 remove no-op、update 同值 no-op。终态正确,但每次 no-op remove 会向全部客户端推全量快照触发一轮 reconcile,update 同值多一次原子写。属可观测到的多余 churn 而非错误结果。"
    suggestion: "让 registry.remove/update 返回『是否实际变更』的布尔,service 仅在真变更时 broadcast/落盘;或接受当前行为并同步修订 TECH 措辞。"
  - id: CR-5
    checklist: C3
    severity: low
    location: "src/renderer/state/workspaceMigration.ts:86-95(逐条 create 循环,首个 throw 即整体中止)+ src/host/workspaceRegistry.ts:36-50(validName/validRoot)"
    issue: "单条畸形 v1 workspace(name 空 / root 非绝对路径)会使 workspace.create 确定性抛校验错,导致整个迁移永久卡在 v1 fallback —— 循环遇首个坏条目即 abort,每次启动重试仍在同条上失败,永不翻 v2。"
    rationale: "runMigration for-loop(L88-89)对逐条 create 直接 await,任一 reject 落 catch 保持 v1;validName/validRoot(L36-50)对畸形输入必抛。畸形是持久性(非瞬时),故重试无效,连续 3 次后仅一次性 toast,之后静默永卡。v1 root 通常源自 pickDirectory(合法绝对路径),触发概率低,但无任何降级/跳过/上报坏条目路径。"
    suggestion: "迁移对单条失败容错:跳过并记录坏条目(warn 附 id/root)、其余照迁,或在畸形不可迁移时给出可诊断提示而非无限静默重试。"
  - id: CR-6
    checklist: C2
    severity: info
    location: "src/host/workspaceService.ts:52-78(params 直接 as 强转)+ src/host/workspaceRegistry.ts:35-42(validName)"
    issue: "WorkspaceService.handle 对 params 只做类型强转不做运行时形状校验;create 缺 name 时 validName(undefined) 会抛原始 TypeError(undefined.trim())而非结构化校验错。"
    rationale: "L57-58 `params as {...}`;validName(L36)直接 `name.trim()`。当前 tsc 类型安全的本地调用者构造不出此输入,host.ts try/catch 也会兜住不崩,但 M5 远程/多客户端边界是不可信输入面,依赖『调用方守规矩』在远程就绪目标下偏弱。"
    suggestion: "在 service 边界或 registry 入口加显式参数存在性/类型校验(name/root 必为非空 string),统一抛结构化校验错;为 M5 不可信边界补一条畸形 params 用例。"
findings_summary:
  blocker: 0
  high: 1
  low: 4
  info: 1
  total: 6
---

# 详情

## 概览

按 code 变体 C1–C6 通读了本 Feature(commit `c53ec30`)相对 `d6494c6` 的全部改动 + 相关单/集成测试。整体实现与 TECH 一致度高:host 零 Electron(仅 node builtin)、契约单源(protocol.ts)、CRUD 全走 hostClient.rpc、v1/v2 双模式与迁移标记单源(存档 version)、reconcile 三分支纯函数化并有扎实 P0 契约测试、原子写 + 串行写队列 + 写穿回滚均落地。测试覆盖面广(注册表 12 例含并发/损坏/写失败回滚、双客户端广播集成 INT-001..004、reconcile COORD-001..011、迁移与升级端到端)。

未发现 blocker;发现 1 条 high(hydrate 期 list 失败的静默视图态丢失)与若干边界/一致性 low。以下详述最重要 3 条。

## CR-1 (high) — hydrate 期 workspace.list 失败会静默清空并落盘,丢失 per-client 视图态

数据流证据:
- `persistence.ts:34-42`:`workspace.list` reject 仅 `console.warn`,`registry` 保持初始 `[]`,随后无条件 `hydrate(registry, outcome.archive)`。
- `store.ts:302-321`:v2 分支以 `regById`(空)判定每个 v2 存档条目为孤儿外键 `if(!entry)continue`,全部丢弃 → `workspaces=[]`,`persistMode='v2'`,`hydrated=true`。
- `persistence.ts:55-61 + 88-99`:hydrate 后订阅任一 state 变更 → 防抖 `serialize`(v2 去 name/root)写 `workspaces:[]` → `storeSet` 覆盖磁盘 v2 存档里全部 `PersistedWorkspaceV2`(tabs/activeTabId/filePanel/排序)。

后果:host 启动瞬时不可达 / 15s RPC 超时 / host 重启窗口即触发。workspace 本体存于 Host 注册表不丢,但用户的多 tab 布局、每 tab cwd、文件面板展开态全部塌成单默认 tab,且无任何用户可见提示。这与 TECH 风险表覆盖的『注册表文件被删/损坏(真空,模型 A 可接受语义)』不同 —— 那是注册表真空,此处是 host 存活但 list 假空,属未覆盖缺口。建议:list reject 时不进入破坏性 v2 hydrate(保持 hydrated=false + 不启订阅 + 重试,或以存档视图态为准不丢弃),并禁止把源自失败 fetch 的空列表落盘。当前测试无一覆盖 `hostClient.rpc('workspace.list')` reject 路径。

## CR-2 (low) — 并发 mutation 下失败写的回滚与已入队写的快照不一致

`workspaceRegistry.ts:180-193` 的 `enqueueWrite` 在调用时同步捕获内存快照;`host.ts:117` 是 `void handleRpc` fire-and-forget,并发 create 可达(REG-008/并发 no-lost-update 已证并发路径存在)。当首写失败触发内存回滚(L134)时,一个在回滚前已同步捕获了含该条目快照的后续队列写若成功,会把被回滚条目落盘,造成盘/内存/广播三者分叉、重启后『幽灵 workspace』复活,违反 TECH 自述『广播出去的快照=已落盘状态』不变式。触发需并发 + 写失败双条件,概率低,但正落在 CR-2 并发序列化机制自身的盲区。现有 `test_write_failure_rolls_back_memory` 只测单条串行写失败,未覆盖并发交织。

## CR-3 (low) — create 幂等是 insert-if-absent 而非字段 upsert,partial 迁移 + fallback 改名会丢改名

`workspaceRegistry.ts:122-125` 命中既有 id 直接返回既有 entry,不应用入参 name/root。若首启迁移 partial(host 中途重启)已落条目,v1 fallback 期用户改名(写进 v1 存档),次启迁移重跑时 create 返回旧名 → 翻 v2 后显示旧名。TECH/完工自查措辞『以 id upsert 幂等』与实现(insert-if-absent)不符。正常单次迁移无此问题;触发窄且仅名/根丢失。

## 其余(CR-4/5/6)

- CR-4:remove no-op / update 同值仍广播+落盘,与 TECH『no-op』语义偏差,产生多余 cross-client churn(终态正确)。
- CR-5:单条畸形 v1 workspace 会使迁移永久卡 v1(循环首个 throw 即 abort,持久性失败重试无效),无跳过/降级/坏条目上报。
- CR-6:service 边界 params 无运行时校验,M5 远程不可信输入面偏弱(当前本地类型安全 + try/catch 兜底不崩)。

## 未见问题(正向确认)

- host 零 Electron 红线:`workspaceRegistry.ts`/`workspaceService.ts` 仅 `node:fs/path/crypto`,`host.ts` 新增仅 `node:path`,数据目录经 main env 注入(`main.ts:121-125`)—— 合规。
- 回声 vs 新建即选中的乱序收敛:create 成功 set `activeWorkspaceId=entry.id` + `exists` 去重(`store.ts:351-359`)与 reconcile 按 id 幂等(`workspaceSync.ts`)双路径均『按 id upsert』,COORD-011 已锁,分析正确。
- 先落盘后广播、失败不广播:`workspaceService.ts:57-77` + INT-004 已证。
- 迁移期无写回竞态:迁移在 hydrate 前、订阅在 hydrate 后(`persistence.ts:26-61`),迁移期 workspaces 为空无半态可写回 —— 与 TECH 风险缓解一致。
