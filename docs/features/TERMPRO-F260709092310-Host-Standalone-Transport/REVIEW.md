---
reviewers: [architect, qa, external]
verdict: APPROVE
findings:
  - {id: F1, severity: MAJOR, status: fixed, title: "fs.watch 集成测首事件预算 3000ms 满负载下不足(T-032/033/042/043)+ T-038 echo 5s 与同族 12s 不一致,偶发失败污染三绿门", source: qa}
  - {id: F2, severity: MAJOR, status: fixed, title: "AC-4/TC-F05 明列的 linux-arm64 产物在打包脚本与 CI 矩阵中完全缺失", source: qa}
  - {id: F3, severity: MAJOR, status: fixed, title: "token 空值 fail-open:file/fd/stdin 三通道 trim 后无非空断言,空白 token 源使端口闸恒通过(verifyToken('','')===true)", source: external}
  - {id: F4, severity: MINOR, status: fixed, title: "TC frontmatter test_refs 文件名失真(host-package-smoke.yml → 实际 host-package.yml)", source: qa}
  - {id: F5, severity: MINOR, status: fixed, title: "WS RPC parity 20 方法测 18:git.show / git.changedFiles 未经 WS 往返", source: qa}
  - {id: F6, severity: MINOR, status: deferred, title: "WS upgrade 无 Origin 校验(纵深加固;token 熵仍是真屏障)", source: external}
  - {id: F7, severity: MINOR, status: deferred, title: "认证失败告警越阈后每次失败重复 emit,坏 token 洪泛刷 WARN 日志(建议节流)", source: arch}
  - {id: F8, severity: MINOR, status: deferred, title: "边界缺口组:恰好 32MiB 帧/逐字节慢速 host.info/pong 迟到非丢失/握手风暴", source: qa}
  - {id: F9, severity: MINOR, status: deferred, title: "token 运维面:generated token stdout 可能被日志采集落盘 + token-file TOCTOU/符号链接(归 BL-003 部署流程)", source: external}
  - {id: F10, severity: MINOR, status: rejected, title: "host.info-first 门控安全价值仅协议卫生(非鉴权边界)", source: arch}
  - {id: F12, severity: NIT, status: deferred, title: "验证轮 info 组:poke 临时文件不清理/T-038 余量备注/startWsServer 入口纵深断言(无可达旁路)", source: external}
  - {id: F11, severity: NIT, status: deferred, title: "门控实现细节组:非数字 id 边缘/done-flip 时序依赖/握手前分配 Client/双 connection 处理器/打包脚本探测面/连接数上限(→BL-003/005)", source: arch}
---
# REVIEW 汇总(Round 1 · 全量评审)

> 汇总层。三份独立产物:REVIEW-arch.md(A-1..A-8 · 建议 APPROVE)/ REVIEW-qa.md(Q1-Q6 · 建议 changes_requested)/ external-cross-review/review-claude-subagent-degraded.md(CR-1..6 · 降级同模型冷审 · 非异质)。
> 门禁独立复核:tsc 0 err · vitest 348 静默环境全绿(满负载偶发见 F1)· SMOKE_OK · darwin VERIFY_OK(PMO 复跑)。红线全绿:host 零 Electron / 嵌入式零侵入(T-013/T-063 锚定)/ 契约先改 protocol.ts。安全主路径 arch 逐条实证通过:env 读后即抹时序、常量时间比较、loopback 强制、归属守卫无漏网、心跳/握手双回收、token 不入错误日志。

## 源 finding 映射

| 统一 id | 来源 | 交叉印证 |
|---|---|---|
| F1 | Q1(MAJOR) + A-1(MINOR) + A-2 + dev 阶段 concerns WARN | 三源命中同一根因;QA 满负载 10 跑复现 2 次定位 T-032 |
| F2 | Q2(MAJOR) | PRD AC-4 / TC-F05(T-057) PMO 核实原文 |
| F3 | CR-1(high) + Q5(MINOR) | PMO 核实 token.ts:82/87/91 三通道无非空断言 |
| F4 | Q3 | — |
| F5 | Q4 | — |
| F6 | CR-2 | — |
| F7 | A-4 | — |
| F8 | Q6 | — |
| F9 | CR-4 + CR-5(合并:token 运维交接面) | — |
| F10 | A-3(+ CR-3/A-5 的实现细节归 F11) | — |
| F12→F11 | A-5/A-6/A-7/A-8 + CR-3 + CR-6(合并 NIT 组) | — |

