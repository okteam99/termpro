---
tech_feature_id: OKWORK-F260805033051-Remote-Connection-Controls
review_round: 1
review_scope: blueprint
reviewers: [architect, external]
verdicts: {architect: APPROVE, external: APPROVE}   # 终态 = 处置后;Round 1 两路均打回,逐条处置见正文
reviews:
  - role: architect
    review_scope: blueprint
    execution: subagent
    review_model: "会话主模型(opus · 主审路)"
    verdict: APPROVE
    findings_count: 11
  - role: external
    review_scope: blueprint
    execution: subagent
    review_model: "fable(错开主审路 · 独立采样)"
    coverage: [可实现, 可验证, 并发与生命周期]
    verdict: APPROVE
    findings_count: 8
overall_verdict: APPROVE
next_round_required: false
tech_version_reviewed: "v0.1"
tech_version_after: "v0.2"
---

# TECH-REVIEW(OKWORK-F260805033051-Remote-Connection-Controls)Round 1

两路隔离并行、模型错开(Architect = 会话主模型 opus;external = fable),互不喂对方产出。

## 结论摘要

**v0.1 的核心架构论断被两路独立证伪。** v0.1 声称「把弃用 gate 放在 `applyEvent` 一处,就覆盖 PRD §核心风险模型的三条通道」。两路各自从不同入口发现同一件事:

> **那道 gate 只挡「状态写入」,挡不住「副作用」。而 AC-6 要防的最危险那半 —— 残余 `verifying` 触发 `beginHandshake` 把连接真的建成 —— 恰恰是副作用。**

更糟的是 v0.1 亲手制造了一个新缺陷:把 `await disconnectAwait` 排在本地拆除**之前**,同时引发三个后果(UI 复位延迟 5 秒 / ws 远端关闭竞态 / 自动重连被自己唤醒)。两路给出的最省修法一致:**把本地拆除提到 await 之前**(镜像设置页今天已有的同步顺序),再给副作用点补守卫。

v0.2 已据此把架构从「一道闸」改为「**两道闸**」并改序。

## 两路共同发现(独立命中 · 置信度互相加权)

| # | 问题 | Architect | external | 处置 |
|---|---|---|---|---|
| A | store 闸挡不住 `beginHandshake` 副作用;`getOrCreateRemote` 会把 client 塞回注册表,反向击穿「readoptHost 实时查表」不变式 | ARCH-2 (high) | EXT-1 (high) | **ADOPT** → §架构改两道闸 + 四个副作用闸接线点 |
| B | `await` 排在本地拆除之前 → UI 延迟 + ws 竞态 + 自动重连被唤醒 | ARCH-1 (high) | EXT-4 (medium) | **ADOPT** → 断开流程改序,第 3-4 步同步先行 |
| C | 重连被重新点火(第四通道) | ARCH-3 (high · 由 `setReconnecting` 未 gate 切入) | EXT-2 (high · 由 `client.onReconnectNeeded` 切入) | **ADOPT 两者** → 既补 `setReconnecting` 闸,也补 `onReconnectNeeded` 接线闸 |
| D | 设置页过滤「整段删除」是功能回退,应改写而非删除 | ARCH-4 (medium) | EXT-1 附论 | **ADOPT** → 位置不动、只换判据来源 |
| E | 漏了 `handleUpgrade` 这个第三个 `resume` 入口 | ARCH-5 (medium) | EXT-5 (medium) | **ADOPT** → 生命周期表列三个调用点 |
| F | AC-7 toast 漏「不处于自动重连编排中」 | ARCH-7 (medium) | EXT-3 (medium) | **ADOPT** → 判据三合一 |
| G | `aria-disabled` 不阻止 click,handler 必须早返 | ARCH-6 (medium) | EXT-7 (low) | **ADOPT(以裁决方式)** → 改用忙碌态 + 排队,不用禁用态,问题从根上消失 |
| H | 配置删除时 `abandoned` 无人清 | ARCH-11 (info) | EXT-6 (low) | **ADOPT** → 新增 `forget(id)`,两条删除路径调用 |

