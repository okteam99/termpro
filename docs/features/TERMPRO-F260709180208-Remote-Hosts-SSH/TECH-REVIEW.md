---
tech_feature_id: TERMPRO-F260709180208-Remote-Hosts-SSH
review_stage: blueprint
review_rounds: 2
reviewers: [qa, architect, external]
verdict: APPROVE
reviews:
  - role: qa
    execution: subagent
    round_1_verdict: APPROVE
    round_2_verdict: APPROVE
    scope: "TC 作者 + TECH 可测性把关：AC↔test 覆盖(verify-ac 全绿 14/14)、residency 决策表守门断言(T-032~037 含兄弟不误杀/livelock 消解)、DI 接缝可测性(connectSsh 注入/shouldAlert 纯函数)、安全 AC 全可执行断言(无人工检查项)"
    doc: TC.md
  - role: architect
    execution: subagent
    round_1_verdict: NEEDS_REVISION
    round_2_verdict: APPROVE
    findings_count: 11
    doc: reviews/blueprint-architect.md
  - role: external
    execution: subagent
    heterogeneous: false
    degraded: true
    degraded_mode: config-disabled
    round_1_verdict: NEEDS_REVISION
    round_2_verdict: APPROVE
    findings_count: 9
    doc: external-cross-review/blueprint-claude-subagent-degraded.md
overall_verdict: APPROVE
db_schema_change: false
db_schema_pause_required: false
decided_at: "2026-07-09T19:55:00Z"
---

# TECH-REVIEW（TERMPRO-F260709180208-Remote-Hosts-SSH）· blueprint 两轮收敛

> 评审全文：`reviews/blueprint-architect.md`（architect · Round 1 + Round 2 verify）· `external-cross-review/blueprint-claude-subagent-degraded.md`（第三视角隔离冷审 · v8.204 yolo 默认介质 · Round 1 + Round 2 verify）。本文件为机读整合单源。

## 评审介质说明

- **architect**：opus 隔离 subagent 冷审（未参与起草）。
- **external（第三视角）**：worktree 无 localconfig，external-review 工具默认降级为**同模型 subagent 隔离冷审**（`review_via: subagent` · v8.204 yolo 默认——异质 codex opt-in 未在 worktree 生效）。非异质但**独立采样、冷上下文**，满足第三视角门禁（P0-154）。

## Round 1（NEEDS_REVISION · 20 findings 合并去重）

两路共同锁定 PRD 移交的 ARCH-11 must-resolve 区真实架构缺口（非措辞、控制流不可实现）：

| 缺陷组 | architect | external | 严重度 |
|--------|-----------|----------|--------|
| 认领回退 livelock + 兄弟 host 误杀（reap kill 先于 token 校验 · configId 只在 env 不在 argv 无区分度） | ARCH-B1 + ARCH-B2 | EXT-2 | **high** |
| 全局 bundle 无部署锁 + 跨实例版本 flap + 非原子覆盖 | ARCH-B4 | EXT-1 | **high** |
| CI 接线机制事实错（无 tag 触发 · needs 不跨 workflow · macOS 拿不到 linux 产物 · 版本偏斜） | ARCH-B7 | EXT-3 | **high** |
| connect() 缺 per-configId 在途互斥 | ARCH-B3 | EXT-4 | medium |
| RemoteHostsPage grounding 错（标「改」实为 greenfield 移植） | ARCH-B6 | EXT-5 | medium |
| FailReason 跨 main↔renderer 无单一事实来源 | — | EXT-6 | medium |
| residency 决策核心属性 TC 无可执行断言 | ARCH-B8 | — | medium |
| execDetached token EOF 时序（EPIPE 风险） | ARCH-B5 | EXT-9 | medium |
| DI 接缝未声明（static 难 mock）+ 节流未抽纯函数 | ARCH-B10 | EXT-7 | low |
| 端口文件相对/绝对路径不一致 | ARCH-B9 | — | low |
| Origin 白名单值集（确认正确 · 建议 spike 实证） | ARCH-B11 | EXT-8 | low |

