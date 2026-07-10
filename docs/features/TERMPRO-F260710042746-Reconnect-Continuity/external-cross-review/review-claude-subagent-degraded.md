---
verdict: APPROVE
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: subagent-fallback
degraded_reason: "项目 localconfig disable_external_review=true 单模型 opt-out·无异质跨模型源·降级同模型(opus)隔离 subagent 冷审兜底(BL-003/004 同基线)"
review_via: subagent
feature_id: TERMPRO-F260710042746-Reconnect-Continuity
review_scope: review
reviewed_at: "2026-07-10"
---

# BL-005 复验（review 阶段·代码修复态）

复验对象：上轮 NEEDS_REVISION 的 2 BLOCKER + 3 MAJOR（A1/A2/A3/Q1）+ 附带 E1/E2/E3。逐条读真码 + 对应被测 seam 交叉核，判 resolved / 仍缺。结论：**全部 resolved，核心 sound → APPROVE**。未发现修复引入的新缺口。

---

## A1 · BLOCKER（终端冻结）— RESOLVED

**要判**：readopt 是否已从 main 'ready' 事件解耦，改由 `client.reconnect().then` 驱动 `onReconnected`；ready useEffect 是否只留 workspace 发现 + onReconnectNeeded；初次连接是否 no-op 守卫。

**依据（真码）**：
- `Sidebar.tsx:252-265` beginHandshake 的 `client.reconnect({wsUrl}).then(...)` 内先 `applyRuntimeEvent(ready)` 再 `reconnectController.onReconnected(configId)` —— 收养由 **reconnect promise resolve**（ws 真 open·transport 就绪）驱动。
- `Sidebar.tsx:302-325` ready useEffect **不再** readopt，只保留 `startRemoteWorkspaceSync` + `onReconnectNeeded` 订阅（注释明确标注 A1 解耦）。
- `reconnectController.ts:130-138` `onReconnected` 读 `wasReconnecting = isReconnecting`，cleanup 后**仅当** wasReconnecting 才 `readopt`；初次连接 wasReconnecting=false → 廉价 no-op（cleanup 的 setReconnecting(false) 幂等无害）。
- 被测 seam：`SidebarReconnect.test.tsx:140-165` 精确断言「verifying→reconnect(pending) + main 'ready' 到达 → onReconnected **未**被调；reconnect resolve 后**才**收养」——正是 A1 的因果。删掉解耦即变红。

判定：readopt 已钉死在 transport 就绪之后，冻结根因消除。**resolved**。

## A2 · BLOCKER / E1（永卡重连中）— RESOLVED

**要判**：`onAttemptFailed` 是否有生产调用方（beginHandshake `.catch` + onEvent `failed && isReconnecting`）；退避重试循环 + 超预算→definite→stopRemoteWorkspaceSync 是否真能到达。

**依据（真码）**：
- 生产调用方①：`Sidebar.tsx:266-276` reconnect `.catch` → `reconnectController.onAttemptFailed(configId)`。
- 生产调用方②：`Sidebar.tsx:282-294` onEvent `stage==='failed' && isReconnecting(...)` → `onAttemptFailed`（isReconnecting 守卫使初次连接失败不误入状态机）。
- 循环可达：`reconnectController.ts:110-128` onAttemptFailed → overBudget? definite : 退避 timer→`fireAttempt`；`fireAttempt`(82-93) 再判 overBudget→`definite`，否则 `nextDelayMs`(推进计数)+disconnect-first+connect。`definite`(95-98) → cleanup + `stopSync`（drop 唯一出口）。
- 幂等健壮性（额外核）：onAttemptFailed 本身不推进 attempt 计数（仅 peek + 重排 timer，clearPendingTimer 先清旧），计数只在 fireAttempt 推进 → 即便两个调用方对同一逻辑尝试双触发，也只重排 timer、不重复消耗预算。无新竞态。
- 被测 seam：`reconnectSuppressDrop.test.ts:115-149`（T-031·budget=3）真实推进 fake timer 走到超预算 `stopSync` + 清 reconnecting，且断言 drop 后无悬挂计时器；`SidebarReconnect.test.tsx:167-196` 断言两个生产调用方 + 守卫。

判定：onAttemptFailed 不再是死代码，退避→超预算→full drop 全链真可达。**resolved**。

## A3 · MAJOR（AC-12 徽标）— RESOLVED

**要判**：reconcileBadge 是否据 `snapshot.status==='exited'` 落 `tab.exited + exitCode`；TabState/TabBar 链路是否通。

