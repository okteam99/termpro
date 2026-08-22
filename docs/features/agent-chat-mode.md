# TECH — Agent/Chat 会话模式(多模型 API 接入)· 评估与设计

> 状态:🟡 评估完成 · 待 Spike 定案(BL-009)。用户已确认方向:**harness 适配层 + opencode 先行,将来可换**(2026-08-18)。
> 排期:ROADMAP § WS-03 · 决策记录:[ADR-0005](../adr/ADR-0005-agent-harness-adapter.md) · 接口参考:[docs/reference/opencode-v1.18.18](../reference/opencode-v1.18.18/README.md)
> 本文仅设计,不改源代码。调研由 4 路子代理完成(openchamber / opencode 实测 / Claude Agent SDK / dsh 源码级),来源见 §8。

---

## 0. 需求

### 0.1 用户拍板要点

1. 新建 session 目前默认且只有 terminal;新增一种 **Agent/Chat 模式** session:用户与 coding agent 对话,agent 可读写文件、跑命令,UI 呈现流式回复、工具调用过程、权限审批、diff。
2. **模型接入 = API key 多 provider**(Anthropic / OpenAI / DeepSeek / 自建网关…),不依赖任何订阅 OAuth。
3. harness 不自研,用现成开源;**UI 与 harness 之间必须有适配层**——先接 opencode,将来可换 dsh 等。
4. 计划接入一个**三方算力平台接口(OpenAI 兼容)**,做成应用预置 provider(2026-08-18 补充):走 opencode custom provider(`npm: "@ai-sdk/openai-compatible"` + `baseURL`),经 `OPENCODE_CONFIG_CONTENT` 随 spawn 注入,用户只填 key;接入前按 §1.5 清单向算力方核实兼容面。

### 0.2 显式非需求(v1 出范围)

- 订阅 OAuth 登录(Claude Pro/Max 等第三方复用已被 Anthropic 从协议 + ToS 层封死;opencode 也已在 1.3.0 移除)。
- 同时并行多个 harness 后端(适配层保留可能性,v1 只交付 opencode + Mock)。
- 多 agent 编排 UI(子代理由 harness 内部处理,UI 只展示)。

### 0.3 开放决策(待用户拍板)

| # | 决策点 | 建议 | 状态 |
|---|---|---|---|
| D1 | README §Non-goals 写着 "No bundled or locked-in agent",与本功能冲突 | 措辞改为 "No **locked-in** agent":协议中立、后端可换,内置默认后端不锁死;agent-agnostic 依旧成立(terminal 里跑任何 CLI agent 不受影响) | ⬜ |
| D2 | opencode 二进制分发 | **首次使用按需下载**(压缩 43MB / 解压 143MB,不随安装包);远程 host 复用同一下载逻辑(类比现有远程 host 自动部署) | ⬜ |
| D3 | provider API key 存储 | 直接用 opencode 自身凭据存储(`PUT /auth/:id` → 跑 server 那台机的 `auth.json`);UI 只走 `agent.provider.*` RPC,renderer 不落任何明文。与「权威在 Host」一致,远程场景密钥天然落远端 | ⬜ |

---

## 1. 调研结论(2026-08-18)

### 1.1 选型矩阵

| 候选 | 结论 | 一句话理由 |
|---|---|---|
| **opencode**(anomalyco/opencode, v1.18.18) | ✅ **首个后端** | server 模式一等公民(162 条 HTTP 路径 + SSE),单 server 多项目(per-request `directory`),191 个 provider 全走 API key,MIT,官方桌面端就是 Electron + spawn server 的先例 |
| **DeepSeek Harness**(dsh, 0.1.0-rc.7) | ⏸ 观察名单 | 多模型接入合格、架构更优,但**所有可嵌入通路都拼不齐 chat UI 三件套(流式 + 中断 + 审批)**;明示破坏性变更;封闭治理(issues 关闭、拒收外部 PR、GitHub 只读镜像) |
| **Claude Agent SDK** | ❌ 排除 | 只跑 Claude 系模型,与「多模型 API」需求不符;且订阅复用被 ToS 明令禁止 |
| 自研 harness | ❌ 排除 | 重造工具执行/权限/agent loop,收益为零 |
| **openchamber**(opencode 第三方多端 UI) | 📖 仅 UI 参考 | 见 §1.4;它与 opencode 内部 API 强耦合、上游一升级就坏的教训,正是我们做适配层的反面教材 |

