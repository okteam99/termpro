# opencode v1.18.18 实测参考产物

> 2026-08-18 评估 Agent/Chat 模式 harness 时,对本机实际运行的 `opencode serve`(darwin-arm64, v1.18.18)导出的一手资料。
> 上游:`anomalyco/opencode`(原 `sst/opencode`,MIT)。评估结论见 [docs/features/agent-chat-mode.md](../../features/agent-chat-mode.md) 与 [ADR-0005](../../adr/ADR-0005-agent-harness-adapter.md)。

| 文件 | 内容 | 来源 |
|---|---|---|
| `openapi.json` | 完整 OpenAPI 3.1.0 spec,**162 条路径**(远多于官方文档站列出的) | 活 server `GET /doc` 实测导出 |
| `types.gen.ts` | `@opencode-ai/sdk` 全量类型:46 种 SSE 事件、`Part` 可辨识联合、`Permission` 形状 | npm 包 v1.18.18 解包 |

用途:
- 写 `OpencodeHarness` 适配器时的**唯一权威接口参考**(锁定 v1.18.18;升级 opencode 版本前先 diff 新版 `/doc` 与本文件)。
- 文档站没写但实测存在的端点在此可查:`/sync/history`(SSE 断线补齐)、`POST /permission/:id/reply`(新版审批)、`createOpencodeClient` 的 `directory` 选项等。
