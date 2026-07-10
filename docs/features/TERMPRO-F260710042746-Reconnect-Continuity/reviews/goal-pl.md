<!-- TEAMWORK-MACHINE · goal-pl 机读块 · 勿删外层注释包裹 · 标准 2 空格缩进
review_role: pl
review_stage: goal
feature_id: "TERMPRO-F260710042746-Reconnect-Continuity"
verdict: approve
verdict_round1: approve-with-concerns
verdict_round2: approve
reviewer_model: opus
reviewed_at: "2026-07-10"
round2_reviewed_prd_version: "0.2"
files_read:
  - docs/features/TERMPRO-F260710042746-Reconnect-Continuity/PRD.md
  - docs/features/TERMPRO-F260710042746-Reconnect-Continuity/YOLO-PREFLIGHT.md
  - product-overview/workstream/WS-01-remote-host.md
  - docs/ROADMAP.md
  - project-specs/KNOWLEDGE.md
  - README.md
  - src/host/hostCore.ts
  - src/renderer/terminal/terminalRegistry.ts
findings:
  - id: PL-CHALLENGE-1
    severity: high
    category: premise-challenge
    ac_refs: [AC-9]
    title: "AC-9 时间型孤儿超时是 PRD 越上游擅自加的范围·且与本 Feature 核心承诺直接冲突"
  - id: PL-CHALLENGE-2
    severity: medium
    category: premise-challenge
    ac_refs: [AC-3, AC-4]
    title: "AC-3『回放全量 scrollback（断开前+期间）』错框问题·与存活的 renderer xterm 缓冲重复渲染"
  - id: PL-CHALLENGE-3
    severity: low
    category: premise-challenge
    ac_refs: [AC-6, AC-7]
    title: "AC-7 相对 AC-6 + AC-3/4/5 零净新增可测行为·冗余复述可折叠"
  - id: PL-CHALLENGE-4
    severity: low
    category: premise-challenge
    ac_refs: [AC-1, AC-2]
    title: "存活判据挂在传输形态（parentPort vs --listen）是代理量·非语义本身·本地 loopback-standalone 会误触发"
  - id: PL-CHALLENGE-5
    severity: low
    category: premise-challenge
    ac_refs: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-8]
    title: "ROADMAP BL-005 = P1·PRD 却把 6 条 AC 标 P0·优先级信号错配需对齐预期"
six_questions_pass:
  q1_value_premise: challenged-but-holds
  q2_problem_definition: challenged  # PL-CHALLENGE-2
  q3_scope_minimization: challenged  # PL-CHALLENGE-1 / PL-CHALLENGE-3
  q4_upstream_alignment: challenged  # PL-CHALLENGE-1 / PL-CHALLENGE-5
  q5_revival_check: pass  # 无 · 见正文
  q6_existing_behavior: pass-with-note  # PL-CHALLENGE-4
-->

# Goal Stage · PL 对抗质疑 — BL-005 断线重连与会话连续性

## Verdict：approve-with-concerns（杀不掉·可小幅缩·2 项进 blueprint 硬解）

作为 PL 我试图杀死或缩小本 Feature，结论是**杀不掉**：价值前提是 M5 收官的硬需求且上游明文授权（远程 Host 若不做会话连续性，BL-001~004 的全部投入在用户第一次合盖时归零；README §143 的产品口号「close the lid, let agents keep running」正是本 BL 兑现的既定架构）。但**能缩**：AC-9（时间型孤儿超时）是 PRD 越上游加的范围且与核心承诺打架，建议 v1 砍掉时间维度只留计数/字节上限；AC-7 相对 AC-6 零净新增可折叠。另有 2 项须 blueprint 硬解（AC-3 回放范围的重复渲染风险 + 存活判据的代理量脆弱性）。以下逐条。

---

## 六问逐条

### ① 价值前提：为谁做？不做会怎样？ — 质疑后仍成立（杀不掉）

