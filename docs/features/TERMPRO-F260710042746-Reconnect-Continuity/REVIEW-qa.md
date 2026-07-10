---
verdict: NEEDS_REVISION
reviewer: QA (code review · review stage)
scope: BL-005 `git diff 954dcc0..HEAD -- src/` + 全部 BL-005 测试
date: 2026-07-10
tests_run:
  pure_logic: "71 passed (9 files) — ringBuffer/sessionTrackerSnapshot/reconnectBackoff/heartbeatDetect/hostClientReconnect/reconnectSuppressDrop/terminalRegistryReadopt/residency/ssh"
  pty_integration: "19 passed (2 files) — ptyPoolDetach + reconnectContinuity.integration 本机真 node-pty 全绿(非空壳·非沙箱红)"
  total: "90 passed"
open_blocker: 0
open_major: 2
open_minor: 2
open_nit: 2
---

# BL-005 断线重连与会话连续性 — 代码 QA 评审

## 结论

**NEEDS_REVISION**。14 AC 的 host 契约侧 + 纯逻辑侧覆盖扎实、真断言、全绿(含真 pty 集成测在本机真跑通过,非空壳)。但**两个 P0 AC 的「渲染半侧」是幽灵覆盖**——正是上轮 blueprint QA-B-1 揪出、本轮理应堵死的 renderer 半侧盲区,dev 补了单测让 TC 翻绿 ✅,**但测的是与生产路径分叉的死代码 / 只读死字段**,生产接线的真实缺口被绿测掩盖(AC-15 Sidebar drop 闸 + AC-12 已完成徽标)。这两条与本项目 BL-003/004 的 verify-ac 幽灵覆盖同型,故 MAJOR。

先说清值得肯定的:
- **集成测真跑**:`ptyPoolDetach` + `reconnectContinuity.integration` 在本机真 node-pty 下 **19/19 全绿**(不是"沙箱红是基线"的空壳)——AC-1/3/4/5/8/9/11/12/14 的 host 协议侧行为断言真实成立。
- **强行为断言**:T-002(灌到 paused → detach → 断言续跑到 ≥99% 全量·`ptyPoolDetach.test.ts:44-52`)真验旁路流控 + paused 复活(ARCH-B-3);T-028 否定断言(转移后 A.ptyData 不再增长·`reconnectContinuity.integration.test.ts:434-436`)真区分「转移 vs 扇出」;T-023 进程 exitCode 来自 onExit 非 tracker(`:354`)。
- **纯逻辑边界**:ringBuffer(游标/UTF-8 驱逐/full 回退/字节上限单调)、heartbeat(有界 T·probe 挂起/reject/stop·注入 seam)、backoff(退避/cap/预算/复位)边界覆盖到位。
- **异常路径**:TECH §错误处理 8 条(退避超预算/gap 超缓冲/逐最旧 exited/拒新建/token 拒/防双 spawn/UTF-8 截断/resize 对账)逐条有能过的测。

---

## Findings

### Q1 — AC-15 Sidebar 900ms drop 闸:测的是**零生产调用者的死助手**,真实 gate 无测 · **MAJOR · open**

TC-030 明写本测须覆盖「② Sidebar 900ms drop 计时器 gate 到 !isReconnecting ... 消 CR-1 测盲区」(`TC.md:652-663`)。但:

- 测断言的是 `scheduleDropUnlessReconnecting(...)`(`reconnectSuppressDrop.test.ts:78-99`),该函数**仅在 `reconnectController.ts:152` 定义、被测试引用,生产代码零调用者**(grep 全 src 非 test 只命中定义处)。
- **生产真实的 900ms 闸是 Sidebar 内联的**:`Sidebar.tsx:327` `if (!useRemoteHostRuntimeStore.getState().isReconnecting(configId)) { panelTimers... setTimeout(... stopRemoteWorkspaceSync, 900) }` —— 这段**没有任何测试**。
- 后果:若有人删掉 `Sidebar.tsx:327` 的 `isReconnecting` 判断(AC-15 full-drop 抑制的唯一生产闸),`reconnectSuppressDrop.test.ts` 仍全绿——CR-1 测盲区**并未被关闭**,只是搬到了一个平行的死函数上。

**真被测到的那半**(controller 侧:`onDisconnected` 同步先占 reconnecting 再 disconnect-first `:46-59`、自发 disconnected 再入守卫 `:61-71`、onReady 清态 `:102-112`、超预算 drop `:115-136`)是真断言、真生产路径(reconnectWiring 接 `onDisconnected`/`onReady`),这半 OK。缺的是 Sidebar 计时器 gate 这半。

