---
feature_id: "OKWORK-F260807022801-Profile-Password-Vault"
author: PM
status: draft
decision: ""
decided_at: ""
prd_ref: PRD.md (v1.0)
test_report_ref: TEST-REPORT.md
browser_test_report_ref: BROWSER-TEST-REPORT.md
ac_total: 9
ac_passed: 9
revision_history:
  - version: v0.1
    date: "2026-08-10"
    author: PM
    summary: AC 实证核对完成，等待用户发布决策
---

# BL-006 Profile 密码库与静默保存/填充 - PM 验收说明

> 状态字段权威在 `state.json`。本文当前只记录 PM 实证核对；`decision` 必须由用户选择后再填写。

---

## §1 验收概要

| 项 | 内容 |
|---|---|
| PM 初审 | 9 / 9 AC 有通过证据，无 BL-006 阻塞 finding |
| 用户决策 | 待用户选择 `approved_and_ship` / `approved_no_ship` / `rejected_with_feedback` |
| 评审依据 | PRD v1.0、TEST-REPORT、BROWSER-TEST-REPORT、10 张整窗截图、REVIEW APPROVE |
| 功能范围 | 当前设备本地加密 Vault；Remote Host provider 明确属于后续 BL-007，Cookie 同步属于 BL-008 |

---

## §2 AC 逐条对照

| AC ID | 用户可感知结果 | 实测数据出处 | PM 判断 | 备注 |
|---|---|---|---|---|
| AC-1 | 确认登录成功才保存；失败不覆盖 | `TEST-REPORT` T-001/T-012；截图 `01`, `08` | ✅ pass | 成功与失败状态均不含密码 |
| AC-2 | Profile + exact origin + 安全 origin 隔离 | T-002 integration；截图 `02` 的 Profile/完整 URL | ✅ pass | 跨 Profile/origin 负例由 integration 证明 |
| AC-3 | 静默填充，且不覆盖非空字段 | T-003/T-012；截图 `02`, `03` | ✅ pass | 密码只显示遮罩圆点 |
| AC-4 | 成功更新；失败保留原密码 | T-004；截图 `01`, `08` | ✅ pass | 失败状态明确写“saved password unchanged” |
| AC-5 | 本机加密持久化；异常时 fail-closed | T-005；截图 `04`, `05` | ✅ pass | 磁盘无明文、密钥不可用路径由 integration 验证 |
| AC-6 | 脱敏管理、可信显隐/复制、10 秒重遮罩、60 秒条件清理 | T-006/T-007/T-012；截图 `04`–`07` | ✅ pass | 真实点击、真实系统剪贴板，结束后恢复原值 |
| AC-7 | 单账号/Profile 删除与失败重试 | T-008/T-009；截图 `09`, `10` | ✅ pass | Profile 部分失败/重启重试由 integration 验证 |
| AC-8 | 网页/普通 renderer/Agent 无通用明文通道；暴露面如实披露 | T-010/T-012；截图 `01`, `04`, `05`, `07` | ✅ pass | DOM/Agent 与 clipboard 两类风险在三处常驻呈现 |
| AC-9 | 日志、错误、事件和证据不泄密 | T-011；截图 `01`, `04`, `08`；十图人工复核 | ✅ pass | 初版 fixture URL 泄漏已在最终证据前修复并 fresh 覆盖 |

---

## §3 决策

**决策**：等待用户拍板  
**PM 建议**：若认可 BL-006 的本地范围与当前 UI/证据，可选 `approved_and_ship`；进入 ship 后仍会在平台合并前再次暂停，不会直接推送或合并。

### rejected_with_feedback finding

当前无 PM finding。若用户拒绝，将在此记录具体问题、涉及 AC、严重度与回退类型。

---

## §4 主对话试用与视觉复核

| 路径 | PM 实测 | 截图 / log |
|---|---|---|
| 登录成功 → 自动保存 → 同 origin 回填 | ✅ fresh Electron 通过 | `01-browser-saved-status.png`, `02-browser-auto-fill.png` |
| 非空字段 → 保持不变；失败登录 → 旧密码不变 | ✅ 边界通过 | `03-browser-prefilled-protection.png`, `08-browser-auth-failed-unchanged.png` |
| Saved Passwords → 脱敏列表 → 删除确认 → 空态 | ✅ 通过 | `04`, `09`, `10` |
| Trusted window → 遮罩 → 显示 → 10 秒重遮罩 → 复制 | ✅ 通过 | `05`, `06`, `07` |

最终 Browser E2E：fresh Forge package、compiled contract 与 Playwright Electron journey exit code `0`，无 flaky retry。全量 Vitest：1741 passed / 87 skipped；TypeScript typecheck exit code `0`。

---

## §5 决策依据

| 来源 | 内容 |
|---|---|
| PRD.AC | 9 条 P0 AC |
| REVIEW | Round 2 `APPROVE`，F1–F4 fixed、F5 rejected，无 open finding |
| TEST-REPORT | 1741 tests passed；typecheck 0；AC coverage 9/9；live Electron e2e 0 |
| BROWSER-TEST-REPORT | 3 组真实场景、10 张整窗截图、截图覆盖 9/9 |
| 范围边界 | BL-006 本地 Vault；BL-007 才接 Remote Host provider；BL-008 才做 Cookie 同步 |

