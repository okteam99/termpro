---
reviewer: qa
feature_id: TERMPRO-F260709092310-Host-Standalone-Transport
review_range: c66b717..HEAD
verdict_recommendation: changes_requested
summary: >-
  AC-1/2/3/5/6/7 功能与安全面逐条落地且集成测真跑 standalone host(非 mock),
  归属回归门(pty.kill/pty.cwd)实锤闭合,AC-5 有强非-SMOKE 锚定。但 (Q1) 已定位
  state.json 的偶发闪断用例 = T-032 fs.watch 首事件 3000ms 预算在满负载并行下不足
  (10 次全量跑复现 2 次,附行号与错误),(Q2) AC-4 明列的 linux-arm64 产物在 CI
  与脚本中完全缺失。两条 MAJOR 均有实证,无 BLOCKER。
findings:
  - id: Q1
    severity: MAJOR
    ac: [AC-1]
    title: T-032(及同族 T-033/T-042/T-043)fs.watch 首事件 waitFor 预算 3000ms 在满负载下不足,偶发 `waitFor timed out`
    evidence: "全量 348 测试反复跑 10 次复现 2 次;失败点 src/host/__tests__/wsRpcParity.test.ts:140 → wsTestHarness.ts:219 `Error: waitFor timed out`"
  - id: Q2
    severity: MAJOR
    ac: [AC-4]
    title: AC-4 明列「打包矩阵含 linux-arm64 产物」在 CI(host-package.yml matrix)与 scripts 中完全缺失
    evidence: "host-package.yml matrix 仅 darwin-arm64+linux-x64;grep linux-arm64 全 .github/scripts 零命中;TECH spike 结论亦未产出 linux-arm64 产物;TC-F05/T-057 无对应 job"
  - id: Q3
    severity: MINOR
    ac: [AC-4, AC-5]
    title: TC.md frontmatter 的 AC-4/AC-5 test_refs 文件名失真(指向不存在的 host-package-smoke.yml)
    evidence: "TC.md T-053..T-059 file 写 `.github/workflows/host-package-smoke.yml`,实际文件是 host-package.yml;T-060 指向 release.yml 的 embedded smoke,本 changeset 无该 job 证据"
  - id: Q4
    severity: MINOR
    ac: [AC-1]
    title: AC-1「全 RPC 方法表」中 git.show / git.changedFiles 两方法从未经 WS 往返(TC-C01 列举 20 方法,实测缺 2)
    evidence: "grep git.show/git.changedFiles 在 src/host/__tests__ 零命中;传输层 method-agnostic 故功能等价可推定,但显式覆盖缺失"
  - id: Q5
    severity: MINOR
    ac: [AC-3]
    title: 空 token 未 fail-closed(--token-file 空文件 → token=''，verifyToken('','')→true,任意带空 token 连接可通过)
    evidence: "token.ts resolveToken 对空文件返回 trim 后空串;wsServer 接受;属显式误用且 PRD 未要求拒绝,但建议 host 侧空 token 拒绝启动"
  - id: Q6
    severity: MINOR
    ac: [AC-3, AC-6, AC-7]
    title: 边界覆盖缺口清单(恰好 32MiB 上限 / 慢速逐字节 host.info / pong 迟到非丢失 / 并发握手风暴)
    evidence: "见正文边界清单;各对应路径未见 bug,均判 MINOR 覆盖缺口"
---

# BL-002 QA 评审 — Host Standalone 可执行 + WebSocket 传输 + 协议握手

评审范围 `git diff c66b717..HEAD`(de7cbac 阶段 A–E + 8570979 阶段 F)。本 QA 复核在 worktree 内实跑:`tsc --noEmit` 0 报错;`npx vitest run` 全量 39 files / 348 tests;并对 state.json 的偶发闪断做定向复现。

## 结论摘要

**verdict 建议:changes_requested(需修 · MAJOR×2 · 无 BLOCKER)。**

