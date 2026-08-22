---
feature_id: "OKWORK-B260822080545-OkBrowser-Stale-Download-Replay"
author: QA
status: confirmed
prd_ref: N/A (Bug flow; bugfix report is authoritative)
tc_ref: N/A (Bug flow)
test_run_at: "2026-08-22T10:36:26Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: N/A (Bug flow)
revision_history:
  - version: v1.0
    date: "2026-08-22"
    author: QA
    summary: BrowserPanel lazy-mount and Review F1 background navigation regression evidence
---

# OkBrowser 历史下载标签重放 - Test Report

> Bug 流规格依据：`bugfix/BUG-OKWORK-B260822080545-001.md`。本报告记录回归证据；不冒充 live Electron/API-E2E。

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 结果 |
|---|---|---|---|
| integration（单进程进程内契约） | 真实 `useAppStore`、BrowserPanel lazy mount/keep-alive、browserViewRegistry mount request、browserControl background navigate | `src/renderer/components/__tests__/BrowserPanel.test.tsx` + `src/renderer/services/__tests__/browserControl.test.ts` | ✅ 2 files / 39 tests |
| api-e2e（真跨进程 live API） | N/A：本 Bug 没有 HTTP/DB API；回归对象是 renderer React/store/webview registry 生命周期 | N/A | N/A（不冒名） |
| Python regression driver | 从任意 cwd 定位 worktree，启动上述 Vitest 子进程并透传 exit code | `e2e/okbrowser_lazy_mount_regression.py` | ✅ exit 0 |

## §2 integration 结果

### 2.1 执行命令

```bash
npx vitest run src/renderer/components/__tests__/BrowserPanel.test.tsx src/renderer/services/__tests__/browserControl.test.ts
```

### 2.2 stdout 摘录

```text
✓ src/renderer/services/__tests__/browserControl.test.ts (14 tests) 58ms
✓ src/renderer/components/__tests__/BrowserPanel.test.tsx (25 tests) 212ms

Test Files  2 passed (2)
Tests       39 passed (39)
Start at    18:35:55
Duration    1.01s
```

stderr 中保留的既有测试环境提示：

```text
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
```

该提示未导致失败。

### 2.3 exit-code

`exit-code = 0`

## §3 Python→Vitest regression driver

### 3.1 语义边界

`okbrowser_lazy_mount_regression.py` 是 **Python→Vitest process regression driver**：它启动真实 Vitest 子进程，覆盖两个测试文件；不是 live Electron、browser-e2e，也不是 api-e2e。driver 将子进程 stdout/stderr 原样保留在 stderr 分段，并在 stdout 最后输出机器可读 JSON；进程退出码原样透传。

### 3.2 执行命令

```bash
cd /tmp
python3 /Users/liam/apps/okok/TermPro/.worktree/OKWORK-B260822080545-OkBrowser-Stale-Download-Replay/docs/features/OKWORK-B260822080545-OkBrowser-Stale-Download-Replay/e2e/okbrowser_lazy_mount_regression.py
```

### 3.3 driver stdout/stderr 摘录

```text
=== vitest stdout ===
✓ src/renderer/services/__tests__/browserControl.test.ts (14 tests) 58ms
✓ src/renderer/components/__tests__/BrowserPanel.test.tsx (25 tests) 203ms
Test Files  2 passed (2)
Tests       39 passed (39)

=== vitest stderr ===
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
```

最终 JSON 关键字段：

```json
{
  "driver": "Python→Vitest process regression driver",
  "live_electron": false,
  "api_e2e": false,
  "exit_code": 0,
  "scope": "BrowserPanel lazy ZIP/programmatic mount request + browserControl background navigate"
}
```

### 3.4 exit-code

`exit-code = 0`（Vitest 子进程 exit code 直接透传）。

## §4 API-E2E 结论

API-E2E：**N/A**。该 Bug 的副作用发生在 renderer 的 BrowserPanel/webview 挂载生命周期；没有需要启动的 HTTP gateway、真实 DB/Redis 或跨进程业务 API。将 Vitest 冒名为 API-E2E 会错误地宣称验证了 live Electron/API 链路，因此本轮仅登记进程内 integration 与明确标注边界的 Python driver。

## §5 回归结果

| 回归项 | 覆盖内容 | 结果 |
|---|---|---|
| R-001 | 当前安全 GitHub 标签首次挂载；后台持久化 ZIP 首次不挂载；激活后台终端后 ZIP 才挂载；切回后 ZIP keep-alive | ✅ |
| R-002 | 程序化 `requestBrowserViewMount(backgroundId)` 不切 terminal 焦点；真实 ref 注册后 promise resolve；后台 view `visibility:hidden` | ✅ |
| R-003 | background `browserControl.navigate` 先通过 `onBrowserViewMountRequested` 请求挂载并保持 pending；注册 view 后 resolve；store URL 更新、面板打开、不二次 `loadURL` | ✅ |
| R-004 | 既有 BrowserPanel 邻近回归（Remote Profile、window.open 来源、错误条、弹出窗格等） | ✅ 25/25 |
| R-005 | 既有 browserControl 邻近回归（目标解析、交互原语、预览标签、弹出窗格、标签管理） | ✅ 14/14 |

### Review F1 修复说明

Review F1 指出：lazy mount 后，后台 browser tab 不在 registry 中，程序化 `browserControl.navigate` 可能直接更新 store 并返回，形成“假成功”，且没有真实 webview 承接导航。修复后：

- `browserViewRegistry` 提供 mount request/waiter，允许控制层请求指定 browser tab 挂载并等待真实 ref 注册。
- BrowserPanel 响应 mount request，只挂载目标 browser tab，不改变 terminal activeTabId；目标成为后台 view 时保持隐藏。
- `browserControl.navigate` 对未挂载目标等待 mount promise；目标注册后直接完成，不对新 view 再次调用 `loadURL`，避免重复导航。

## §6 既有 dev-stage 门禁证据（引用，不在本轮重复执行）

以下证据来自 dev stage 的真实记录：

```text
npm test
Test Files  202 passed | 12 skipped (214)
Tests       2048 passed | 114 skipped (2162)
exit_code=0

OKWORK_SMOKE=1 npx electron-forge start
SMOKE_OK
exit_code=0
```

本 Test stage 新增的关键路径 2 files / 39 tests 已在 §2 与 §3 重新实跑并记录真实 exit code。

## §7 已知问题（不阻塞）

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| TEST-WARN-001 | browserControl 测试环境输出 jsdom canvas `getContext()` not implemented warning | Info | 不影响断言或 exit code；不改产品/测试语义 | - |

## §8 结论

✅ Bug 回归通过：历史 ZIP 后台 webview 不再在 BrowserPanel 初次挂载时 eager 请求；用户或程序化控制明确触达后台标签后才挂载，并由 keep-alive/真实 ref 保持后续操作语义。integration 与 regression driver 均 exit 0；API-E2E 按范围明确 N/A。
