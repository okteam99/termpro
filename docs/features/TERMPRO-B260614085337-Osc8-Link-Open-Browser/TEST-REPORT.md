---
feature_id: TERMPRO-B260614085337-Osc8-Link-Open-Browser
stage: test
verdict: PASS
integration_exit_code: 0
e2e_exit_code: 0
generated_at: "2026-06-14T09:50:00Z"
---

# Test Report · TERMPRO-B260614085337-Osc8-Link-Open-Browser

## 结论:**PASS** · 原 bug 不复发 + 周边无新错

本 Bug 为终端 renderer 行为修复(OSC 8 链接激活路由),回归覆盖落在 vitest 单测 + headless 冒烟;无独立 API/integration 服务,故映射如下。

## 测试矩阵

| 类别 | 命令 | 结果 | exit |
|------|------|------|------|
| 单测 / 组件(= integration 位) | `npx vitest run` | **19 文件 / 179 测试全过** · 含新增 OSC8 用例 3 条 | 0 |
| 类型 | `npm run typecheck` | 0 错(本 fix 文件 0 错 · 全仓 0 错) | 0 |
| 冒烟 e2e(= e2e 位) | `TERMPRO_SMOKE=1 npx electron-forge start` | **SMOKE_OK**(渲染层 Host 握手成功) | 0 |

## 回归点(原 bug 不复发)

`src/renderer/terminal/__tests__/terminalWebLinks.test.ts` › `createOscLinkHandler (OSC 8 hyperlinks)`:
1. OSC8 http 链接激活 → `window.termpro.openExternal(uri)` 被调用 · `window.confirm` / `window.open` **均未**调用(= 弹框路径消除)。
2. OSC8 https 链接同样路由到 `openExternal`,不触发 confirm。

> 反向验证:在未设 `linkHandler` 的旧代码上,OSC 链接走 `defaultActivate` → `confirm`,该断言会失败 → 是真回归测试,非恒真。

## 周边无新错

- 既有 `SystemWebLinkProvider`(纯文本 http 链接)测试保持通过 — 纯文本路径未改动。
- `FsLinkProvider`(文件/路径链接)相关测试通过 — 文件链接路径未改动。
- 全量 179 测试无新增失败。

## 环境备注(非本 fix 引入)
- node_modules 此前缺 `jsdom`(package.json 已声明 `^29.1.1`),test 阶段按声明补装(仅 node_modules · 未改 package.json/lock);补装前后本 fix 的 3 条 OSC8 测试均独立通过(不依赖 jsdom 环境)。