AC-1/2/3/5/6/7 的功能与安全面逐条有实现、有测试,集成测是**真跑 standalone host**(`createHostCore` + `startWsServer('127.0.0.1:0')` + 真实 `ws` 客户端 + 真实 node-pty 登录 shell),不是两端 mock;`verify-host-artifact.mjs` 起真实子进程做端到端验证。两条现网漏洞(pty.kill / pty.cwd 缺归属校验)的回归门 T-041 / T-041b 实锤闭合。AC-5 零回归有强非-SMOKE 锚定(T-063 用 v999 不兼容 host 仍连上,直接钉死版本门控不侵入嵌入式)。

两条需修:
- **Q1(MAJOR)**:我把 state.json WARN 里"未定位到用例"的偶发闪断**定位到了 T-032**——fs.watch 首个 `fs:changed` 事件的 `waitFor(..., 3000)` 预算在 39 文件并行、CPU 饱和时不足,事件迟到即超时。非产品缺陷(无争用时 822ms 稳过,事件最终必达),纯测试预算过紧,但它会让 CI 三绿门偶发变红。修复零风险(抬预算)。
- **Q2(MAJOR)**:AC-4 与 PRD 交付预期明列"打包矩阵含 linux-arm64 产物(不实机验收)",但 CI matrix 与打包脚本里**根本没有 linux-arm64**,产物不存在。

## AC 逐条对照表

| AC | 实现(文件:行) | 覆盖测试 | 判定 |
|----|--------------|---------|------|
| **AC-1** 全功能等价冒烟 + fs.watch 推送 | hostCore.ts:130-254 RPC 分发(传输无关);wsServer.ts:54-162 wsPortAdapter | T-031(fs/git/pty/watch 大冒烟)、T-032/033(fs.watch 推送/停推)、T-034/035(PTY 生命周期+流控)、T-036(git.info/status 等价)、T-037(readFileBinary base64 等价)、T-038(text frame)、T-049(近上限大帧) | ✅ 达成(缺口见 Q1/Q4) |
| **AC-2** 版本区间校验(客户端单方)+ host.info-first 门控(仅 WS) | versionCompat.ts:16-84;hostClient.ts:198-208 校验+主动断开;wsServer.ts:64-113 门控状态机+queueMicrotask 延迟开闸 | T-001..007(闭区间矩阵+缺省)、T-008..012(门控四场景收敛)、T-013(嵌入式不门控) | ✅ 达成 |
| **AC-3** token 闸(熵/常量时间/信道/生命周期) | token.ts 全文;wsServer.ts:203-222 upgrade 零信息 destroy;host.ts:39-49 env 读后即抹置于 spawn 前 | T-014(128bit)、T-015(常量时间结构+行为)、T-016/17/18(缺失=错误不可区分)、T-019、T-020/21(告警不阻断)、T-022(loopback 强制)、T-023、T-024(禁 argv)、T-025-28(信道白名单)、T-029、T-030(不泄露进 PTY) | ✅ 达成(空 token 见 Q5) |
| **AC-4** 打包 spike(darwin-arm64/linux-x64 实机 + linux-arm64 产物) | package-host.mjs、verify-host-artifact.mjs、host-package.yml | verify-host-artifact 真机 VERIFY_OK(darwin-arm64 本机 + linux-x64 docker);CI 两平台 job | ⚠️ **部分**:双平台实机达成;**linux-arm64 产物缺失(Q2)** |
| **AC-5** 嵌入式零回归 + 门控不侵入 | host.ts:79-106 嵌入式分支语义不变;hostCore.attachClient 一字未加门控;hostClient.ts:151-171 MessagePort 路径无版本/token 校验 | T-013、T-061(API 签名不变)、T-062(无新增往返)、T-063(版本门控不在嵌入式触发)、SMOKE_OK | ✅ 达成(锚定充分) |
| **AC-6** 多客户端隔离(sessionId+watchId+kill/cwd 归属+静默断连) | hostCore.ts:92-106 pty:* 归属校验、159-177 kill/cwd 守卫、111-121 精准回收;wsServer.ts:236-256 心跳 | T-039/040(input/resize 越权忽略)、T-041/041b(kill/cwd 越权拒绝-回归门)、T-042/043(watchId 隔离+不广播)、T-044(clean 断开)、T-045(静默断连)、T-046(交错帧不串扰) | ✅ 达成 |
| **AC-7** 畸形输入不崩 host、只断发送方 | wsServer.ts:82-94 非 JSON→terminate、120-123 error 兜底;WS maxPayload=32MiB;hostCore.ts:244-253 per-RPC try/catch | T-047(非 JSON)、T-048(超限)、T-050(未知类型)、T-051(缺 method)、T-052(综合存活性) | ✅ 达成 |

