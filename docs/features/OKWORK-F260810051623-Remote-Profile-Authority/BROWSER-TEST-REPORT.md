---
feature_id: "OKWORK-F260810051623-Remote-Profile-Authority"
author: QA + Designer
status: confirmed
ui_ref: UI.md (v0.4)
prd_ref: PRD.md (v0.4)
test_run_at: "2026-08-10T14:41:22Z"
browser_automation: playwright-core electron
viewport:
  width: 2200
  height: 1536
url_base: "real Electron OkBrowser + disposable loopback login fixture"
screenshots_count: 10
ac_coverage:
  total: 9
  with_screenshot: 5
revision_history:
  - version: v0.1
    date: "2026-08-10"
    author: QA + Designer
    summary: "真实 Electron OkBrowser 密码旅程与全窗口截图"
---

# Remote Host Profile 权威存储与迁移 - Browser E2E Test Report

> 本文是 teamwork browser_e2e-stage 产物。自动化对象不是系统浏览器 URL bar：它是 shipped Electron **OkBrowser** 的完整窗口，截图包含应用 chrome 与 OkBrowser 自己的地址栏。

## §1 测试范围

| 项 | 内容 |
|---|---|
| 浏览器自动化 | `playwright-core` Electron driver |
| 被测应用 | fresh `npm run package` 产物启动的 Electron OkWork / OkBrowser |
| 浏览器前置状态 | 临时 user-data dir；E2E bootstrap 创建一次性 workspace；真实 loopback 登录 fixture |
| URL base | `http://127.0.0.1:<ephemeral-port>`，经 OkBrowser 应用地址栏访问 |
| 截图形式 | `page.screenshot()` 全可见 Electron 窗口内容；不裁剪 element |
| 本轮退出码 | `node e2e/password-vault.e2e.cjs --screenshots-dir=...` → `exit-code = 0` |

内置 Browser connector 当前无可控实例（`list=[]`），因此没有绕过为系统浏览器自动化；本轮使用仓库所交付的真实 Electron E2E。

### 范围说明

本旅程没有连接真实 Remote Host，故不冒充已视觉验证远端迁移目标、二次确认或 Remote Host 依赖删除。远端迁移确认文案与状态的视觉覆盖来自已反向同步的 Panorama/UI 设计和 renderer TC；AC-4、AC-5、AC-7 等持久化状态机由 [TEST-REPORT.md](./TEST-REPORT.md) 的 integration / Host CLI E2E 证据承担。本轮真实 Electron 重点是用户当前可达的普通 `Password storage: This device` 文案、无说明气泡/无 `AUTHORITY`、以及密码 UI 的可见安全边界。

## §2 测试场景

### Scenario: FE-E2E-001 · OkBrowser 保存、填充与失败不覆盖

**对应 AC**: AC-1（可见普通存储文案）、AC-3/AC-9 的浏览器可见部分  
**类型**: happy path + edge case

```text
1. 在 shipped Electron app 中打开独立 OkBrowser。
2. 访问 loopback /login，成功登录后保存密码。
3. 重访同 exact origin，验证自动填充；再访问预填页面，验证不覆盖非空字段。
4. 提交失败登录，验证已保存密码不改变。
```

| # | 文件 | 验证点 |
|---|---|---|
| 1 | `screenshots/01-browser-saved-status.png` | 应用 chrome、OkBrowser 地址栏、`Password storage: This device` 普通文字与不含密码的 saved status 可见。 |
| 2 | `screenshots/02-browser-auto-fill.png` | 已保存单账户自动填充后仅显示非秘密状态。 |
| 3 | `screenshots/03-browser-prefilled-protection.png` | 预先存在的页面字段不被 silent fill 覆盖。 |
| 4 | `screenshots/08-browser-auth-failed-unchanged.png` | 失败登录显示 saved password unchanged。 |

自动化断言还确认 `.password-status__disclosure` 数量为 0 且 OkBrowser chrome 不包含 `AUTHORITY`；截图 #1 可见普通存储文字而没有这两种已移除元素。

### Scenario: FE-E2E-002 · Saved Passwords 仅显示 metadata 与可信窗口边界

**对应 AC**: AC-6/AC-8/AC-9 的浏览器可见部分  
**类型**: happy path + security boundary

```text
1. 打开 Settings → Saved Passwords。
2. 验证普通管理页只含 origin/username/掩码 metadata，且带 DOM/clipboard disclosure。
3. 打开可信窗口，验证初始掩码、显式 reveal 后自动重新掩码、显式 copy 后提示 clipboard 边界。
```

| # | 文件 | 验证点 |
|---|---|---|
| 1 | `screenshots/04-saved-passwords-metadata-disclosures.png` | 普通管理页 metadata-only、密码掩码、DOM 与 clipboard 风险披露。 |
| 2 | `screenshots/05-trusted-initial-masked.png` | 隔离 Trusted password window 初始掩码。 |
| 3 | `screenshots/06-trusted-auto-remasked.png` | reveal 后自动恢复为掩码。 |
| 4 | `screenshots/07-trusted-copy-disclosure.png` | copy 操作的系统剪贴板边界披露。 |

