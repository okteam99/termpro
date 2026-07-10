---
review_stage: review
reviewer: qa
feature_id: TERMPRO-F260709180208-Remote-Hosts-SSH
base: origin/yolo/m5-remote-host
date: "2026-07-10"
verdict: NEEDS_REVISION
---

# REVIEW · QA · BL-003 远程机管理与 SSH 连接编排

> 隔离评审范围 = feature 分支相对 `origin/yolo/m5-remote-host` 的 `src/` 增量（38 文件 · +6135）。
> 基准 = TC.md（41 test 契约）+ PRD.md（AC-1..AC-14）。
> 默认姿态 = 质疑：先质疑弱断言/形式覆盖 → 回读 test 代码确认。分级同 architect（high/medium/low）。

## 摘要

跑 `npx vitest run src/main/remote src/host src/renderer` → **469 passed · 1 skipped**（skip = T-031 无本机 sshd，如实降级）。
`verify-ac.py` → 14/14 AC 机读全绿。

**但机读绿 ≠ 真覆盖。** 抽查断言强度后结论分两极：

- ✅ **最高风险处（residency 决策表 · ARCH-B8）与全部安全 AC（AC-3/8/9/10）是真断言**，非形式覆盖。architect
  blueprint 阶段挂的 ARCH-B8（residency 无可执行断言）、R2V-1（`.deploying` 陈旧锁）在实现里都已用强断言补上。
  AC-8 端口文件测**起真实 host 子进程**（真 `openSync('wx')`/真 0600/真 fail-closed exit1），保真度高。
- 🔴 **AC-6（P0）零行为覆盖，且机读门禁被"幽灵契约测试"骗绿**——这是本轮唯一阻塞项。TC 契约的
  T-012/T-013（`remoteHandshakeSmoke.integration.test.ts`）在 `src/` 内**根本不存在**，但 `verify-ac.py`
  仍报 AC-6"被 2 个 test 覆盖"，因为它只解析 TC.md front-matter 的映射、不核实 test 代码存在。这正是本次
  QA 评审要抓的 form-over-substance。

## findings

### Q1 · AC-6（P0）零行为覆盖 + 机读门禁误绿（幽灵契约测试）· severity: **high** · status: open · category: gate-integrity/test-coverage

**file**: TC.md L80-90（契约 T-012/T-013）· `src/main/remote/orchestrator.ts:555-562`（未覆盖分支）· `src/main/remote/__tests__/failClassification.test.ts:29-42`

**description**：
- 契约 T-012（`test_AC6_compatible_ready_protocol_smoke`）/ T-013（`test_AC6_incompatible_version_disconnect`）指定文件
  `src/host/__tests__/remoteHandshakeSmoke.integration.test.ts` —— `find/grep` 全仓**零命中**，文件未实现。
- AC-6 的运行时行为 `orchestrator.ts:556`（`if (!probeResult.ok || probeResult.compatible === false)` →
  `failSession('incompatible')` + 关隧道 + 关 ssh）**代码已实现**，但**无任何 test 驱动 probe 返回 `compatible:false`
  或 `ok:false` 走到这条边**：orchestrator.test.ts 所有 harness 的 `probe` 默认 `{ok:true, compatible:true}`
  （L45-47），T-028 认领路径也用默认真值。该 incompatible→failed+disconnect 边 = 死代码级未覆盖。
- failClassification.test.ts 里 `incompatible` 只有：类型枚举成员断言 + `FAIL_REASON_COPY.incompatible.label`
  存在断言（L20-27），`classifyConnectError` 用例根本不含 incompatible（它来自 probe 非 connect error）。即
  incompatible 有"文案在"但"行为不验"。
- residency.test.ts 里的 `probe ok:false` 是 `resolveResidency`（认领探测）路径，与 orchestrator 首装后 verifying
  探测（L555）是**两条不同代码路径**，不能相互替代。
- 净结果：**P0 AC 的核心保证（兼容→ready 协议冒烟；不兼容→主动断开）运行时零验证**，而 `verify-ac.py` 报绿。
  机读门禁在 AC-6 上说了假话。

