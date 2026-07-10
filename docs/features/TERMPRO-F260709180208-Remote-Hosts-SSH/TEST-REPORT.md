# TEST-REPORT · BL-003 远程机管理与 SSH 连接编排

- **Feature**: TERMPRO-F260709180208-Remote-Hosts-SSH
- **Stage**: test（QA 集成验收 + AC 全覆盖最终验证）
- **日期**: 2026-07-10
- **base**: origin/yolo/m5-remote-host

## 门禁总览

| 门禁 | 结果 |
|------|------|
| `tsc --noEmit`（全仓） | ✅ 0 错误 |
| `vitest run`（全量单测+集成） | ✅ 540 passed · 1 skipped · 0 failed |
| verify-ac.py（AC↔test 机读覆盖） | ✅ 14/14 AC 覆盖（AC-6 修正后指 3 个真实测试） |
| 无头冒烟（`TERMPRO_SMOKE=1`） | ✅ SMOKE_OK |
| E2E 脚本（`e2e/remote-hosts.e2e.sh`） | ✅ E2E PASS |

## 端到端验证分层（e2e/remote-hosts.e2e.sh · 可运行）

- **L1 无头冒烟（恒跑 · ✅ SMOKE_OK）**：整应用启动 → 嵌入式 host 握手 → renderer 完成 host.info。证明 `hostClient.connect(opts)` 向后兼容改造未回归本地路径（BL-003 硬约束：本机 host 行为零变化）。
- **L2 集成级（恒跑 · ✅ 全绿）**：host WS harness（真实 ws server + hostCore 全 RPC 往返）、真实 host 子进程（端口文件 O_EXCL/0600、token 零落盘/零日志证否）、真实 ws upgrade（Origin 门/认证节流）、orchestrator 全状态机（注入 SSH 传输桩 · 确定性不触网）、deploy 版本隔离锁、residency 决策表。
- **L3 真机 SSH（条件跑 · ↓ skip）**：`sshLocalhost.integration.test.ts` 本机 sshd 不可达（端口 22 拒绝）→ 如实 `it.skipIf` 降级（**不伪绿** · skip 原因写进测试名）。CI 可起 loopback sshd 常跑（已 add-concern 记 Q6）。

## AC 覆盖矩阵（14/14 · verify-ac 机读通过）

| AC | 覆盖测试 | 层级 | 验收要点 |
|----|---------|------|---------|
| AC-1 | T-001/002/003 | unit | 远程机 CRUD + 重启持久化 |
| AC-2 | T-004/005 | unit/int | 测试连接=认证+可达探测（不部署）· 失败口径与连接统一 |
| AC-3 | T-006/007 | unit | safeStorage 零明文落盘 · 私钥仅路径引用 · SSH 凭据不入 renderer |
| AC-4 | T-008/009/031/035/037/039/039b | int/unit | 三段部署进度 + 架构探测 + 版本隔离锁 + 原子 rename + 幂等 |
| AC-5 | T-010/010b/011 | unit | 连接生命周期全状态机（含 claiming→deploying 合法边）+ 事件可订阅 |
| AC-6 | T-012/013/013b | fe-e2e/unit | 兼容→ready 版本二次确认 · 不兼容→incompatible 断开 · 瞬时失败→startFailed 可重试 |
| AC-7 | T-014/015 | unit/fe-e2e | 最近使用倒序渲染（真实 useMemo sort）+ 一键连接 |
| AC-8 | T-016/017/018/036/038 | unit/int | token-stdin 零落盘（argv 契约 + host 子进程 stdout/端口文件双证否）+ 端口文件 O_EXCL 无 TOCTOU |
| AC-9 | T-019/020 | unit/int | 告警节流同窗口 emit≤1（纯函数 + 真 ws 突发实测） |
| AC-10 | T-021/022 | unit/int | Origin 白名单不误杀（file://·null·无头放行 + dev origin 注入）· 异源拒绝 |
| AC-11 | T-023/024 | int | 缺 node/node18 部署中止 + 引导（exec 桩模拟） |
| AC-12 | T-025/026 | int | failed 修正后重试至 ready · disconnected 手动重连 · **SSH 真断链检测（F2 修复）** |
| AC-13 | T-027/028/032/033/034 | int/unit | 快路径跳过上传 + 认领驻留进程 + residency 决策表守门 |
| AC-14 | T-029/030 | unit/int | 删除随删清凭据 + best-effort 断连 |

## 安全 AC 可执行断言（非人工检查 · QA review 已确认）

- **AC-3 零明文**：secrets 文件存 `base64(safeStorage.encryptString)`；`setSecret` 在加密不可用时抛错拒存不明文兜底；磁盘字节断言无明文子串 + 解密往返。
- **AC-8 token 零落盘/日志**：端口文件真实子进程 O_EXCL/0600 + host stdout/stderr 扫描无 token（正例锚点防假阴性）+ argv 契约。
- **AC-9 节流**：真 ws 20 次错 token 突发 → onAuthAlert 恰 emit 1 次（比契约 ≤1 更强）。
- **AC-10 Origin**：真 ws upgrade 带 `{origin}` 头——异源拒、file://·null·无头放行、合法源+错 token 仍拒（token 主屏障）。

## residency 决策表守门（ARCH-11 最高风险 · 强断言）

- 兄弟 host 永不误杀：cmdline 含别 tag/无 tag/前缀碰撞/PID 复用四态断言决策序列中 `kill` 从不出现。
- token 陈旧不 livelock：probe 失败→同栈 reap+deploy（非反复 claim）。
- argv 分词全等比对（非裸 substring）拒前缀碰撞。

## 预存在基线（差分 0 新增）

沙箱环境 `posix_spawnp failed`（PTY fork 被拒）在并行测试压力下偶发 13 条 host PTY 测试失败——已登记 `project-specs/test-baseline.md`，stash 复核基线同样失败，**非 BL-003 回归**（未碰 PTY 路径）；单跑/低压力全绿。本轮全量 540 passed 无复现。

## 发版前/后续 concerns（已 add-concern 留痕）

- R2：disconnect 5s 超时与在途 runConnect 极窄竞态 → BL-005 重连重访。
- R3：打包态 Origin 白名单硬编码 null,file:// 依赖「打包 renderer Origin∈{null,file://}」→ 发版前真机打包包抽验 ARCH-B11 坐实一次。
- Q6：CI 起 loopback sshd 让 T-031 真机锚点常跑。
- A0 spike（TECH 标记）：ssh2 打包后四能力 / token-stdin EOF 时序 / 真机远程部署——需真实远程环境，发版前 spike。

## 结论

**集成验收通过**。integration exit-code = 0 · e2e（分层 · 恒跑层全绿 · 真机层如实 skip）· verify-ac 14/14 · 冒烟 SMOKE_OK。三视角代码评审两轮收敛 APPROVE，安全面/架构红线/最高风险 residency 均真断言守门。可进 pm_acceptance。