### 关于 C 的机理更正(值得单独记)

v0.1 的 AC-9 写「`abandon` 保证残余 `disconnected` 不会被 `onDisconnected` 重新拉起」—— **机理是错的**。external 指出:`onDisconnected` 的真实触发源**不是 main 事件**,而是 `client.onReconnectNeeded`(transport 关闭 / 心跳判死),全仓唯一接线点在 `Sidebar.tsx:321-325`,**完全不经 store**。所以 store 闸对它无效,必须在接线点单独设闸。

Architect 从另一侧切进同一问题:`setReconnecting` 是第六条独立写入路径且未被 gate,而 `reconnecting` 在组头派生里**优先级最高**(`Sidebar.tsx:521` 排在 ready/disconnected 之前),置真即当场破 AC-2/AC-9。

两个视角合起来才是完整图景:**触发源要挡(闸 4),状态写入也要挡(纵深)**。v0.2 两者都做。

## ⚖️ 两路分歧与我的裁决:`settling` 去留

这是本轮唯一的实质分歧,值得完整记录。

| | Architect(ARCH-6) | external(简洁性 counter-lens) |
|---|---|---|
| 主张 | **砍掉 `settling` 与 8s 兜底**。改为 `handleConnect` 里 `await pendingDisconnect` —— 点击恒被兑现而非被拒 | **全部保留**。dedupe 竞态属实,无 `settling` 就无法呈现"在忙";8s race 防 IPC 层异常,一行成本合理 |
| 理由 | 少一个 store 字段、少一条 i18n、少一条兜底;`aria-disabled` 的争议随之消失 | 纯排队在等待期**零反馈**,用户点了看不到任何变化最长 5 秒 |

**我的裁决:各取一半,不是折中而是两者的正确部分可以同时成立。**

- 采纳 Architect 的「**点击恒被兑现,不拒绝**」→ 因此**不用禁用态**。这一步同时解决了 ARCH-6 与 EXT-7 提的「`aria-disabled` 不阻止 click,handler 必须早返」——根本没有禁用态,也就不存在"点了被拒还是被吞"的问题。
- 采纳 external 的「**必须有反馈 + 必须有时间上界**」→ 因此保留 `settling`,但语义从「禁用标志」降级为「**忙碌指示**」(spinner + `aria-busy`,按钮仍可点);保留 8s `Promise.race`,语义从「解除卡死的禁用」改为「**排队的时间上界**」。

**adversarial_self_check**:先质疑自己这个裁决是不是"两边都听"的和稀泥。回读 AC-13 原文判据 ——「要么真的重新发起并推进阶段呈现,**要么按钮在编排彻底作废前保持禁用/loading**——不得出现『点了但毫无反应、也没有任何状态变化』」。可见 AC 本身就允许 loading 态,且明令禁止「无状态变化」。纯 Architect 方案(排队但无反馈)恰好落进被禁止的那一格;纯 external 方案(禁用)要额外处理"禁用态被点击"的语义。两者各自的缺陷都由对方的主张补上 —— 这不是和稀泥,是两个主张在正交维度上(是否拒绝点击 / 是否给反馈)各自正确。

## Architect 段(11 条 · 全部处置)

ARCH-1/2/3(high)见上表 A/B/C。其余:

| id | sev | 内容 | 处置 |
|---|---|---|---|
| ARCH-4 | medium | 设置页收敛是功能回退,非"等价+修复" | ADOPT(见 D) |
| ARCH-5 | medium | `abandonedRef` 全仓 5 处,TECH 只列 4 处,漏 `handleUpgrade` | ADOPT(见 E) |
| ARCH-6 | medium | `aria-disabled` 不阻止 click;建议砍 settling | ADOPT(以裁决方式,见上) |
| ARCH-7 | medium | toast 漏 `!isReconnecting`;且不得复用 `prevStages`(先声明的 effect 已更新它,边沿检测永远失效) | **ADOPT** —— 第二点尤其有价值,是我不会想到的 React effect 顺序陷阱 |
| ARCH-8 | low | 新 `ipcMain.handle` 须登记进 teardown 闭包,否则重复注册抛错 | ADOPT |
| ARCH-9 | low | `disconnectAwait` resolve ≠ 已断开(两条提前返回) | ADOPT → R4 如实记录,方案只用它排序不承载语义 |
| ARCH-10 | low | auto-margin 会在 connected 态出现两个,均分空隙;现有 CSS 注释正为防此 | **ADOPT** —— 我照抄 CSS 时把 `-rtt` 加进 auto 组会踩这个坑 |
| ARCH-11 | info | `abandoned` 泄漏无害(id 随机 12 位不复用),但删机时顺手清 | ADOPT(见 H) |

