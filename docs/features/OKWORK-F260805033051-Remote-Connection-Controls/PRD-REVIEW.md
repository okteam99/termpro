---
prd_feature_id: OKWORK-F260805033051-Remote-Connection-Controls
review_round: 2
review_started_at: "2026-08-05T03:36:00Z"
review_completed_at: "2026-08-05T04:05:00Z"
reviewers: [pl, external]
verdicts: {pl: APPROVE, external: APPROVE}   # 终态 = Round 2 验证轮双路结论;Round 1 的打回与逐条处置见正文 Round 1 段
code_base_note: "Round 1 两路冷审均在 origin/main(54eff23)上执行;PMO 在收敛期发现本地 main 领先 3 commit 且改动了本 Feature 核心文件,已把 worktree 快进到 0fa8e29 并重核全部行号。未被那 3 个 commit 触及的文件(Sidebar/MachineGroup/reconnectController/hostClient/hostRegistry)行号不变,两路 finding 的实质结论不受影响;受影响的 orchestrator/RemoteHostsPage/store/i18n 行号已在 PRD v0.2 中替换为新基线行号。"
reviews:
  - role: pl
    review_scope: prd
    execution: subagent
    review_model: "会话主模型(opus · 主审路)"
    verdict: APPROVE          # 终态(Round 2);Round 1 为打回,处置见正文
    started_at: "2026-08-05T03:36:00Z"
    completed_at: "2026-08-05T03:43:39Z"
    files_read:
      - PRD.md
      - src/renderer/components/MachineGroup.tsx
      - src/renderer/components/Sidebar.tsx
      - src/renderer/components/settings/RemoteHostsPage.tsx
      - src/renderer/services/reconnectController.ts
      - src/main/remote/orchestrator.ts
      - src/renderer/state/store.ts
      - src/renderer/services/remoteWorkspaceSync.ts
      - src/renderer/services/hostRegistry.ts
      - src/shared/i18n.zh.ts
      - src/main/remote/deploy.ts
      - docs/ROADMAP.md
      - project-specs/KNOWLEDGE.md
      - src/renderer/components/__tests__/MachineGroup.test.tsx
      - src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
  - role: external
    review_scope: prd
    execution: subagent
    review_model: "fable(错开主审路 · 独立采样)"
    coverage: [可实现, 可验证, 并发/竞态]
    verdict: APPROVE          # 终态(Round 2);Round 1 为打回,处置见正文
    started_at: "2026-08-05T03:36:00Z"
    completed_at: "2026-08-05T04:02:00Z"
    files_read:
      - PRD.md
      - src/renderer/components/MachineGroup.tsx
      - src/renderer/components/Sidebar.tsx
      - src/renderer/components/settings/RemoteHostsPage.tsx
      - src/renderer/services/reconnectController.ts
      - src/renderer/state/remoteHostStore.ts
      - src/main/remote/orchestrator.ts
      - src/renderer/services/hostClient.ts
      - src/renderer/services/remoteWorkspaceSync.ts
      - src/renderer/state/store.ts
      - src/renderer/components/TransientToast.tsx
      - src/renderer/App.tsx
      - src/renderer/services/hostRegistry.ts
      - src/shared/i18n.zh.ts
      - src/renderer/terminal/terminalRegistry.ts
      - src/renderer/components/__tests__/MachineGroup.test.tsx
      - src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-08-05T04:20:00Z"
round2:
  execution: subagent
  review_model: "sonnet(验证档 · 双路均错开会话主模型 opus)"
  mode: verification   # 喂 v0.2 + Round 1 finding 与处置 · 核实闭合 + 找新
  verdicts: {pl: APPROVE, external: APPROVE}
  new_findings: 1      # NEW-PL-1(info · 非阻断 · 已采纳进 PRD v0.3)
---

# PRD-REVIEW(OKWORK-F260805033051-Remote-Connection-Controls)Round 1

两路冷审隔离并行、模型错开(PL = 会话主模型 opus;external = fable),互不喂对方产出。

**收敛主线**:两路独立指向同一个建模偏差 —— PRD v0.1 把风险建模为「残余**事件**」,而真实风险面是「残余**写入**」(残余事件 + 在途握手续体 + 迟到 disconnected)。PL 从「范围最小化」问出,external 从「并发/竞态」问出。v0.2 据此新增 §核心风险模型 一节,并把 D-1 的推荐落法从「两处共享一个 Set」收紧到「store 写入边界单点 gate」。

**PMO 独立发现(不属任一路)**:Round 1 期间发现两路冷审与 PRD v0.1 全部基于 `origin/main`(54eff23),而本地 `main` 领先 3 个未推送 commit 且恰好改动了 `orchestrator.ts` / `RemoteHostsPage.tsx` / `store.ts` / `i18n.zh.ts`。已把 worktree 快进到 `0fa8e29`、重核并替换全部行号。这正是 PRD 模板「在当前 worktree(ship 目标分支)读,不吃跨分支旧调研」所警告的失误。

---

## PL 评审段(execution: subagent · 对抗质疑六问)

verdict: NEEDS_REVISION

**过关项**:第 1 问(价值前提)与第 5 问(复活检查)站得住 —— 侧栏确无断开入口,连接在途确无出口;KNOWLEDGE §Out of Scope 的 OS-001…005 本 Feature 一条不沾。PRD v0.1 的代码引用经逐条核对属实。