修法二选一:① 让 `Sidebar.tsx:317-339` 真调 `scheduleDropUnlessReconnecting`(把内联闸收敛到被测助手);② 或对 Sidebar 该 effect 写组件级测(disconnected 事件 + reconnecting=true → 推进 >900ms → 断言未调 `stopRemoteWorkspaceSync`;reconnecting=false → 调)。

---

### Q2 — AC-12 「已完成」徽标(北极星渲染半侧):T-035 断言**只读死字段 + 不设徽标的 hook**,真实徽标在重连路径根本不亮 · **MAJOR · open**

北极星故事的渲染承诺是「重连看到完成日志 **+ 已完成徽标**(不是空白/会话消失)」(PRD 交付预期 · AC-12)。TC-035 断言「渲染『✓ exit 0 已完成』徽标(`.tab-dot--exited`)」(`TC.md:720-729`),TC 矩阵把 AC-12 标 ✅ 由 T-035 覆盖渲染半侧。实测:

1. T-035(`terminalRegistryReadopt.test.ts:200-228`)只断言 `inst.exited === true` + `reconcileBadge` 被调 status=exited。
2. **`inst.exited`(TermInstance)是只写死字段**:`terminalRegistry.ts` 写 7 次(:197/330/425/441/446/473/480),**全 renderer 读 0 次**。TabBar 渲染的是 **store 的 `tab.exited`**(`TabBar.tsx:199,210`),两者是不同对象。
3. **store `tab.exited` 只由 `App.tsx:27` 的 onExit 回调设置**(`updateTab(tabId,{exited:true})`)。
4. 该 onExit 回调经 `client.attachPty(...).onExit` 触发,而 host **`pty:exit` 只在 `ptyPool.onExit` 发(`ptyPool.ts:174,185`),`reattach` 从不重发**。→ 断线期已 exited 的会话,重连 reattach 时新 client **收不到 `pty:exit`** → App.tsx onExit 不触发 → **store `tab.exited` 永不置真** → TabBar 不亮「已完成」徽标。
5. 唯一动 store 的 readopt hook `reconcileBadge`(`reconnectWiring.ts:17-24`)**只映射 `state→activity(running/idle)`,完全忽略 `snapshot.status='exited'`**,不设 `tab.exited`。

即:北极星场景(断线期 build 跑完 → 重连)**scrollback 回放真的到位(host 半侧已测通过·实质价值在)**,但「✓ 已完成」这个状态徽标**在重连路径根本不亮**,而 T-035 因断言死字段 + 空 hook 而绿。这就是上轮 blueprint QA-B-1 点名的「渲染半侧幽灵覆盖」原样复发。

> 未升 BLOCKER 的唯一理由:tab 不消失、完成日志真回放(T-023/024 host 侧证实),核心价值未全失守,缺的是完成态徽标装饰。但 AC-12 被标 ✅「渲染半侧已覆盖」= 假绿,须 MAJOR。

修法:readopt 收养到 `snapshot.status==='exited'` 时,经一个真接线(reconcileBadge 扩展或新 hook)`updateTab(tabId,{exited:true})`;并对该接线补真断言(用真实 `reconnectWiring.reconcileBadge` 或断言 store 落 `tab.exited`,而非只断 `inst.exited`)。

---

### Q3 — AC-5 真 reconcileBadge + AC-4 路径② rebuildTab 在默认接线里未生效/未测 · **MINOR · open**

- **AC-5 渲染半侧**:T-034(`terminalRegistryReadopt.test.ts:180-197`)注入自己的 `reconcileBadge` spy,只证 `readoptHost` **调用** hook,**真实的 `reconnectWiring.reconcileBadge`(`:17-24` · `findTab`+`updateTab activity`)无任何测**。它是薄接线(state→activity),但正是 AC-5「消除过期 running 残留」的落点,零测。
- **AC-4 路径②**:`readoptHost` 路径②(session.list 有本地无 inst → 重建 tab)由 T-036 单测覆盖(注入 `rebuildTab`),**但生产默认接线把它 stub 死**:`reconnectWiring.ts:38-41` `rebuildTab: () => null`(注释「由里程碑整合方补」)。→ 「BL-004 已 disposeTerminal / tab 已关」后重连的**发现-重建**在生产不生效。常见重连(AC-15 抑制 drop → inst 存活 → 路径①)不受影响,故 MINOR;但 TC 把 T-036 记为 AC-4 ✅ 覆盖,而生产未接线。

建议:里程碑整合时接上 `rebuildTab` + `tab.exited`,并对 `reconnectWiring.reconcileBadge` 补一条真断言(非注入 spy)。

---