**AC-5 专项(团队关注点):**门控/token/版本逻辑确实**只夹在 wsServer/wsPortAdapter 层**,`hostCore.attachClient` 与 MessagePort 路径零改动;除 SMOKE 外由 T-063(v999 不兼容 host 经嵌入式仍 resolve)、T-062(嵌入式仅一条 host.info、无 hello/welcome)、T-013(嵌入式首条 pty.spawn 不被门控)三条非-SMOKE 回归测锚定。此关注点**已充分覆盖**。

**AC-4 专项(团队关注点):**"打包产物验收 = spike 结论产物"在 darwin-arm64 + linux-x64 两平台成立(verify-host-artifact 真起进程做 token 握手 + host.info-first + 真实 pty.spawn /bin/sh + echo 回传匹配)。**唯 linux-arm64 产物缺席**(Q2)。

## TC.md T-001..T-052 逐条落地核对

| 区段 | 落地 | 备注 |
|------|------|------|
| T-001..007(版本矩阵/缺省) | ✅ 全部 | hostClientVersionCheck.test.ts,矩阵 6 行 + 命名 it 双写 |
| T-008..013(门控/嵌入式) | ✅ 全部 | T-010 用 cork/uncork 强制 pipeline 确定化,设计合理 |
| T-014..030(token) | ✅ 全部 | T-016/17/18 合并为一 it、T-020/21 合并——等效可接受 |
| T-031..038(传输等价) | ✅ 落地,**T-031 缺 git.show/git.changedFiles**(Q4) | T-031 大冒烟覆盖 18/20 方法 |
| T-039..046(隔离) | ✅ 全部 | T-041/041b 回归门真实(修前必失败,现拒绝越权) |
| T-047..052(畸形) | ✅ 全部 | T-048/049 用 512KB 缩放上限做成对边界,等效可接受 |
| T-053..059(AC-4 CI) | ⚠️ 部分 | host-package.yml 覆盖 T-053-056/058;**T-057 linux-arm64 缺失(Q2)**;T-059 条件项(spike 成功未触发,N/A);frontmatter 文件名失真(Q3) |
| T-060..063(AC-5) | ✅ T-061/062/063 落地;T-060 embedded electron smoke 属 release.yml,本 changeset 无该 job 证据(Q3) | |

等效实现判断:合并用例(T-016/17/18、T-020/21)与缩放上限(T-048/49)**可接受**——断言意图与场景结构未丢。git.show/git.changedFiles 因传输层 method-agnostic,功能等价可推定,但列为 Q4 覆盖缺口。

## 边界场景清单(显式列未覆盖项)

| 边界 | 覆盖 | 判定 |
|------|------|------|
| token 空串(空 token-file) | ❌ 未防御,verifyToken('','')→true | Q5 MINOR(fail-closed 建议) |
| token 超长 / 非 hex / 非 base64url | ✅ 隐式(sha256 先定长,字符集无关) | 无需专测 |
| 缺失 vs 错误 token 不可区分 | ✅ T-018 | — |
| 握手中断连 / 首条非 host.info / 超时 | ✅ T-009/010/011/012 | — |
| 慢速逐字节 host.info(多 TCP 段) | ❌ 未锚定(ws 仅完整帧 emit,理论安全) | Q6 覆盖缺口 |
| 并发连接/握手风暴 | ◻️ 仅 T-020 的 12 连接(测告警,非路由压力) | Q6 覆盖缺口 |
| 心跳 pong 丢失(完全静默) | ✅ T-045 | — |
| 心跳 pong 迟到但下周期前到达(不应误杀) | ❌ 未覆盖 | Q6 覆盖缺口 |
| WS 大帧恰好 32MiB 上限 | ◻️ 用 512KB 缩放边界等效(T-048/49),绝对值 32MiB 未直接实证 | Q6 覆盖缺口(等效可接受) |
| 版本闭区间下界含等号两侧 | ✅ TC-A01 T-003/004/005/006,数学完备 | — |

