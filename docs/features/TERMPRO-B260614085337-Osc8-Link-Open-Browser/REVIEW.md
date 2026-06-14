---
reviewers: [architect, qa, external]
verdict: APPROVE
target_commit: 3a07bb7
target_base: 5ec66fe
external_model: codex-cli 0.139.0
generated_at: "2026-06-14T09:48:00Z"
---

# Review · TERMPRO-B260614085337-Osc8-Link-Open-Browser(review stage)

## 结论:**APPROVE**(三视角一致)

修复为根因级、最小、符合 xterm 惯用法:给 `Terminal` 构造选项设 `linkHandler = createOscLinkHandler()`,使核心 `OscLinkProvider` 的 OSC 8 链接激活路由到 `window.termpro.openExternal`,永不触达 `defaultActivate`(`confirm` 弹框 + `window.open`)。纯文本链接(`SystemWebLinkProvider`)与文件链接(`FsLinkProvider`)路径不受影响。

| 视角 | 模型 | verdict | 确认 P1/P2 |
|------|------|---------|-----------|
| Architect | opus | APPROVE | 0 / 0(3 P3 cosmetic) |
| QA | opus | APPROVE | 0 / 1(非阻断)+ 4 P3 |
| External | codex-cli 0.139.0 | APPROVE | 0(no blocking findings) |

## 关键确认(已实证 · 非盲信)

1. **API 正确性**:`linkHandler` 是 xterm 公开稳定选项(`xterm.d.ts:163`),且**仅** `OscLinkProvider` 读取;提供后 `OscLinkProvider.ts:89` 走 `linkHandler.activate`,彻底绕开 `defaultActivate`。
2. **安全双重防护**:`allowNonHttpProtocols` 保持 falsy → OscLinkProvider 先把 URI 过滤到 http/https(`OscLinkProvider.ts:71-83`)才交到 handler;main 进程 `shell:open-external` 再次 `^https?://` 守卫(`main.ts:102`)。无任意协议 / file:// / javascript: 暴露。
3. **分层红线(远程就绪)**:handler 只经 `window.termpro.openExternal` 的 IPC 桥到达 main → `shell.openExternal`,renderer 不直接碰系统资源;符合 README §五。
4. **无重复打开 / 无回归**:xterm `Linkifier`(注册下标小者优先 · `Linkifier.ts:160-198`)对相交链接去重;OSC provider(下标 0)胜出,自定义 provider 不会同时触发。现有纯文本链接测试保持通过。
5. **门禁三绿**(QA + External 本地复跑确认):tsc 0 错 · vitest 19 文件/179 测试全过(含新增 OSC8 用例)· headless `SMOKE_OK`。

## Findings 处理

| # | 来源 | 严重度 | finding | 处置 | 理由(实证) |
|---|------|--------|---------|------|------|
| 1 | QA | P2(非阻断) | 2 条新测试只覆盖 `createOscLinkHandler()` 工厂本身,未断言 `Terminal` 实际以该 handler 构造(`terminalRegistry.ts:56` 无测试);未来重构可能去掉 wiring 而测试仍绿 | **ACCEPTED · 不阻断本 fix** | 断言 wiring 需在 jsdom 构造真实 xterm `Terminal`(成本高、本仓无此类测试先例);对单行声明式选项、且已被 3 视角 + external 独立读码确认的改动,投入产出比低。external reviewer 亦独立确认 wiring 位置正确(`terminalRegistry.ts:46,56`)。记为已知限制。 |
| 2 | Architect | P3 | OSC handler 未带 `stopPropagation()`(纯文本路径有) | REJECTED(非缺陷) | OSC 链接激活由 xterm 自身派发并调用 `linkHandler.activate`,与自定义 provider 的 DOM 级处理传播语义不同;此处无需 stopPropagation,加上反而误导。 |
| 3 | Architect/QA | P3 | 可加非 http OSC 链接的负向测试以在模块级锁定安全契约 | 备选 · 非阻断 | OscLinkProvider 在到达 handler 前已过滤非 http;契约已被核心 + main 双重保证。可作后续增强,不阻断。 |

## 复跑命令(可复现)
- `npm run typecheck`
- `npx vitest run`
- `TERMPRO_SMOKE=1 npx electron-forge start` → `SMOKE_OK`

VERDICT: APPROVE
