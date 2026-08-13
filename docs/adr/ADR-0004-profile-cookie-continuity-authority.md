---
id: ADR-0004
title: 登录连续性采用 Profile 级 Cookie 权威、Host 定序 revision 与 fail-closed hydration gate
status: accepted
date: 2026-08-13
tags: [browser, remote-host, profile, cookie, concurrency, security]
triggered_by: "OKWORK-F260810151932-Browser-Profile-Login-Continuity"
supersedes: []
---

## 背景

BL-007 已把每个 Browser Profile 的配置与密码收进唯一权威（本机或一个 Remote Host），并留下约束：
后续 Cookie 漫游必须复用该 catalog/provider/迁移提交边界，不得另建 local fallback 或第二位置台账。

BL-008 要让用户换设备后延续常见站点的登录状态。这引入 BL-007 没有的三类新问题：
① Cookie 是**双向高频变化**的数据（网站随时写入/删除），不像 Profile 配置那样只由用户显式修改；
② 同一 Profile 在不同设备、不同网络出口 partition 上会**并发**产生冲突写入，且响应可能丢失后重试；
③ Cookie 值本身就是**登录秘密**，比密码 Vault 的暴露面更宽（它要经过 renderer 承载的 webview 生命周期）。

同时 Electron 的 `session.cookies` API 只能无损表达一部分 Cookie，而 LocalStorage / IndexedDB /
Service Worker / Cache / Chromium Profile 目录都不在可移植范围内。

## 决策

1. **Cookie 权威是 Profile 级，不是 partition 级。** 同一 Profile 的本机直连与各远程出口 partition
   共用一份 Cookie 权威并互相对账，而网络出口本身保持独立。`session-only` Cookie **不漫游**，留在当前设备
   并计入策略跳过——漫游它等于偷偷延长其寿命，违反站点意图。

2. **冲突由 Host 的原子接受顺序裁决，不用设备壁钟。** Cookie identity 由规范化的 host-only/domain、path、
   name 确定，不同 identity 独立合并；同一 identity 按 Host 接受顺序分配**单调 revision**，后接受的有效操作
   获胜。设备携带稳定 `deviceId + operationId + baseRevision`，同 `operationId` 的重试只返回既有结果
   （幂等），不产生第二次写入。

3. **tombstone 不压缩，但容量淘汰不进 tombstone。** 每个 identity 的最新 tombstone 永久保留，旧值不能复活；
   而**单设备的容量回收（Electron `evicted`）在设备侧直接不上报**，不形成全局 tombstone——否则一台设备的
   Chromium 清空间会把所有设备登出。网站在新 hydration 后产生的更高 revision 新登录仍可合法重建 Cookie。

4. **hydration gate 是 fail-closed 的 main-side 强制门，不是 attach-time 一次性检查。**
   每个 `Profile × partition × 当前 Host generation` 必须完成初始 Cookie hydration 后，才创建或导航 webview。
   该判定必须挂在 main 的 guest 主帧导航事件（`will-navigate` / `will-redirect`）上并每次动态复读
   authority/generation——只在 attach 时检查会让已打开的页面在 generation 失效后通过站内链接绕过门禁，
   以登出状态发出请求（本 Feature review 的 MAJOR finding）。离线/不兼容/超时时保持**零网站请求**并提供重试。

5. **Cookie 秘密只在 main 与专用 Host 存储链路流转。** 普通 renderer、设置页 DTO、日志、错误与截图
   只允许出现 Profile 摘要、数量与固定原因类别，**不得出现 Cookie 的 name、domain/host、path 或 value**。
   本机离线 journal 与 Host 权威记录采用与现有 Vault 等价的加密、私有权限与原子写边界。
   LocalStorage / IndexedDB / Service Worker / Cache / Chromium Profile 目录及 Cookie DB **均不上传**。

6. **离线期只记加密 journal，不称其为权威。** Host 离线/超时/generation 改变时，已打开页面的 Cookie 变化以
   稳定 `operationId` + base revision 写入跨重启保留的加密待确认 journal，UI 只显示"待同步数量"，
   不显示"已上传/已同步"。Host 恢复后忽略旧 generation 的迟到响应、从权威游标恢复并提交 journal。
   密码与 Profile 修改继续按 BL-007 fail-closed，不进 journal。

7. **删除/迁移用单调 epoch fence，且 fence 先于物理清理落盘。** 旧 Host 在删除数据**之前**持久化单调
   delete/move epoch；旧设备的陈旧目录或 journal 不能穿透 epoch 重建数据。提交前失败保持原权威，
   提交后清理失败可重试但不恢复旧权威。

