---
review_model: sonnet
review_via: subagent
files_read:
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/external-review-prompts/review-subagent-fixverify-20260805T143323Z.md
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/REVIEW.md
  - src/renderer/state/remoteHostStore.ts
  - src/renderer/components/Sidebar.tsx
  - src/renderer/services/hostClient.ts
  - src/renderer/components/settings/RemoteHostsPage.tsx
  - src/renderer/components/MachineGroup.tsx
  - src/renderer/components/Sidebar.css
  - src/renderer/state/__tests__/remoteHostStoreAbandonGate.test.ts
  - src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
  - src/renderer/components/__tests__/SidebarReconnect.test.tsx
  - src/renderer/components/settings/__tests__/RemoteHostsPage.test.tsx
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/TC.md
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/TECH.md
  - src/main/remote/remoteHostIpc.ts
  - src/main/remote/orchestrator.ts (§disconnect/connect 片段)
  - src/renderer/services/hostRegistry.ts (forHostId/drop/getOrCreateRemote 片段)
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/review-log.jsonl
  - project-specs/test-baseline.md
target_commit: d51c1a4
coverage: [F1-F10 修复裁决, 修复 diff 新问题审查, 新增测试的有效性]
---

# 验证轮冷审 —— OKWORK-F260805033051 review round 1 修复

基线:`git diff 66ddeb2~1..d51c1a4`(= `d1d75d9..66ddeb2` 的修复内容 + `d51c1a4` 的红基线登记)。只裁决上一轮 10 条 open finding + 审查修复 diff 本身。

## 逐条裁决

### F1 · BLOCKER · **fixed**

`src/renderer/state/remoteHostStore.ts:243-266`(`requestConnect`)—— `resume` 移到 `fulfill()` 内部，与 `fire()` 同步紧邻，中间无 await：

```ts
function fulfill(): void {
  if (!connectIntent.delete(configId)) return; // 意图已被撤销(用户改主意断开了)
  useRemoteHostRuntimeStore.getState().resume(configId); // 🔴 与下一行同步紧邻,勿拆开
  fire();
}
```

判据确认已从 `isAbandoned` 换成 `connectIntent`：`connectIntent.add()` 在 `requestConnect` 首行，删除只发生在两处——`fulfill()` 成功路径（`:250`）与 `abandon()`/`forget()`（`:126`/`:158`，见下）。逐路径核对「进得去出不来」：

- 无 pending 断开 → 同步 `fulfill()`，`add`→`delete` 同一 tick 内完成，不泄漏。
- 有 pending 断开 → `Promise.race([pending, timeout])`，无论谁赢都进 `.then()` 调 `fulfill()`；`fulfill()` 内 `delete` 要么成功触发 resume+fire，要么因已被 `abandon()` 撤销而提前 return——两条路径都清掉了 `connectIntent`。
- `abandon(configId)`（`:126`）、`forget(configId)`（`:158`）都显式 `connectIntent.delete(configId)`。

`Sidebar.tsx:558-560` `handleConnectMachine` 与 `RemoteHostsPage.tsx:333-339` `handleConnect` 均已改走 `requestConnect(...)`，旧的「resume 是首行语句」模式已删除（grep 确认 `resumeMachine`/`pendingDisconnectRef` 在 Sidebar.tsx 零残留）。

判 fixed。

### F2 · MAJOR · **fixed**

`abandon()`（`remoteHostStore.ts:120-127`）与 `forget()`（`:156-159`）都新增 `handshaking.delete(configId)`。`handleUpgrade`（`RemoteHostsPage.tsx:373-374`）额外显式调 `endHandshake(config.id)`——升级路径走 `resume` 不走 `abandon`，abandon 的自动清除够不到它，靠这行补上，注释也说明了原因，读码属实。

顺序核对（「先查弃用、后占槽」）：
- `Sidebar.tsx:280-284`：`if (isAbandoned(...)) return; if (!tryBeginHandshake(...)) return;`
- `RemoteHostsPage.tsx:225-232`：同序。

两个入口都改了。Sidebar 无 upgrade 路径（grep 零命中），故 F2 的三个受影响入口（Sidebar 连接、设置页连接、设置页升级）全部闭合。

判 fixed，测试 T-038e/T-038g 覆盖有效（见下）。

### F3 · MAJOR · **fixed**