## 逐条裁决(质疑 → 确认 → 裁决)

### F1 · MAJOR · open(confirmed · 本轮必修)
- **质疑**:arch 定 MINOR(测试基建非产品 bug);QA 定 MAJOR。测试预算问题配 MAJOR 吗?
- **确认**:QA 满负载 10 次全量复现 2 次并定位到 `wsRpcParity.test.ts:140` waitFor 3000ms(300ms 去抖 + FSEvents 无界延迟 + WS 投递);与 dev 阶段 concerns WARN 记录的 2 次偶发完全对上。arch 独立压测(CPU 燃烧/双 vitest 并发)静默全绿,证明产品链路无 bug、纯预算问题。
- **裁决**:confirmed MAJOR —— 本项目「三绿才提交」是硬门禁,偶发红污染门禁纪律,且已实际发生 2 次。修法:T-032/033/042/043 首事件预算 3000→8000ms+;T-038 echo 5s 对齐同族 12s(A-2 并入)。🔴 不改假定时器(这些用例本意就是真实 FSEvents+WS 链路)。

### F2 · MAJOR · open(confirmed · 本轮必修)
- **确认**(PMO 核实 PRD 原文):AC-4 明列「打包矩阵含 linux-arm64 产物(不实机验收)」+ TC-F05(T-057)`linux_arm64_artifact_present_no_real_machine_run`;grep 全 .github/scripts 零命中,TECH spike 结论也未覆盖。AC 子项确定性缺口。
- **裁决**:confirmed MAJOR。修法:package-host.mjs 支持 linux-arm64 native 来源(本机 Apple Silicon docker linux/arm64 容器原生速度编译)+ CI 增 linux-arm64 组装 job(不实机验收,产物存在性即验收;可用 docker/qemu 或 arm runner)。spike 结论同步回写 TECH。

### F3 · MAJOR · open(confirmed · 定级裁决:external high + QA MINOR → MAJOR)
- **质疑**:需运维错配前提(空白 token 文件/空 fd),是否只算 MINOR 加固?
- **确认**(PMO 回读 token.ts):env 通道有 `!== ''` 守卫(L69),但 file(L82)/fd(L87)/stdin(L91)三通道 `.trim()` 后直接返回,无非空断言;`verifyToken('','')` sha256 自等恒真;客户端 `?token=` 取出为 `''` 非 null。空白 token 源 → 端口闸完全失效,**确定性 fail-open**。安全闸的失败语义必须 fail-closed —— 错配应当拒绝启动而非静默放行。
- **裁决**:confirmed MAJOR(确定性安全缺陷;非 BLOCKER 因需错配前提且正确配置下不可达)。修法:resolveToken 所有通道 return 前断言非空(空/全空白 → 抛错拒启动);补 file/fd/stdin 空 token 三用例 + 空串连接被拒集成断言。

### F4 / F5 · MINOR · open(低成本顺手)
- F4:TC.md frontmatter test_refs 指向不存在的 host-package-smoke.yml(实际 host-package.yml),文档失真一行改。
- F5:T-031 parity 方法表补 git.show / git.changedFiles 两方法(harness 现成,增量极小)。

### F6 · MINOR · deferred — Origin 校验属纵深(loopback+token 已是威胁模型内屏障);BL-003 远程形态一并设计。
### F7 · MINOR · deferred — 告警节流,运维体验项,defer(与 F9 同批)。
### F8 · MINOR · deferred — 边界补测组,defer → 待规划池(测试补强)。
### F9 · MINOR · deferred — token 交接/落盘运维面归 BL-003 部署流程设计(PRD 亦将部署编排划出本 Feature)。
### F10 · MINOR · rejected(带依据)— TECH §安全明确门控定位=协议卫生、token=唯一鉴权屏障,实现与设计意图一致;观察正确但非缺陷。
### F11 · NIT · deferred — 实现细节组(均在威胁模型内/不可达边缘),BL-003/005 接手连接管理时统一处理。