### Q4 — 心跳/退避 env **覆盖读取路径**未测(只测了缺省回退) · **MINOR · open**

AC-13/AC-6 声明「周期/超时/预算 env 可注入」。但:
- `heartbeatDetect.test.ts:90-94` 只测 `readHeartbeatEnv()` **缺失 env → 回退 5s/5s**,从不设 `TERMPRO_HEARTBEAT_INTERVAL_MS` 断言覆盖生效。
- `reconnectBackoff` 的 `readReconnectBudgetEnv()` 覆盖路径同样无测。
- 对照:`ssh.test.ts:48-52` 就真测了 `TERMPRO_SSH_KEEPALIVE_MS` 覆盖 —— 心跳/退避该同等对待。

cfg 构造注入本身已测(Heartbeat/ReconnectBackoff 都吃 cfg),真实断线检测提速靠它;env→cfg 的 read 函数是薄封装,故 MINOR,但「env 可注入」的字面承诺未被覆盖路径证实。

---

### Q5 — T-032 双写记账:fake `term.write` 同步回调,未区分「同步累加 vs write 回调累加」(双写根因) · **NIT · open**

D-4 双写根因是「renderedBytes 若在 write 回调里累加,attach 时在途未回调 chunk 会被 host 重放」。`ingestPtyData` 的修法是 `renderedBytes += bytes` **同步**在 `term.write` 之前(`terminalRegistry.ts:296-297`)。但 T-032 test-2 的 fake `term.write` **同步调 cb**(`terminalRegistryReadopt.test.ts:40-43`)→ 一个「在 write 回调里累加」的错误实现**也会过**该测。真正钉死同步性的是 test-3(nextOffset 权威 250≠101),间接兜底;同步-vs-回调这一维未被判别。NIT(有 test-3 + code review 兜底)。

---

### Q6 — 手动 kill 存活 standalone 会话「彻底删除(不留 exited)」未被判别 · **NIT · open**

`ptyPool.kill` 对 live 会话置 `evicting=true` → onExit 走「delete 不转 exited」分支(`ptyPool.ts:169,227-228`)。T-017(`reconnectContinuity.integration.test.ts:277-280`)kill 后只断言 `pid===null` —— 但 exited 与 deleted **都返 null**,不可区分;后续 spawn 成功在两种情形下都成立(deleted 腾位 / exited 被 evictOldestExited 逐)。故「手动 kill 不留 exited 残条目」这一 evicting 分支语义未被真断言。NIT。

---

## AC 覆盖真实性对照(14/14)

| AC | host/纯逻辑侧 | 渲染半侧 | 判定 |
|----|------|------|------|
| AC-1 | T-001/002 真跑绿(续跑+旁路流控+复活) | — | ✅ 真 |
| AC-2 | T-003/004 真跑绿(embedded kill+无 ring) | — | ✅ 真 |
| AC-3 | T-005/006/007/008 真断言 | T-032 真断言(CJK bytes/nextOffset) | ✅ 真(Q5 NIT) |
| AC-4 | T-009/010 真跑绿 | T-036 单测真,但生产 rebuildTab stub | ⚠️ Q3 MINOR |
| AC-5 | T-011/012 真断言 | T-034 只证 hook 被调,真 reconcileBadge 无测 | ⚠️ Q3 MINOR |
| AC-6 | T-013/014 真断言 | — | ✅ 真(Q4 MINOR env) |
| AC-8 | T-015/016/038 真断言 | T-038 renderer 半侧真 | ✅ 真 |
| AC-9 | T-017/018/037 真跑绿 | — | ✅ 真(Q6 NIT) |
| AC-10 | T-019/020 真断言 | — | ✅ 真 |
| AC-11 | T-021/022/033 真跑绿 | T-033 真断言 | ✅ 真 |
| AC-12 | T-023/024/025/039 真跑绿(host 保留+回放) | **T-035 幽灵(死字段+空 hook)** | ❌ **Q2 MAJOR** |
| AC-13 | T-026/027 真断言(有界 T) | — | ✅ 真(Q4 MINOR env) |
| AC-14 | T-028/029 真跑绿(否定断言) | — | ✅ 真 |
| AC-15 | controller 侧 T-030/031 真断言 | **Sidebar 900ms 闸测的是死助手** | ❌ **Q1 MAJOR** |

---

## 放行条件

关掉 Q1 + Q2(两 MAJOR):把被测的 seam 真接进生产(或对生产内联路径补真断言),使 AC-15 Sidebar drop 闸与 AC-12 已完成徽标的**生产路径**被测覆盖。Q3/Q4 建议同批处理(里程碑整合)。Q5/Q6 可延后。