**建议**：二选一或都做——(a) 按契约补 `remoteHandshakeSmoke.integration.test.ts`（复用既有 host ws harness，
loopback 起真 host，验兼容→握手完成 / 注入不兼容 HostInfo→wsServer 断开）；(b) 至少在 orchestrator.test.ts 增
一条 `probeImpl: async () => ({ ok:false, compatible:false, detail })`，断言末态 `failed` + `reason==='incompatible'`
+ `ssh.close`/`tunnel.server.close` 被调用（守 L556-561 那条边）。同时**修 TC.md**：要么落地契约文件名，要么
把 T-012/T-013 指向真实存在的 test，让 `verify-ac.py` 不再报幽灵覆盖。

### Q2 · AC-8 T-018 "token 零落盘/零日志" 降级为 argv 契约,未扫真实 dataDir/host.log · severity: **medium** · status: open · category: test-coverage

**file**: `src/main/remote/__tests__/tokenStdinInjection.test.ts:32-105`

**description**：TC.md §5.6 / §3 / 落地风险#2 明确要求 T-018 断言"扫描 `${dataDir}` 内所有文件 + host.log:
均不含 token 明文"。实现的 T-018 只做 **argv/exec-string 契约断言**：token 不出现在任何 `ssh.exec()` 命令串、
不出现在 `execDetached.cmd`（L93-99）。这守住了 **main 侧编排器的注入信道**（主泄露面，值得肯定），但
**host 侧"零落盘零日志"完全未验**——若远端 host 把经 stdin 收到的 token 打进 host.log 或某数据文件，此测不会
捕获。测试自己的注释（L3-5）也承认这只是"等价于"，而该等价依赖 `execDetached(cmd,stdin)` 签名的结构分离，
是设计属性、非对真实 host 日志行为的验证。portFile.test.ts 已能起真实 host 子进程，具备扫 host.log 的能力却未扫。

**建议**：在 portFile 的真实子进程测里加一条：经 stdin 喂 token 起 host → `waitForFile(host.log)` → grep
`dataDir` 递归 + host.log **不含 token 明文**（对照 main 侧 `hosttoken:<id>` 密文合规不算泄露）。补齐 host 侧
证否，闭合 TC 落地风险#2。

### Q3 · AC-7 "按 lastUsed 倒序" 排序行为无真实断言 · severity: **medium** · status: open · category: weak-assertion

**file**: `src/main/remote/__tests__/hostConfigStore.test.ts:68-80`（T-014）· `src/renderer/components/settings/__tests__/RemoteHostsPage.test.tsx:205-231`（T-015）· 真 SUT = `src/renderer/components/settings/RemoteHostsPage.tsx:223-227`

**description**：T-014 声称测"按 lastUsed 倒序",但断言是 `[...store.list()].sort(...)` —— **测试自己排序后再断言排序结果**
= 近乎 tautology，只证明 lastUsed 值被正确持久化（这有价值），不验证任何 SUT 的排序行为。`store.list()`
（credentialStore.ts:138）本身不排序，倒序逻辑其实在 renderer 的 `recentHosts` useMemo（RemoteHostsPage.tsx:227
`.sort((a,b)=>(b.lastUsed??0)-(a.lastUsed??0))`）。而 T-015 只断言最近区"单按钮/点击连接/无 lastUsed 被排除"
（L205-231），**未断言多条最近项的倒序渲染顺序**。净：相对时间 + 一键连接有覆盖，**"倒序"这个 AC-7 核心排序
声明在 unit 与 fe-e2e 两级都无行为断言**。（AC-7 为 P1/P2，故 medium 非 high。）

**建议**：在 RemoteHostsPage.test.tsx 造 ≥3 个不同 lastUsed 的 host，断言最近区渲染出的 alias 序列 = 倒序期望
（如 `['c','b','a']`）—— 让断言打在 renderer 的真实 sort 上；或把倒序职责下沉 store 并让 T-014 直接断言
`store.list()` 的原生顺序（去掉测内自排序）。