### 1.2 opencode 关键事实(本机实测 v1.18.18)

- **API 面**:`POST /session` / `POST /session/:id/prompt_async`(204 立即返回)+ SSE 收结果 / `POST /session/:id/abort` / 审批 `permission.updated` 事件 → `POST /permission/:requestID/reply {reply: once|always|reject}` / `GET /session/:id/diff` / `GET /permission`(重连重建待批列表)。事件 `Part` 联合(text/reasoning/tool/patch/…,`ToolPart.state: pending→running→completed|error`)足以渲染 Claude Code 级 chat UI。
- **单 server 多项目**:目录按请求指定(`?directory=` 或 `x-opencode-directory` header),一个 OkWork 实例 = 一个 opencode 进程。`/global/event` 一条 SSE 火管,每条事件带 `{directory, payload}` 信封可路由。
- **配置注入**:spawn 时 `OPENCODE_CONFIG_CONTENT` 环境变量整份注入(收紧权限默认值、指定模型),不污染用户磁盘配置;`AGENTS.md`/`CLAUDE.md` 直接兼容。
- **安全默认值要自己收**:server 默认无认证(必须设 `OPENCODE_SERVER_PASSWORD` + 绑 127.0.0.1);权限默认大部分 `allow`(必须把 `bash`/`edit`/`write` 收成 `ask` 交给我们的审批 UI)。
- **风险**:① v2 重写在途(活 server 已同时暴露 v1 与未文档化 `/api/*` 两套面),无 semver 承诺 → **锁死精确版本**;② SSE 流有未决 issue(中途断流 #38458、server 内存泄漏 #29204)→ Spike S1 一票否决项;③ 断线补齐靠未文档化 `/sync/history` 或重拉 `/session/:id/message` 对账。
- 仓库已从 `sst/opencode` 迁至 `anomalyco/opencode`(SST 改名 Anomaly)。

### 1.3 dsh 为何现在不行 + 重估触发条件

dsh 四条对外通路能力互补且互斥:SDK(stdio JSON-RPC,spawn 友好)**无中断方法**(官方文档:放弃一轮 = 关掉 runtime)、审批是 "dead capability";ACP 通路自称 "automation-only, not a UI integration",无 token 流式、不能恢复会话;Web API 是构建期 codegen 内部契约,无 SSE 无认证。另:会话格式版本钉死 0 且无升级路径;GitHub 仅只读镜像。

**重估触发条件(满足再看,预计 3-6 个月后)**:SDK 补上 cancel + server→client 审批;出现版本化稳定契约;进 1.0 去掉 developer preview 声明;治理开放(issues/PR);官方 Electron 载体落地(源码 `packages/host/webserver` 注释已预留)。

### 1.4 openchamber 借鉴清单(只抄模式不抄代码)

| 借鉴 | 对应到我们 |
|---|---|
| 上游 SSE **单连接** + 服务端扇出给多客户端 | Host 一条 `/global/event` 订阅,解复用后经自家协议推给多 UI 端 |
| **有界**重放缓冲 + Last-Event-ID 式断线补齐 | Host 侧 per-session 事件日志(seq),复用现有 RingBuffer/offset 回放思想(§2.4) |
| 权限审批卡片信息分层(工具/参数/一次 vs 永久) | `ApprovalCard` 组件设计 |
| diff 计算放 Worker 线程 | diff 查看器(BL-012) |
| 反面教材:UI 直连 opencode 内部 API,上游一升级就坏,社区喊解耦(#1422) | **适配层存在的理由**(ADR-0005) |
| 反面教材:长会话卡死、大工作区事件循环阻塞 | Host 侧心跳/超时检测 + delta 合批(§2.5) |

### 1.5 三方算力接口(OpenAI 兼容)核实清单

「OpenAI 兼容」在纯聊天场景几乎人人合格,但 coding agent 依赖的恰是兼容实现最参差的部分。签约/接入前逐项核实:

| # | 核实项 | 为什么要紧 |
|---|---|---|
| 1 | `/v1/chat/completions` **SSE 流式** | chat UI 基础;确认是标准 `data:` 分块 + `[DONE]` 终止 |
| 2 | **工具调用(tools/function calling)**,且 **`tool_calls` 参数支持流式增量** | agent 的命脉。很多兼容网关纯聊天没问题、工具调用缺失/参数不流式/多工具并行调用丢块 |
| 3 | `finish_reason` 保真(`tool_calls` / `stop` / `length` 区分正确) | harness 靠它驱动 agent loop 状态机 |
| 4 | `GET /v1/models` 可用 | opencode 与我们的 UI 靠它列模型 |
| 5 | 上下文长度与 `max_tokens` 的真实值(非宣传值) | agent 上下文长,超限行为(截断 vs 报错)要明确 |
| 6 | 是否有 **prompt caching**(多数网关没有) | agent 每轮重放长上下文,无缓存则成本/延迟成倍;没有就要在产品预期里注明 |
| 7 | 并发与限流(RPM/TPM),超限返回 429 + `Retry-After` 是否规范 | 多 session 并发 + opencode 重试策略依赖 |
| 8 | 推理模型的思考内容暴露方式(如 DeepSeek 风格 `reasoning_content` 非标字段) | 决定 reasoning 块能否渲染;非标字段需确认 AI SDK 兼容层是否透传 |
| 9 | 底层挂的具体模型清单及其 agent/工具调用能力 | 「兼容接口」不等于「模型会用工具」;最好直接跑 §5 S1 压测验证 |

结论先行:①~④ 任一不合格即不可作为 agent provider(可作纯问答降级);⑤~⑨ 影响体验与成本,记录进产品预期。

---

## 2. 架构设计

### 2.1 分层

```
UI(AgentChatView + chatRegistry,仿 terminalRegistry 跨挂载存活)
   ↕ protocol.ts 的 agent.* RPC + agent 事件 —— 只有中立类型,零 opencode 痕迹
Host(纯 Node,远程就绪)
   ├─ AgentSessionService    会话注册表 + per-session 有界事件日志(seq 回放)+ 多端 attach
   ├─ AgentHarness 接口      ← 适配层边界(ADR-0005)
   │    ├─ OpencodeHarness   supervisor + SSE 解复用 + part 投影 + 对账
   │    ├─ MockHarness       脚本化假后端:UI 开发 / 契约测试 / 无 key 冒烟
   │    └─ (将来)DshHarness / AcpHarness
   ↕ HTTP + SSE(127.0.0.1,随机端口,OPENCODE_SERVER_PASSWORD 随机串)
opencode serve(sidecar 子进程,版本锁死)
```

架构红线核对:agent 循环全部在 Host(纯 Node、可驻远端)→ 合盖续跑、断线重连的产品卖点对 Agent session 同样成立;UI 只走协议;opencode 由 Host spawn,不引入 Electron 依赖。

### 2.2 中立契约(protocol.ts 草图,BL-010 定稿)

动词刻意与 **ACP**(Agent Client Protocol)概念集同形(session/new · prompt · cancel · update · request_permission)——opencode、dsh、Gemini CLI、Codex CLI 都在向 ACP 靠拢,内部契约与其同形,将来加通用 `AcpHarness` 可白捡一批后端。

```ts
// UI 只认「块」,不认任何后端的 Part 联合
type AgentBlock =
  | { kind: 'text'; id: string; role: 'user' | 'assistant'; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; title: string;
      state: 'pending' | 'running' | 'done' | 'error';
      inputPreview?: string; outputPreview?: string }
  | { kind: 'diff'; id: string; files: FileDiffSummary[] }
  | { kind: 'error'; id: string; message: string }

// 全部带 seq,Host 落日志,可回放(§2.4)
type AgentEvent =
  | { t: 'block.upsert'; seq: number; messageId: string; block: AgentBlock }
  | { t: 'block.delta';  seq: number; blockId: string; textDelta: string }
  | { t: 'turn';  seq: number; state: 'started' | 'finished' | 'aborted' | 'error' }
  | { t: 'approval'; seq: number; req: { id: string; tool: string; title: string; detail?: string } }
  | { t: 'session'; seq: number; patch: Partial<AgentSessionMeta> }   // title/status/model…
```

RPC 族(向后兼容追加,能力位 `agent-mode`,不 bump PROTOCOL_VERSION,惯例 QA-14):
`agent.session.{create,list,close,rename,abort}` · `agent.prompt.send` · `agent.approval.reply` · `agent.attach {sessionId, sinceSeq}`(增量或全量回放,同 `session.attach` 的 offset 语义) · `agent.diff.get` · `agent.provider.{list,setKey,models}`。
`SessionSnapshot` 加**可选** `kind?: 'terminal' | 'agent'`(缺省 terminal,旧客户端零破坏)。

### 2.3 AgentHarness 接口(Host 内部,非协议)

```ts
interface AgentHarness {
  readonly caps: { abort: boolean; approvals: boolean; resume: boolean;
                   diff: boolean; multiProject: boolean }
  createSession(o: { cwd: string; model?: string }): Promise<HarnessSession>
  dispose(): Promise<void>
}
interface HarnessSession {
  prompt(text: string): Promise<void>          // 立即返回,结果走事件
  abort(): Promise<void>
  replyApproval(id: string, reply: 'once' | 'always' | 'reject'): Promise<void>
  onEvent(cb: (e: Omit<AgentEvent, 'seq'>) => void): () => void   // seq 由 AgentSessionService 统一编号
  close(): Promise<void>
}
```

- **能力位而非最小公倍数**:UI 按 `caps` 逐项降级(无 `abort` 则停止键置灰)。dsh 将来可以降级形态插入,不把接口砍到两家交集。
- **进程模型是适配器私事**:opencode 共享单 server 多目录、dsh SDK 一进程一 cwd,这个差异被 `createSession` 完全吸收。

### 2.4 Host 事件日志与回放(关键决策)

会话事件由 **Host 自己存**(归一化 AgentEvent 按 seq 追加,有界,溢出裁最旧的整轮),**不依赖后端的历史接口**:

- 多端 attach / 断线补齐走自家 `agent.attach {sinceSeq}`,与 PTY 的 RingBuffer + offset 回放同构;后端有没有 resume 能力不影响产品卖点。
- embedded / standalone 分叉沿用 ptyPool 现状:embedded 端口关闭即回收;standalone 断开续跑、保留 exited 态、上限逐最旧。

### 2.5 OpencodeHarness 要点

- **生命周期**:懒启动(首次开 agent tab 才 spawn)→ 就绪 = stdout `opencode server listening` + `GET /global/health` 轮询双保险(抄官方 `packages/desktop/src/main/server.ts`)→ 空闲回收 → Host 退出 kill;崩溃指数退避重启 + 重启后对账。
- **事件桥**:一条 `/global/event` SSE → 按 `directory` + `sessionID` 解复用 → **part 树投影**(按 `part.id` upsert 成 AgentBlock,不把裸增量透给 UI)→ **16~33ms 合批**再走协议(复用 terminal 节流经验)。
- **对账(必做)**:SSE 断开 → 重订阅 → `/sync/history` 补齐或退化为 `GET /session/:id/message` 全量重拉覆盖 → `GET /permission` 重建待批列表(否则卡住的审批永久丢失)。
- **配置**:`OPENCODE_CONFIG_CONTENT` 注入 —— `bash`/`edit`/`write` 收成 `ask`、默认 model、禁网络暴露;用户项目内 `opencode.json`/`AGENTS.md` 仍可覆盖。
- **职责划界**:agent 的 bash/PTY 由 opencode 自管(权限模型绑在上面);我们的 PTY 池继续服务用户手敲终端;diff/文件状态直接用 opencode 的,不自己算。

### 2.6 防泄漏纪律(评审检查项)

1. `protocol.ts` 与 `src/renderer/**` 中 grep 不到 `opencode`(设置页后端选择项除外)。
2. opencode 的 `Part`/`Permission` 类型只允许出现在 `src/host/agent/opencode/` 内。
3. **契约测试套件**跑在 `AgentHarness` 接口上(prompt→流式→turn 结束 / 审批往返 / abort / 断线回放),MockHarness 与 OpencodeHarness 都要过,将来新适配器跑同一套。
4. 接口纸面校验三个数据点:opencode openapi.json(已入库)、dsh SDK/ACP 事件形状(调研报告)、ACP spec——防止抽象长成单一后端的形状。

---

## 3. 与现有代码的接缝(读码结论,附行号)

| 接缝 | 现状 | 改动 |
|---|---|---|
| `src/shared/protocol.ts:83-111` `SessionSnapshot` | 无 kind,session ≡ PTY | 加可选 `kind`,新增 `agent.*` RPC 族 + `agent:event` 消息(`HostMessage` 联合加 `t` 值,旧端忽略未知 `t` 零破坏) |
| `src/host/hostCore.ts:194-427` handleRpc | switch 分发 | 加 `agent.*` case + `capabilities` 数组加 `agent-mode` |
| `src/host/` 新模块 | — | `agent/`(AgentSessionService · harness.ts · opencode/ · mock.ts),纯 Node |
| `src/renderer/state/store.ts:27-48` `TabState` / `:140-159` `PersistedTab` | 无 kind | 加 `kind`,`addTab` 族加参数 |
| `src/renderer/App.tsx:266-275` | 无条件渲染 `<TerminalView>` | 唯一分派点:按 kind 分派 `TerminalView` / `AgentChatView` |
| `src/renderer/components/TabBar.tsx:14-37,105-129` | 图标/新建入口硬编码 terminal | 图标分叉 + 新建菜单加「Agent 会话」 |
| `src/renderer/terminal/terminalRegistry.ts:96` 模块级 Map 模式 | — | 新建 `chatRegistry`(对话状态 + 流式缓冲跨挂载存活,显式 dispose) |
| `src/renderer/services/sessionReadopt.ts:80-88` | 无条件按 terminal 收养 | 按 kind 分叉重建 tab |
| `src/renderer/services/sessionEvents.ts:54-176` | per-session 定向事件路由 | agent 事件复用同一路由/通知策略层 |
| 密钥存储 | main 有 safeStorage、host 有 `remoteProfileCrypto.ts` 先例 | 走 D3(opencode auth.json),不新增 Vault |

---

## 4. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| opencode SSE 流断流 / 内存泄漏(#38458/#29204) | 高 | Spike S1 一票否决;上线后 Host 侧心跳超时检测 + 对账重建(§2.5) |
| opencode v2 破坏性变更 | 高 | 版本锁死 + 适配层隔离 + 升级前 diff `/doc` 与入库 openapi.json |
| 适配层长成 opencode 的形状 | 中 | §2.6 纪律 + 三数据点纸面校验 + 契约测试 |
| 143MB 二进制拖累分发 | 中 | D2 按需下载;下载失败降级提示,不影响 terminal 功能 |
| 权限默认过松导致 agent 未审批改文件 | 中 | `OPENCODE_CONFIG_CONTENT` 强制收紧;契约测试断言 `ask` 生效 |
| 与 README non-goal 冲突 | 低 | D1 拍板后改措辞,PR 里同步 |

---

## 5. Spike 计划(BL-009,预计 1~2 天,全过才立项开发)

| # | 内容 | 通过标准 |
|---|---|---|
| S1 **流式稳定性(一票否决)** | 真实 API key 连续 20+ 轮长任务;若拟接入的三方算力端点已可用,列为压测 provider 之一 | `message.part.updated` 无断流;server RSS 无单调上涨;abort 即时生效;工具调用流式保真(`tool_calls` 增量完整、`finish_reason` 正确,§1.5 ①~④) |
| S2 多项目并发 | 3 个 directory 同时跑 prompt | `/global/event` 路由正确、零串台 |
| S3 审批闭环 + 断线对账 | `ask` 权限 + 中途杀 SSE | 事件→回复闭环通;重连后 `GET /permission` + `/sync/history` 恢复无丢失 |

产出:go/no-go 结论 + ADR-0005 状态翻转(accepted / rejected)+ 若 no-go 启动备选评估(opencode ACP 模式或等 dsh)。

## 6. 里程碑拆解(BL-010…BL-013,详见 ROADMAP § WS-03)

| BL | 内容 | 关键验收 |
|---|---|---|
| BL-010 协议 + Host 适配层 | `agent.*` 协议、AgentSessionService(事件日志/attach 回放)、AgentHarness + MockHarness + OpencodeHarness、契约测试 | 契约测试双后端全绿;`agent.attach` 断线补齐;红线纪律 grep 检查过 |
| BL-011 Chat UI 最小可用 | kind 分派、AgentChatView(流式渲染/工具卡片/停止)、chatRegistry、TabBar 入口 | 对 MockHarness 全流程可用;真实 opencode 联调冒烟过;终端功能零回归 |
| BL-012 审批 + diff + provider 配置 | ApprovalCard、diff 查看(worker 化)、provider/key 管理 UI(D3) | `ask` 工具走 UI 审批;diff 可视;key 不经 renderer 持久化 |
| BL-013 持久化 / 收养 / 分发 | PersistedTab kind、sessionReadopt 分叉、opencode 按需下载(D2)、远程 host 支持 | 重启/断线收养 agent 会话;远程 workspace 可开 agent 会话;无 opencode 时优雅降级 |

依赖:BL-009 → BL-010 → BL-011 → BL-012 ∥ BL-013(⚠️ 两者同改 protocol.ts,分区块追加、先合先赢)。

## 7. 流程与分工

- 每 BL 按项目节奏拆 3~6 阶段、每阶段一 commit、`tsc` + `vitest` + 冒烟三绿才提交;BL 收尾 opus 评审(重点:§2.6 纪律 + 并发/对账路径)。
- UI 组件(AgentChatView/ApprovalCard/diff)给足规格后派 sonnet;适配层/对账/协议由主循环 + opus 评审把关。
- MockHarness 进 `OKWORK_SMOKE=1` 冒烟链路,CI 无需 API key。

## 8. 来源

- opencode 实测:见 [docs/reference/opencode-v1.18.18](../reference/opencode-v1.18.18/README.md);文档 opencode.ai/docs(server/sdk/acp/providers/permissions);issue #38458 · #29204 · #27663 · #36495。
- openchamber:github.com/openchamber/openchamber(MIT,8.9k★);issue #2810(v2 兼容)· #1422(AgentRuntime 抽象呼声)· #1202/#1258(长会话卡死)· #2096(事件循环阻塞)。
- dsh:github.com/deepseek-ai/deepseek-harness(0.1.0-rc.7 本地 clone 逐包读码);`packages/sdk/protocol`(no mid-turn cancel / dead capability 原文)· `packages/acp`(automation-only 原文)· CONTRIBUTING(拒收外部 PR)。
- Claude Agent SDK:code.claude.com/docs/en/agent-sdk(订阅复用禁令原文 "Anthropic does not allow third party developers to offer claude.ai login…")。
- ACP:agentclientprotocol.com。
