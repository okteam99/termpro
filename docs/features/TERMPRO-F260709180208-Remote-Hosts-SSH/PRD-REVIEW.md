---
prd_feature_id: TERMPRO-F260709180208-Remote-Hosts-SSH
review_round: 2
review_started_at: "2026-07-09T18:05:00Z"
review_completed_at: "2026-07-09T18:25:00Z"
reviewers: [qa, architect, pl]
verdicts: {qa: APPROVE, architect: APPROVE, pl: APPROVE}
reviews:
  - role: qa
    review_scope: prd
    execution: subagent
    verdict: APPROVE
    started_at: "2026-07-09T18:05:00Z"
    completed_at: "2026-07-09T18:21:00Z"
    files_read:
      - PRD.md
      - YOLO-PREFLIGHT.md
      - product-overview/workstream/WS-01-remote-host.md
      - docs/ROADMAP.md
      - src/host/wsServer.ts
      - src/renderer/services/hostClient.ts
    findings:
      - id: QA-1
        severity: medium
        description: "失败后重试无 AC——交付预期承诺可重试、状态机画了 failed→connecting，却无 AC 验证最高频真实路径（错密码→改→重连）"
        suggestion: "新增重试/手动重连 AC"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：重试可视作 AC-2/AC-4 的隐含语义，单列可能是凑数。回读状态图 failed→connecting 边与交付预期第 3 行——它们承诺了独立的用户可感知行为且无任何 AC 锚定，隐含语义在验收时无法强制，质疑不成立，确为覆盖缺口。"
          rationale: "新增 AC-12（P0）：failed 修正后重试至 ready + disconnected 手动重连。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: QA-2
        severity: medium
        description: "AC-8 四合一（Origin/节流/token 交接/TOCTOU）· grep_keyword 过宽 · 节流未量化（现状超阈值后每次失败均告警=刷屏）"
        suggestion: "拆 4 条 + 收紧 grep + 给窗口阈值"
        category: quality
        code_evidence:
          file_path: "src/host/wsServer.ts"
          line_range: "191-201"
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：拆分可能造成 AC 膨胀、PENDING-003 本就是一组。回读 wsServer.ts:191-201 确认三件事验收手段完全不同（Origin=upgrade 校验、节流=告警频率、token=部署信道），合并则单条 AC 不可判定，质疑不成立。"
          rationale: "拆为 AC-8（token 交接·grep token-stdin|portFile）/AC-9（节流量化：同窗口至多 1 次）/AC-10（Origin·P2）。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: QA-3
        severity: medium
        description: "AC-9(旧) 缺 node 场景的验证方式与自述测试兜底 ssh localhost（本机必有 node）冲突，无法转可运行用例"
        suggestion: "指定 node 缺失/降版模拟手段"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：模拟手段属 TC 层细节，PRD 或不必写。但 AC 的可测试性是 PRD 层承诺，验证路径与兜底环境矛盾会让 QA 无从转化，确为 PRD 层缺口。"
          rationale: "AC-11 明确 exec 桩/PATH shim 模拟「无 node」与「node 18」两态。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: QA-4
        severity: medium
        description: "「已部署且版本符→跳过上传」快路径建了模（时序 alt/状态边）却无 AC，每次重传的实现仍能全绿"
        suggestion: "补快路径 AC"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：快路径可算 AC-4 优化细节。回读时序图 alt 分支——它是独立用户可感知行为（重复连接耗时差数量级），无 AC 则回归退化不可见，质疑不成立。"
          rationale: "新增 AC-13（P1）：跳过上传可观测 + 认领驻留进程不重复启动。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: QA-5
        severity: low
        description: "Origin 白名单勿误杀真实 Electron renderer（file:// 或无 Origin 头）"
        suggestion: "白名单写明真实值集"
        category: technical-consistency
        code_evidence:
          file_path: "src/renderer/services/hostClient.ts"
          line_range: "186-224"
        pm_response:
          action: ADOPT
          adversarial_self_check: "与 ARCH-4 独立重合（两位 reviewer 同点），交叉验证了真实性；回读 main.ts loadFile/loadURL 两渠道确认 Origin 值集差异存在。"
          rationale: "并入 AC-10 描述：白名单=file:///null+dev vite origin，无 Origin 头不受影响。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: QA-6
        severity: low
        description: "AC-10(旧·删机清凭据) P2 偏低"
        suggestion: "升 P1"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：删除机器是低频操作，P2 或合理。但与 PL-CHALLENGE-3 交叉：孤儿密文直接削弱 AC-3 生命周期保证，安全卫生非低频收益，质疑不成立。"
          rationale: "AC-14 升 P1：凭据随删必清 + 断连 best-effort。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: QA-7
        severity: low
        description: "「测试连接」与「连接」失败口径不一致且测试连接范围边界未言明"
        suggestion: "明确测试连接=认证+可达探测（不部署），失败分类统一"
        category: ux
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：属实现细节。但「测试连接会不会部署」是用户可感知行为边界（全景页有测试失败注入态），属 PRD 层，质疑不成立。"
          rationale: "AC-2 重写：测试连接=认证+可达探测不部署不拉起，失败口径与连接统一分类。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: QA-8
        severity: info
        description: "AC-3 safeStorage 对上游「仅存钥匙串」字面偏离已由用户 D-2 确认——合规留痕提示，防后续 verify 误报"
        suggestion: "留痕"
        category: business-alignment
        pm_response:
          action: ADOPT
          adversarial_self_check: "与 PL-CHALLENGE-1/ARCH-10 同点交叉；处置并入其 remedy。"
          rationale: "ADR-001 落地 + 上游 4 处台账注记同步。"
          responded_at: "2026-07-09T18:16:00Z"
  - role: architect
    review_scope: prd
    execution: subagent
    verdict: APPROVE
    started_at: "2026-07-09T18:05:00Z"
    completed_at: "2026-07-09T18:24:00Z"
    files_read:
      - PRD.md
      - YOLO-PREFLIGHT.md
      - product-overview/workstream/WS-01-remote-host.md
      - README.md
      - src/host/host.ts
      - src/host/wsServer.ts
      - src/host/token.ts
      - src/host/hostCore.ts
      - src/main/main.ts
      - src/renderer/services/hostClient.ts
      - src/shared/protocol.ts
      - scripts/package-host.mjs
      - forge.config.ts
      - package.json
    findings:
      - id: ARCH-1
        severity: high
        description: "AC-4「自动上传 host bundle」运行时无物可传：产物只由 CI 旁路脚本产出，无机制随应用分发（forge 无 extraResource），且缺远端架构探测/bundle 选取"
        suggestion: "PRD 定死部署产物运行时来源与架构选取"
        category: technical-consistency
        code_evidence:
          file_path: "forge.config.ts"
          line_range: "143-144"
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：产物来源可算 blueprint 实现细节。回读 package-host.mjs:1-18 与 forge.config.ts 确认「运行时手里没有 bundle」是 AC-4 能否成立的地基性缺口（选项间有产品可感差异：离线可用性/体积/版本偏斜），非实现细节，质疑不成立。"
          rationale: "新增 D-6（AI 代决+WARN 留痕）：resources 内置全架构产物；AC-4 增 uname 探测+幂等覆盖；隐藏前提③登记 CI extraResource 依赖；npm 手装为释放阀。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-2
        severity: high
        description: "驻留进程 × --listen :0 随机端口（仅 stdout 暴露）× token 不落远端持久日志——三方张力未点破，happy path 图不可实现"
        suggestion: "token 经 stdin/fd 注入 + 端口不依赖 stdout + 驻留 stdout 处置明确"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/host.ts"
          line_range: "59-68"
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：或可固定端口绕开。回读 host.ts:26-34/59-68 确认端口冲突风险使固定端口不可靠，stdout 依赖与驻留重定向确实互斥；张力真实存在且必须在 PRD 层定方向（影响 AC-8 语义），质疑不成立。"
          rationale: "新增 D-7：token-stdin 注入 + 端口文件（O_EXCL 0600）sftp 回读 + stdout 重定向至不含 token 的日志；时序图/AC-8 重写。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-3
        severity: medium
        description: "两图 ready 语义打架（隧道通 vs 握手成功）且 AC-6 不兼容断开在状态机无落点"
        suggestion: "拆 verifying 态 + 补 failed(incompatible) 边 + 两图对齐"
        category: technical-consistency
        code_evidence:
          file_path: "src/renderer/services/hostClient.ts"
          line_range: "207-224"
        pm_response:
          action: ADOPT
          adversarial_self_check: "回读 hostClient.ts:211-221 确认版本校验在连接建立后独立发生、失败主动断开——状态机确实缺这条真实路径，质疑（图只是示意）不成立。"
          rationale: "状态图加 verifying + verifying→failed(incompatible)；时序事件改名 tunnel-ready；ready=握手校验通过；AC-5/6 同步。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-4
        severity: medium
        description: "Origin 白名单必须匹配合法 renderer 实际 Origin（打包 file:///null · dev vite），否则误杀自家客户端"
        suggestion: "白名单写明确切值集"
        category: technical-consistency
        code_evidence:
          file_path: "src/main/main.ts"
          line_range: "486-492"
        pm_response:
          action: ADOPT
          adversarial_self_check: "与 QA-5 独立重合交叉验证；回读 main.ts 两种加载渠道确认值集差异，质疑不成立。"
          rationale: "AC-10 白名单=真实值集 + 不误杀条款。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-5
        severity: medium
        description: "SSH 私钥存储模型未定（路径引用 vs 内容入库），零明文保证对私钥这一支不完整"
        suggestion: "明确私钥处置模型"
        category: completeness
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：AC-3 或可解读为已覆盖。逐字回读 AC-3 确认只提密码/passphrase，私钥支路确实未定且两选项安全差异实质，质疑不成立。"
          rationale: "私钥按路径引用不入库（AC-2/AC-3 + Out of Scope）。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-6
        severity: low
        description: "SSH 登录凭据与 host capability token 两类 secret 需显式区分，防「凭据不进 renderer」被误读为违规"
        suggestion: "PRD 显式分两类"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/token.ts"
          line_range: "1-3"
        pm_response:
          action: ADOPT
          adversarial_self_check: "回读 token.ts 威胁模型注释与时序图 tunnel-ready(token) 确认 token 必然入 renderer，字面矛盾真实存在。"
          rationale: "AC-3 显式区分两类 + ADR-001 说明。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-7
        severity: low
        description: "「PTY 流量不过 Electron IPC」易误读为绕过 main——实际经 main ssh2 流式中继，背压需尊重 FLOW 水位"
        suggestion: "措辞收紧 + blueprint 提示"
        category: technical-consistency
        code_evidence:
          file_path: "src/shared/protocol.ts"
          line_range: "11-14"
        pm_response:
          action: ADOPT
          adversarial_self_check: "回读 protocol.ts FLOW 常量确认流控是协议契约，中继在数据路径上属实。"
          rationale: "D-4 措辞收紧 + 涟漪段 FLOW 背压提示。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-8
        severity: low
        description: "hostCore 恒返回 hostId:'local'——per-host 键必须用 TermPro 配置 id，否则多机撞键"
        suggestion: "PRD 明写键选择 + hostId 真实化=BL-004 前置"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/hostCore.ts"
          line_range: "155-165"
        pm_response:
          action: ADOPT
          adversarial_self_check: "回读 hostCore.ts:156 确认硬编码，撞键风险真实。"
          rationale: "D-4/Out of Scope 明写配置 id 为键。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-9
        severity: low
        description: "ssh exec env 注入受远端 sshd AcceptEnv 限制多不可靠，token 交接优先 stdin/fd"
        suggestion: "PRD 备注信道优先级"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/token.ts"
          line_range: "64-119"
        pm_response:
          action: ADOPT
          adversarial_self_check: "与 ARCH-2 解法自然合并；AcceptEnv 默认限制是 sshd 通用事实。"
          rationale: "并入 D-7（stdin 优先 · env 不采用）。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-10
        severity: low
        description: "上游 WS-01-S3 AC③措辞与 PRD AC-3 已字面背离，建议同步上游"
        suggestion: "回写上游措辞"
        category: consistency
        pm_response:
          action: ADOPT
          adversarial_self_check: "与 PL-CHALLENGE-1 remedy B 同点；上游 4 处 + 二级复述 3 处已全部注记。"
          rationale: "上游台账同步 + ADR-001。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: ARCH-11
        severity: medium
        description: "Round 2 新增：D-5「无孤儿·必认领」保证缺 token 生命周期/进程身份机制（认领须过 token 闸 · main 侧留存语义未定 · 端口文件崩溃残留未覆盖）"
        suggestion: "PRD 一句澄清（token 绑定进程生命周期 · main 侧本地留存合规 · 认领-或-确定性回收），机制归 blueprint（must-resolve-at-blueprint）"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/wsServer.ts"
          line_range: "203-222"
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：或属纯 TECH 细节不进 PRD。但「必认领」与 AC-8「不落持久」在 PRD 文本内自相矛盾（token 从哪来），PRD 层必须先自洽，质疑不成立。"
          rationale: "v0.3 落 D-5「认领-或-确定性回收」+ AC-8 main 侧本地留存合规澄清 + 端口文件陈旧清理；机制细节标记 blueprint must-resolve（与 AC-13/D-5 绑同一 TECH 小节）。"
          responded_at: "2026-07-09T18:28:00Z"
  - role: pl
    review_scope: prd
    execution: subagent
    verdict: APPROVE
    started_at: "2026-07-09T18:05:00Z"
    completed_at: "2026-07-09T18:23:00Z"
    files_read:
      - PRD.md
      - YOLO-PREFLIGHT.md
      - product-overview/workstream/WS-01-remote-host.md
      - product-overview/TermPro_业务架构与产品规划.md
      - docs/ROADMAP.md
      - project-specs/KNOWLEDGE.md
      - docs/design/sitemap.md
      - adrs/ADR-001-credential-storage-safestorage.md
    findings:
      - id: PL-CHALLENGE-1
        severity: high
        description: "凭据存储语义（safeStorage 密文落 userData）与上游 4 处「仅存系统钥匙串」矛盾未消解；批量 ok 是否构成对安全属性变更的知情确认存疑"
        suggestion: "回退 D-2 重新单点问用户，或落 ADR + 同步上游 4 处措辞"
        category: premise-challenge
        pm_response:
          action: REJECT
          adversarial_self_check: "steelman：PL 最强论据是「6 项批量 ok ≠ 对『密码密文落 App 文件』这一安全属性变更的隔离知情确认，用户当初说钥匙串可能正是为 secret 不落应用文件」。反驳：回读预研门暂停点原文，决策表第 2 行独立摊开了该差异（『加密密钥在系统钥匙串、凭据密文落 userData…需你接受此实现语义』），用户是在事实在场下拍板；且 safeStorage 密文的解密密钥不随备份走，威胁增量小。remedy B（ADR-001+上游 4 处+二级复述 3 处全同步）已全部执行，台账矛盾消除。PL Round 2 已明确接受本 REJECT。"
          rationale: "REJECT 重新问用户（不重开已在逐行事实在场下确认的决策 · yolo 前置保真机制即为此设计）；ADOPT remedy B 全部落地；concerns WARN 已留审计。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: PL-CHALLENGE-2
        severity: low
        description: "AC-8 部分重述 BL-002 已交付能力（告警）+ Origin 校验对桌面 App 形态适用性存疑"
        suggestion: "拆 AC + 先验证不重建 + Origin 写明威胁或降级"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: "按 PL 要求先验证：回读 wsServer.ts:191-201——BL-002 交付了告警本身，但超阈值后每次失败均 emit（刷屏），节流是真缺口非重述；Origin 确属薄纵深，降 P2 并写明 rebinding 威胁。"
          rationale: "AC-9 明写现状 baseline 与 delta；AC-10 降 P2+威胁+值集。PL Round 2 确认返工疑虑被验证反驳。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: PL-CHALLENGE-3
        severity: low
        description: "AC-10(旧) 可延后，但凭据清理半段有安全卫生理由不能一并砍"
        suggestion: "凭据清理标随删必做，断连再删降级"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: "与 QA-6 交叉；孤儿密文削弱 AC-3 生命周期叙事成立。"
          rationale: "AC-14 升 P1 拆半：随删必清 + best-effort 断连。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: PL-CHALLENGE-4
        severity: low
        description: "自动部署是关键路径最重技术赌注，R1 已备 npm 兜底应标为显式释放阀 + 幂等重部署"
        suggestion: "风险区记释放阀 + AC-4 补幂等"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：释放阀写进 PRD 或降低交付决心。但显式释放阀恰是 yolo 无人值守下防死磕的正确止损设计，且 PL 明言不主张砍 AC-4，质疑不成立。"
          rationale: "§风险与释放阀落 npm 手装阀（触发须 WARN）+ AC-4 幂等覆盖。"
          responded_at: "2026-07-09T18:16:00Z"
      - id: PL-CHALLENGE-5
        severity: low
        description: "D-5 驻留把 BL-005 会话存活模型一角提前拉进 BL-003，「驻留但回收」中间态有孤儿进程风险"
        suggestion: "blueprint 明确断开归宿 + 无孤儿保证 + 界定存活归 BL-005"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: "质疑：D-5 已用户预授权或不必再动。但预授权的是驻留方向，孤儿回收语义是新暴露的边界缺口，补边界不改方向，质疑不成立。"
          rationale: "D-5 收紧为认领-或-确定性回收（并 ARCH-11 机制澄清）+ Out of Scope 界定；AC-13 认领路径可测。"
          responded_at: "2026-07-09T18:16:00Z"
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-07-09T18:28:00Z"
---