`hostClient.ts:119` 新增 `connectingWs` 字段。三条落定路径全部释放：
- `onopen`（`:477-480`）：`releaseConnecting()` 后才 `attachTransport`。
- `onerror`（`:472-475`）：`clearTimeout` + `releaseConnecting()`。
- 10s 超时（`:462-470`）：`ws.close()` 后 `releaseConnecting()`。

两条 teardown 路径调用：`dispose()`（`:413-416`）、`reconnect()`（`:368-370`，在 `this.connect(opts)` 重新 new ws **之前**调用，不会误清新 ws 的引用）。

`closeConnectingWs` 是否误杀已服役 ws：`onopen` 处理器在 `attachTransport` 之前先执行 `releaseConnecting()` 把 `this.connectingWs` 置回 `null`，所以一旦 ws 真正 open 并转交给 `transport` 管理，`closeConnectingWs` 后续调用直接因 `!ws` 早退，不会碰它。逻辑闭合，无自伤路径。

闸③/⑥ 收尾：`Sidebar.tsx:264-273`（`disposeHandshakeClient`）与 `RemoteHostsPage.tsx:249-252`/`:263-266` 都改成对**捕获的 client** 判断：`hostRegistry.forHostId(configId) === client` 为真才走 `hostRegistry.drop`，否则直接 `client.dispose()`——按 id 查表的两种失灵（提前被删=no-op、已换新代=误杀）都被绕开。

判 fixed。

### F4 · MAJOR · **fixed**

两个入口都走 `requestConnect`（`Sidebar.tsx:559`、`RemoteHostsPage.tsx:338`）。

设置页断开顺序核对（`RemoteHostsPage.tsx:349-358`）：

```
abandon(id); reconnectController.cancel(id); clearRuntime(id); hostRegistry.drop(id);
trackDisconnect(id, window.okwork.remoteHost.disconnectAwait({ id }));
```

修复前（`66ddeb2~1`）的顺序是 `abandon → cancel → IPC(disconnect) → clearRuntime → drop`——IPC 发送夹在本地拆除**中间**。修复后 IPC（现为 `trackDisconnect`）挪到全部四步本地拆除之后，即**更严格地**保证本地先行，不是破坏而是收紧了这条不变式（`disconnect`/`disconnectAwait` 都是 fire-and-forget，不 await，同 tick 内的顺序调整不引入新的竞态）。

判 fixed。

### F5 · MINOR · **fixed**

`trackDisconnect`（`remoteHostStore.ts:214-227`）的 `.finally()`：

```ts
.finally(() => {
  if (pendingDisconnects.get(configId) !== p) return; // 已被更晚的一次断开取代 → 不动它的态
  pendingDisconnects.delete(configId);
  useRemoteHostRuntimeStore.getState().setSettling(configId, false);
});
```

`=== p` 守卫现在**同时**护住 map 删除与 `setSettling(false)`（早退直接 return，两行谁都不执行）——F5 指出的「守卫只护住了 map 删除」已不成立。判 fixed，T-038f 验证有效。

### F6 · MINOR · **fixed**

`Sidebar.tsx:220-223`（轮询清理分支）与 `RemoteHostsPage.tsx:475-478`（`confirmDelete`）都已删掉紧邻 `forget()` 前的冗余 `clear()`/`clearRuntime()` 调用。核对 `forget()`（`remoteHostStore.ts:156-181`）实现：五张表（`abandoned/runtime/rtt/reconnecting/settling`）全删，是 `clear()`（只删 `runtime/reconnecting/rtt/settling` 四张,不动 `abandoned`）的严格超集，删掉前置 `clear()` 不丢失任何清理效果。判 fixed。

### F7 · MINOR · **fixed**

`TC.md` 新增横幅（diff 已核）：「本表是『规格覆盖率』，不是『已实现覆盖率』」+「规格 38 条，已实现 1 条」，并把原先容易读成「已完成」的「覆盖率 15/15・测试总数 38」改写为「规格覆盖率 15/15・规格用例总数 38」。判 fixed。

### F8 · NIT · **fixed**

`TECH.md` §完工自查：
- 行号引用改「文件·符号名」（如 `remoteHostStore · requestConnect`），并附一句解释为什么弃用行号（「首版填的行号在后续两轮修复后集体漂移 7-8 行……比写『大概在那附近』更糟」）。核对表格新内容（D/E 两行）与实际代码一致：`DISCONNECT_QUEUE_TIMEOUT_MS` 确实在 `remoteHostStore.ts` 同文件；`RemoteHostsPage.tsx:369` `handleUpgrade` 确实仍直接调 `resume`（未走 `requestConnect`），与表格「第三个入口……仍直接 resume」的表述吻合。
- AC-13 行新增订正：「测试尚未落地」+ 把「TC-029 已同步加断言防回归」的失真表述改写为如实陈述规格与实现的差距。