8. **协议容量以有界分页 + 游标承载。** Cookie 快照/变更/迁移以低于 8 MiB 的分页执行，每页幂等可重试，
   超时从已确认游标续传；Host 通过能力探测明确是否支持漫游，旧 Host 显示升级提示而**不静默降级**。

## 理由

- Profile 级权威让"换设备/换出口仍是同一个登录身份"成为可表达的产品语义，partition 级会退化成 N 份互不相识的登录。
- Host 定序消灭了跨设备时钟依赖：多设备并发与网络重试的收敛结果只依赖一个可审计的接受顺序。
- identity 规范化让"同一个 Cookie"有确定定义，否则大小写/前导点差异会把一条 Cookie 分裂成多条并各自计 revision。
- 区分"真删除"与"容量淘汰"是本 Feature 最贵的边界：前者必须全局生效，后者必须严格本机，弄反任一方向都是用户可感的登录事故。
- 把 gate 放在 main 的导航事件上，是唯一能覆盖 anchor 点击、脚本导航与 redirect 的位置；renderer 侧的地址栏/按钮包装天然漏掉站内导航。
- 秘密边界按"数据面"而非"组件善意"划分：renderer 不持有 Cookie 明文，就不需要论证每个 renderer 路径是否安全。

## 备选方案（考虑过，拒绝）

| 方案 | 拒绝理由 |
|---|---|
| Cookie 权威按 partition 分开存 | 换网络出口即换登录身份，与"登录连续性"的产品目标直接冲突 |
| 漫游 session-only Cookie | 等于替网站延长会话寿命，改变站点的安全语义 |
| 用设备壁钟（last-write-wins by timestamp）裁决冲突 | 跨设备时钟偏差会让"较早的写"覆盖"较晚的写"，且不可审计 |
| 容量淘汰也上报为删除 | 一台设备的 Chromium 清空间会把所有设备登出 |
| 压缩/清理旧 tombstone 以省空间 | 长期离线设备重连后会把已删除的登录 Cookie 带回来 |
| hydration gate 只在 `will-attach-webview` 检查一次 | 已 attach 的页面可在 generation 失效后通过站内链接绕过，以登出状态发请求 |
| 把 Cookie 值下发 renderer 由 UI 呈现同步细节 | 登录秘密进入 renderer/日志/截图，暴露面远大于收益 |
| 同步 LocalStorage / IndexedDB / SW / Cache | Electron 无无损可移植表达；且体积与一致性风险远超"延续登录"这一目标 |
| 旧 Host 静默降级为"不漫游但假装成功" | 用户会以为已漫游而在新设备上丢登录，属于最坏的失败模式 |

## 后果

- **正面**：换设备延续登录有确定的收敛规则；Cookie 秘密不进入 renderer 数据面；离线可用且不谎报同步状态。
- **负面**：hydration gate 会让首次打开站点多一次等待；Host 必须升级才能漫游（旧 Host 明示提示）。
- **约束**：任何新增的 Cookie 写入路径都必须经过 identity 规范化与 Host 定序 revision，**不得**旁路直接写 partition。
- **约束**：任何新的用户可见面（DTO/日志/截图/错误）不得引入 Cookie name、domain/host、path 或 value。
- **约束**：新增的导航入口（新窗口、新 webview 宿主、外部唤起）必须接入同一 main-side gate，不能只包装 renderer 入口。
- **演进**：若未来要漫游 LocalStorage/IndexedDB 等非 Cookie 存储，属于不同的可移植性与体积模型，须另立 ADR。

## 相关

- 代码：`src/shared/profileContinuity.ts`、`src/host/profileContinuityStore.ts`、
  `src/main/profileContinuityController.ts`、`src/main/profileContinuityJournal.ts`、
  `src/main/browserGuestNavigationGuard.ts`、`src/main/remoteProfileProvider.ts`
- 回归：`src/host/__tests__/remoteProfileStore.test.ts`、
  `src/main/__tests__/remoteProfileAuthority.test.ts`、
  `src/main/__tests__/browserGuestNavigationGuard.test.ts`、
  `src/main/__tests__/profileContinuityJournal.test.ts`、
  `src/renderer/components/settings/__tests__/BrowserProfilesSection.test.tsx`
- 已知门禁缺口（非缺陷 · 见 PENDING-013）：决策 3 的设备侧 `evicted` 抑制与决策 8 的旧 Host 升级提示
  当前无回归测试覆盖
- 🔴 已知**约束未覆盖入口**（见 PENDING-015）：决策 4 的 gate 目前只装在 webview guest 上；
  与本 Feature 并行落地的子浏览器窗口（OAuth 弹窗 · `main.ts` `adoptBrowserPopupWindow`）继承开启方分区
  但只校验 scheme，尚未接入同一 main-side gate
- 过程快照：`features/_archive/OKWORK-F260810151932-Browser-Profile-Login-Continuity.zip`