## 时序脆弱性专项(团队 WARN 定向复现)

**已定位 state.json WARN 的偶发闪断用例 = T-032。** 复现方法与结论:

- **隔离跑**(仅 host 测 / 仅 wsRpcParity+wsMultiClientIsolation)+ 8 线程 CPU 争用:各 3–5 次**全绿**,T-032 稳定 ~822ms、T-033 ~2720ms。
- **全量 `npx vitest run`(39 文件并行)**:10 次跑**复现 2 次**在同一点失败——
  ```
  FAIL wsRpcParity.test.ts > T-032 目录变更经同一 WS 推 fs:changed 且仅一次(去抖)
  Error: waitFor timed out
   ❯ Module.waitFor src/host/__tests__/wsTestHarness.ts:219:22
   ❯ src/host/__tests__/wsRpcParity.test.ts:140:5
  ```
  wsRpcParity.test.ts:140 = `await waitFor(() => c.fsChanged.includes(watchId), 3000)`。

**根因**:fs.watch 首个 `fs:changed` 的到达链 = macOS FSEvents 原生延迟 + WatchService 去抖窗 + WS 文本帧投递。无争用时 <1s;当 39 个测试文件并行把 CPU 打满(全量跑的 tests 段耗时从 7s 涨到 10s),该链偶发 >3000ms,`waitFor` 即抛超时。**这是测试预算问题,不是产品缺陷**——事件最终必达,机制正确(T-033 后续 drain 都能收到)。

**最易闪断排序(真等待 + 紧预算,均在 CPU 争用下暴露)**:
1. **T-032**(wsRpcParity.test.ts:140)——已复现。同文件内有 T-034/035 的 2MB `cat`、真实登录 shell,worker 内自我争用最重,3000ms 首事件预算最紧 → 头号闪断源。
2. **T-033**(:153)——同款 3000ms 首事件 `waitFor`,同文件同 worker,风险与 T-032 同级(本轮侥幸未闪)。
3. **T-042 / T-043**(wsMultiClientIsolation:135/149)——同款 `waitFor(...fsChanged, 3000)`,但单 watcher、文件内 PTY 负载较轻,余量略大。
4. **T-045**(心跳静默断连,pingIntervalMs:60 + waitFor 4000ms)——真等待但 4000ms 对 ~120ms 判定余量充足,争用下我跑 5 次未闪,风险低。

**修复建议(不弱化断言意图)**:把 fs.watch **首事件**等待预算从 3000ms 抬到 ~8000ms(vitest testTimeout 已放宽到 20s,余量充足),覆盖 T-032/033/042/043 四处。这些用例断言的是"事件到达 / 停推",不是"到达时延 ≤3s",抬预算不改变验证意图。**优先改假定时器不可行**——这些用例故意跑真实 FSEvents + 真实 WS 投递(传输面契约必须真跑),假定时器会把被验证的真实链路 mock 掉,反而削弱 AC-1。故此处**抬真等待预算**是对的方向,不是改假定时器。

## Findings 逐条实证

### Q1(MAJOR · AC-1)T-032 fs.watch 首事件预算不足致偶发闪断
- **输入/复现**:worktree 内 `npx vitest run` 全量跑 10 次,第 3、7 次失败(2/10)。
- **行号/错误**:wsRpcParity.test.ts:140 `waitFor(() => c.fsChanged.includes(watchId), 3000)` → wsTestHarness.ts:219 `throw new Error('waitFor timed out')`。
- **错误行为**:满负载并行时首个 `fs:changed` 迟于 3000ms 到达,用例超时判失败,而机制正确(事件最终到达)。
- **定性**:确定性(可复现)测试缺陷,污染三绿门;非产品 bug。
- **建议**:T-032/033/042/043 的 watch 首事件 `waitFor` 预算 3000→~8000ms。