### PL-CHALLENGE-1(severity: high)
**六问归属**:第 3 问 范围最小化(该做却漏了)
**描述**:PRD 只审查了「取消 → 残余事件回流」一个方向,漏了反方向:取消后立刻再点连接。在 `disconnect()` 的 5 秒等待窗口内,新的 connect 命中去重槽被吞,随后被那次 disconnect 连根拆掉;而 `connecting→disconnected` 是非法边被静默吞掉,渲染层收不到任何事件 —— 用户点了连接却毫无反应。
**证据**(已按新基线重核):`orchestrator.ts:371-376`(普通 connect 无 `forceRedeploy` 时直接返回在途 promise)、`:425-426`(disconnect 仅在 `currentInflight !== pending` 时让路,此刻两者同一引用)、`:46`(5 秒窗口)、`:42`(connect 超时 10 秒 → 窗口必然打开)
**建议**:加 P0 AC;新增待决策项(渲染层禁用按钮 vs main 侧抢占式作废)
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 最强反方是「这条路径需要用户在 5 秒内精确重点,属低频边缘,不值得占一条 P0」。我回读 `orchestrator.ts:371-376` 与 `:425-426` 确认反方不成立:窗口长度是 5 秒而 connect 超时 10 秒、部署更久,所以「取消后立刻重试」恰恰落在窗口内 —— 而「取消了想换个参数马上重连」正是取消功能最自然的后继动作,不是边缘而是主路径。更关键的是失败形态是**完全静默**(无事件、无提示),用户唯一能得到的反馈是"点了没反应",这与 2026-07-20 事故的用户可见症状同构,该事故严重到值得在代码里留大段注释复盘。
- rationale:① 我质疑了它是否属低频边缘;② 回读 `orchestrator.ts:371-376/425-426/42/46` 确认窗口与用户自然动作重叠、且失败静默;③ 采纳 —— 新增 **AC-13**(取消后 5 秒内重连不得静默无响应),并在 §开工前必须想清的 🧱 隐藏前提 第二段写明该去重/让路机制。落法倾向渲染层解决(main 侧改动会撞 Out of Scope「不改状态机」),已在 Out of Scope 显式标注该张力。

### PL-CHALLENGE-2(severity: high)
**六问归属**:第 2 问 问题定义
**描述**:AC-7 的 Given 写死「main 推送 stage=failed」,但渲染层还有一条本地合成 failed 的路径(握手失败:ws 打不开 / 协议不兼容),不经 `onEvent`。按字面实现则该路径既不弹 toast、组头又已移除失败态渲染 —— 完全静默的失败,比现状糟。连带:ROADMAP BL-002 验收标准「不兼容连接被拒且 UI 明示」会被回归掉。
**证据**:`Sidebar.tsx:267-277`(`.catch` 内本地 `applyRuntimeEvent({stage:'failed', reason: incompatible|internal})`),与 `:283-295` 的 onEvent 订阅是两条独立通道
**建议**:AC-7 Given 改为「failed 运行态落库(不论 main 推送还是本地合成)」
**PM 回应**:
- 决策:**ADOPT**(与 external EXT-5 同一问题,两路独立命中)
- adversarial_self_check:ADOPT 方向先质疑 —— 最强反方是「AC 是行为契约,不该规定实现通道;写『连接失败时弹 toast』已隐含涵盖两条路径,dev 自会处理」。我回读 `Sidebar.tsx:267-277` 与 `:283-295` 确认反方不成立:两条通道在代码结构上完全分离(一条是 onEvent 订阅回调,一条是 promise 的 `.catch` 闭包),而 AC-7 原文明确写了「main 推送」这个限定词 —— 这不是留白而是**写窄**,照字面写的测试(mock onEvent 推 failed)会全绿,却完全不覆盖握手失败。写窄的 AC 比不写更危险,因为它给了虚假的覆盖感。
- rationale:① 我质疑了"AC 不该管实现通道";② 回读两处代码确认它们结构分离且 AC 原文的限定词会让测试假绿;③ 采纳 —— AC-7 Given 改为「不论来自 main 事件推送、还是渲染层握手失败本地合成」,并追加「且该机未被取消或弃用」(与 AC-6 联动)。

### PL-CHALLENGE-3(severity: medium)
**六问归属**:第 3 问 范围最小化(内部互斥)
**描述**:Out of Scope「设置页不动」与 D-1 推荐选项 B(必然改设置页)、以及新增涟漪段(指出设置页少调 stopRemoteWorkspaceSync)三处互斥,dev 拿到会无所适从。
**证据**:PRD §Out of Scope 第 1 条 vs §待决策项 D-1 vs §开工前必须想清的 🌊
**建议**:改写 Out of Scope 为「布局与按钮形态不动;若 D-1 选 B,其事件过滤抽取为共享单源」,并把副作用写进 D-1 理由列
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 反方是「Out of Scope 说的是产品范围,D-1 说的是实现手段,不同层次不算互斥」。回读自己写的原文确认反方不成立:Out of Scope 第 1 条原文是「设置页 `RemoteHostsPage` 不动」,句式是文件级的绝对断言,不是"产品范围"级;而 D-1-B 会修改该文件。同一份文档里一句说不动、一句说要动,读者无法判断哪句有效 —— 这是实打实的自相矛盾,不是层次差异。
- rationale:① 我质疑了是否属层次差异;② 回读原文确认是文件级绝对断言与修改意图的直接冲突;③ 采纳 —— Out of Scope 改为「布局与按钮形态不动」+ 显式例外条款,并在 D-6 里把「设置页会多一条 toast」也一并挑明。

