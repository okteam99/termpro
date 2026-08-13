---
feature_id: OKWORK-F260810151932-Browser-Profile-Login-Continuity
flow: Feature
total_wall: 59.5h
ai_autonomous_min: 114
await_user_min: 3396
host: codex-cli(goal→test) → claude-code(pm_acceptance→ship，跨 session 交接)
---

# 流程复盘 · OKWORK-F260810151932-Browser-Profile-Login-Continuity

## 一、各阶段耗时

| stage | 耗时 | 其中等用户 | 总轮次 | 其中协调开销 |
|---|---:|---:|---:|---:|
| goal | 46m | 26m | 2 | 0 |
| ui_design | 6m | 57m | 1 | 0 |
| panorama_sync | 1m | 0 | 1 | 0 |
| blueprint | 7m | 0 | 1 | 0 |
| dev | 37m | 0 | 1 | 0 |
| review | 4m | 0 | 2 | 1 |
| test | 13m | 0 | 2 | 0 |
| pm_acceptance | 5m | 19m | 1 | 0 |

机器汇总：goal→test（codex-cli 主导阶段）工作阶段耗时总和 114m，与 ledger `ai_autonomous_min` 一致；pm_acceptance 的 5m 属 claude-code 接手后新 session 的独立复跑，与前段分属不同宿主。最耗时工作阶段为 dev 37m（栈内占比约 32%）。总墙钟（59.5h＝3570m）减 AI 活动（114m）和已标记用户等待（3396m）后的差额约 60m，是跨 session 交接前后的未标记挂机空闲，不计作 AI 工作。

## 二、耗时归因

### review

- **协调开销 1/2 轮**，类型：外审配方兼容。
- **最大的一笔**：fast Round 1 未产出 external 评审产物，Round 2 的 verify-fixes 流程需要以「当前提交的外审配方」为基线核实修复，只能现场先补生成配方才能继续，没有产生新的设计判断或实现。
- **可避免吗**：能 → fast_mode 下 review round-2 的 verify-fixes brief 应先探测 round 1 是否已有 external 产物，没有就自动补齐，而不是让流程在 round 2 现场卡壳（详见 §三判例①）。

## 三、流程反思

- **拦住真问题**：review F1（MAJOR，已 attach 的 Remote webview 在 generation 失效后可经站内导航绕过 hydration gate）已修复并有 10 例 guard 测试锁住；test Round 1 抓出 `portFile.test.ts` 测试夹具读取竞态（非产品缺陷，已修复）；pm_acceptance 的 AC↔TC 逐条对照抓出 2 处「覆盖矩阵绿但生产路径零触达」（AC-4 的 `evicted` 抑制路径、AC-5 的 `host_upgrade` 提示链路）+ 3 处 TC.md test_refs 指向错位（均已登记 PENDING-013）；ship1 合并 origin/main 时发现子浏览器窗口（OAuth 弹窗）未接入 continuity hydration gate（PENDING-015，与 review 抓到的 F1 同族——新增导航入口未接入同一 main-side gate）。
- **纯过场候选**：无。逐 stage 核对：goal/ui_design/blueprint 均产出被下游引用的实质文档；panorama_sync 虽仅 1m，但产出了真实的全景变更记录（browser-profiles 节点）；review/test/pm_acceptance 三个门禁阶段均有真实 finding（见上「拦住真问题」），没有零 finding + 零修订 + 全默认的环节。
- **流程新判例**：
  - 判例①：fast_mode 下 review Round 2 的 verify-fixes 需要 Round 1 不存在的 external baseline（`state.stage_cost` 已记「外审配方兼容」这笔 1/2 轮协调开销）。建议 fast roster 的 review round-2 brief 先探测 round 1 是否已有 external 产物，没有则自动补生成，而非让流程现场卡壳。
  - 判例②：worktree 不装依赖时，`hostSubprocessHarness` 把子进程 `NODE_PATH` 显式指向 worktree 根的空 `node_modules`，导致起子进程的测试（`portFile.test.ts` 7 例）整片红，且症状表现得像回归，实际是环境问题非代码问题。本 session（pm_acceptance 独立复跑四道门禁时）实测踩中，软链 `node-pty`/`ws`/`electron` 后 7/7 通过；已定性并沉淀 KNOWLEDGE GO-040。建议干净 worktree 的验证 checklist 补一步：子进程测试依赖 `NODE_PATH` 指向 worktree `node_modules` 时，先软链或装依赖，避免下一个 feature 重复误判为回归。
- **成本异常**：待用户 3396m 主要是跨 session 挂机等待（codex-cli 于 2026-08-10T19:35 完成 test 阶段后，到 2026-08-13T02:31 claude-code 接手 pm_acceptance 之间近 3 天的间隔），非流程摩擦；AI 自主仅 114m（goal→test，codex-cli 主导阶段）。

## 四、起草可预防性

- **7/7 可预防**。缺的起草考虑点：既有协议容量与兼容边界；跨重启离线删除模型；全局迁移删除结果；hydration 可测放行条件；新增秘密数据面；跨入口不变式清单未包含已 attach guest 的 link/script/redirect（已强化 KNOWLEDGE RD-5，但子浏览器窗口这一新入口仍在合并时才被发现，见 PENDING-015）。

## 五、给下一个 feature 的一句话

涉及子进程测试或多轮 fast review 的 feature，起手先按 KNOWLEDGE GO-040 软链 worktree `node_modules`，并让 review round-2 brief 自动探测/补齐 external baseline，避免流程本身在环境或配方缺口上现场卡壳；同时凡新增导航/弹窗类入口，起草阶段就要对照 ADR-0004「新增导航入口必须接入同一 main-side gate」逐项核对，不要等合并冲突才发现遗漏（PENDING-015）。
