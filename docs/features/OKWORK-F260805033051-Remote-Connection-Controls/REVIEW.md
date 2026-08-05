---
reviewers: [architect, external]
verdict: NEEDS_REVISION
coverage:
  architect: "实现↔设计一致性(抽查 §完工自查 A1–J3 逐条打开对应行核对 · ✅ 实质名副其实 · 仅行号漂移与一处表述失真 → F8)/ 简洁性 counter-lens(认真找过两道闸+七接线点能否收敛 —— **不能**,非过度设计;真正可删的是 F6/F9/F10)/ 并发竞态(五条已枚举通道逐条走完 + 另查 syncedHosts/rttWired/reconnectWired/panelTimers/退避计时器/manualRetry 绕闸 —— 各有守卫查过无发现;**找到第八条通道 → F1**,外加不在闸单里的状态 → F2)/ 资源泄漏(IPC handler 闭合、订阅按 client 实例 WeakSet 键控 —— 查过无发现;**ws+心跳有真泄漏路径 → F3**;8s race 计时器未清 → F10)/ 状态机不变式(abandoned 2 置/3 解/2 销与生命周期表一致 · settling finally 恒清 —— 均闭合查过无发现;唯一「进得去出不来」是 handshakingRef → F2)"
findings:
  - {id: F1, severity: BLOCKER, status: open, title: "resume 在排队之前就开闸,被取消的编排残余事件把连接真做成(AC-6 逐字失败)", source: arch}
  - {id: F2, severity: MAJOR, status: open, title: "handshakingRef 去重槽不被 abandon/drop 作废,握手不落定则新隧道永远开不了 ws", source: arch}
  - {id: F3, severity: MAJOR, status: open, title: "dispose 关不掉未 open 的 ws · 闸③的 hostRegistry.drop 可能是 no-op(孤儿 ws+心跳)", source: arch}
  - {id: F4, severity: MAJOR, status: open, title: "设置页无排队保护,跨入口复现 AC-13「点了没反应」", source: external}
  - {id: F5, severity: MINOR, status: open, title: "第二次断开在途时,前一次的 finally 无条件清掉 settling", source: external}
  - {id: F6, severity: MINOR, status: open, title: "forget 扩成删五张表后,紧邻的 clear(id) 冗余(两次 set = 两次渲染)", source: arch}
  - {id: F7, severity: MINOR, status: open, title: "TC.md 仍写「覆盖率 15/15 · 测试总数 38」,未标注 0 条已实现", source: external}
  - {id: F8, severity: NIT, status: open, title: "TECH §完工自查 C/D/E 行号漂移 + 「TC-029 已同步加断言防回归」表述失真", source: arch}
  - {id: F9, severity: NIT, status: open, title: ".sidebar-machine-connecting 已成死 CSS 却被新加进 :is() 选择器", source: arch}
  - {id: F10, severity: NIT, status: open, title: "8s race 的 setTimeout 在 pending 先赢时不清 · 三个连接钮分支同构可收敛", source: arch}
  - {id: F11, severity: NIT, status: rejected, title: "busy 态无 aria-live 包裹", source: external}
---

# Code Review — 远程机组头连接控件重构

- 评审基线:`git diff 7d2dc6c..d1d75d9`
- 两路独立起草 · 互不喂 verdict:**architect**(继承会话主模型 Opus 5)· **external**(sonnet · 错开一档 · 产物 `external-cross-review/review-sonnet.md`)
- 测试证据引用(未重跑 · 硬规则 9):`/private/tmp/teamwork/OKWORK-F260805033051-Remote-Connection-Controls/vitest2.log` = 1724 passed / 0 failed / 6 skipped · typecheck 干净 · SMOKE_OK

## §coverage 申报(主审路逐角色 · 防橡皮图章)

**architect 覆盖**(五方向逐条):