- **为谁**：用远程机跑长任务（build/agent/训练）的用户。
- **不做的代价**：真实且致命。现状 `hostCore.ts:125-133` 端口 close 无条件 `pool.kill` 该客户端全部会话。远程场景下，合盖/切网/断网 = UI 断开 = 远端 build/agent 被杀 + 无 scrollback 可回放 → **一断线前功尽弃**。这不是边缘体验退化，而是「远程开发第一天就崩」——BL-001~004 建的整条远程链路（注册表迁移、standalone 传输、SSH 编排、机器分组 Sidebar）在没有 BL-005 时对「真的把长任务放远端跑」的用户零可用。
- **是否既定设计**：是。README §141 架构规则 5 明文「Session state machine lives in Host … Sessions and their states keep running when the UI disconnects. Host maintains an output ring buffer for reconnect replay」——本 BL 是兑现既定架构，**非 scope creep**。
- **结论**：premise 成立，Feature 不可杀。这是我作为对抗方承认的：核心价值无懈可击。

### ② 问题定义：真问题还是方案伪装？ — 大体真问题·但 AC-3 框错了一半（见 PL-CHALLENGE-2）

「远端会话续跑 + 断开期间输出留存 + 重连恢复」是真问题。但 **AC-3 把回放范围框成「全量（断开前 + 断开期间）」，这半个是方案错框**：renderer 的 xterm 实例在断线（tab 未关）时是**存活的**（`terminalRegistry.ts:240` `disposeTerminal` 仅在显式关 tab 触发·GO-006），断开前的屏幕内容**本就还在本地缓冲里**。真问题只是「补断开期间的 gap」，不是「回放全量」。详见 PL-CHALLENGE-2。

### ③ 范围最小化：哪些 AC 砍掉不影响 WS-01-S5？ — AC-9 可砍·AC-7 可折叠（见 PL-CHALLENGE-1/3）

逐条比对 WS-01-S5 三条核心 AC（WS 文档 L195-196）：
| PRD AC | 映射 WS-01-S5 核心 | 判定 |
|--------|--------------------|------|
| AC-1 会话存活 | ① 断开后会话续跑 | 核心·留 |
| AC-2 本地零回归 | R3 约束（守门·非新范围） | 留（守门条款） |
| AC-3 回放 scrollback | ② 屏幕回放 | 核心·但范围要收（PL-2） |
| AC-4 重 attach 非 spawn | ② 的机制 | 核心·留 |
| AC-5 状态/徽标对账 | ② tab/徽标对账 | 核心·留（**不与 AC-3 重叠**，见下） |
| AC-6 横幅+自动重连+手动重试 | ③ 断线横幅+自动重连+手动重试 | 核心·上游明文·留 |
| AC-7 自动重连成败链路 | ③ 的复述 | **零净新增·可折叠进 AC-6（PL-3）** |
| AC-8 token 闸+归属校验 | 上游未列·安全必要衍生 | 留（认领必须鉴权·否则跨客户端劫持） |
| AC-9 孤儿超时+会话上限 | **上游三条核心 AC 均无** | **PRD 越上游加·且与核心承诺冲突·建议 v1 砍时间维度（PL-1）** |

- **AC-5 对账 vs AC-3 回放是否重叠？→ 无重叠（此项 PRD 站得住）**：AC-3 恢复的是**终端屏幕字节**（xterm buffer）；AC-5 恢复的是**带外 UI 态**（tab 徽标 running/idle、未读通知点、Dock 角标）——这些活在 renderer store，不在终端缓冲里。断开期间任务完成的 `done` 事件在断线时已 fire、重连后**不会重发**，故必须显式拉 sessionTracker 快照对账漂移，重 attach（AC-4）只给未来事件、补不了这段漂移。两者互补不重叠，AC-5 保留合理。
- **横幅+自动重连 AC-6/7 是否可拆？→ AC-6 留、AC-7 折叠**（PL-3）。

### ④ 上游对齐：PRD 是否忠实？有无擅自加/缩范围？ — 5/6 忠实·AC-9 是唯一擅自加（PL-1/5）

