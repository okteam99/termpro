<!-- TEAMWORK-REVIEW · goal-pl · PL 对抗质疑（premise-challenge）· 隔离冷审 -->
# BL-004 PRD 对抗质疑 · Product Lead（goal-pl）

## verdict

**changes_requested（SHRINK · 不 kill）**

Feature 通过「杀死」检验：BL-004 是 M5 唯一的**用户可见收口面**——BL-001（workspace 注册表入 Host）、BL-002（standalone host）、BL-003（远程连接编排）已交付但「尚未被工作台消费」（PRD L60）。不做 BL-004，前三个 P0 的全部投入对用户价值为零。核心 P0（AC-1~AC-7）忠实对齐上游，无法砍。

但 Feature 应**缩小**：两处越界/搭车范围应从本 Feature 剥离——
- **AC-8** 的「断线态呈现 + 重连入口」触及 BL-005 语义（PL-CHALLENGE-1）。
- **AC-9**（PENDING-002 并入）把 4 项与 BL-004 无因果的 BL-001 注册表卫生项塞进一个 P0 用户面 Feature（PL-CHALLENGE-2）。

外加一处既有行为变更的退化态未定义（PL-CHALLENGE-3）。六问其余（①价值前提 ②问题定义 ④核心上游对齐 ⑤复活检查）判过，理由见文末。

## files_read

- `docs/features/TERMPRO-F260710011342-Sidebar-Machine-Groups/PRD.md`（评审对象）
- `docs/features/TERMPRO-F260710011342-Sidebar-Machine-Groups/YOLO-PREFLIGHT.md`
- `product-overview/workstream/WS-01-remote-host.md`（§WS-01-S4 · frontmatter L43-50 · 拆解明细 L186-190）
- `docs/ROADMAP.md`（BL-004 L37 + 依赖 L53-57）
- `product-overview/TermPro_业务架构与产品规划.md`（Q-002 L126 / Q-003 L127 / 模型 A L97）
- `project-specs/KNOWLEDGE.md`（OS-001~005 · GO-025~027 BL-003 沉淀）
- `product-overview/PENDING.md`（PENDING-002 L8）
- `docs/design/sitemap.md`（/workspace/add-workspace L12 · Sync Log L24-25）

## findings

### PL-CHALLENGE-1 · AC-8「断线态呈现 + 重连入口」越界 BL-005
- **severity**: medium
- **category**: premise-challenge
- **description**: AC-8 要求 Sidebar 机器组头呈现「连接中 / 失败+重试 / **断线+重连入口**」四态。前三态（connecting/deploying/failed）是 AC-2「点连接」流程自身必然产生的态，Sidebar 加了「连接」按钮就必须显示「连接中」，属本 Feature 内聚。但**「断线（已连后掉线）+ 重连入口」**与 BL-005 的权威范围直接重叠：WS-01-S5 明列「重连横幅与自动重连策略」「状态徽标/通知对账」（WS L54, L192-196）。PRD 用「只呈现 BL-003 已有态 + 复用其重连入口，不新增存活语义」（PRD L147）为其辩护，但 BL-003 的核心 AC 是「添加/测试连接/首次部署」（ROADMAP L29），**并不含「已连后断线的重连入口」**——该入口是 BL-005 资产而非 BL-003 资产。此处存在真实的 BL-004/BL-005 边界模糊，且 AC-8 是 P1（非 P0），砍它不动摇核心目标。
- **suggestion**: 拆分 AC-8：保留 connecting/deploying/failed 呈现（连接流程自洽所需，P1 留本 Feature）；将「断线态呈现 + 重连入口」**下沉 BL-005**（重连语义的归属地）。若坚持保留，须在 PRD 明确 cite BL-003 已交付的「已连后重连入口」代码资产行号以自证「只复用不新增」，否则默认它是 BL-005 范围被提前拉入。