- **实现↔设计一致性** —— 抽查 §完工自查 A1–A5 / B1–B7 / C / D / E / F / G / H1–H3 / I1–I2 / J1–J3,逐条打开对应行核对:表里的 ✅ **实质名副其实**(闸都在 · 断开四步确实同步先行 · `setReconnecting` 确实只挡置真 · `reconnectWiring.ts:24` 确实仍是裸 IPC · teardown 确实补了 `removeHandler`)。问题只有行号漂移 + 一处「防回归」表述失真 → **F8**。
- **简洁性 counter-lens** —— 认真找过两道闸 + 七接线点能否收敛:**不能,不是过度设计**(闸③是唯一拦得住 `manualRetry` 的那道;另两道各一行的纵深防御,删了反而更难兜 F1)。真正可删的是 **F6/F9/F10**。
- **并发竞态** —— 五条已枚举通道逐条走完;另查 `syncedHosts` / `rttWired` / `reconnectWired` / `panelTimers` / `startRemoteWorkspaceSync` 重试循环 / 退避计时器 / `manualRetry` 绕闸:**这些各自有守卫,查过无发现**。**找到第八条通道 → F1**,外加一条不在闸单里的状态 → **F2**。
- **资源泄漏** —— IPC handler 闭合(查过无发现)· 订阅按 client 实例 WeakSet 键控(查过无发现)· **ws + 心跳有真泄漏路径 → F3** · 8s race 计时器未清 → F10。
- **状态机不变式** —— `abandoned`(2 置 / 3 解 / 2 销,与生命周期表一致)与 `settling`(finally 恒清)**均闭合,查过无发现**。唯一「进得去出不来」的是 `handshakingRef` → **F2**。

**external 覆盖** —— 见 `external-cross-review/review-sonnet.md` 的 `coverage:` 申报(测试真实性与覆盖 / 代码质量盲区〔错误处理·日志·并发〕/ a11y〔自选方向〕)。

## §finding 汇总(逐条裁决依据)

> 裁决纪律:每条**先假设不成立**,回读真实代码核实,再定 confirmed/rejected。采纳与驳回**都记实证**。

### F1 · BLOCKER · confirmed —— 排队推迟了出向 IPC,却没推迟入向闸门的开启

**质疑**:排队机制刚补过 gate 7(兑现前复查弃用),会不会已经覆盖?
**回读**:没有。`Sidebar.tsx:553` `resumeMachine(id)` 是 `handleConnectMachine` **第一条语句**,而 IPC 要等 `disconnectAwait` 结算(≤5s)或 8s 上界才发。这中间**四道闸全开**,而被取消那次的 `runConnect` 一行没停 —— `orchestrator.disconnect()` 只是 `await Promise.race([pending, sleep(5s)])`(`orchestrator.ts:419-421`),它**不中断**在途编排(该行注释自己写明「在途编排不安全中断,best-effort 等它自然结束」)。

**失败时序**(deploying 态):
1. t=0 点取消 → `abandon` + 本地拆除 + `disconnectAwait`(main 开始等在途 connect)
2. t=0.5s 点连接(该钮按设计可点)→ `resume` 使闸全失效 → connect 排队中,尚未发出
3. 残余 `claiming/verifying/ready` 到达 → `applyEvent` 照单全收 → 组头**变绿「已连接」**;`verifying` 真触发 `beginHandshake` 对**旧隧道**开 ws 并把连接建成 → 灌 workspace + 收养会话
4. main 的 disconnect 醒来把它拆掉 → 红点 → 900ms → `dropHostWorkspaces`
5. 若那次握手以 reject 收场 → 写 failed → **弹一条假的「连接失败」toast**(`applyEvent` 与 toast effect 的 `!isAbandoned` 此刻全为假)

**AC-6 三句逐字全中**(不被复活 / 不得因残余 verifying 建成连接 / 不得因残余 failed 弹 toast)。

**根因**:所有闸压在 `abandoned` **一个布尔**上,而它同时承担「拒收上一代残余」与「接受下一代意图」两个**不能共存**的语义。
**印证同源**:gate 7 所描述的触发路径(settling 期内再点断开)在修好 F1 之前**恰恰只能靠本 bug 才在侧栏可达** —— 正常 settling 期组头只渲染连接钮,是残余事件把 runtime 写活了才渲染出取消钮。两者是同一个洞的两半。

**改法**:意图与弃用标记分家。`handleConnectMachine` 只记连接意图、**不 resume**;兑现点 `if (!intent) return; resume(id); connect({id})` —— `resume` 与发 IPC **同步紧邻**,闸门开启不再早于 IPC 出发。

### F2 · MAJOR · confirmed —— 去重槽只有一个出口

**回读**:`Sidebar.tsx:260` 声明 · `:264` 查 · `:270` 加 · `:316` 删(`.finally`)—— **全文仅此四处**,`abandon`/`drop` 都不作废它。
**失败时序**:verifying 期 ws 正在跨隧道 upgrade 时点取消 → dispose 关不掉那条 ws(见 F3)→ reconnect promise 不落定 → `.finally` 不跑 → 去重槽留着 → 再点连接、新 `verifying{tunnel2}` 到达 → `beginHandshake` 第 264 行直接早退 → **新隧道永远没有 ws**;而 main 照常 emit ready(不依赖 renderer 握手)→ 组头绿灯 + 终端全哑,要等旧 promise 10~15s 超时才恢复。设置页 `handleUpgrade` 同洞(drop 了 client 没清 ref)。
**改法**:握手去重槽收进共享模块,`abandon()` 内部一并清除(两个入口天然覆盖)。