### Q4 · AC-4 T-039 "并发首装" 非真并发（确定性注入） · severity: **low** · status: open · category: test-fidelity

**file**: `src/main/remote/__tests__/deploy.test.ts:83-156`

**description**：T-039 命名"并发首装",但实际未跑两个真实 flow 竞争 mkdir 锁：它是**单 flow + 确定性注入**——
本测覆盖"rename 目标已存在→loser 弃 tmp 复用赢家产物"路径（sftpRename throw ENOTEMPTY），锁的 EEXIST-等待
路径由**另一条独立测试**（L122-156，注入 mkdir→EXISTS）覆盖。mkdir 的互斥性靠 POSIX/OS 原子性保证，不在 JS
层可测，故拆成两条确定性注入测是合理工程取舍，非缺陷。但"并发"命名夸大了实跑内容——没有任何测让两个 flow
真正 race。deploy.ts 用 `mkdir`（SSH 上的原子锁原语）替 TC 契约里的 `openSync('wx')`（只能本地）实为**更贴近
现实**的选择，值得肯定。

**建议**：非阻塞。将 T-039 描述改为"rename 竞态 loser 复用"、把 L122 测标注为"锁 EEXIST 等待"，避免"并发"
名实不符误导后来者；或加一条真 `Promise.all([deployBundle,deployBundle])` 冒烟（共享一个有状态 mkdir 桩仿真锁）。

### Q5 · 平凡/近 tautology 断言（不伪绿但零价值槽位）· severity: **low** · status: open · category: weak-assertion

**file**: `src/main/remote/__tests__/credentialStore.test.ts:74`（T-007）+ `hostConfigStore.test.ts:82-95` · `src/main/remote/__tests__/deploy.test.ts:197-201`

**description**：(a) `expect(rawConfig).not.toContain('PRIVATE KEY')` —— store 全程只拿到**路径字符串**、从未被喂过
私钥文件内容，故该断言**恒真、不可回归**。设计上正确（store 只存路径），但作为"防泄露"断言无守门力；T-007 真正
有力的是 REMOTE_HOST_CHANNELS 结构断言（L77-81，强），所以净 OK。(b) deploy.test.ts:200 仅断言
`typeof deployBundle === 'function'` 作为职责边界占位（真 T-023/T-024 在 orchestrator.test.ts）——非伪绿（真断言
确实在别处），但占了一个 test 槽却零验证。

**建议**：非阻塞。(a) 若要真守私钥不泄露，应构造一个真实含 `PRIVATE KEY` 内容的临时文件、走保存路径、再断言
落盘无内容；否则删注释澄清"路径-only 设计,内容永不入 store"。(b) 占位测可删或改为对 deploy/orchestrator 职责
分工的显式契约断言。

### Q6 · 桩保真度有界 + 真机锚点 skipIf 门控（CI 可能不跑）· severity: **low** · status: open · category: test-fidelity

**file**: `src/main/remote/__tests__/testKit.ts` · `src/main/remote/__tests__/sshLocalhost.integration.test.ts:13-44`

**description**：`createRoutedSsh` 的 exec 为字符串正则路由，不建模 ssh2 的 stderr/exit-code 细节；`sftpRename`
抛错建模"SFTP rename 目标已存在即失败"（与 ssh2/SSH_FXP_RENAME 语义一致 ✓）；默认 mkdir→LOCKED。桩失真风险
**有界且被两处锚定**：residency 的 `cmdlineMatchesHostTag` 纯函数测**同时覆盖 darwin 空格分隔与 linux `\0` 分隔**
两种真实 cmdline 格式（residency.test.ts:102-108，强，正面点名表扬），T-031 对真实 `SshConnection` 做
connect+forwardOut+sftp 往返做"桩不失真"锚点。**但** T-031 用 `it.skipIf(!REACHABLE)`——headless CI 无免密
sshd 时**不执行**，于是"桩保真度锚点"在 CI 里可能从不跑（本地评审机上也 skip 了，见 1 skipped）。TC 落地风险
#1/#3 依赖 T-031 做真机锚点，该依赖在 CI 条件性失效。降级本身诚实（skip 原因写进测试名并点名替代 DI 测，
sshLocalhost.integration.test.ts:26-31，**不伪绿，正面肯定**）。

