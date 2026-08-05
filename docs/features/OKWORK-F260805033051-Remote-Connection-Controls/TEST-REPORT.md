---
feature_id: "OKWORK-F260805033051-Remote-Connection-Controls"
author: QA
status: confirmed
prd_ref: PRD.md (v0.3)
tc_ref: TC.md (v0.5)
test_run_at: "2026-08-05T16:14:00Z"
evidence:
  integration_test_exit_code: 0   # 红 base 差分口径：当前失败 ⊆ 基线,new=[]
  e2e_test_exit_code: 0
  ac_coverage_verify: pass
revision_history:
  - version: v0.1
    date: "2026-08-05"
    author: QA
    summary: 首版 —— 38 条 TC 落地 + e2e 冒烟 + AC 覆盖校验通过
---

# 远程机组头连接控件重构 - Test Report

> 🔴 本文所有结论都附 stdout 原文行与 exit-code 数值,不口述「测试通过」。
> 🔴 测试由**验证档 subagent** 执行,主对话只判读日志(未自跑)。日志留存于
> `/private/tmp/teamwork/OKWORK-F260805033051-Remote-Connection-Controls/`。

---

## §1 测试范围

| 层 | 范围 | 文件 / 入口 |
|---|---|---|
| unit(store 层) | 连接编排共享原语:排队 / 弃用闸 / 握手去重槽 / settling 接替 | `src/renderer/state/__tests__/remoteHostStoreAbandonGate.test.ts`(8 条) |
| integration(进程内 · React + store + IPC mock) | 组头六态渲染 · 弃用闸四通道 · 排队与 8 秒上界 · 失败 toast 改道 | `src/renderer/components/__tests__/{MachineGroup,SidebarMachineGroups}.test.tsx`(12 + 21 条) |
| integration(CSS 源不变式) | AC-15 的 auto-margin 组与 `~` 兄弟选择器清零 | `src/renderer/components/__tests__/sidebarCssInvariants.test.ts`(2 条) |
| e2e(真跨进程) | main + renderer + host 三进程真启动 · IPC handler 注册/注销闭合 | `e2e/smoke_remote_controls.py` |
| browser-e2e | **N-A** —— `execution_hints.browser_e2e_needed = false`(本 Feature 无新增页面/路由,只改既有组头控件) | — |

🔴 **概念边界**:表中 integration 全部是**单进程内**(jsdom + mock IPC),不冒名 api-e2e。
本项目是 Electron 桌面应用、无 HTTP 服务,故 e2e 层用**无头冒烟**(三进程真起)而非「起服务打 HTTP」。

---

## §2 integration 结果

### 2.1 执行命令

```bash
cd /Users/liam/apps/okok/TermPro/.worktree/OKWORK-F260805033051-Remote-Connection-Controls
npx vitest run                    # 全量
npx vitest run src/renderer/components/__tests__/SidebarMachineGroups.test.tsx   # 核心文件 ×3
```

### 2.2 stdout 摘录(全量 · `vitest9.log`)

```text
 Test Files  2 failed | 171 passed | 1 skipped (174)
      Tests  2 failed | 1768 passed | 6 skipped (1776)
   Duration  20.84s (transform 4.86s, collect 18.15s, tests 77.19s, environment 45.30s, prepare 18.96s)
```

### 2.3 核心文件稳定性(连跑 3 遍 · `sidebargroups-ok2{,-2,-3}.log`)

```text
      Tests  28 passed (28)
      Tests  28 passed (28)
      Tests  28 passed (28)
```

🔴 **为什么要连跑 3 遍**:该文件此前修的正是**跨用例污染**(mock 实例缓存与模块级容器残留),
这类问题的典型症状是「单跑绿 / 全量红」或「时绿时红」,**跑一遍绿不构成证据**。

### 2.4 红 base 差分(2 条失败的处置)

当前失败:
```text
 FAIL  src/host/__tests__/wsMultiClientIsolation.test.ts > T-043 fs:changed 不跨客户端广播
 FAIL  src/host/__tests__/wsRpcParity.test.ts > T-033 fs.unwatch 后不再收到该 watchId 推送
```

