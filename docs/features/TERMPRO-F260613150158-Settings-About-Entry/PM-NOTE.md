---
feature_id: "TERMPRO-F260613150158-Settings-About-Entry"
author: PM
stage: pm_acceptance
decision: pending   # 用户拍板后落:approved_and_ship | approved_no_ship | rejected_with_feedback
verified_at: "2026-06-14T00:42:00Z"
---
# PM 验收 — 左下角用户信息入口(Settings · About)

> PM 站用户视角逐条 AC 对照实现 + 测试证据。验收结论待用户拍板(三选项)。

## 逐条 AC 验收

| AC | 用户视角验证 | 证据 | 结论 |
|----|------------|------|------|
| AC-1 | 左下角出现「Settings」入口行 + 头像占位 | T-003 + e2e 真实渲染 + 预览截图 | ✅ |
| AC-2 | 点入口弹菜单,仅 About;再点关闭 | T-004 | ✅ |
| AC-3 | 点外面 / Esc 关菜单 | T-005 | ✅ |
| AC-4 | 点 About 弹版本 + 菜单关 | T-006 + 互斥 T-006b | ✅ |
| AC-5 | 版本是真实版本(非硬编码) | T-001 解析 + T-011 main 注入 + T-007a 组件读 + e2e 真实管道 | ✅ |
| AC-6 | 弹窗可关(×/遮罩/Esc)+ 焦点返还 | T-008(三路径) | ✅ |
| AC-7 | 升级胶囊与入口同级 + DEV 徽标在入口内 · 共存不重叠 | T-009 真实 Sidebar mount + 预览截图(01-entry) | ✅ |
| AC-8 | 版本读不到 → 「版本未知」不崩 | T-002 + T-007b + 安全读 | ✅ |
| AC-9 | 视觉复用 token · 风格对齐参考截图 | Designer 签核(UI.md)+ 三态截图核对 | ✅ |

## 范围与决策回顾
- 入口标签「Settings」、头像占位、菜单仅 About、About 仅版本号 —— 均按你早问门确认的范围(脚手架第一步)。
- footer 布局:升级胶囊在上 / 入口在下 · 菜单向上浮出(你确认方案 A)。
- DEV 渠道徽标 tooltip 已保留(review 修复回归)。

## 质量门禁(全绿)
- tsc 0 · vitest 164 passed · eslint 0 errors(changed files)· Electron 冒烟 SMOKE_OK
- PRD 多角色冷审 + blueprint(qa/architect/external)+ 代码评审(architect/qa/external)全 APPROVE
- AC 覆盖 9/9

## 验收结论
✅ 全部 AC 达成,质量门禁全绿。**是否 ship 由用户拍板**(三选项)。