自动化实际检查 reveal 值只出现于 isolated trusted window，普通 Saved Passwords renderer 始终不含该密码，并在结束前恢复原系统剪贴板内容。

### Scenario: FE-E2E-003 · 删除保存密码的二次确认与空态

**对应 AC**: 删除交互的浏览器可见边界（不等同于 AC-7 的 Remote Profile 删除状态机）  
**类型**: edge case

| # | 文件 | 验证点 |
|---|---|---|
| 1 | `screenshots/09-saved-password-delete-confirm.png` | 删除 credential 前显示确认、Delete 与 Cancel。 |
| 2 | `screenshots/10-saved-password-delete-empty.png` | 删除后显示 `No saved passwords yet` 空态。 |

## §3 AC↔截图覆盖矩阵

| AC ID | 浏览器可观察部分 | 截图 | 状态 / 非视觉证据 |
|---|---|---|---|
| AC-1 | 本机 Profile 存储位置的普通文本、成功与失败反馈 | 01, 02, 08 | ✅ 本轮截图；持久化唯一 authority 见 TEST-REPORT / TC-001。 |
| AC-2 | Remote target、信任披露与二次确认 | - | 不适用：本轮无真实 Remote Host；renderer TC-002 与 UI.md 覆盖。 |
| AC-3 | 普通窗口不显示秘密、trusted window 是独立窗口 | 04, 05, 06 | ⚠️ 仅 UI 部分；main-only/capability 由 TC-003 与 Host CLI E2E 覆盖。 |
| AC-4 | copy→verify→switch 迁移状态机 | - | 非视觉持久化状态机，见 TEST-REPORT TC-004/005。 |
| AC-5 | 提交边界、cleanup pending/retry | - | 非视觉恢复语义，见 TEST-REPORT TC-006/007。 |
| AC-6 | metadata-only、trusted reveal/auto-remask/copy | 04, 05, 06, 07 | ✅ 用户可见密码边界；Remote offline fail-closed 由 TC-008/012 覆盖。 |
| AC-7 | Remote Profile 删除撤权与跨重启 retry | - | 非视觉状态机；09/10 仅 credential 删除交互，完整语义见 TC-009。 |
| AC-8 | DOM/clipboard 边界披露 | 04, 07 | ✅ 披露 UI；Remote Host deletion dependency 见 TC-007/010/013。 |
| AC-9 | 普通 renderer 不显示密码、可信窗口初始掩码 | 04, 05 | ✅ 用户可见部分；磁盘/日志/错误脱敏见 TC-011 与 Host CLI E2E。 |

截图直接证明的 browser-observable AC：**5 / 9**（AC-1、AC-3 UI 部分、AC-6、AC-8 UI 部分、AC-9 UI 部分）。其余或其安全/状态机部分明确由 TEST-REPORT 的非视觉测试承担，而非截图臆断。

## §4 flaky / retry 处理

| Scenario | 重试次数 | 结果 |
|---|---:|---|
| 全部 Electron password-vault journey | 0 | ✅ pass；未发生 E2E failure 或静默重试 |

## §5 截图清单（全 inventory）

```text
screenshots/
├── 01-browser-saved-status.png                 (57,862 B · 2200×1536)
├── 02-browser-auto-fill.png                    (65,871 B · 2200×1536)
├── 03-browser-prefilled-protection.png         (67,549 B · 2200×1536)
├── 04-saved-passwords-metadata-disclosures.png (239,602 B · 2800×1800)
├── 05-trusted-initial-masked.png               (64,728 B · 1040×776)
├── 06-trusted-auto-remasked.png                (64,880 B · 1040×776)
├── 07-trusted-copy-disclosure.png              (66,445 B · 1040×776)
├── 08-browser-auth-failed-unchanged.png        (72,279 B · 2200×1536)
├── 09-saved-password-delete-confirm.png        (243,264 B · 2800×1800)
└── 10-saved-password-delete-empty.png          (236,745 B · 2800×1800)

共 10 张，`file` 已确认全部为可读 RGB PNG；目录总计约 1,172 KiB。文件时间均为本次执行的 2026-08-10 22:40（本地时区）。
```

## §6 已知异常 / 不阻塞项

| ID | 现象 | 严重度 | 决定 |
|---|---|---|---|
| BROWSER-CONNECTOR-UNAVAILABLE | 内置 Browser connector 无可控实例 | 环境限制 | 使用仓库真实 Electron Playwright E2E；不以系统浏览器替代。 |
| REMOTE-HOST-NOT-IN-JOURNEY | 本次旅程无可用 Remote Host | 范围限制 | 不声称远端迁移 UI 已由截图实测；由 UI/renderer/integration 证据补齐。 |

## §7 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-08-10 | QA + Designer | ✅ pass | Fresh package、真实 Electron journey、10 张全窗口 PNG 与关键断言通过。 |