## 修复建议(本轮 fix 范围)
1. **F1**:四用例预算 3000→8000ms + T-038 对齐 12s。
2. **F2**:linux-arm64 组装(本机 docker linux/arm64 验证一次)+ CI job + TECH 回写。
3. **F3**:token 全通道非空断言 fail-closed + 3 单测 + 1 集成断言。
4. F4/F5 顺手。
修复门禁:tsc + vitest 全绿 + SMOKE_OK;不夹带 deferred 项。

## verdict
**NEEDS_REVISION** —— open MAJOR ×3(F1/F2/F3)。其余 advisory 已裁决留痕。

## 修复说明(Round1 fix · 2026-07-10)

- **F1(root-cause 重判 · 单纯拉长预算不能修复)**:首轮 3000→8000ms 的预算调整验证不足 —— PMO 全量复跑 2 轮各挂 1-2 例(T-032/T-043 `waitFor timed out`),但两文件隔离跑 17/17 全过,证明不是「预算不够」而是**死窗口丢事件**:`fs.watch(path, {recursive:true})` 在 macOS 上底层绑定 FSEvents,RPC 调用返回 watchId 的时刻 ≠ FSEvents 流已实际开始接收事件(流启动本身异步,全量 39 文件并行跑时可能被系统调度推迟);若「fs.watch 返回后的第一次写」恰好落在这个尚未就绪的死窗口内,该次变更事件永久丢失、不会补发 —— 此时无论等待预算多长都注定超时,因为是「丢」不是「慢」。隔离跑时流启动够快所以从未撞上死窗口,掩盖了问题。**修法**:`src/host/__tests__/wsTestHarness.ts` 新增 `pokeUntilFsEvent(client, watchId, dir, {budgetMs=8000, pokeIntervalMs=1000})` —— 循环「写一个新文件名(避免去重)→ 等 ≤1s 看 fsChanged 是否含 watchId」直到命中或预算耗尽,把「死窗口丢失」转化为「预算内最终必达」(只要某一次 poke 落在流已就绪的窗口内即可收到)。`wsRpcParity.test.ts` T-032/T-033、`wsMultiClientIsolation.test.ts` T-042/T-043 的**正向首事件等待**均改用该辅助;T-032「去抖后不重复堆积」断言维持 `toBeGreaterThanOrEqual(1)`(原意保留,poke 期间命中即停,不会造成堆积误判)。🔴 未动:T-033 unwatch 后两处 `delay(1200)` 负向等待窗、T-043 `delay(500)` 去抖余量窗 —— 均为「验证不再收到」的负向等待,与本次根因无关,拉长只会白等;未改任何假定时器。**验证**:`npx vitest run` 全量连续跑 3 轮,每轮均 39 files / 352 tests 全绿(非隔离跑)。
- **F2**:`scripts/package-host.mjs` 确认已支持(无需改代码)—— `--platform` 只是产物标签、`--native-dir` 可显式指定 native 来源目录,组合 `--platform linux-arm64 --native-dir <dir>` 即可组装该平台产物。本机 Apple Silicon 验证:① docker `--platform linux/arm64`(node:20-bookworm)原生速度装 `node-pty@1.1.0`,产出 ELF aarch64 `pty.node`;② `package-host.mjs --native-dir <该产物>` 在本机(macOS)纯文件操作组装出 linux-arm64 产物 + tar.gz;③ 加分验证(AC-4 不要求实机验收,但做了):在**干净的** `node:20-bookworm-slim`(容器内确认无 gcc/编译工具链)里跑 `scripts/verify-host-artifact.mjs` —— 握手 + `pty.spawn` + echo 真实回传全部通过,输出 `VERIFY_OK`,证明产物自包含可实机运行(超出「存在性」判据)。CI:`.github/workflows/host-package.yml` matrix 增第三项 `ubuntu-24.04-arm / linux-arm64`(其余步骤已用 `matrix.platform`/`matrix.os` 参数化,零特判直接复用打包+验证+上传全流程)。**方案选择**:选原生 `ubuntu-24.04-arm` hosted runner,未退回 `ubuntu-latest`+QEMU 仅存在性检查的备选方案 —— 理由是本地已用同架构(Apple Silicon docker 原生 arm64)完整跑通「装 node-pty → 组装 → 干净容器实机验证」全链路且全绿,原生 runner 复现同一路径的风险低于 QEMU 仿真下 node-gyp 源码编译的不确定性,且能获得比 AC 要求更强的验证证据。TECH.md D-1/spike 结论段落补 linux-arm64 一整段(位置:「D-1 spike 结论」小节末尾)+ 变更记录追加一行。
- **F3**:`src/host/token.ts` 新增 `requireNonEmptyToken(token, description)` 辅助函数(与既有 `--token` 明文拒绝/文件权限拒绝同款「`[host] refusing ...`」措辞风格),应用于 file(L82 附近)/fd/stdin 三通道 `trim()` 之后、`return` 之前 —— 空/全空白 → 抛结构化错误拒绝启动(fail-closed)。env 通道既有 `!== ''` 守卫、generated 通道恒非空,均未改动。新增测试(均在 `src/host/__tests__/tokenGate.test.ts`,describe 块 `AC-3 token 空值 fail-closed (单元 · F3 回归)`):① `--token-file 指向空白文件 → 抛错拒绝启动`;② `--token-fd 空内容 → 抛错拒绝启动`;③ `--token-stdin 空 → 抛错拒绝启动`。另加集成断言 `客户端 ?token= 空串在正常(非空)token host 上被拒(F3 回归)`(置于既有 `T-019` 前)——确认此前无显式测试覆盖「query 参数存在但值为空串」这一路径(`url.searchParams.get('token')` 对 `?token=` 返回 `''` 而非 `null`,与「参数完全缺失」是两条不同代码分支),故补上而非仅确认。
- **F4**:`docs/features/TERMPRO-F260709092310-Host-Standalone-Transport/TC.md` frontmatter 内 T-053~T-059 共 7 处 `file: .github/workflows/host-package-smoke.yml` → `.github/workflows/host-package.yml`(实际文件名)。
- **F5**:`src/host/__tests__/wsRpcParity.test.ts` T-031(全 RPC 方法表 WS roundtrip)新增 `git.show`(`toplevel/HEAD/package.json`)与 `git.changedFiles`(`toplevel`)两次 RPC 调用,并与 `gitService.ts` 直接调用结果 `toEqual` 比对,补齐 harness 现成、此前 20 方法表里唯二未经 WS 往返验证的两个方法。