### PL-CHALLENGE-4(severity: medium)
**六问归属**:第 6 问 既有行为变更(漏列)
**描述**:Sidebar 常驻挂载且订阅全局事件,故用户在设置页点连接失败时也会多弹一条全局 toast(设置页同时还渲染着 `✗ 原因` + Retry)—— 同一失败报两遍,且发生在被声明为 Out of Scope 的界面上。PRD 从未提及。附带指出 `MachineGroup.tsx:278-285` 的 Connect 分支以 `!runtime` 为门,failed runtime 若留在 store 里则组头既不显示失败也不显示连接钮。
**证据**:`Sidebar.tsx:283-295`(无条件订阅,与设置页是否挂载无关);设置页失败渲染与共享 store
**建议**:新增待决策项;并写死实现约束(store 保留 failed、只改渲染)
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 反方是「设置页与侧栏同时可见的时间窗很短,双提示不值得占一条待决策项」。回读 `Sidebar.tsx:283-295` 确认反方部分成立但不足以驳回:双提示确实干扰有限,**但这是一条用户可感知的既有行为变更,且落在被我自己声明为 Out of Scope 的界面上** —— 按 R5「既有行为变更必入待决策项」的刚性要求,它不能藏在实现细节里由 AI 自决。我采纳的是"必须让用户拍板"这一点,而非"必须抑制"。
- rationale:① 我质疑了干扰程度是否值得升级为决策项;② 回读确认干扰有限,但性质是"Out of Scope 界面上的可感知变更",按刚性规则必须显式化;③ 采纳 —— 新增 **D-6**(建议 A:接受双提示,理由是 B 会引入"谁在前台"的状态耦合),并把 `!runtime` 渲染门的张力写进 §开工前必须想清的 🌊 并**定调「store 保留 failed,只改组头渲染分支」**。

### PL-CHALLENGE-5(severity: medium)
**六问归属**:第 3 问 范围最小化(推荐项论证基础不实)
**描述**:D-1 否掉选项 A 的理由是「A 是**第三份**复制」,但全仓 `abandonedRef` 只有一处,侧栏加一份是第二份。用夸大的数字把决策推向更贵的 B。
**证据**:全仓 grep `abandonedRef` 仅命中 `RemoteHostsPage.tsx` 同一文件的四处引用
**建议**:改成「第二份」,如实呈现成本对比
**PM 回应**:
- 决策:**ADOPT(事实更正)· 但维持推荐 B(换成立得住的理由)**
- adversarial_self_check:REJECT 方向先 steelman —— 站在 PL 视角,最强论据是「理由不实的推荐会误导用户拍板,且 B 确实比 A 改动面大,数字错误正好掩盖了这一点」。这一条我完全接受,数字是我写错的(我自己 grep 确认:全仓仅 `RemoteHostsPage.tsx` 一处)。但对"因此该重新考虑 A"这一隐含推论,我 REJECT:external 独立核实了 A 的**功能性缺陷** —— 两处订阅写同一个 zustand store,各持各的 abandoned 集合互不知晓,所以从设置页断开时侧栏那份集合不含该 id、残余事件照样写穿。也就是说 A 不是"更便宜的正确解",而是"便宜的错解"。EXT-2 从简洁性 counter-lens 出发也明确判定 B 没有把范围搞大、就是最小正确解。
- rationale:① 数字错误如实更正(第三份 → 现存唯一一份,A 会是第二份);② 回读 `remoteHostStore.ts` 的 `applyEvent` 单点与两处订阅确认 A 有功能性缺陷,推荐不变;③ D-1 理由列已重写为「A 堵不住通道 ②③,且修不掉跨入口漏过滤」,不再依赖任何计数论证。

### PL-CHALLENGE-6(severity: medium)
**六问归属**:第 3 问 范围最小化(状态漏覆盖)
**描述**:断线的 panel 阶段(0-900ms)无任何 AC 覆盖,状态图也没有该态。该态下 `workspaces !== null` 所以 `+` 照常渲染,但连接类控件一个都不渲染 —— 新加的断开钮在此态该显示、禁用还是换成重连钮,未定义。这正是「`+` 左边」那个槽位最容易出现空洞和横向跳变的一刻。
**证据**:`Sidebar.tsx:544-557`(panel 分支 `status:'lost'`、`foldedLost:false`、workspaces 非 null、不带 runtime);`MachineGroup.tsx:270-285`(两个连接钮的条件在此态均不满足)与 `:290-299`(`+` 只要 workspaces 非 null 就渲染)
**建议**:把「断线过渡(panel)」列为第六个态并指明控件,或补 AC
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 反方是「900ms 的过渡态用户几乎看不见,为它写 AC 是过度设计」。回读 `MachineGroup.tsx:270-299` 确认反方不成立:问题不在"用户看不看得见这 900ms",而在**槽位空洞会导致 `+` 左移、组头横向跳变**,而这个跳变是用户看得见的;更重要的是,不定义此态等于把它留给 dev 各自解释,不同解释产生不同布局。这不是加功能,是补一条本就该有的状态定义。
- rationale:① 我质疑了 900ms 是否值得占 AC;② 回读渲染条件确认空洞会引发可见的横向跳变、且属未定义行为;③ 采纳 —— §UI 用户故事 的状态表扩为**六态**(补「断线过渡」)、状态图补该节点,并新增 **AC-15**(槽位不留空洞 + 宽度恒定 + 无横向跳变)。