判 fixed。

### F9 · NIT · **fixed**

`Sidebar.css`：`.sidebar-machine-connecting` 规则整块删除（原 `:681`附近的独立规则），且从两处 `:is()`/组合选择器中移除（原 `margin-left: auto` 组、原 `~` 兄弟选择器组）。grep 确认 `.sidebar-machine-connecting` 在改动后的 CSS 文件中零残留。判 fixed。

### F10 · NIT · **fixed**

**8s 计时器清理**：`requestConnect`（`remoteHostStore.ts:257-262`）在 `Promise.race(...).then()` 内部统一 `if (timer !== undefined) clearTimeout(timer);`——不论 `pending` 赢还是超时赢，都会执行到这行（超时赢时 `clearTimeout` 对已触发的计时器是 no-op，无害）。额外验证了并发双击场景：两次 `requestConnect` 各自持有独立的 `timer`/`fulfill` 闭包，第二次的 `fulfill` 会因 `connectIntent` 已被第一次消费而提前 return，但其自身的 `Promise.race` 仍会照常结算并清自己的 `timer`，不会遗留。

**三个连接钮分支合并**：`MachineGroup.tsx` 逐一核对合并前后条件与文案：

| 原分支 | 条件 | label |
|---|---|---|
| foldedLost | `!runtime && machine.foldedLost` | Reconnect |
| disconnected | `!runtime && !foldedLost && status==='disconnected'` | Connect |
| lost | `!runtime && !foldedLost && status==='lost'` | Connect |

合并后：`!runtime && (foldedLost || status==='disconnected' || status==='lost')`，`label = foldedLost ? Reconnect : Connect`。三个原始分支互斥（`foldedLost`/`disconnected`/`lost` 不可能同时为真的三态），逻辑或等价于原三分支之并，label 映射逐值对齐（`foldedLost→Reconnect`，另两态→`Connect`）。**未改变任何一态的渲染结果**。判 fixed。

## 新增测试有效性（`remoteHostStoreAbandonGate.test.ts`，7 条）

逐条做了「删掉对应生产代码守卫会不会变红」的反证：

| 测试 | 锁住的守卫 | 拆除该守卫后是否变红 |
|---|---|---|
| T-038a | `fulfill()` 内 `resume` 移到兑现点（而非首行） | 会红——若 `resume` 挪回 `requestConnect` 首行，`isAbandoned` 会在排队期间就变假，第 3 步 `expect(isAbandoned).toBe(true)` 直接失败 |
| T-038b | `fulfill()` 内 `if (!connectIntent.delete(...)) return;` | 会红——去掉该判断后 `fire` 会被无条件调用，`expect(fire).not.toHaveBeenCalled()` 失败 |
| T-038c | 无 pending 时同步兑现 | 会红——若改成永远排队（不判断 `pending` 是否存在），`fire` 不会同步调用 |
| T-038d | `DISCONNECT_QUEUE_TIMEOUT_MS` 8s 上界 | 会红——去掉超时分支后 `neverResolves` 永不 settle，`fire` 永远不被调用，`toHaveBeenCalledTimes(1)` 断言超时失败 |
| T-038e | `abandon()`/`endHandshake()` 清 `handshaking` | 会红——若 `abandon()` 不清槽，`abandon` 后 `tryBeginHandshake` 仍会因槽被占返回 `false`,`result3` 断言失败 |
| T-038f | `trackDisconnect` 的 `=== p` 守卫同时护住 `setSettling(false)` | 会红——若守卫只护 map 删除（F5 修复前的写法），resolve p1 时 `settling` 会被无条件清掉,`expect(settling[c1]).toBe(true)` 在第一次 resolve 后即失败 |
| T-038g | `forget()` 清五张表 + `handshaking` | 会红——若 `forget()` 不清 `handshaking`,`canBeginAgain` 断言失败;若不清五张表任一张,对应 `in state.xxx` 断言失败 |

7 条全部是真断言，非假绿。`beforeEach` 正确调用 `__resetRemoteHostOrchestrationForTest()` 清模块级容器（不在 zustand state 里，`setState` 清不掉这点在源码注释和测试文件都对得上）。

## 修复 diff 本身引入的新问题审查

