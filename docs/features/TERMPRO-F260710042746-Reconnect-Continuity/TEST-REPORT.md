# TEST-REPORT · BL-005 断线重连与会话连续性

## 状态
集成验收通过（integration exit=0 · verify-ac 14/14 · 无幽灵覆盖 · 三视角代码评审 APPROVE）

## 测试执行汇总

| 层 | 命令 | 结果 |
|----|------|------|
| 全量单测 + 集成 | `npx vitest run` | ✅ **765 passed · 1 skipped · 0 failed**（91 test files·integration exit=0） |
| AC 覆盖校验 | `verify-ac.py` | ✅ 14/14 AC 均有测试覆盖（0 缺失） |
| 幽灵覆盖终验 | TC test file 存在性 | ✅ 全部存在（非改名/不存在·堵 BL-003/004 复发） |
| 冒烟 | `TERMPRO_SMOKE=1 electron-forge start` | ✅ SMOKE_OK（embedded「sessions killed」·本机零回归 AC-2） |
| 类型 | `tsc --noEmit` | ✅ 0 error |

> 🔴 **本轮真 node-pty 集成测端到端通过**（非沙箱 posix_spawnp 基线红）：`reconnectContinuity.integration.test.ts`（14 ✓·5.1s）+ `ptyPoolDetach.test.ts`（5 ✓·5.3s）在真 hostCore + 真 loopback WS + 真 node-pty 上跑通——host 侧断开续跑 / exited 保留 / session.list / attach 收养 / 增量+全量回放 / last-attach-wins / 会话数上限 全链路**真机级验证**。与 BL-003/004 沙箱基线红不同,本轮环境具备 PTY fork 能力,test-baseline 差分自然为空。

## AC 覆盖矩阵（14/14 · 真断言 · 无幽灵）

| AC | 描述 | 覆盖测试 | 层级 | 状态 |
|----|------|----------|------|------|
| AC-1 | 断开会话续跑·旁路流控不憋停 | reconnectContinuity.integration（打到 paused 再 detach·ring 续增·pid 存活·行为断言） | 真 pty 集成 | ✅ |
| AC-2 | 本机嵌入式零回归 | ptyPoolDetach（embedded kill 立即回收·不分配 ring·不进 list）+ 冒烟 | 集成+冒烟 | ✅ |
| AC-3 | 增量回放不双写（含 CJK bytes≠chars） | terminalRegistryReadopt（test-double xterm·reset-vs-增量·nextOffset）+ reconnectContinuity（baseOffset/nextOffset） | 单元+集成 | ✅ |
| AC-4 | (hostId,sessionId) 收养非新 spawn | reconnectContinuity（attach 同 pid·幂等收养无第二 PTY）·路径①闪断 SidebarReconnect | 集成+接线 | ✅ |
| AC-5 | session.list 状态快照对账徽标 | reconnectWiring.test（reconcileBadge→store）+ reconnectContinuity（快照 state 反映当前态·无未读计数） | 单元+集成 | ✅ |
| AC-6 | 重连横幅+自动退避+手动重试 | reconnectBackoff（退避/预算/复位）+ SidebarReconnect（onAttemptFailed→退避重试生产接线）+ MachineGroup 立即重试按钮 | 单元+接线 | ✅ |
| AC-8 | 认领 token 闸+跨重连 sessionId 重绑 | reconnectContinuity（新 client 空 Set 可收养·无/错 token 被 destroy） | 真 pty 集成 | ✅ |
| AC-9 | 字节+会话数上限·拒逐 live | ptyPoolDetach + reconnectContinuity（上限拒新建·手动 kill 腾位·逐最旧 exited） | 集成 | ✅ |
| AC-10 | 显式 reconnect 路径非 dispose | hostClientReconnect（复位 down+connectPromise+保 per-host·markDown 分叉·再入守卫） | 单元 | ✅ |
| AC-11 | 幂等收养防双 spawn+resize 对账 | reconnectContinuity（attach 命中即收养·resize 生效 stty size） | 真 pty 集成 | ✅ |
| AC-12 | 断线期退出留存·完成徽标（北极星） | reconnectContinuity（exited status/exitCode/回放最终输出）+ reconnectWiring（snapshot.status=exited→tab.exited+exitCode 徽标点亮） | 集成+接线 | ✅ |
| AC-13 | 断线检测有界时延 T≤10s | heartbeatDetect（注入快心跳·有界 T 判定） / 真机合盖时序 → **发版前 spike**（见 e2e/） | 单元+spike | ✅ |
| AC-14 | 多端 last-attach-wins 转移 | reconnectContinuity（A→B attach 同 sid·输出转 B·A input 被拒·A ptyData 不再增长 否定断言） | 真 pty 集成 | ✅ |
| AC-15 | 瞬时断线抑制 BL-004 full drop | reconnectSuppressDrop（接线层·reconnecting 期 >900ms 不 drop·超预算才 drop）+ SidebarReconnect（scheduleDropUnlessReconnecting 生产 gate·CR-1） | 接线 | ✅ |

## 评审收敛记录

- **blueprint 三视角 + 官方外审两轮**（8 high → v0.2 → CR-1 new high → v0.3 → APPROVE）。
- **代码评审三视角**（Round1 全 NEEDS_REVISION·2 BLOCKER〔A1 终端冻结/A2 永卡重连中〕+ 4 MAJOR）→ review-fix 补齐集成接线 + **11 新测覆盖生产路径**（堵 seam 假绿）→ 复验 APPROVE。详 REVIEW.md。

## E2E 判断

- **API/协议 E2E**：`reconnectContinuity.integration.test.ts` 即端到端契约验证（真 WS 帧·真 pty·断线重连全链路）·exit=0。
- **Browser E2E**：⏭️ 不适用于自动化——BL-005 真实重连态需真机远程 host + 合盖/断网物理事件，沙箱不可触发。分层 E2E 见 `e2e/reconnect-continuity-e2e.md`（恒跑层=集成测全绿·真机层=发版前 spike·AC-13）。

## 结论

**集成验收通过**。integration exit=0 · verify-ac 14/14 真覆盖（无幽灵）· 真 node-pty 端到端全链路绿 · 冒烟 SMOKE_OK · 三视角代码评审 APPROVE（2 BLOCKER 核心价值 bug 已拦下修复）。可进 pm_acceptance。
