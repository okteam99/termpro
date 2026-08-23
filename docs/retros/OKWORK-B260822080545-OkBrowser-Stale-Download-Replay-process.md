---
feature_id: OKWORK-B260822080545-OkBrowser-Stale-Download-Replay
flow: Bug
total_wall: 16.2h
ai_autonomous_min: 12
await_user_min: 947
host: codex-cli
---

# 流程复盘 · OKWORK-B260822080545-OkBrowser-Stale-Download-Replay

## 一、各阶段耗时

| stage | 耗时 | 其中等用户 | 总轮次 | 其中协调开销 |
|---|---:|---:|---:|---:|
| diagnose | 1m | 119m | 1 | 0 |
| dev | 5m | 0m | 3 | 0 |
| review | 3m | 0m | 2 | 0 |
| test | 3m | 0m | 1 | 0 |
| pm_acceptance | 0m | 828m | 1 | 0 |

机器口径：总墙钟 `16.2h`，AI 自主 `12m`，已标记待用户 `947m`；其余差值为跨 session
空闲，不计为 AI 工作。

## 二、耗时归因

各 stage 均为 `0` 协调开销轮：diagnose 形成真实状态复现与根因；dev 完成红绿实现；review
首轮发现 F1 并在第二轮验证闭环；test 形成独立回归证据；pm_acceptance 为用户专属决策等待。

## 三、流程反思

- **拦住真问题**：diagnose 排除了“自动保存下载”这个只遮弹框、不阻止历史请求的错误方向；review 首轮发现并修复 F1——后台 `browser_navigate` 可能只改 store 就返回假成功。
- **纯过场候选**：无。
- **流程新判例**：无。
- **成本异常**：无；跨日等待已由 `pause-mark` 计入待用户时间，没有冒充 AI 工作。

## 四、起草可预防性

- `1/1` 可预防；缺的起草考虑点：改变 BrowserView 挂载生命周期时，没有在 dev 起草阶段枚举 `browserControl`/MCP 等程序化消费者。

## 五、给下一个 feature 的一句话

改变 UI 资源挂载生命周期时，先枚举“可见 UI、后台保活、程序化 API”三类消费者，再写渲染门和回归矩阵。