### PL-CHALLENGE-7(severity: medium)
**六问归属**:第 3 问 范围最小化(新能力的下游代价)
**描述**:AC-4 把 `deploying` 列进可取消阶段。首次连接的 deploying 是在远端做带锁的部署,取消 = 从本地掐断 ssh,锁的释放走远端命令、连接被掐后大概率执行不到,后续重连要等锁按 mtime 判陈旧(默认 120 秒)。「取消部署」可能把「等 10 秒」换成「两分钟连不上」。PL 自标:释放路径执行不到属**推断(未验证)**。
**证据**:`deploy.ts:37`(`DEFAULT_LOCK_STALE_MS = 120_000`)、`:176-180`(waitForPeer 等 `waitReadyTimeoutMs ?? staleMs`)、`:213`(releaseMkdirLock)
**建议**:三选一(排除 deploying / 新增待决策项 / 保留但列为已知代价并要求实测)
**PM 回应**:
- 决策:**PARTIAL ADOPT(结论采纳 · 机制更正)**
- adversarial_self_check:ADOPT 方向先质疑 —— 我去核了 PL 自标未验证的那一环。**PL 的机制描述有误**:`releaseMkdirLock` 并不在"正常路径上",它在 `finally` 块里(`deploy.ts:212-214`),所以异常路径也会尝试释放。但质疑到此并未推翻结论:那个 `finally` 要靠 `opts.ssh.exec(...)` 执行,而取消恰恰关掉了这条 ssh —— 释放命令发不出去。所以「可能留锁」的结论成立,只是原因是"finally 执行时通道已断"而非"没有 finally"。我没有继续验证 ssh 关闭后 `exec` 是快速抛错还是挂起,故保留未验证标注。
- rationale:① 我质疑并回读 `deploy.ts:196-215`,发现 PL 的机制说错了(有 finally);② 但确认结论仍成立(finally 依赖已断的 ssh),且影响被 mtime 陈旧兜底限制在 120 秒;③ 采纳结论,选 PL 的第三条路 —— 新增 **D-7** 让用户拍板(建议 A:保留可取消,但列为已知代价并要求 dev 实测「部署中取消 → 立刻重连」的真实耗时),PRD 中如实标注该推断未完全验证。

### PL-CHALLENGE-8(severity: low · 已由 AC-12 解除)
**描述**:原质疑「断开会把激活工作区切到第一个本机项目,AC 未覆盖」,已被新增的 AC-12 精确覆盖。仅提示 AC-12 在机读块与人读表中的顺序不一致。
**PM 回应**:决策 **ADOPT(体例)** —— 已在 v0.2 全量重写时把 AC-12 在机读块与表格中统一置于 AC-11 之后。无需 adversarial_self_check(纯体例、无判断分歧)。

### PL-CHALLENGE-9(severity: low)
**描述**:PRD 称「BL-001…005 均已交付」,但 ROADMAP 里 BL-005 状态字段写「待开始」。代码上确已落地,故是 ROADMAP 陈旧;但 PRD 把与上游文档冲突的断言当既定事实写入,评审侧无从判定。
**证据**:`docs/ROADMAP.md` Wave 3 BL-005 行;对照 `reconnectController.ts:1`、`Sidebar.tsx:519-530`
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 反方是「代码是唯一真相,文档陈旧不该让 PRD 背锅」。确认反方不成立:代码是真相没错,但 PRD 写的是一句**与可查证文档直接冲突**的断言且未加说明,下一个读者仍要重新核一遍 —— 成本转嫁而非消除。
- rationale:① 质疑了"代码为准是否足以免责";② 确认未加说明会让每个读者重复核对;③ 采纳 —— §上游关联 改为显式注明「ROADMAP BL-005 状态字段陈旧,以代码为准」,并建议 ship 时顺手翻牌。

### PL-CHALLENGE-10(severity: low)
**描述**:AC-11 的「有可见的 focus 样式」不可判定(jsdom 断不了"可见",人肉判定无阈值)。全篇唯一软判据。
**PM 回应**:决策 **ADOPT** —— AC-11 改为可测形式:「可被 Tab 聚焦(`document.activeElement` 命中)且 `Sidebar.css` 中存在命中该钮的 `:focus-visible` 规则」,视觉部分交 ui_design 截图验收。adversarial_self_check:ADOPT 方向质疑「是否把可访问性降级成了选择器断言」——回读确认没有:视觉判定并未取消,只是移交 ui_design 的截图验收,AC 层保留的是可自动化的部分,两者互补而非替代。

### PL-CHALLENGE-11(severity: info)· 与 EXT-4 部分重合
**描述**:①(已修行号复核全部正确)②§背景 ① 写「才有 `Disconnect` 按钮(`:308-314`)」,该区间是 `handleDisconnect` 函数,按钮 JSX 在别处 ③建议补一句「设置页对连接在途已有 Cancel 按钮」,这比现写法更能说明取消是低风险、有先例的
**PM 回应**:
- 决策:**ADOPT**(③ 尤其有价值,external EXT-4 独立提出同一点)
- rationale:按新基线更正 —— 按钮 JSX 在 `RemoteHostsPage.tsx:517-524`,`handleDisconnect` 在 `:322-328`;§背景 ② 重写为「侧栏无法取消,但设置页 active 阶段已有 Cancel(`:549-556`,onClick 同为 handleDisconnect)」,并把它升进 §复用的既有能力表 —— 这把本 Feature 的定位从"新增取消语义"更正为"给已有语义补侧栏入口",风险叙述更准确。adversarial_self_check:ADOPT 方向质疑「是否只是措辞美化」——不是:原写法「只能干等」是事实错误(设置页能取消),错误的现状描述会让评审者高估本 Feature 的风险等级。

### PL-CHALLENGE-12(severity: info)
**描述**:用户原话「在 `+` 左边」,但 `+` 只在已连接时渲染;其余状态没有 `+` 作锚点,AC-3/AC-4 未定义位置 → dev 各自解释 → 状态切换时横向抖动。
**证据**:`MachineGroup.tsx:290-299`(`+` 渲染条件 `workspaces !== null`)
**PM 回应**:决策 **ADOPT** —— §UI 用户故事 新增**位置不变式**:连接类图标钮固定占据组头最右侧、`+` 之前的同一槽位,槽位宽度在任何状态下恒定,无 `+` 时控件不左移。adversarial_self_check:ADOPT 方向质疑「这是否属 ui_design 的活、PRD 不该管」——回读确认 PRD 该管:用户原话把位置作为需求的一部分明确说了出来,而该锚点在多数状态下不存在,这是**需求层的留白**,不是视觉细节;具体像素与图形仍归 ui_design。

