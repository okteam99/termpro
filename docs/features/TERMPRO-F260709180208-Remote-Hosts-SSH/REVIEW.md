---
feature_id: TERMPRO-F260709180208-Remote-Hosts-SSH
stage: review
reviewers: [architect, qa, external]
base: origin/yolo/m5-remote-host
review_rounds: 2
verdict: APPROVE
findings:
  - {id: F1, severity: BLOCKER, status: fixed, title: "全新远程机首次部署必失败(${dataDir}/bundle 父目录未建·非递归 mkdir 连环失败→120s deployFailed)", source: arch}
  - {id: F2, severity: MAJOR, status: fixed, title: "SSH 传输层断链不检测→ready 后真实掉线不 emit disconnected(AC-12)", source: arch}
  - {id: F3, severity: MAJOR, status: fixed, title: "main 同步 verifying→ready 覆盖 renderer 瞬时 verifying→renderer 握手/AC-6 冒烟大概率不执行·per-host client 不建立", source: arch}
  - {id: F4, severity: MAJOR, status: fixed, title: "in-flight guard 语义:connect 被在途 test 吞掉+无条件 delete 误删 test 槽位", source: arch}
  - {id: F5, severity: MAJOR, status: fixed, title: "部署锁互斥被击穿(mkdir 与 writeLockMeta 非原子·跨实例读 null 判陈旧→rm 掉他人锁+在传产物→双双部署)", source: external}
  - {id: F6, severity: MAJOR, status: fixed, title: "AC-6(P0) 运行时零覆盖+verify-ac 因 TC 映射到不存在的 T-012/T-013 而误报绿(门禁完整性)", source: qa}
  - {id: F7, severity: MINOR, status: fixed, title: "认领 probe reject 时 buildTunnel 的 net.Server 泄漏", source: external}
  - {id: F8, severity: MINOR, status: fixed, title: "带 token 的 verifying 事件广播到所有 BrowserWindow(安全·token 泄漏面)", source: external}
  - {id: F9, severity: MINOR, status: fixed, title: "TERMPRO_ALLOWED_ORIGINS 注入未实现→dev WS 直连回归+打包 Origin 前提未实证", source: arch}
  - {id: F10, severity: MINOR, status: fixed, title: "isEexist 过宽吞掉一切 sftp mkdir 错误(掩盖 A1 的 ENOENT)", source: arch}
  - {id: F11, severity: MINOR, status: fixed, title: "远端路径 shell 命令未加引号(远端 $HOME 含空格即破)", source: arch}
  - {id: F12, severity: MINOR, status: fixed, title: "safeStorage 不可用时 config 落盘带 has* 旗标但无密文", source: arch}
  - {id: F13, severity: MINOR, status: fixed, title: "host 侧 token 零落盘/零日志未证否(T-018 仅 argv 契约·未扫真实 host.log)", source: qa}
  - {id: F14, severity: MINOR, status: fixed, title: "AC-7 按 lastUsed 倒序无真实渲染顺序断言", source: qa}
  - {id: F15, severity: MINOR, status: fixed, title: "disconnect 在途最长阻塞约 135s", source: external}
  - {id: F17, severity: MAJOR, status: fixed, title: "orchestrator 把 !probe.ok(瞬时传输失败)与 compatible===false(真版本不符)合并判 incompatible→刚部署 host 瞬时探测失败被误报版本不兼容·不该重试", source: arch}
  - {id: F16, severity: NIT, status: deferred, title: "disconnect 重复 emit disconnected / waitForReady 用 Date.now / docstring 滞后+死代码 / execDetached token-EOF spike 未勾", source: arch}
  - {id: F18, severity: MINOR, status: fixed, title: "在途 disconnect 后 main 残余事件把已 drop 的 renderer runtime 瞬时复活到 ready(UI 抖动+已 drop client 被 verifying 重触发)", source: external}
  - {id: F19, severity: NIT, status: fixed, title: "host token=%s 打印靠隐性契约维持零落盘·应结构化限制到非驻留模式", source: external}
overall_verdict: APPROVE
decided_at: "2026-07-10T00:40:00Z"
---

# REVIEW · BL-003 远程机管理与 SSH 连接编排 · 三视角代码评审

> 全文见 `REVIEW-arch.md`（architect · REQUEST_CHANGES · A1-A13）· `REVIEW-qa.md`（qa · NEEDS_REVISION · Q1-Q6）· `external-cross-review/review-claude-subagent-degraded.md`（第三视角隔离冷审 · NEEDS_REVISION · E1-E9）。本文件为机读整合单源。

## 评审介质

- architect（opus 隔离 subagent）+ qa（opus 隔离 subagent）+ external 第三视角（worktree 无 localconfig · 默认降级同模型隔离冷审 · review_via: subagent · v8.204 yolo 默认）。三路独立采样。

## 收敛结论（Round 1）

三路共识：**安全面与架构红线扎实**（token 零明文落盘/日志、常量时间校验、--host-tag 不入端口闸、Origin 纵深、IPC 无 get-secret、protocol.ts 零改、SSH 全在 main、host 零 Electron、residency reap 双验无误杀、probe 有界超时无 livelock——三路一致记功）。**缺陷集中在部署路径前置条件、SSH 断链检测、main/renderer 状态机竞态、并发锁互斥、AC-6 覆盖**。

高严重度共识（跨 reviewer 重合）：
- **F1 BLOCKER**（arch A1 = external E1）：首装必败，两路独立确认，测试因全 mock exec 未抓到。
- **F5 MAJOR**（external E2 · arch A5 原判 MINOR → 升 MAJOR）：部署锁互斥被击穿，两 App 实例并发是设计显式目标，故此缺口否定锁价值。
- **F4 MAJOR**（arch A4 = external E3）：in-flight guard。
- **F6 MAJOR**（qa Q1）：AC-6 P0 零覆盖 + 机读门禁误绿。

## 处置（Round 2 修复 · dispatch dev-main/dev-renderer/dev-host）

见各 finding status 翻牌（fixed/deferred）。NIT 组（F16）deferred 进 PENDING 或顺手。修复后 architect + qa + 第三视角 verify 复核。

（Round 2 verify 结论待修复完成后追加）
