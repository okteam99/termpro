---
prd_feature_id: OKWORK-F260826061325-Account-Menu-Settings-Panel
review_round: 2
review_started_at: "2026-08-26T06:45:00Z"
review_completed_at: "2026-08-26T08:20:00Z"
reviewers: [fast]
verdicts: {fast: APPROVE}
review_models:
  - "fast: grok-4.5"
reviews:
  - role: fast
    review_scope: prd
    coverage: [可实现, 可验证, 自主方向]
    execution: subagent
    review_via: subagent
    review_model: grok-4.5
    verdict: APPROVE
    started_at: "2026-08-26T08:10:00Z"
    completed_at: "2026-08-26T08:20:00Z"
    files_read:
      - docs/features/OKWORK-F260826061325-Account-Menu-Settings-Panel/PRD.md
      - docs/features/OKWORK-F260826061325-Account-Menu-Settings-Panel/PRD-REVIEW.md
      - src/renderer/components/SettingsEntry.tsx
      - src/renderer/components/settings/SettingsModal.tsx
      - src/renderer/components/settings/RemoteHostsPage.tsx
    findings:
      - id: PL-CHALLENGE-1
        severity: medium
        category: product-premise
        description: >
          未实现登录时同步上线「Login」入口文案 + 菜单内「Logout」占位，会系统性制造
          「已登录/可登出」预期；D-4 选 A 有用户点名依据，但 AC-6 允许 toast / 菜单内提示 /
          禁用+原因三种反馈形态，验收过宽，假账号壳的误导成本未被压到可测的最小形态。
        suggestion: >
          终确认时二选一钉死：(1) 保留 Logout 占位则 AC-6 收窄为一种可见反馈（建议菜单内
          固定文案或一次性 toast，禁止「仅禁用无说明」）；(2) 未登录隐藏 Logout（D-4 B），
          把 Logout 挪到真登录 Feature。Login 文案可继续按 D-1 A 占位，但须在 Out of Scope /
          AC-1 保持「不出现登录表单」。
        pm_response:
          action: >
            ADOPT 收窄 AC-6 为固定文案 Not signed in / 「未登录」且菜单保持打开；
            REJECT 把 D-4 推荐改成隐藏 Logout——D-4 仍建议 A（占位 Logout）留给用户终确认。
          adversarial_self_check: >
            Round 2 核对 PRD 0.2：AC-6 Then 已钉死单一可见文案与菜单保持打开，并显式禁止
            静默 no-op / 仅 disabled 无说明；D-4 选项 A 同步写成该文案形态且建议仍为 A。
            若只改 D-4 文案未改 AC-6，仍可三种实现过关——现 AC-6 已不可相反判定。
          disposition: adopted_partial
          responded_at: "2026-08-26T07:40:00Z"
      - id: PL-CHALLENGE-2
        severity: advisory
        category: behavior-change
        description: >
          既有行为变更（入口 Settings→Login、菜单从设置清单收成三项、Pin 从菜单一键改为
          面板内选项、设置从独立小 modal 收进全局面板）已写入 D-1/D-2/D-3 与「开工前必须想清的
          · 既有行为」，未发现漏网的行为翻转。
        suggestion: 终确认勾选 D-1/D-2/D-3 后即可；无需为行为变更补决策项。
        pm_response:
          action: 无需改 PRD；既有行为已在 D-1/D-2/D-3 与开工前段。
          adversarial_self_check: >
            Round 2 再读 D-1/D-2/D-3 与「🔁 既有行为」：Settings→Login、菜单三项、Pin 迁面板、
            独立小 modal→全局面板均在列，无漏网翻转。
          disposition: acknowledged
          responded_at: "2026-08-26T07:40:00Z"
      - id: EXT-EMBED-1
        severity: high
        category: ac-ambiguity
        description: >
          AC-3/AC-4 要求「左分类 + 右内容」且分类含 Browser / Saved Passwords / Remote Hosts，
          但「开工前必须想清的 · 最不确定」又把 Remote Hosts / Saved Passwords 自有弹层骨架如何
          嵌进全局壳标成纯实现问题，产品验收只看「一块面板 + 能切到 + 深链落到 Remote Hosts」。
          现码里 BrowserSettingsPage 走 SettingsModal 自有 backdrop+card，SavedPasswordsPage
          由 SettingsEntry 外包 backdrop，RemoteHostsPage 自带 remote-hosts__backdrop 且 Esc
          直接 onClose——若点分类仍弹出旧独立弹层盖住左导航，AC-3「右内容」与「非 520px 小卡
          当首页」可同时被实现方与验收方作出相反判定，P0 不可测。
        suggestion: >
          在 AC-3 或 AC-4 增补一条可判定约束：选中左侧分类后，对应设置内容渲染在全局面板右栏内；
          不得再叠一层独立 backdrop 小卡把左导航盖住。嵌入时去掉/旁路 SettingsModal、
          RemoteHostsPage、SavedPasswords 外层 backdrop（或抽可嵌入的内容区）。Esc/遮罩/关闭
          关闭的是全局面板（二级表单另有既有行为则写明例外）。「最不确定」段改为指向该 AC，
          删除「看起来像一页即可」的逃逸口径。
        code_evidence:
          - file_path: src/renderer/components/settings/RemoteHostsPage.tsx
            line_range: "968-992"
          - file_path: src/renderer/components/settings/BrowserSettingsPage.tsx
            line_range: "66-71"
          - file_path: src/renderer/components/SettingsEntry.tsx
            line_range: "410-432"
        pm_response:
          action: >
            ADOPT：AC-3 钉死右栏嵌入、禁止再叠独立设置 backdrop 盖住左导航；二级表单可保留；
            Esc 无二级层时关全局面板。最不确定段改为指向该 AC。
          adversarial_self_check: >
            Round 2 读 AC-3（PRD ~L116）与隐藏前提/最不确定（~L166-168）：已写「画在右栏内」
            +「不得再叠独立设置 backdrop/小卡」+ 点名禁止旧 520px SettingsModal / Remote Hosts
            全屏遮罩当面板；二级层例外与 Esc 无二级时关面板均在 Then。现码仍有 backdrop，但那是
            实现债，验收口径已不可与「套娃小卡」同判通过。
          disposition: adopted
          responded_at: "2026-08-26T07:40:00Z"
      - id: EXT-NAV-1
        severity: medium
        category: requirements-gap
        description: >
          AC-4 要求保留 Browser→Saved Passwords、Remote Hosts（Profile 依赖拦截）→Browser
          Settings 跳转，以及左侧直达 Saved Passwords；未规定跳转语义是「切换全局面板左侧分类」
          还是「在面板上再叠旧弹层」。与 EXT-EMBED-1 叠加时，实现极易保留
          onOpenPasswords/onOpenBrowserProfiles/onBack 的套娃路径，导致「一块面板」名存实亡。
        suggestion: >
          AC-4 Then 写明：面板内互跳 = 切换当前分类（或右栏内嵌替换），不新开独立设置弹层；
          Saved Passwords 经左导航直达时，不必再依赖「返回 Browser Settings」才能到达/离开
          （onBack 可改为切回 Browser 分类或仅保留关闭面板）。
        code_evidence:
          - file_path: src/renderer/components/SettingsEntry.tsx
            line_range: "404-431"
          - file_path: src/renderer/components/settings/RemoteHostsPage.tsx
            line_range: "889-896"
          - file_path: src/renderer/components/settings/SavedPasswordsPage.tsx
            line_range: "315-322"
        pm_response:
          action: >
            ADOPT：AC-4 Then 写明互跳=切分类、不新开独立设置弹层；左导航直达 Saved Passwords。
          adversarial_self_check: >
            Round 2 读 AC-4（PRD ~L117）：「上述互跳 = 切换当前分类，不新开独立设置弹层；
            左侧直接点 Saved Passwords 可到达，不必先经过 Browser」——与套娃弹层路径不可同判通过。
          disposition: adopted
          responded_at: "2026-08-26T07:40:00Z"
      - id: EXT-MUTEX-1
        severity: medium
        category: ac-gap
        description: >
          大白话 AC-8 声称「菜单、面板、About 不同时开着」，但 BDD 只覆盖「从入口打开面板/
          About 后再关闭」的焦点归还与菜单关闭。AC-7 深链只要求若账号菜单开着则先关菜单，
          未要求 About 已开时深链打开面板须关掉 About（或拒开）。现 SettingsEntry 用单一
          page 状态互斥，迁成「面板 + 独立 About」双态后若未写清，深链与 About 可能叠层。
        suggestion: >
          在 AC-7 或 AC-8 BDD 补一条：openRemoteHostsPage 时若 About 开着须先关 About（或
          等价互斥）；从菜单开 Settings/About 时另一方不得处于打开态。
        code_evidence:
          - file_path: src/renderer/components/SettingsEntry.tsx
            line_range: "254-274"
        pm_response:
          action: >
            ADOPT：AC-7/AC-8 写明菜单、全局面板、About 三态互斥；深链若 About 开着须先关。
          adversarial_self_check: >
            Round 2 读 AC-7（~L120）「About 若开着则先关（菜单、全局面板、About 三态互斥）」与
            AC-8（~L121）「至多一个处于打开」——深链叠 About 与菜单开 Settings 时 About 仍开
            均会 fail，不可相反判定。
          disposition: adopted
          responded_at: "2026-08-26T07:40:00Z"
      - id: EXT-AC6-1
        severity: advisory
        category: verifiability
        description: >
          AC-6 允许 Logout 未登录反馈为 toast、菜单内提示或禁用+原因任一，同一 P0 存在三种
          合格实现，后续 verify-ac / 视觉验收难对齐。
        suggestion: 与 PL-CHALLENGE-1 合并收窄为一种默认形态写入 AC-6 Then。
        pm_response:
          action: ADOPT，并入 PL-CHALLENGE-1：三种反馈形态已从 AC-6 删除。
          adversarial_self_check: >
            Round 2 读 AC-6（~L119）：仅保留菜单内固定文案 Not signed in /「未登录」，
            toast / 仅 disabled 路径已被 Then 否定句排除。
          disposition: adopted
          responded_at: "2026-08-26T07:40:00Z"
      - id: EXT-COMPAT-1
        severity: advisory
        category: naming-collision
        description: >
          兼容/命名碰撞方向已核对：PRD 术语段已区分账号入口 Login、Browser Profile Login
          continuity、OkBrowser openAccountMenu；GLOSSARY Host≠Electron 主进程本 Feature
          未误用。i18n.zh.ts 尚无账号入口用的 Login/Logout 词条，实现时须新增独立 key，
          勿复用 continuity / SSH「登录」相关文案。既有 SettingsEntry.test.tsx 把「Settings」
          标签、5 个 menuitem、Pin menuitemcheckbox 写死——PRD 涟漪已点名，属预期作废契约，
          非需求错误；blueprint 须整体改写测试而非保绿旧断言（RD-14）。
        suggestion: >
          实现/测试计划显式列出作废用例族（settings label、五 menuitem、pin 菜单开关）及
          替代断言（Login 文案、三项菜单、面板分类、深链落点）；Login/Logout 使用新 i18n key。
        code_evidence:
          - file_path: src/renderer/components/__tests__/SettingsEntry.test.tsx
            line_range: "73-140"
          - file_path: src/shared/i18n.zh.ts
            line_range: "538-545"
        pm_response:
          action: >
            ADOPT 进涟漪段：开工前写明按 RD-14 改写 SettingsEntry 测试断言，并新增独立 i18n key。
          adversarial_self_check: >
            Round 2 读「🧱 隐藏前提」②与「🌊 跨子系统涟漪」（~L166-167）：独立 i18n key、
            改写断言（Login / 三项菜单 / 面板分类 / 深链落点）、禁止保绿旧 IA 均已落笔。
          disposition: adopted
          responded_at: "2026-08-26T07:40:00Z"
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-08-26T08:20:00Z"
---