**验证门禁(本轮 fix 后独立复跑)**:`npm run typecheck` 0 err;`npx vitest run` 全量**连续 3 轮**,每轮均 39 files / 352 tests 全绿(较 fix 前 348 增加 F3 新增 4 条测试;非隔离跑,针对 F1 root-cause 重判的复现条件专项验证);`TERMPRO_SMOKE=1 npx electron-forge start` 输出 `SMOKE_OK`。三项均在本 worktree 内验证,未夹带 F6-F11 deferred/rejected 项改动。

## Round 2 验证轮(范围锁定 · 逐条裁决 + 修复 diff 回归)

> 修复 commit `e10fe00`。PMO 独立复核:tsc 0 / 全量 vitest 352×3 轮连续绿 / SMOKE_OK;external 验证冷审独立裁决(verify_fixes: true · target_commit e10fe00)。

### 上轮 open finding 裁决
- **F1 → fixed(根因重判)**:非延迟预算问题——fs.watch 的 FSEvents 流异步启动,全量并行下流启动推迟,紧跟的唯一写落入死窗口事件永久丢失。修法 = harness `pokeUntilFsEvent` 持续 poke 至首事件必达;负向断言未削弱。PMO 复核修法前全量 2 轮各挂 1-2 例、修法后 3 轮全绿;external 独立复测稳定。
- **F2 → fixed**:linux-arm64 docker 原生编译 + 组装 + 干净 slim 容器 VERIFY_OK(超出 AC-4 存在性判据);CI matrix 增 ubuntu-24.04-arm(原生 runner · 理由留档 TECH)。
- **F3 → fixed**:requireNonEmptyToken 三通道 fail-closed;+4 测试;expected token 恒非空使 ?token= 空串旁路从源头闭合。
- **F4/F5 → fixed**:TC 引用×7 校正;T-031 parity 补齐 20/20 方法。

### 修复 diff 回归审查
新问题仅 3 项 info(poke 临时文件不清理/超时余量备注/入口纵深断言无可达旁路)→ 合并为 F12(NIT · deferred)。无 blocker/high、无回归。

### verdict(Round 2)
**APPROVE** —— 无 open BLOCKER/MAJOR;deferred(F6-F9/F11/F12)随 ship 入待规划池,rejected(F10)带依据留痕。
