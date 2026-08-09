---
feature_id: "OKWORK-F260807022801-Profile-Password-Vault"
author: QA + Designer
status: confirmed
ui_ref: UI.md (latest-product-UI reverse sync)
prd_ref: PRD.md (v1.0)
test_run_at: "2026-08-09T18:52:25Z"
browser_automation: playwright-electron
viewport:
  browser_window: 1100x800
  main_window: 1400x900
  trusted_window: 520x420
url_base: "dynamic http://127.0.0.1:<port> loopback fixture"
screenshots_count: 10
ac_coverage:
  total: 9
  with_screenshot: 9
revision_history:
  - version: v1.0
    date: "2026-08-10"
    author: QA + Designer
    summary: 真实 Electron 关键路径、边界态与十张整窗截图通过
---

# BL-006 Profile 密码库与静默保存/填充 - Browser E2E Test Report

> 位置：`docs/features/OKWORK-F260807022801-Profile-Password-Vault/BROWSER-TEST-REPORT.md`
> 截图均来自 fresh Forge package 启动的真实 Electron 窗口；没有元素裁剪。OkBrowser 截图完整保留 chrome 与地址栏，Settings/Trusted 截图保留各自完整可见窗口。

---

## §1 测试范围

| 项 | 内容 |
|---|---|
| 浏览器自动化 | Playwright Electron (`playwright-core` 1.62.1) |
| 应用运行时 | Electron 42.4.0，fresh macOS arm64 Forge package |
| 窗口 / PNG | OkBrowser 1100×800 CSS / 2200×1536 px；main 1400×900 CSS / 2800×1800 px；trusted 520×420 CSS / 1040×776 px |
| URL base | 每轮独立的 `http://127.0.0.1:<port>` loopback fixture |
| 测试身份 | built-in Default Profile；账号 `alice`；随机密码哨兵从不写日志或截图明文 |
| 浏览器前置状态 | 独立临时 `userData`，空 Vault；结束后只删除该临时目录并恢复原系统剪贴板 |
| 执行入口 | `python3 docs/features/OKWORK-F260807022801-Profile-Password-Vault/e2e/password_vault_e2e.py` |

执行结果：fresh package、compiled boundary contract、Playwright Electron journey 均通过，exit code `0`；最终证据运行没有 retry。

### 视觉对齐结论

- 截图来自当前真实 renderer，不是旧全景副本；中性黑灰、暖橙强调、胶囊/细描边、现有 Settings modal 与 OkBrowser 独立窗壳层均与最新反向同步的 `UI.md` 一致。
- 密码状态没有挤占地址栏，保存/填充/失败提示与两条安全披露保持独立层级；窄 trusted window 中遮罩、风险说明和动作按钮仍可读。
- 所有最终 PNG 已逐张人工查看：地址栏、页面、状态文案和 trusted surface 均未出现随机测试密码明文。

---

## §2 测试场景

### Scenario: FE-E2E-001 · 可观察成功后保存、同 origin 回填与失败保护

**对应 AC**：AC-1、AC-2、AC-3、AC-4、AC-8、AC-9  
**优先级**：P0  
**类型**：happy path + edge case

#### 执行步骤

```text
1. 用 Default Profile 打开 loopback exact origin 的标准登录页。
2. 输入 alice + 随机密码并提交 POST；等待成功页和 “New password saved automatically”。
3. 重访同一 /login；验证账号与密码静默填入且密码仍为遮罩视觉。
4. 打开 /pre-filled；验证 manual-user/manual-password 非空值不被覆盖。
5. 打开 /failed，提交另一个错误密码；页面产生 role=alert。
6. 验证 chrome 显示 “Sign-in failed · saved password unchanged”，地址栏及错误态不含密码。
```

#### 截图引用