### Q2(MAJOR · AC-4)linux-arm64 产物缺失
- **实证**:`host-package.yml` matrix 仅 `{macos-14→darwin-arm64, ubuntu-latest→linux-x64}`;`grep -rn linux-arm64 .github scripts` 零命中;TECH §D-1 spike 结论只述 darwin-arm64 + linux-x64,未产出 linux-arm64。
- **要求出处**:PRD 交付预期表 + AC-4"打包矩阵含 linux-arm64 产物(不实机验收)"+ TC-F05/T-057。
- **错误行为**:该 AC 明列交付物不存在,无任何 job/脚本产出。
- **建议**:补一条 linux-arm64 组装 job(`package-host.mjs --platform linux-arm64 --native-dir <linux-arm64 pty.node>`,纯文件组装无需交叉编译工具链,与 spike 里 linux-x64 同法),或经用户确认将该子项降级/延期并回写 PRD。

### Q3(MINOR · AC-4/AC-5)TC frontmatter test_refs 文件名失真
- **实证**:TC.md T-053..059 `file: .github/workflows/host-package-smoke.yml`,实际文件 `host-package.yml`;T-060 `file: .github/workflows/release.yml` 的 embedded smoke job 在本 changeset 无证据。
- **影响**:traceability(verify-ac / 人工回溯)对不上真实文件。
- **建议**:校正 TC frontmatter 文件名。

### Q4(MINOR · AC-1)git.show / git.changedFiles 未经 WS 往返
- **实证**:`grep git.show|git.changedFiles src/host/__tests__` 零命中;TC-C01 列举 20 方法,T-031 实测 18,缺此二。
- **定性**:传输层 method-agnostic(hostCore 按 method switch,与传输无关),功能等价可推定,对应路径未见 bug → 覆盖缺口 MINOR。
- **建议**:T-031 大冒烟补两句 git.show/git.changedFiles WS 往返断言。

### Q5(MINOR · AC-3)空 token 未 fail-closed
- **实证**:token.ts:82 `--token-file` 空文件 `fs.readFileSync(...).trim()` → `''`;wsServer 以 expected=`''` 启动;verifyToken('','') → sha256 相等 → `true`,任意带空 `?token=` 连接通过。
- **定性**:需用户显式传空 token 文件(误用),PRD 未要求拒绝空 token;非现网可触发路径 → MINOR。
- **建议**:host 侧对空 token 拒绝启动(fail-closed),消除误配陷阱。

### Q6(MINOR · AC-3/6/7)边界覆盖缺口
- 见"边界场景清单":恰好 32MiB 上限(用 512KB 缩放等效)、慢速逐字节 host.info、pong 迟到非丢失、并发握手风暴——各对应路径未见 bug,均 MINOR 覆盖缺口,建议按优先级补测(不阻塞)。

## 正面确认(供裁决参考)

- **集成测真跑 standalone host**:wsTestHarness 起 `createHostCore` + `startWsServer('127.0.0.1:0')` + 真实 `ws` 客户端 + 真实 node-pty 登录 shell,非 mock;verify-host-artifact 起真实子进程。符合 TC "API E2E 真实进程/真实 socket" 要求。
- **归属回归门实锤**:T-041(A 无法 kill B 的会话,B 仍 echo B_ALIVE)、T-041b(A 读 B 的 cwd 返回 null,零信息);hostCore.ts:159-177 守卫到位。pty.cwd 越权返回 `{cwd:null}` 与 owned-but-no-pid 返回值不可区分,不泄露归属信息。
- **AC-3 安全面完整**:128-bit 熵、sha256+timingSafeEqual 常量时间、缺失/错误零信息不可区分、loopback 强制、禁 argv、env 读后即抹且不泄露进 PTY(T-030 用 shell 拼接 sentinel 防输入回显误触发,竞态处理讲究)。
- **AC-2 门控确定化**:T-010 用 cork/uncork 把 pipeline 第二帧压进同 TCP 段,配合 wsServer 的 queueMicrotask 延迟开闸,把非确定性收敛成确定断言——设计与测试互相咬合,合理。
- **tsc --noEmit 0 报错**;全量 348 tests 在无争用时稳定全绿。