### fast 评审段（execution: subagent）· Round 1（保留）

评的是「要做的东西对不对」：账号入口 IA（Login + Settings/About/Logout）+ 现有配置迁入左导航全局 Settings 面板 + 深链改落点。上游意图（先占账号位、本轮不实现 Login、设置进面板）与 Out of Scope（无云账号/OAuth/Host 用户态、不照抄参考图多余分类）对齐良好；既有行为翻转已进待决策项。阻塞点在 **P0 面板嵌入语义不可测**，其余为产品前提与 AC 收紧。

coverage: [可实现, 可验证, 兼容/命名碰撞与既有测试入口契约]

#### PL-CHALLENGE

**PL-CHALLENGE-1** · severity: medium · category: product-premise

- **质疑六问落点**：价值前提 + 范围最小化。未登录就同时交付「Login」文案与「Logout」项，参考形态（Claude 账号菜单）在未登录时通常不会露出 Logout；本轮又不做真登录/登出，成对占位的认知税是否大于「菜单三项齐了」的形态收益？
- **description**：D-4 建议 A 有「用户点名 logout」依据，但 AC-6 把未登录反馈放宽到三种等价形态，假账号壳的误导未被收到可测最小集。
- **suggestion**：终确认在「保留 Logout 但钉死一种反馈」与「未登录隐藏 Logout」之间二选一；Login 文案可继续占位且继续禁止登录表单。
- **其余五问摘要**：
  - 问题定义：清楚——改入口 IA，不是加配置能力。
  - 范围最小化：全局面板本身被用户点名，不判过度；可砍的是未登录 Logout 占位（见上）。
  - 上游对齐：延续 `Settings-About-Entry`「未来用户/设置区」脚手架；sitemap/archive 仍写「菜单仅 About」属文档过时，PRD 已要求跟上，非复活拒绝项（KNOWLEDGE OS-* 未命中）。
  - 复活检查：未把 OkWork 云账号/OAuth 塞回范围；Login 仅文案。无实质复活问题。
  - 既有行为变更：见 PL-CHALLENGE-2。