---

## external 评审段(execution: subagent · 覆盖方向制)

verdict: NEEDS_REVISION
coverage: [可实现, 可验证, 并发/竞态]

**引文核对**:PRD v0.1 行号引用绝大多数实读属实;「跨入口漏过滤」属实;修订版新增的涟漪段引用逐行验过准确,且命中并解决了 external 初稿的一条 finding(已核销);AC-12 的实现依托真实存在。

### 方向:可实现

#### EXT-1(severity: high)
**描述**:断开/取消发生在 `ready` 或 `verifying` 时 main **必发** `disconnected`;E6 式过滤刻意放行 disconnected。但在 Sidebar,一条迟到的 disconnected 会触发 900ms panel 阶段 → 全局 `selectionLocked` → 终落 `foldedLost` 红点。**从 ready 断开是 AC-2 的主路径**,每次侧栏断开都会走到:`clearRuntime` 删条目不复位 `prevStages`,迟到事件重建条目时 prev 仍是 ready → panel 必触发。附带指出 PRD「取消时渲染层收不到任何确认事件」对 verifying 阶段是错的。
**证据**:`orchestrator.ts`(wasActive 含 verifying 才 emit);`RemoteHostsPage.tsx`(过滤放行 disconnected/idle);`Sidebar.tsx:352-390, 413, 544-567`
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 最强反方是「侧栏断开会走 `stopRemoteWorkspaceSync`,workspace 已被移除,panel 阶段没有行可锁,所以无害」。我**亲自回读**并验证了机制链:`Sidebar.tsx:352-357`(`evt.stage==='disconnected' && prev!=='disconnected'` → `setPanelHosts`)、`:388`(`prevStages` 只对 `runtimeMap` 现存条目更新,故 `clearRuntime` 后残留 `ready`)、`:413`(`selectionLocked = Object.values(panelHosts).some(Boolean)`)。反方不成立:`selectionLocked` 是**全局**的,它锁的是所有机器的行点击,不只该机;即使该机的行已移除,其余机器(含本机)的行也会被锁住一段。而且 `foldedLost` 红点会让刚被主动断开的机器显示成"连接已断开·点击重连",与"用户主动断开"的语义不符。
- rationale:① 我质疑了"行已移除故无害";② 亲自回读 `Sidebar.tsx:352-357/388/413` 验证 `selectionLocked` 是全局锁、且 `prevStages` 残留机制确实成立;③ 采纳 —— **AC-2 追加「且不经过 900ms 断线过渡中间态」**,并把迟到 disconnected 列为 §核心风险模型 的通道 ③;同时更正 PRD v0.1「收不到任何确认事件」的错误断言(仅对 connecting/deploying/starting/claiming 成立)。

#### EXT-2(severity: low · D-1 简洁性 counter-lens)
**描述**:D-1 推荐 B 没有把范围搞大,它就是最小正确解;A 已核实是真坏的(两处订阅各持各的 abandoned 集合互不知晓)。但 B 的「两处共享的单源」定位可再省一步:单源放 **store 边界**(`applyEvent` 内置 gate)比「两个订阅各查一个共享 Set」更少代码,且是唯一能顺带覆盖 EXT-9(握手续体)的位置。附带指出「第三份复制」算术不对。
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 反方是「把 gate 塞进 store 的 `applyEvent` 会让状态容器承担业务过滤职责,是典型的职责焊错层」。回读 `remoteHostStore.ts` 的 `applyEvent` 确认反方不成立:`applyEvent` 已经是**全部运行态写入的唯一收口**(main 事件订阅、渲染层握手结果都落在它上面,注释即写明"main 推送事件与 renderer 本地握手结果共用同一落点")。在唯一收口上做"这台机器已被用户放弃,不接受写入"的准入判断,是收口本来就该有的语义,不是外来业务逻辑。反而把 gate 分散到两个订阅点才是把同一规则复制两份。
- rationale:① 我质疑了"store 承担过滤 = 职责焊错层";② 回读确认 `applyEvent` 本就是两条写入通道的共同收口,gate 放这里是收敛而非污染;③ 采纳 —— D-1 选项 B 表述收紧为「提成 store 写入边界的单源(`applyEvent` gate)」,并在 §核心风险模型 写明"放订阅上只堵得住 ①,放 store 边界能同时堵 ①②③"。计数错误随 PL-5 一并更正。

#### EXT-3(severity: low)
**描述**:AC-12 的 Given 只写「已连接」,但 AC-10 的「重连中点断开」路径同样有活 workspace(reconnecting 分支保活行渲染),激活项目可能正指向该机;按字面写的测试不会覆盖它。
**证据**:`store.ts`(activeWasDropped 回落);`Sidebar.tsx:521-530`(reconnecting 分支 workspaces 保活)
**PM 回应**:决策 **ADOPT** —— AC-12 Given 扩为「已连接**或正在自动重连**」。adversarial_self_check:ADOPT 方向质疑「reconnecting 态下用户会不会其实不能点断开」——回读 `Sidebar.tsx:521-530` 确认 reconnecting 分支确实保活 workspace 行,且 D-4 已决定该态下断开钮可用,所以这条路径真实可达,AC 写窄会漏测。

