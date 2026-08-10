---
feature_id: OKWORK-F260807022801-Profile-Password-Vault
flow: Feature
total_wall: 24.8h
ai_autonomous_min: 117
await_user_min: 1340
host: codex-cli
---

# 流程复盘 · OKWORK-F260807022801-Profile-Password-Vault

## 一、各阶段耗时（机器数据）

| stage | AI 自主耗时 | 等用户 | 总轮次 | 其中协调开销 |
|---|---:|---:|---:|---:|
| goal | 17m | 672m | 2 | 0 |
| ui_design | 45m | 19m | 2 | 0 |
| panorama_sync | 24m | 20m | — | — |
| blueprint | 10m | 125m | 2 | 0 |
| dev | 4m | 0 | 5 | 1 |
| review | 8m | 0 | 2 | 1 |
| test | 1m | 0 | — | — |
| browser_e2e | 8m | 0 | 3 | 1 |
| pm_acceptance | 0m | 504m | — | — |

机器汇总：总墙钟 24.8h，AI 自主 117m，待用户 1340m。轮次归因只统计已调用 `stage-cost` 的六个 stage：协调开销 3/16 轮。

## 二、耗时归因

### dev

- **协调开销 1/5 轮**，类型：verification-restart。
- **最大的一笔**：为满足 HEAD + diff 新鲜度门，在冻结 commit 后重启一次最终验证；其余轮次均产生实现、真实 E2E 缺陷修复或全量回归修复。
- **可避免吗**：可部分避免；在最后一次报告/状态写入前先规划“冻结 commit → 最终验证”顺序，减少一次重复启动。

### review

- **协调开销 1/2 轮**，类型：external-evidence-scaffolding。
- **最大的一笔**：fast 首轮没有 external 全量锚点，fix-verify 前需先补全量 external 产物再生成增量证据。
- **可避免吗**：可；进入含 external fix-verify 的 review 前先物化全量锚点，避免中途补脚手架。

### browser_e2e

- **协调开销 1/3 轮**，类型：evidence-coverage-followup。
- **最大的一笔**：初轮截图后才补失败登录与删除边界图；另一次重跑则发现并修复 GET fixture 把测试密码写进地址栏/截图的真实证据缺陷。
- **可避免吗**：覆盖补图可通过开跑前列全 inventory 避免；GET 泄密是有价值的新发现，不属于纯开销。

## 三、流程反思

- **拦住真问题**：Goal 评审拦下剪贴板伪隔离与 Profile 删除 best-effort；Review 拦下 inactive Profile 仍可通过 ordinary/trusted IPC 解密、三处披露缺口和 E2E 追溯失真；external 独家抓到 Saved Passwords clipboard 断言不精确；全量测试抓到 Zustand selector 快照回归；视觉证据抓到 GET fixture 将随机密码写入 URL/截图。
- **纯过场候选**：无。panorama_sync 因用户指出近期 UI 大改而实际完成了最新版 renderer 反向同步；其余阶段均产生决策、缺陷或机器证据。
- **流程新判例**：`test-complete --run-tests` 在合并命令 exit 2 时顶层仍报告 PASS、只以 `transitioned_to=null` 暗示失败；且 runner 实际 cwd 是 Feature 目录，与文档注释的 repo cwd 不一致，导致相对测试入口重复拼接。建议 Teamwork 让 verdict 与真实 exit code 一致，并在输出中显式给出 cwd。
- **成本异常**：总墙钟 24.8h 中待用户 1340m，AI 自主 117m；主要是跨 session/确认等待，不应计作 AI 工作。测试入口 cwd 误判造成一次可避免的 fix/retry。

## 四、起草可预防性

- 6/6 可预防。
- 缺的起草考虑点：显式显示与复制的端到端明文流；不可逆删除的失败与重试语义；删除状态统一约束 ordinary/trusted/guest 全部入口；三处安全披露逐面核对；E2E 声明与脚本精确断言逐项对账。

## 五、给下一个 Feature 的一句话

BL-007 开跑前先锁定 Remote Host 断线时“不回退本机影子 Vault”的唯一权威语义，并让最终测试命令使用绝对入口、截图 inventory 一次列全。
