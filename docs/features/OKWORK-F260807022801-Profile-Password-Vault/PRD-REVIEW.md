---
prd_feature_id: "OKWORK-F260807022801-Profile-Password-Vault"
review_round: 2
review_started_at: "2026-08-09T02:47:19Z"
review_completed_at: "2026-08-09T02:50:58Z"
reviewers: [fast]
verdicts: {fast: APPROVE}
reviews:
  - role: fast
    review_scope: prd
    coverage: [可实现, 可验证, 安全]
    execution: subagent
    verdict: APPROVE
    started_at: "2026-08-09T02:47:19Z"
    completed_at: "2026-08-09T02:50:58Z"
    files_read:
      - docs/features/OKWORK-F260807022801-Profile-Password-Vault/PRD.md
      - docs/features/OKWORK-F260807022801-Profile-Password-Vault/PRD-REVIEW.md
      - product-overview/workstream/WS-02-browser-profile-login-continuity.md
      - project-specs/KNOWLEDGE.md
      - project-specs/GLOSSARY.md
      - src/main/main.ts
      - src/preload/preload.ts
      - src/renderer/services/browserControl.ts
      - src/main/browserMcp.ts
      - src/main/remote/credentialStore.ts
    pm_self_check:
      checklist_passed: true
      code_context_read: true
      failed_items: []
      notes: "Round 2 同轮闭合验证：复核 v0.3 的 D-3、背景、AC-6/AC-8、UI/风险/变更记录和更新后的 FAST-1 PM 回应；实际 main/preload 证实系统剪贴板是既有全局导出面。"
    findings:
      - id: FAST-1
        severity: high
        description: "v0.2 曾把可信侧复制与普通 renderer 不获明文混为同一承诺；v0.3 已明确系统剪贴板是用户显式导出边界，普通 renderer 可在用户复制后读取剪贴板并不等于拥有 Vault 列表/读取或解密通道。AC-6/AC-8 现要求只有隔离可信面内真实用户动作可触发解密和写入，故 FAST-1 已闭合。"
        suggestion: "已解决。Blueprint 应以独立可信面、main 对来源窗口的授权和真实用户动作为解密/复制门，并测试普通 renderer 直接调用密码操作 IPC 被拒；若 D-3 选 A，还应测试复制前披露、内容未变时 60 秒清除以及用户改写剪贴板后不清除。"
        category: technical-consistency
        code_evidence:
          file_path: src/preload/preload.ts
          line_range: "88-96"
          snippet: "clipboardWriteText(text: string): void { ipcRenderer.send('clipboard:write-text', text); }\nclipboardReadText(): Promise<string> { return ipcRenderer.invoke('clipboard:read-text'); }"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            最强反方是“系统剪贴板本来就是用户主动导出的全局共享面，普通 renderer 能读回并不等于拥有 Vault 读取通道；无需为了一个无法对所有本机进程封闭的边界去破坏现有终端粘贴”。这个反方说明 reviewer 建议的“复制后仍对普通 renderer 保密”并不是可诚实承诺的完整系统边界，但不能推翻 finding 对 v0.2 文字自相矛盾的指控。
            我回读 `src/preload/preload.ts:88-96` 与 `src/main/main.ts:853-857` 后确认，现有普通 renderer 确实可读取系统剪贴板；因此采纳 finding，并将 PRD v0.3 改为可兑现的两段边界：普通 renderer 不能触发密码解密/复制，只有隔离可信面中的真实用户动作可以；用户复制后明文已显式离开 Vault，可能被本机剪贴板消费者读取，界面必须事前披露并在内容未变时 60 秒自动清除。
          rationale: "采纳。PRD v0.3 新增 D-3，并修订背景、AC-6、AC-8、UI 与风险段：限制普通 renderer 不能触发密码解密；复制仅由隔离可信面内的真实用户动作触发；复制后系统剪贴板被明确定义为用户显式导出边界，不再虚假承诺对本机应用或普通 renderer 保密，同时提供 60 秒条件自动清除。"
          responded_at: "2026-08-09T02:50:15Z"
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-08-09T02:50:58Z"
---

# PRD-REVIEW（OKWORK-F260807022801-Profile-Password-Vault）Round 2

### fast 评审段（execution: subagent）

verdict: APPROVE

本轮隔离验证 v0.2 对 Round 1 两项阻断 finding 的闭合情况；PM 在同一 Round 2 中把 FAST-1 修订为 v0.3 后，按 Teamwork fast 两轮上限完成同轮闭合验证，不新增 Round 3。

#### Round 1 闭合验证

