---
feature_id: "OKWORK-F260810151932-Browser-Profile-Login-Continuity"
author: PM
status: confirmed
decision: "approved_and_ship"
decided_at: "2026-08-13T02:47:53Z"
prd_ref: PRD.md (v0.3)
test_report_ref: TEST-REPORT.md
ac_total: 10
ac_passed: 10
revision_history:
  - version: v0.1
    date: "2026-08-13"
    author: PM
    summary: 首版起草 · 独立复跑四道门禁 + AC↔TC↔代码逐条对照审计
---

# Browser Profile 3A 登录连续性漫游 - PM 验收说明(PM-NOTE)

> 位置：`docs/features/OKWORK-F260810151932-Browser-Profile-Login-Continuity/PM-NOTE.md`
> 🔴 状态字段权威在 `state.json`；本文是人读说明与决策理由留痕。

---

## §1 验收概要

| 项 | 内容 |
|---|---|
| 决策 | **approved_and_ship**（用户 2026-08-13 拍板） |
| AC 通过数 | 10 / 10（均有真实测试证据；其中 2 条 P0 AC 各有一处子句零回归门禁，见 §3） |
| 评审依据 | PRD.AC(10 条) + TEST-REPORT + REVIEW + 视觉证据 2 张 + PM 本轮独立复跑 |
| 决策时间 | 2026-08-13T02:47:53Z |
| 决策理由 | 10 条 AC 均有真实测试证据、四道门禁独立复跑全绿、REVIEW 的 MAJOR(F1) 已修并被 10 例 guard 测试锁住；§3 的 F1/F2 是**回归门禁缺口而非当前缺陷**（两条实现链路已读码走通、行为正确），按用户决定记入 PENDING 下轮补，不阻塞发布。 |
| finding 去向 | F1/F2/F3 → `product-overview/PENDING.md` **PENDING-013**；非阻塞视觉观察 → **PENDING-014** |

### PM 本轮独立复跑（非引用 TEST-REPORT · 全部在 HEAD `d387d06` 实跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | exit 0 |
| 全量单测 | `npm test` | **exit 0** · 195 suites / 1945 cases（与 TEST-REPORT 数字一致） |
| API-E2E | `python3 …/e2e/profile_continuity_rpc_e2e.py` | exit 0 · 7 PASS |
| 无头冒烟 | `OKWORK_SMOKE=1 npx electron-forge start` | `SMOKE_OK` |

代码自测试冻结提交 `dfb0d63` 起零改动（`git diff --stat dfb0d63..HEAD -- src/ e2e/` 为空），故 TEST-REPORT 证据对 HEAD 仍成立。

**环境坑（已定性 · 非本 Feature 回归）**：worktree 未安装依赖，而 `src/host/__tests__/hostSubprocessHarness.ts:15,81` 把子进程 `NODE_PATH` 显式指向 **worktree 根**的 `node_modules`，导致 `portFile.test.ts` 7 例全挂（`Cannot find module 'node-pty'`）。软链 `node-pty` / `ws` / `electron` 后 7/7 通过。软链在 `node_modules/`（gitignored），不进提交。

---

## §2 AC 逐条对照（对照实测数据 · 不口述 OK）

审计方式：验证档子代理逐条对照 PRD.AC ↔ TC.md ↔ 真实测试位置 ↔ 实现锚点；本表结论经主对话抽样复核（见 §3 的 grep 复验）。

| AC ID | 描述 | 实测数据出处 | PM 判断 | 备注 |
|---|---|---|---|---|
| AC-1 | 发现/加入 + hydration gate | `remoteProfileRpc.test.ts:137`、`remoteProfileAuthority.test.ts:905`、`browserGuestNavigationGuard.test.ts:17-315`(10 例) | ✅ pass | 真正证明"导航阻断"的是 guard 测试，TC.md 未引用（见 F3） |
| AC-2 | 持久 Cookie 对账 · session 跳过 | `browserProfile.test.ts:102-131`、`remoteProfileAuthority.test.ts:926-957` | ✅ pass | 回声抑制、`COOKIE_SESSION_POLICY` 均有断言 |
| AC-3 | 单调 revision · 幂等 | `remoteProfileStore.test.ts:311-372` | ✅ pass | conflict_won / duplicate 重放 / 独立 identity 各自计数 |
| AC-4 | tombstone 防复活 | `remoteProfileStore.test.ts:374-455` | ⚠️ pass（有缺口） | tombstone 拒 stale 已测；**`evicted` 抑制路径零覆盖 → F1** |
| AC-5 | v1 兼容 · 能力探测 · 分页 | `remoteProfileRpc.test.ts:218-316`、`remoteProfileMigration.test.ts:416-465` | ⚠️ pass（有缺口） | 分页/续传/v1 已测；**`host_upgrade` 提示链路零覆盖 → F2** |
| AC-6 | 离线 journal · generation | `remoteProfileAuthority.test.ts:960-995, 997-1021` | ✅ pass | operationId 稳定、重连提交、generation 失效重新 gate |
| AC-7 | Cookie 秘密边界 · 加密存储 | `browserPasswordSecurity.test.ts:80-140`、`remoteProfileStore.test.ts:457-500`、`profileContinuityJournal.test.ts:200-230` | ✅ pass | DTO/日志脱敏、Host 密文 0700/0600、journal 加密原子写 |
| AC-8 | 单项跳过 · 脱敏统计 | `remoteProfileAuthority.test.ts:1023-1056` | ✅ pass | oversize/apply-fail 计数不重复累计、游标不回滚 |
| AC-9 | Settings/OkBrowser 脱敏反馈 | `BrowserProfilesSection.test.tsx:424-479`、`BrowserPanel.test.tsx:69-153` | ✅ pass | 无 AUTHORITY、无 tooltip、正文不含 cookie 秘密 |
| AC-10 | 删除/迁移 epoch fence | `remoteProfileMigration.test.ts:371-414`、`browserProfileDeletion.test.ts:95-221`、`remoteProfileAuthority.test.ts:1106-1171`、`remoteProfileStore.test.ts:502-557` | ✅ pass | "旧设备被 epoch 挡住"的证据在后两个未被 TC.md 引用的测试里（见 F3） |