| # | 状态 | 文件 | 验证点 |
|---|---|---|---|
| 1 | confirmed save | `screenshots/01-browser-saved-status.png` | 完整 chrome/address bar；成功页 URL 无凭据 query；保存状态、Profile、本机加密和两类披露可见 |
| 2 | same-origin fill | `screenshots/02-browser-auto-fill.png` | exact URL + Default Profile；alice 可见、密码字段遮罩；fill 状态不泄密 |
| 3 | non-empty boundary | `screenshots/03-browser-prefilled-protection.png` | manual-user 与遮罩密码保持不变；chrome 披露常驻 |
| 4 | failed login boundary | `screenshots/08-browser-auth-failed-unchanged.png` | 失败提示、旧密码不变状态与地址栏可见；错误密码仅以圆点呈现 |

#### 异常发现

| ID | 现象 | 截图 | 严重度 | 决定 |
|---|---|---|---|---|
| BE-F1 | 第一版测试 fixture 用 GET 提交，导致随机测试密码进入地址栏和初版截图 | 已被最终 `01` 覆盖 | BLOCKER（证据保密） | fixture 改为 POST；fresh 重跑覆盖全部 PNG；最终十图均无密码明文 |

---

### Scenario: FE-E2E-002 · 脱敏管理、双重披露与单账号删除

**对应 AC**：AC-5、AC-6、AC-7、AC-8、AC-9  
**优先级**：P0  
**类型**：happy path + destructive confirmation boundary

#### 执行步骤

```text
1. 从当前真实主窗口打开 Settings → Saved Passwords。
2. 验证只显示 origin、alice、Profile、时间和遮罩，不显示密码。
3. 验证 “Encrypted on this device”、DOM/Agent 与 clipboard 两类披露。
4. 点击 Delete，验证先进入行内确认态。
5. 再次确认删除，等待 “No saved passwords yet” 空态。
```

#### 截图引用

| # | 状态 | 文件 | 验证点 |
|---|---|---|---|
| 1 | metadata-only normal | `screenshots/04-saved-passwords-metadata-disclosures.png` | 当前 Settings modal 完整呈现；列表只有元数据/遮罩；本机加密 badge 和两类披露可见 |
| 2 | delete confirmation | `screenshots/09-saved-password-delete-confirm.png` | 危险操作不会单击即删；Delete/Cancel 边界明确 |
| 3 | delete complete | `screenshots/10-saved-password-delete-empty.png` | 单条删除后进入真实 empty state；安全披露仍常驻 |

---

### Scenario: FE-E2E-003 · 隔离 trusted window 的遮罩、复制与自动重遮罩

**对应 AC**：AC-5、AC-6、AC-8、AC-9  
**优先级**：P0  
**类型**：happy path + temporal/security boundary

#### 执行步骤

```text
1. 从 metadata-only 列表打开独立 trusted window。
2. 验证初始值遮罩，窗口声明普通 OkWork 页面不能触发解密。
3. 真实点击 Reveal；自动化只在内存断言明文正确，不截图明文。
4. 等待 10 秒，验证 aria-label 返回 Password masked 后截图。
5. 真实点击 Copy；验证系统剪贴板收到测试值、60 秒条件清除说明可见。
6. 测试结束前恢复运行前剪贴板，并读回确认恢复成功。
```

#### 截图引用

| # | 状态 | 文件 | 验证点 |
|---|---|---|---|
| 1 | initial masked | `screenshots/05-trusted-initial-masked.png` | 独立 trusted window、隔离 seal、默认遮罩与 10 秒说明 |
| 2 | auto-remasked | `screenshots/06-trusted-auto-remasked.png` | Reveal 后等待真实 10 秒再次遮罩；无明文证据落盘 |
| 3 | copied lease | `screenshots/07-trusted-copy-disclosure.png` | clipboard 导出风险、条件清除语义与 60 秒倒计时可见；密码仍遮罩 |

---

## §3 AC↔截图覆盖矩阵