**建议**：非阻塞。CI 里择机起 loopback sshd（或 GH Actions `ubuntu` runner 装 openssh-server + 免密到
localhost）让 T-031 至少每日/合并前跑一次，把"桩不失真"从"本地偶发"提为"CI 有据"；或接受现状并在 TC/DEV.md
显式记录"桩保真锚点仅本地按需"。

## 正面确认（质疑后回读证实为真断言,非形式覆盖）

- **residency 决策守门（最高风险 · ARCH-B8）真实成立**：
  - T-034 兄弟永不误杀 = **强断言**：3 种 cmdline 变体（含别 tag / 无 tag / **前缀碰撞 `${CONFIG_ID}-extra`** /
    **PID 复用**——端口文件 tag=configId 但进程 cmdline tag=vps-other）全断言 `kill:false`；决策函数结构上把
    `kill:true` **仅**限定在 reapThenDeploy 分支（residency.ts:75-88），"kill 从不出现在其余三分支"是代码级不变量。
  - T-033 不 livelock = **强断言**：纯决策层断言 probe 失败→`reapThenDeploy`（非再 claim）；执行层
    `resolveResidency` 测（residency.test.ts:139-182）进一步断言候选隧道被关、`kill 222` 发出、`rm -f host.port`
    执行、且用 `killSent` 状态机让 `kill -0` 回 N 避免真实轮询超时——设计精巧、忠实。
  - `cmdlineMatchesHostTag` argv 全等分词（非裸 substring）拒前缀碰撞（residency.ts:49-57 + 测 L105）。
- **安全 AC 可执行断言到位**：AC-3 磁盘零明文（密文经 encrypt 桩 + 落盘不含明文子串 + 往返一致 + safeStorage
  不可用则拒存不落盘）；AC-8 端口文件**真实子进程** openSync('wx')/0600/陈旧 EEXIST fail-closed exit1/内容不被
  覆盖（无 TOCTOU）/ --host-tag 不入 token 闸（真 ws 错 token 拒、对 token 放行 + 源码结构断言）；AC-9 断言
  **恰好 emit 1 次**（比契约 ≤1 更强）+ 纯函数窗口边界（59999ms/60000ms）齐全；AC-10 真 ws upgrade 异源拒、
  file://·null·无头放行、合法源+错 token 仍拒（token 主屏障 + Origin 纵深）。
- **诚实降级**：T-031 skipIf + skip 原因入测试名点名替代覆盖，不伪绿。
- **失败五分类 + 重试/断连/删除清凭据**均有 test（AC-2/11/12/14），in-flight guard（ARCH-B3）亦补测。

## verdict

**NEEDS_REVISION**（阻塞项仅 1 条 · 其余非阻塞）。

理由：实现整体质量高——最高风险的 residency 决策守门与全部安全 AC 都是真断言，architect blueprint 阶段的
ARCH-B8/R2V-1 关切在实现里已被强断言闭合。但 **AC-6 是 P0，其运行时行为零覆盖，而 `verify-ac.py` 因 TC.md
映射到不存在的 T-012/T-013 而报绿**——这是门禁完整性缺陷叠加 P0 覆盖缺口（Q1），必须先修：补 AC-6 的
incompatible→failed+disconnect 行为断言（orchestrator 层最小即可）并让机读门禁停止报幽灵覆盖。Q2（host 侧
token 落盘/日志证否）、Q3（AC-7 倒序行为断言）建议随修一并补齐；Q4/Q5/Q6 为非阻塞改进项，dev 阶段酌情处理。

修完 Q1（+建议的 Q2/Q3）即可转 APPROVE。