视觉：`real-app-browser-settings.png`（真实应用 · 本机 built-in Profile 行）与 `panorama-browser-profiles.png`（已确认全景 · 含登录连续性状态行）已实际查看，行内普通文本、无 AUTHORITY 标识、无说明气泡，与 AC-9 一致。

---

## §3 待决 finding（PM 复核确认 · 均非当前已知缺陷）

主对话对子代理结论做了独立 grep 复验，两条覆盖缺口成立、一条被修正范围。

| ID | 描述 | 涉及 AC | 严重度 | 建议改 | 类型 |
|---|---|---|---|---|---|
| F1 | `profileContinuityController.ts:1249` 的 `if (cause === 'evicted') return;`（设备侧容量淘汰不上报 Host）**零测试触达**。TC.md 引用的 T-006 实测的是"手工构造 `kind:'evicted'` 的 RPC 会被 Host schema 拒绝"——该请求在真实系统里不会发出，等于测了不会发生的输入。全仓库 `grep evicted` 仅 3 处命中佐证。 | AC-4 | P1 | 补一条测试：`cookieStore` emit `cause='evicted'` → 断言 provider 零 push、不产生 tombstone | QA 补测 |
| F2 | `host_upgrade` / `HOST_UPGRADE_REQUIRED` 在任何 `__tests__` 文件里**零命中**。链路已验证是通的：`remoteProfileProvider.ts:417-430 describeContinuity()` 抛 `PROFILE_STORAGE_INCOMPATIBLE` → `controller.ts:209 reasonOf()` → `:1416 state:'host_upgrade'` → `BrowserProfilesSection.tsx:60` 文案 `Remote Host update required`；UI 测试只跑过 `attention`/`paused`/`synced` 三态。（子代理原判"端到端零覆盖"需修正：`BrowserProfilesSection.test.tsx:324,353` 覆盖的是 **BL-007 AC-2** 的"更改位置"目标兼容性，不是本 Feature 的连续性状态行。） | AC-5 | P1 | 补一条测试：provider 抛 `PROFILE_STORAGE_INCOMPATIBLE` → 断言 summary.state=`host_upgrade` + UI 显示升级提示 | QA 补测 |
| F3 | TC.md / TEST-REPORT §4.2 有 3 处 test_refs 指向错位：AC-1/T-002 不证明导航阻断（真证据在 `browserGuestNavigationGuard.test.ts`）、AC-7/T-012 函数名含 `pending_journal` 但未验 journal（真证据在 `profileContinuityJournal.test.ts:200`）、AC-10/T-016 测的是同设备迁移重试幂等而非"旧设备被挡"（真证据在 `remoteProfileAuthority.test.ts:1106` 与 `remoteProfileStore.test.ts:502`）。**行为本身都有测试兜底，"10/10 覆盖"结论不假**，但按 TC.md 指路核对的人会看错测试。 | AC-1/7/10 | P2 | 修 TC.md 的 test_refs 指向真正对应的测试 | 文档 |

### 非阻塞观察（不入 finding）

- 真实应用截图里 Profile 行的 `Change location` 按钮被弹窗右边缘裁切、User-Agent 描述被挤到零宽。`browser-profiles__row` 是无 wrap 的 flex，只有 `__row-desc` 可收缩（`BrowserProfilesSection.css:83-89,117-133,142-150`）。该 `__storage` 元素由 **BL-007**（`7271da0`）引入，BL-008 的新增全部是行外新块（`__available` / `__continuity`），**非本 Feature 回归**，建议记入 PENDING 单独处理。

---

## §4 决策依据

| 来源 | 内容 |
|---|---|
| PRD.AC | acceptance_criteria[] 10 条（P0 × 9 · P1 × 1） |
| TEST-REPORT | integration exit 0 · api-e2e exit 0 × 2 轮 · verify-ac 10/10 |
| REVIEW | verdict APPROVE · F1(MAJOR) 已修并有 10 例 guard 测试锁住 |
| PM 独立复跑 | typecheck / vitest / api-e2e / 冒烟 四绿（§1） |
| AC 对照审计 | 17 个 T-00X 测试函数均真实存在于声称位置；2 条覆盖缺口 + 3 处引用错位（§3） |
