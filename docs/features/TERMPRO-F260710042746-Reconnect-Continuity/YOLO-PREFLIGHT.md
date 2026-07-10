# YOLO 预研 + 核心决策确认（TERMPRO-F260710042746-Reconnect-Continuity · BL-005）

> yolo run 范围：BL-003 → BL-004 → **BL-005** 串行连续交付（用户一次性授权 2026-07-10「yolo 模式完成这三个待做」+ 逐条「ok」）。BL-003/004 已交付合入集成分支 yolo/m5-remote-host。本文件为 **M5 收官 Feature** BL-005 预研门产物。

---

## 1. 深入调研（grounded 真实代码 · 基于含 BL-003/004 的集成分支）

- **任务实质**：WS-01-S5——host 侧 scrollback 环形缓冲 + 远程会话存活策略（UI 断开不杀会话）+ 重连回放与会话认领 + 状态徽标/通知对账 + 重连横幅与自动重连。让远程机连接断开（合盖/断网/切网）后会话在远端**继续运行**，重连后**回放屏幕 + 认领会话 + 对账状态**，用户无感恢复。
- **真实代码现状**（实读集成分支）：
  - **hostCore.ts:125-126**：`port.on('close', () => { for sid of client.sessions: pool.kill(sid); client.watches.dispose(); ... })`——**端口 close 即 kill 该客户端全部会话**。这是**本地嵌入式**语义（窗口关/重载即回收），与远程「UI 断开会话存活」**直接冲突**（WS-01 R3·high）。BL-005 核心 = **按 host 形态分语义**。
  - **ptyPool.ts**：`Session` 有流控（highWatermark/lowWatermark·ack/pause/resume）但**无 scrollback 环形缓冲**——断开期间的 PTY 输出无处留存，重连无从回放。
  - **sessionTracker.ts**（117 行·驻 host）：会话状态机（idle/running·OSC133/进程轮询·bell/notify/quiet/altscreen 事件）已在——重连对账的状态源。
  - **wsServer.ts**（BL-002）：standalone WS 传输·心跳（isAlive/ping-pong·pong 超时 terminate）·attachClient 归属回收。断线检测已有（BL-003 wireDisconnectWatcher）。
  - **renderer**：hostClient（BL-003 connect(opts)·markDown 拒挂起调用）· hostRegistry（BL-004 per-host）· remoteHostStore（连接态）· terminalRegistry（terminal 实例跨挂载存活·BL-004 (hostId,sessionId) 复合键）。
  - **协议**：无「列出 host 现存会话/认领/回放」的 RPC——BL-004 D-9 已把「主机侧既存会话枚举」划归本 BL-005。
- **范围边界**：做 WS-01-S5 全部 AC（scrollback 环形缓冲 + 远程会话存活按形态分语义 + 重连回放认领 + 状态/通知对账 + 断线横幅+自动重连+手动重试）。不做：mobile · 会话跨机迁移 · 本地嵌入式语义改变（保持现状零回归）。
- **未知与风险**：① R3 **按 host 形态分语义**是核心——本地嵌入式 host 保持「端口 close 即 kill」现行为零回归·standalone/远程 host 改为「客户端断开会话存活」需在 hostCore attachClient 的 close 回调按形态分支；② scrollback 环形缓冲的内存上限与回放协议（全量 vs 增量·字节上限）；③ 重连认领的会话归属安全（BL-003 token 闸 + 客户端重连后重新 attach 既有会话·防跨客户端认领）；④ 沙箱无真机→桩测+发版前 spike。

## 2. 核心重要决策（yolo auto 代决 · 承 BL-003/004 已确认技术路线 · blueprint 前可被评审推翻）

| # | 决策点 | 倾向 | 备注 |
|---|--------|------|------|
| 1 | 会话存活语义按 host 形态分（R3 核心） | **本地嵌入式**：hostCore attachClient close 回调保持「kill 该客户端会话」零回归；**standalone/远程**：close 回调**不 kill**，会话+scrollback 驻留 host·等重连认领。判据 = host 启动形态（parentPort 嵌入式 vs --listen standalone·host.ts 已分流） | WS-01 R3 缓解方案原文 |
| 2 | scrollback 环形缓冲 | host 侧 ptyPool 每 session 加**字节上限环形缓冲**（如 256KiB/session·超限丢最旧）·断开期间继续填充·重连回放全量缓冲 → renderer 写入 xterm | 上限值 blueprint 定·内存 vs 回放完整性权衡 |
| 3 | 重连回放 + 认领协议 | 协议追加（向后兼容·不 bump 版本）：`session.list`（列该 host 现存会话+元数据）+ 重连后 renderer 按 (hostId,sessionId) **重新 attach 既有会话**（非新 spawn）+ host 回放 scrollback。认领过 BL-003 token 闸（防跨客户端） | 承接 BL-004 D-9「主机侧既存会话枚举归 BL-005」 |
| 4 | 状态/通知对账 | 重连后 renderer 用 sessionTracker 当前状态**对账**本地徽标（running/idle·未读通知）·消除断开期间的状态漂移 | 复用既有 sessionTracker 状态源 |
| 5 | 断线横幅 + 自动重连 | renderer 检测断线（hostClient markDown/BL-003 disconnected 事件）→ 显**重连横幅** + **自动重连**（指数退避）+ 手动重试；重连成功走认领+回放 | BL-004 AC-8/AC-11 只做呈现+回落·本 BL-005 做重连恢复 |
| 6 | 执行编排 | 串行 BL-005（M5 收官）· merge_target=yolo/m5-remote-host · pm_acceptance 自动 approved_and_ship(WARN) · MR 自动合入集成分支 · **集成→main 人工** | 同 BL-003/004 |

## 3. 用户确认

- **确认范围**：用户 2026-07-10「yolo 模式完成这三个待做」+ BL-003 预研门 6 决策逐条「ok」= **blanket 授权三个 BL 连续自主执行**。BL-005 承接同一授权；§2 决策延续 BL-003/004 已确认技术路线（per-host/复合键/token 闸/按形态分语义）或对齐 WS-01 R3 缓解原文·无偏离原授权的新方向。
- **评审安全网知悉**：worktree 无 localconfig → 第三视角默认降级同模型 subagent 隔离冷审（非跨模型异质·已知悉·三视角评审全真跑）。
- **确认记录**：blanket yolo 授权（用户原话「yolo 模式完成这三个待做」+「ok」）· BL-005 §2 为 auto 代决 · 各计 concerns WARN · 错向 blueprint 前可被评审推翻。