**Architect 确认「不必改」的两点**(避免后续重复质疑):TECH v0.1 的行号引用**逐条核过全部准确**(问题出在推理结论而非取证);AC-8/AC-12「无需新代码」成立。

## external 段(8 条 · 覆盖方向制)

coverage: `[可实现, 可验证, 并发与生命周期]`(自选方向理由:本 Feature 自称的正确性要害即三条异步通道收口,对抗采样期望值最高)

EXT-1/2/4/5/3/7/6 见上表。另:

| id | sev | 内容 | 处置 |
|---|---|---|---|
| EXT-8 | low | 四个 seam 有三个缺口:① **无任何 seam 覆盖「残余 verifying 不得触发新握手」**(AC-6 最尖的牙、EXT-1 的病灶)② 无 seam 覆盖重连再点火 ③ 「断言 `readoptHost` 未被调用」措辞不成立——它会被调用然后早退,应断言 `session.list`/`attach` 未发出 | **ADOPT 全部三点** → §测试策略重写,已同步给 TC 起草方 |

**external 的阴性结论**(记录以证明方向已覆盖):AC-8/AC-12 断言成立;toast 单源与挂载点属实;i18n 行号逐字命中;多机并发断开无共享状态冲突(`abandoned`/`settling` 均 per-configId);「resume 后在途残余事件写穿」窗口仅毫秒级 IPC 送达间隙,人手不可达,接受。

**external 顺手指出的两条 info**:`MachineGroup.tsx:286-288` 的 `status==='connecting'` 分支是死代码(Sidebar 从不派生该值)—— 与我在 ui_design 期的独立发现一致,已列入 AC-4 重构时顺手清;`prevStages` 在 clear 后留陈旧条目,现无害。

## 两路对「死锁风险」的独立结论(一致)

我在派发时特意向两路提了同一个问题:`reconnectController` 的 disconnect-first 会不会误触发弃用标记导致自动重连自锁?

**两路独立给出同一结论:不会。** `reconnectWiring.ts:24` 注入的是裸 IPC(`window.okwork.remoteHost.disconnect`),不经任何会置 `abandon` 的 UI 流程。我自己也独立验证过同一条。

但两路都补了同一条警告:**这靠纪律维持且很脆** —— 只要有人图省事把渲染层的 `handleDisconnect` 复用给 controller(看着很像同一件事),自动重连会当场自锁死。已在 v0.2 的 `abandon` action 说明里钉死该约束,并列为 R1。

真正的缺口是**反方向**的(EXT-2 / ARCH-3):不是自动重连被锁死,而是**被自己唤醒**。

## 整合结论

- **overall_verdict**: APPROVE(两路 Round 1 均 NEEDS_REVISION → 逐条处置 → v0.2)
- **19 条 finding**(Architect 11 + external 8)· ADOPT 19 · REJECT 0
- 🔬 **独立采样的价值**:本轮两路**没有一条重复劳动**却在四个问题上交叉命中(A/B/C/E/F/H),且对同一问题给出**互补而非重复**的机理(C:一路从状态写入切入、一路从触发源切入,合起来才完整)。唯一分歧(`settling` 去留)经回读 AC 原文裁决为「两者正交、可同时成立」。
- **下一步**:TC 按 v0.2 更新中(已派发)→ blueprint 方案要素确认(🛡️ 兜底清单非空,须用户拍板)→ dev
