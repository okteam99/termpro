---
feature_id: OKWORK-B260821031119-Reconnect-Session-Restore
flow: Bug
total_wall: 1.4h
ai_autonomous_min: 14
await_user_min: 62
host: codex-cli
---

# 流程复盘 · OKWORK-B260821031119-Reconnect-Session-Restore

## 一、各阶段耗时

| stage | 耗时 | 其中等用户 | 总轮次 | 其中协调开销 |
|---|---:|---:|---:|---:|
| diagnose | 4m | 52m | 1 | 0 |
| dev | 7m | 0m | 4 | 1 |
| review | 3m | 0m | 1 | 0 |
| test | 0m | 0m | 2 | 1 |
| pm_acceptance | 10m | 10m | 1 | 0 |

机器汇总：总墙钟 1.4h，AI 自主 14m，等待用户 62m；差额约 8m 为未标记的 session/工具间隙，不计作 AI 工作。

## 二、耗时归因

### dev

- **协调开销 1/4 轮**，类型：lint baseline 归因。
- **最大的一笔**：全仓 lint 既有 574 个问题，需定向证明本次仅新增 2 个 `no-empty-function`，并把本次及同文件 2 个既有错误一起清掉。
- **可避免吗**：部分可避免；项目若有 lint baseline/diff 工具，可直接判净新增，无需人工从全仓输出归因。

### test

- **协调开销 1/2 轮**，类型：runner cwd 修正。
- **最大的一笔**：`state.py test-complete --run-tests` 从 Feature 目录执行，而工具注释/使用心智假定 repo root；repo-relative `src/...` 路径产生 `No test files found` 假红。
- **可避免吗**：可避免；框架应让 runner 使用 project root，或在 emit 中明确 cwd。修复框架前，消费项目的 `--test-cmd` 显式 `cd <repo-root>`。

## 三、流程反思

- **拦住真问题**：diagnose 用 0.5 秒反馈环连续 3/3 复现 generation 竞态，避免把 `host connection lost` 误修成 Host 协议问题；红灯测试在 dev 前锁定真实副作用。
- **纯过场候选**：无。fast review 零 finding，但独立核验了 token 清理、ABA、首次尝试语义及测试入口真实性。
- **流程新判例**：`state.py --run-tests` 的实际 cwd 与文档/代码注释预期不一致会稳定制造假红；建议 teamwork runner 固定 project root 或把 cwd 作为结构化输出/参数。
- **成本异常**：test 多 1 轮纯命令修正；无 bypass，无产品代码返工。

## 四、起草可预防性

- 0/0 可预防；review 无 finding，无缺失起草考虑点。

## 五、给下一个 feature 的一句话

在 teamwork 修正 runner cwd 前，`test-complete --run-tests --test-cmd` 一律先显式 `cd` 到 repo root，避免把路径错误当产品回归。
