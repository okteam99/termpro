---
review_model: codex-cli 0.139.0
review_role: external
review_stage: blueprint
target_commit: fa55199a7dfb4fe67d74ac38691dbfa3f888c154
target_base: main
title: "TERMPRO-F260613150158-Settings-About-Entry · blueprint stage external review"
generated_at: "2026-06-13T16:06:43Z"
invoked_by: state.py external-review (v8.20)
host: claude-code
---
REVIEW-ACK blueprint-codex-20260613T160408Z

---
perspective: external-codex
target: blueprint
generated_at: "2026-06-13T16:05:25Z"
files_read:
  - docs/features/TERMPRO-F260613150158-Settings-About-Entry/PRD.md
  - docs/features/TERMPRO-F260613150158-Settings-About-Entry/TC.md
  - docs/features/TERMPRO-F260613150158-Settings-About-Entry/TECH.md
  - project-specs/ARCHITECTURE.md
  - project-specs/DEV-RULES.md
  - project-specs/KNOWLEDGE.md
  - teamwork-space.md
  - /Users/liam/.agents/skills/teamwork/templates/external-cross-review.md
  - /Users/liam/.agents/skills/teamwork/stages/blueprint-stage.md
  - /Users/liam/.agents/skills/teamwork/agents/README.md
  - /Users/liam/.agents/skills/teamwork/codex-agents/blueprint-reviewer.toml
model: "gpt-5-codex"
status: DONE_WITH_CONCERNS
findings:
  - id: CR-1
    checklist: C6
    severity: high
    location: "TC.md AC-5 coverage; TECH.md 版本号数据流 / TDD step 3"
    issue: "AC-5 的真实 P0 风险是 main 必须把 app.getVersion() 注入 additionalArguments，并由 preload 暴露到 renderer；当前 TC 只把 main.ts 静态核对写在说明里，没有可执行或明确登记的测试项。"
    rationale: "T-001 只验证 argv 解析，T-007a 只验证组件读取 mock bridge 值；即使 dev 忘记在 main.ts 注入 --termpro-version，核心自动化测试仍可能全绿。"
    suggestion: "在 TC.md 增加一个登记的静态/单元测试，例如抽出 buildAdditionalArguments({ version, smoke, dev }) 并断言包含 --termpro-version=<app.getVersion()>；TECH.md 同步写入该 helper 和测试步骤。"
  - id: CR-2
    checklist: C6
    severity: low
    location: "TECH.md TDD 开发计划"
    issue: "TECH 的测试清单落后于 TC v0.2：T-002 名称仍是 only missing，T-007 仍合并 version/fallback，且缺少 T-006b 与 T-010。"
    rationale: "TC.md frontmatter 已把失败态穷举、modal/menu 互斥、视觉手工签核拆开；TECH 的执行清单若被 RD 当作主清单，会漏做或合并关键测试。"
    suggestion: "把 TECH.md TDD 表逐项对齐 TC.md frontmatter，尤其补 T-006b、T-010，并将 T-002/T-007a/T-007b 的函数名与覆盖范围同步。"
  - id: CR-3
    checklist: C3
    severity: low
    location: "PRD.md AC-8; TC.md T-002/T-007b; TECH.md fallback"
    issue: "AC-8 写了“壳层桥返回空 / 异常”，但 TC/TECH 只覆盖空字符串与 argv 解析失败，没有覆盖 window.termpro 缺失或读取抛错。"
    rationale: "TECH 计划直接读取 window.termpro.version；如果测试环境或 preload 暴露异常，当前 fallback 契约不一定成立。"
    suggestion: "二选一收敛：要么把 AC-8 明确缩窄为 version 为空；要么 TECH 使用安全读取并补一个 bridge absent/throw 的 TC。"
  - id: CR-4
    checklist: C2
    severity: low
    location: "TC.md T-009; TECH.md Sidebar footer 接线"
    issue: "T-009 的前置条件“存在可用更新事件”还不够可执行，未定义如何 mock window.termpro.onUpdateEvent 与 Sidebar store 环境。"
    rationale: "Sidebar footer 共存测试会经过 UpdatePill 的事件订阅和全局 store；缺少 fixture 约定容易让 dev 写出脆弱测试或退化成只测 SettingsEntry。"
    suggestion: "在 TC.md/TECH.md 明确 T-009 harness：devChannel=true，onUpdateEvent 立即回调 { state: 'available', version: 'x.y.z' }，并提供最小 store/workspace fixture。"
findings_summary:
  blocker: 0
  high: 1
  low: 3
  info: 0
  total: 4
---

# Findings

CR-1 是建议优先修的点，因为它直接关系 P0 AC-5 是否能证明“真实版本、非硬编码”。其余三项主要是把 TC 与 TECH 的执行口径收紧，避免 dev 阶段靠口头说明补洞。

Clean checks: AC-1 到 AC-9 均在 TC.md 有 covers_ac 引用；TECH 与 project-specs/ARCHITECTURE.md 的 main/preload/renderer 分层方向一致；无 DB schema 变更；未发现新增运行时依赖或 HostService 越界方案。