### F3 · MAJOR · confirmed —— 闸③依赖的原语本身是坏的

**回读**:`hostClient.ts:423-431` `connectViaWebSocket` 里 `let ws: WebSocket` **只活在 promise 闭包**,实例不持引用;`this.transport` 要到 `ws.onopen`(`:441`)才由 `attachTransport` 设上。故 `dispose()`(`:388-399`)落在「已 new、未 onopen」窗口时 `this.transport` 为 null → **那条 ws 继续完成 upgrade** → attachTransport 挂到已 dispose 的实例 → connect resolve → 在已 dispose 的 client 上起 5s 心跳。
叠加:闸③收尾走 `hostRegistry.drop(configId)`,而 `drop`(`hostRegistry.ts:37-40`)是 `clients.get(id)?.dispose(); clients.delete(id)` —— 若该 id 已被更早的 `stopRemoteWorkspaceSync` 删除,这里就是 **no-op,没人真关那条 ws**。
这正是闸③注释与 TECH §副作用闸第 3 行承诺要防的事(「否则留一条无人管理的活连接 + 心跳」)。
**范围裁决**:缺陷**早于本 Feature**,但 ① 闸③的正确性直接依赖它;② 新增的取消钮把它从边角变成**主路径**(取消最常按在「卡在 Verifying」时,恰好落在该窗口)。**不 defer** —— 交付一个以「不留孤儿连接」为卖点的 Feature,却留着一条已知的孤儿连接路径,是自相矛盾。
**改法**:实例上存 `connectingWs`,dispose/reconnect teardown 一并 close;闸③/⑥ 收尾对**捕获到的那个 client** 调 `dispose()`,不靠按 id 查表(避免误杀已换代的新 client)。

### F4 · MAJOR · confirmed —— 两路都独立发现(external CR-2 / arch 记 MINOR)

**回读**:`orchestrator.connect` 顶部 `if (existingConnect && !forceRedeploy) return existingConnect`(`:375-376`)—— 在途 connect 把新点击**去重进旧那条 promise**;`disconnect` 等完 5s 后的让路判据是 `currentInflight !== pending`(`:423-424`),去重没产生新 tracked → 判据为假 → **不让路**,照常拆会话。净效果:那次点击什么都没发生。
侧栏靠「推迟到 `disconnectAwait` 结算后再发」避开了(那时 `connectInflight` 已清);**设置页 `handleConnect`(`RemoteHostsPage.tsx:320-324`)立即发 IPC,没有这层保护**。
**订正外审措辞**:那 5s 窗口**只在有 connect 编排在途时存在**(`pending = mutex.get(configId)` 为空则不等)。故可达时序精确说是「取消一次**在途**连接 → 从另一入口点连接」—— 恰好**逐字命中 AC-13 的 Given**。
**severity 裁决**:arch 按「PRD 范围是侧栏控件」记 MINOR,external 记 high。**取 MAJOR** —— AC-13 是 P0 且其 Given 未限定入口,实现只在一个入口成立即为 AC 失败;且修法与 F1 共用同一份共享模块,边际成本近零。

### F5 · MINOR · confirmed
`Sidebar.tsx:582` 的 `setSettlingMachine(id, false)` 无条件执行,`=== p` 守卫只护住了 map 删除。第二次断开在途时,前一次的 `.finally` 会把忙碌态提前抹掉。窗口窄(需两次点击落在同一 tick 前),但修法与 F1/F4 的共享模块顺带收口。

### F6 · MINOR · confirmed
`forget` 已扩成删五张表(dev 期修 A5b),`Sidebar.tsx:222-225` / `RemoteHostsPage.tsx:457-458` 紧邻的 `clear(id)` 成为冗余,且多一次 set = 多一次渲染。

### F7 · MINOR · confirmed(部分)
**质疑**:TC.md 本就是**测试用例规格**(blueprint 产物),`file:`/`function:` 是实现目标不是存在性声明,test stage 才落地 —— 按此读法不算缺陷。
**但**:「覆盖率 15/15(100%)· 测试总数 38」+ 覆盖表全 ✅ 的写法,与「0 条已实现」并列时确实会误导后来者(TECH §完工自查 K 行已诚实写明,两份文档口径不一致)。**采纳**:TC.md 顶部加实现状态横幅,把「规格」与「已实现」分开表述。

