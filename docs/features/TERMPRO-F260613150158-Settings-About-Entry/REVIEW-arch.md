---
reviewer: architect
review_scope: code-review
execution: subagent
verdict: APPROVE
target_commit: 217cfadaceb4cb7caa537b38c2c24353571b803e
reviewed_at: "2026-06-14T00:30:00Z"
---
# 代码评审 · Architect(opus 隔离冷审)

verdict: **APPROVE**(初评 APPROVE · 提出可修项,已全部修复)

| id | sev | finding | 处置 |
|----|-----|---------|------|
| ARCH-1 | medium | DEV 徽标丢了 main 上的 `title` tooltip(轻 UX 回归)+ 徽标嵌入口内 vs AC-7「同级」措辞 | **ADOPT**:补回 `title`;AC-7 措辞调和(DEV 徽标在入口行内 = 已确认设计 · PRD v0.4) |
| ARCH-2 | low | `_prevFocusRef` 声明在 `openAbout` 使用之后(可运行但违 hooks 约定) | **ADOPT**:上移到 hooks 块 |
| ARCH-3 | low | 测试 `mockTerpmro` typo + alias shim | **ADOPT**:重命名 + 删 shim |
| ARCH-4 | info | 核心实现 sound:buildAdditionalArguments 保留原 smoke/dev 条件 · 红线守住(版本走 preload/argv 非 HostService · 无 protocol 改动)· Sidebar.css 改 L303 非加第三条 · parseVersionArg slice+trim 不抛错 · 安全读 bridge | ACK |

**对抗式自查(ARCH-1)**:质疑「徽标位置是否真要改」—— 回看用户已确认的全景预览:DEV 徽标本就设计在入口行内(参考截图的账户行布局)。故不改代码位置,改的是 AC-7 措辞(原 PRD 文字「三者同级」与已确认设计不符)→ 调和而非妥协。`title` tooltip 是 main 既有行为,丢失是实打实回归 → 补回。

门禁实证:tsc clean · vitest 164/18 green · TERMPRO_SMOKE SMOKE_OK(新 footer 渲染路径无错)。
