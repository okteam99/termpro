<!-- TEAMWORK-MACHINE · 机读契约 · 勿删外层注释包裹 · 2 空格缩进
feature_id: "TERMPRO-F260709180208-Remote-Hosts-SSH"
doc: review-arch-2
stage: review
reviewer: architect-2
model: opus
verdict: REQUEST_CHANGES
open_blockers: 0
open_majors: 1
supersedes: none
augments: REVIEW-arch.md
note: "增量评审 · 仅列 REVIEW-arch.md 未覆盖的新增 finding；A1-A13 与 REVIEW-arch.md 高度一致（独立回读同样命中 A1 BLOCKER + A2/A3/A4 MAJOR + A6 Origin 等），不重复。"
-->

# BL-003 · Architect 增量评审（REVIEW-arch-2）

第二路 architect 独立回读全部真实代码，结论与 `REVIEW-arch.md` 高度一致：同样命中 A1（全新远程机首次部署必失败 · BLOCKER）、A2（SSH 断链不检测）、A3（main verifying→ready 覆盖 renderer 握手）、A4（in-flight guard 语义）、A6（TERMPRO_ALLOWED_ORIGINS 未接线）等。residency 的 reap 双验（ARCH-B2）/ 无 livelock（ARCH-B1）安全性质落地忠实、无误杀漏洞——此结论亦一致。

**本文件只记 REVIEW-arch.md 未覆盖的 1 条增量（team-lead 指派我独立复核的 QA 交叉线索）。**

---

## 增量 Finding

### G1 · MAJOR · AC-6（P0）不兼容边运行时零覆盖 + T-012/T-013 指向不存在的测试文件 → verify-ac 幽灵报绿
- **status**: open
- **与 REVIEW-arch.md 的边界**：REVIEW-arch.md 的 A3 覆盖的是 **renderer 侧**握手/冒烟被 `ready` 覆盖而不执行（AC-6 的 renderer 半边 · 代码竞态）。本条 G1 覆盖两处 A3 **未涉及**的问题：① **orchestrator 侧**不兼容边的测试零覆盖；② **门禁完整性**缺陷（TC 契约挂在不存在的测试文件上）。根因不同，需与 A3 分别处置。
- **证据**：
  - `orchestrator.ts:555-562`：部署路径的 `probe(...)` 返回 `!ok || compatible===false` → `failSession(configId,'incompatible',...)` + 关隧道 + `ssh.close()`。`orchestrator.test.ts` 默认 probe 恒 `{ok:true,compatible:true}`（`:45-47`），**全套用例无一把 `probeImpl` 置 `compatible:false`/`ok:false` 驱动这条边**。`failClassification.test.ts` 只测 `classifyConnectError`（connect 层字符串→FailReason），不触及 probe 之后的 incompatible 判定。→ **verifying→failed(incompatible) 这条 P0 边全链零测试驱动**。
  - `TC.md:79-90` 契约 T-012 / T-013 的 `file:` 字段指向 `src/host/__tests__/remoteHandshakeSmoke.integration.test.ts`——`find`/`grep` 全仓**零命中**，文件未实现。若 `verify-ac` 按 TC 的 test-id→file 映射判 AC-6 覆盖而**不校验文件存在 / 用例真跑**，则 **AC-6 被误报为已覆盖（幽灵绿）**。
- **描述**：AC-6（协议兼容握手 · P0）的两处兼容判定——main 前移探测（`orchestrator.ts:555`）与 renderer 二次确认（`hostClient.ts:229-234`）——共享 `checkHostInfoCompatible`，**代码静态看正确**（非代码 BLOCKER）。但「不兼容→主动断开」的运行时行为**两侧都无测试驱动**：renderer 侧因 A3 根本不执行握手，orchestrator 侧因无 `compatible:false` 桩用例。叠加 TC 把 AC-6 挂在不存在的测试文件上 → 「全 AC 绿」这一交付前提在 AC-6 这一格**不可信**。这不是纯计数问题：`PROTOCOL_VERSION` 提升 / 兼容区间收紧后，不兼容主机的主动断开逻辑若已破，CI **完全无感**——而这正是 AC-6 存在的理由。
- **建议**：
  - (a) `orchestrator.test.ts` 补一条 `probeImpl → {ok:true,compatible:false}` 用例（部署路径），断言 emit `failed·incompatible`、`tunnel.server.close()` 被调、`ssh.close()` 被调、`session.forwardServer===null`；再补一条 `{ok:false}`（探测失败）用例。
  - (b) 配合 A3 修复（改由 verifying 事件驱动 renderer 握手）后，补 renderer 侧 incompatible 兜底测：注入不兼容 `host.info` → `ProtocolIncompatibleError` → `failed·incompatible`。
  - (c) 把 TC T-012/T-013 的 `file:` 改指向真实存在的测试（或按契约补 `remoteHandshakeSmoke.integration.test.ts`，复用既有 host ws harness），并让 `verify-ac` 对**缺失的测试文件 fail-closed**，杜绝幽灵绿。

---

## 摘要
| id | severity | title |
|----|----------|-------|
| G1 | MAJOR | AC-6（P0）不兼容边（orchestrator + renderer）运行时零覆盖 + T-012/T-013 指向不存在的测试文件 → verify-ac 幽灵报绿（独立复核 QA 交叉线索 · 确认；与 A3 根因互补） |

> Overall（合并 REVIEW-arch.md）：**REQUEST_CHANGES** · 1 BLOCKER（A1）+ 4 MAJOR（A2/A3/A4 + 本 G1）。修复优先级：A1（阻断交付）→ A3+G1（AC-6 端到端不可信）→ A2/A4 → A6（连带 A3）。