逐条 cite：
- WS-01-S5 scope（WS 文档 L54）：「host 侧 scrollback 环形缓冲 + 远程会话存活策略（UI 断开不杀会话）+ 重连回放与认领 + 状态徽标/通知对账 + 重连横幅与自动重连策略」→ PRD AC-1/3/4/5/6/7 **逐项忠实覆盖**。
- R3（WS 文档 L87-90）：「按 host 形态分语义：本地嵌入式保持现行为；standalone/远程会话存活 + 重连认领」→ PRD D-1/AC-1/AC-2 **忠实**（但判据脆弱·PL-4）。
- ROADMAP BL-005（L38）scope/AC → 忠实；**但优先级列 = P1**，PRD 却把 AC-1~5、AC-8 标 P0（PL-5）。
- **AC-8**（token 闸）：WS-01-S5 scope 文本未明列，但「认领」机制离了鉴权就是跨客户端会话劫持漏洞，属安全必要衍生·可接受的加法。
- **AC-9**（孤儿超时+会话上限）：WS-01-S5 scope **与三条核心 AC 均无此项**。这是 PRD 经 D-6 **擅自加的范围**（PL-1）。

### ⑤ 复活检查：KNOWLEDGE 已否方向换皮复活？ — 无（六问此项通过）

- 扫 OS-001~005（编辑器/LSP、绑定 agent、终端性能竞赛、Windows/Linux、Ghostty fork）：**均与断线重连/会话连续性无关**，无换皮复活。
- GO-012（notify·「UI 完全关闭期间收不到系统通知 … 推送通道留 M5 后」）：PRD **未**试图加推送通道，AC-5 做的「重连对账」正是 GO-012 自己写的过渡兜底方案（「靠重连对账兜底」）——**与已否边界一致、非复活**，反而是忠实承接。
- 结论：**无复活。理由如上。**

### ⑥ 既有行为变更：本机嵌入式零回归（AC-2）真成立还是偷改？ — 今日成立（此项通过·附 blueprint 注）

- 现状（`hostCore.ts:125-133`）：`port.on('close')` 无条件 kill。PRD D-1 分支后：parentPort（本地嵌入式）路径 kill 语义**一字不变**，仅 --listen（standalone）路径改存活。
- 今日 parentPort ⟺ 本地、--listen ⟺ 远程一一对应，故**本机用户关窗/⌘R 行为零感知·无需用户拍板**——AC-2 守门成立，**非偷改**。
- 唯一注脚：判据挂在**传输形态**而非**语义本身**，是代理量，未来会误触发（PL-4·blueprint 处理）。

---

## Findings

### PL-CHALLENGE-1（high · premise-challenge · AC-9）
**AC-9 时间型孤儿超时是 PRD 越上游擅自加的范围，且与本 Feature 的核心承诺直接冲突。**

- **越范围**：WS-01-S5 的 scope 文本与三条核心 AC（WS 文档 L54、L195-196）、ROADMAP BL-005 AC（L38）**均无**孤儿超时。它由 PRD D-6 引入，上游无授权依据。
- **与核心承诺打架**：本 Feature 的头号价值是「合上笔记本、回来接着干」（README §143 / 用户故事）。AC-9 让 host 在「无客户端 attach 超 N 分钟」后**回收会话**——这恰好会杀掉本 Feature 存在的理由：用户合盖过夜（N 通常 <<一夜）回来，跑了一整晚的 build/训练**被孤儿超时干掉了**。N 设小则毁核心价值，N 设大则 AC-9 形同虚设。这是设计上的自我否定。
- **内存泄漏动机其实已被 D-2 覆盖大半**：单会话内存已被 D-2 的每会话字节上限环形缓冲（256KiB/session）**有界**。真正无界的只有「会话**数量**无限增长」，而会话由用户手动创建，v1 单用户不会刷出上千孤儿会话。用**会话数上限**即可挡住数量维度，**不需要时间维度的 reap**。
- **suggestion**：v1 **砍掉时间型孤儿 reap（AC-9 的「超 N 分钟回收」）**，只保留 ①D-2 每会话字节上限（已在）+ ②会话数上限（够挡数量泄漏）。时间型 reap 待有真实泄漏证据再于 v2 引入，且若引入必须**用户可见 + 保守 N（如按天）+ 长任务豁免**。若坚持 v1 保留，则须显式标注这是「本 Feature 唯一越上游的加法」并交用户拍板 N 值（因为它能杀掉用户的长任务）。降级 AC-9 至纯计数/字节保护后，本 Feature AC 数 9→8 且消除自我冲突。

### PL-CHALLENGE-2（medium · premise-challenge · AC-3/AC-4）
**AC-3『host 回放全量 scrollback（断开前内容 + 断开期间新输出）→ renderer 写入 xterm』错框，且对存活的 renderer 缓冲有重复渲染风险。**