# PRD-REVIEW（TERMPRO-F260709180208-Remote-Hosts-SSH）Round 2 收敛

> 全文评审记录见 `reviews/goal-qa.md` · `reviews/goal-architect.md` · `reviews/goal-pl.md`（Round 1 + Round 2 段）。本文件为机读整合单源。

## qa 评审段（execution: subagent）

verdict: **APPROVE**（Round 2）

Round 1 提出 8 findings（4 medium：重试无 AC / AC-8 四合一 / 缺 node 不可测 / 快路径无 AC），PM 全部 ADOPT。Round 2 复核 8/8 有效消解，未发现实质新问题；残留 2 条 info（AC-10 grep 裸 origin 兜底可在实现后收紧、交付预期措辞与 AC-11 模拟法可选对齐），不阻断。

## architect 评审段（execution: subagent）

verdict: **APPROVE**（Round 2 · 附 ARCH-11 must-resolve-at-blueprint）

Round 1 提出 10 findings（2 high：ARCH-1 部署产物运行时无物可传、ARCH-2 驻留×随机端口×token 不落盘三方张力），PM 全部 ADOPT（D-6/D-7 新决策 + 图/AC 重写 + 上游同步）。Round 2 复核 10/10 消解、无新硬矛盾；新增 ARCH-11（medium·must-resolve-at-blueprint）：D-5 认领机制的 token 生命周期/进程身份欠定——已在 PRD v0.3 落一句澄清（认领-或-确定性回收 · main 侧留存合规），机制细节移交 blueprint 与 AC-13/D-5 绑同一 TECH 小节。