**PL-CHALLENGE-2** · severity: advisory · category: behavior-change

- **description**：Settings→Login、菜单收三项、Pin 迁面板、独立小 modal→全局面板均已进 D-1/D-2/D-3 与「既有行为」段，**无漏列的行为翻转**。
- **suggestion**：终确认勾选即可。

#### 可实现

**结论**：renderer-only IA/壳层改造，复用 `SettingsEntry` 菜单交互、`openRemoteHostsPage` nonce 深链、既有各设置页能力——技术可行，不碰 Host 协议/persistence schema，符合 GLOSSARY「Host ≠ Electron 主进程」与架构红线。

**简洁性 counter-lens**：全局面板不是过度设计（用户点名 OpenCode 式左导航）。真正的过 ROI 风险是「为嵌入而重写 Remote Hosts 业务」或反过来「偷工继续套独立 modal」。PRD 把壳合成标成实现问题方向对，但当前 AC 逃逸口会逼实现二选一却无法判验收 → 见 EXT-EMBED-1（high）。

**EXT-EMBED-1** · high · ac-ambiguity — 必须修订（见 frontmatter；code_evidence: RemoteHostsPage backdrop、BrowserSettingsPage→SettingsModal、SettingsEntry 对 passwords/remoteHosts 的挂载方式）。

