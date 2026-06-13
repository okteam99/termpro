---
reviewer: qa
review_scope: code-review
execution: subagent
verdict: APPROVE
target_commit: 217cfadaceb4cb7caa537b38c2c24353571b803e
reviewed_at: "2026-06-14T00:30:00Z"
---
# 代码评审 · QA(sonnet 隔离冷审)

verdict: **APPROVE**(初评 NEEDS_REVISION · finding 全部修复后通过)

| id | sev | finding | 处置 |
|----|-----|---------|------|
| QA-1 | medium | T-008 只验关闭按钮路径焦点返还;Esc/遮罩路径未断言(AC-6 三机制) | **ADOPT**:T-008 三路径均显式断言 `document.activeElement===入口` |
| QA-2 | medium | T-009 footer 共存测试自渲染 fake pill 自查 = 同义反复,未验真实组件 | **ADOPT**:改真实 `<Sidebar/>` mount(mock hostClient + 空 store · onUpdateEvent 同步发 available),断言 `.sidebar-update-pill` + `.settings-entry` 共存于 `.sidebar-footer` |
| QA-3 | low | `_prevFocusRef` 声明顺序(同 ARCH-2) | **ADOPT** |
| QA-4 | low | 缺 `afterEach` 清 `window.termpro` | **ADOPT**:加 `afterEach(delete window.termpro)` |
| QA-5 | info | `mockTerpmro` typo(同 ARCH-3) | **ADOPT** |

**对抗式自查(QA-1)**:质疑「是否冗余 —— 代码三路径都走 handleCloseAbout,功能本就对」—— 确认代码功能对,但**测试**仅证一条路径 = AC-6「所有关闭机制返还焦点」未被自动化锁定,回归风险真实(将来改某路径不触发测试失败)→ 测试缺口成立,补断言。**QA-2**:质疑「smoke 已证真实渲染,unit 同义反复是否可留」—— smoke 证「能渲染」但不锁「pill 与 entry 共存契约」,且同义反复测试给虚假绿信号 → 改真实 mount 才有意义。

parseVersionArg 四失败态(缺/空/无`=`/空格)全覆盖;buildAdditionalArguments 6 例(含组合);AC-5 管道两端(T-001 解析 + T-011 注入 + T-007a 组件读)合证。

门禁实证:eslint 0 errors(changed files)· tsc clean · vitest 164/164 green。