**依据（真码）**：
- `reconnectWiring.ts:25-40` reconcileBadge：`exited = snapshot.status==='exited'`，`updateTab` 落 `{activity, ...(exited ? {exited:true, exitCode} : {})}` —— exited 单调终态，live 快照不回写 false（不抹已亮徽标）。
- 落点真接线：`terminalRegistry.readoptHost` path①/② 都调 `reconcileBadge(configId, sid, snapshot)`（:447/:481），reconnectWiring 把它作为 hook 注入 `readoptHost`（:51-61）。
- store：`store.ts:32-34` TabState 有 `exited?/exitCode?`；`updateTab`(:638-645) 浅合并 patch，非 exited 快照只改 activity、保留既有 exited（不 clobber）——已核。
- TabBar：`TabBar.tsx:199` `tab.exited` → `tabbar-tab--exited`；:210-216 渲染 `exit N` / `exited` hint。链路通。
- 被测 seam：`reconnectWiring.test.ts:64-115` 直驱真实 reconcileBadge，断言 store `tab.exited/exitCode/activity` 真落地（exit 0 / exit 1 / live 不误置 / findTab miss 不误改同名本机 tab）——非注入 spy 的幽灵覆盖，删 exited 分支或 findTab 接线即变红。

判定：北极星「断线期 build 跑完·重连见 ✓ exit N」渲染半侧真接线闭合。**resolved**。

## Q1 · MAJOR（drop gate 测盲）— RESOLVED

**要判**：Sidebar 900ms drop 是否走被测 seam `scheduleDropUnlessReconnecting`（生产路径被真断言）。

**依据（真码）**：
- `Sidebar.tsx:347-361` disconnected 分支调**导出函数** `scheduleDropUnlessReconnecting(configId, {isReconnecting, stopSync, delayMs})` —— gate 逻辑不再内联匿名。
- `reconnectController.ts:163-175` seam：reconnecting → 返 null（不排 drop·抑制 AC-15 full drop）；否则排 delayMs timer → stopSync。
- 侧路加固：`Sidebar.tsx:379-386`（A5）reconnecting 置真时主动清已排 drop timer，闭合「main disconnected 先于心跳判死到达」竞态。
- 被测 seam 双层：`reconnectSuppressDrop.test.ts:73-100` 直测 `scheduleDropUnlessReconnecting`（reconnecting→null→advance5s 不 stopSync / 非 reconnecting→900ms→stopSync）；`SidebarReconnect.test.tsx:198-249` 在 **Sidebar 组件生产路径**（真渲染 + applyEvent disconnected + advanceTimers）断言同一行为 + A5 race。生产路径真断言，非死助手。

判定：drop gate 生产路径已被真测覆盖。**resolved**。

## E2 · RemoteHostsPage.beginHandshake 改 reconnect() — RESOLVED

**依据**：`RemoteHostsPage.tsx:190-191` `client.reconnect({wsUrl})`（注释标 E2·硬门④ 另半边），与 Sidebar 同口径——重连 main re-emit verifying{tunnel} 时不命中陈旧 connectPromise。`hostClient.reconnect`(:253-275) 复位 connectPromise/down、关旧 transport（tearingDown 抑制 onClose 分叉）、reconnectPromise 并发再入守卫齐备；初次 connectPromise=null 时复位是 no-op 等价 connect。注：RemoteHostsPage 不调 onReconnected（合理——readopt 单一 owner = 常驻挂载的 Sidebar，共享同一 reconnectPromise 的 .then 保证被驱动，不双收养）。**resolved**。

## E3 · path② rebuildTab 显式 defer — RESOLVED（defer 合理）

**依据**：
- `reconnectWiring.ts:53-61` `rebuildTab: () => null` 显式返 null，注释详述理由并指向 PENDING-006（非静默 stub）。
- `readoptHost` path② 逻辑俱在（terminalRegistry:450-482），rebuildTab 返 null 时 `continue` 跳过——生产禁用但代码 + 单测 T-036（`terminalRegistryReadopt.test.ts:231-262`）在，接 store 建 tab 路径即启用。
- 登记：`product-overview/PENDING.md` PENDING-006 明确登记（session→workspace 映射 + addTab 返 tabId 的接线缺口·牵扯大于极小复用·状态 📝·2026-07-10）。
- 合理性核：常态重连由 AC-15 抑制 drop → inst 存活 → path① 覆盖北极星（build 跑完重连见徽标）。path② 仅命中「断开期关过 tab / 曾 full-drop 后重连」边缘。v1 defer 带明确北极星覆盖论证 + 登记 + 保留逻辑与测试，符合 defer 纪律。**resolved（defer 合理）**。

---

## 总结

上轮 2 BLOCKER（A1 终端冻结 / A2 永卡重连）+ 3 MAJOR（A2 循环 / A3 徽标 / Q1 drop 测盲）+ E1/E2/E3 逐条复验：
- A1/A2/A3/Q1/E2 —— 生产接线补齐 + 生产路径真测覆盖（非注入 spy 幽灵覆盖），删修即变红；
- E3 —— 显式 defer + PENDING-006 登记 + 北极星由 path① 覆盖，合理。

交叉核未发现修复引入的新缺口：onAttemptFailed 双触发只重排 timer 不重复消耗预算；onReconnected 初次连接 no-op 守卫真闭合；A5 侧路清 timer 使 drop gate 竞态闭合；reconcileBadge exited 单调不 clobber。核心 sound。

无 open BLOCKER/MAJOR → **APPROVE**。可进 test。
