---
id: ADR-0005
title: Agent/Chat 模式经 ACP 形中立契约的 AgentHarness 适配层接入,opencode 为首个后端
status: proposed
date: 2026-08-18
tags: [agent, harness, protocol, host, opencode]
triggered_by: "docs/features/agent-chat-mode.md"
supersedes: []
---

## 背景

要在 terminal 之外新增 Agent/Chat 会话模式(用户需求:**API key 接入多家模型**,harness 用现成开源,将来可换)。2026-08-18 完成四路调研(细节与来源见 [feature 文档](../features/agent-chat-mode.md) §1):

- **opencode**(v1.18.18 实测):server 模式一等公民,HTTP+SSE 覆盖 chat UI 全部所需(流式/中断/审批/diff),单 server 服务多项目目录,191 provider 全 API key,MIT。风险:v2 重写在途、无 semver 承诺、SSE 流有未决 issue。
- **DeepSeek Harness**(0.1.0-rc.7 读码):嵌入通路拼不齐「流式 + 中断 + 审批」三件套(SDK 无 cancel、审批是 dead capability;ACP 通路自称 automation-only);明示破坏性变更;封闭治理(issues 关闭、拒收外部 PR)。
- **Claude Agent SDK**:仅 Claude 系模型,订阅复用被 ToS 明令禁止,与多模型需求不符。
- **openchamber**(opencode 第三方 UI):因 UI 直连 opencode 内部 API,上游一升级就坏(#791/#1543/#2810),社区在要求 AgentRuntime 抽象(#1422)——强耦合的代价有实证。

架构红线(DEV-RULES):UI 永不直接碰 fs/PTY/git 只走协议;Host 零 Electron import;会话状态驻留 Host、断线续跑。

## 决策

**五条:**

1. **适配层边界放在 Host 内**:定义 `AgentHarness` / `HarnessSession` 接口(纯 Node),opencode/dsh/mock 都是其实现。`protocol.ts` 与 renderer 只见中立类型——两处 grep 不到 `opencode`(设置页后端选择项除外);opencode 的 `Part`/`Permission` 类型只允许出现在 `src/host/agent/opencode/` 内。
2. **中立契约与 ACP 概念集同形**(session/new · prompt · cancel · update · request_permission),事件模型为「块(AgentBlock)+ 带 seq 的事件(AgentEvent)」。理由:opencode/dsh/Gemini CLI/Codex CLI 都在向 ACP 靠拢,同形契约让将来的通用 `AcpHarness` 成本最低;但**不直接用 ACP 当内部协议**(其公共子集缺 diff/回放/能力协商,且 dsh 的 ACP 实现残缺)。
3. **会话事件日志由 Host 自存**(归一化 AgentEvent 按 seq 追加、有界),多端 attach/断线补齐走自家 `agent.attach {sinceSeq}`(与 PTY RingBuffer+offset 回放同构),**不依赖后端的历史/resume 接口**。这是「合盖续跑、重连补齐」产品卖点对 Agent session 成立的前提。
4. **能力位而非最小公倍数**:`caps: {abort, approvals, resume, diff, multiProject}` 逐项声明,UI 按位降级。进程模型(opencode 共享单 server vs dsh 一进程一 cwd)是适配器私事,被 `createSession` 吸收。
5. **首个后端 = opencode,版本锁死**:Host spawn 单个 `opencode serve`(127.0.0.1 随机端口 + 随机密码),per-request `directory` 服务多项目;`OPENCODE_CONFIG_CONTENT` 注入收紧的权限默认值;`/global/event` 单 SSE 解复用 + part 投影 + 16~33ms 合批;断线对账(`/sync/history` + `GET /permission`)必做。**MockHarness 与 opencode 同步交付**,契约测试跑在接口上、双后端全绿。

## 备选与否决

| 备选 | 否决理由 |
|---|---|
| UI/协议直连 opencode API(不做适配层) | openchamber 的实证教训:上游升级即碎;v2 重写在途放大该风险;适配层增量成本极小(投影逻辑反正要写,只是类型放对位置) |
| dsh 为首个后端 | 嵌入面缺 cancel/审批(协议层不存在,非配置问题);封闭治理无法上游化修复;重估触发条件见 feature 文档 §1.3 |
| Claude Agent SDK | 单一模型家族 + 订阅复用禁令,与「多模型 API key」需求直接冲突 |
| ACP 直接作为内部协议 | 公共子集缺 diff/回放/能力协商;等于把契约锁在第三方演进节奏上;取其形不取其身 |
| 事件历史依赖后端 resume | 后端能力参差(dsh ACP 无 resume);断线续跑是产品立身之本,不能押在后端能力上 |

## 后果

- ✅ 换后端 UI 零改动;新后端成本 = 一个适配器 + 过同一套契约测试(估计为接入总量六七成——买到的是「协议与 UI 不返工」,不是「免费换引擎」)。
- ✅ MockHarness 使 UI 开发/CI 冒烟不需要 API key。
- ⚠️ 投影层(opencode Part → AgentBlock)是持续维护点,opencode 升级需 diff 入库的 openapi.json 后适配。
- ⚠️ Host 事件日志引入第二份会话状态(opencode 侧也存),以 Host 日志为 UI 唯一真源、opencode 侧仅作对账来源,避免双权威。
- ⛔ 本决策在 Spike S1(流式稳定性,一票否决)通过前保持 proposed;no-go 则回退评估 opencode ACP 模式或等待 dsh 成熟。