## pl 评审段（execution: subagent · PL-CHALLENGE 段）

verdict: **APPROVE**（Round 2）

质疑六问全跑：①价值前提不可杀（BL-001/002 沉没成本的拱心石 + 用户明确诉求）②真问题 ③范围最小化产 3 条收缩建议全落地 ④上游对齐唯一裂缝=凭据语义（PL-CHALLENGE-1 · major）⑤复活检查干净（~/.ssh/config 未复活 · OS-004 不同轴）⑥既有运行时行为无变更。PL-CHALLENGE-1 的「重新问用户」被 PM REJECT（预研门决策表逐行摊开差异 = 知情确认），PL Round 2 复核后**明确接受该 REJECT**（原论据的事实前提被证伪），remedy B（ADR-001 + 上游 4 处 + 二级复述 3 处同步）经 grep 复核全部落地。残留 2 条非阻塞 note（R2-N1 已扫尾归零；R2-N2 = D-6 依赖 CI 三架构预编译齐备，linux-arm64 需 blueprint 实证或显式降级路径）。

## 整合结论（Round 2 完成后 · PMO）

- overall_verdict: **APPROVE**（qa/architect/pl 三路 APPROVE）
- next_round_required: **false**
- 移交 blueprint 的强制事项：**ARCH-11**（token 生命周期 + 孤儿回收机制，与 D-5/AC-13 同节设计）· **R2-N2**（CI 三架构预编译实证，linux-arm64 缺位则显式降级）· QA R2-1（实现后收紧 AC-10 grep）
- needs-ui 判定：**true**（Settings → Remote Hosts 管理页 · 全景 `settings-remote-hosts` 已用户确认，ui_design 阶段增量细化）
- 用户最终确认暂停点：yolo auto 代确认（评审全真跑 · 本文件 + concerns WARN 留痕）