| AC ID | 描述 | happy path 截图 | 边界截图 | 状态 |
|---|---|---|---|---|
| AC-1 | 成功才保存，失败不修改 | `01` | `08` | ✅ |
| AC-2 | Profile + exact origin + 安全 origin | `02`（Profile 与完整 URL 可见） | `03`（受限页面不覆盖已有值）；跨 Profile/origin 负例由 T-002 integration 证明 | ✅ |
| AC-3 | 静默填充且不覆盖非空字段 | `02` | `03` | ✅ |
| AC-4 | 成功更新，失败保留旧密码 | `01` | `08` | ✅ |
| AC-5 | 本机加密与 fail-closed | `04`（加密 badge） | `05`（默认不释放明文）；加密不可用由 T-005 integration 证明 | ✅ |
| AC-6 | 管理、可信显隐/复制、自动遮罩、删除 | `04`, `07`, `10` | `05`, `06`, `09` | ✅ |
| AC-7 | 单账号/Profile 删除语义 | `10` | `09`；Profile 部分失败/重试由 T-008 integration 证明 | ✅ |
| AC-8 | 不可信调用隔离与真实暴露面披露 | `01`, `04`, `07` | `05`, `08` | ✅ |
| AC-9 | 状态、错误和证据不泄密 | `01`, `04` | `08`；十图均完成人工无明文检查 | ✅ |

截图覆盖率：9 / 9（100%）。不可由像素证明的加密密钥、跨 Profile 权限、删除重启恢复和日志红线没有被截图冒名，分别由 `TEST-REPORT.md` 中 T-002/T-005/T-008/T-011 的 integration 证据补足。

---

## §4 flaky / retry 处理

| Scenario | 最终运行重试次数 | 失败截图 | 失败 log | 最终结果 |
|---|---:|---|---|---|
| FE-E2E-001 | 0 | - | - | ✅ pass |
| FE-E2E-002 | 0 | - | - | ✅ pass |
| FE-E2E-003 | 0 | - | - | ✅ pass |

为扩充截图与修正 BE-F1 执行过独立 fresh 验证轮次；每个轮次都是显式运行，不是 runner 内部静默 retry。最终十图运行一次通过。

---

## §5 截图清单

```text
screenshots/
├── 01-browser-saved-status.png                    2200×1536 ·  87,685 B
├── 02-browser-auto-fill.png                       2200×1536 ·  94,598 B
├── 03-browser-prefilled-protection.png            2200×1536 ·  96,279 B
├── 04-saved-passwords-metadata-disclosures.png    2800×1800 · 226,654 B
├── 05-trusted-initial-masked.png                  1040×776  ·  65,040 B
├── 06-trusted-auto-remasked.png                   1040×776  ·  65,197 B
├── 07-trusted-copy-disclosure.png                 1040×776  ·  66,445 B
├── 08-browser-auth-failed-unchanged.png           2200×1536 · 102,080 B
├── 09-saved-password-delete-confirm.png           2800×1800 · 230,268 B
└── 10-saved-password-delete-empty.png             2800×1800 · 223,431 B

共 10 张 · 1,257,677 bytes
```

---

## §6 已知异常 / 不阻塞项

| ID | 现象 | 截图 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|---|
| BE-N1 | 临时 E2E workspace 的背景终端显示 `posix_spawn failed`；密码 Settings modal、Vault IPC 与本轮旅程不受影响 | `04`, `09`, `10` | INFO | 作为既有 smoke bootstrap 环境噪声保留原貌，不裁图掩盖；不阻塞 BL-006 | main smoke bootstrap 环境 |

---

## §7 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-08-10 | QA validation tier (`gpt-5.6-terra`) | ✅ pass | fresh Forge + Playwright Electron，最终运行 exit 0、无 retry |
| 2026-08-10 | Designer（主会话逐张视觉检查） | ✅ pass | 十图整窗、当前真实 UI、文案层级清晰，无密码明文 |