### PL-CHALLENGE-2 · AC-9 / D-5 把 PENDING-002 无因果项搭车进 P0 用户面 Feature
- **severity**: medium
- **category**: premise-challenge
- **description**: AC-9（P2）并入 PENDING-002 全组五项（F6 备份内容断言 / F9 no-op churn / F10 service 边界 params 校验 / F11 viewer 广播冗余 / F13 重试措辞）。五项里**只有 F10 与 BL-004 有真实因果**——PRD/YOLO 自陈「BL-004 远程面正是消费点」（PRD L104 · YOLO §2#5）。其余 F6/F9/F11/F13 是 BL-001 review defer 的注册表卫生项（PENDING.md L8 明列来源=「BL-001 F6/F9/F10/F11/F13」），与「机器分组 Sidebar」工作**零依赖**。并入的唯一理由是「顺路清 / 开工前清」（D-5 · PENDING.md L8）——这是**便利性批处理**而非耦合论证。后果：① 把「Sidebar 分组」P0 Feature 的评审面污染成还要评注册表备份断言；② 稀释本 Feature 焦点与 verify-ac 语义（AC-9 一个 id 塞 5 条互相独立的验收条件，机读 verify 无法定位单条通过/失败）。
- **suggestion**: AC-9 只保留 **F10**（唯一有 BL-004 消费点的项，且远程面 params 校验是本 Feature 安全边界的真实需求）。F6/F9/F11/F13 从本 Feature 剥离——要么留 PENDING-002 单开一次微型注册表卫生 sweep，要么至少在 BL-004 内独立 commit + 独立评审、不与用户面 AC 混算。同时把保留项拆为独立 AC id（一 AC 一条件），避免 5-in-1 AC 的机读歧义。

### PL-CHALLENGE-3 · 平铺→分组是全量用户既有行为变更，本机-only（M=0）退化态未定义
- **severity**: minor
- **category**: premise-challenge
- **description**: PRD L154 正确识别「Sidebar 平铺→按机器分组」是既有行为变更，并把拍板归因于 Q-002（planning L126「Sidebar IA 改为按机器分组」）+ 全景确认（sitemap L12 · ui_panorama_confirmed 2026-07-09）——归因成立，**方向本身已授权**，不构成需重新拍板的破坏性变更。但有一处未闭合：AC-1 描述「显示『本机』组（置顶）+ M 个远程机组」，其中 **M 可为 0**（从不配置远程机的纯本机用户 = 现有 100% 用户）。PRD 未定义 M=0 退化渲染——一个只含「本机」单组的组头是否把现有全体用户的 Sidebar 包进一层「为一个他们从不用的远程功能」而存在的纯 chrome？Q-002/全景确认的是「本机 + 各远程机」的完整模型 A 形态（sitemap L12），**未显式覆盖零远程机的退化态**。叠加本 Feature 在 blanket YOLO + auto approved_and_ship(WARN) 下零暂停点执行（YOLO §2#6），这一唯一真正改动全体用户主导航的 IA 变更失去了自然检查点。
- **suggestion**: 在 PRD 补一条 AC（或明确 AC-1）定义 **M=0（未配置任何远程机）时的 Sidebar 渲染**：要么退化为无组头的平铺（保纯本机用户零视觉税），要么显式确认「本机」组头恒显是 Q-002 全景已覆盖的既定形态并 cite 全景对应态。此为验证门可查条款，不阻断核心 P0，但应闭合以免 auto-ship 把一个未定义退化态固化给全体存量用户。

### PL-CHALLENGE-4 · AC-7（host.info.hostId 真实化）是 PRD 引入的协议前置，非 WS-01-S4 用户面范围（info）
- **severity**: info
- **category**: premise-challenge
- **description**: AC-7（host.info 返真实 hostId）不在 WS-01-S4 用户面 scope 文本（WS L46/L190）内，是 PRD 依 D-2 引入的技术前置。它**已被授权**——BL-003 标记其为「BL-004 前置」（PRD L87 · YOLO §2#2），属忠实兑现隐含前置而非范围抓取。仅提示：这是一次 `protocol.ts` 改动（CLAUDE.md「加 RPC 先改 protocol.ts」· README §五协议红线）搭在一个 UI Feature 上，须确保「向后兼容追加 · 缺省回退 'local'」路径真成立（AC-7 已含此语义），blueprint 阶段应有协议向后兼容的专项验证，不留旧 host 崩溃面。
- **suggestion**: 保留 AC-7 在本 Feature（前置归属正确）。blueprint 时确认 host.info.hostId 为纯追加字段、旧 host（缺省）回退 'local' 有专测；无需改动范围。

## 六问逐条裁决

