# BL-004 PRD · QA 冷审（隔离 · 未参与起草）

- **feature**：TERMPRO-F260710011342-Sidebar-Machine-Groups（WS-01-S4 · BL-004）
- **审阅角色**：QA（AC 完备性 / 可测试性 / 优先级 / PENDING-002）
- **审阅日期**：2026-07-10
- **verdict**：**NEEDS_REVISION**

## verdict 理由（一句话）

三条 WS-01-S4 核心 AC 在 PRD 里都能找到落点（AC-1/2=①、AC-3/4=②、AC-5=③），但存在 5 处 MAJOR 缺口，会让一份实现「写死的 AC 全绿却仍漏真实用户场景」——最典型的是：远程 workspace 的路由键 `hostId` 在协议/store 里根本不存在（隐性未交付项）、AC-5「全链路」只点名 3 个子系统而实际有 40+ 消费方、活跃会话徽标的数据源未定义、断线时正在打开的远程 workspace 面板行为未定义。这些不是措辞问题，是 AC 覆盖漏洞，须补齐后再进 blueprint。

## files_read

- `docs/features/TERMPRO-F260710011342-Sidebar-Machine-Groups/PRD.md`（评审对象）
- `docs/features/TERMPRO-F260710011342-Sidebar-Machine-Groups/YOLO-PREFLIGHT.md`（意图锚 · 6 决策）
- `product-overview/workstream/WS-01-remote-host.md`（上游 · §WS-01-S4 三条核心 AC）
- `product-overview/PENDING.md`（PENDING-002 五小项）
- `src/renderer/components/Sidebar.tsx`（现状：平铺列表 · attention pill 源自 ws.tabs · homedir 取本地单例）
- `src/renderer/services/hostRegistry.ts`（BL-003 结构 · LOCAL_KEY='local' 硬编码 · 未迁消费方）
- `src/renderer/state/store.ts`（WorkspaceState 无 hostId 字段）
- `src/renderer/state/remoteHostStore.ts`（configId→RemoteEvent 运行态 · 不持久化）
- `src/shared/protocol.ts`（WorkspaceEntry 无 hostId · host.info.hostId 恒 'local' · workspace.list/create/remove/update）
- `src/shared/remoteHost.ts`（RemoteStage/FailReason 生命周期枚举 · RemoteHostConfig）
- 全仓 grep `hostClient` 消费方（40+ 处：terminalRegistry / terminalLinks / DiffPanel / FileView / MarkdownPreview / FilePanel / sessionEvents / DirListing / viewer/* / TabBar 等）

---

## findings

### QA-1 · MAJOR · 「活跃会话徽标」数据源未定义（category: completeness / testability）

**描述**：AC-2 断言连接后「各 workspace 的活跃会话徽标」，WS-01-S4 核心 AC① 亦要求「含活跃会话徽标」。但现 Sidebar 的 attention pill（`ws.tabs.filter(t => t.waiting || t.unseenDone)`，Sidebar.tsx:271）源自 **UI 本地 tab 态**。经 `workspace.list` 新发现的远程 workspace 在本地 store 里**没有 tabs**——徽标从何而来无定义。协议侧也没有「按 workspace 枚举该 host 活跃会话数」的 RPC（protocol.ts 无此方法）。因此 AC-2 的徽标既不可实现也不可测：无法判定「徽标数=?」。

**建议**：明确徽标语义与数据源，二选一并落 AC + 测试：(a) 徽标=该 host 上属于该 workspace 的活跃 PTY 会话数 → 需新增 host 侧 RPC（会碰 protocol.ts，超出「仅 host.info 追加」的声明范围，须显式登记）；(b) 徽标仅反映「本 UI 本次会话内起的 tab」→ 则首连远程机徽标恒 0，须在 AC 里写清并与全景「活跃会话徽标」对齐确认不是指跨端存活会话（那属 BL-005）。

---

### QA-2 · MAJOR · AC-5「全链路」覆盖面被低估（3 子系统 vs 40+ 消费方）（category: completeness / correctness）

**描述**：AC-5 只点名「终端 PTY / fs.readdir·readFile / git 状态」三类，但 grep 显示走 `hostClient` 单例的消费方 40+，且**多数不在这三类里**：`terminalLinks.ts`（fs.stat/fs.realpath/pty.cwd——终端里点链接做存在性校验）、`DiffPanel.tsx`（git.changedFiles + git diff）、`FileView.tsx`（fs.readFileBinary）、`MarkdownPreview.tsx`（fs.readFile + fs.stat）、`FilePanel.tsx`（fs.move/copy/writeFile/watch/unwatch）、`git.worktrees/git.status`、`sessionEvents.ts`。一份实现只迁这三类即可让 AC-5 判绿，却在远程 workspace 里**点终端链接 → fs.stat 走了本地 host**（误命中/报不存在）、**看 diff → git 走本地**。这正是 PRD ripple note（line 156）自己点名的「最大改面」，但 AC 没把覆盖面钉死。

**建议**：AC-5 改为断言「**当前 workspace 的一切 host 访问**均按 hostId 经 hostRegistry 选择」，并在 AC 或蓝图附「消费方清单」逐项过账（或引入单一路由接缝 seam，使 `hostClient.rpc` 对活跃 ws 的调用统一解析到其 host，测试即验接缝而非逐点）。否则遗漏点无门禁。

---

### QA-3 · MAJOR · `workspace.hostId` 路由键在数据模型里不存在——隐性未交付项（category: completeness）

**描述**：AC-5 明写「经 hostRegistry 按 **workspace.hostId** 选择」，但 `WorkspaceEntry`（protocol.ts:73-80）**无 hostId 字段**，renderer 的 `WorkspaceState`（store.ts:50-58）也**无 hostId**。PRD 隐藏前提①（line 155）承认「workspace.list on 某 host 返回的天然归该 host，Sidebar 分组时带上 hostId 即可」——即 hostId 是 **renderer 侧发现时标注**、非协议字段。但没有任何 AC 把「发现时给 workspace 记录标注来源 hostId、并作为路由单源」列为交付物。结果：路由键的产生位置/存储位置全靠实现者自悟，易两处不一致（Sidebar 分组用一套、路由用另一套）。

**建议**：新增 AC 或显式设计约束——workspace 在 `workspace.list on <host>` 返回时被标注 hostId（renderer 侧、不改 BL-001 协议契约），该标注是终端/文件/git 路由的**唯一键**；并在 store 的 WorkspaceState 增 hostId 字段（登记为本 Feature 数据模型变更）。

---

### QA-4 · MAJOR · 本机 per-host 键在 AC-6 与 AC-7 之间自相矛盾（category: consistency / testability）

**描述**：AC-6/D-1 说本机走 **'local' 键**复用既有单例；AC-7/D-2 说 host.info 返回「真实 hostId（本机=**稳定本机标识**）」且 renderer「以此为 per-host 键」。二者对「本机的 per-host 键到底是字面量 'local' 还是 host.info.hostId」给出冲突答案：若本机 hostId 真实化成 hostname（≠'local'），则与 hostRegistry 硬编码的 `LOCAL_KEY='local'`（hostRegistry.ts:9）分叉，本机 workspace 的路由键将不确定。隐藏前提②（line 155）也把「本机稳定 id」标为**未定**（"如 hostname 或固定常量 'local' 的真实化"）——这是伪装成已裁决的开放设计题。键定义不确定 → AC-6/AC-7 都无法写出确定断言。

**建议**：拍死一个口径并统一 AC-6/AC-7 措辞。推荐：本机 per-host 键**恒字面量 'local'**（保 hostRegistry 零改 + AC-6 零回归）；host.info.hostId 对本机**返回 'local'**（「真实化」对本机是 no-op，仅为未来 mobile/多 host 预留稳定字段语义），远程键=configId。这样 AC-7 的「真实 hostId」= 远程侧才有意义，与 AC-6 不冲突。

---

### QA-5 · MAJOR · 断线时「正在打开的远程 workspace」面板行为未定义（错误路径）（category: completeness / error-path）

**描述**：AC-2 管「分组折叠」、AC-8 管「分组头状态徽标」，但都没覆盖一个高频用户场景：**我正开着某远程 workspace 的终端/文件/git，此时该机断线**——终端面板显示什么？文件面板冻结还是报错？git 面板？以及 `activeWorkspaceId` 指向一个 host 已掉的 workspace 时，是回落本机 workspace 还是留空？这是 BL-004 的**消费面**职责（不是 BL-005 的重连/存活语义），PRD 却整体缺位。Out-of-Scope（line 147）把「断线重连策略」划给 BL-005 是对的，但「断线**当下**的呈现」仍属本 Feature。

**建议**：新增 AC 覆盖「活跃远程 workspace 遭遇 host 断线」的即时呈现（终端/文件/git 面板的 disconnected 态或错误横幅）+ activeWorkspaceId 的回落规则。可复用 hostClient.onDown（App.tsx:50 / ViewerWindow.tsx:44 已有本地版）。

---

### QA-6 · MEDIUM · 远程目录浏览器缺错误/空/加载态 AC + 与本机能力不对等（category: completeness / error-path）

**描述**：AC-3 只描述 fs.readdir over host「可逐级进入」的正路，没有任何 AC 覆盖：权限拒绝目录、路径不存在、浏览途中 host 断线、空目录。且**能力不对等**：本机走 `dialog:pick-directory`（系统对话框可**新建文件夹**再选），远程只有 fs.readdir 的**只读导航**（无 mkdir）——是否允许远程在「不存在的新目录」上创建 workspace 未定义。

**建议**：补远程浏览器的错误/空/加载态 AC；就「远程能否新建目录」拍板并写入 AC（保持与本机的创建能力对等或显式声明差异）。

---

### QA-7 · MEDIUM · AC-4「任一客户端可见」对远程 workspace 有隐性跨窗口连接依赖（category: completeness / architecture）

**描述**：AC-4 断言远程 workspace「任一客户端（主窗口 + 查看器）可见」。但每个 BrowserWindow 是**独立 renderer 进程**，各自持有自己的 hostRegistry 模块单例；查看器现用本地 `hostClient` 单例（ViewerWindow.tsx:40 `hostClient.connect()`）。远程 workspace 要在查看器「可见」，查看器必须**独立连上该远程 host** 才能收 workspace.list / workspace:changed。PRD 没交代查看器窗口如何取得远程连接（BL-003 的 connect 编排是 main 进程驱动，是否对各 renderer 扇出可用隧道未知）。因此 AC-4 的「任一客户端可见」在远程语境下是**有前提条件**的断言（该客户端须已连该 host），照字面无法达成。

**建议**：把「任一客户端可见」限定为「已连接该 host 的客户端」，或在蓝图明确查看器窗口获取远程连接的机制（跨窗口共享 vs 各窗口自连）。这是 blueprint 必答项，PRD 至少要点名此依赖。

---

### QA-8 · MEDIUM · AC-6「完全一致/零回归」不是可执行断言（category: testability）

**描述**：AC-6 用「行为与改造前**完全一致**」「零回归」表述——这是元属性，无法直接转测试。QA 视角问「零回归怎么验」没有答案。现有锚点存在（`hostClientEmbeddedRegression.test.ts` 已测「hostClient 公共 API 签名不变」），但 AC 没把「一致」拆成可断言项。

**建议**：把 AC-6 重写成具体断言组合：① 路由对本机 workspace 解析到**同一单例**（identity：`router.clientFor(localWs) === hostClient`）；② 现有 renderer 全测试套件保持绿（回归套件）；③ 枚举本机 终端/文件/git 冒烟路径行为不变。三条各挂 test_ref。

---

### QA-9 · MEDIUM · AC-6 / AC-7 优先级倒挂（category: priority）

**描述**：AC-6（本机零回归）标 P1，但它守护的是**当前 100% 用户**（今天所有 workspace 都是本机）在最大改面（40+ 消费方迁移）下的既有行为——一旦回归，**全体现存用户受损**，风险量级高于「AC-4 远程创建」这类 P0。AC-7（hostId 真实化）被 PRD 自己标为「BL-004 **前置**」（line 87/23），而 P0 的 AC-1..5 依赖 per-host 键成立——**前置项不能比依赖它的项优先级低**。两处优先级与风险/依赖不自洽。

**建议**：AC-6 提为 **P0**（回归即全员受损）；AC-7 要么提 P0（作为 per-host 键前置），要么并入 AC-1/AC-5 的前置设置项而非独立 P1。

---

### QA-10 · MEDIUM · AC-9 把 PENDING-002 五项打包成单条，损伤可追溯与可测性（category: testability / traceability）

**描述**：AC-9 将 F6/F9/F10/F11/F13 五个异质项塞进**一条 P2 AC**，`verify-ac` / `goal-complete` 无法分辨哪一小项过/挂。逐项可测性：
- F6 备份内容有断言 → 可测 ✓（迁移前断言备份文件内容 == 源）。
- F9 remove/update no-op 不广播 → 可测 ✓（spy 广播 · 对不存在 id 调 remove · 断言零 emit）。host 侧行为，判据清晰。
- F10 service 边界 params 运行时校验 → 可测 ✓（送畸形 params 断言拒绝）。「远程面正是消费点」理由成立。
- F11 viewer 广播不冗余 → **判据模糊**：「不冗余」= 去重？单次 emit？无可断言标准。
- F13 重试耗尽提示措辞清晰 → **主观**，自动化只能验「非空 + 含重试引导」，不能验「清晰」。

**建议**：AC-9 拆为 AC-9a..9e，各挂独立 test_ref；F11 给出具体去重判据（如「同一 workspace:changed 每次变更仅广播一次」）；F13 断言改为「提示含明确重连/重试引导且非空」而非「清晰」。

---

### QA-11 · MINOR · 远程 workspace 路径展示会拿本地 homedir 做 tildify（category: completeness）

**描述**：Sidebar 用 `homedir = hostClient.info?.homedir`（Sidebar.tsx:134）对 workspace 路径 tildify；TabBar.tsx:186 / sessionEvents.ts:59 的标签同样取**本地单例** homedir。远程 workspace 的路径（如 `/home/dev/proj`）会被拿**本机** home（如 `/Users/liam`）去 tildify → 显示错误。分组改造后这是必然可见的显示 bug 类，但无 AC 覆盖。

**建议**：加 note/AC——workspace 路径展示按**其所属 host 的 homedir** tildify（分组数据里已带 hostId，可就近取该 host.info.homedir）。

---

### QA-12 · MINOR · 远程创建的重复 workspace 守卫未定义（category: completeness）

**描述**：AC-4 未说明同一 root 在该远程机重复添加时的行为（workspace.create 是否按 root 幂等去重 / 提示已存在）。本机流程隐含有去重预期，远程应对齐。

**建议**：明确远程 create 的去重语义，与本机一致并写入 AC。

---

### QA-13 · MINOR · 机读 AC 块 ui_refs 缺失不一致（category: machine-contract）

**描述**：机读块里 AC-1/2/3/4/6/7 带 `ui_refs`，而 **AC-5、AC-8、AC-9 缺 ui_refs**（PRD.md 行 27-30 / 41-44 / 45-48）。feature `requires_ui: true`，且 AC-8 是**纯 UI 状态呈现** AC（分组头生命周期徽标）、AC-9 含 F11 viewer UI——缺 ui_refs 会在 verify-ac / goal-complete 的 UI 追溯上留洞。文件头注释明示此块被这两个工具解析。

**建议**：为 AC-5/8/9 补 `ui_refs`（至少统一置空数组保持结构一致；AC-8 应挂真实 ui_refs 指向全景 MachineGroup 状态徽标）。

---

### QA-14 · NIT · 已连接但零 workspace 的远程机组无空态（category: completeness）

**描述**：AC-2「展开列出其全部 workspace」未覆盖「该机 0 个 workspace」的空态呈现（应有「该机暂无项目，点 + 添加」之类）。

**建议**：补零 workspace 连接态的空态文案 AC。

---

## findings 汇总表

| id | severity | category | 一句话 |
|----|----------|----------|--------|
| QA-1 | MAJOR | completeness/testability | 活跃会话徽标数据源未定义（远程 ws 无本地 tabs · 协议无按 ws 枚举会话 RPC） |
| QA-2 | MAJOR | completeness/correctness | AC-5 只点名 3 子系统 · 实际 40+ 消费方（terminalLinks/DiffPanel/FileView/MarkdownPreview…）无覆盖门禁 |
| QA-3 | MAJOR | completeness | workspace.hostId 路由键在 protocol/store 里不存在 · 数据模型变更未列为交付物 |
| QA-4 | MAJOR | consistency | 本机 per-host 键在 AC-6('local') 与 AC-7(真实 hostId) 间自相矛盾 · 本机稳定 id 实为未定 |
| QA-5 | MAJOR | completeness/error-path | 断线时正在打开的远程 workspace 面板行为 + activeWorkspaceId 回落未定义 |
| QA-6 | MEDIUM | completeness/error-path | 远程目录浏览器缺错误/空/加载态 · 与本机「可新建文件夹」能力不对等 |
| QA-7 | MEDIUM | completeness/architecture | AC-4「任一客户端可见」对远程有隐性跨窗口连接依赖（查看器需独立连该 host） |
| QA-8 | MEDIUM | testability | AC-6「完全一致/零回归」非可执行断言 · 需拆成 identity + 回归套件 + 冒烟 |
| QA-9 | MEDIUM | priority | AC-6 应 P0（回归伤全员）· AC-7 前置项不该比依赖它的 P0 低 |
| QA-10 | MEDIUM | testability/traceability | AC-9 五项打包单条 P2 · F11「不冗余」/F13「清晰」判据不可测 |
| QA-11 | MINOR | completeness | 远程 workspace 路径用本地 homedir tildify → 显示错误 |
| QA-12 | MINOR | completeness | 远程创建重复 workspace 去重语义未定义 |
| QA-13 | MINOR | machine-contract | AC-5/8/9 缺 ui_refs（requires_ui 且 AC-8 纯 UI） |
| QA-14 | NIT | completeness | 已连接零 workspace 远程机组无空态 |

**放行条件**：QA-1~QA-5（5 项 MAJOR）须在 PRD 修订中补齐/拍板；QA-6~QA-10（MEDIUM）建议本轮一并解决（多为 blueprint 必答的前置澄清）；MINOR/NIT 可 blueprint 阶段随手带。

---

# Round 2 · 复核 PRD v0.2（只验 R1 findings 是否消解 + 有无新引入问题）

- **复核日期**：2026-07-10
- **verdict**：**NEEDS_REVISION（窄修 · 非 R1 那种大改）** — R1 的 14 条里 13 条已有效消解；**唯 QA-1（会话徽标）的 v0.2 修法 D-9 机制说错，落不了地**，且 D-9 引入一处未被守护的本机回归风险。其余 MEDIUM/MINOR 全解或可接受。

## files_read（R2 增量）

- `docs/.../PRD.md`（v0.2 · 全文重读）
- `src/renderer/services/sessionEvents.ts`（验 D-9 会话徽标可行性 · 关键）
- `src/shared/protocol.ts`（SessionEvent / session:event 形状 · 行 157-179）
- `src/renderer/services/hostClient.ts`（onSessionEvent 签名 · session:event 分发 · 行 122/338-339）

## R1 findings 逐条处置复核

| id | v0.2 处置 | 复核结论 |
|----|-----------|----------|
| QA-1 | D-9 + AC-2：徽标源=per-host session-event 聚合·不新增 RPC | ❌ **未消解**（机制落不了地 · 见 QA-1-R） |
| QA-2 | AC-5 穷举消费点 + grep 门禁「无残留裸 hostClient.」 | ✅ 消解 · 枚举覆盖主窗口消费面（查看器窗口经 D-7 正确出范围） |
| QA-3 | D-6：WorkspaceState 加运行时 hostId · 本机持久化/远程实时视图态 | ✅ 消解 · 数据模型缺口补上·远程不持久化避免孤儿外键 |
| QA-4 | D-2 撤销 host.info.hostId 真实化 · 权威键=hostRegistry map 键 · AC-7 重写 | ✅ 消解 · 干净·去双源（最佳修法） |
| QA-5 | D-8/AC-11：面板断线态 + activeWorkspaceId 回落本机首个 | ✅ 消解（但 AC-11 优先级见 QA-17） |
| QA-6 | AC-3 补加载/空/错误态 | ⚠️ 部分：错误/空/加载态已补；**「远程能否新建目录」不对等未处置**（QA-16 残留·MINOR） |
| QA-7 | AC-4 收窄主窗口 + D-7 远程查看器出范围 | ✅ 消解 · 显式 scope 决策·清爽 |
| QA-8 | AC-6 拆「既有测试套件不翻红 + 差分基线 0 新增」 | ✅ 消解 · 现可执行 |
| QA-9 | AC-6 升 P0 · AC-7 升 P0 | ✅ 消解 · 倒挂修正 |
| QA-10 | AC-9 收敛仅 F10 · F11/F13 剥离 PENDING | ✅ 消解 · 不可测项正确剥离 |
| QA-11 | （grep 门禁间接覆盖 homedir 裸消费） | ✅ 基本消解（grep 门禁强制迁 `hostClient.info?.homedir`）· blueprint 需显式「按行所属 host 解析 homedir」·见 QA-18 note |
| QA-12 | 未单独处置 | ⚠️ 残留（MINOR）· 远程重复创建去重仍未定义·并入 blueprint |
| QA-13 | AC-1/2/3/5/8/9/10 均补 ui_refs | ✅ 消解（AC-6/7 无 ui_refs 属纯路由 AC·可接受） |
| QA-14 | AC-10（M=0 退化态）+ AC-2 空态 | ✅ 消解 |

## 残留 / 新引入 findings

### QA-1-R · MAJOR · D-9 会话徽标机制说错·落不了地（category: correctness / testability）· 承 QA-1 未消解

**描述**：D-9/AC-2 定「徽标数据源 = per-host session-event 订阅·聚合该 host 各 workspace 活跃会话计数·**不新增 RPC**」。实读代码证伪此机制：
- `session:event` 消息**只带 `sessionId`**（protocol.ts:179 `{ t: 'session:event'; sessionId; event }`），**不带 workspace 归属**。
- 事件→workspace 的**唯一**归因路径是 `findTabBySessionId(sessionId) → tabId → 含该 tab 的 workspace`（sessionEvents.ts:45-48）。**无本地 tab 就无法归因**。
- 结论一（冗余）：本客户端在某远程 workspace 起了会话 → 必先建 tab（带 hostId）→ 该 workspace 的会话数**现有 `ws.tabs` 已能算**（即现 attention pill）。D-9 的「per-host 聚合」对这种情况**不增能力**。
- 结论二（不可能）：要显示「**该 host 上已在跑、但非本客户端所起**」的会话（这正是模型 A「连接即见活跃会话」的卖点）→ 需要 host 侧「按 workspace 枚举会话」的 RPC。D-9 明令「不新增 RPC」+ v0.2 line 168 声明「protocol.ts 零改」→ **此路不通**。

所以 AC-2 的徽标机制要么退化成「= ws.tabs（本客户端会话）」（则**首连远程机徽标恒 0**，与「连接即列出含活跃会话徽标」的措辞冲突），要么需破「protocol.ts 零改」。二者 PRD 都没承认。这是 QA-1 换了层皮但**没真正定清语义 + 选了个不成立的机制**。

**建议**（二选一，blueprint 前拍死）：
- (A) **接受 v1 徽标 = 本客户端活跃 tab 数**（现 attention 语义·now hostId-aware）：删掉 D-9「per-host session-event 聚合」这套说法（冗余误导），AC-2 明写「徽标=该 workspace 下本客户端活跃/待关注 tab 数；主机侧既存/其他客户端会话的呈现归 BL-005」，并把 WS-01-S4「含活跃会话徽标」对齐为此口径（首连为 0 可接受）。**推荐**·零协议改·可测。
- (B) 若产品要「连接即见主机侧既存会话」：显式登记**新增 host RPC**（如 `session.list` 按 workspace 归组），撤销「protocol.ts 零改」声明，并评估是否该整体划归 BL-005（会话存活/认领本就是 BL-005）。

### QA-15 · MEDIUM · D-9 重写 sessionEvents 触碰本机徽标/通知路径·AC-6 回归断言未覆盖（category: testability / regression）· 新引入

**描述**：D-9 要把 `sessionEvents.ts` 从「订阅**本地单例** `hostClient.onSessionEvent`」（现 sessionEvents.ts:44 · 模块级 `inited` 单次订阅 + 模块级 Map 闩锁）改为「按 hostRegistry **各 client** 订阅并聚合」。这是对**本机通知/徽标核心策略层**（安静门、每 tab 一次通知闩锁、Dock 角标计数 sessionEvents.ts:181-199）的结构性改写。但 AC-6 的零回归断言只列「开终端/看文件/查 git/增删改 workspace」，**未含会话徽标/通知行为**。改这个文件却不把它纳入回归基线 → 本机通知去抖/角标计数回归无门禁。

**建议**：AC-6（或 AC-2）的回归基线显式加一条：「sessionEvents per-host 化改造后，本机（hostId='local'）的通知触发/去抖闩锁/Dock 角标计数序列与改造前等价」——现有 quietGate/notification 相关测试纳入不翻红门禁。若采纳 QA-1-R 方案(A)（不做 per-host 聚合、仍走 ws.tabs），本 finding 风险大幅下降（改面回到 ws.tabs 加 hostId 维度），亦请同步。

### QA-16 · MINOR · 远程「新建目录」能力不对等仍未处置（category: completeness）· 承 QA-6 残留

**描述**：本机走 `dialog:pick-directory`（系统对话框内**可新建文件夹**再选），远程只有 `fs.readdir` 只读导航。AC-3 补了加载/空/错误态但没答「远程能否在不存在的新目录上创建项目」。能力不对等仍在。

**建议**：blueprint 就「远程 create 是否允许新建目录（需 fs.mkdir over host·或限定只选既有目录）」拍板并写入 AC-3/AC-4。

### QA-17 · MINOR · AC-11（断线活跃 workspace 回落）P2 偏低（category: priority）

**描述**：AC-11 修的是 QA-5（原 MAJOR）——远程机断线时活跃 workspace 面板卡在死 host（RPC 失败/挂起）的破态。定 P2 有被「酌情不做」裁掉的风险，而它防的是确定性坏 UX（用户困在掉线 workspace）。

**建议**：提到 **P1**（与其守护的问题严重度匹配）。

### QA-18 · NIT · 每行 homedir 按所属 host 解析需在 blueprint 显式（category: completeness）· 承 QA-11

**描述**：QA-11 经 AC-5 grep 门禁间接强制迁移 `hostClient.info?.homedir`（Sidebar/TabBar），实质已解。仅提示：Sidebar 列表**跨 host 混排**，每行 tildify 需取**该行 workspace 所属 host 的** `.info.homedir`（`hostRegistry.forWorkspace(ws).info?.homedir`），非全局单一 homedir。blueprint 点名即可，无需改 PRD。

## R2 findings 汇总

| id | severity | category | 状态 |
|----|----------|----------|------|
| QA-1-R | MAJOR | correctness/testability | 承 QA-1 未消解 · D-9 机制落不了地（放行阻塞） |
| QA-15 | MEDIUM | testability/regression | 新引入 · D-9 改 sessionEvents 触本机徽标·AC-6 未守 |
| QA-16 | MINOR | completeness | 承 QA-6 残留 · 远程新建目录不对等 |
| QA-17 | MINOR | priority | AC-11 P2 偏低·建议 P1 |
| QA-18 | NIT | completeness | 承 QA-11 · blueprint 显式每行 homedir 归属 |

**放行条件（R2）**：唯 **QA-1-R** 是硬阻塞——AC-2/D-9 的徽标机制须按方案(A)或(B)重定（推荐 A：徽标=本客户端 tab 数·删 per-host 聚合说法·对齐 WS-01-S4 措辞·零协议改）。QA-15 建议随 QA-1-R 一并收（采纳 A 则风险自消）。QA-16/17/18 可 blueprint 带。除此之外 v0.2 对 R1 的整合**质量高**（QA-4 去双源、QA-7 远程查看器出范围、QA-3 hostId 维度、QA-2 grep 门禁均为干净修法），无其他新引入问题。