## Round 2 修订（RD/QA · TECH v0.2 + TC 31→39 test）

三组 high 收敛为一致架构改动：① `--host-tag <configId>` 显式 argv + 认领验证前移 main（消 livelock）+ reap 双验（消兄弟误杀）；② bundle 版本隔离 `bundle/<appVersion>/` + `.deploying` O_EXCL 锁 + 原子 rename；③ CI 三架构 bundle 并入 tag 流水线（同 commit 现产 · 版本一致）。其余 8 项全 ADOPT。residency.test.ts 决策表 6 条（T-032~037）落可执行守门断言。

## Round 2 Verify（两路 APPROVE）

- **architect verify：APPROVE**。11/11 finding 有效消解；逐场景推演 B1/B2 收敛**真闭环**（认领到兄弟→probe 失败→reap 检 cmdline 不含本 tag→不 kill；PID 复用→双验不误伤；两 App 实例并发连同一机→版本隔离 bundle + per-config 端口文件→安全）。残留 3 条非阻塞（R2V-1 陈旧锁回收 / R2V-2 claiming→deploying 合法边 / R2V-3 精确 tag 匹配+probe 超时）。
- **external verify：APPROVE（有条件）**。9/9 消解；R2-1（high）指出部署锁在版本目录内会致 rename ENOTEMPTY 破 happy-path（真 bug）；R2-2（CI med）指出 build-macos 裸 needs 会因一腿失败跳过整个发版。均确切改法、非重架构。

## Round 3 残留折入（PMO · TECH v0.3 + TC 39→41 test）

两路 verify 的 5 条残留虽被评审判为「dev 阶段处理」，但 R2-1(high · happy-path breaker) 与 R2V-2(状态机自相矛盾) 值得在 blueprint 钉死防 dev 漏，PMO 直接折入 TECH：

| 残留 | 来源 | 处置（TECH v0.3） |
|------|------|-------------------|
| 部署锁在版本目录内→rename ENOTEMPTY | EXT R2-1 (high) | 锁移出版本目录 `bundle/.deploying-<v>` + rename 仅目标不存在时执行；T-039 mock 建模 rename-target-exists-fails + 锁在目录外 |
| `.deploying` 陈旧锁 wedge | ARCH R2V-1 | 锁写 {pid,ts} + age>120s break-and-reacquire；新增 T-039b |
| claiming→deploying/failed 合法边缺失 | ARCH R2V-2 | reducer 合法转移表登记两边；新增 T-010b |
| build-macos 一腿失败跳过整个发版 | EXT R2-2 (CI) | `if: !cancelled()` + 逐 arch 存在性判断（linux-x64/darwin-arm64 必需 · linux-arm64 允许降级） |
| probe 依赖 ws（首次 main 侧 import） | EXT R2-3 | 注明 ws 已在 deps · A0 spike 验证 main 能 require 'ws' |
| reap tag 裸 substring | ARCH R2V-3 / EXT R2-4 | argv 分词全等比对 |
| probe ws 无界超时/悬挂 | ARCH R2V-3 / EXT R2-5 | 10s 有界超时 + 用后 close |

## 整合结论

- overall_verdict: **APPROVE**（两路 Round 2 verify 均 APPROVE · Round 3 残留已折入 TECH v0.3/TC v0.3）
- **无数据库 schema 变更**（配置存 userData JSON + safeStorage 密文 · 无 §7.5 DB 暂停点）
- 移交 dev 的 spike 前置（A0 阶段）：① ssh2 打包后四能力（connect/forwardOut/sftp/exec）；② token-stdin EOF 三点时序（EPIPE 证否）；③ 打包版 renderer 经隧道真实 Origin 值实证；④ main 侧 require 'ws' 验证。
- AC 覆盖：verify-ac.py 全绿（14/14 AC · 41 test · unit 22 / integration 15 / api-e2e 2 / fe-e2e 2）
- 用户确认暂停点：yolo auto 代确认（三视角评审全真跑 · 两轮收敛 · 本文件 + concerns 留痕）