- **① 价值前提（过）**：为「本机 + 多远程机都有项目」的用户；不做则 BL-001~003 三个 P0 投入零用户价值（PRD L60-62）。无法 kill。
- **② 问题定义（过）**：真问题——源自用户原始诉求「配置 SSH 后部分项目用远程机开发」（Q-002 背景 · planning L107/WS L107）。「按机器分组」是解法形态，但该形态由 Q-002 用户拍板（planning L126），非解法伪装成问题。
- **③ 范围最小化（未过 → 见 CHALLENGE-1/2/3）**：AC-8 断线/重连部分下沉 BL-005；AC-9 收敛到仅 F10；补 M=0 退化态。核心 AC-1~AC-7 无可砍（AC-5 承接核心③，其驱动的 hostClient→hostRegistry 40+ 处迁移是 AC-5 的必要地基而非搭车重构，不可砍）。
- **④ 上游对齐（核心过 · 偏离已在 ③ 标注）**：AC-1/2↔WS-01-S4「机器分组+连接即发现该机 workspace 与会话徽标」（WS L46/L190①）；AC-3/4↔「选机器→远程目录浏览器→落对应注册表」（WS L46/L190②）；AC-5↔「远程 workspace 终端/文件/git 走该机 host」（WS L190③）。忠实，无 SHRINK 遗漏（活跃会话徽标、任一客户端可见均在）。唯二 ADD = AC-8（部分）、AC-9，已挑战；AC-7 = 授权前置（CHALLENGE-4）。
- **⑤ 复活检查（过）**：无 OS-001~005 被否方向换皮（编辑器/LSP、内置 agent、性能竞赛、Windows/Linux 客户端、Ghostty fork 均无关）。注：远程 host 可跑 linux（WS R1 linux x64/arm64 矩阵）指的是**远程被控端**，非 TermPro **UI 端**支持 Windows/Linux——与 OS-004 不冲突。GO-025~027 是 BL-003 客观约束（safeStorage/reap/deploy），BL-004 正确消费即可，非复活。
- **⑥ 既有行为变更（部分过 → 见 CHALLENGE-3）**：平铺→分组方向已由 Q-002 + 全景确认授权，无需重新拍板；但 M=0 退化态未定义、且在 blanket YOLO auto-ship 下失去检查点，应闭合。

---

## Round 2 · verify（PRD v0.2 复核）

### verdict: PASS（四条 SHRINK 全消解 · 1 条新残留待显式认可 · 不 re-block）

四条原质疑全部消解，且 v0.2 净收紧了范围（远程查看器出范围 + 远程 workspace 不持久化，均下沉 BL-005/后续）。六问在 v0.2 下重跑：①②⑤⑥ 仍过；③ 由「未过」转「过」（三条 shrink 已采纳）；④ 核心过，**但发现一处 v0.2 在采纳 ARCH-3 时对上游 AC 的静默收窄**（PL-CHALLENGE-5，新增·非阻断但须显式认可）。

### 原四条逐条 verify

- **PL-CHALLENGE-1 · RESOLVED**：AC-8（L118）缩到只呈现连接中/部署中/失败 + 「失败重试入口」（=重试一次失败的 connect·属 BL-003 连接流程·非已连后掉线重连）；「断线后重连横幅/自动重连/状态对账」显式声明 = BL-005（AC-8 内 + Out of Scope L158）。新增 AC-11（P2·D-8）只做**断线确定性回落**（active 指针回落本机 + 组折叠），明确「非 BL-005 重连恢复」——这是 BL-004 自身新能力（可 active 远程 workspace）必须自负的失败态，边界正确、未反噬 BL-005。

- **PL-CHALLENGE-2 · RESOLVED**：AC-9（L119）收敛到**仅 F10**（service 边界 params 运行时校验·远程面真耦合）；F6/F9/F11/F13 留 PENDING-002 单开（Out of Scope L160·D-5 L101）。D-5 补的「F11 不冗余/F13 措辞判据不可测·不塞」比我原论证更利落（不可测的 AC 本不该进 verify-ac）。AC-9 现为单一良构条件，5-in-1 机读歧义一并解决。

- **PL-CHALLENGE-3 · RESOLVED**：新增 AC-10（L120）定义 M=0 退化渲染 = 单「本机」组头·无远程组·无空占位。原「退化态未定义」的模糊已闭合。PM 选了「组结构恒显」而非「退化平铺」，理由=一致性 + 全景已确认形态——是可辩护的决策（组头恒显 = Q-002 模型 A IA 的一致表达）。残留极低：「全景已确认形态」的引用依赖全景覆盖 M=0 这一粒度（sitemap L12 文本未逐粒证），但 business_direction_locked 已转 true + Q-002「Sidebar IA 改为按机器分组」授权成立·属职权内。判过。

