---
feature_id: "TERMPRO-F260613150158-Settings-About-Entry"
review_scope: blueprint
reviewers: [qa, architect, external]
verdict: APPROVE
verdicts: {qa: APPROVE, architect: APPROVE, external: APPROVE}
overall_verdict: APPROVE
external_model: "codex-cli 0.139.0 (gpt-5-codex)"
external_artifact: external-cross-review/blueprint-codex.md
decided_at: "2026-06-14T00:10:00Z"
---

# TECH/TC 评审记录(blueprint) — TERMPRO-F260613150158-Settings-About-Entry

> 评审角色 qa / architect / external(异质 codex)· 隔离冷审。TECH v0.1→v0.3 + TC v0.1→v0.3 整合全部 finding。

## Architect 冷审(opus · verdict: APPROVE)

| id | sev | finding | PM 决策 |
|----|-----|---------|---------|
| ARCH-1 | info | 同步版本暴露走 additionalArguments 与既有 smoke/dev 完全同款 · 分层正确 · 红线守住 | ACK |
| ARCH-2 | medium | `Sidebar.css` 有两处 `.sidebar-footer`(L254/L303),竖向化须改 L303 那条非追加,否则胶囊/徽标横排回归 | **ADOPT** |
| ARCH-3 | low | `#e06c75` 是裸 hex 非 token,About 入口不应引红 | **ADOPT** |
| ARCH-4 | low | 钉 @testing-library/react@^16 + 显式装 @testing-library/dom + 验 TSX transform | **ADOPT** |
| ARCH-5 | low | parseVersionArg 用 slice+trim 而非 split('=')[1] | **ADOPT** |
| ARCH-6 | info | 冒烟覆盖初始渲染 · jsdom 覆盖交互 · 分层恰当无 gold-plating | ACK |

**PM 响应(关键)**:
- **ARCH-2 ADOPT** · adversarial_self_check:质疑「是否多虑——直接加新规则不就行?」回读 Sidebar.css 确认 L254(margin-top:auto)+ L303(display:flex row)两条都管 footer,新加第三条 column 会与 L303 的 row 级联打架 → 质疑不成立,采纳。已写改动清单「改 L303」+ 风险表 + 冒烟核对项。
- **ARCH-3 ADOPT**:About 是非破坏性动作,确无需红色;TECH §样式方案去 `#e06c75`,仅保留既有 DEV 徽标自带字面。

## QA 冷审(sonnet · verdict: NEEDS_REVISION → 修订后 APPROVE)

| id | sev | finding | PM 决策 |
|----|-----|---------|---------|
| QA-1 | high | jsdom/@testing-library 未在 package.json · 须设前置门 | **ADOPT**(TDD step4 改前置门 + vitest 冒烟) |
| QA-2 | high | parseVersionArg 三失败态(缺/空/无`=`)未穷举,case(c) 易 throw | **ADOPT**(契约表 + T-002 Scenario Outline 穷举) |
| QA-3 | medium | TC-003(AC-1)无 Gherkin 场景 | **ADOPT**(补 TC-003) |
| QA-4 | medium | T-007 合并 AC-5/AC-8;AC-5 非硬编码非 T-007 单独可证 | **ADOPT**(拆 T-007a/b + AC-5 多测合证) |
| QA-5 | medium | AC-7「不重叠」jsdom 无布局引擎不可测 | **ADOPT**(T-009 仅证共存 · 不重叠归 smoke+designer) |
| QA-6 | medium | 缺「弹窗开时点入口不残留菜单」互斥测试 | **ADOPT**(加 T-006b) |
| QA-7 | low | T-010 level=fe-e2e 误导 | **ADOPT**(改 level: manual) |
| QA-8 | low | AC-9 manual 签核可接受 | ACK |

## External 冷审(codex-cli 0.139.0 / gpt-5-codex · status: DONE_WITH_CONCERNS · 1 high + 3 low → 全 ADOPT → APPROVE)

> 产物:`external-cross-review/blueprint-codex.md`(REVIEW-ACK verified)。Clean checks:AC-1~9 均有 covers_ac · 分层与 ARCHITECTURE.md 一致 · 无 DB schema · 无新运行时依赖 · 无 HostService 越界。

| id | sev | finding | PM 决策 |
|----|-----|---------|---------|
| CR-1 | high | AC-5 真实 P0 风险 = main 注入 `--termpro-version`;现仅 argv 解析 + 组件读 mock 有测,dev 漏注入仍全绿 | **ADOPT** |
| CR-2 | low | TECH 的 TDD 测试清单落后 TC v0.2 | **ADOPT** |
| CR-3 | low | AC-8 写「壳层桥返回空/异常」,但未覆盖 window.termpro 缺失/抛错 | **ADOPT** |
| CR-4 | low | T-009 harness(「存在可用更新事件」)不可执行,未定义 mock onUpdateEvent/store | **ADOPT** |

**PM 响应(关键)**:
- **CR-1 ADOPT(high)** · adversarial_self_check:质疑「这是否过度——版本注入一行代码,值得单测?」回读自己的数据流图确认:T-001 只证 parseVersionArg(消费侧)、T-007a 只证组件读 bridge(mock),**注入侧(main 写 flag)完全无自动化测试** → dev 漏写 `--termpro-version` 时,argv 里就没有它,但所有现存自动化测试仍全绿 → 这是真实未覆盖 gap,质疑不成立,采纳。措施:抽 `buildAdditionalArguments({version,smoke,dev})` 纯函数(无 electron import),main 调它传 `app.getVersion()`,新增 T-011 断言输出含 `--termpro-version=<v>` → 注入逻辑可测,仅余 `app.getVersion()` 一行静态可审。
- **CR-3 ADOPT**:renderer 改安全读 `window.termpro?.version ?? ''`,空值与 bridge-absent 两态等价回退「版本未知」;AC-8 语义收敛为「读不到 → 版本未知」,T-007b 覆盖空值、可选链覆盖 absent。
- **CR-2/CR-4 ADOPT**:TECH TDD 清单逐项对齐 TC frontmatter(补 T-006b/T-010/T-011)+ T-009 harness 写明(devChannel=true · onUpdateEvent 立即回调 available · 最小 store fixture)。

## 整合结论
- overall_verdict: **APPROVE** —— 三方冷审全部 finding 已纳入 TECH v0.3 / TC v0.3(AC 覆盖 9/9 · 含注入侧 T-011)。
- 布局取舍:用户确认 footer 竖向栈「升级胶囊在上 · Settings 入口在下 · 菜单向上浮出」(方案 A · 2026-06-14)。
- 下一步:blueprint-complete → 自动转 dev(按 TECH 改动清单 + TDD 红绿实现 · 三绿门禁:tsc + vitest + 冒烟)。