- **事实**：renderer 的 xterm 实例在断线（tab 未关，网络闪断的常见情形）时是**存活**的——`terminalRegistry.ts:240` `disposeTerminal` **仅在显式关 tab** 才 dispose（GO-006「terminalRegistry 跨挂载存活」）。即断开前的屏幕内容**已经在本地 xterm buffer 里**。
- **问题**：AC-3 要 host「回放全量（断开前 + 期间）」并「写入 xterm」。若 xterm 实例存活（闪断主路径），把「断开前内容」再回放一次 = **断开前内容双写** → 屏幕内容重复 / scrollback 错乱。反之若 tab 已关 xterm 已销毁，则全量回放才正确。**回放范围取决于 renderer 缓冲是否存活，AC-3 未区分**，且措辞（「全量·断开前+期间」）偏向会双写的设计。
- **真问题更窄**：核心缺口只是「**断开期间** host 续跑产生、renderer 没收到的那段 gap」，不是「全量」。
- **suggestion**：blueprint 明确回放范围二选一并写进 AC-3：(a) 重连时**先 clear xterm 再回放 host 权威全量**（host 环形缓冲即上限·本地超 256KiB 的旧 scrollback 会丢·需接受）；或 (b) 携**序列游标**只回放断开期间增量、保留存活的本地缓冲（需 host 侧按 renderer 上次 ack 位点切片）。倾向 (b)（不丢本地 scrollback·与 GO-005 的 ack 流控天然衔接）。AC-3 当前措辞按 (a)/(b) 之一重写，并补「与存活 xterm 缓冲去重」这条可测断言。

### PL-CHALLENGE-3（low · premise-challenge · AC-6/AC-7）
**AC-7 相对 AC-6 + AC-3/4/5 零净新增可测行为，属冗余复述。**

- AC-7「成功→走认领+回放+对账全链路」= AC-4+AC-3+AC-5 已覆盖；「失败→横幅保持+继续退避/手动重试」= AC-6「横幅成功才消失」的逻辑补集（非成功即不消失）。AC-7 没引入 AC-6/3/4/5 之外的**新可测行为**。
- **suggestion**：把 AC-7 折叠为 AC-6 的两个场景分句（成功/失败），AC 数再 -1。纯编辑性收敛，不损覆盖。

### PL-CHALLENGE-4（low · premise-challenge · AC-1/AC-2）
**会话存活判据挂在传输形态（parentPort vs --listen）是代理量而非语义本身，未来本地 loopback-standalone 模式会误触发。**

- 今日 parentPort ⟺ 本地、--listen ⟺ 远程成立，判据能工作。但 BL-002 已建 standalone host 可在 **loopback + token** 本地跑。若 TermPro 将来以 loopback-standalone 形式起本机 host，「--listen ⟹ 会话存活」会让**本机**会话在关窗后意外存活——违反 AC-2 的本机语义。判据真正该表达的语义是「**host 生命周期是否独立于本 UI**（ephemeral vs persistent）」，不是传输管道形状。
- **suggestion**：blueprint 把存活判据做成 host 启动时**显式的角色标记**（如 `--session-lifetime ephemeral|persistent`，由拉起方按「本机嵌入 vs 远程」显式设定），而非从 parentPort/--listen 反推。今日不阻塞（映射恰好成立），但显式化可防未来 loopback-standalone 误触发这颗雷。

### PL-CHALLENGE-5（low · premise-challenge · 优先级信号）
**ROADMAP BL-005 整体标 P1，PRD 却把 AC-1~5、AC-8 六条标 P0，优先级信号错配。**

- ROADMAP L38 明标 BL-005 = **P1**（M5 内相对其他 Feature 最后做）。PRD 把 6 条 AC 标 P0。两者是不同轴（Feature 间排序 vs Feature 内必做性），非硬矛盾，但一眼看去「6 条 P0」会诱导 reviewer/RD 相对 P1 的 roadmap 信号**过度投入**（尤其 AC-6/7 横幅这类呈现层）。
- **suggestion**：PRD 补一句注明「Feature 级 P1（wave 排序）· AC 级 P0（Feature 内必做）二轴不同」，或把呈现层 AC-6/7 的 P1 与核心链路 AC-1~5 的 P0 之别在验收表里点明预期投入梯度。纯预期对齐，不改范围。

