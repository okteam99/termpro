---
feature_id: "OKWORK-F260810051623-Remote-Profile-Authority"
author: PM
status: confirmed
decision: "approved_and_ship"
decided_at: "2026-08-10T14:46:52Z"
prd_ref: PRD.md (v0.4)
test_report_ref: TEST-REPORT.md
browser_test_report_ref: BROWSER-TEST-REPORT.md
ac_total: 9
ac_passed: 9
revision_history:
  - version: v0.1
    date: "2026-08-10"
    author: PM
    summary: "逐条核对 AC 与测试、Review、截图证据；等待用户发布决策"
  - version: v0.2
    date: "2026-08-10"
    author: PM
    summary: "用户选择 approved_and_ship"
---

# Remote Host Profile 权威存储与迁移 - PM 验收说明

## §1 验收概要

| 项 | 内容 |
|---|---|
| 当前决策 | `approved_and_ship`（用户于 2026-08-10T14:46:52Z 拍板） |
| AC 通过数 | 9 / 9 |
| 代码评审 | Round 2 `APPROVE`；F1、F2 均 fixed |
| 测试依据 | 全量 Vitest、Host CLI live cross-process E2E、AC 绑定校验、真实 Electron Browser E2E |
| 已知基线 | 最终全量 1889 passed / 6 skipped / 1 已登记 T-032 flake；机器差分 `new=[]` |

## §2 AC 逐条对照

| AC ID | PM 判断 | 实测数据出处 | 备注 |
|---|---|---|---|
| AC-1 | ✅ pass | TEST-REPORT §4 TC-001/002；Browser 截图 01/02/08 | Profile 唯一权威、本机位置文字及成功/失败反馈均有证据。 |
| AC-2 | ✅ pass | TC-002；Review Round 2 F2；renderer 全量测试 | 只允许当前连接代 `ready + compatible` 目标；不兼容目标禁用并提示 Update Host。真实 Remote Host 视觉状态未伪造截图。 |
| AC-3 | ✅ pass | TC-003；Host CLI E2E-004；Review Round 2 F1 | main-only 为应用接口隔离；Remote Host 管理员、SSH 用户及同 UID 进程属于明确披露的可信解密边界。 |
| AC-4 | ✅ pass | TEST-REPORT TC-004/005 | copy→verify→switch 前锁 mutation，连接代变化与 late response fail closed。 |
| AC-5 | ✅ pass | TEST-REPORT TC-006/007 | 提交边界保持唯一权威，cleanup pending 可幂等恢复。 |
| AC-6 | ✅ pass | TEST-REPORT TC-008/012；Browser 截图 04–07 | Remote authority 离线不回退本地；普通页面 metadata-only，可信窗口显式 reveal/copy。 |
| AC-7 | ✅ pass | TEST-REPORT TC-009 | 删除先撤权，失败跨重启保留并可 retry。 |
| AC-8 | ✅ pass | TEST-REPORT TC-007/010/013；Browser 截图 04/07 | authority/migration/cleanup 依赖会阻止删 Host；DOM/clipboard 风险已披露。 |
| AC-9 | ✅ pass | TEST-REPORT TC-011/012；Host CLI E2E-003/005；Browser 截图 04/05 | 密文与权限、错误脱敏、metadata-only 和默认掩码均有证据。 |

覆盖率：**9 / 9（100%）**。

## §3 用户决策

**决策：`approved_and_ship`。** 用户选择进入 Ship；后续允许推送功能分支并创建 MR，平台合并仍由用户完成。

## §4 范围与非阻塞项

- 内置 Browser connector 本轮无可控实例；视觉验证使用 fresh package 的真实 Electron OkBrowser，10 张完整窗口截图、E2E exit 0。
- Electron journey 没有连接真实 Remote Host；迁移确认/离线/清理状态机由 renderer 与 integration 证据承担，报告未把设计预览冒充真实 E2E。
- 全量 Vitest 唯一失败是项目基线已登记的 Host `fs.watch` T-032 负载 flake；机器差分确认没有新增失败。

## §5 决策依据

| 来源 | 内容 |
|---|---|
| PRD.md v0.4 | 9 条 AC 与 WS-02 Remote Host 信任边界 |
| REVIEW.md | Round 2 APPROVE，F1/F2 fixed |
| TEST-REPORT.md | 1889 passed / 6 skipped / 1 baseline flake；Host CLI E2E 5/5；AC 9/9 |
| BROWSER-TEST-REPORT.md | 真实 Electron journey exit 0；10 张 PNG；无说明气泡、无用户可见 `AUTHORITY` |
