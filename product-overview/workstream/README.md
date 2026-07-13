# Workstream（规划单元）

> 本目录存放 OkWork 的 Workstream（WS）—— feature-planning 流程的产物。
> 每个 WS = 一块规划（一个能力 / 变更）→ 拆一组 feature 写进子项目 ROADMAP。
> 本 README 是静态向导，不是看板；WS 状态汇总进 `teamwork-space.md`。

## 这里放什么

- `WS-{NN}-{短名}.md` —— 一个 Workstream，描述背景、承接执行线、拆出的 feature、依赖、风险和执行顺序。

## 不放什么

- feature 的执行态 / 进度：放在 `docs/features/` 的 Feature artifact 与后续 state.json。
- 产品愿景 / 业务架构 / 执行线列表：放在 `../OkWork_业务架构与产品规划.md`。
- 非开发工作：teamwork 不结构化跟踪。

## 关键规则

- WS 必须来自 feature-planning 流程，不在流程外 ad-hoc 创建。
- 每个 WS 承接 1 条或多条执行线。
- 涉 UI 的 WS 在拆 feature 前先有 UI 全景初步规划；非 UI 标 `N-A`。
- WS 拆出的 feature 全部写入 ROADMAP 后，WS 才转 `✅ 规划完成`。
- WS 未规划完成前，不启动其子 Feature。