### F8 · NIT · confirmed(我自己的文档错)
§完工自查 C/D/E 三行行号漂移 7-8 行(我填表后又改了代码却没回头核行号);且「TC-029 已同步加断言防回归」失真 —— 那条断言目前只存在于 TC.md 规格里,测试代码中 `aria-busy`/`__busy`/`Disconnecting` 零命中,与同表 K 行自认的「0 条已实现」矛盾。**这条要修** —— R3-E:断言必须标注证据边界,「已同步加断言」把规格说成了实现。

### F9 / F10 · NIT · confirmed
F9:`.sidebar-machine-connecting` 的唯一渲染点(死分支 `status==='connecting'`)本次已删,规则成死 CSS,却还被**新加进** `:681` 的 `:is()` 选择器。
F10:`Sidebar.tsx:561` 的 8s `setTimeout` 在 pending 先赢时不清,留一枚空转计时器(无害但是垃圾);三个连接钮分支同构(只差 label),29 行可收成一个。

### F11 · NIT · **rejected**
**主张**:busy 态只用 `aria-busy`、无 `aria-live` 包裹,「aria-busy 对读屏够用」未被验证。
**驳回实证**:`aria-busy` 正是 WAI-ARIA 为「控件正在处理」定义的标准机制,读屏在焦点落到该控件时会连同忙碌态一起播报(用户点完「断开」后 Tab 到「连接」钮即可听到)。给一个**用户自己刚触发**的控件套 `aria-live` 会造成非请求的打断式播报,是已知的 a11y 反模式。且外审自己标注了该前提「未用真实 AT 验证」——在没有实测反证的前提下,用一个反模式去替换标准机制不成立。**保留现状**;若日后有真实 AT 实测反证,单独立项。

## §修复建议(一轮修完 · 共享模块收口)

F1/F2/F4/F5 根因同一件事:**machine 级的连接编排状态散在两个组件的私有 `useRef` 里**,而 TECH 自己早就吐槽过这个模式(「重复实现意味着每个新增的不变式都要记得在两个地方各写一遍」——当时说的是握手实现两份)。本轮 finding 是那句话的第二次应验,故不逐点打补丁,收进 `remoteHostStore` 模块的共享原语:

1. `pendingDisconnects` / `connectIntent` / `handshaking` 三个模块级容器 + 四个导出helper
2. `abandon()` 内部一并清 `handshaking`(F2)与连接意图
3. 连接意图与 `resume` 解耦:兑现点才 resume,与发 IPC 同步紧邻(F1)
4. 两个入口都走同一份排队原语(F4);断开登记带 `=== p` 守卫(F5)+ 失败日志(external CR-4)
5. `hostClient` 持 `connectingWs` 并在 dispose 关闭;闸③/⑥ 对捕获的 client 调 `dispose()`(F3)
6. 清理项 F6/F9/F10 + 文档订正 F7/F8

**修完补三条针对性单测**(arch 建议,采纳):① settling 期点连接后推残余 `verifying{tunnel}`,断言 `getOrCreateRemote` 未被调用;② 握手 promise 手动 pending → 取消 → 再连 → 推新 verifying,断言新 `beginHandshake` **未**被去重槽挡住;③ 残余 `ready` 在 settling 期不得把组头写绿。

## §verdict

**NEEDS_REVISION** —— 1 条 open BLOCKER(F1,AC-6 逐字失败)+ 3 条 open MAJOR(F2/F3/F4)。

两路评审的价值在此轮体现得很直接:**两条最重的 finding(F1 BLOCKER、F3 MAJOR)只有 architect 路发现,F4 只有 external 路把它定到 high**;若走单路评审,按哪一路都会漏掉另一路的核心发现。

### 两路都没能验证的(如实登记 · 不算已验)
- **窗口宽度全是读码推断**:F1 的 0.5–5s、F2/F3 的 10–15s(ws upgrade 跨隧道 RTT · `connectViaWebSocket` 10s · RPC_TIMEOUT 15s · DISCONNECT_WAIT 5s)—— 能确证的是「路径存在且无守卫」,给不出实测命中率。**未真连远程机实测**。
- **测试真实性**:两路都按硬规则 9 未重跑,只静态读测试代码(断言是真断言,`beforeEach` 也正确重置了新增的 `abandoned`/`settling`)。vitest 日志两路都没打开。
- **像素级**:arch 未看截图,只核了产生这些呈现的代码分支;七态并排核对的图由 dev 阶段单独完成。
- **R5 远端锁**:同 dev 声明,只到读证。