#### EXT-4(severity: info)
**描述**:①「transientNotice 现有 9 处调用点」实数 4 处 ②背景① 行号指向函数而非按钮 ③背景②「只能干等」言过其实,设置页已有 Cancel
**PM 回应**:
- 决策:②③ **ADOPT**(见 PL-11 处置);① **REJECT**
- adversarial_self_check:REJECT 方向先 steelman —— 站在 external 视角,最强论据是「它 grep 了 `setTransientNotice(` 得到 4 处,数字有据可查,而我的 9 是转述二手调研」。我承认我的 9 也不精确。但我**亲自 grep 复核**后确认 external 的 4 才是错的:它只搜了 setter 调用形式,漏掉 `store.ts` 内 **7 处**直接 `set({ transientNotice: ... })` 的写入(`:829/:848/:870/:910/:930/:942/:967`)。真实写入点 = store.ts 7 + persistence.ts 2 + App.tsx 1 + OkworkSkillBanner.tsx 1 = **11 处**。这正是"读了旁边就当读了那一行"的典型:grep 一种调用形式,得出全量结论。
- rationale:REJECT 其数字更正,但不是维持我的"9" —— 两个数都不对,v0.2 改为按文件给出精确分布(11 处写入点),并保留 external 方向性正确的观察(除 banner 外均为失败/警告类)。

### 方向:可验证

#### EXT-5(severity: medium)· 与 PL-CHALLENGE-2 同一问题
**描述**:AC-7 Given 写死 main 推送,漏渲染层本地合成 failed;toast 若只接 onEvent,握手类失败将完全无声,且照 AC 字面写的测试会全绿放行。
**PM 回应**:决策 **ADOPT**(处置见 PL-CHALLENGE-2)。两路独立命中同一问题,显著提高了该 finding 的可信度 —— 独立采样的价值在此体现。额外采纳 external 的落点建议:toast 触发点收敛到 store 写入单点(与 D-1-B 同一改法)。

#### EXT-6(severity: medium)
**描述**:缺「取消/断开后立刻重连」的 AC —— 弃用标记的解除目前只存在于设置页 `handleConnect`;侧栏连接入口 `handleConnectMachine` 只发 IPC、不碰任何弃用状态。D-1 落地后若忘了在侧栏入口清标记,该机后续所有事件被吞,表现即 2026-07-20 事故复刻「点 Connect 永远没反应」。
**证据**:`RemoteHostsPage.tsx:309`(唯一清除点);`Sidebar.tsx:450-452`(`handleConnectMachine` 不清)
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 反方是「这是实现细节,dev 做 D-1-B 时自然会想到成对处理 set/clear」。回读 `Sidebar.tsx:450-452` 确认 `handleConnectMachine` 目前只有一行 IPC 调用,而设置页的清除点在另一个文件的另一个函数里 —— 跨文件的成对约束**恰恰是最容易漏的那类**,且漏了之后的表现是永久静默失效(不是报错),与本 Feature 已知的另一个静默风险同构。AC 的作用正是把这种"漏了不会响"的约束固定成可测断言。
- rationale:① 我质疑了是否属 dev 自然会处理的实现细节;② 回读确认这是跨文件成对约束、漏则永久静默;③ 采纳 —— 新增 **AC-14**(弃用标记随连接意图解除)。

#### EXT-7(severity: medium)
**描述**:AC-6 的残余事件枚举漏两类:残余 `failed`(取消后在途编排随后失败 → 叠加 AC-7 = 刚取消就被弹失败 toast)与迟到 `disconnected`;且全 PRD 没有一条 AC 断言「取消/弃用后不得弹任何 toast」。
**PM 回应**:决策 **ADOPT** —— AC-6 枚举补 `failed` 与 `disconnected`,Then 追加「不得因残余 failed 弹出失败 toast」。adversarial_self_check:ADOPT 方向质疑「现存 E6 过滤恰好已吞 failed,是否属已解决」——回读确认反方不成立:现存过滤在设置页,侧栏没有;而且"现有实现恰好正确"不等于"AC 可以不写",不写则测试套没有义务覆盖,后续重构会静默破坏它。

#### EXT-8(severity: low)
**描述**:toast 是单槽,后写覆盖前写、5s 计时随每次变更重置 —— 两台机器近同时失败只留最后一条,首条原因当场就看不到。D-2 只讨论了"事后不可查"。
**PM 回应**:决策 **ADOPT** —— D-2 补入显式接受声明(「并发失败仅保留最近一条」)让用户拍板留痕。采纳其"不必扩成队列(超 ROI)"的判断,不新增复杂度。

### 方向:并发/竞态

#### EXT-9(severity: high)
**描述**:PRD 把残余风险建模为「残余**事件**」,漏了更刁的一条:取消时**已在途的那次握手的续体**。`beginHandshake` 的 `.then/.catch` 是本地闭包,任何 onEvent 层过滤都管不到:取消 → drop dispose client → 在途 `reconnect()` 拒绝 → `.catch` 本地写 failed(叠加 AC-7 = 取消后弹失败 toast);若取消恰落在 ws 已开、`.then` 已入队之后,`.then` 无条件本地写 `ready` 并调 `onReconnected` → readopt,正是 PRD 自己警告的「界面装作断了,后台把连接做完了」,只是从 AC-6 没枚举的通道发生。照 AC-6 字面写的测试会全绿而此路径依然存在。
**证据**:`Sidebar.tsx:253-280`(`.then` 内 `:261` 写 ready、`:265` onReconnected;`.catch` 内 `:268-273` 写 failed);`hostClient.ts:388-399`(dispose → 在途 reconnect 拒绝);`RemoteHostsPage.tsx:215-245`(设置页同构)
**PM 回应**:
- 决策:**ADOPT**(本轮最有价值的 finding)
- adversarial_self_check:ADOPT 方向先质疑 —— 最强反方是「`hostRegistry.drop` 会 dispose client,在途 `reconnect()` 必然 reject,所以 `.then` 分支不可达,只需处理 `.catch`」。我回读 `Sidebar.tsx:253-280` 确认反方不成立:`.then` 的入队时机取决于 ws 何时 open,若取消恰好发生在 `reconnect()` 已 resolve、`.then` 回调已进微任务队列之后,dispose 并不能取消一个已排队的回调 —— 它会照常执行 `applyRuntimeEvent({stage:'ready'})` 与 `onReconnected`。这是一个真实的窗口,不是理论可能。而且我自己在 PRD v0.1 §最不确定 里写的正是"残余 verifying 触发握手",却没想到"握手已经在跑"这个更靠内的层次 —— 我的建模停在了事件层。
- rationale:① 我质疑了 `.then` 分支是否可达;② 回读确认已入队的微任务不受 dispose 影响、窗口真实存在;③ 采纳 —— 这条直接改变了 PRD 的组织方式:v0.2 新增 **§核心风险模型:残余「写入」而非残余「事件」** 独立一节,把三条通道并列;**AC-6 的 When 补 (b) 款**(取消时握手已在途、其 promise 随后 resolve/reject);§最不确定 改写为"通道 ② 能否堵干净"。

