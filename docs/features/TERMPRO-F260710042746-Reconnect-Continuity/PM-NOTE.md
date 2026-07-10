---
feature_id: "TERMPRO-F260710042746-Reconnect-Continuity"
author: PM
status: confirmed
decision: "approved_and_ship"
decided_at: "2026-07-10T08:13:00Z"
prd_ref: PRD.md (v0.4)
test_report_ref: TEST-REPORT.md
ac_total: 14
ac_passed: 14
revision_history:
  - version: v0.1
    date: "2026-07-10"
    author: PM
    summary: 首版起草 · yolo auto 代确认 approved_and_ship(WARN)
---

# 断线重连与会话连续性(BL-005) - PM 验收说明

> 🔴 **decision 依据**：用户 2026-07-10「yolo 模式完成这三个待做」blanket 授权 + YOLO-PREFLIGHT §2 D-6「pm_acceptance 自动 approved_and_ship(WARN)」。merge_target = 集成分支 `yolo/m5-remote-host`（非 main 硬约束）· **集成→main 晋升仍归人工**。本 decision 为 yolo auto 代确认（WARN 留痕）· 非跳过验收本身（14 AC 逐条对照如下）。

## §1 验收概要

| 项 | 内容 |
|---|---|
| Feature | BL-005 断线重连与会话连续性（M5 远程 Host 收官） |
| AC 通过 | **14 / 14** |
| 门禁 | tsc 0 error · vitest 765 passed 0 failed（真 node-pty 端到端）· verify-ac 14/14 无幽灵 · SMOKE_OK |
| 评审 | blueprint 三视角+官方外审两轮收口 APPROVE · 代码评审三视角 Round1 全 NEEDS_REVISION（2 BLOCKER+4 MAJOR）→ review-fix 补齐+补测 → 复验 APPROVE |
| decision | **approved_and_ship**（yolo auto·WARN） |

## §2 逐条 AC 验收（用户视角）

| AC | 用户可感知承诺 | 验收 |
|----|----------------|------|
| AC-1 | 远程机 UI 断开后远端会话继续跑不被杀·进程不被憋停 | ✅ 集成测：打到 paused 再 detach·续跑 ring 续增·pid 存活 |
| AC-2 | 本机 workspace 关窗/⌘R 行为与改造前一致（零回归） | ✅ 冒烟 embedded「sessions killed」·不分配 ring |
| AC-3 | 重连补上断开期新输出·本地已有内容不重写·无乱码 | ✅ 增量回放 nextOffset·CJK bytes≠chars 不双写 |
| AC-4 | 重连回到同一会话（非新建） | ✅ 同 pid 收养·无第二 PTY |
| AC-5 | 重连后 tab 徽标与远端当前态一致 | ✅ session.list 快照对账 |
| AC-6 | 断线显重连横幅+自动退避+手动重试 | ✅ Sidebar 重连中态+立即重试按钮·退避重试生产接线 |
| AC-8 | 认领过 token 闸·跨重连 sessionId 重绑 | ✅ 新 client 空 Set 可收养·错 token 被拒 |
| AC-9 | 资源上限防泄漏·不杀运行中长任务 | ✅ 拒新建不逐 live·逐最旧 exited |
| AC-10 | 网络抖动走重连非终结 | ✅ 显式 reconnect 复位保 per-host 结构 |
| AC-11 | 幂等收养防双 spawn·尺寸对账 | ✅ attach 命中即收养·resize 生效 |
| AC-12 | **断开期任务跑完也不丢**·重连看最终输出+退出码+已完成徽标（北极星） | ✅ exited 保留 scrollback+exitCode·徽标从快照点亮 |
| AC-13 | 断线几秒内被感知（不长时间假活） | ✅ app 层心跳有界 T≤10s（真机合盖时序=发版前 spike） |
| AC-14 | 多端同会话 last-attach-wins 转移 | ✅ A→B 转移·A input 被拒·A 输出停 |
| AC-15 | 瞬时断线不误删 workspace/终端（保「重连中」） | ✅ 抑制 BL-004 full drop·超预算才 drop |

## §3 已知取舍 / deferred（透明留痕）

- **path② 关 tab 后重连再发现**（AC-4 边缘·PENDING-006）：v1 defer——path① 闪断常态（AC-15 抑制 drop·inst 存活）已覆盖北极星；path② 需 session→workspace 映射 + addTab 返 tabId 接线，牵扯大。readoptHost 路径②逻辑 + T-036 单测俱在，接 store 建 tab 即启用。
- **真机合盖/断网时序**（AC-13 时延 + 全链路隧道断恢复）：沙箱不可跑，并入**发版前真机 spike**（e2e/reconnect-continuity-e2e.md·PRD 自标「最不确定=真机时序」）。恒跑层已在 in-process 覆盖同等语义断言。
- **A6 心跳判死后悬挂 rpc**：纯短时无用 pending·settled 卫已防重复·无正确性影响·留注后续。

## §4 决策

**approved_and_ship**（yolo auto·WARN）——14 AC 通过·三视角评审收敛（含 2 BLOCKER 核心价值 bug ship 前拦下修复）·门禁三绿。合入集成分支 `yolo/m5-remote-host`。**集成→main 晋升由用户人工决策**（非本 ship 范围）。