| finding | 结论 | 复核证据 |
|---|---|---|
| FAST-1：普通宿主 renderer 明文边界 | **已闭合（v0.3）** | `src/preload/preload.ts:88-96` 与 `src/main/main.ts:853-857` 证实普通 renderer 本就可读系统剪贴板。v0.3 不再虚假承诺用户主动复制后的明文仍隔离，而是将其诚实定义为 D-3 的显式导出边界（PRD 第 76、106、117、119、143、164、171 行）；同时 AC-6/AC-8 仍禁止普通 renderer 列出/读取 Vault 或触发解密。 |
| FAST-2：Profile 删除失败/重试 | **已闭合** | PRD 第 116 行明确删除中即停用密码能力、只在 Vault 与分区数据均清理后才报成功、任一失败显示无秘密原因和重试，并跨重启保持不可用/可重试；第 160-162 行补充了不能沿用现有“先删元数据、异步尽力清盘”的时序。现有 `src/main/main.ts:376-398` 正是被替换的不足基线，而非 v0.2 遗漏。以持久 deletion-pending/failed 状态、主进程串行清理和可注入失败的 session/Vault seam 实现即可验证，没有新的产品阻断。 |

##### PL 对抗质疑六问

| 质疑 | Round 2 结论 |
|---|---|
| ① 价值前提 | 有价值；PRD 第 161 行已诚实承认通用网页登录成功信号会限制覆盖率，并以 D-2/AC-1 的 fail-closed 规则防止错误覆盖。 |
| ② 问题定义 | 清楚：归属键为 `profileId + exact origin`，多账号、保存/更新、不可用与删除状态均有可感知语义（PRD 第 73、110-118 行）。 |
| ③ 范围最小化 | FAST-2 的删除状态是“已承诺删除”不可缺的收尾。FAST-1 通过诚实的“Vault 内能力”与“用户导出到系统剪贴板”边界避免了伪安全实现；没有引入 BL-007/BL-008 的扩张。 |
| ④ 上游对齐 | 保持对齐：PRD 第 71、151-153 行仍把 Remote Host/provider/迁移留给 BL-007，把 Cookie 漫游、revision/tombstone 留给 BL-008；WS-02 第 27-42、106-110、134-142 行仍是 BL-006 → BL-007 → BL-008 的串行路线。 |
| ⑤ 复活检查 | 未复活已否方向：完整 Chromium Profile/Cookie DB 漫游与 Web Storage 上传仍明确排除（PRD 第 152-155 行）。 |
| ⑥ 既有行为变更 | 已识别从“不处理密码”到允许 origin 静默保存/填充的默认行为变更；D-1、D-2 及新增的 D-3 均保留推荐选项供最终拍板（PRD 第 103-106、162 行）。 |

##### PL-CHALLENGE-2（实质质疑，已闭合）

“可信侧直接复制到系统剪贴板”只改变写入者，不能自动阻断同一普通宿主 renderer 已拥有的全局读回能力。v0.3 已采纳该挑战的事实前提，却没有把用户显式导出伪装成 Vault 读取：D-3、背景、AC-6/AC-8 和 UI 同时披露此暴露面，并把不可触发解密的门放回普通 renderer 与可信面之间。因此无新实质 challenge。

#### external 覆盖方向

##### 可实现

FAST-2 可实施：现有删除路径确实先 `browserProfileStore.delete`、广播，再未等待地清理 partition（`src/main/main.ts:376-398`）；v0.2 指定的状态机需要新实现，但没有架构障碍。现有 `CredentialStore` 已展示 `safeStorage` 不可用时拒绝明文落盘的可复用 fail-closed 模式（`src/main/remote/credentialStore.ts:69-94`）。

FAST-1 现可据 v0.3 安全实现：独立可信呈现面可由 main 创建，固定可信 guest 也与 WS-02 相符；而 main 当前仍会移除 renderer 提供的一切 guest preload（`src/main/main.ts:1335-1343`），所以实现应以来源窗口门控让普通 renderer 不能请求解密/复制，而不必也不应为维持伪隔离收口用户显式导出的系统剪贴板读取能力。

##### 可验证

FAST-2 现有 AC 已可导出成功、分项失败、重试、重启恢复及其它 Profile 不受影响的测试。FAST-1 的正确接缝断言不再是“复制后普通 mainWin 读不到剪贴板”，而是“普通 mainWin 直接请求 Vault 列出/单条解密/复制一律被拒”；可信面真实用户动作才可解密，D-3 选 A 时再验证事前披露、条件 60 秒清除与用户改写不清除。该接缝测试也符合 KNOWLEDGE GO-033“seam-tested-but-not-wired”防御。

##### 安全