#### EXT-10(severity: info)
**描述**:其余竞态查过无发现 —— 双击连接由 connectInflight 去重;双击断开各步幂等;重连中断开的次序与 `reconnectController.cancel` 语义吻合;AC-9 无自动复连成立(重连拉起唯一触发源是 onReconnectNeeded,dispose 时 tearingDown 抑制 onClose 分叉,迟到 disconnected 在 Sidebar 订阅里不接 onDisconnected)。
**PM 回应**:决策 **无需处置**(阴性结论,记录以证明该方向已被覆盖)。⚠️ 注:EXT-10 称「取消后 5s 窗内重连由意图翻转守卫放行」,这与 PL-CHALLENGE-1 的结论**相反**。我回读 `orchestrator.ts:371-376/425-426` 判定 **PL-1 正确、EXT-10 此句有误**:意图翻转守卫要求 `currentInflight !== pending`,而普通 connect 在去重命中时返回的正是同一个 `pending` 引用,守卫不成立、不会放行。两路结论冲突时以真实代码为准,已按 PL-1 处置(AC-13)。

---

## 整合结论(Round 1)

- **overall_verdict**: NEEDS_REVISION
- **next_round_required**: true
- **处置统计**:共 22 条 finding(PL 12 + external 10)。ADOPT 19 条(含 1 条 PARTIAL:PL-7 结论采纳、机制更正)· REJECT 1 条(EXT-4 ①,回读证伪其计数)· 无需处置 2 条(PL-8 已由 AC-12 解除、EXT-10 阴性结论,其中一句经复核有误已记录)。
- **PRD 已修订至 v0.2**:新增 §核心风险模型(三通道)· 新增 AC-13/14/15 · 收紧 AC-2/6/7/11/12 · 新增 D-6/D-7 · 修正 Out of Scope 与 D-1 互斥 · 更正 v0.1 两处事实错误(「取消时收不到事件」「第三份复制」)· 全部行号重核到新基线 `0fa8e29`。
- **两路交叉验证的价值**:PL-2 与 EXT-5 独立命中同一问题(AC-7 写窄);PL-1 与 EXT-10 结论相反,经回读代码判定 PL-1 正确 —— 若只跑单路,前者会失去置信度加权、后者会直接采信错误结论。
- **下一步**:Round 2 验证轮(验证档模型)—— 喂 v0.2 + Round 1 finding 与处置,核实修复是否真的闭合、并找新问题。

---

# Round 2 验证轮(双路 APPROVE)

两路均降至**验证档 sonnet**(校验型任务 · 按 v8.299 验证类白名单降档;双路模型均错开会话主模型 opus)。任务定义为「核实 Round 1 的 ADOPT 是否真的落进 v0.2 正文(去 PRD 找原文,而非相信 PM 自述)+ 复核 PM 与评审意见相左之处 + 只报 v0.2 新引入的缺陷」。

## PL 验证轮:APPROVE

**闭合核实**:PL-CHALLENGE-1…12 **逐条闭合 ✅**,并给出 PRD 内的落点行号(AC-13 / AC-7 Given / Out of Scope 例外条款 / D-6 / D-1 理由列改写 / AC-15 + 六态表 / D-7 / ROADMAP 陈旧注记 / AC-11 可测化 / 背景行号更正 / 位置不变式),且逐条回读了对应源码确认行号精确。

**PARTIAL 核实(PL-CHALLENGE-7)**:PM 的机制更正**成立 ✅** —— 验证轮读 `deploy.ts:190-217`,确认 `releaseMkdirLock` 确在 `try{...} finally{...}` 的 finally 块内(`:212-214`);Round 1 「释放在正常路径上」的表述有误,PM 改述为「finally 会跑,但其内部 `ssh.exec` 依赖已被取消关闭的传输通道」准确;D-7 如实标注了「未逐行验证 ssh 断开后 finally 的实际行为」,诚实。

**PM 被抓到的一处言行不一**:PM 在 PL-11 处置里承诺把「设置页已有 Cancel」升进 §复用的既有能力表,实际只留在了背景②正文,没真进表。→ **已在 v0.3 补上该表行**(信息未丢,但承诺与落地不一致本身是该记的)。