差分结果(`state.py test-baseline --diff`):
```json
{ "new": [], "excluded": ["src/host/__tests__/wsMultiClientIsolation.test.ts",
                          "src/host/__tests__/wsRpcParity.test.ts"] }
```

**`new = []` → 零新增失败**。定性依据(**实测,不是「本 Feature 没碰 src/host」的推断**):

1. 三个 host 文件各自**单独重跑 3/3 全过**(`reflake-*.log`);
2. `git diff 7d2dc6c..HEAD -- src/host/` = **0 个文件**;
3. 同一份 host 代码在本 Feature 的多轮门禁里**时绿时红**(第 2 轮全绿、第 3 轮红 3 条、第 9 轮红 2 条,且每轮红的**具体用例名都不同**)——这个波动本身就是负载敏感的证据;
4. 失败形态一致:`pokeUntilFsEvent 在 8000ms 预算内始终未收到 fs:changed` / PTY ring 字节数差 1024(正好一个读块)——都是**限时预算 / 时序敏感断言**。

已按 GO-036 **逐文件独立登记**(不合并成逗号串),原因栏写清「谁的债 · 何时清」+ 清偿建议。

---

## §3 e2e 结果

### 3.1 执行命令与 exit code

```bash
python3 docs/features/OKWORK-F260805033051-Remote-Connection-Controls/e2e/smoke_remote_controls.py
```

### 3.2 stdout 摘录(`e2e9.log`)

```text
✅ Exit code is 0
✅ SMOKE_OK marker found
✅ No double handler registration
============================================================
✅ All smoke test assertions passed
============================================================
Three processes (main + renderer + host) started successfully
IPC handler registration/unregistration is properly balanced
```

**exit code = 0**。

### 3.3 这条 e2e 验什么 / 不验什么

- **验**:① 三进程(main / renderer / host)真能起来;② 出现 `SMOKE_OK`;
  ③ 🔴 日志中**不出现** `Attempted to register a second handler` —— 本 Feature 新增了一条 IPC
  handler(`remoteHost:disconnectAwait`)并在 teardown 闭包补了 `removeHandler`,**漏登记正好会抛这个**,
  所以这条断言是针对本 Feature 改动量身设的,不是通用样板。
- **不验**:UI 交互与视觉(属 browser_e2e,本 Feature N-A)、连接/断开的具体编排逻辑(属上面的 integration 层)。

---

## §4 AC 覆盖度

`python3 templates/verify-ac.py <feature>` 输出:

```text
✅ AC 覆盖校验通过（15 条 AC 均有测试覆盖）
```

| AC | 覆盖 test | AC | 覆盖 test |
|---|---|---|---|
| AC-1 | T-001, T-002 | AC-9 | T-020, T-021, T-022, T-024, T-037, T-038 |
| AC-2 | T-003, T-004, T-005, T-037 | AC-10 | T-023, T-024 |
| AC-3 | T-006, T-007 | AC-11 | T-025, T-026, T-027 |
| AC-4 | T-008 | AC-12 | T-024, T-028 |
| AC-5 | T-009 | AC-13 | T-029, T-030, T-031, T-038 |
| AC-6 | T-005, T-010~014 | AC-14 | T-032 |
| AC-7 | T-015~018 | AC-15 | T-033, T-034, T-035, T-036 |
| AC-8 | T-019 | | |

### 🔴 AC-15 的覆盖是三层互补,不要读成「已被单一测试证明」

jsdom **不做布局**,拿不到 computed position,所以没有任何一条测试断言了真实像素位置。实际覆盖是:

| 层 | 断言什么 | 挡得住 | 挡不住 |
|---|---|---|---|
| DOM 顺序(T-033~035) | `disconnectIdx === rttIdx + 1`、未连接态最后一个子元素是连接钮 | 元素次序错乱 / 控件漏渲染 | CSS 算错导致的视觉间隙 |
| CSS 源不变式(T-026/036) | auto-margin 组含 `-rtt`/`-ctl`;`~` 兄弟选择器把后续元素清零 | 规则被删 | 规则写了但算错 |
| **并排截图(dev 阶段)** | 真实组件七态渲染 vs 全景权威逐态比对 | **真实像素** | 一次性证据,不进 CI |

**唯一真正验到像素的是第三层,而它不在 CI 里。** 这是如实交代的覆盖边界,不是缺陷。

---

## §5 回归

- 全量 1768 passed —— 本 Feature 之外的既有套件无新增失败(差分 `new = []`)。
- 本 Feature 改动的既有测试(随通道/语义变更跟进,断言目的未放宽):
  - `credentialStore.test.ts`:IPC 通道白名单补 `disconnectAwait`;
  - `RemoteHostsPage.test.tsx`:两条断言由 `bridge.disconnect` 改为 `bridge.disconnectAwait`(设置页断开改走可等待通道);
  - `MachineGroup.test.tsx` / `SidebarMachineGroups.test.tsx`:失败态断言随「failed 不进组头、改走全局 toast」重写。

---

## §6 过程中发现并修掉的**测试自身**缺陷(如实登记)

> 这些不是产品缺陷,但值得留痕 —— 它们全都长得像「通过」。

| # | 形态 | 后果 | 处置 |
|---|---|---|---|
| 1 | 9 条用例拿不到事件回调(`installOkwork` 返回值没接住),却被 `if (emitEvent)` **静默跳过** | 报绿但**什么都没验证** | 改 `expect(emitEvent).toBeDefined()` 后无条件使用 |
| 2 | `waitFor(() => expect(x).not.toHaveBeenCalled())` | 第一次轮询就通过,什么都没等到 | 改为先等**正向**信号(settling 被清)再断言「没发」 |
| 3 | `vi.useFakeTimers()` 开在 `findBy*` 之前 | 轮询等不到假时钟 → 卡满 20s 超时 | 不需推进时间的不开假时钟;需要的改 `advanceTimersByTimeAsync` |
| 4 | mock 返回 `.catch()` **之后**的链 | 拒绝被吞成 resolve,组件走错分支 | 把**被拒绝的那条**交给组件,catch 只挂旁支压告警 |
| 5 | AC-14 断言编码了**被 review 推翻的旧语义**(点连接即解除弃用) | **会把 F1 回归判成通过** | TC-032 规格更正为 v0.5 + 断言重写(纳入 F1 不变式) |
| 6 | mock 实例缓存跨用例存活(`reconnect` 被前一条改成 reject) | 症状伪装成「生产代码不调 onReconnected」 | `beforeEach` 统一恢复默认 + `mockClear()` 清调用历史 |
| 7 | AC-13 可见性断言被注释掉,理由写「待生产代码实现」(实际早已实现) | 撤掉 spinner 也全绿 | 恢复断言 |

📌 **第 6 条的种子调用一度撞红了 AC-6(c) 的「`getOrCreateRemote` 调用数为 0」** —— 那是**好消息**:
说明那条灵魂断言是真锁,不是空壳。

---

## §7 未覆盖 / 未验证(交 pm_acceptance)

1. **AC-15 的真实像素**:见 §4 说明,CI 内无像素级断言。
2. **R5 远端部署锁**:`deploying` 中途取消是否真在远端留锁,只做了逐行**代码读证**(记 `KNOWLEDGE.md GO-037`),
   **未真连远程机实测** —— 实测会在用户远端留一把真锁、让下次连接卡满 120s,副作用需用户授权。
3. **拆除语义两套**(既存 · 非本 Feature 引入):设置页断开不走 `stopRemoteWorkspaceSync`,
   故 **AC-12 只在侧栏入口成立**;已记 `TECH §风险 R6` + concerns,交 review/pm 定夺。
4. **多远程机并发**:所有用例都是单机(cfg-1)场景,未构造两台机同时连接/断开的交叉时序。
