---
feature_id: "TERMPRO-B260710093647-Wrap-Indent-Path-Link"
author: QA
status: confirmed
prd_ref: N/A(Bug 流程 · 规格依据 = bugfix/BUG-TERMPRO-B260710093647-001.md)
tc_ref: N/A(同上)
test_run_at: "2026-07-10T12:26:34Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: N/A(Bug 流程无 PRD/TC · 门禁自动 skip)
revision_history:
  - version: v0.1
    date: "2026-07-10"
    author: QA
    summary: 首版(review-fix 后全量回归 + 截图场景 e2e)
---

# 折行路径链接跨缩进拼接 - Test Report

> 🟢 teamwork test-stage 产物 · Bug 流程分支(无 PRD/TC · 规格依据 = BUG 报告)

---

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 责任人 |
|---|---|---|---|
| integration(进程内集成) | 全量 vitest 套件(含链接解析/折行回归/高亮分段 12 文件 98 用例) | `src/**/__tests__/*.test.ts` | QA |
| api-e2e | 真实磁盘目录树 + 真实 fs.stat · 截图场景逐字节复刻 | `e2e/wrappedPathLink.e2e.test.ts` | QA |
| browser-e2e | N/A(无 UI 结构变更 · 终端 buffer 层行为已被上两层覆盖) | - | - |

---

## §2 integration 结果

### 2.1 执行命令
```bash
npx vitest run   # worktree 全量
```

### 2.2 stdout 摘录(全文 `evidence/test-integration.log`)
```text
 Test Files  92 passed | 1 skipped (93)
      Tests  776 passed | 1 skipped (777)
   Duration  6.12s
```
关键子集(`src/renderer/terminal/__tests__/`):terminalLinkWrap 11 用例(4 既有 + 7 本 Bug 新增)、terminalLinkHighlight 1 用例、terminalLinkParse/WebLinks/FilePanelRouting 全绿。

### 2.3 exit-code
`exit-code = 0`

---

## §3 api-e2e 结果

### 3.1 前置环境

| 项 | 内容 | 获取方式 |
|---|---|---|
| 磁盘目录树 | `<mkdtemp>/.worktree/IOS-F001/apps/ios/docs/features/IOS-F001-project-scaffold`(真实 mkdir) | 测试内自建/自清 |
| fs.stat | 真实 `node:fs.promises.stat`(host 同语义 kind=dir/file/null · 不打桩存在性) | e2e client 直连 |
| 终端文本 | 截图同构:行 1 恰好铺满、折行点在 `apps/` 后、续行悬挂缩进 4 空格、续段后跟 CJK label | 测试内构造 |

### 3.2 执行命令
```bash
npx vitest run docs/features/TERMPRO-B260710093647-Wrap-Indent-Path-Link/e2e/
```

### 3.3 stdout 摘录(全文 `evidence/test-e2e.log`)
```text
 ✓ e2e/wrappedPathLink.e2e.test.ts (2 tests) 79ms
   ✓ Ink 折行命令中的长路径:整条成链 · 点击打开真实目标目录
   ✓ 对照组:目标目录不存在时不成链(stat oracle · 无误链)
 Tests  2 passed (2)
```
断言要点:hover 行 1/行 2 均返回**唯一**链接 = 完整路径(不再是半截 `apps/`);`activate` 经 File Panel 定位回退后 `openPath(完整真实目录)`;对照组只回退出前缀目录链接、无误拼。

### 3.4 exit-code
`exit-code = 0`

---

## §4 AC 覆盖度

N/A —— Bug 流程无 PRD/TC,`ac_test_binding` 门禁自动 skip(不跑 verify-ac.py)。规格依据 = `bugfix/BUG-TERMPRO-B260710093647-001.md` §修复方案/§回归测试,对齐情况见 §5。

---

## §5 回归测试(对齐 BUG 报告 §回归测试)

| 测试集 | 范围 | 结果 |
|---|---|---|
| 复现用例(修复后转绿) | Ink 悬挂缩进整条成链(TDD 首轮红 → 修复后绿) | ✅ |
| 本 Bug 新增单测 | wrap ×7(缩进/gutter/tail 守卫/无斜杠×2/3行链/无关行回退)+ 高亮分段 ×1 | ✅ 8 passed |
| 截图场景 e2e | 真实磁盘 + 真实 stat + 点击打开 | ✅ 2 passed |
| 既有折行回归 | 软折行/硬折行/上下无关行不误拼(4 用例) | ✅ 语义未变 |
| 全量套件 | 92 文件 776 用例 | ✅ 0 失败 |
| 冒烟 | `TERMPRO_SMOKE=1 npx electron-forge start` | ✅ SMOKE_OK(review-fix 后) |

---

## §6 fix-retry 历史

Round 1 全绿,无 fix-retry。

---

## §7 已知问题(不阻塞 · audit 留痕)

| ID | 描述 | 严重度 | 决定 | 跟踪 |
|---|---|---|---|---|
| E1 | resize 变宽后 scrollback 中硬折行链接退化为半截前缀链(非本 fix 引入 · 无误链) | NIT | 记录为既有限制 | BUG 报告 §补充洞察 |
| A1/E3 | join 落空 stat 放大(已加预算+负缓存兜底) | MINOR | 上线观察项 | BUG 报告 §补充洞察 |
| A5 | 高亮段尾宽字符 decoration 短 1 列(既有) | MINOR | 延后 | PENDING-007 |

---

## §8 评审记录

| 日期 | 评审人 | 结论 | 备注 |
|---|---|---|---|
| 2026-07-10 | QA | ✅ pass | integration 0 · e2e 0 · 复现路径转绿 |