---

## 给 PMO 的一句话
Feature 立得住、上游对齐 5/6 忠实、无复活、本机零回归今日成立——**可进 blueprint**。但请在 blueprint 前拍两件事：**(1) AC-9 时间型 reap 砍不砍**（我强烈建议砍·它自我否定核心承诺）；**(2) AC-3 回放范围**（全量 clear-replay vs 增量游标·防双写）。AC-7 折叠、AC-4 判据显式化、AC-5/6 优先级注脚为 nice-to-have。以上 findings 全部错向 blueprint 前可推翻（WARN 级·blanket yolo 授权内）。

---

# Round 2 · 复核 PRD v0.2（验质疑消解）

**Verdict：approve（5/5 PL 质疑消解到位·六问仍全成立·1 低残留仅需 PMO 确认）**

复读 PRD v0.2 全文，逐条核对 5 条 PL 质疑是否真消解（看实文非看声称），并以对抗视角检查 v0.2 的**范围增长**（新增 AC-10/11 + ARCH 扩写）是否反向引入 scope creep 或破坏六问。结论：全部消解、增长皆为正确性必需的管道件非镀金、六问仍成立。放行。

## 5 条 PL 质疑消解核对（逐条 cite v0.2 实文）

| Finding | 消解证据（v0.2 行） | 判定 |
|---------|--------------------|------|
| **PL-1**（high·AC-9 时间型 reap 自我否定核心承诺） | D-9（L96）「🔴 砍时间型孤儿超时…只留字节上限+会话数上限」· AC-9（L109）「无时间型孤儿超时·不杀长任务」· Out of Scope（L142）显式列「时间型孤儿会话超时回收——与合盖过夜矛盾」 | ✅ **消解**·砍得干净且三处一致·内存/资源仍由 D-2 字节界+会话数上限兜住 |
| **PL-2**（med·AC-3 全量回放双写） | AC-3（L104）「增量回放…按已确认字节游标·不重写本地已有 scrollback」· D-4（L91）显式声明 terminal 生命周期模型：闪断（xterm 存活）→增量补 gap／tab 已关或断线回落已 dispose→据 session.list 重建 tab 后全量回放 | ✅ **消解且超预期**·不仅改增量·还补齐了我当时只隐含点到的「tab 已关」互补分支（重建 tab+全量）·并派生 session.list 须返 cwd/title/state |
| **PL-3**（low·AC-7 零净新增） | 机读块（L34）AC-6 直接跳 AC-8·AC-7 已删· AC-6（L107）「重连成功…横幅消失；重连失败…横幅保持+退避/手动重试（原 AC-7 折入）」 | ✅ **消解**·折成 AC-6 成/败两场景·无悬挂引用 |
| **PL-4**（low·形态判据代理量） | D-1（L88）「🔴 形态标志由 host.ts 显式注入 hostCore（非 hostCore 内嗅探 argv·守传输无关）」· AC-2（L103）「parentPort·显式形态标志」 | ✅ **消解**·正是我建议的显式角色标记·且与 ARCH-7 传输无关守卫合流·未来 loopback-standalone 不误触 |
| **PL-5**（low·优先级二轴信号） | 二轴认知已采纳（Feature 级 P1=排期轴／AC 级 P0=Feature 内 must-have）·verify 核 AC 优先级合理性（见下） | ✅ **消解**（见残留 R2-1） |

## AC 优先级合理性核验（PL-5 verify 项）

逐条核 v0.2 AC 优先级内在合理：AC-1/2/3/4/5 核心链路 + AC-8 安全 = P0 ✓；AC-6 呈现层 + AC-9 泄漏保护 = P1 ✓；**新增 AC-10（显式 reconnect 路径）P0** ✓（AC-1/3/4 全建在其上·无它重连死锁）；**新增 AC-11（幂等收养防双 spawn）P0** ✓（30s 假死窗口是**快速重连常态**非边缘·双 spawn=会话分叉数据损坏·P0 合理）。优先级分布自洽·无错标。

## 对抗视角：v0.2 范围增长审查（AC 9→10·防镀金）

