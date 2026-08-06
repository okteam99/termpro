---
id: ADR-0001
title: 远程机连接编排用「两道闸 + 意图与弃用标记分家」,状态收进 store 模块级单源
status: accepted
date: 2026-08-05
tags: [remote, concurrency, renderer-state]
triggered_by: "OKWORK-F260805033051-Remote-Connection-Controls"
supersedes: []
---

## 背景

用户点「断开 / 取消」之后,有**四条独立的异步通道**会把这台机的状态写回来或把连接真做成:

1. main 推送的残余生命周期事件(`claiming` / `verifying` / `ready` / `failed`);
2. 取消时**已在途的那次握手的续体**(`.then` 写 ready / `.catch` 写 failed —— 本地闭包);
3. 残余 `verifying{tunnel}` 会调 `beginHandshake` **真去开 ws**;
4. client 层的 `onReconnectNeeded`(心跳判死 / transport 关闭)—— **完全不经 main 事件、不经 store**。

关键约束:`orchestrator.disconnect()` **不中断**在途编排,只 `await Promise.race([pending, sleep(5s)])`
(`orchestrator.ts` 该行注释:「在途编排不安全中断,best-effort 等它自然结束」)。
也就是说**用户点了取消之后,被取消的那次 `runConnect` 在 main 侧还在继续跑**。

## 决策

**三条,缺一不可:**

1. **两道闸,不是一道**。
   - *状态写入闸*:`applyEvent` / `setRtt` / `setReconnecting` 各查弃用标记(纵深防御,兜住未枚举的写入路径);
   - *副作用闸*:订阅回调首行 / `beginHandshake` 入口 / 握手续体 `.then`+`.catch` / `onReconnectNeeded` 接线 /
     排队中的 connect 兑现前 —— 共 7 处。
2. **「连接意图」与「弃用标记」是两个变量,不是一个**。
   排队等待断开收尾期间,弃用标记**必须保持为真**;`resume()` 推迟到**兑现点**,与发 connect IPC 同步紧邻。
3. **machine 级的编排状态收进 `remoteHostStore` 模块级容器**(`pendingDisconnects` / `connectIntent` / `handshaking`),
   侧栏与设置页共用,不放各自的 `useRef`。

## 理由

**为什么不是一道闸**:store 闸只挡「写状态」,挡不住副作用。残余 `verifying` 会让 `beginHandshake` 真去开 ws,
而 `getOrCreateRemote` 又会把 client 重新插回注册表 —— 「界面已断开、后台却把连接做完了」。
(v0.1 方案曾声称「一道 gate 放在 `applyEvent` 就覆盖三条通道」,被两路独立冷审各自证伪。)

**🔴 为什么 `resume` 不放在 `handleConnect` 首行**(这条最反直觉,也最容易被"修复"回去):
放在首行 = 在连接真正发出**之前**就把四道闸全打开,而被取消那次编排还在 main 侧跑。
于是残余 `claiming/verifying/ready` 照单全收 → 组头**变绿「已连接」** → 残余 `verifying` 真去对**旧隧道**
把连接建成、灌 workspace、收养会话 → main 的 disconnect 醒来再把它拆掉;若那次握手以 reject 收场,
还会弹一条**假的**「连接失败」toast。
根因:`abandoned` 一个布尔同时扛「拒收上一代残余」与「接受下一代意图」两个**不能共存**的语义。

**为什么收进 store 模块级**:侧栏与设置页是**两个可同时挂载**的入口。各持私有 `useRef` 时,
一个入口建立的不变式对另一个入口**不存在** —— 设置页看不见侧栏登记的断开在途,
直接发 connect 撞上 main 的在途去重,「点了没反应」换个入口原样复现。

## 备选方案(考虑过,拒绝)

| 方案 | 拒绝理由 |
|---|---|
| 只在 `applyEvent` 设一道闸 | 挡不住副作用(见上)。**已被实证推翻,不要再提** |
| 每个订阅点各持一份 abandoned 集合 | 两处订阅写同一 store,各持各的集合互不知晓 —— 正是本 ADR 第 3 条要消除的形态 |
| 让 main 侧 `disconnect` **抢占式作废**在途 `connect` | 要改 `orchestrator` 的去重/让路语义,而那是 2026-07-20 事故的修复产物;跨进程语义变更风险远高于渲染层设闸 |
| 按钮禁用态(而非排队) | 用户点了被拒,体验差且要多一条 i18n;且 `aria-disabled` 不阻止 click 的争议随之而来 |

## 后果

- **正面**:四条通道全部收口;新增入口(如未来的命令面板/快捷键)只要复用 `requestConnect` / `trackDisconnect` 即自动继承全部不变式。
- **负面**:编排状态不在 React 树里,调试时要去 store 模块看;**且模块级容器在测试中 `setState` 清不掉** ——
  测试必须显式调 `__resetRemoteHostOrchestrationForTest()`,否则症状是「单跑绿、全量红」。
- **约束**:`reconnectController` 的 disconnect-first **绝不能**走 `abandon()`(`reconnectWiring` 注入的必须保持裸 IPC),
  否则自动重连会给自己贴弃用标记、当场自锁死。

## 相关

- 回归锁:`src/renderer/state/__tests__/remoteHostStoreAbandonGate.test.ts`(排队期间闸门必须保持关闭 = 本 ADR 第 2 条的锁)
- 复发防御:`project-specs/KNOWLEDGE.md` § 复发防御清单 RD-1 / RD-5
- 过程稿(含四条通道的逐行证据与冷审记录):`docs/features/_archive/OKWORK-F260805033051-Remote-Connection-Controls.zip`