**EXT-NAV-1** · medium · requirements-gap — 面板内互跳应定义为切分类，避免套娃（code_evidence: onOpenPasswords / onOpenBrowserProfiles / onBack）。

查过无发现：无「安全加固/兜底过 ROI」类需求膨胀；Out of Scope 已挡住云账号与 Host 用户态。

#### 可验证

**AC 可测性**：AC-1/2/5 入口与菜单项清晰可测；AC-7 nonce 深链与「初值不打开」有现成测试可迁；AC-9 与代码中 `Settings → Remote Hosts` 假深链文案（preview / image paste）对齐。

**边界 / miss**：

- **EXT-EMBED-1** 使 AC-3/AC-4 对「右内容」happy path 与「仍弹旧小卡」miss 分支无法二分。
- **EXT-MUTEX-1** · medium · ac-gap — 深链 vs About 互斥未进 BDD。
- **EXT-AC6-1** · advisory — Logout 反馈三形态过宽。
- AC-3「默认定位到一个有效分类」未钉死默认项：可接受（任一有效分类即可），advisory 不单列。
- AC-1/AC-6「Given 用户未登录」：产品尚无登录态，恒真；可接受，不必发明假 auth 状态。

#### 兼容/命名碰撞与既有测试入口契约

**EXT-COMPAT-1** · advisory · naming-collision