网页 guest 的安全门仍有效：main 在 attach 前删除任意 renderer 提供的 preload、关闭 Node、收紧 partition（`src/main/main.ts:1335-1343`）。Agent 对已填 DOM 的读取披露也没有被弱化：MCP 的 `browser_eval`、`browser_get_html` 调用 renderer 的页面 `executeJavaScript`（`src/main/browserMcp.ts:47-65`; `src/renderer/services/browserControl.ts:120-145`）。v0.3 同样披露系统剪贴板导出面；它不同于 Vault 明文/解密通道，且仅在可信面真实用户动作后发生，安全承诺已自洽。

#### Findings

##### FAST-1（severity: high，Round 2 已闭合）

见 frontmatter。v0.3 以 PRD 第 76、106、117、119、143、164、171 行闭合；代码证据 `src/preload/preload.ts:88-96` 与 `src/main/main.ts:853-857` 说明为什么系统剪贴板必须被定义为已披露的用户导出面，而不能冒充为 Vault 读取。

**解决验证**：D-3/AC-6/AC-8 已把“谁可触发解密”与“明文导出后谁可能读取”分开描述；复制前披露和条件 60 秒清除提供了可验证的风险收束，但不承诺系统剪贴板仍是 Vault 隔离区。

## 整合结论

- overall_verdict: APPROVE
- next_round_required: false
- 下一步：FAST Round 2 已收敛；保留 D-1/D-2/D-3 的最终用户确认入口后，进入 Goal 的后续完成判定。BL-006 → BL-007 → BL-008 路线无需回退或改写。

## 用户最终确认

- `2026-08-09T14:04:22Z`：用户选择选项 1，确认 D-1-A、D-2-A、D-3-A；PRD 升级为 v1.0，产品方向锁定。该确认采用本 Review 已 APPROVE 的推荐组合，不引入新的评审范围。

## Round 1 历史（保留审计）

Round 1（`2026-08-09T02:43:16Z`）结论为 `NEEDS_REVISION`，覆盖 `[可实现, 可验证, 安全]`，并读取 PRD、WS-02、知识库、术语表和当前 main/renderer/MCP 边界。

### FAST-1（Round 1，severity: high）

Round 1 发现：Browser Settings 的普通 main renderer 既要显示/复制密码又被承诺无法读取 Vault 明文；当时的 `src/main/main.ts:351-375` 仅以“是否 mainWin”授权 Profile IPC，因此两项承诺不能并存。建议是在“缩窄 main renderer 威胁模型”和“显示/复制不交付普通 renderer 明文”之间作出产品选择。

**代码证据（Round 1）**：`src/main/main.ts:351-375`：`browserProfile.save` 只允许 `BrowserWindow.fromWebContents(event.sender) === mainWin`。

**PM 回应（ADOPT，2026-08-09T02:45:22Z）**：

> 最强反方是“mainWin 本来就是受信任应用 UI，显式 reveal/copy 必然要把明文给它，直接缩窄威胁模型即可”，这样实现成本最低且符合许多桌面应用做法。
>
> 我回读 PRD 背景、AC-6/AC-8 与 WS-02 的“宿主 renderer 只拿脱敏视图”既定边界后确认，这个反方会实质降低已经对用户承诺的隔离级别；因此不能通过改口解决，必须把显隐/复制移出普通 renderer 明文通道。

PM 的采纳理由：v0.2 在背景、AC-6、AC-8 和 UI 用户故事中规定普通 renderer 只取脱敏元数据和操作状态，复制由可信侧直写，显式显示进入独立隔离短时可信呈现面。Round 2 确认该修订方向正确，但剪贴板读回旁路仍使之不完整。

### FAST-2（Round 1，severity: medium）

Round 1 发现：旧 AC-7 只有删除成功承诺；现有 `src/main/main.ts:376-397` 会先删除元数据、广播，再以未 await 的清盘收尾，失败仅记 console，可能造成 UI 已报成功而 Vault/分区数据仍残留。建议补齐失败、重试、成功判据和可测语义。

**PM 回应（ADOPT，2026-08-09T02:45:22Z）**：

> 最强反方是“分区清理属于后台 best-effort，密码 Vault 只要先删即可；把整个 Profile 做成跨重启删除状态会显著扩大首版范围”。
>
> 我回读现有删除代码与 AC-7 后确认，当前顺序会先宣告 Profile 消失、再异步清盘且失败只写 console，无法证明用户要求的密码和登录数据已经删除；因此至少需要用户可见、可重试且密码立即停用的删除状态，复杂度由不可逆安全承诺正当化。

PM 的采纳理由：v0.2 AC-7 已规定确认后立即停止该 Profile 的密码能力，Vault/Cookie/站点存储/缓存全部完成才报成功；失败不报成功、显示脱敏原因与重试入口，并跨重启保持不可使用且可重试。Round 2 已确认该 finding 闭合。