- **PL-CHALLENGE-4 · RESOLVED（超预期）**：不止加向后兼容测——host.info.hostId 真实化**整个撤销**（D-2 L98·Out of Scope L161），per-host 权威键改用 hostRegistry map 键（BL-003 已建的 configId），protocol.ts 零改（L168）。我原 INFO 级担忧（协议改动搭 UI Feature 需专测）被从根消除；且消除了本机键双源（ARCH-1）。verify：撤销不丢能力——路由靠 workspace.hostId（D-6 运行时字段）→ hostRegistry.forWorkspace → 'local'|configId client，host.info.hostId 本就冗余。AC-7（L117）保留「hostId='local' 恒解析既有单例」即我原提示的向后兼容测的正确落点。

### PL-CHALLENGE-5 · v0.2 采纳 ARCH-3 时静默收窄了 WS-01-S4「任一客户端可见」
- **severity**: medium
- **category**: premise-challenge
- **description**: v0.2 AC-4（L114）把远程 workspace 的跨客户端可见性收窄为「**主窗口**经 workspace:changed 即时可见（独立查看器窗口 out of scope·D-7）」。但上游 WS-01-S4 核心 AC②（WS L190）原文=「新 workspace 注册到该机 Host、**任一客户端可见**」，而本项目「客户端」有明确定义——BL-001 核心 AC③（WS L172 / ROADMAP L20）=「多客户端（**主窗口 + 查看器**）看到一致的 workspace 列表与变更推送」。故「远程 workspace 在独立查看器窗口不可见」是对 WS-01-S4「任一客户端可见」（就远程场景）的**真实 SHRINK**。它有正当架构理由（D-7/ARCH-3：查看器窗口各持独立 hostRegistry 无远程 client·BL-003 E8 token 只推主窗口·补齐要重开跨窗口 token 安全面），且远程查看器是全新能力、无既有行为回归——但这是在解我四条质疑的同时**顺带下调了一条上游 AC**，正是 ④ 上游对齐要拦的「未经显式授权的缩范围」。附带 UX 缺口：D-7 未定义「用户在主窗口对**远程** workspace 的文件/diff 触发弹出独立窗口」时的行为（禁用弹出 affordance vs 报错）。
- **suggestion**: 不 re-block，但需**显式认可而非默认下沉**：① team-lead/PM 明确「v1 远程 workspace 仅主窗口可见·查看器窗口远程可见性 = 授权的 v1 延后」，并在 WS-01-S4 或 PENDING/后续项**登记该延后**（否则一条上游 AC 被静默吃掉·后续无人认领）；② 在 D-7 或 AC 补「远程 workspace 触发弹出独立窗口」的确定性 UX（v1 建议：对远程 workspace 禁用弹出 affordance·给出「远程文件独立窗口 v1 暂不支持」提示·而非静默失败）。

### v0.2 新增项的范围审查（确认无搭车扩张）
- D-6（workspace 运行时 hostId + 远程不持久化）·D-7（远程查看器出范围）= **SHRINK**（远程持久化/重连下沉 BL-005·查看器远程下沉后续），净收紧，PL 欢迎。
- D-8/AC-11（断线确定性回落·P2）·D-9/AC-2（会话徽标 = per-host session-event 聚合·复用既有事件流无新 RPC）= 交付 WS-01-S4 已含要求（会话徽标）与自负失败态的**必要规格化**·非新范围。
- AC-5 穷举消费点 + grep 门禁·AC-6 升 P0 = **收紧严谨度/优先级**·非扩张。
- 结论：v0.2 的增补以 shrink + rigor 为主，未引入搭车范围膨胀；唯一需盯的是 PL-CHALLENGE-5 的上游 AC 静默收窄。

### 六问 v0.2 复跑
①价值前提 过 · ②问题定义 过 · ③范围最小化 **过**（原四 shrink 采纳 + 净收紧）· ④上游对齐 核心过·**唯 AC-4「任一客户端」收窄为残留（PL-CHALLENGE-5）** · ⑤复活检查 过（撤 host.info.hostId 真实化 / 查看器出范围均不触 OS-001~005）· ⑥既有行为变更 过（M=0 已定义 AC-10 · 零回归升 P0 守门 AC-6 · business_direction_locked 转 true）。