### NEW-PL-1(severity: info · 非阻断 · 已采纳)
**描述**:§核心风险模型 断言「gate 放 store 边界能同时堵住 ①②③」归因不够精确。通道 ② 的**收养副作用**实际已被另一层机制天然挡住:`readoptHost` 取 client 走**实时查表**而非闭包持有,而 `hostRegistry.drop()` 是同步 dispose + 从 map 删除,故即便 `.then` 已入队,`readoptHost` 拿到的也是 null 并立即短路。真正兜住「后台把连接做完」最坏后果的是这套既有设计,不是 store gate。
**证据**:`terminalRegistry.ts:949`(`hostRegistry.forHostId(id)` 实时查表)、`:959-960`(`if (!client) return;`)、`hostRegistry.ts:37-40`(同步 dispose+delete)
**PM 回应**:
- 决策:**ADOPT**
- adversarial_self_check:ADOPT 方向先质疑 —— 反方是「若收养已被挡住,通道 ② 是否根本不需要处理?」。我**亲自回读** `Sidebar.tsx:259-266` 确认反方不成立:`.then` 在 `:261` 先执行 `applyRuntimeEvent({stage:'ready'})`、`:265` 才调 `onReconnected`。所以通道 ② 有**两半**:UI 状态写入那一半没有任何既有保护、必须靠 store gate;收养那一半才是被 drop 挡住的。验证轮的补正是对的,但不能推出"通道 ② 无需处理"。
- rationale:① 质疑了是否可据此不管通道 ②;② 回读 `Sidebar.tsx:259-266` 确认 UI 写入先于收养且无保护;③ 采纳 —— v0.3 在 §核心风险模型 把通道 ② 拆成两半分别说明,并把「readoptHost 实时查表」标为**隐性不变式** + 要求 dev 为其留回归测试(挂 AC-6 (b) 款),防未来改成闭包持有时无声撞破。

## external 验证轮:APPROVE

**闭合核实**:EXT-1/2/3/5/6/7/8/9 **逐条闭合 ✅**,并独立回读 `remoteHostStore.ts:24/39` 确认 `applyEvent` 确为唯一收口、D-1-B 的落点可行。

**争议复核(两处 PM 与评审相左,验证轮均判 PM 正确)**:
- **(a) EXT-4① toast 计数 → PM 对 ✅**:验证轮重新 grep 确认 `setTransientNotice(` 调用形式确实只有 4 处,但 `store.ts` 另有 7 处直接 `set({ transientNotice: ... })`(`:829/848/870/910/930/942/967`),Round 1 只搜 setter 形式确实漏了;PRD v0.2 写的 11 处准确。
- **(b) EXT-10 竞态判断 → PM 对 ✅**:验证轮读 `orchestrator.ts:371-377` 与 `:414-448` 后确认 —— 去重路径在 `:377` 直接 `return existingConnect`,不创建新 `tracked`、不改写两个 Map,故 `disconnect()` 在 `:425-426` 的 `currentInflight !== pending` 为**假**、守卫不触发,照常执行到摘除会话。Round 1「由意图翻转守卫放行」一句错误;守卫只在原 promise 已完全 settle 并清空后才生效,不覆盖「取消时原连接仍卡在途」这个主路径。**AC-13 的必要性成立**,与 PL-CHALLENGE-1 结论一致。

**新发现**:无。抽查了 v0.2 新增/收紧段落引用的全部关键行号,逐条与当前 worktree(`0fa8e29`)比对均准确。

---

## 最终整合结论

- **overall_verdict: APPROVE**(双路验证轮均 APPROVE · next_round_required: false)
- **两轮共 23 条 finding**(Round 1:PL 12 + external 10;Round 2:NEW-PL-1)。ADOPT 20 · PARTIAL 1(PL-7 结论采纳、机制更正)· REJECT 1(EXT-4①,经 Round 2 独立复核确认 PM 判断正确)· 无需处置 2。
- **PRD 已至 v0.3**,状态待用户最终确认。
- 🔬 **独立采样的实证价值**(本次三个数据点):① PL-2 与 EXT-5 独立命中同一问题(AC-7 写窄),置信度互相加权;② PL-1 与 EXT-10 结论**相反**,回读代码判定 PL-1 正确 —— 单路会直接采信错误结论;③ Round 2 验证轮抓到 PM 一处「承诺了但没落地」(Cancel 升表)与一处归因不精确(NEW-PL-1)—— 自评审无法发现的两类问题。
- **下一步**:用户最终确认(§待决策项 D-1…D-7 一次性 escalate)→ `goal-complete --needs-ui true`。

---

## ✅ 用户最终确认(2026-08-05)

用户回 `ok` = 按推荐项全部拍板。7 项决策落定,已回填 PRD §待决策项 决策列,`status: confirmed` · `business_direction_locked: true`:

| 决策 | 结果 | 对下游的约束 |
|---|---|---|
| D-1 | **B** — 弃用 gate 落 store 写入边界(`applyEvent` 单点) | blueprint 的 TECH 主线;同时修复跨入口漏过滤 |
| D-2 | **A** — 只弹 toast,不做留档 | 显式接受「并发失败仅保留最近一条」 |
| D-3 | **A** — 断开无二次确认 | — |
| D-4 | **A** — 重连中断开钮可用 | 落 AC-10 |
| D-5 | **A** — 未连接态不显示断开钮 | 落 AC-1 的渲染门 |
| D-6 | **A** — 接受设置页双提示 | Out of Scope 已注明该界面会有可感知变化 |
| D-7 | **A** — 允许取消 deploying,列为已知代价 | 🔴 **dev 阶段须实测「部署中取消 → 立刻重连」的真实耗时**,并把结果记回 KNOWLEDGE(与 GO-027 锁陈旧判定相关) |

**遗留给 dev 的三条硬约束**(从两轮评审沉淀,blueprint 须承接):
1. AC-13 的禁用态用 `aria-disabled` 而非原生 `disabled`(GO-030)。
2. `readoptHost` 实时查表是一条**隐性不变式**,需针对性回归测试锁住(挂 AC-6 (b))。
3. 侧栏断开走完整 `stopRemoteWorkspaceSync`,**不可照抄**设置页 `handleDisconnect` 五步(后者缺 `dropHostWorkspaces`)。
