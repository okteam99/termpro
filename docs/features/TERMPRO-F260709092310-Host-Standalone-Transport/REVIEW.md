---
reviewers: [architect, qa, external]
verdict: NEEDS_REVISION
findings:
  - {id: F1, severity: MAJOR, status: open, title: "fs.watch 集成测首事件预算 3000ms 满负载下不足(T-032/033/042/043)+ T-038 echo 5s 与同族 12s 不一致,偶发失败污染三绿门", source: qa}
  - {id: F2, severity: MAJOR, status: open, title: "AC-4/TC-F05 明列的 linux-arm64 产物在打包脚本与 CI 矩阵中完全缺失", source: qa}
  - {id: F3, severity: MAJOR, status: open, title: "token 空值 fail-open:file/fd/stdin 三通道 trim 后无非空断言,空白 token 源使端口闸恒通过(verifyToken('','')===true)", source: external}
  - {id: F4, severity: MINOR, status: open, title: "TC frontmatter test_refs 文件名失真(host-package-smoke.yml → 实际 host-package.yml)", source: qa}
  - {id: F5, severity: MINOR, status: open, title: "WS RPC parity 20 方法测 18:git.show / git.changedFiles 未经 WS 往返", source: qa}
  - {id: F6, severity: MINOR, status: deferred, title: "WS upgrade 无 Origin 校验(纵深加固;token 熵仍是真屏障)", source: external}
  - {id: F7, severity: MINOR, status: deferred, title: "认证失败告警越阈后每次失败重复 emit,坏 token 洪泛刷 WARN 日志(建议节流)", source: arch}
  - {id: F8, severity: MINOR, status: deferred, title: "边界缺口组:恰好 32MiB 帧/逐字节慢速 host.info/pong 迟到非丢失/握手风暴", source: qa}
  - {id: F9, severity: MINOR, status: deferred, title: "token 运维面:generated token stdout 可能被日志采集落盘 + token-file TOCTOU/符号链接(归 BL-003 部署流程)", source: external}
  - {id: F10, severity: MINOR, status: rejected, title: "host.info-first 门控安全价值仅协议卫生(非鉴权边界)", source: arch}
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
