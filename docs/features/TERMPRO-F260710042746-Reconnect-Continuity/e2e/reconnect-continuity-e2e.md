# E2E · 断线重连与会话连续性（BL-005 · 分层验收）

> 语言无关 E2E 记录。BL-005 的端到端本质是 **renderer↔main(SSH 隧道)↔远程 host** 全链路 +
> 物理断线事件（合盖/断网/切网），分**恒跑层**（沙箱可真跑）与**真机层**（发版前 spike）。

## 恒跑层（CI/沙箱真跑 · exit=0）

**权威 = `src/host/__tests__/reconnectContinuity.integration.test.ts`**（真 hostCore + 真 loopback WebSocket + 真 node-pty·in-process 端到端）：

| 端到端场景 | 断言 |
|-----------|------|
| 断开期会话续跑 | close 端口后 pid 存活·断开期字节经重连 attach 可回放 |
| 断线期退出留存（北极星） | 断线期进程退出（code 3）→ 转 exited 保留最终 scrollback + 退出码·session.list 仍列出 |
| session.list 发现 | 列出现存会话含 cwd/title/status/state 快照 |
| attach 收养 | 同 pid（非重 spawn）· I/O 双向恢复 · 新 client 空 Set 可按 sessionId 收养 |
| 增量回放 | full=false·baseOffset===resumeOffset·nextOffset===baseOffset+byteLen(不双写) |
| last-attach-wins | A→B attach 同 sid·输出转 B·A input 被拒·A ptyData 不再增长（否定断言） |
| 会话数上限 | 拒新建 rpc ok:false·绝不逐 live·手动 kill 腾位后可再建 |
| resize 对账 | attach 携新 cols/rows → pty.resize 生效（stty size） |
| token 闸 | 无/错 token 被 ws upgrade 层 destroy·现存会话不受影响 |

跑法：`npx vitest run src/host/__tests__/reconnectContinuity.integration.test.ts`（本轮 14 ✓ · 5.1s · 真 node-pty）。
renderer 接线层：`src/renderer/components/__tests__/SidebarReconnect.test.tsx`（A1 readopt 由 ws-open 驱动 / A2 onAttemptFailed 生产接线 / Q1 drop gate / CR-1）。

## 真机层（发版前 spike · manual · 沙箱不可跑）

沙箱无真实远程 SSH host、无法制造合盖/断网物理事件——以下并入**发版前真机 spike**门禁（AC-13 时延 + 全链路隧道断恢复）：

| # | 手动步骤 | 预期 |
|---|---------|------|
| 1 | 连一台真实远程机·workspace 开终端跑长任务（`while true; do date; sleep 2; done` 或真 build） | 终端流式输出·Sidebar 绿点 |
| 2 | 合上笔记本盖 / 拔网线（制造 TCP 冻结·非 clean close） | **T≤10s 内** Sidebar 该机转「重连中…」+ 立即重试按钮（AC-13/AC-6）·终端保活不消失（AC-15 抑制 full drop） |
| 3 | 保持断开数十秒·让远端任务继续跑（或跑完） | 远端进程续跑（旁路流控·AC-1） |
| 4 | 恢复网络 | 自动重连（disconnect-first 重建隧道）→ 终端**补屏**（增量回放断开期输出·不双写·AC-3）→ 恢复 live（AC-4） |
| 5 | 若步骤 3 期间 build 跑完 | 重连后终端见**最终输出 + 退出码**·tab 打「✓ exit N」已完成徽标（AC-12 北极星） |
| 6 | 长时间不可达（超重连预算 ~2min） | 转确定断线 → BL-004 full drop（workspace 折叠·AC-15 确定分支/D-13） |

> spike 记录落 `docs/DEV.md` 或本文件追加（发版前执行）。恒跑层已在 in-process 层覆盖同等语义断言,真机层验证隧道/物理事件时序（PRD 自标「最不确定 = 真机时序」）。