- Login（账号入口文案）vs Login continuity vs `passwordVault.openAccountMenu`：PRD 当句定义已拆开，**需求层无碰撞发现**。
- 实现须新增 Login/Logout i18n，勿蹭 continuity/SSH「登录」译文。
- `SettingsEntry.test.tsx` 锁定旧入口契约（Settings 文案、5 menuitem、Pin 菜单开关）；PRD 涟漪已承认，blueprint/测试阶段按 RD-14 改写断言，勿为保绿退回旧 IA。

FilePanel 生产深链仍为 `openRemoteHostsPage()`（标题文案未写 Settings，AC-9 主伤在 preview/paste 的 `Settings → Remote Hosts` 字符串）——与 PRD 复用策略一致。

#### 整合结论（Round 1）

| 项 | 值 |
|----|-----|
| verdict | **NEEDS_REVISION** |
| 阻塞 finding | **EXT-EMBED-1**（high：全局面板嵌入/右栏语义与 AC-3/AC-4、最不确定逃逸口径矛盾 → P0 不可测） |
| 建议同轮修订 | EXT-NAV-1（面板内互跳=切分类）；EXT-MUTEX-1（深链/About 互斥）；PL-CHALLENGE-1 / EXT-AC6-1（Logout 占位与反馈形态收窄，可与终确认一起做） |
| 不阻塞 | PL-CHALLENGE-2、EXT-COMPAT-1、价值方向与 Out of Scope |
| next_round_required | true |
| 是否需要改 PRD | **是**——至少补上「分类内容嵌在右栏、禁止再叠独立设置 backdrop」的可判定 AC，并写清面板内跳转与深链互斥 |

---

### fast Round 2 验证冷审（execution: subagent）

核对对象：PRD **0.2**（revision_history 已记 Round 1 冷审修订）vs 上轮 ADOPT/REJECT 期望落点。coverage: [可实现, 可验证, 自主方向]。现码 `RemoteHostsPage` / `SettingsModal` / `SettingsEntry` passwords 外包 backdrop **仍在**——属未开工实现债；本轮只验需求口径是否已不可相反判定。

#### 上轮 finding 逐条核实

| id | 期望 | 结果 | 证据 |
|----|------|------|------|
| EXT-EMBED-1 | AC-3 右栏嵌入 + 禁套娃 backdrop；二级可留；Esc 无二级关面板 | **已修** | PRD AC-3 ~L116；隐藏前提① / 最不确定 ~L166-168 指向该 AC，逃逸口径已删 |
| EXT-NAV-1 | AC-4 互跳=切分类；左导航直达 Passwords | **已修** | AC-4 ~L117 |
| EXT-MUTEX-1 | AC-7/8 三态互斥；深链先关 About | **已修** | AC-7 ~L120；AC-8 ~L121；AC-5 亦约束 About 时面板未开 |
| PL-CHALLENGE-1 | 收窄 AC-6；D-4 仍建议 A（不改成隐藏 Logout） | **已修** | AC-6 ~L119 固定 Not signed in /「未登录」+ 菜单保持打开；D-4 ~L107 建议仍为 A |
| EXT-AC6-1 | 三种反馈形态删除 | **已修** | 并入 AC-6；toast / 仅 disabled 无说明已被否定 |
| PL-CHALLENGE-2 | 无需改 | **确认仍成立** | D-1/2/3 +「🔁 既有行为」~L165 |
| EXT-COMPAT-1 | 涟漪写明改写测试 + 独立 i18n key | **已修** | 「🧱/🌊」~L166-167 |

质疑→确认：未发现「声称已修但 AC 仍可相反判定」项。

#### 新 finding

**无。** 未发现新的 high/medium 需求缺漏或 AC 矛盾。未为低概率 Esc/入口 toggle 边角加兜底需求。

自主方向：价值（账号位脚手架 + 设置进全局面板）、Out of Scope（无真 Login/Logout/云账号）、D-4 占位 Logout 收窄反馈后仍留给终确认——与 Round 1 方向一致，无新前提质疑。

#### Round 2 整合结论

| 项 | 值 |
|----|-----|
| verdict | **APPROVE** |
| 未修 | 无 |
| 新 finding | 无 |
| next_round_required | false |
| 是否需要再改 PRD | 否（D-1..D-5 仍待用户终确认，不阻塞本轮需求口径） |