作为对抗方我特别查了「PM 采纳质疑后有没有借机把范围做大」：
- **AC-10/AC-11 是正确性必需管道件·非新用户功能**：AC-10 修 hostClient 复用实例重连死锁（markDown→拒 rpc·connectPromise 陈旧）；AC-11 修 30s 心跳假死窗口的双 spawn。二者都是「让已承诺的重连行为**真的能工作**」的底层管道·砍了则 AC-1/3/4/6 全是空头支票。**不是镀金·是补地基**。用户可感知范围未扩。
- **AC-1 扩写（旁路流控·ARCH-1）实为兑现 Q① premise**：断开期无 ack→现流控 proc.pause **会憋停子进程**·不旁路则「会话续跑」是假的。这条把我 Round 1 认定「杀不掉」的核心价值从**声称**变成**真能交付**·是整轮评审最要害的一处·必留。
- **AC-5 是缩不是扩**（去掉断开期离散 bell/notify 累积补发·ARCH-5）·与 GO-012「推送通道留 M5 后·重连对账兜底」一致·是范围**纪律**。
- **AC-8 是收紧不是放松**（认领限孤儿会话+token·防第二窗口劫持活跃会话）·安全增强。

净范围故事：砍 AC-9 时间 reap + 缩 AC-5 离散通知 + 折 AC-7，增 AC-10/11（正确性地基）。**用户可感知范围零扩张·内部正确性补齐**。忠实。

## 六问复核（v0.2 是否仍全成立）

- **① 价值前提**：仍成立·且 ARCH-1 旁路流控让「会话续跑」从声称变真交付·premise 更硬。
- **② 问题定义**：AC-3 已正框（增量非全量）·PL-2 消解。✅
- **③ 范围最小化**：更紧（砍时间 reap·缩离散通知·折 AC-7）·AC-10/11 为不可砍的正确性地基。✅
- **④ 上游对齐**：仍忠实·AC-9 不再越上游（时间 reap 去除·字节/计数界本就隐含于「环形缓冲有界」）·AC-10/11 是机制非上游范围外新增。✅
- **⑤ 复活检查**：仍无复活·AC-5 缩窄**强化**了 GO-012 边界对齐（离散通知补发显式出范围）。✅
- **⑥ 既有行为**：AC-2 更干净（除 kill 语义一字不变·再加「不分配 scrollback 缓冲」内存纯度 ARCH-11）·markDown 本地分叉显式保「进程死=终结」现语义。零回归更稳。✅

## 残留（不阻塞·仅需 PMO/用户一句确认）

### R2-1（low · premise-challenge · AC-5 / Out of Scope）
**AC-5 把上游 scope 字面词「通知对账」缩窄为「当前态对账」（去离散 bell/notify 补发），方向对但须一句显式确认。**
- 上游 WS-01-S5 scope（L54）字面含「状态徽标/**通知**对账」。v0.2 AC-5 明确排除「断开期离散 bell/notify 累积补发」（sessionTracker 无累积能力·ARCH-5），只做 running/idle/quiet 当前态对账。
- **我判定这是忠实的**：「对账」= 让徽标符合当前真相，非「重放每条历史通知」；且 GO-012 早已把「UI 缺席期的离散通知投递」推到 M5 后、以「重连对账兜底」过渡——AC-5 当前态对账正是该兜底。对桌面终端工具，用户真实需求是「这会话有未看的完成活动」（徽标/点），非「3 条离散通知的计数」。
- **suggestion**：无需改 PRD 范围·仅请 PMO/用户点头确认「通知对账 = 当前态徽标对账（未看活动指示），非断开期离散通知逐条补发」即可闭环。已在 Out of Scope L140 显式列出·近乎自证·故 low 且不阻塞。

## Round 2 结论
5/5 PL 质疑消解到位（PL-2 超预期补齐互补分支）·v0.2 范围增长经审为正确性地基非镀金·六问全成立·仅 1 低残留待 PMO 一句确认。**approve·可进 blueprint**。blueprint 阶段请把 v0.2 §开工前必须想清的「五条必先钉死」（detached 旁路流控／字节+计数上限／reattach 不重 spawn／显式 reconnect 路径／孤儿+token authz）作为硬门——它们是本 Feature 从「声称连续」到「真连续」的地基，当前代码均不支持。
