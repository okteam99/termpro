---
feature_id: TERMPRO-F260710011342-Sidebar-Machine-Groups
stage: review
reviewers: [architect, qa, external]
base: origin/yolo/m5-remote-host
verdict: APPROVE
findings:
  - {id: F1, severity: MAJOR, status: fixed, title: "拖拽重排把本机子集下标当全量数组下标传给 moveWorkspace(多机下本机 ws 非前缀连续时拖错位+持久化)", source: external}
  - {id: F2, severity: MAJOR, status: fixed, title: "D-7 远程文件禁用漏三个系统打开按钮(openInBrowser/showItemInFolder/openPath 把远程路径交本机 shell)", source: arch+external}
  - {id: F3, severity: MAJOR, status: fixed, title: "import 集门禁(BL004-U-grepgate)整条未实现为 vitest(缺回归护栏·当前 GATE CLEAN 非活 bug)", source: qa}
  - {id: F4, severity: MINOR, status: fixed, title: "远程发现 ws 合成默认 tab 致徽标恒非 0(违反 AC-2/D-9 首连可为 0)+ 副作用远程机 auto-spawn PTY", source: external}
  - {id: F5, severity: MINOR, status: fixed, title: "Sidebar remoteConfigs 仅挂载拉一次·会话中增删远程机不刷新(新机不现/已删组仍在)", source: external}
  - {id: F6, severity: MINOR, status: fixed, title: "v2 remove/rename 对缺失 ws 兜底 {hostId:'local'} 可能把远程删改误发本机", source: arch}
  - {id: F7, severity: MINOR, status: fixed, title: "TC frontmatter 路径漂移(grepgate/routing/tabBadge/localBaseline 声明的测试文件与实现脱节)", source: qa}
  - {id: F8, severity: NIT, status: deferred, title: "Sidebar 镜像 RemoteHostsPage 握手编排双源(E6 断开在途过滤未复制·窄竞态)·active 回落两处分叉缺交叉注释·空 wsUrl 隐式依赖", source: arch+external}
overall_verdict: APPROVE
decided_at: "2026-07-10T04:05:00Z"
---

# REVIEW · BL-004 机器分组 Sidebar + 添加项目流程 · 三视角代码评审

> 全文见 `reviews/review-arch.md`（architect · approve_with_changes · A1-A5）· `reviews/review-qa.md`（qa · NEEDS_REVISION · Q1-Q5）· `external-cross-review/review-claude-subagent-degraded.md`（第三视角隔离冷审 · NEEDS_REVISION · E1-E6）。三路隔离 subagent。

## 地基验证（三路一致通过 · 无 BLOCKER）

三路逐场景推演真实代码，**作用域隔离核心闭环成立**（最高风险 blueprint E2 BLOCKER 区）：本机加项目不清远程组 · 远程 active 不被抢 · 远程快照不动本机 · forWorkspace 读兜底/forHostId 写拒绝 create 绝不落本机 · serialize v1+v2 双过滤 · 复合键 (hostId,sessionId) 不串 tab · 订阅生命周期无泄漏 · protocol.ts 零改 · 53 消费点迁移完整无残留 · tsc 0 错 · 本机零回归专测全绿。作用域隔离是**真捕获回归非形式覆盖**（双层纯函数+store 集成测）。

## findings（1 MAJOR arch + Q1 gate + 2 external MAJOR-ish · 余 MINOR/NIT）

- **F1 (external E1)**：拖拽下标错位——BL-004 头号多机场景日常可复现（连远程机→新建本机项目落远程之后→本机 ws 非前缀连续→拖错位+持久化）。
- **F2 (arch A1 = external E2)**：D-7 覆盖不全，三系统打开按钮漏守（同型静默开错本机文件）。
- **F3 (qa Q1)**：import 集门禁未实现为 vitest（缺回归护栏·手工跑 GATE CLEAN 故非活 bug·但缺 GO-027「测绿实则漏」同型护栏）。
- F4/F5/F6 MINOR · F7 TC 对齐 · F8 NIT（Sidebar 握手镜像双源/active 分叉注释·v1 可接受）。

## 处置（Round 2 修复 · dispatch d4-core/d4-term/d4-ui + PMO 补 F3）

- F1 → d4-core（addWorkspace 本机连续前缀不变式）+ d4-ui（拖拽子集→全量坐标翻译·双保险）
- F2 → d4-term（三按钮 aria-disabled+hint）
- F3 → PMO 补 hostClientImportGate.test.ts（perl 正则语义 + 守门元测试）✅
- F4 → d4-core（远程发现 ws 空 tabs·保首连 0 语义+免 auto-spawn）· F5 → d4-ui（remoteConfigs 刷新）· F6 → d4-core（缺失即 return）· F7 → PMO TC 对齐
- F8 → deferred（v1 可接受·复用面扩大前收敛单源）

## Round 2 Verify 结论（三路 APPROVE）

- **architect verify：PASS**。A1（三系统按钮 D-7 守卫·6 真测）+ A5（remove/rename 缺失 return）消解确认·F1 拖拽无新问题。新增 V-1（MINOR·非阻断）：F4 空 tabs 与创建回声竞态致主动创建远程 ws 常态 0 tab，与注释「主动创建保 1 tab」相悖→按方案 a 接受「远程 ws 一律 0 tab 起步」（与 D-9 自洽）+ **注释已修正**。
- **external 第三视角 verify：APPROVE**（建议放行 ship）。独立复跑门禁（非采信自述）：tsc 0 · vitest 681 passed · import 集零残留。E1（拖拽全量坐标系+前缀不变式双保险·回归测真红→真绿非绿桩）/E2（三按钮真闭环）/E3（空 tabs 真免 auto-spawn）/E4（5s 轮询+stopSync 真闭环）逐条独立验真。F3 import 门禁复核为真两层（遍历 renderer 树 + 守门元测试锁正则不退化五坑）非空桩。新增 V1（info/low）：E4 轮询无条件 setRemoteConfigs 触发重渲·纯性能微噪→**已加 list 等值守卫**。

**收敛**：地基作用域隔离三路一致闭环无 BLOCKER；2 MAJOR（拖拽下标+D-7 三按钮）+ Q1 门禁护栏 + 3 MINOR 全修；F8 NIT deferred；verify 新增 V-1（注释已正）+ V1（性能守卫已加）。三路 verify 一致 APPROVE。

overall_verdict: **APPROVE** · 门禁：tsc 0 错 · vitest 681 passed + 1 skip · import 集零残留 · verify-ac 11/11 真覆盖（TC 无幽灵测试）。