未发现 BLOCKER/MAJOR 级新问题。发现一条值得记录但不阻塞的 gap：

**NF-1 · MINOR（非新增，但值得登记）—— `requestConnect` 对 `pending` 缺 `.catch`，若断开 IPC 真的 reject 则连接意图永久卡死**

`remoteHostStore.ts:243-262`：

```ts
const pending = pendingDisconnects.get(configId);
...
void Promise.race([
  pending,
  new Promise<void>((r) => { timer = setTimeout(r, DISCONNECT_QUEUE_TIMEOUT_MS); }),
]).then(() => {
  if (timer !== undefined) clearTimeout(timer);
  fulfill();
});
```

`pending` 是 `trackDisconnect` 存进 `pendingDisconnects` 的**原始** `p`（`disconnectAwait()` 返回的 promise），不是套了 `.catch()` 的那条派生链（`trackDisconnect` 内部的 `p.catch(...).finally(...)` 是另一条独立链，不会改变 `p` 自身的落定状态）。若 `p` 真的 reject（`disconnectAwait` → `ipcMain.handle` → `orchestrator.disconnect()` 抛出未捕获异常），`Promise.race([pending, timeout])` 会跟着 reject，而 `.then(callback)` 没有第二参数/`.catch`——`fulfill()` **不会被调用**，`connectIntent` 里那次点击留下的条目永久卡住（直到下一次 `abandon`/`forget` 才被动清掉），且产生一条未处理的 promise rejection。

范围裁决：读了 `orchestrator.ts:414-449` 的 `disconnect()`，其内部关键副作用（`closeSessionTransport` 里的 `socksServer.close()`/`forwardServer.close()` 等）都各自 try/catch 包裹，目前看不出真实可达的 reject 路径——**这条 gap 目前更多是防御性缺口，不是已验证可复现的 bug**。且这个「`Promise.race` 里裸放 `pending` 不加 `.catch`」的写法在 round 1 修复**之前**的 `Sidebar.tsx handleConnectMachine`（`66ddeb2~1`）里就已经是这个样子（原样照抄进了新的共享函数），不是本轮修复新引入的行为回归。按验证轮纪律登记为观察项，不计入本轮 verdict 的阻塞项；建议后续给 `pending` 补一个 `.catch(() => undefined)` 再进 race，行为上与「视为已收尾/直接放行」一致，成本很低。

其余检查（无发现）：
- 未见新增的悬空引用（`resumeMachine`/`pendingDisconnectRef`/`setSettlingMachine`/`forgetMachine`/`handshakingRef`/组件内旧 `DISCONNECT_QUEUE_TIMEOUT_MS` 常量在 `Sidebar.tsx`/`RemoteHostsPage.tsx` grep 零残留）。
- Sidebar 相关测试文件（`SidebarMachineGroups.test.tsx`/`SidebarReconnect.test.tsx`）未 mock `disconnectAwait`，若这两个文件里有测试真去点「断开」按钮会 TypeError——但 grep 确认这两个文件里**没有**任何 `fireEvent.click` 命中断开按钮的用例，这条已知坑（TECH.md K 行已如实登记为 test stage 欠账）当前不会被触发,不算本轮引入的回归。
- `RemoteHostsPage.test.tsx` 已补 `disconnectAwait: vi.fn(() => Promise.resolve())` mock,两处断言从 `bridge.disconnect` 改为 `bridge.disconnectAwait`,与生产代码改动对齐。

## 未能验证项

- 未真实起 IPC/main 进程验证 `disconnectAwait` 的 reject 可达性（NF-1 的范围裁决基于静态读码，非动态验证）。
- 未重跑测试;沿用引用的既有实跑证据(`/private/tmp/teamwork/OKWORK-F260805033051-Remote-Connection-Controls/vitest3.log`:1728 passed/3 failed,三条失败均在 `src/host/`,已按 GO-036 登记进 `test-baseline.md` 并三次独立重跑验证与本 Feature 无关)。
- 像素级/真实 AT 验证不在本轮范围,沿用上一轮登记的边界。

## Verdict

**APPROVE**

10 条 open finding(1 BLOCKER + 3 MAJOR + 2 MINOR + 4 NIT)逐条读码核实,全部 fixed,无 partially-fixed。新增的 7 条回归测试逐条做了「拆守卫会不会变红」验证,全部有效、非假绿。修复 diff 本身未引入 BLOCKER/MAJOR 级新问题;发现一条非阻塞的 MINOR 观察项(NF-1),已如实登记但不改变 verdict。
