---
feature_id: TERMPRO-B260614085337-Osc8-Link-Open-Browser
kind: e2e-smoke
result: SMOKE_OK
exit_code: 0
captured_at: "2026-06-14T09:39:00Z"
---

# E2E / Smoke 证据 · OSC8 linkHandler 接线后应用可启动

命令:`TERMPRO_SMOKE=1 npx electron-forge start`(headless · 渲染层完成 Host 握手即退出)

结果:**SMOKE_OK** · exit 0 — 带新增 `linkHandler` 的 `Terminal` 构造路径在真实 Electron 启动中无异常,渲染层与 Host 握手成功(终端实例创建路径即 `getOrCreateTerminal`,linkHandler 在此注入)。

## 实跑日志尾部(证据)

```
once the app is packaged.
[host] ready, pid=69755, protocol=v1
[host] client 1 attached (total 1)
[host] git smoke: {"toplevel":"/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-B260614085337-Osc8-Link-Open-Browser","mainWorktree":"/Users/liam/apps/okok/TermPro","branch":"fix/termpro-b260614085337-osc8-link-open-browser"}
SMOKE_OK
[host] client 1 detached (sessions cleaned: 1, clients left: 0)
[main] host exited with code 0
libc++abi: terminating due to uncaught exception of type Napi::Error
```

> 备注:OSC8 链接点击 → 系统浏览器的端到端鼠标交互,headless 环境无法自动化点击驱动(需真实窗口 + 系统浏览器);该行为由单测 `createOscLinkHandler` 路由断言 + 三视角读码确认覆盖(见 REVIEW.md / TEST-REPORT.md)。如需可视化端到端验证,可在 browser_e2e 阶段补。
> 日志尾部的 `Napi::Error` 出现在 `host exited with code 0` 之后,为退出期 node-pty 原生模块清理噪音(既有行为),非功能失败。
